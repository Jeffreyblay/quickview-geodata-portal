/**
 * view3d.js — deck.gl 3D view of the loaded dataset or the last analysis result
 *
 * Points are drawn as columns and polygons are extruded; lines are not shown.
 * Heights come from a numeric field, are measured up from the field's minimum
 * (so negative values work), and are scaled to the size of the data's extent.
 * The dataset view follows the attribute filter and the symbology colours.
 */

let deckInstance = null;
let lastAnalysis = null;       // { geojson, type } from the most recent analysis
let v3dSessionId = null;       // dataset the field picker was built for

const NO_DATA_RGB = [213, 207, 198, 200];
const ACCENT_HEX = "#c25b2e";
const ANALYSIS_RAMP = ["#fde8df", "#f4a582", "#e8845a", "#c25b2e", "#6b2010"];
const COORD_FIELD = /^(lat|lon|lng|latitude|longitude|x|y|id|fid|objectid)$|_id$|_dd$|^site_(latitude|longitude)$/i;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("v3dSource").addEventListener("change", () => render3DView({ fit: true }));
  document.getElementById("v3dField").addEventListener("change", () => render3DView());
  document.getElementById("v3dScale").addEventListener("input", (e) => {
    document.getElementById("v3dScaleVal").textContent = `${parseFloat(e.target.value).toFixed(1)}×`;
    render3DView();
  });
  document.getElementById("v3dFitBtn").addEventListener("click", () => render3DView({ fit: true }));
});

// ── Init (called when the 3D tab opens) ────────────────────────────────────
function init3D() {
  if (!window.deck) {
    toast("3D library failed to load", "error");
    return;
  }

  if (!deckInstance) {
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    document.getElementById("deck3d").appendChild(canvas);

    deckInstance = new deck.Deck({
      canvas,
      initialViewState: { longitude: 0, latitude: 20, zoom: 2, pitch: 45, bearing: 0 },
      controller: true,
      layers: [basemapLayer()],
      getTooltip: tooltipFor,
    });
  }

  syncFieldPicker();
  render3DView({ fit: true });
}

function basemapLayer() {
  return new deck.TileLayer({
    id: "basemap-tiles",
    // Same Esri street basemap as the 2D default (English labels, no API key)
    data: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      const { bbox } = props.tile;
      return new deck.BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
      });
    },
  });
}

// ── Analysis hook (called by analysis.js) ──────────────────────────────────
function render3D(geojson, analysisType) {
  const sourceSel = document.getElementById("v3dSource");
  const analysisOpt = sourceSel.querySelector('option[value="analysis"]');

  if (!geojson?.features?.length) return;   // e.g. attribute stats: nothing spatial
  lastAnalysis = { geojson, type: analysisType, sessionId: window.GEO.sessionId };
  analysisOpt.disabled = false;
  analysisOpt.textContent = `Analysis: ${ANALYSIS_LABELS[analysisType] || analysisType}`;
  sourceSel.value = "analysis";

  if (deckInstance) render3DView({ fit: true });
}

const ANALYSIS_LABELS = {
  buffer: "Buffer",
  hotspot_kde: "KDE hotspot",
  dbscan_clustering: "DBSCAN clusters",
  nearest_neighbor: "Nearest neighbour",
};

// ── Field picker ───────────────────────────────────────────────────────────
function syncFieldPicker() {
  const meta = window.GEO.currentMeta;
  if (!meta || v3dSessionId === window.GEO.sessionId) return;
  v3dSessionId = window.GEO.sessionId;

  // A result from a previous dataset no longer applies
  if (lastAnalysis && lastAnalysis.sessionId !== v3dSessionId) {
    lastAnalysis = null;
    const sourceSel = document.getElementById("v3dSource");
    const analysisOpt = sourceSel.querySelector('option[value="analysis"]');
    analysisOpt.disabled = true;
    analysisOpt.textContent = "Last analysis result";
    sourceSel.value = "data";
  }

  const numeric = meta.columns.filter(c => /int|float|double|decimal/.test(meta.dtypes[c] || ""));
  const select = document.getElementById("v3dField");
  select.innerHTML = "";
  select.add(new Option("Uniform height", ""));
  numeric.forEach(c => select.add(new Option(c, c)));

  // Default: the symbology field if numeric, else the first non-coordinate numeric field
  const symField = document.getElementById("symField")?.value;
  select.value = numeric.includes(symField) ? symField : (numeric.find(c => !COORD_FIELD.test(c)) || "");
}

// ── Build & render ─────────────────────────────────────────────────────────
function render3DView({ fit = false } = {}) {
  if (!deckInstance) return;

  const source = document.getElementById("v3dSource").value;
  const useAnalysis = source === "analysis" && lastAnalysis;
  const geojson = useAnalysis
    ? lastAnalysis.geojson
    : (window.GEO.filteredGeoJSON || window.GEO.currentGeoJSON);

  document.getElementById("v3dControls").style.display = window.GEO.currentGeoJSON ? "block" : "none";
  document.getElementById("v3dFieldRow").style.display = useAnalysis ? "none" : "block";

  if (!geojson?.features?.length) {
    setNote("Load a point or polygon dataset to view it in 3D.");
    deckInstance.setProps({ layers: [deckInstance.props.layers[0]] });
    return;
  }

  const spec = useAnalysis ? analysisSpec(lastAnalysis) : datasetSpec();
  const { points, polygons, skippedLines } = splitGeometries(geojson);

  if (!points.length && !polygons.length) {
    setNote("3D view supports point and polygon data. This dataset contains only lines.");
    deckInstance.setProps({ layers: [deckInstance.props.layers[0]] });
    return;
  }

  // Heights: normalise each value against the range, then scale to the extent
  const all = [...points.map(p => p.feature), ...polygons];
  const values = all.map(spec.value).filter(v => v !== null && !isNaN(v));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const bounds = featureBounds(geojson);
  const extentM = Math.max(extentMetres(bounds), 2000);
  const exaggeration = parseFloat(document.getElementById("v3dScale").value);
  const maxHeight = extentM * 0.12 * exaggeration;
  const baseHeight = maxHeight * 0.02;   // the minimum value still gets a visible stub

  const heightOf = feature => {
    const v = spec.value(feature);
    if (v === null || isNaN(v)) return 0;
    if (spec.uniform || max === min) return maxHeight * 0.3;
    return baseHeight + ((v - min) / (max - min)) * (maxHeight - baseHeight);
  };
  const colorOf = feature => {
    const v = spec.value(feature);
    if (!spec.uniform && (v === null || isNaN(v))) return NO_DATA_RGB;
    return hexToRgba(spec.color(feature, v, min, max));
  };

  // Column radius adapts to point density so columns rarely merge
  const radius = Math.min(
    Math.max(extentM / (Math.sqrt(Math.max(points.length, 1)) * 5), extentM * 0.0015, 15),
    extentM * 0.006
  );

  const layers = [deckInstance.props.layers[0]];
  if (polygons.length) {
    layers.push(new deck.GeoJsonLayer({
      id: "v3d-polygons",
      data: { type: "FeatureCollection", features: polygons },
      extruded: true,
      filled: true,
      stroked: false,
      wireframe: true,
      getElevation: heightOf,
      getFillColor: colorOf,
      getLineColor: [255, 255, 255, 120],
      pickable: true,
      updateTriggers: { getElevation: [maxHeight, spec.key], getFillColor: [spec.key] },
    }));
  }
  if (points.length) {
    layers.push(new deck.ColumnLayer({
      id: "v3d-points",
      data: points,
      diskResolution: 12,
      radius,
      extruded: true,
      getPosition: d => d.position,
      getElevation: d => heightOf(d.feature),
      getFillColor: d => colorOf(d.feature),
      pickable: true,
      updateTriggers: { getElevation: [maxHeight, spec.key], getFillColor: [spec.key] },
    }));
  }

  deckInstance.setProps({ layers });
  if (fit) fitView(bounds);

  const notes = [spec.note(min, max)];
  if (!useAnalysis && window.GEO.filteredGeoJSON) notes.push("Attribute filter applied.");
  if (skippedLines) notes.push(`${skippedLines.toLocaleString()} line feature(s) not shown.`);
  setNote(notes.filter(Boolean).join(" "));
}

// ── Height / colour specs ──────────────────────────────────────────────────
function datasetSpec() {
  const field = document.getElementById("v3dField").value;
  const symbolised = document.getElementById("symLegend")?.style.display === "block";
  const color = feature => (typeof pointStyleFor === "function" ? pointStyleFor(feature).fillColor : ACCENT_HEX);

  if (!field) {
    return {
      key: "uniform", uniform: true, value: () => 0, color,
      note: () => `Uniform height.${symbolised ? " Colours follow Symbology." : ""}`,
    };
  }
  return {
    key: `field:${field}`,
    value: f => numOrNull(f.properties?.[field]),
    color,
    note: (min, max) =>
      `Height = ${field} (${fmt3d(min)} – ${fmt3d(max)}), measured from the minimum.` +
      (symbolised ? " Colours follow Symbology." : ""),
  };
}

function analysisSpec({ geojson, type }) {
  const ramp = (_, v, min, max) =>
    ANALYSIS_RAMP[Math.min(ANALYSIS_RAMP.length - 1, Math.floor(((v - min) / ((max - min) || 1)) * ANALYSIS_RAMP.length))];

  if (type === "dbscan_clustering") {
    const sizes = {};
    geojson.features.forEach(f => { const c = f.properties?.cluster; sizes[c] = (sizes[c] || 0) + 1; });
    return {
      key: "dbscan",
      value: f => (f.properties?.cluster < 0 ? null : sizes[f.properties?.cluster]),
      color: f => (typeof clusterColor === "function" ? clusterColor(f.properties?.cluster) : ACCENT_HEX),
      note: (min, max) => `Height = cluster size (${min} – ${max} points). Noise points are flat.`,
    };
  }
  if (type === "hotspot_kde") {
    return {
      key: "kde", value: f => numOrNull(f.properties?.intensity), color: ramp,
      note: () => "Height = KDE density (relative).",
    };
  }
  if (type === "nearest_neighbor") {
    return {
      key: "nn", value: f => numOrNull(f.properties?.nn_distance_m), color: ramp,
      note: (min, max) => `Height = distance to nearest neighbour (${fmt3d(min)} – ${fmt3d(max)} m).`,
    };
  }
  return {
    key: `uniform:${type}`, uniform: true, value: () => 0, color: () => ACCENT_HEX,
    note: () => `${ANALYSIS_LABELS[type] || type} result, uniform height.`,
  };
}

// ── Geometry helpers ───────────────────────────────────────────────────────
function splitGeometries(geojson) {
  const points = [];
  const polygons = [];
  let skippedLines = 0;

  geojson.features.forEach(feature => {
    const g = feature.geometry;
    if (!g) return;
    if (g.type === "Point") points.push({ position: g.coordinates, feature });
    else if (g.type === "MultiPoint") g.coordinates.forEach(c => points.push({ position: c, feature }));
    else if (g.type === "Polygon" || g.type === "MultiPolygon") polygons.push(feature);
    else if (g.type === "LineString" || g.type === "MultiLineString") skippedLines++;
    else if (g.type === "GeometryCollection") {
      g.geometries.forEach(sub => splitGeometries({ features: [{ ...feature, geometry: sub }] }).points.forEach(p => points.push(p)));
      g.geometries.filter(s => s.type.endsWith("Polygon")).forEach(s => polygons.push({ ...feature, geometry: s }));
    }
  });
  return { points, polygons, skippedLines };
}

function featureBounds(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = c => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(visit);
  };
  geojson.features.forEach(f => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === "GeometryCollection") g.geometries.forEach(s => visit(s.coordinates));
    else visit(g.coordinates);
  });
  return [[minX, minY], [maxX, maxY]];
}

// Diagonal of the bounding box in metres (haversine)
function extentMetres([[minX, minY], [maxX, maxY]]) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (maxY - minY) * rad, dLon = (maxX - minX) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(minY * rad) * Math.cos(maxY * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function fitView(bounds) {
  const el = document.getElementById("deck3d");
  const width = el.clientWidth || 800;
  const height = el.clientHeight || 600;
  let view = { longitude: bounds[0][0], latitude: bounds[0][1], zoom: 12 };

  const [[minX, minY], [maxX, maxY]] = bounds;
  if (maxX > minX || maxY > minY) {
    try {
      view = new deck.WebMercatorViewport({ width, height }).fitBounds(bounds, { padding: 60 });
    } catch (_) {}
  }
  deckInstance.setProps({
    initialViewState: {
      longitude: view.longitude,
      latitude: view.latitude,
      zoom: Math.min(view.zoom, 16),
      pitch: 45,
      bearing: 0,
      transitionDuration: 600,
    },
  });
}

// ── Tooltip ────────────────────────────────────────────────────────────────
function tooltipFor({ object }) {
  if (!object) return null;
  const props = (object.feature || object).properties || {};
  const rows = Object.entries(props).slice(0, 8)
    .map(([k, v]) => `<div><span style="color:#a8a29c">${escape3d(k)}</span> ${escape3d(v ?? "—")}</div>`)
    .join("");
  return {
    html: rows,
    style: { background: "#ffffff", color: "#1a1714", fontSize: "11px", padding: "8px 10px",
             borderRadius: "6px", boxShadow: "0 4px 12px rgba(26,23,20,0.15)", maxWidth: "260px" },
  };
}

// ── Small helpers ──────────────────────────────────────────────────────────
function setNote(text) {
  document.getElementById("v3dNote").textContent = text;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmt3d(v) {
  const abs = Math.abs(v);
  return v.toLocaleString(undefined, { maximumFractionDigits: abs >= 100 ? 0 : 2 });
}

function escape3d(v) {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hexToRgba(hex, alpha = 220) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function resize3D() {
  if (deckInstance) deckInstance.redraw?.(true);
}

window.init3D = init3D;
window.render3D = render3D;
window.resize3D = resize3D;
