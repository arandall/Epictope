// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderMinChart, topSites, MIN_DATASET_INDEX } from "../src/chart";

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
  // jsdom has no canvas backing: toDataURL is unimplemented (returns null
  // with a "Not implemented" warning), so stub it for exportPng tests.
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
});

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const rows = [
  { position: 1, aa: "M", min: 0.10, min_feature: "x" },
  { position: 2, aa: "A", min: 0.90, min_feature: "y" },
  { position: 3, aa: "G", min: 0.80, min_feature: "z" },
  { position: 4, aa: "V", min: 0.20, min_feature: "w" },
  { position: 5, aa: "L", min: 0.85, min_feature: "q" },
  { position: 6, aa: "F", min: 0.70, min_feature: "p" },
];

const charts: ReturnType<typeof renderMinChart>["chart"][] = [];

function makeChart() {
  const canvas = document.createElement("canvas");
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  document.body.style.margin = "0px";
  document.body.appendChild(canvas);
  const handle = renderMinChart(canvas, rows, topSites(rows, 2));
  charts.push(handle.chart);
  return handle;
}

afterEach(() => { charts.splice(0).forEach(c => c.destroy()); });

describe("renderMinChart", () => {
  it("draws exactly two datasets: raw min and smoothed min", () => {
    const { chart } = makeChart();
    expect(chart.data.datasets).toHaveLength(2);
    expect(chart.data.datasets[MIN_DATASET_INDEX].label).toBe("min");
    expect(chart.data.datasets[1].label).toBe("min (smoothed)");
  });
  it("fixes the y axis to 0-1 and x to the data range", () => {
    const { chart } = makeChart();
    expect(chart.options.scales!.y!.min).toBe(0);
    expect(chart.options.scales!.y!.max).toBe(1);
    expect(chart.scales.x.min).toBe(1);
    expect(chart.scales.x.max).toBe(6);
  });
  it("adds one vertical annotation per top site", () => {
    const { chart } = makeChart();
    const anns = (chart.options.plugins as any).annotation.annotations;
    expect(Object.keys(anns)).toEqual(["top0", "top1"]);
    expect(anns.top0.value).toBe(2); // highest peak
    expect(anns.top1.value).toBe(5);
  });
  it("hides the raw min dataset by default; smoothed stays visible", () => {
    const { chart } = makeChart();
    expect(chart.data.datasets[MIN_DATASET_INDEX].hidden).toBe(true);
    expect((chart.data.datasets[1] as any).hidden).toBeFalsy();
  });

  it("registers the vertical hover-line guide plugin", () => {
    const { chart } = makeChart();
    expect((chart.config.plugins as any[]).some(p => p.id === "hoverline")).toBe(true);
  });

  it("top-site annotation labels are white on a red box", () => {
    const { chart } = makeChart();
    const anns = (chart.options.plugins as any).annotation.annotations;
    expect(anns.top0.label.backgroundColor).toBe("#b91c1c");
    expect(anns.top0.label.color).toBe("#ffffff");
  });

  it("highlight() anchors the tooltip at the data point, not (0,0)", () => {
    const { chart, highlight } = makeChart();
    const spy = vi.spyOn(chart.tooltip!, "setActiveElements");
    highlight(5);
    const pt: any = chart.getDatasetMeta(MIN_DATASET_INDEX).data[4];
    expect(spy).toHaveBeenCalledWith(
      // tooltip items ride the smoothed dataset: the raw one is hidden and
      // filtered out of the tooltip, but the anchor pixel is the same point
      [{ datasetIndex: 1, index: 4 }],
      { x: pt.x, y: pt.y },
    );
  });
  it("highlight() pins the min dataset; tooltip title reads rows", () => {
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
  it("pin() adds a persistent annotation; pin(null) removes it", () => {
    const { chart, pin } = makeChart();
    pin(5);
    let anns = (chart.options.plugins as any).annotation.annotations;
    expect(anns.pinned).toBeDefined();
    expect(anns.pinned.value).toBe(5);
    pin(null);
    anns = (chart.options.plugins as any).annotation.annotations;
    expect(anns.pinned).toBeUndefined();
  });
  it("tooltip label appends the limiting feature", () => {
    const { chart } = makeChart();
    const label = chart.options.plugins!.tooltip!.callbacks!.label as (it: any) => string;
    expect(label({ dataset: { label: "min" }, dataIndex: 0, formattedValue: "0.1" }))
      .toBe("min: 0.1 · limiting: x");
  });
  it("clicking empty chart area unpins; Escape unpins; clicking a point marks it", async () => {
    const { bus } = await import("../src/sync");
    const { chart, pin } = makeChart();
    pin(5);
    (chart.options.onClick as any)({}, []);
    expect((chart.options.plugins as any).annotation.annotations.pinned).toBeUndefined();
    expect(bus.marked).toBeNull();
    // clicking a data point pins + marks that position
    (chart.options.onClick as any)({}, [{ datasetIndex: 0, index: 2 }]);
    expect((chart.options.plugins as any).annotation.annotations.pinned.value).toBe(3);
    expect(bus.marked).toBe(3);
    chart.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((chart.options.plugins as any).annotation.annotations.pinned).toBeUndefined();
    expect(bus.marked).toBeNull();
  });
  it("clicking a point fires the click callback with its position; empty area fires null", () => {
    const { chart, setClickCallback } = makeChart();
    const cb = vi.fn();
    setClickCallback(cb);
    (chart.options.onClick as any)({}, [{ datasetIndex: 0, index: 2 }]);
    expect(cb).toHaveBeenCalledWith(3);
    (chart.options.onClick as any)({}, []);
    expect(cb).toHaveBeenCalledWith(null);
  });
  it("onZoom shows a reset button that restores the scale", () => {
    const { chart } = makeChart();
    const onZoom = (chart.options.plugins as any).zoom.zoom.onZoom;
    expect(typeof onZoom).toBe("function");
    onZoom({ chart });
    const btn = document.querySelector("button.resetzoom") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    const spy = vi.spyOn(chart, "resetZoom").mockImplementation(() => {});
    btn.click();
    expect(spy).toHaveBeenCalled();
    expect(document.querySelector("button.resetzoom")).toBeNull();
  });
  it("exportPng returns a data URL", () => {
    const { exportPng } = makeChart();
    expect(exportPng()).toMatch(/^data:image\/png/);
  });
});
