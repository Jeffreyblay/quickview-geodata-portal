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

  // Reset filter builder and symbology for the new columns
  initFilterUI(data.meta);
  initSymbologyUI(data.meta);

  setStatus("success", `${data.meta.total_rows} features loaded`);
}

// ── Update Dataset Meta Panel ──────────────────────────────────────────────
function updateMetaPanel(meta) {
  document.getElementById("metaRows").textContent = meta.total_rows.toLocaleString();
  document.getElementById("metaCols").textContent = meta.total_columns;
  document.getElementById("metaCRS").textContent  = meta.crs ? meta.crs.split(":").pop() : "WGS84";
  document.getElementById("metaGeom").textContent = meta.geometry_type || (meta.has_geometry ? "Geometry" : "None");

  document.getElementById("datasetMeta").style.display = "block";
}
