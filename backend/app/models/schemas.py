from pydantic import BaseModel
from typing import Any, Dict, List, Optional


# ── Ingest ──────────────────────────────────────────────────────────────────

class DatasetMeta(BaseModel):
    total_rows: int
    total_columns: int
    columns: List[str]
    dtypes: Dict[str, str]
    crs: Optional[str]
    bbox: Optional[List[float]]   # [minx, miny, maxx, maxy]
    has_geometry: bool
    geometry_type: Optional[str] = None  # "Point", "LineString", "Polygon", "Mixed", etc.


class IngestResponse(BaseModel):
    session_id: str
    meta: DatasetMeta
    geojson: Dict[str, Any]       # FeatureCollection for Leaflet


class FetchURLRequest(BaseModel):
    url: str
    file_type: str   # Required: "csv", "geojson", "json", "zip", "xml"


# ── Analysis ─────────────────────────────────────────────────────────────────

class BufferRequest(BaseModel):
    session_id: str
    radius_m: float               # Buffer radius in metres


class HotspotRequest(BaseModel):
    session_id: str
    bandwidth: Optional[float] = None   # KDE bandwidth, auto if None
    grid_size: int = 100


class DBSCANRequest(BaseModel):
    session_id: str
    epsilon_m: float = 500        # Neighbourhood radius in metres
    min_samples: int = 5


class NearestNeighborRequest(BaseModel):
    session_id: str



class AttributeStatsRequest(BaseModel):
    session_id: str
    columns: Optional[List[str]] = None   # None = all numeric columns


class AnalysisResult(BaseModel):
    analysis_type: str
    geojson: Optional[Dict[str, Any]] = None   # Geometric result for map
    stats: Optional[Dict[str, Any]] = None     # Tabular stats
    summary: Optional[str] = None              # Human-readable summary
