/**
 * symbology.js — Graduated (numeric) and categorized (text) point styling
 *
 * Classes are computed from the full dataset so colours and the legend stay
 * stable while the attribute filter changes which points are visible.
 */

const COLOR_RAMPS = {
  oranges: ["#fde8df", "#f4a582", "#e8845a", "#c25b2e", "#6b2010"],
  blues:   ["#deebf7", "#9ecae1", "#4292c6", "#2171b5", "#08306b"],
  viridis: ["#fde725", "#5ec962", "#21918c", "#3b528b", "#440154"],
  redblue: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
};

const CATEGORY_COLORS = [
  "#c25b2e", "#2e7c8f", "#6b4fa8", "#2e8c52", "#d4a017", "#2e5b8c",
  "#a84f6b", "#5b8c2e", "#8c4a2e", "#4f6ba8", "#b07d9e",
];
const MAX_CATEGORIES = CATEGORY_COLORS.length;   // the rest are grouped as "Other"
const OTHER_COLOR = "#8a847e";
const NO_DATA_COLOR = "#d5cfc6";
const JENKS_SAMPLE = 1000;

let symFields = {};   // column -> "number" | "text"

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("symField").addEventListener("change", updateSymOptions);
  document.getElementById("symApplyBtn").addEventListener("click", applySymbology);
  document.getElementById("symResetBtn").addEventListener("click", resetSymbology);
});

// Called by ingest.js after a dataset loads
function initSymbologyUI(meta) {
  symFields = {};
  const select = document.getElementById("symField");
  select.innerHTML = "";
  select.add(new Option("Single colour", ""));

  const numGroup = document.createElement("optgroup");
  numGroup.label = "Numeric (graduated)";
  const textGroup = document.createElement("optgroup");
  textGroup.label = "Text (categories)";

  meta.columns.forEach(col => {
    const isNum = /int|float|double|decimal/.test(meta.dtypes[col] || "");
    symFields[col] = isNum ? "number" : "text";
    (isNum ? numGroup : textGroup).appendChild(new Option(col, col));
  });
  if (numGroup.children.length) select.appendChild(numGroup);
  if (textGroup.children.length) select.appendChild(textGroup);

  resetSymbology({ quiet: true });
  document.getElementById("symbologySection").style.display = "block";
}

function updateSymOptions() {
  const field = document.getElementById("symField").value;
  document.getElementById("symNumericOpts").style.display =
    symFields[field] === "number" ? "block" : "none";
}

// ── Apply / Reset ──────────────────────────────────────────────────────────
function applySymbology() {
  const field = document.getElementById("symField").value;
  if (!field) { resetSymbology(); return; }

  const features = window.GEO.currentGeoJSON?.features || [];
  const result = symFields[field] === "number"
    ? buildGraduated(features, field)
    : buildCategorized(features, field);

  if (!result) return;

  setPointStyle(result.styleFn);
  renderSymLegend(field, result.legend);
  toast(`Styled by ${field}`, "success");
}

function resetSymbology({ quiet = false } = {}) {
  document.getElementById("symField").value = "";
  updateSymOptions();
  setPointStyle(null);
  document.getElementById("symLegend").style.display = "none";
  if (!quiet) toast("Symbology reset", "success");
}

// ── Graduated (numeric) ────────────────────────────────────────────────────
function buildGraduated(features, field) {
  const values = features
    .map(f => parseFloat(f.properties?.[field]))
    .filter(v => !isNaN(v));

  if (values.length < 2) {
    toast(`"${field}" has fewer than 2 numeric values`, "warn");
    return null;
  }

  const method = document.getElementById("symMethod").value;
  const nClasses = parseInt(document.getElementById("symClasses").value, 10);
  const breaks = computeBreaks(values, method, nClasses);   // upper bounds, ascending
  const colors = sampleRamp(COLOR_RAMPS[document.getElementById("symRamp").value], breaks.length);
  const sizeByValue = document.getElementById("symSize").checked;
  const radii = breaks.map((_, i) => 4 + (breaks.length === 1 ? 0 : (i * 8) / (breaks.length - 1)));

  const classOf = v => {
    const i = breaks.findIndex(b => v <= b);
    return i === -1 ? breaks.length - 1 : i;
  };

  const counts = new Array(breaks.length).fill(0);
  let noData = 0;
  features.forEach(f => {
    const v = parseFloat(f.properties?.[field]);
    isNaN(v) ? noData++ : counts[classOf(v)]++;
  });

  const styleFn = feature => {
    const v = parseFloat(feature.properties?.[field]);
    if (isNaN(v)) return { fillColor: NO_DATA_COLOR, radius: 4 };
    const i = classOf(v);
    return { fillColor: colors[i], radius: sizeByValue ? radii[i] : 5, fillOpacity: 0.9 };
  };

  const min = Math.min(...values);
  const legend = breaks.map((upper, i) => ({
    color: colors[i],
    label: `${fmtNum(i === 0 ? min : breaks[i - 1])} – ${fmtNum(upper)}`,
    count: counts[i],
    size: sizeByValue ? radii[i] : null,
  }));
  if (noData) legend.push({ color: NO_DATA_COLOR, label: "No data", count: noData });

  return { styleFn, legend };
}

function computeBreaks(values, method, n) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return [max];

  let breaks;
  if (method === "equal") {
    const step = (max - min) / n;
    breaks = Array.from({ length: n }, (_, i) => (i === n - 1 ? max : min + step * (i + 1)));
  } else if (method === "jenks") {
    breaks = jenksBreaks(sorted, n);
  } else {
    breaks = Array.from({ length: n }, (_, i) => quantile(sorted, (i + 1) / n));
  }

  // Skewed data can produce duplicate breaks — drop them so every class is non-empty
  return [...new Set(breaks)];
}

function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Jenks natural breaks (Fisher's dynamic programming). Large inputs are sampled.
function jenksBreaks(sorted, nClasses) {
  let data = sorted;
  if (data.length > JENKS_SAMPLE) {
    const step = (data.length - 1) / (JENKS_SAMPLE - 1);
    data = Array.from({ length: JENKS_SAMPLE }, (_, i) => sorted[Math.round(i * step)]);
  }
  const n = data.length;
  const k = Math.min(nClasses, n);

  const lower = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const variance = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { lower[1][j] = 1; variance[1][j] = 0; }

  for (let l = 2; l <= n; l++) {
    let sum = 0, sumSq = 0, w = 0, v = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = data[i3 - 1];
      w++; sum += val; sumSq += val * val;
      v = sumSq - (sum * sum) / w;
      if (i3 > 1) {
        for (let j = 2; j <= k; j++) {
          if (variance[l][j] >= v + variance[i3 - 1][j - 1]) {
            lower[l][j] = i3;
            variance[l][j] = v + variance[i3 - 1][j - 1];
          }
        }
      }
    }
    lower[l][1] = 1;
    variance[l][1] = v;
  }

  const breaks = new Array(k);
  breaks[k - 1] = data[n - 1];
  let idx = n;
  for (let j = k; j >= 2; j--) {
    idx = lower[idx][j] - 1;
    breaks[j - 2] = data[idx - 1];
  }
  breaks[k - 1] = sorted[sorted.length - 1];   // top class must include the true max
  return breaks;
}

// ── Categorized (text) ─────────────────────────────────────────────────────
function buildCategorized(features, field) {
  const counts = new Map();
  let noData = 0;
  features.forEach(f => {
    const v = f.properties?.[field];
    if (v === null || v === undefined || v === "") { noData++; return; }
    const key = String(v);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  if (!counts.size) {
    toast(`"${field}" has no values`, "warn");
    return null;
  }

  // Most frequent categories get their own colour
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const hasOther = ranked.length > MAX_CATEGORIES;
  const top = hasOther ? ranked.slice(0, MAX_CATEGORIES - 1) : ranked;
  const colorOf = new Map(top.map(([cat], i) => [cat, CATEGORY_COLORS[i]]));

  const styleFn = feature => {
    const v = feature.properties?.[field];
    if (v === null || v === undefined || v === "") return { fillColor: NO_DATA_COLOR, radius: 4 };
    return { fillColor: colorOf.get(String(v)) || OTHER_COLOR, fillOpacity: 0.9 };
  };

  const legend = top.map(([cat, count]) => ({ color: colorOf.get(cat), label: cat, count }));
  if (hasOther) {
    const otherCount = ranked.slice(MAX_CATEGORIES - 1).reduce((s, [, c]) => s + c, 0);
    legend.push({ color: OTHER_COLOR, label: `Other (${ranked.length - top.length} values)`, count: otherCount });
  }
  if (noData) legend.push({ color: NO_DATA_COLOR, label: "No data", count: noData });

  return { styleFn, legend };
}

// ── Legend ─────────────────────────────────────────────────────────────────
function renderSymLegend(field, items) {
  document.getElementById("symLegendTitle").textContent = field;
  const container = document.getElementById("symLegendItems");
  container.innerHTML = "";

  items.forEach(({ color, label, count, size }) => {
    const row = document.createElement("div");
    row.className = "legend-item";

    const swatch = document.createElement("div");
    swatch.className = "legend-swatch legend-dot";
    swatch.style.background = color;
    if (size) swatch.style.width = swatch.style.height = `${Math.round(size * 1.6)}px`;

    const text = document.createElement("span");
    text.className = "legend-label";
    text.textContent = label;
    text.title = label;

    const n = document.createElement("span");
    n.className = "legend-count";
    n.textContent = count.toLocaleString();

    row.append(swatch, text, n);
    container.appendChild(row);
  });

  document.getElementById("symLegend").style.display = "block";
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtNum(v) {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// Interpolate n colours evenly along a multi-stop ramp
function sampleRamp(stops, n) {
  if (n === 1) return [stops[Math.floor(stops.length / 2)]];
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, stops.length - 1);
    return mixHex(stops[lo], stops[hi], t - lo);
  });
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = shift => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return "#" + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, "0")).join("");
}
