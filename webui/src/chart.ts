import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale, annotationPlugin);

export interface TopSite { position: number; min: number; min_feature: string; }

// Local-maxima peak detection — MUST match web/parsing.compute_top_sites (Task 5.5):
// a residue is a candidate only if its `min` strictly exceeds both neighbours.
export function topSites(rows: any[], n = 5): TopSite[] {
  const peaks: TopSite[] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = Number(rows[i].min);
    const left = i === 0 ? -Infinity : Number(rows[i - 1].min);
    const right = i === rows.length - 1 ? -Infinity : Number(rows[i + 1].min);
    if (m > left && m > right) {
      peaks.push({ position: Number(rows[i].position), min: m, min_feature: rows[i].min_feature });
    }
  }
  return peaks.sort((a, b) => b.min - a.min).slice(0, n);
}

// Symmetric, edge-capped moving average — mirrors R `moving_average` in plot_scores.R (window 7).
export function movingAverage(rows: any[], key: string, window = 7): number[] {
  const xs = rows.map(r => Number(r[key]));
  const n = xs.length;
  const half = Math.floor(window / 2);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += xs[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

let hoverCb: ((pos: number | null) => void) | null = null;

// Index of the emphasized raw `min` dataset; highlight() pins tooltips to it.
export const MIN_DATASET_INDEX = 5;

// `top` is the precomputed TopSite[] (from topSites) used for vertical annotations.
// All tracks are drawn RAW so spikes land exactly on their residue (goal #5);
// the only smoothed line is the dashed `min` overlay mirroring plot_scores.R.
export function renderScoreChart(canvas: HTMLCanvasElement, rows: any[], top: TopSite[]) {
  const raw = (key: string, color: string, width = 1) => ({
    label: key,
    // parsing:false requires pre-parsed {x,y} points; plain numbers leave parsed[axis]
    // undefined and every point is skipped (empty chart, degenerate scales).
    data: rows.map(r => ({ x: Number(r.position), y: Number(r[key]) })),
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    borderWidth: width,
    tension: 0.15,
  });
  const chart = new Chart(canvas, {
    type: "line",
    data: { datasets: [
      raw("normalized_entropy", "#888"), raw("ss_score", "#2a9d8f"),
      raw("rsa", "#e9c46a"), raw("inv_anchor2", "#e76f51"),
      raw("sum_score", "#457b9d"),
      raw("min", "#d62828", 2.5),  // index 5 = MIN_DATASET_INDEX (emphasized)
      { label: "min (smoothed)", data: movingAverage(rows, "min", 7).map((y, i) =>
          ({ x: Number(rows[i].position), y })),
        borderColor: "#7f1d1d", backgroundColor: "#7f1d1d",
        borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
    ] },
    options: {
      parsing: false,
      scales: {
        x: { type: "linear", title: { display: true, text: "Amino acid position" } },
        y: { title: { display: true, text: "Score (0-1)" } },
      },
      plugins: {
        tooltip: { callbacks: {
          title: (items) => { const r = rows[items[0].dataIndex];
            return `Position ${r.position} (${r.aa}) · min ${r.min}`; },
          label: (it) => `${it.dataset.label}: ${it.formattedValue}`,
        } },
        annotation: { annotations: Object.fromEntries(
          top.map((s, i) => [`top${i}`, {
            type: "line", scaleID: "x", value: s.position,
            borderColor: "#d62828", borderWidth: 1, borderDash: [4, 4],
            label: { display: true, content: `#${s.position}`, position: "start" },
          }])) },
      },
      onHover: (_, els) => { if (hoverCb) hoverCb(els.length ? rows[els[0].index].position : null); },
    },
  });
  return {
    chart,
    setHoverCallback: (cb: (pos: number | null) => void) => { hoverCb = cb; },
    highlight: (pos: number | null) => {
      const idx = pos == null ? -1 : rows.map(r => Number(r.position)).indexOf(pos);
      const ae = idx < 0 ? [] : [{ datasetIndex: MIN_DATASET_INDEX, index: idx }];
      chart.setActiveElements(ae);
      chart.tooltip?.setActiveElements(ae, { x: 0, y: 0 });
      chart.update();
    },
  };
}
