/**
 * app.js — Global state, config, utilities
 */

// ── Config ────────────────────────────────────────────────────────────────
window.GEO = {
  // Change this to your backend URL in production
  // For local dev: http://localhost:8000
  API_BASE: "https://github.com/Jeffreyblay/quickview-geodata-portal",

  // Current session state
  sessionId: null,
  currentGeoJSON: null,
  currentMeta: null,
  filteredGeoJSON: null,
};

// ── Status Bar ────────────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot = document.querySelector(".status-dot");
  const txt = document.getElementById("statusText");
  dot.className = `status-dot ${state}`;
  txt.textContent = text;
}

// ── Loading Overlay ───────────────────────────────────────────────────────
let loadingOverlay = null;

function showLoading(text = "Processing...") {
  if (loadingOverlay) return;
  loadingOverlay = document.createElement("div");
  loadingOverlay.className = "loading-overlay";
  loadingOverlay.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">${text}</div>
  `;
  document.body.appendChild(loadingOverlay);
}

function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.remove();
    loadingOverlay = null;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(message, type = "success", duration = 3500) {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── API Helper ────────────────────────────────────────────────────────────
async function apiPost(endpoint, body, isFormData = false) {
  const url = `${window.GEO.API_BASE}${endpoint}`;
  const opts = {
    method: "POST",
    body: isFormData ? body : JSON.stringify(body),
  };
  if (!isFormData) opts.headers = { "Content-Type": "application/json" };

  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Cluster Colors ────────────────────────────────────────────────────────
const CLUSTER_COLORS = [
  "#c25b2e", "#2e7c8f", "#6b4fa8", "#2e8c52",
  "#8c4a2e", "#2e5b8c", "#a84f6b", "#5b8c2e",
  "#8c7a2e", "#4f6ba8"
];

function clusterColor(id) {
  if (id < 0) return "#4a5268"; // noise
  return CLUSTER_COLORS[id % CLUSTER_COLORS.length];
}

// ── DOM Ready ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setStatus("idle", "Ready");
  initNavSwitcher();
});

// ── Nav View Switcher ─────────────────────────────────────────────────────
function initNavSwitcher() {
  const btns = document.querySelectorAll(".nav-btn");
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      switchView(btn.dataset.view);
    });
  });
}

function switchView(view) {
  const leftPanel   = document.querySelector(".panel-left");
  const rightPanel  = document.querySelector(".panel-right");
  const mapContainer = document.querySelector(".map-container");
  const tablePanel  = document.getElementById("tablePanel");
  const layout      = document.querySelector(".app-layout");

  // Reset all
  leftPanel.style.display  = "";
  rightPanel.style.display = "";
  tablePanel.classList.remove("table-fullscreen");
  layout.style.gridTemplateColumns = "";

  if (view === "map") {
    // Default — left + map + right
    layout.style.gridTemplateColumns = "var(--panel-w) 1fr var(--panel-w)";

  } else if (view === "analysis") {
    // Hide left panel — map gets more space
    leftPanel.style.display = "none";
    layout.style.gridTemplateColumns = "1fr var(--panel-w)";

  } else if (view === "table") {
    // Hide both side panels, expand table
    leftPanel.style.display  = "none";
    rightPanel.style.display = "none";
    layout.style.gridTemplateColumns = "1fr";
    tablePanel.classList.add("table-fullscreen");
    // Expand the table panel
    tablePanel.classList.remove("collapsed");
  }

  // Invalidate Leaflet map size after layout change
  setTimeout(() => {
    if (window.map) window.map.invalidateSize();
  }, 50);
}
