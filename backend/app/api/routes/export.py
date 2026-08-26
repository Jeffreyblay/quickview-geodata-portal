from fastapi import APIRouter, HTTPException, Response
from app.services.export import export_dataset

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/{session_id}/{fmt}")
async def export_session(session_id: str, fmt: str):
    """Download the full session dataset as GeoParquet or GML."""
    try:
        content, media_type, filename = export_dataset(session_id, fmt)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
