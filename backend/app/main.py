from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import ingest, analysis

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Open-source geospatial ETL and analysis platform.",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(ingest.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.VERSION}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy"}
