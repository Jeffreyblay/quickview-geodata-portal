/**
 * filter.js — Attribute filter builder (field / operator / value conditions)
 *
 * The filter runs client-side on the loaded GeoJSON. The ids of the matching
 * features are sent with every analysis request, so analyses run on the
 * filtered subset (see filteredFeatureIds in analysis.js).
 */

const NUMERIC_OPS = [
  ["eq", "="], ["ne", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"],
  ["between", "between"], ["empty", "is empty"], ["notempty", "is not empty"],
];

const TEXT_OPS = [
  ["eq", "equals"], ["ne", "does not equal"], ["contains", "contains"],
  ["notcontains", "does not contain"], ["starts", "starts with"],
  ["empty", "is empty"], ["notempty", "is not empty"],
];

const NO_VALUE_OPS = new Set(["empty", "notempty"]);
const MAX_SUGGESTIONS = 200;

let filterFields = {};   // column -> "number" | "text"

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("addConditionBtn").addEventListener("click", () => addCondition());
  document.getElementById("queryBtn").addEventListener("click", applyFilter);
  document.getElementById("clearFilterBtn").addEventListener("click", clearFilter);

  // Enter in any value box applies the filter
  document.getElementById("filterConditions").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input")) applyFilter();
  });
});

// Called by ingest.js after a dataset loads
function initFilterUI(meta) {
  filterFields = {};
  meta.columns.forEach(col => {
    const dtype = meta.dtypes[col] || "";
    filterFields[col] = /int|float|double|decimal/.test(dtype) ? "number" : "text";
  });

  document.getElementById("filterConditions").innerHTML = "";
  document.getElementById("filterStatus").textContent = "";
  addCondition();
  document.getElementById("querySection").style.display = "block";
}

// ── Condition rows ─────────────────────────────────────────────────────────
function addCondition() {
  const container = document.getElementById("filterConditions");
  const row = document.createElement("div");
  row.className = "filter-cond";

  const fieldSel = document.createElement("select");
  fieldSel.className = "text-input cond-field";
  Object.keys(filterFields).forEach(col => fieldSel.add(new Option(col, col)));

  const opSel = document.createElement("select");
  opSel.className = "text-input cond-op";

  const valueWrap = document.createElement("div");
  valueWrap.className = "cond-values";

  const removeBtn = document.createElement("button");
  removeBtn.className = "cond-remove";
  removeBtn.title = "Remove condition";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => {
    row.remove();
    updateCombinatorVisibility();
  });

  const top = document.createElement("div");
  top.className = "cond-top";
  top.append(fieldSel, removeBtn);

  const bottom = document.createElement("div");
  bottom.className = "cond-bottom";
  bottom.append(opSel, valueWrap);

  row.append(top, bottom);
  container.appendChild(row);

  fieldSel.addEventListener("change", () => refreshOperators(row));
  opSel.addEventListener("change", () => refreshValueInputs(row));
  refreshOperators(row);
  updateCombinatorVisibility();
}

function updateCombinatorVisibility() {
  const count = document.querySelectorAll("#filterConditions .filter-cond").length;
  document.getElementById("filterMatchRow").style.display = count > 1 ? "" : "none";
}

function refreshOperators(row) {
  const field = row.querySelector(".cond-field").value;
  const opSel = row.querySelector(".cond-op");
  const ops = filterFields[field] === "number" ? NUMERIC_OPS : TEXT_OPS;
  opSel.innerHTML = "";
  ops.forEach(([value, label]) => opSel.add(new Option(label, value)));
  refreshValueInputs(row);
}

function refreshValueInputs(row) {
  const field = row.querySelector(".cond-field").value;
  const op = row.querySelector(".cond-op").value;
  const wrap = row.querySelector(".cond-values");
  const isNum = filterFields[field] === "number";
  wrap.innerHTML = "";

  if (NO_VALUE_OPS.has(op)) return;

  const makeInput = (placeholder) => {
    const input = document.createElement("input");
    input.className = "text-input cond-value";
    input.type = isNum ? "number" : "text";
    input.step = "any";
    input.placeholder = placeholder;
    return input;
  };

  if (op === "between") {
    wrap.append(makeInput("min"), makeInput("max"));
    return;
  }

  const input = makeInput(isNum ? "value" : "type or pick…");
  if (!isNum) attachSuggestions(input, field);
  wrap.append(input);
}

// Offer the column's distinct values as autocomplete suggestions
function attachSuggestions(input, field) {
  const geojson = window.GEO.currentGeoJSON;
  if (!geojson) return;

  const values = new Set();
  for (const f of geojson.features) {
    const v = f.properties?.[field];
    if (v !== null && v !== undefined && v !== "") values.add(String(v));
    if (values.size >= MAX_SUGGESTIONS) break;
  }

  const listId = `dl-${Math.random().toString(36).slice(2)}`;
  const datalist = document.createElement("datalist");
  datalist.id = listId;
  [...values].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    datalist.appendChild(opt);
  });
  input.setAttribute("list", listId);
  input.after(datalist);
}

// ── Apply / Clear ──────────────────────────────────────────────────────────
function readConditions() {
  return [...document.querySelectorAll("#filterConditions .filter-cond")].map(row => {
    const field = row.querySelector(".cond-field").value;
    const op = row.querySelector(".cond-op").value;
    const values = [...row.querySelectorAll(".cond-value")].map(i => i.value.trim());
    const type = filterFields[field];

    if (!NO_VALUE_OPS.has(op)) {
      if (values.some(v => v === "")) throw new Error(`Enter a value for "${field}"`);
      if (type === "number" && values.some(v => isNaN(parseFloat(v)))) {
        throw new Error(`"${field}" needs a numeric value`);
      }
    }
    return { field, op, type, values };
  });
}

function isEmptyValue(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
}

function matchCondition(props, { field, op, type, values }) {
  const raw = props?.[field];

  if (op === "empty") return isEmptyValue(raw);
  if (op === "notempty") return !isEmptyValue(raw);
  if (isEmptyValue(raw)) return false;

  if (type === "number") {
    const n = parseFloat(raw);
    if (isNaN(n)) return false;
    const [a, b] = values.map(parseFloat);
    switch (op) {
      case "eq":      return n === a;
      case "ne":      return n !== a;
      case "gt":      return n > a;
      case "gte":     return n >= a;
      case "lt":      return n < a;
      case "lte":     return n <= a;
      case "between": return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    return true;
  }

  const s = String(raw).toLowerCase();
  const v = values[0].toLowerCase();
  switch (op) {
    case "eq":          return s === v;
    case "ne":          return s !== v;
    case "contains":    return s.includes(v);
    case "notcontains": return !s.includes(v);
    case "starts":      return s.startsWith(v);
  }
  return true;
}

function applyFilter() {
  const geojson = window.GEO.currentGeoJSON;
  if (!geojson) return;

  let conditions;
  try {
    conditions = readConditions();
  } catch (err) {
    toast(err.message, "warn");
    return;
  }
  if (!conditions.length) { clearFilter(); return; }

  const useAny = document.getElementById("filterCombinator").value === "or";
  const features = geojson.features.filter(f =>
    useAny
      ? conditions.some(c => matchCondition(f.properties, c))
      : conditions.every(c => matchCondition(f.properties, c))
  );

  if (!features.length) {
    toast("No features match this filter", "warn");
    return;
  }

  const filtered = { type: "FeatureCollection", features };
  window.GEO.filteredGeoJSON = filtered;

  clearAnalysisLayers();   // previous results were computed on a different subset
  renderPoints(filtered);
  renderTable(filtered);

  const total = geojson.features.length;
  const msg = `Showing ${features.length.toLocaleString()} of ${total.toLocaleString()} features`;
  document.getElementById("filterStatus").textContent = `${msg} · analyses use this subset`;
  setStatus("success", `Filtered: ${features.length} rows`);
  toast(msg, "success");
}

function clearFilter() {
  const geojson = window.GEO.currentGeoJSON;
  if (!geojson) return;

  const wasFiltered = !!window.GEO.filteredGeoJSON;
  window.GEO.filteredGeoJSON = null;
  document.getElementById("filterConditions").innerHTML = "";
  document.getElementById("filterStatus").textContent = "";
  addCondition();

  if (wasFiltered) {
    clearAnalysisLayers();
    renderPoints(geojson);
    renderTable(geojson);
    toast("Filter cleared", "success");
  }
  setStatus("success", `${window.GEO.currentMeta.total_rows} features loaded`);
}
