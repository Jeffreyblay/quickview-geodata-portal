/**
 * analysis.js — Analysis card interactions, API calls, result rendering
 */

document.addEventListener("DOMContentLoaded", () => {

  // ── Tab switching ────────────────────────────────────────────────────
  document.querySelectorAll(".atab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".atab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ── Card accordion ───────────────────────────────────────────────────
  document.querySelectorAll(".card-header[data-toggle]").forEach(header => {
    header.addEventListener("click", () => {
      const body = header.nextElementSibling;
      const chevron = header.querySelector(".card-chevron");
      const isOpen = body.classList.contains("open");

      // Close all
      document.querySelectorAll(".card-body").forEach(b => b.classList.remove("open"));
      document.querySelectorAll(".card-chevron").forEach(c => c.style.transform = "");

      if (!isOpen) {
        body.classList.add("open");
        if (chevron) chevron.style.transform = "rotate(180deg)";
      }
    });
  });

  // ── Run buttons ──────────────────────────────────────────────────────
  document.querySelectorAll(".run-btn").forEach(btn => {
    btn.addEventListener("click", () => runAnalysis(btn.dataset.analysis));
  });

});

// ── Run Analysis ───────────────────────────────────────────────────────────
async function runAnalysis(type) {
  if (!window.GEO.sessionId) {
    toast("Please load a dataset first.", "warn");
    return;
  }

  setStatus("loading", `Running ${type}...`);
  showLoading(`Running ${formatAnalysisName(type)}...`);

  try {
    const body = buildRequestBody(type);
    const data = await apiPost(`/analysis/${type}`, body);
    handleAnalysisResult(data);
    toast(`${formatAnalysisName(type)} complete`, "success");
    setStatus("success", `${formatAnalysisName(type)} complete`);
  } catch (err) {
    setStatus("error", "Analysis failed");
    toast(`Error: ${err.message}`, "error");
  } finally {
    hideLoading();
  }
}

// ── Build Request Body per Analysis Type ──────────────────────────────────
function buildRequestBody(type) {
  const id = window.GEO.sessionId;
  switch (type) {
    case "buffer":
      return { session_id: id, radius_m: parseFloat(document.getElementById("bufferRadius").value) || 500 };
    case "hotspot":
      return { session_id: id, grid_size: parseInt(document.getElementById("hotspotGrid").value) || 100 };
    case "dbscan":
      return {
        session_id: id,
        epsilon_m: parseFloat(document.getElementById("dbscanEps").value) || 500,
        min_samples: parseInt(document.getElementById("dbscanMin").value) || 5,
      };
    case "nearest-neighbor":
      return { session_id: id };
    case "attribute-stats":
      return { session_id: id, columns: null };
    default:
      return { session_id: id };
  }
}

// ── Handle Analysis Result ─────────────────────────────────────────────────
function handleAnalysisResult(data) {
  // Render geometry on map if present
  if (data.geojson) {
    renderAnalysisLayer(data.geojson, data.analysis_type);
  }

  // Render 3D extrusion of the same result (no-op if 3D tab hasn't been opened yet)
  if (window.render3D) {
    window.render3D(data.geojson, data.analysis_type);
  }

  // Show results panel
  const panel = document.getElementById("resultsPanel");
  const summary = document.getElementById("resultSummary");
  const statsEl = document.getElementById("resultStats");

  summary.textContent = data.summary || "";
  statsEl.innerHTML = "";

  renderResultChart(data);

  if (data.stats) {
    renderStatsTable(data.stats, data.analysis_type, statsEl);
  }

  panel.style.display = "block";

  // Scroll results into view
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Result Chart ─────────────────────────────────────────────────────────
let resultChart = null;

function renderResultChart(data) {
  const wrap = document.getElementById("chartWrap");
  const canvas = document.getElementById("resultChart");

  if (resultChart) {
    resultChart.destroy();
    resultChart = null;
  }

  if (!window.Chart) {
    wrap.style.display = "none";
    return;
  }

  let config = null;

  if (data.analysis_type === "attribute_stats" && data.stats) {
    const cols = Object.keys(data.stats);
    config = {
      type: "bar",
      data: {
        labels: cols,
        datasets: [
          { label: "Mean", data: cols.map(c => data.stats[c].mean), backgroundColor: "#c25b2e" },
          { label: "Min",  data: cols.map(c => data.stats[c].min),  backgroundColor: "#a8a29c" },
          { label: "Max",  data: cols.map(c => data.stats[c].max),  backgroundColor: "#2e7c8f" },
        ],
      },
      options: chartOptions("Attribute Statistics"),
    };
  } else if (data.analysis_type === "dbscan_clustering" && data.geojson) {
    const counts = {};
    data.geojson.features.forEach(f => {
      const c = f.properties?.cluster;
      counts[c] = (counts[c] || 0) + 1;
    });
    const clusterIds = Object.keys(counts).map(Number).sort((a, b) => a - b);
    config = {
      type: "bar",
      data: {
        labels: clusterIds.map(id => id < 0 ? "Noise" : `Cluster ${id}`),
        datasets: [{
          label: "Points",
          data: clusterIds.map(id => counts[id]),
          backgroundColor: clusterIds.map(id => clusterColor(id)),
        }],
      },
      options: chartOptions("Cluster Sizes"),
    };
  }

  if (!config) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "block";
  resultChart = new Chart(canvas, config);
}

function chartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, labels: { font: { size: 10 }, color: "#a8a29c" } },
      title: { display: false },
    },
    scales: {
      x: { ticks: { font: { size: 9 }, color: "#a8a29c" }, grid: { display: false } },
      y: { ticks: { font: { size: 9 }, color: "#a8a29c" }, grid: { color: "rgba(168,162,156,0.15)" } },
    },
  };
}

// ── Render Stats ──────────────────────────────────────────────────────────
function renderStatsTable(stats, type, container) {
  if (type === "attribute_stats") {
    // Nested per-column stats
    Object.entries(stats).forEach(([col, colStats]) => {
      const header = document.createElement("div");
      header.style.cssText = "font-family:'Space Mono',monospace;font-size:10px;color:#3dffc0;letter-spacing:0.1em;text-transform:uppercase;padding:8px 0 4px;";
      header.textContent = col;
      container.appendChild(header);

      Object.entries(colStats).forEach(([k, v]) => {
        container.appendChild(makeStatRow(k, v));
      });
    });
    return;
  }

  // Flat stats
  Object.entries(stats).forEach(([k, v]) => {
    if (typeof v === "object") return; // skip nested
    container.appendChild(makeStatRow(k, v));
  });
}

function makeStatRow(key, value) {
  const row = document.createElement("div");
  row.className = "stat-row";
  const displayVal = typeof value === "number"
    ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4))
    : value;
  row.innerHTML = `
    <span class="stat-key">${key.replace(/_/g, " ")}</span>
    <span class="stat-val">${displayVal}</span>
  `;
  return row;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatAnalysisName(type) {
  const names = {
    "buffer":           "Buffer",
    "hotspot":          "KDE Hotspot",
    "dbscan":           "DBSCAN",
    "nearest-neighbor": "Nearest Neighbor",
    "attribute-stats":  "Attribute Stats",
  };
  return names[type] || type;
}
