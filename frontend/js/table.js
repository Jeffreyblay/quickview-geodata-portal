/**
 * table.js — Attribute table rendering, search, sort, export, map linking
 * Coords embedded directly on each row — no lookup needed
 */

let tableData   = [];
let sortCol     = null;
let sortAsc     = true;
let selectedRow = null;

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("tableToggle").addEventListener("click", () => {
    document.getElementById("tablePanel").classList.toggle("collapsed");
  });

  document.getElementById("tableSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    if (!q) { renderTableRows(tableData); return; }
    const filtered = tableData.filter(row =>
      Object.values(row.props).some(v => String(v ?? "").toLowerCase().includes(q))
    );
    renderTableRows(filtered);
  });

  document.getElementById("exportBtn").addEventListener("click", exportGeoJSON);

  // Row click — event delegation on tableBody
  document.getElementById("tableBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr.table-row");
    if (!tr) return;

    if (selectedRow) selectedRow.classList.remove("row-selected");
    tr.classList.add("row-selected");
    selectedRow = tr;

    const lat = parseFloat(tr.dataset.lat);
    const lng = parseFloat(tr.dataset.lng);

    if (isNaN(lat) || isNaN(lng)) {
      toast("No coordinates for this feature", "warn");
      return;
    }

    let props = {};
    try { props = JSON.parse(tr.dataset.props || "{}"); } catch(_) {}

    zoomToPoint(lat, lng, props);
  });

});

// ── Render Table ───────────────────────────────────────────────────────────
function renderTable(geojson) {
  if (!geojson?.features?.length) {
    document.getElementById("tableBody").innerHTML =
      '<div class="table-empty">No features to display.</div>';
    document.getElementById("tableCount").textContent = "";
    return;
  }

  tableData = geojson.features.slice(0, 500).map(f => {
    const geom = f.geometry;
    let lat = null, lng = null;

    if (geom?.type === "Point" && geom.coordinates?.length >= 2) {
      lng = geom.coordinates[0];
      lat = geom.coordinates[1];
    } else if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon"
                     || geom.type === "LineString" || geom.type === "MultiLineString")) {
      try {
        const center = L.geoJSON(f).getBounds().getCenter();
        lat = center.lat; lng = center.lng;
      } catch(_) {}
    }

    return { props: f.properties || {}, lat, lng };
  });

  document.getElementById("tableCount").textContent =
    `${tableData.length.toLocaleString()} rows`;

  renderTableRows(tableData);
}

function renderTableRows(rows) {
  const container = document.getElementById("tableBody");
  if (!rows.length) {
    container.innerHTML = '<div class="table-empty">No matching rows.</div>';
    return;
  }

  const cols = Object.keys(rows[0].props);
  const displayRows = rows.slice(0, 200);

  const headerCells = cols.map(col => {
    const arrow = sortCol === col ? (sortAsc ? " ▲" : " ▼") : "";
    return `<th data-col="${col}">${col}${arrow}</th>`;
  }).join("");

  const bodyRows = displayRows.map(row => {
    const cells = cols.map(col => {
      const val = row.props[col] ?? "";
      return `<td title="${val}">${val}</td>`;
    }).join("");

    // Embed coords and first 8 props directly on the row
    const lat  = row.lat ?? "";
    const lng  = row.lng ?? "";
    const propsJson = JSON.stringify(
      Object.fromEntries(Object.entries(row.props).slice(0, 8))
    ).replace(/"/g, "&quot;");

    return `<tr class="table-row" data-lat="${lat}" data-lng="${lng}" data-props="${propsJson}">${cells}</tr>`;
  }).join("");

  const totalNote = rows.length > 200
    ? `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--text-hint);font-size:11px;padding:10px;font-style:italic">Showing 200 of ${rows.length} rows</td></tr>`
    : "";

  container.innerHTML = `
    <table class="attr-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}${totalNote}</tbody>
    </table>`;

  // Sort on header click
  container.querySelectorAll("th[data-col]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      sortCol === col ? (sortAsc = !sortAsc) : (sortCol = col, sortAsc = true);
      const sorted = [...rows].sort((a, b) => {
        const av = a.props[col], bv = b.props[col];
        const an = parseFloat(av), bn = parseFloat(bv);
        const useNum = !isNaN(an) && !isNaN(bn);
        const cmp = useNum ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
        return sortAsc ? cmp : -cmp;
      });
      renderTableRows(sorted);
    });
  });
}

// ── Zoom to Point ──────────────────────────────────────────────────────────
function zoomToPoint(lat, lng, props) {
  if (!window.map) { toast("Map not ready", "warn"); return; }

  const doFly = () => {
    window.map.flyTo([lat, lng], 14, { duration: 0.8 });

    const rows = Object.entries(props)
      .map(([k, v]) => `<tr>
        <td style="color:var(--text-muted);padding:2px 10px 2px 0;font-size:11px;white-space:nowrap">${k}</td>
        <td style="color:var(--text-primary);font-size:11px">${v ?? "—"}</td>
      </tr>`).join("");

    L.popup({ closeButton: true, maxWidth: 280 })
      .setLatLng([lat, lng])
      .setContent(`<table style="border-collapse:collapse">${rows}</table>`)
      .openOn(window.map);
  };

  // If not on map view, switch first then fly
  const mapBtn = document.querySelector('.nav-btn[data-view="map"]');
  if (mapBtn && !mapBtn.classList.contains("active")) {
    mapBtn.click();
    setTimeout(doFly, 350);
  } else {
    doFly();
  }
}

// ── Export ─────────────────────────────────────────────────────────────────
function exportGeoJSON() {
  const geojson = window.GEO.filteredGeoJSON || window.GEO.currentGeoJSON;
  if (!geojson) { toast("No data to export", "warn"); return; }

  const format = document.getElementById("exportFormat").value;

  if (format === "geojson") {
    _download(JSON.stringify(geojson, null, 2), "geodata_export.geojson", "application/json");

  } else if (format === "csv") {
    const rows = geojson.features.map(f => f.properties || {});
    if (!rows.length) { toast("No data to export", "warn"); return; }
    const cols = Object.keys(rows[0]);
    const hasPts = geojson.features[0]?.geometry?.type === "Point";
    const allCols = hasPts ? [...cols, "longitude", "latitude"] : cols;
    const header = allCols.join(",");
    const body = geojson.features.map(f => {
      const vals = cols.map(c => {
        const v = f.properties?.[c] ?? "";
        return String(v).includes(",") ? `"${v}"` : v;
      });
      if (hasPts && f.geometry?.coordinates) {
        vals.push(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      }
      return vals.join(",");
    }).join("\n");
    _download(`${header}\n${body}`, "geodata_export.csv", "text/csv");

  } else if (format === "json") {
    const rows = geojson.features.map(f => {
      const props = { ...f.properties } || {};
      if (f.geometry?.type === "Point" && f.geometry?.coordinates) {
        props.longitude = f.geometry.coordinates[0];
        props.latitude  = f.geometry.coordinates[1];
      }
      return props;
    });
    _download(JSON.stringify(rows, null, 2), "geodata_export.json", "application/json");
  }

  toast(`Exported as ${format.toUpperCase()}`, "success");
}

function _download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
