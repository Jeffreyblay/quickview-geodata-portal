"""
Ingest Service
Handles parsing of CSV, GeoJSON, JSON, XML, and Zipped Shapefiles into GeoDataFrames.
Also provides URL-based remote fetching.
"""
import io
import os
import uuid
import zipfile
import json
import xml.etree.ElementTree as ET
import requests
import pandas as pd
import geopandas as gpd
from pathlib import Path
from shapely.geometry import Point
from typing import Optional, Tuple

from app.core.config import settings
from app.models.schemas import DatasetMeta, IngestResponse

SESSION_STORE: dict[str, gpd.GeoDataFrame] = {}


def _ensure_temp_dir():
    os.makedirs(settings.TEMP_DIR, exist_ok=True)


def _detect_geometry_type(gdf: gpd.GeoDataFrame) -> Optional[str]:
    """Detect the dominant geometry type in a GeoDataFrame."""
    if gdf.geometry is None or len(gdf.geometry) == 0:
        return None
    types = set(gdf.geometry.geom_type.dropna().unique())
    if len(types) == 0:
        return None
    if len(types) == 1:
        return types.pop()
    # Mixed types — summarise
    if types <= {"Point", "MultiPoint"}:
        return "Point"
    if types <= {"LineString", "MultiLineString"}:
        return "LineString"
    if types <= {"Polygon", "MultiPolygon"}:
        return "Polygon"
    return "Mixed"


def _gdf_to_meta(gdf: gpd.GeoDataFrame) -> DatasetMeta:
    has_geom = gdf.geometry is not None and len(gdf.geometry) > 0
    bbox = list(gdf.total_bounds) if has_geom else None
    crs = str(gdf.crs) if gdf.crs else None
    dtypes = {col: str(dtype) for col, dtype in gdf.dtypes.items() if col != "geometry"}
    geometry_type = _detect_geometry_type(gdf) if has_geom else None
    return DatasetMeta(
        total_rows=len(gdf),
        total_columns=len(gdf.columns) - (1 if "geometry" in gdf.columns else 0),
        columns=[c for c in gdf.columns if c != "geometry"],
        dtypes=dtypes,
        crs=crs,
        bbox=bbox,
        has_geometry=has_geom,
        geometry_type=geometry_type,
    )


def _csv_to_gdf(content: bytes, filename: str) -> gpd.GeoDataFrame:
    df = pd.read_csv(io.BytesIO(content))
    lat_candidates = ["lat", "latitude", "y", "Lat", "Latitude", "LAT"]
    lon_candidates = ["lon", "lng", "longitude", "x", "Lon", "Lng", "Longitude", "LON", "LNG"]
    lat_col = next((c for c in df.columns if c in lat_candidates), None)
    lon_col = next((c for c in df.columns if c in lon_candidates), None)
    if not lat_col or not lon_col:
        raise ValueError(
            f"Could not detect lat/lon columns. Found columns: {list(df.columns)}. "
            "Please ensure your CSV has columns named lat/latitude and lon/longitude/lng."
        )
    df[lat_col] = pd.to_numeric(df[lat_col], errors="coerce")
    df[lon_col] = pd.to_numeric(df[lon_col], errors="coerce")
    df = df.dropna(subset=[lat_col, lon_col])
    geometry = [Point(xy) for xy in zip(df[lon_col], df[lat_col])]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    return gdf


def _geojson_to_gdf(content: bytes) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(io.BytesIO(content))
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def _json_to_gdf(content: bytes) -> gpd.GeoDataFrame:
    """Handle both GeoJSON and flat JSON arrays with lat/lon fields."""
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON file: {e}")

    # Try as GeoJSON first
    if isinstance(data, dict) and data.get("type") in ("FeatureCollection", "Feature", "GeometryCollection"):
        return _geojson_to_gdf(content)

    # Try as array of records with lat/lon
    if isinstance(data, list):
        df = pd.DataFrame(data)
        return _csv_to_gdf(df.to_csv(index=False).encode(), "data.csv")

    # Try as dict with a features/data/records key
    for key in ("features", "data", "records", "results"):
        if key in data and isinstance(data[key], list):
            df = pd.DataFrame(data[key])
            return _csv_to_gdf(df.to_csv(index=False).encode(), "data.csv")

    raise ValueError("Could not parse JSON. Expected GeoJSON, array of records, or object with a features/data/records key.")


def _xml_to_gdf(content: bytes) -> gpd.GeoDataFrame:
    """Parse XML into a GeoDataFrame. Supports flat records with lat/lon attributes or elements."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise ValueError(f"Invalid XML file: {e}")

    records = []
    # Each direct child of root is a record
    for child in root:
        record = dict(child.attrib)  # attributes
        for elem in child:           # child elements as fields
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag  # strip namespace
            record[tag] = elem.text
        if record:
            records.append(record)

    if not records:
        raise ValueError("No records found in XML. Each child element of the root is treated as a row.")

    df = pd.DataFrame(records)
    return _csv_to_gdf(df.to_csv(index=False).encode(), "data.csv")


def _zip_to_gdf(content: bytes) -> gpd.GeoDataFrame:
    _ensure_temp_dir()
    extract_path = Path(settings.TEMP_DIR) / str(uuid.uuid4())
    extract_path.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        zf.extractall(extract_path)
    shp_files = list(extract_path.rglob("*.shp"))
    geojson_files = list(extract_path.rglob("*.geojson")) + list(extract_path.rglob("*.json"))
    if shp_files:
        gdf = gpd.read_file(shp_files[0])
    elif geojson_files:
        gdf = gpd.read_file(geojson_files[0])
    else:
        raise ValueError("No .shp or .geojson file found inside the ZIP archive.")
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def parse_upload(content: bytes, filename: str) -> Tuple[str, IngestResponse]:
    ext = Path(filename).suffix.lower()
    if ext == ".csv":
        gdf = _csv_to_gdf(content, filename)
    elif ext == ".geojson":
        gdf = _geojson_to_gdf(content)
    elif ext == ".json":
        gdf = _json_to_gdf(content)
    elif ext == ".xml":
        gdf = _xml_to_gdf(content)
    elif ext == ".zip":
        gdf = _zip_to_gdf(content)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Accepted: .csv, .geojson, .json, .xml, .zip")

    session_id = str(uuid.uuid4())
    SESSION_STORE[session_id] = gdf
    meta = _gdf_to_meta(gdf)
    geojson = gdf.__geo_interface__
    return session_id, IngestResponse(session_id=session_id, meta=meta, geojson=geojson)


def fetch_url(url: str, file_type: str) -> Tuple[str, IngestResponse]:
    """Fetch a remote file by URL and ingest it. file_type is required."""
    response = requests.get(url, timeout=30, stream=True)
    response.raise_for_status()
    content = response.content
    filename = f"fetched.{file_type.lstrip('.')}"
    return parse_upload(content, filename)


def get_session_gdf(session_id: str) -> gpd.GeoDataFrame:
    gdf = SESSION_STORE.get(session_id)
    if gdf is None:
        raise KeyError(f"Session '{session_id}' not found. Please re-upload your data.")
    return gdf

