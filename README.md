# 🌍 Quickview GeoData Portal

An open-source geospatial data platform for uploading, extracting, and analyzing geospatial vector data (points, lines, and polygons) interactively.

## Stack
- **Backend**: Python 3.11 + FastAPI + GeoPandas + Scikit-learn + SciPy
- **Frontend**: Vanilla HTML/CSS/JS + Leaflet.js
- **Deployment**: GitHub Pages (frontend) + Railway (backend)
- **Containerization**: Docker + Docker Compose

## Features
- Upload CSV, GeoJSON, JSON or Zipped Shapefiles
- Fetch remote datasets via URL (wget-style)
- Interactive Leaflet map with data rendering
- Basic Spatial analyses: Buffer, KDE Hotspot, DBSCAN Clustering, Nearest Neighbor, Attribute Stats
- Attribute table with column filtering
- Dataset metadata panel

## Project Structure
```
geodata-portal/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI entry point
│   │   ├── api/routes/
│   │   │   ├── ingest.py         # File upload + URL fetch endpoints
│   │   │   └── analysis.py       # Analysis endpoints
│   │   ├── core/
│   │   │   └── config.py         # App settings
│   │   ├── services/
│   │   │   ├── ingest.py         # File parsing logic
│   │   │   └── analysis.py       # Spatial analysis logic
│   │   └── models/
│   │       └── schemas.py        # Pydantic models
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── index.html                # Main UI
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                # App bootstrap
│   │   ├── map.js                # Leaflet map logic
│   │   ├── ingest.js             # Upload + fetch logic
│   │   ├── analysis.js           # Analysis UI + API calls
│   │   └── table.js              # Attribute table
│   └── assets/
├── docker/
│   └── docker-compose.yml
└── .github/workflows/
    └── deploy.yml                # GitHub Actions — auto deploy frontend to GH Pages
```

## Quick Start (Local)
```bash
# Clone
git clone https://github.com/YOUR_USERNAME/geodata-portal.git
cd geodata-portal

# Run with Docker Compose
docker-compose -f docker/docker-compose.yml up --build

# Backend:  http://localhost:8000
# Frontend: http://localhost:3000
# API Docs: http://localhost:8000/docs
```

## Environment Variables
Create `backend/.env`:
```
CORS_ORIGINS=http://localhost:3000,https://YOUR_USERNAME.github.io
MAX_UPLOAD_MB=50
```
