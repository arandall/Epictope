import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale, Filler } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import zoomPlugin from "chartjs-plugin-zoom";
import { bus } from "./sync";
Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale, Filler, annotationPlugin, zoomPlugin);

export interface TopSite { position: number; min: number; min_feature: string; }

// Local-maxima peak detection — MUST match web/parsing.compute_top_sites:
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

// The emphasized raw `min` dataset; highlight() pins tooltips to it.
export const MIN_DATASET_INDEX = 0;

export interface MinChartHandle {
  chart: Chart;
  setHoverCallback(cb: (pos: number | null) => void): void;
  highlight(pos: number | null): void;
  pin(pos: number | null): void;
  exportPng(): string;
}

function siteAnnotation(s: TopSite) {
  return {
    type: "line" as const, scaleID: "x", value: s.position,
    borderColor: "#b91c1c", borderWidth: 1, borderDash: [4, 4],
    label: { display: true, content: `#${s.position}`, position: "start" as const,
             backgroundColor: "#b91c1c", color: "#ffffff", borderRadius: 3, padding: 3,
             font: { size: 10, weight: "bold" as const } },
  };
}

// Paper-faithful chart (Fig 2C / plot_scores.R): raw `min` filled area +
// dashed window-7 smoothed overlay + top-site markers. Nothing else.
export function renderMinChart(canvas: HTMLCanvasElement, rows: any[], top: TopSite[]): MinChartHandle {
  const annotations: Record<string, any> = Object.fromEntries(
    top.map((s, i) => [`top${i}`, siteAnnotation(s)]));
  const chart = new Chart(canvas, {    type: "line",
    data: { datasets: [
      { label: "min",
        data: rows.map(r => ({ x: Number(r.position), y: Number(r.min) })),
        borderColor: "#0d9488", backgroundColor: "rgba(13,148,136,0.15)",
        fill: true, pointRadius: 0, borderWidth: 2, tension: 0.15,
        hidden: true },
      { label: "min (smoothed)",
        data: movingAverage(rows, "min", 7).map((y, i) => ({ x: Number(rows[i].position), y })),
        borderColor: "#134e4a", borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
    ] },
    options: {
      parsing: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { type: "linear", title: { display: true, text: "Amino acid position" } },
        y: { min: 0, max: 1, title: { display: true, text: "Minimum feature score (0–1)" } },
      },
      onClick: (_, els) => {
        const pos = els.length ? Number(rows[els[0].index].position) : null;
        handle.pin(pos);
        bus.setMarked(pos);
      },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: {
          filter: (it: any): boolean => !(chart.data.datasets[it.datasetIndex] as any).hidden,
          callbacks: {
            // items can be empty when every active element was filtered out
            // (e.g. cross-view highlight pinning) — tolerate that.
            title: (items) => { const r = rows[items[0]?.dataIndex];
              return r ? `Position ${r.position} (${r.aa}) · min ${r.min}` : ""; },
            label: (it) => `${it.dataset.label}: ${it.formattedValue} · limiting: ${rows[it.dataIndex].min_feature}`,
          },
        },
        annotation: { annotations },
        zoom: {
          pan: { enabled: true, mode: "x", modifierKey: "shift" },
          zoom: { drag: { enabled: true }, wheel: { enabled: true, modifierKey: "ctrl" },
                  pinch: { enabled: true }, mode: "x",
                  onZoom: ({ chart: c }) => showReset(c) },
        },
      },
      onHover: (_, els) => { if (hoverCb) hoverCb(els.length ? rows[els[0].index].position : null); },
    },
  });

  // "Reset zoom" appears after the first zoom and removes itself on reset.
  function showReset(c: Chart) {
    if (canvas.parentElement!.querySelector("button.resetzoom")) return;
    const btn = document.createElement("button");
    btn.className = "resetzoom";
    btn.textContent = "Reset zoom";
    btn.onclick = () => { c.resetZoom(); btn.remove(); };
    canvas.parentElement!.appendChild(btn);
  }

  const handle: MinChartHandle = {
    chart,
    setHoverCallback: (cb) => { hoverCb = cb; },
    highlight: (pos) => {
      const idx = pos == null ? -1 : rows.findIndex(r => Number(r.position) === pos);
      const ae = idx < 0 ? [] : [{ datasetIndex: MIN_DATASET_INDEX, index: idx }];
      chart.setActiveElements(ae);
      if (idx >= 0) {
        // Anchor at the real point pixel — {x:0,y:0} parks the tooltip in the corner.
        // Tooltip items ride the visible smoothed dataset: the raw one is hidden
        // and would be filtered out of the tooltip entirely.
        const pt = chart.getDatasetMeta(MIN_DATASET_INDEX).data[idx] as any;
        chart.tooltip?.setActiveElements([{ datasetIndex: 1, index: idx }], { x: pt?.x ?? 0, y: pt?.y ?? 0 });
      } else {
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      }
      chart.update();
    },
    pin: (pos) => {
      const anns = (chart.options.plugins as any).annotation.annotations as Record<string, any>;
      if (pos == null) delete anns.pinned;
      else anns.pinned = { ...siteAnnotation({ position: pos, min: 0, min_feature: "" }),
                           borderColor: "#0f172a", borderWidth: 2, borderDash: [],
                           label: { display: true, content: `▸ #${pos}`, position: "start",
                                    color: "#0f172a", font: { size: 11, weight: "bold" } } };
      chart.update();
    },
    // 2x, white background: draw the chart onto an offscreen canvas at 2x size.
    exportPng: () => {
      const src = chart.canvas;
      const out = document.createElement("canvas");
      out.width = src.width * 2;
      out.height = src.height * 2;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.scale(2, 2);
      ctx.drawImage(src, 0, 0);
      return out.toDataURL("image/png");
    },
  };

  // Escape unpins (canvas is made focusable for keyboard access).
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", (e) => { if (e.key === "Escape") { handle.pin(null); bus.setMarked(null); } });

  return handle;
}
