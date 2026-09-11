/**
 * map.js — Leaflet map initialisation and layer management
 */

let map, basePointLayer, analysisLayer, heatLayer, currentTileLayer;
let currentBasemap = null;

// Esri basemaps label places in English / Latin script.
// OpenStreetMap-based styles label them in the local language (e.g. Arabic in North Africa).
// CARTO basemaps are not used: they now require an API key and watermark keyless tiles.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR = "Tiles © Esri";

const BASEMAPS = {
  esriStreet: {
    group: "Street",
    label: "Esri Streets",
    url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_ATTR} — HERE, Garmin, USGS, NGA, EPA, NPS`,
    maxNativeZoom: 19,
  },
  osm: {
    group: "Street",
    label: "OpenStreetMap (local names)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxNativeZoom: 19,
  },
  hybrid: {
    group: "Imagery",
    label: "Satellite + labels",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    overlays: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
    attribution: `${ESRI_ATTR} — Maxar, Earthstar Geographics`,
    maxNativeZoom: 19,
  },
  satellite: {
    group: "Imagery",
    label: "Satellite",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_ATTR} — Maxar, Earthstar Geographics`,
    maxNativeZoom: 19,
  },
  esriTopo: {
    group: "Terrain",
    label: "Esri Topographic",
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: `${ESRI_ATTR} — USGS, NOAA`,
    maxNativeZoom: 19,
  },
  terrain: {
    group: "Terrain",
    label: "Shaded relief",
    url: `${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`,
    overlays: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
    attribution: `${ESRI_ATTR} — USGS`,
    maxNativeZoom: 13,
  },
  openTopo: {
    group: "Terrain",
    label: "OpenTopoMap (local names)",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
    maxNativeZoom: 17,
  },
  gray: {
    group: "Minimal",
    label: "Light gray",
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlays: [`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: ESRI_ATTR,
    maxNativeZoom: 16,
  },
  darkGray: {
    group: "Minimal",
    label: "Dark gray",
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlays: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: ESRI_ATTR,
    maxNativeZoom: 16,
  },
};

const DEFAULT_BASEMAP = "esriStreet";
const BASEMAP_STORAGE_KEY = "quickview.basemap";

function initMap() {
  map = L.map("map", {
    center: [20, 0],
    zoom: 3,
    zoomControl: true,
    preferCanvas: true,
  });
  window.map = map;

  buildBasemapMenu();

  let saved = null;
  try { saved = localStorage.getItem(BASEMAP_STORAGE_KEY); } catch (_) {}
  switchBasemap(BASEMAPS[saved] ? saved : DEFAULT_BASEMAP);
}

function buildBasemapMenu() {
  const menu = document.getElementById("basemapMenu");
  const groups = {};
  Object.entries(BASEMAPS).forEach(([key, def]) => {
    (groups[def.group] = groups[def.group] || []).push(
      `<div class="basemap-option" data-basemap="${key}">${def.label}</div>`
    );
  });
  menu.innerHTML = Object.entries(groups)
    .map(([group, opts]) => `<div class="basemap-group">${group}</div>${opts.join("")}`)
    .join("");
}

function switchBasemap(name) {
  const def = BASEMAPS[name];
  if (!def || !map) return;

  if (currentTileLayer) map.removeLayer(currentTileLayer);

  const tileOpts = { maxZoom: 20, maxNativeZoom: def.maxNativeZoom || 19 };
  const layers = [L.tileLayer(def.url, { ...tileOpts, attribution: def.attribution })];
  (def.overlays || []).forEach(url => layers.push(L.tileLayer(url, tileOpts)));

  // Tile layers live in the tile pane, so data layers always draw on top
  currentTileLayer = L.layerGroup(layers).addTo(map);
  currentBasemap = name;

  try { localStorage.setItem(BASEMAP_STORAGE_KEY, name); } catch (_) {}

  document.querySelectorAll(".basemap-option").forEach(opt => {
    opt.classList.toggle("active", opt.dataset.basemap === name);
  });
}

// ── Point Layer ───────────────────────────────────────────────────────────
const DEFAULT_POINT_STYLE = {
  radius: 5,
  fillColor: "#c25b2e",
  color: "#ffffff",
  weight: 1,
  fillOpacity: 0.8,
};

// Set by symbology.js; returns a style object for a feature (null = default)
let pointStyleFn = null;

function pointStyleFor(feature) {
  return { ...DEFAULT_POINT_STYLE, ...(pointStyleFn ? pointStyleFn(feature) : {}) };
}

function setPointStyle(fn) {
  pointStyleFn = fn;
  if (!basePointLayer) return;
  basePointLayer.eachLayer(layer => {
    const style = pointStyleFor(layer.feature);
    if (layer.setRadius) layer.setRadius(style.radius);
    layer.setStyle(style);
  });
}

function renderPoints(geojson, { fit = true } = {}) {
  if (basePointLayer) basePointLayer.remove();

  basePointLayer = L.geoJSON(geojson, {
    style: feature => pointStyleFor(feature),   // lines / polygons
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, pointStyleFor(feature)),
    onEachFeature: (feature, layer) => {
      if (feature.properties) {
        const props = feature.properties;
        const rows = Object.entries(props)
          .slice(0, 8)
          .map(([k, v]) => `<tr><td style="color:#a8a29c;padding:2px 10px 2px 0;font-size:11px">${k}</td><td style="color:#1a1714;font-size:11px">${v ?? "—"}</td></tr>`)
          .join("");
        layer.bindPopup(`<table>${rows}</table>`, { maxWidth: 260 });
      }
    },
  }).addTo(map);

  if (fit) fitToData();
}

// ── Analysis Layers ───────────────────────────────────────────────────────
function renderAnalysisLayer(geojson, analysisType) {
  clearAnalysisLayers();

  if (analysisType === "hotspot_kde") {
    const pts = geojson.features.map(f => {
      const [lng, lat] = f.geometry.coordinates;
      return [lat, lng, f.properties.intensity];
    });
    heatLayer = L.heatLayer(pts, {
      radius: 25,
      blur: 20,
      gradient: { 0.2: "#fde8df", 0.5: "#c25b2e", 1.0: "#6b2010" },
    }).addTo(map);
    updateLegend("hotspot_kde");
    return;
  }

  if (analysisType === "dbscan_clustering") {
    const clusterIds = [...new Set(
      geojson.features.map(f => f.properties.cluster)
    )].sort((a, b) => a - b);

    analysisLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 6,
          fillColor: clusterColor(feature.properties.cluster),
          color: "#0d0f12",
          weight: 1,
          fillOpacity: 0.85,
        }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
          `<b style="color:#c25b2e">${feature.properties.cluster_label}</b>`,
          { maxWidth: 160 }
        );
      },
    }).addTo(map);

    // Build legend
    const items = clusterIds.map(id => ({
      color: clusterColor(id),
      label: id < 0 ? "Noise" : `Cluster ${id}`,
    }));
    updateLegend("dbscan_clustering", items);
    return;
  }

  // Buffer, Nearest Neighbor — polygon/point layers
  const styleMap = {
    buffer:           { color: "#c25b2e", fillColor: "#c25b2e", fillOpacity: 0.08, weight: 1.5, dashArray: "4 3" },
    nearest_neighbor: { color: "#c25b2e", fillColor: "#c25b2e", fillOpacity: 0.6, weight: 1 },
  };

  const style = styleMap[analysisType] || { color: "#7c6dfa", fillColor: "#7c6dfa", fillOpacity: 0.1, weight: 2 };

  analysisLayer = L.geoJSON(geojson, {
    style,
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        fillColor: style.color,
        color: "#0d0f12",
        weight: 1,
        fillOpacity: 0.8,
      }),
    onEachFeature: (feature, layer) => {
      if (feature.properties?.nn_distance_m != null) {
        layer.bindPopup(`NN dist: <b>${feature.properties.nn_distance_m.toFixed(1)}m</b>`);
      }
    },
  }).addTo(map);

  updateLegend(analysisType);
}

function clearAnalysisLayers() {
  if (analysisLayer) { analysisLayer.remove(); analysisLayer = null; }
  if (heatLayer)     { heatLayer.remove();     heatLayer = null; }
  hideLegend();
}

// ── Fit / Zoom ─────────────────────────────────────────────────────────────
function fitToData() {
  if (basePointLayer) {
    try {
      map.fitBounds(basePointLayer.getBounds(), { padding: [30, 30] });
    } catch (_) {}
  }
}

// ── Legend ─────────────────────────────────────────────────────────────────
function updateLegend(type, items = null) {
  const legend = document.getElementById("mapLegend");
  const title = document.getElementById("legendTitle");
  const itemsEl = document.getElementById("legendItems");

  const titles = {
    buffer:           "Buffer",
    hotspot_kde:      "KDE Density",
    dbscan_clustering:"DBSCAN Clusters",
    nearest_neighbor: "NN Distance",
  };

  title.textContent = titles[type] || type;
  itemsEl.innerHTML = "";

  if (items) {
    items.forEach(({ color, label }) => {
      itemsEl.innerHTML += `
        <div class="legend-item">
          <div class="legend-swatch" style="background:${color}"></div>
          <span>${label}</span>
        </div>`;
    });
  } else {
    const colorMap = {
      buffer:      "#c25b2e",
      hotspot_kde: "gradient",
    };
    const c = colorMap[type] || "#7c6dfa";
    if (c === "gradient") {
      itemsEl.innerHTML = `
        <div style="width:100%;height:10px;border-radius:3px;background:linear-gradient(90deg,#fde8df,#c25b2e,#6b2010);margin-bottom:4px"></div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#a8a29c">
          <span>Low</span><span>High</span>
        </div>`;
    } else {
      itemsEl.innerHTML = `
        <div class="legend-item">
          <div class="legend-swatch" style="background:${c};opacity:0.7"></div>
          <span>${titles[type] || type}</span>
        </div>`;
    }
  }

  legend.style.display = "block";
}

function hideLegend() {
  document.getElementById("mapLegend").style.display = "none";
}

// ── Controls ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initMap();

  document.getElementById("fitBoundsBtn").addEventListener("click", fitToData);
  document.getElementById("clearLayersBtn").addEventListener("click", () => {
    clearAnalysisLayers();
    toast("Analysis layers cleared", "success");
  });

  // ── Basemap switcher — use event delegation on document ────────────────
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("#basemapToggle");
    const option = e.target.closest(".basemap-option");
    const menu   = document.getElementById("basemapMenu");

    if (toggle) {
      e.stopPropagation();
      menu.style.display = menu.style.display === "block" ? "none" : "block";
      return;
    }

    if (option) {
      switchBasemap(option.dataset.basemap);
      menu.style.display = "none";
      return;
    }

    // Click outside — close menu
    if (!e.target.closest("#basemapSwitcher")) {
      menu.style.display = "none";
    }
  });
});
