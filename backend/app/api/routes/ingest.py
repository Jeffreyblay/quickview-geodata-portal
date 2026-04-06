from fastapi import APIRouter, UploadFile, File, HTTPException
from app.models.schemas import IngestResponse, FetchURLRequest
from app.services.ingest import parse_upload, fetch_url
from app.core.config import settings

router = APIRouter(prefix="/ingest", tags=["Ingest"])


@router.post("/upload", response_model=IngestResponse)
async def upload_file(file: UploadFile = File(...)):
    """Upload a CSV, GeoJSON, JSON, XML, or ZIP file for ingestion."""
    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_MB}MB.",
        )
    try:
        session_id, response = parse_upload(content, file.filename)
        return response
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")


@router.post("/fetch", response_model=IngestResponse)
async def fetch_remote(request: FetchURLRequest):
    """Fetch a remote dataset by URL. file_type must be specified by the user."""
    try:
        session_id, response = fetch_url(request.url, request.file_type)
        return response
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch URL: {str(e)}")
