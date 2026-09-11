# 🌍 Quickview GeoData Portal

An open-source geospatial data platform for uploading, exploring, and analyzing vector data (points, lines, and polygons) interactively in the browser.

**Live app:** https://jeffreyblay.github.io/quickview-geodata-portal/
**API:** https://quickview-geodata-portal.onrender.com/docs

## Stack
- **Backend**: Python 3.11 + FastAPI + GeoPandas + Scikit-learn + SciPy + PyArrow
- **Frontend**: Vanilla HTML/CSS/JS + Leaflet.js + Chart.js + deck.gl
- **Deployment**: GitHub Pages (frontend) + Render (backend, Docker)
- **Containerization**: Docker + Docker Compose

## Features

### Data loading
- Upload CSV, GeoJSON, JSON, XML, or zipped Shapefiles
- Fetch remote datasets by URL
- CSV / JSON / XML point data is detected from `lat`/`latitude` and `lon`/`lng`/`longitude` columns
- All data is reprojected to **WGS 84 (EPSG:4326)** on ingest; files with no CRS are assumed to be WGS 84
- Dataset info panel: row count, column count, CRS, geometry type

### Map
- Interactive Leaflet map with feature popups
- 9 basemaps: Esri Streets (default), Satellite, Satellite + labels, Topographic, Shaded relief, Light gray, and Dark gray use English labels; OpenStreetMap and OpenTopoMap use local-language labels
- The last basemap choice is remembered per browser

### Attribute filter
- Build conditions as **field → operator → value**, combined with *all* (AND) or *any* (OR)
- Numeric operators: `= ≠ > ≥ < ≤`, between, is empty, is not empty
- Text operators: equals, contains, starts with, is empty, and their negations — with autocomplete from the data
- Spatial analyses and CSV / JSON / GeoJSON exports run on the filtered subset

### Symbology
- **Graduated** styling for numeric fields: quantile, equal interval, or natural breaks (Jenks), 3–7 classes, 4 colour ramps, optional size-by-value
- **Categorized** styling for text fields (top 10 categories, the rest grouped as "Other")
- Map legend with feature counts per class; missing values shown as "No data"

### Spatial analysis
- Buffer, KDE Hotspot, DBSCAN Clustering, Nearest Neighbor (with Clark-Evans R), Attribute Statistics
- Bar charts for attribute statistics and DBSCAN cluster sizes

### 3D view (deck.gl)
- Points are drawn as 3D columns and polygons are extruded; line features are not shown
- Height from any numeric field (or uniform), measured up from the field's minimum so negative values work
- Heights auto-scale to the data's extent, with an adjustable height scale
- Colours follow the current symbology, and the view respects the attribute filter
- Can also show the last analysis result (cluster size, KDE density, nearest-neighbour distance)

### Table & export
- Attribute table with search, column sorting, and click-to-zoom
- Export to GeoJSON, CSV, JSON, GeoParquet, or GML

## Project Structure
```
geodata-portal/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI entry point (CORS, routers, health check)
│   │   ├── api/routes/
│   │   │   ├── ingest.py         # File upload + URL fetch endpoints
│   │   │   ├── analysis.py       # Analysis endpoints
│   │   │   └── export.py         # GeoParquet / GML export endpoint
│   │   ├── core/
│   │   │   └── config.py         # App settings (CORS origins, upload limit)
│   │   ├── services/
│   │   │   ├── ingest.py         # File parsing, CRS normalisation, session store
│   │   │   ├── analysis.py       # Spatial analysis logic
│   │   │   └── export.py         # GeoParquet / GML serialization
│   │   └── models/
│   │       └── schemas.py        # Pydantic models
│   ├── requirements.txt
│   ├── Dockerfile                # Listens on $PORT (default 7860)
│   └── README.md
├── frontend/
│   ├── index.html                # Main UI
│   ├── css/style.css
│   └── js/
│       ├── app.js                # Global state, API base URL, helpers
│       ├── map.js                # Leaflet map, basemaps, point styling
│       ├── ingest.js             # Upload + fetch logic
│       ├── filter.js             # Attribute filter builder
│       ├── symbology.js          # Graduated / categorized styling + legend
│       ├── analysis.js           # Analysis UI, API calls, result charts
│       ├── view3d.js             # deck.gl 3D view
│       └── table.js              # Attribute table + export
├── docker/
│   └── docker-compose.yml        # Local backend + nginx frontend
└── .github/workflows/
    └── deploy.yml                # Auto-deploy frontend to GitHub Pages
```

## Quick Start (Local)
```bash
# Clone
git clone https://github.com/Jeffreyblay/quickview-geodata-portal.git
cd quickview-geodata-portal

# Run with Docker Compose
docker-compose -f docker/docker-compose.yml up --build

# Backend:  http://localhost:8000
# Frontend: http://localhost:3000
# API Docs: http://localhost:8000/docs
```

For local development, point the frontend at your local backend by changing `API_BASE` in `frontend/js/app.js` to `http://localhost:8000/api/v1`.

## Configuration
Settings live in `backend/app/core/config.py`. The backend does **not** read a `.env` file; override settings with environment variables instead:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `7860` | Port uvicorn listens on (Render sets this automatically) |
| `CORS_ORIGINS` | localhost ports + `https://jeffreyblay.github.io` | JSON list, e.g. `["https://example.com"]` |
| `MAX_UPLOAD_MB` | `50` | Maximum upload size |

## Deployment
- **Frontend** — GitHub Pages, deployed automatically on push to `main`.
- **Backend** — Render web service built from `backend/Dockerfile` (root directory `backend`, health check `/health`). Render redeploys on every push.

The free Render instance sleeps after ~15 minutes of inactivity, so the first request after a pause can take 30–60 seconds.

## Notes
- Uploaded datasets are held in memory on the backend and are lost when the server restarts or sleeps — re-upload if an analysis reports the session was not found.
