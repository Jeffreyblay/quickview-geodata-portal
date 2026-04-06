/**
 * ingest.js — File upload, drag-and-drop, and URL fetch logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const dropZone   = document.getElementById("dropZone");
  const fileInput  = document.getElementById("fileInput");
  const fetchBtn   = document.getElementById("fetchBtn");
  const urlInput   = document.getElementById("urlInput");
  const fileTypeSelect = document.getElementById("fileTypeSelect");

  // ── Drop Zone ─────────────────────────────────────────────────────────
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  // ── URL Fetch ─────────────────────────────────────────────────────────
  fetchBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    const fileType = fileTypeSelect.value;
    if (!url) { toast("Please enter a URL", "warn"); return; }
    if (!fileType) { toast("Please select a file type from the dropdown", "warn"); return; }
    handleURL(url, fileType);
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchBtn.click();
  });
});

// ── Handle File Upload ─────────────────────────────────────────────────────
async function handleFile(file) {
  const allowed = [".csv", ".geojson", ".json", ".xml", ".zip"];
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!allowed.includes(ext)) {
    toast(`Unsupported file type: ${ext}`, "error");
    return;
  }

  setStatus("loading", `Uploading ${file.name}...`);
  showLoading(`Parsing ${file.name}...`);

  try {
    const formData = new FormData();
    formData.append("file", file);
    const data = await apiPost("/ingest/upload", formData, true);
    handleIngestResponse(data);
    toast(`Loaded ${file.name} — ${data.meta.total_rows} rows`, "success");
  } catch (err) {
    setStatus("error", "Upload failed");
    toast(err.message, "error");
  } finally {
    hideLoading();
  }
}

// ── Handle URL Fetch ───────────────────────────────────────────────────────
async function handleURL(url, fileType) {
  setStatus("loading", "Fetching URL...");
  showLoading("Fetching remote data...");

  try {
    const data = await apiPost("/ingest/fetch", { url, file_type: fileType });
    handleIngestResponse(data);
    toast(`Fetched data — ${data.meta.total_rows} rows`, "success");
  } catch (err) {
    setStatus("error", "Fetch failed");
    toast(err.message, "error");
  } finally {
    hideLoading();
  }
}

// ── Process Ingest Response ────────────────────────────────────────────────
function handleIngestResponse(data) {
  // Store globally
  window.GEO.sessionId    = data.session_id;
  window.GEO.currentGeoJSON = data.geojson;
  window.GEO.currentMeta  = data.meta;
  window.GEO.filteredGeoJSON = null;

  // Render map
  renderPoints(data.geojson);

  // Update meta panel
  updateMetaPanel(data.meta);

  // Update attribute table
  renderTable(data.geojson);

  // Show query section
  document.getElementById("querySection").style.display = "block";

  setStatus("success", `${data.meta.total_rows} features loaded`);
}

// ── Update Dataset Meta Panel ──────────────────────────────────────────────
function updateMetaPanel(meta) {
  document.getElementById("metaRows").textContent = meta.total_rows.toLocaleString();
  document.getElementById("metaCols").textContent = meta.total_columns;
  document.getElementById("metaCRS").textContent  = meta.crs ? meta.crs.split(":").pop() : "WGS84";
  document.getElementById("metaGeom").textContent = meta.geometry_type || (meta.has_geometry ? "Geometry" : "None");

  // Dtype tags
  const dtypeList = document.getElementById("dtypeList");
  dtypeList.innerHTML = Object.entries(meta.dtypes)
    .map(([col, dtype]) => {
      const short = dtype.replace("object", "str").replace("float64", "float").replace("int64", "int");
      return `<span class="dtype-tag">${col}: ${short}</span>`;
    })
    .join("");

  document.getElementById("datasetMeta").style.display = "block";
}

// ── Query / Filter ─────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("queryBtn").addEventListener("click", applyFilter);
  document.getElementById("clearFilterBtn").addEventListener("click", clearFilter);
});

function applyFilter() {
  const expr = document.getElementById("queryInput").value.trim();
  if (!expr || !window.GEO.currentGeoJSON) return;

  try {
    const filtered = filterGeoJSON(window.GEO.currentGeoJSON, expr);
    window.GEO.filteredGeoJSON = filtered;
    renderPoints(filtered);
    renderTable(filtered);
    toast(`Filter applied — ${filtered.features.length} features`, "success");
    setStatus("success", `Filtered: ${filtered.features.length} rows`);
  } catch (err) {
    toast(`Filter error: ${err.message}`, "error");
  }
}

function clearFilter() {
  if (!window.GEO.currentGeoJSON) return;
  window.GEO.filteredGeoJSON = null;
  renderPoints(window.GEO.currentGeoJSON);
  renderTable(window.GEO.currentGeoJSON);
  document.getElementById("queryInput").value = "";
  toast("Filter cleared", "success");
  setStatus("success", `${window.GEO.currentMeta.total_rows} features loaded`);
}

/**
 * Simple expression filter on GeoJSON properties.
 * Supports: col > val, col < val, col == val, col != val,
 *           col >= val, col <= val, col contains "str"
 */
function filterGeoJSON(geojson, expr) {
  // Parse expression
  const ops = [">=", "<=", "!=", ">", "<", "==", "contains"];
  let op = null, key = null, val = null;

  for (const o of ops) {
    if (expr.includes(o)) {
      const parts = expr.split(o).map(s => s.trim());
      op = o; key = parts[0]; val = parts[1];
      break;
    }
  }

  if (!op) throw new Error(`Unsupported expression. Use: col > value, col == "text", col contains "text"`);

  // Strip quotes from string values
  val = val.replace(/^["']|["']$/g, "");
  const numVal = parseFloat(val);
  const isNum = !isNaN(numVal) && val !== "";

  const features = geojson.features.filter(f => {
    const prop = f.properties?.[key];
    if (prop === undefined || prop === null) return false;
    const propNum = parseFloat(prop);

    switch (op) {
      case ">":        return isNum ? propNum > numVal : String(prop) > val;
      case "<":        return isNum ? propNum < numVal : String(prop) < val;
      case ">=":       return isNum ? propNum >= numVal : String(prop) >= val;
      case "<=":       return isNum ? propNum <= numVal : String(prop) <= val;
      case "==":       return String(prop) === val || (isNum && propNum === numVal);
      case "!=":       return String(prop) !== val && (!isNum || propNum !== numVal);
      case "contains": return String(prop).toLowerCase().includes(val.toLowerCase());
      default:         return true;
    }
  });

  return { type: "FeatureCollection", features };
}
