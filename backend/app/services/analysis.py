"""
Analysis Service
Implements 6 spatial analyses for point data:
  1. Buffer
  2. KDE Hotspot
  3. DBSCAN Clustering
  4. Nearest Neighbor Distance
  5. Convex Hull
  6. Attribute Statistics
"""
import numpy as np
import pandas as pd
import geopandas as gpd
from scipy.stats import gaussian_kde
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN
from shapely.geometry import Point, MultiPoint
from shapely.ops import unary_union

from app.models.schemas import AnalysisResult
from app.services.ingest import get_session_gdf

# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_projected(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reproject to Web Mercator (metres) for distance-based operations."""
    return gdf.to_crs("EPSG:3857")


def _to_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs("EPSG:4326")


# ── 1. Buffer ────────────────────────────────────────────────────────────────

def run_buffer(session_id: str, radius_m: float) -> AnalysisResult:
    gdf = get_session_gdf(session_id)
    proj = _to_projected(gdf)
    buffered = proj.copy()
    buffered["geometry"] = proj.geometry.buffer(radius_m)
    result = _to_wgs84(buffered)

    # Drop non-serialisable columns
    result = result[[c for c in result.columns if c == "geometry"]]

    return AnalysisResult(
        analysis_type="buffer",
        geojson=result.__geo_interface__,
        stats={"radius_m": radius_m, "feature_count": len(result)},
        summary=f"Generated {len(result)} buffer(s) with radius {radius_m}m.",
    )


# ── 2. KDE Hotspot ───────────────────────────────────────────────────────────

def run_hotspot(session_id: str, bandwidth: float | None, grid_size: int) -> AnalysisResult:
    gdf = get_session_gdf(session_id)
    proj = _to_projected(gdf)

    coords = np.array([[geom.x, geom.y] for geom in proj.geometry if geom is not None])
    if len(coords) < 3:
        raise ValueError("Need at least 3 points for KDE.")

    kde = gaussian_kde(coords.T, bw_method=bandwidth)

    minx, miny, maxx, maxy = proj.total_bounds
    xi = np.linspace(minx, maxx, grid_size)
    yi = np.linspace(miny, maxy, grid_size)
    xx, yy = np.meshgrid(xi, yi)
    grid_pts = np.vstack([xx.ravel(), yy.ravel()])
    density = kde(grid_pts).reshape(grid_size, grid_size)

    # Convert grid cells above median density to GeoJSON points for Leaflet heatmap
    threshold = np.percentile(density, 50)
    mask = density > threshold
    rows, cols = np.where(mask)
    heat_points = []
    for r, c in zip(rows, cols):
        pt_wgs = gpd.GeoDataFrame(
            geometry=[Point(xi[c], yi[r])], crs="EPSG:3857"
        ).to_crs("EPSG:4326").geometry[0]
        heat_points.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [pt_wgs.x, pt_wgs.y]},
            "properties": {"intensity": float(density[r, c])},
        })

    geojson = {"type": "FeatureCollection", "features": heat_points}

    return AnalysisResult(
        analysis_type="hotspot_kde",
        geojson=geojson,
        stats={"grid_size": grid_size, "max_density": float(density.max()), "heat_points": len(heat_points)},
        summary=f"KDE hotspot computed on a {grid_size}×{grid_size} grid. {len(heat_points)} high-density cells returned.",
    )


# ── 3. DBSCAN Clustering ─────────────────────────────────────────────────────

def run_dbscan(session_id: str, epsilon_m: float, min_samples: int) -> AnalysisResult:
    gdf = get_session_gdf(session_id)
    proj = _to_projected(gdf)

    coords = np.array([[geom.x, geom.y] for geom in proj.geometry if geom is not None])
    db = DBSCAN(eps=epsilon_m, min_samples=min_samples, metric="euclidean").fit(coords)
    labels = db.labels_

    result = gdf.copy()
    result["cluster"] = labels
    result["cluster_label"] = result["cluster"].apply(
        lambda x: f"Cluster {x}" if x >= 0 else "Noise"
    )

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = int(np.sum(labels == -1))

    return AnalysisResult(
        analysis_type="dbscan_clustering",
        geojson=result.__geo_interface__,
        stats={
            "n_clusters": n_clusters,
            "n_noise_points": n_noise,
            "epsilon_m": epsilon_m,
            "min_samples": min_samples,
        },
        summary=f"Found {n_clusters} cluster(s) and {n_noise} noise point(s) with ε={epsilon_m}m, min_samples={min_samples}.",
    )


# ── 4. Nearest Neighbor ──────────────────────────────────────────────────────

def run_nearest_neighbor(session_id: str) -> AnalysisResult:
    gdf = get_session_gdf(session_id)
    proj = _to_projected(gdf)

    coords = np.array([[geom.x, geom.y] for geom in proj.geometry if geom is not None])
    if len(coords) < 2:
        raise ValueError("Need at least 2 points for nearest neighbor analysis.")

    tree = cKDTree(coords)
    distances, _ = tree.query(coords, k=2)   # k=2: self + nearest
    nn_distances = distances[:, 1]           # Exclude self (dist=0)

    # Clark-Evans R statistic
    n = len(coords)
    area = (proj.total_bounds[2] - proj.total_bounds[0]) * (proj.total_bounds[3] - proj.total_bounds[1])
    density = n / area
    expected_mean = 1 / (2 * np.sqrt(density))
    observed_mean = nn_distances.mean()
    r_statistic = observed_mean / expected_mean

    pattern = "clustered" if r_statistic < 0.9 else "dispersed" if r_statistic > 1.1 else "random"

    result = gdf.copy()
    result["nn_distance_m"] = nn_distances

    return AnalysisResult(
        analysis_type="nearest_neighbor",
        geojson=result.__geo_interface__,
        stats={
            "mean_nn_distance_m": round(float(observed_mean), 2),
            "min_nn_distance_m": round(float(nn_distances.min()), 2),
            "max_nn_distance_m": round(float(nn_distances.max()), 2),
            "std_nn_distance_m": round(float(nn_distances.std()), 2),
            "clark_evans_r": round(float(r_statistic), 4),
            "pattern": pattern,
        },
        summary=f"Mean nearest neighbor distance: {observed_mean:.1f}m. Clark-Evans R={r_statistic:.3f} → pattern is {pattern}.",
    )


# ── 5. Convex Hull ───────────────────────────────────────────────────────────

def run_convex_hull(session_id: str) -> AnalysisResult:
    gdf = get_session_gdf(session_id)

    multipoint = MultiPoint(list(gdf.geometry))
    hull = multipoint.convex_hull

    hull_gdf = gpd.GeoDataFrame(geometry=[hull], crs="EPSG:4326")
    area_km2 = _to_projected(hull_gdf).geometry.area[0] / 1_000_000

    return AnalysisResult(
        analysis_type="convex_hull",
        geojson=hull_gdf.__geo_interface__,
        stats={
            "area_km2": round(area_km2, 4),
            "point_count": len(gdf),
        },
        summary=f"Convex hull covers {area_km2:.2f} km² enclosing {len(gdf)} points.",
    )


# ── 6. Attribute Statistics ──────────────────────────────────────────────────

def run_attribute_stats(session_id: str, columns: list[str] | None) -> AnalysisResult:
    gdf = get_session_gdf(session_id)
    df = pd.DataFrame(gdf.drop(columns="geometry", errors="ignore"))

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    target_cols = columns if columns else numeric_cols

    if not target_cols:
        raise ValueError("No numeric columns found in dataset for attribute statistics.")

    stats = {}
    for col in target_cols:
        if col in df.columns:
            series = df[col].dropna()
            stats[col] = {
                "count": int(series.count()),
                "mean": round(float(series.mean()), 4),
                "median": round(float(series.median()), 4),
                "std": round(float(series.std()), 4),
                "min": round(float(series.min()), 4),
                "max": round(float(series.max()), 4),
                "null_count": int(df[col].isna().sum()),
            }

    return AnalysisResult(
        analysis_type="attribute_stats",
        geojson=None,
        stats=stats,
        summary=f"Computed statistics for {len(stats)} column(s): {', '.join(stats.keys())}.",
    )
