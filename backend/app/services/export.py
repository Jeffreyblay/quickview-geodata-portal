"""
Export Service
Serialises a session's GeoDataFrame into formats not producible client-side.
"""
import io
import os
import uuid
from pathlib import Path

from app.core.config import settings
from app.services.ingest import get_session_gdf

SUPPORTED_FORMATS = {"geoparquet", "gml"}


def export_geoparquet(session_id: str) -> bytes:
    gdf = get_session_gdf(session_id)
    buf = io.BytesIO()
    gdf.to_parquet(buf)
    return buf.getvalue()


def export_gml(session_id: str) -> bytes:
    gdf = get_session_gdf(session_id)
    os.makedirs(settings.TEMP_DIR, exist_ok=True)
    out_path = Path(settings.TEMP_DIR) / f"{uuid.uuid4()}.gml"
    try:
        gdf.to_file(out_path, driver="GML")
        return out_path.read_bytes()
    finally:
        out_path.unlink(missing_ok=True)
        xsd_path = out_path.with_suffix(".xsd")
        xsd_path.unlink(missing_ok=True)


def export_dataset(session_id: str, fmt: str) -> tuple[bytes, str, str]:
    """Returns (content, media_type, filename)."""
    if fmt == "geoparquet":
        return (
            export_geoparquet(session_id),
            "application/octet-stream",
            "geodata_export.parquet",
        )
    if fmt == "gml":
        return (
            export_gml(session_id),
            "application/gml+xml",
            "geodata_export.gml",
        )
    raise ValueError(f"Unsupported export format: {fmt}. Supported: {sorted(SUPPORTED_FORMATS)}")
