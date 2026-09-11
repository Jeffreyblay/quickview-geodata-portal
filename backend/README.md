---
title: QuickView GeoData API
emoji: 🗺️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# QuickView GeoData API

FastAPI backend for the QuickView GeoData Portal. Ingests CSV, GeoJSON, JSON, XML and zipped Shapefiles, normalizes them to EPSG:4326, and serves analysis and export endpoints.

- Health check: `/health`
- API docs: `/docs`
