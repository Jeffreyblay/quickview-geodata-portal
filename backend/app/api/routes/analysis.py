from fastapi import APIRouter, HTTPException
from app.models.schemas import (
    AnalysisResult,
    BufferRequest,
    HotspotRequest,
    DBSCANRequest,
    NearestNeighborRequest,
    AttributeStatsRequest,
)
from app.services import analysis as svc

router = APIRouter(prefix="/analysis", tags=["Analysis"])


def _handle(fn, *args, **kwargs) -> AnalysisResult:
    try:
        return fn(*args, **kwargs)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/buffer", response_model=AnalysisResult)
async def buffer(req: BufferRequest):
    """Generate buffers around each point at a given radius (metres)."""
    return _handle(svc.run_buffer, req.session_id, req.radius_m)


@router.post("/hotspot", response_model=AnalysisResult)
async def hotspot(req: HotspotRequest):
    """KDE-based hotspot / heatmap analysis."""
    return _handle(svc.run_hotspot, req.session_id, req.bandwidth, req.grid_size)


@router.post("/dbscan", response_model=AnalysisResult)
async def dbscan(req: DBSCANRequest):
    """DBSCAN density-based spatial clustering."""
    return _handle(svc.run_dbscan, req.session_id, req.epsilon_m, req.min_samples)


@router.post("/nearest-neighbor", response_model=AnalysisResult)
async def nearest_neighbor(req: NearestNeighborRequest):
    """Nearest neighbor distance analysis with Clark-Evans R statistic."""
    return _handle(svc.run_nearest_neighbor, req.session_id)


@router.post("/attribute-stats", response_model=AnalysisResult)
async def attribute_stats(req: AttributeStatsRequest):
    """Descriptive statistics for numeric attribute columns."""
    return _handle(svc.run_attribute_stats, req.session_id, req.columns)
