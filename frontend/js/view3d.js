/**
 * view3d.js — deck.gl 3D extrusion view of the most recent analysis result
 */

let deckInstance = null;
let last3DGeoJSON = null;
let last3DType = null;
let hasInteracted = false;

// ── Elevation accessor per analysis type ────────────────────────────────
function elevationAccessor(analysisType) {
  switch (analysisType) {
    case "hotspot_kde":
      return (f) => (f.properties?.intensity || 0) * 200000;
    case "dbscan_clustering":
      return (f) => {
        const size = clusterSizeLookup?.[f.properties?.cluster] || 1;
        return f.properties?.cluster < 0 ? 0 : size * 800;
      };
    case "nearest_neighbor":
      return (f) => (f.properties?.nn_distance_m || 0);
    case "buffer":
      return () => 300;
    default:
      return () => 200;
  }
}

let clusterSizeLookup = null;

function computeClusterSizes(geojson) {
  const counts = {};
  geojson.features.forEach(f => {
    const c = f.properties?.cluster;
    counts[c] = (counts[c] || 0) + 1;
  });
  return counts;
}

// ── Init ─────────────────────────────────────────────────────────────────
function init3D() {
  if (deckInstance) {
    if (last3DGeoJSON) render3D(last3DGeoJSON, last3DType);
    return;
  }
  if (!window.deck) {
    toast("3D library failed to load", "error");
    return;
  }

  const { Deck, TileLayer, BitmapLayer, GeoJsonLayer } = deck;

  const basemapLayer = new TileLayer({
    id: "basemap-tiles",
    data: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      const { bbox } = props.tile;
      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
      });
    },
  });

  deckInstance = new Deck({
    canvas: (() => {
      const c = document.createElement("canvas");
      document.getElementById("deck3d").appendChild(c);
      c.style.width = "100%";
      c.style.height = "100%";
      return c;
    })(),
    initialViewState: {
      longitude: 0, latitude: 20, zoom: 2, pitch: 45, bearing: 0,
    },
    controller: true,
    layers: [basemapLayer],
    onDragStart: () => { hasInteracted = true; },
    onViewStateChange: () => { hasInteracted = true; },
  });

  if (last3DGeoJSON) render3D(last3DGeoJSON, last3DType);
}

// ── Render ───────────────────────────────────────────────────────────────
function render3D(geojson, analysisType) {
  last3DGeoJSON = geojson;
  last3DType = analysisType;

  const hint = document.getElementById("deck3dHint");
  if (!geojson || !geojson.features || !geojson.features.length) {
    if (hint) hint.style.display = "block";
    return;
  }
  if (!deckInstance) return; // will render on next init3D()/tab switch
  if (hint) hint.style.display = "none";

  if (analysisType === "dbscan_clustering") {
    clusterSizeLookup = computeClusterSizes(geojson);
  }

  const { TileLayer, BitmapLayer, GeoJsonLayer } = deck;
  const basemapLayer = deckInstance.props.layers[0];

  const getElevation = elevationAccessor(analysisType);
  const getColor = (f) => {
    if (analysisType === "dbscan_clustering") {
      const hex = (typeof clusterColor === "function") ? clusterColor(f.properties?.cluster) : "#c25b2e";
      return hexToRgb(hex);
    }
    return [194, 91, 46, 200];
  };

  const dataLayer = new GeoJsonLayer({
    id: "analysis-3d",
    data: geojson,
    extruded: true,
    filled: true,
    stroked: false,
    pointType: "circle",
    getElevation,
    elevationScale: 1,
    getFillColor: getColor,
    getPointRadius: 40,
    pointRadiusUnits: "meters",
    getLineColor: [30, 30, 30],
    pickable: true,
  });

  deckInstance.setProps({ layers: [basemapLayer, dataLayer] });

  // Center the initial view on the data (only takes effect if the user
  // hasn't already interacted with the camera — deck.gl ignores
  // initialViewState updates after the first interaction).
  try {
    const coords = geojson.features
      .map(f => f.geometry?.coordinates)
      .filter(c => Array.isArray(c) && c.length >= 2 && typeof c[0] === "number");
    if (coords.length && !hasInteracted) {
      const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      deckInstance.setProps({
        initialViewState: { longitude: lng, latitude: lat, zoom: 10, pitch: 45, bearing: 0 },
      });
    }
  } catch (_) {}
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  const bigint = parseInt(m, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 200];
}

function resize3D() {
  if (deckInstance) deckInstance.redraw?.(true);
}

window.init3D = init3D;
window.render3D = render3D;
window.resize3D = resize3D;
