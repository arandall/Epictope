// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderScoreChart, topSites, MIN_DATASET_INDEX } from "../src/chart";

// jsdom ships no 2D canvas implementation and no layout engine. Chart.js only
// builds scales/elements when the canvas is DOM-attached and has a nonzero
// chartArea, so: stub getContext (all draw calls become no-ops), fake the
// container rect to 800x400, and give the canvas explicit styles.
const W = 800, H = 400;
const RECT = { x: 0, y: 0, top: 0, left: 0, right: W, bottom: H, width: W, height: H, toJSON: () => {} };

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const target: Record<string | symbol, unknown> = {
      canvas: this,
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getLineDash: () => [],
    };
    const ctx = new Proxy(target, {
      get(t, prop) { return prop in t ? t[prop] : () => {}; },
      set(t, prop, value) { t[prop] = value; return true; },
    });
    return ctx as unknown as CanvasRenderingContext2D;
  });
});

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const rows = [
  { position: 1, aa: "M", min: 0.10, normalized_entropy: 0.9, ss_score: 0.2, rsa: 0.3, inv_anchor2: 0.1, sum_score: 0.4, min_feature: "x" },
  { position: 2, aa: "A", min: 0.90, normalized_entropy: 0.8, ss_score: 0.4, rsa: 0.2, inv_anchor2: 0.5, sum_score: 0.6, min_feature: "y" },
  { position: 3, aa: "G", min: 0.80, normalized_entropy: 0.7, ss_score: 0.6, rsa: 0.4, inv_anchor2: 0.3, sum_score: 0.5, min_feature: "z" },
  { position: 4, aa: "V", min: 0.20, normalized_entropy: 0.6, ss_score: 0.3, rsa: 0.5, inv_anchor2: 0.2, sum_score: 0.3, min_feature: "w" },
  { position: 5, aa: "L", min: 0.85, normalized_entropy: 0.5, ss_score: 0.7, rsa: 0.3, inv_anchor2: 0.6, sum_score: 0.7, min_feature: "q" },
  { position: 6, aa: "F", min: 0.70, normalized_entropy: 0.4, ss_score: 0.5, rsa: 0.6, inv_anchor2: 0.4, sum_score: 0.4, min_feature: "p" },
];

const charts: ReturnType<typeof renderScoreChart>["chart"][] = [];

function makeChart() {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.style.margin = "0px";
  document.body.style.margin = "0px";
  document.body.style.padding = "0px";
  document.body.appendChild(canvas);
  const handle = renderScoreChart(canvas, rows, topSites(rows, 2));
  charts.push(handle.chart);
  return handle;
}

afterEach(() => {
  charts.splice(0).forEach(c => c.destroy());
});

describe("renderScoreChart (parsing:false with {x,y} points)", () => {
  it("derives finite, data-exact scale limits from the {x,y} points", () => {
    const { chart } = makeChart();
    expect(chart.scales.x.min).toBe(1);
    expect(chart.scales.x.max).toBe(6);
    expect(chart.scales.y.min).toBe(0.1);
    expect(chart.scales.y.max).toBe(0.9);
    expect(chart.chartArea.width).toBeGreaterThan(0);
  });

  it("computes finite, correctly ordered pixel geometry for every point", () => {
    const { chart } = makeChart();
    // the initial update is animated; 'none' applies final geometry synchronously
    chart.update("none");
    for (const dsIndex of [MIN_DATASET_INDEX, MIN_DATASET_INDEX + 1]) {
      const meta = chart.getDatasetMeta(dsIndex);
      expect(meta.data).toHaveLength(rows.length);
      for (const el of meta.data) {
        expect(Number.isFinite((el as { x: number }).x)).toBe(true);
        expect(Number.isFinite((el as { y: number }).y)).toBe(true);
      }
    }
    // position 2 (min 0.9, peak) vs position 4 (min 0.2, dip): further right
    // on the x axis, and higher on the y axis (smaller pixel value).
    const min = chart.getDatasetMeta(MIN_DATASET_INDEX).data as unknown as { x: number; y: number }[];
    expect(min[3].x).toBeGreaterThan(min[1].x);
    expect(min[3].y).toBeGreaterThan(min[1].y);
  });

  it("keeps dataIndex semantics: highlight() pins the min dataset and tooltip title reads rows", () => {
    const { chart, highlight } = makeChart();
    highlight(5);
    const active = chart.getActiveElements();
    expect(active).toHaveLength(1);
    expect(active[0].datasetIndex).toBe(MIN_DATASET_INDEX);
    expect(active[0].index).toBe(4);
    highlight(null);
    expect(chart.getActiveElements()).toHaveLength(0);
    const title = (chart.options.plugins!.tooltip!.callbacks!.title as (items: { dataIndex: number }[]) => string)(
      [{ dataIndex: 2 }]);
    expect(title).toBe("Position 3 (G) · min 0.8");
  });
});
