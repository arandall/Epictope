# Web UI + Search Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the listed UI issues (MSA chunked view, alignment, markers, tooltip, chart defaults, chip styling, ruler, print) and search issues (button-triggered search, accession resolution to e.g. Q5MD89, richer selection info, recent searches) with minimal, consolidating changes.

**Architecture:** No new dependencies. Frontend is vanilla TS modules in `webui/src` coordinated by a tiny event bus (`sync.ts`); backend is FastAPI (`web/`). Resolution reuses the existing `POST /api/resolve` → `scripts/resolve_accessions.py: resolve_one`, which is verified to map `A0A2R8QSE0`/`A0A0R4IFS9` → `Q5MD89`.

**Tech Stack:** TypeScript + Vite + Vitest + jsdom (frontend), FastAPI + pytest (backend), Chart.js 4 + annotation/zoom plugins (existing).

**Spec:** `docs/superpowers/specs/2026-09-07-webui-consolidation.md`

## Global Constraints

- No new npm or pip dependencies.
- No changes to the R pipeline or `scripts/resolve_accessions.py` (already verified correct).
- Frontend tests: `npm test` in `webui/`. Backend tests: `uv run pytest tests/web -q` from repo root.
- Frontend build (type-checks): `npm run build` in `webui/` (outputs to `web/static/`).
- Keep `colorForColumn`, `queryPositions`, `colorRuns` exported from `webui/src/msa.ts` — `webui/test/msa.test.ts` imports them.
- Follow existing code style: small modules, `bus` for cross-view hover/mark sync, no frameworks.

## Background Facts (verified 2026-09-07)

- `outputs/Q5MD89/Q5MD89_msa.fasta` record ids are paths like `data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa`; the query record id is the bare accession (`>Q5MD89`) and is **not** the first record.
- **Existing bug this plan fixes:** `web/parsing.py: parse_msa` sets `query = records[0].id`, which is an ortholog path for real files, so `queryPositions` maps hover from the wrong row. `parse_msa` gains an optional `query_id` argument; `web/app.py: result_msa` passes the accession.
- Chart tooltip appears at the top-left corner because `chart.ts: highlight()` calls `chart.tooltip?.setActiveElements(ae, { x: 0, y: 0 })` — `(0,0)` is the canvas top-left. Fix: use the data point's pixel position.
- Annotation labels ("#123") render red text on the plugin's default near-black background → fix with `backgroundColor: "#b91c1c", color: "#fff"`.
- UniProt accession regex (canonical): `^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$` — matches `Q5MD89`, `Q9W7E7`, `A0A2R8QSE0`, `A0A0R4IFS9`, `P12345`; does not match `smad5`, `flt4`, `TP53`.
- Chunk width math: monospace 11px ≈ 6.6px/char → 200-col chunk ≈ 1320px + 150px name column. Page stays fixed width because each chunk scrolls internally.

---

### Task 1: Bus `marked` channel + `msa-chunk` URL param

**Files:**
- Modify: `webui/src/sync.ts`
- Modify: `webui/src/state.ts`
- Test: `webui/test/sync.test.ts`, `webui/test/state.test.ts`

**Interfaces:**
- Produces: `bus.setMarked(p: number | null)`, `bus.onMarked(cb): () => void`, `bus.marked: number | null` (consumed by chart.ts, msa.ts, sequence.ts, main.ts).
- Produces: `parseChunk(): number` and `DEFAULT_MSA_WRAP = 200` from state.ts (consumed by main.ts).

- [ ] **Step 1: Write the failing tests**

Append to `webui/test/sync.test.ts` inside `describe("sync bus")`:

```ts
it("notifies marked listeners on setMarked", () => {
  let got: number | null = -1;
  const off = bus.onMarked(p => { got = p; });
  bus.setMarked(7);
  expect(got).toBe(7);
  bus.setMarked(null);
  expect(got).toBeNull();
  off();
});
```

Append to `webui/test/state.test.ts`:

```ts
import { parseChunk, DEFAULT_MSA_WRAP } from "../src/state";

describe("parseChunk", () => {
  it("defaults to 200 without the param", () => {
    window.history.replaceState(null, "", "/");
    expect(parseChunk()).toBe(DEFAULT_MSA_WRAP);
  });
  it("reads ?msa-chunk= and clamps to [40, 2000]", () => {
    window.history.replaceState(null, "", "/?msa-chunk=100");
    expect(parseChunk()).toBe(100);
    window.history.replaceState(null, "", "/?msa-chunk=5");
    expect(parseChunk()).toBe(40);
    window.history.replaceState(null, "", "/?msa-chunk=99999");
    expect(parseChunk()).toBe(2000);
    window.history.replaceState(null, "", "/?msa-chunk=abc");
    expect(parseChunk()).toBe(DEFAULT_MSA_WRAP);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webui && npm test -- --run test/sync.test.ts test/state.test.ts`
Expected: FAIL — `bus.onMarked is not a function`, `parseChunk is not exported`.

- [ ] **Step 3: Implement**

Replace the whole of `webui/src/sync.ts`:

```ts
type Listener = (pos: number | null) => void;
// Two channels: `active` = transient hover highlight, `marked` = persistent
// click marker shown across chart, query sequence and MSA.
class Bus {
  active: number | null = null;
  marked: number | null = null;
  listeners = new Set<Listener>();
  markListeners = new Set<Listener>();
  setActive(p: number | null) { this.active = p; this.listeners.forEach(l => l(p)); }
  onActive(cb: Listener) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  setMarked(p: number | null) { this.marked = p; this.markListeners.forEach(l => l(p)); }
  onMarked(cb: Listener) { this.markListeners.add(cb); return () => this.markListeners.delete(cb); }
}
export const bus = new Bus();
```

Append to `webui/src/state.ts`:

```ts
export const DEFAULT_MSA_WRAP = 200;

// MSA columns per line; override with ?msa-chunk=N (clamped to a sane range).
export function parseChunk(): number {
  const raw = new URLSearchParams(window.location.search).get("msa-chunk");
  const v = Number(raw);
  if (raw == null || !Number.isFinite(v) || v <= 0) return DEFAULT_MSA_WRAP;
  return Math.min(2000, Math.max(40, Math.floor(v)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webui && npm test -- --run test/sync.test.ts test/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/sync.ts webui/src/state.ts webui/test/sync.test.ts webui/test/state.test.ts
git commit -m "feat(webui): marked-position bus channel and msa-chunk URL param"
```

---

### Task 2: Chart — smoothed-only default, legible site labels, tooltip at point, click-to-mark

**Files:**
- Modify: `webui/src/chart.ts`
- Test: `webui/test/chart.test.ts`

**Interfaces:**
- Consumes: `bus.setMarked` / `bus.onMarked` (Task 1). `main.ts` will do `bus.onMarked(pos => chartHandle.pin(pos))`.
- Produces: unchanged `MinChartHandle`; `renderMinChart` now hides the raw `min` dataset by default and positions cross-view tooltips at the data point.

- [ ] **Step 1: Write the failing tests**

In `webui/test/chart.test.ts`:

a) Add inside `describe("renderMinChart")`:

```ts
it("hides the raw min dataset by default; smoothed stays visible", () => {
  const { chart } = makeChart();
  expect(chart.data.datasets[MIN_DATASET_INDEX].hidden).toBe(true);
  expect((chart.data.datasets[1] as any).hidden).toBeFalsy();
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
    [{ datasetIndex: MIN_DATASET_INDEX, index: 4 }],
    { x: pt.x, y: pt.y },
  );
});
```

b) Replace the test `"clicking empty chart area unpins; Escape unpins"` body so it also covers point-click marking. New version:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webui && npm test -- --run test/chart.test.ts`
Expected: FAIL (hidden undefined, label colors missing, tooltip at 0,0, marked never set).

- [ ] **Step 3: Implement**

In `webui/src/chart.ts`:

a) Add the bus import at the top:

```ts
import { bus } from "./sync";
```

b) Replace `siteAnnotation` with:

```ts
function siteAnnotation(s: TopSite) {
  return {
    type: "line" as const, scaleID: "x", value: s.position,
    borderColor: "#b91c1c", borderWidth: 1, borderDash: [4, 4],
    label: { display: true, content: `#${s.position}`, position: "start" as const,
             backgroundColor: "#b91c1c", color: "#ffffff", borderRadius: 3, padding: 3,
             font: { size: 10, weight: "bold" as const } },
  };
}
```

c) In the `datasets` array, add `hidden: true` to the raw `min` dataset only:

```ts
{ label: "min",
  data: rows.map(r => ({ x: Number(r.position), y: Number(r.min) })),
  borderColor: "#0d9488", backgroundColor: "rgba(13,148,136,0.15)",
  fill: true, pointRadius: 0, borderWidth: 2, tension: 0.15,
  hidden: true },
```

d) Replace the `tooltip` plugin config (add `filter` so the hidden raw dataset never appears):

```ts
tooltip: {
  filter: (it) => !(chart.data.datasets[it.datasetIndex] as any).hidden,
  callbacks: {
    title: (items) => { const r = rows[items[0].dataIndex];
      return `Position ${r.position} (${r.aa}) · min ${r.min}`; },
    label: (it) => `${it.dataset.label}: ${it.formattedValue} · limiting: ${rows[it.dataIndex].min_feature}`,
  },
},
```

(`filter` closes over `chart`, which is assigned before any tooltip can show — same pattern as the existing `onClick` closing over `handle`.)

e) Replace `onClick` with click-to-mark:

```ts
onClick: (_, els) => {
  const pos = els.length ? Number(rows[els[0].index].position) : null;
  handle.pin(pos);
  bus.setMarked(pos);
},
```

f) Replace `highlight()` so the tooltip sits on the data point:

```ts
highlight: (pos) => {
  const idx = pos == null ? -1 : rows.findIndex(r => Number(r.position) === pos);
  const ae = idx < 0 ? [] : [{ datasetIndex: MIN_DATASET_INDEX, index: idx }];
  chart.setActiveElements(ae);
  if (idx >= 0) {
    // Anchor at the real point pixel — {x:0,y:0} parks the tooltip in the corner.
    const pt = chart.getDatasetMeta(MIN_DATASET_INDEX).data[idx] as any;
    chart.tooltip?.setActiveElements(ae, { x: pt?.x ?? 0, y: pt?.y ?? 0 });
  } else {
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  }
  chart.update();
},
```

g) Update the Escape handler to also clear the bus marker:

```ts
canvas.addEventListener("keydown", (e) => { if (e.key === "Escape") { handle.pin(null); bus.setMarked(null); } });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webui && npm test -- --run test/chart.test.ts`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Commit**

```bash
git add webui/src/chart.ts webui/test/chart.test.ts
git commit -m "feat(webui): smoothed-only chart default, red labels, tooltip at point, click-to-mark"
```

---

### Task 3: MSA — chunked renderer, basename labels, aligned ruler, hover range + tooltip, mark/scroll

This is the biggest task. It rewrites `renderMsa` into a chunked (configurable wrap, default 200) per-column renderer, and fixes the backend `query` record selection bug.

**Files:**
- Modify: `web/parsing.py` (`parse_msa` gains `query_id`), `web/app.py:69` (pass accession)
- Rewrite: `webui/src/msa.ts`
- Test: `tests/web/test_parsing.py`, `webui/test/msa.test.ts`

**Interfaces:**
- Consumes: `bus.setActive`, `bus.onActive`, `bus.onMarked`, `bus.setMarked` (Tasks 1–2).
- Produces:
  - `baseName(id: string): string`
  - `rulerFor(startCol: number, len: number): string`
  - `renderMsa(el, msa, opts?): MsaHandle` where `opts = { wrap?: number; onPositionClick?: (pos: number | null) => void }`
  - `MsaHandle = { scrollToPosition(pos: number): void; markPosition(pos: number | null): void }`
  - Unchanged exports: `colorForColumn`, `queryPositions`, `colorRuns`, `CellColor`, `ColorRun`.
  - `querySeq(msa): string` — the chosen query row's (gapped) sequence; consumed by sequence.ts (Task 4).
- CSS classes consumed by Task 6 stylesheet: `.msachunk`, `.chunkhead`, `.msablock`, `.msaruler`, `.cell`, `.cell.inrange`, `.cell.marked`, `.msaname.isquery`, `.msatip`.

- [ ] **Step 1: Backend test — query record is not necessarily first**

Append to `tests/web/test_parsing.py`:

```python
def test_parse_msa_picks_query_by_id_not_position(tmp_path):
    # Real MSA files list ortholog paths first; the query is the bare accession.
    p = tmp_path / "Q5MD89_msa.fasta"
    p.write_text(">data/CDS/Bos_taurus.pep.all.fa\nACGT\n>Q5MD89\nAC-T\n")
    msa = parsing.parse_msa(p, "Q5MD89")
    assert msa["query"] == "Q5MD89"
    # unknown query id falls back to the first record
    msa2 = parsing.parse_msa(p, "ZZZZZ")
    assert msa2["query"] == "data/CDS/Bos_taurus.pep.all.fa"
```

Run: `uv run pytest tests/web/test_parsing.py -q`
Expected: FAIL — `parse_msa() takes 1 positional argument`.

- [ ] **Step 2: Implement the backend fix**

In `web/parsing.py`, replace `parse_msa` with:

```python
def parse_msa(path, query_id: str | None = None) -> dict:
    path = Path(path)
    records, current_id, seqs = [], None, []
    for line in path.read_text().splitlines():
        if line.startswith(">"):
            if current_id is not None:
                records.append({"id": current_id, "seq": "".join(seqs)})
            current_id = line[1:].split()[0]
            seqs = []
        elif line.strip():
            seqs.append(line.strip())
    if current_id is not None:
        records.append({"id": current_id, "seq": "".join(seqs)})
    ids = {r["id"] for r in records}
    # The query record is the bare accession; orthologs are file paths. Falling
    # back to the first record keeps old cached files working.
    query = query_id if query_id in ids else (records[0]["id"] if records else "")
    return {"records": records, "query": query}
```

In `web/app.py`, change the `result_msa` body line `return parsing.parse_msa(p)` to:

```python
    return parsing.parse_msa(p, uniprot_id)
```

Run: `uv run pytest tests/web -q`
Expected: PASS (existing `test_parse_msa` still passes — query is first there and `query_id` matches it).

- [ ] **Step 3: Frontend tests for the new renderer**

Update the imports at the top of `webui/test/msa.test.ts` — line 2 becomes:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
```

and line 3 becomes:

```ts
import { colorForColumn, queryPositions, colorRuns, renderMsa, baseName, rulerFor } from "../src/msa";
```

Keep the `colorForColumn`, `queryPositions`, `colorRuns` describes unchanged. Replace the last test in the file (the `it("renderMsa prepends a ruler…")` test) **and** the `it("maps strip-relative mouse x…")` test with:

```ts
describe("baseName", () => {
  it("strips directory paths from record ids", () => {
    expect(baseName("data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa")).toBe("Bos_taurus.ARS-UCD1.2.pep.all.fa");
    expect(baseName("Q5MD89")).toBe("Q5MD89");
    expect(baseName("a\\b\\c.fa")).toBe("c.fa");
  });
});

describe("rulerFor", () => {
  it("labels multiples of 10 right-aligned on their absolute column", () => {
    const r = rulerFor(0, 20);
    const [label, tick] = r.split("\n");
    expect(tick[9]).toBe("|");
    expect(tick[19]).toBe("|");
    expect(tick[0]).toBe(" ");
    expect(label.slice(8, 10)).toBe("10");  // "10" ends at column 10
    expect(label.slice(18, 20)).toBe("20");
  });
  it("uses absolute columns for later chunks", () => {
    const [, tick] = rulerFor(190, 20).split("\n");
    expect(tick[9]).toBe("|");               // column 200 is a tick
    expect(rulerFor(190, 20).split("\n")[0].slice(7, 10)).toBe("200");
  });
});

describe("renderMsa", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  function mountMsa(seqs: { id: string; seq: string }[], query: string, wrap?: number) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onPositionClick = vi.fn();
    const handle = renderMsa(el, { query, records: seqs }, { wrap, onPositionClick });
    return { el, handle, onPositionClick };
  }

  it("splits into chunks of `wrap` columns with one ruler and one row set per chunk", () => {
    const seq = "A".repeat(45);
    const { el } = mountMsa([{ id: "Q", seq }, { id: "H", seq }], "Q", 20);
    const chunks = el.querySelectorAll(".msachunk");
    expect(chunks).toHaveLength(3); // 20 + 20 + 5
    expect(el.querySelectorAll(".msaruler")).toHaveLength(3);
    // one letter = one position: every chunk row has one .cell per column
    const firstBlockRows = chunks[0].querySelectorAll(".msablock .msarow");
    const firstSeqRow = firstBlockRows[1]; // row 0 is the ruler
    expect(firstSeqRow.querySelectorAll(".cell")).toHaveLength(20);
    expect(chunks[2].querySelectorAll(".msarow")[1].querySelectorAll(".cell")).toHaveLength(5);
    expect(chunks[0].querySelector(".chunkhead")!.textContent).toContain("1–20");
  });

  it("renders row labels as basenames and flags the query row", () => {
    const { el } = mountMsa([
      { id: "data/CDS/Bos_taurus.pep.all.fa", seq: "AAAA" },
      { id: "Q5MD89", seq: "AAAA" },
    ], "Q5MD89", 200);
    const names = Array.from(el.querySelectorAll(".msaname")).map(n => n.textContent);
    expect(names).toContain("Bos_taurus.pep.all.fa");
    expect(names).toContain("Q5MD89");
    expect(names.some(n => n?.includes("data/CDS"))).toBe(false);
    expect(el.querySelector(".msaname.isquery")!.textContent).toBe("Q5MD89");
  });

  it("hovering a cell sets the active query residue and shows the tooltip at the mouse", () => {
    const { el } = mountMsa([{ id: "Q", seq: "ACDEFGHIKL" }, { id: "M", seq: "MCDEFGHIKL" }], "Q");
    const setActive = vi.spyOn(bus, "setActive").mockImplementation(() => {});
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    const cell = strip.querySelectorAll<HTMLElement>(".cell")[5];
    cell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 50, clientY: 60 }));
    expect(setActive).toHaveBeenCalledWith(6); // gapless query: col 5 -> residue 6
    const tip = el.querySelector<HTMLElement>(".msatip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.style.left).toBe("62px"); // clientX + 12
    strip.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(tip.hidden).toBe(true);
    expect(setActive).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it("hovering a cell greys its whole contiguous colour run", () => {
    // cols 0-1 red (all A), col 2 yellow (gap in Q), cols 3-4 blue — same
    // fixture as the colorRuns test above.
    const { el } = mountMsa([
      { id: "Q", seq: "AA-AA" },
      { id: "H", seq: "AACCB" },
      { id: "G", seq: "AABCG" },
    ], "Q");
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    const cells = strip.querySelectorAll<HTMLElement>(".cell");
    cells[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));
    const ranged = Array.from(strip.querySelectorAll(".cell.inrange"));
    expect(ranged.map(c => (c as HTMLElement).dataset.col)).toEqual(["0", "1"]);
    strip.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(strip.querySelectorAll(".cell.inrange")).toHaveLength(0);
  });

  it("clicking a cell reports the query position via onPositionClick", () => {
    const { el, onPositionClick } = mountMsa([{ id: "Q", seq: "A-CDEF" }, { id: "M", seq: "AACDEF" }], "Q");
    const strip = el.querySelectorAll(".msarow")[1].querySelector(".msastrip")!;
    strip.querySelectorAll<HTMLElement>(".cell")[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(2); // col 2 in "A-CDEF" is residue 2
    strip.querySelectorAll<HTMLElement>(".cell")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(null); // gap column
  });

  it("markPosition highlights the matching column in every chunk row and clears on null", () => {
    const { el, handle } = mountMsa([{ id: "Q", seq: "ACDEF" }, { id: "M", seq: "ACDEF" }], "Q", 3);
    handle.markPosition(2); // residue 2 -> column 1
    expect(el.querySelectorAll(".cell.marked")).toHaveLength(2); // one per record row
    expect(el.querySelector(".cell.marked")!.getAttribute("data-col")).toBe("1");
    handle.markPosition(null);
    expect(el.querySelectorAll(".cell.marked")).toHaveLength(0);
  });

  it("scrollToPosition scrolls the owning chunk into view", () => {
    const scrollIntoView = vi.fn();
    const orig = Element.prototype.scrollIntoView; // undefined in jsdom
    Element.prototype.scrollIntoView = scrollIntoView;
    const seq = "A".repeat(50);
    const { handle } = mountMsa([{ id: "Q", seq }, { id: "M", seq }], "Q", 20);
    handle.scrollToPosition(45); // residue 45 -> column 44 -> chunk 2 (40-49)
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    Element.prototype.scrollIntoView = orig;
  });
});
```

Remove the now-duplicated import-fix instruction that followed (the imports were already updated at the top of this step).

- [ ] **Step 4: Run frontend tests to verify they fail**

Run: `cd webui && npm test -- --run test/msa.test.ts`
Expected: FAIL — `baseName`/`rulerFor` not exported, no `.msachunk` elements.

- [ ] **Step 5: Implement `webui/src/msa.ts` (full rewrite)**

```ts
import { bus } from "./sync";
// Only the latest render's bus listeners stay attached: re-registering on every
// renderMsa call unsubscribes the previous closures (which referenced a
// now-detached subtree).
let unsubActive: (() => void) | null = null;
let unsubMarked: (() => void) | null = null;

export type CellColor = "red" | "blue" | "yellow";
export function colorForColumn(seqs: string[], col: number): CellColor {
  const chars = seqs.map(s => s[col] ?? "-");
  if (chars.some(c => c === "-")) return "yellow";
  if (chars.every(c => c === chars[0])) return "red";
  return "blue";
}

export interface MsaData { query: string; records: { id: string; seq: string }[] }

// True query residue number per MSA column (counts non-gap chars in the query
// row), so hover/click link to the chart by real residue position.
export function queryPositions(msa: MsaData): (number | null)[] {
  const q = querySeq(msa);
  let count = 0;
  return q.split("").map(ch => {
    if (ch === "-") return null;
    count += 1;
    return count;
  });
}

// The query row's gapped sequence (empty string when there are no records).
export function querySeq(msa: MsaData): string {
  return (msa.records.find(r => r.id === msa.query) ?? msa.records[0])?.seq ?? "";
}

export interface ColorRun { color: CellColor; text: string }

// Run-length encode one alignment row (kept for callers/tests that want runs).
export function colorRuns(seqs: string[], row: number): ColorRun[] {
  const seq = seqs[row] ?? "";
  const runs: ColorRun[] = [];
  for (let c = 0; c < seq.length; c++) {
    const color = colorForColumn(seqs, c);
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.text += seq[c];
    else runs.push({ color, text: seq[c] });
  }
  return runs;
}

// "data/CDS/Bos_taurus.ARS-UCD1.2.pep.all.fa" -> "Bos_taurus.ARS-UCD1.2.pep.all.fa"
export function baseName(id: string): string {
  const parts = id.split(/[\\/]/);
  return parts[parts.length - 1] || id;
}

// Two-line ruler for one chunk, EXACTLY `len` chars per line, using absolute
// 1-based alignment columns: "|" ticks and right-aligned labels at multiples
// of 10. Rendered in the same font/size as the sequence strips so columns line
// up character-for-character (white-space: pre).
export function rulerFor(startCol: number, len: number): string {
  const tick = Array.from({ length: len }, (_, i) => ((startCol + i + 1) % 10 === 0 ? "|" : " "));
  const label = Array.from({ length: len }, () => " ");
  for (let c = Math.ceil((startCol + 1) / 10) * 10; c <= startCol + len; c += 10) {
    const s = String(c);
    const end = c - startCol - 1; // 0-based index of the label's last digit
    for (let k = 0; k < s.length && end - s.length + 1 + k >= 0; k++) {
      label[end - s.length + 1 + k] = s[k];
    }
  }
  return `${label.join("")}\n${tick.join("")}`;
}

export interface MsaHandle {
  scrollToPosition(pos: number): void;
  markPosition(pos: number | null): void;
}

function clearRange(strip: HTMLElement): void {
  strip.querySelectorAll(".cell.inrange").forEach(n => n.classList.remove("inrange"));
}

function onCellHover(e: MouseEvent, strip: HTMLElement, qpos: (number | null)[], tip: HTMLElement): void {
  const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!t || !strip.contains(t)) return;
  const col = Number(t.dataset.col);
  bus.setActive(qpos[col] ?? null);
  clearRange(strip);
  // Grey the whole contiguous same-colour run so grouped regions read as one
  // range, while the single hovered letter keeps its own outline.
  const color = ["red", "blue", "yellow"].find(c => t.classList.contains(c));
  if (color) {
    let a: Element = t;
    let b: Element = t;
    while (a.previousElementSibling?.classList.contains(color)) a = a.previousElementSibling;
    while (b.nextElementSibling?.classList.contains(color)) b = b.nextElementSibling;
    const start = Number((a as HTMLElement).dataset.col);
    const end = Number((b as HTMLElement).dataset.col);
    for (let n: Element | null = a; n; n = n.nextElementSibling) {
      n.classList.add("inrange");
      if (n === b) break;
    }
    tip.textContent = end > start
      ? `Cols ${start + 1}–${end + 1} · query ${qpos[col] ?? "gap"}`
      : `Col ${col + 1} · query ${qpos[col] ?? "gap"} · ${t.textContent}`;
  }
  tip.style.left = `${e.clientX + 12}px`;
  tip.style.top = `${e.clientY + 14}px`;
  tip.hidden = false;
}

export function renderMsa(
  el: HTMLElement,
  msa: MsaData,
  opts: { wrap?: number; onPositionClick?: (pos: number | null) => void } = {},
): MsaHandle {
  const wrap = Math.max(1, opts.wrap ?? 200);
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  const nCols = Math.max(...seqs.map(s => s.length), 0);
  el.innerHTML = "";

  const head = document.createElement("div");
  head.className = "msahead";
  head.innerHTML = `<span class="legend"><i class="sw red"></i>conserved <i class="sw blue"></i>differs <i class="sw yellow"></i>gap · one letter = one position · click a column to mark it</span>`;
  el.appendChild(head);
  const viewport = document.createElement("div");
  viewport.className = "msaviewport";
  el.appendChild(viewport);
  const tip = document.createElement("div");
  tip.className = "msatip";
  tip.hidden = true;
  el.appendChild(tip);

  for (let start = 0; start < nCols; start += wrap) {
    const len = Math.min(wrap, nCols - start);
    const chunk = document.createElement("div");
    chunk.className = "msachunk";
    chunk.dataset.start = String(start);
    const ch = document.createElement("div");
    ch.className = "chunkhead";
    ch.textContent = `Columns ${start + 1}–${start + len}`;
    chunk.appendChild(ch);
    const block = document.createElement("div");
    block.className = "msablock";
    chunk.appendChild(block);

    // Ruler row: same .msastrip font as sequence rows so it aligns exactly.
    const rrow = document.createElement("div");
    rrow.className = "msarow";
    const rsp = document.createElement("span");
    rsp.className = "msaname";
    rrow.appendChild(rsp);
    const ruler = document.createElement("span");
    ruler.className = "msastrip msaruler";
    ruler.textContent = rulerFor(start, len);
    rrow.appendChild(ruler);
    block.appendChild(rrow);

    msa.records.forEach((rec, rowIdx) => {
      const row = document.createElement("div");
      row.className = "msarow";
      const name = document.createElement("span");
      name.className = "msaname";
      name.textContent = baseName(rec.id);
      name.title = rec.id; // full path on hover
      if (rec.id === msa.query) name.classList.add("isquery");
      row.appendChild(name);
      const strip = document.createElement("span");
      strip.className = "msastrip";
      for (let c = start; c < start + len; c++) {
        const s = document.createElement("span");
        s.className = `cell ${colorForColumn(seqs, c)}`;
        s.dataset.col = String(c);
        s.textContent = rec.seq[c] ?? "-";
        strip.appendChild(s);
      }
      strip.addEventListener("mousemove", (e) => onCellHover(e, strip, qpos, tip));
      strip.addEventListener("mouseleave", () => { clearRange(strip); tip.hidden = true; bus.setActive(null); });
      strip.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>(".cell");
        if (t && strip.contains(t)) opts.onPositionClick?.(qpos[Number(t.dataset.col)] ?? null);
      });
      row.appendChild(strip);
      block.appendChild(row);
    });
    viewport.appendChild(chunk);
  }

  const colCells = (col: number) => el.querySelectorAll<HTMLElement>(`.cell[data-col="${col}"]`);
  const handle: MsaHandle = {
    scrollToPosition(pos) {
      const col = qpos.indexOf(pos);
      if (col < 0) return;
      const chunkEl = viewport.querySelectorAll<HTMLElement>(".msachunk")[Math.floor(col / wrap)];
      chunkEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const block = chunkEl?.querySelector<HTMLElement>(".msablock");
      const cell = chunkEl?.querySelector<HTMLElement>(`.cell[data-col="${col}"]`);
      if (block && cell) {
        // rect math works regardless of CSS offsetParent chains
        const d = cell.getBoundingClientRect().left - block.getBoundingClientRect().left;
        block.scrollLeft += d - (block.clientWidth - cell.getBoundingClientRect().width) / 2;
      }
    },
    markPosition(pos) {
      el.querySelectorAll(".cell.marked").forEach(n => n.classList.remove("marked"));
      if (pos == null) return;
      const col = qpos.indexOf(pos);
      if (col >= 0) colCells(col).forEach(n => n.classList.add("marked"));
    },
  };

  unsubActive?.();
  unsubMarked?.();
  unsubActive = bus.onActive(pos => {
    const col = pos == null ? -1 : qpos.indexOf(pos);
    el.querySelectorAll<HTMLElement>(".cell").forEach(n => {
      n.classList.toggle("active", col >= 0 && Number(n.dataset.col) === col);
    });
  });
  unsubMarked = bus.onMarked(pos => handle.markPosition(pos));
  return handle;
}
```

Note for the implementer: hover active styling is now exact per column (`data-col === col`) instead of the old run-range guess; the `.cell.active` CSS class is reused. `.cell.active` outline (Task 6) visually distinguishes it from `.cell.inrange` grey.

- [ ] **Step 6: Run all tests**

Run: `cd webui && npm test -- --run test/msa.test.ts && cd .. && uv run pytest tests/web -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/parsing.py web/app.py webui/src/msa.ts webui/test/msa.test.ts tests/web/test_parsing.py
git commit -m "feat(webui): chunked MSA view with basenames, aligned ruler, hover ranges and markers"
```

---

### Task 4: Query sequence — align with the MSA (chunked, gapped), markers

**Files:**
- Modify: `webui/src/sequence.ts`
- Test: create `webui/test/sequence.test.ts`

**Interfaces:**
- Consumes: `querySeq`, `queryPositions` from msa.ts (Task 3); `bus` channels (Task 1).
- Produces: `renderSequence(el, rows, opts?)` — new optional `opts = { msa?: MsaData; wrap?: number; onPositionClick?: (pos: number | null) => void }`. When `opts.msa` is given, renders the gapped query in chunks of `wrap` columns using the same 11px mono strip style as the MSA so rows align visually; without it, keeps the legacy flat strip. `main.ts` always passes `msa` + `wrap` (Task 6).
- CSS classes consumed by Task 6: `.seqchunk`, `.seqstrip.aligned`, `.res.gap`, `.res.marked`.

- [ ] **Step 1: Write the failing test**

Create `webui/test/sequence.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderSequence } from "../src/sequence";
import { bus } from "../src/sync";

const rows = [
  { position: 1, aa: "A" },
  { position: 2, aa: "C" },
  { position: 3, aa: "D" },
  { position: 4, aa: "E" },
];
const msa = { query: "Q", records: [{ id: "Q", seq: "AC-DE" }, { id: "H", seq: "ACADE" }] };

beforeEach(() => { document.body.innerHTML = ""; });

describe("renderSequence aligned to the MSA", () => {
  it("renders the gapped query chunked to wrap columns with one span per column", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderSequence(el, rows, { msa, wrap: 4 });
    const chunks = el.querySelectorAll(".seqchunk");
    expect(chunks).toHaveLength(2); // 4 + 1 columns
    const first = chunks[0].querySelectorAll(".res");
    expect(first).toHaveLength(4); // includes the gap column
    expect(chunks[0].querySelectorAll(".res.gap")).toHaveLength(1); // column 2
    expect((first[3] as HTMLElement).dataset.pos).toBe("3"); // gap skipped in numbering
  });
  it("hover marks the active residue, shows a tooltip at the mouse; click reports the position; bus.onMarked marks it", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onPositionClick = vi.fn();
    renderSequence(el, rows, { msa, wrap: 200, onPositionClick });
    const setActive = vi.spyOn(bus, "setActive").mockImplementation(() => {});
    const res = el.querySelectorAll<HTMLElement>(".res:not(.gap)");
    res[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 30, clientY: 40 }));
    expect(setActive).toHaveBeenCalledWith(2);
    const tip = el.querySelector<HTMLElement>(".msatip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain("Position 2");
    expect(tip.style.left).toBe("42px"); // clientX + 12
    res[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPositionClick).toHaveBeenCalledWith(2);
    bus.setMarked(2);
    expect(res[1].classList.contains("marked")).toBe(true);
    bus.setMarked(null);
    expect(res[1].classList.contains("marked")).toBe(false);
    vi.restoreAllMocks();
  });
  it("keeps the legacy flat strip when no msa is provided", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderSequence(el, rows);
    expect(el.querySelectorAll(".res")).toHaveLength(4);
    expect(el.querySelectorAll(".seqchunk")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd webui && npm test -- --run test/sequence.test.ts`
Expected: FAIL — no `.seqchunk` rendered.

- [ ] **Step 3: Implement `webui/src/sequence.ts` (full rewrite)**

```ts
import { bus } from "./sync";
import { querySeq } from "./msa";
import type { MsaData } from "./msa";

let unsubActive: (() => void) | null = null;
let unsubMarked: (() => void) | null = null;

// The query sequence card renders the SAME gapped columns as the MSA (same
// 11px monospace strip, same chunk width) so the two cards align
// column-for-column. Residues keep their true `position`; gaps get no pos.
export function renderSequence(
  el: HTMLElement,
  rows: any[],
  opts: { msa?: MsaData; wrap?: number; onPositionClick?: (pos: number | null) => void } = {},
): void {
  el.innerHTML = "";
  const wrapEl = document.createElement("div");

  if (opts.msa) {
    const wrap = Math.max(1, opts.wrap ?? 200);
    const gapped = querySeq(opts.msa);
    let pos = 0;
    for (let start = 0; start < gapped.length; start += wrap) {
      const chunk = document.createElement("div");
      chunk.className = "seqchunk";
      const strip = document.createElement("span");
      strip.className = "seqstrip aligned";
      for (const ch of gapped.slice(start, start + wrap)) {
        const s = document.createElement("span");
        s.className = ch === "-" ? "res gap" : "res";
        if (ch !== "-") {
          pos += 1;
          s.dataset.pos = String(pos);
        }
        s.textContent = ch;
        strip.appendChild(s);
      }
      chunk.appendChild(strip);
      wrapEl.appendChild(chunk);
    }
  } else {
    // Legacy flat strip (ungapped score rows).
    wrapEl.className = "seqstrip";
    rows.forEach(r => {
      const s = document.createElement("span");
      s.className = "res";
      s.dataset.pos = String(r.position);
      s.textContent = r.aa;
      wrapEl.appendChild(s);
    });
  }
  el.appendChild(wrapEl);
  // Mouse-local tooltip (same .msatip pattern as the MSA) so the position popup
  // appears where the mouse is instead of only up on the chart.
  const tip = document.createElement("div");
  tip.className = "msatip";
  tip.hidden = true;
  el.appendChild(tip);

  // Delegated hover/click on residue spans (gap spans have no data-pos).
  wrapEl.addEventListener("mouseover", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".res");
    if (!t?.dataset.pos) return;
    bus.setActive(Number(t.dataset.pos));
    const r = rows[Number(t.dataset.pos) - 1]; // score rows are 1-based, sequential
    tip.textContent = r ? `Position ${r.position} (${r.aa}) · min ${r.min}` : `Position ${t.dataset.pos}`;
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.hidden = false;
  });
  wrapEl.addEventListener("mouseleave", () => { bus.setActive(null); tip.hidden = true; });
  wrapEl.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".res");
    if (t?.dataset.pos) opts.onPositionClick?.(Number(t.dataset.pos));
  });

  unsubActive?.();
  unsubMarked?.();
  unsubActive = bus.onActive(p => {
    wrapEl.querySelectorAll<HTMLElement>(".res").forEach(n =>
      n.classList.toggle("active", p != null && Number(n.dataset.pos) === p));
  });
  unsubMarked = bus.onMarked(p => {
    wrapEl.querySelectorAll<HTMLElement>(".res").forEach(n =>
      n.classList.toggle("marked", p != null && Number(n.dataset.pos) === p));
  });
}
```

(The old per-span `onmouseenter` handlers become delegated listeners; the legacy strip behaviour is otherwise unchanged, so nothing else in the app breaks.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd webui && npm test -- --run test/sequence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/sequence.ts webui/test/sequence.test.ts
git commit -m "feat(webui): align query sequence to MSA columns with markers"
```

---

### Task 5: Search — explicit button, accession resolution, richer hits, recent searches; run-panel resolve flow

**Files:**
- Create: `webui/src/recent.ts`
- Rewrite: `webui/src/search.ts`
- Modify: `webui/src/run.ts`
- Modify: `webui/src/info.ts` (New search button)
- Modify: `web/uniprot.py` (add `protein_name` to hits)
- Test: `webui/test/search.test.ts` (rewrite), create `webui/test/recent.test.ts`, `webui/test/run.test.ts` (mock update + new tests), `tests/web/test_uniprot.py` (extend)

**Interfaces:**
- Consumes: existing `fetchSearch`, `fetchResolve` from api.ts (no api.ts changes).
- Produces:
  - `SearchHit` gains `protein: string`, optional `resolvedFrom?: string`, `resolveNote?: string`.
  - `isAccessionQuery(q): string[]`, `runQuery(q): Promise<SearchHit[]>`, `accessionHits(acc): Promise<SearchHit[]>` from search.ts.
  - `loadRecent(): RecentEntry[]`, `pushRecent({q}): RecentEntry[]` from recent.ts; storage key `epictope.recentSearches`, capped at 10.
  - `renderResultsHeader(el, info, onSiteClick, onChartPng, onNewSearch)` — 5th callback added (main.ts, Task 6).
  - `mountSearch(root, onSelect)` — signature unchanged; button/Enter-triggered.

- [ ] **Step 1: recent.ts + tests**

Create `webui/test/recent.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadRecent, pushRecent } from "../src/recent";

describe("recent searches", () => {
  beforeEach(() => localStorage.clear());
  it("starts empty and survives corrupt storage", () => {
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("epictope.recentSearches", "{not json");
    expect(loadRecent()).toEqual([]);
  });
  it("prepends, dedupes by query, and caps at 10", () => {
    for (let i = 0; i < 12; i++) pushRecent({ q: `q${i}` });
    pushRecent({ q: "q5" }); // duplicate moves to front
    const list = loadRecent();
    expect(list).toHaveLength(10);
    expect(list[0].q).toBe("q5");
    expect(list[1].q).toBe("q11");
  });
});
```

Create `webui/src/recent.ts`:

```ts
// Last 10 searches, persisted in localStorage so the search page can offer
// one-click re-runs. Best-effort: private-mode storage failures are ignored.
export interface RecentEntry { q: string; at: number }
const KEY = "epictope.recentSearches";

export function loadRecent(): RecentEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(e => e && typeof e.q === "string").slice(0, 10);
  } catch {
    return [];
  }
}

export function pushRecent(e: { q: string }): RecentEntry[] {
  const list = loadRecent().filter(x => x.q !== e.q);
  list.unshift({ q: e.q, at: Date.now() });
  const trimmed = list.slice(0, 10);
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  return trimmed;
}
```

Run: `cd webui && npm test -- --run test/recent.test.ts` → PASS.

- [ ] **Step 2: Backend — add protein name to search hits**

Extend `tests/web/test_uniprot.py` — in `test_search_parses_json`, add to the fake entry:

```python
         "proteinDescription": {"recommendedName": {"fullName": {"value": "Mothers against decapentaplegic homolog 5"}}},
```

and to the assertions:

```python
    assert rows[0]["protein"] == "Mothers against decapentaplegic homolog 5"
```

In `web/uniprot.py`, change the `fields` param to include `protein_name`:

```python
              "fields": "accession,id,gene_names,organism_name,protein_name,reviewed,xref_alphafolddb",
```

and in the `out.append({...})` dict add (after `gene`):

```python
            "protein": (r.get("proteinDescription", {}).get("recommendedName", {})
                         .get("fullName", {}).get("value", "")),
```

Run: `uv run pytest tests/web/test_uniprot.py -q` → PASS.

- [ ] **Step 3: search.ts rewrite + tests**

Rewrite `webui/test/search.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSearch, runQuery, isAccessionQuery, type SearchHit } from "../src/search";

const reviewedHit: SearchHit = { accession: "Q5MD89", gene: "flt4", organism: "Danio rerio",
  protein: "Vascular endothelial growth factor receptor 3", reviewed: true, hasAlphaFold: true };
const tremblHit: SearchHit = { accession: "A0A2R8QSE0", gene: "flt4", organism: "Danio rerio",
  protein: "", reviewed: false, hasAlphaFold: false };

let searchMock: any;
let resolveMock: any;
vi.mock("../src/api", () => ({
  fetchSearch: (...a: any[]) => searchMock(...a),
  fetchResolve: (...a: any[]) => resolveMock(...a),
}));
// NOTE: assert on searchMock/resolveMock, never on the re-imported fetchSearch —
// the mock factory exports plain arrow wrappers, which are not vi.fn instances.

function mount(onSelect = vi.fn()) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountSearch(root, onSelect);
  return { root, onSelect,
           input: root.querySelector("input")!,
           button: root.querySelector<HTMLButtonElement>(".searchbtn")! };
}

describe("isAccessionQuery", () => {
  it("recognises UniProt accessions, not gene names", () => {
    expect(isAccessionQuery("A0A2R8QSE0")).toEqual(["A0A2R8QSE0"]);
    expect(isAccessionQuery("Q5MD89")).toEqual(["Q5MD89"]);
    expect(isAccessionQuery("smad5")).toEqual([]);
    expect(isAccessionQuery("TP53")).toEqual([]);
    expect(isAccessionQuery("A0A2R8QSE0, A0A0R4IFS9")).toEqual(["A0A2R8QSE0", "A0A0R4IFS9"]);
  });
});

describe("runQuery", () => {
  beforeEach(() => { searchMock = vi.fn(async () => []); resolveMock = vi.fn(async () => []); });
  it("plain terms go straight to /api/search", async () => {
    searchMock = vi.fn(async (q: string) => (q === "smad5" ? [reviewedHit] : []));
    expect(await runQuery("smad5")).toEqual([reviewedHit]);
    expect(resolveMock).not.toHaveBeenCalled();
  });
  it("an unreviewed accession also yields its resolved reviewed hit", async () => {
    searchMock = vi.fn(async (q: string) =>
      q === "A0A2R8QSE0" ? [tremblHit] : q === "Q5MD89" ? [reviewedHit] : []);
    resolveMock = vi.fn(async (body: any) =>
      body.accessions?.[0] === "A0A2R8QSE0"
        ? [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89",
             note: "resolved to reviewed ortholog (gene=flt4)" }]
        : []);
    const hits = await runQuery("A0A2R8QSE0");
    expect(hits[0].accession).toBe("Q5MD89");
    expect(hits[0].resolvedFrom).toBe("A0A2R8QSE0");
    expect(hits[1].accession).toBe("A0A2R8QSE0");
  });
});

describe("mountSearch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    searchMock = vi.fn(async (q: string) => (q === "smad5" ? [reviewedHit] : []));
    resolveMock = vi.fn(async () => []);
  });

  it("does NOT search while typing; the button runs the search", async () => {
    const { root, input, button } = mount();
    input.value = "smad5";
    input.dispatchEvent(new Event("input"));
    expect(searchMock).not.toHaveBeenCalled();
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Vascular endothelial growth factor receptor 3");
  });

  it("Enter in the input runs the search; Enter on a hit selects it", async () => {
    const { root, input, onSelect } = mount();
    input.value = "smad5";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(reviewedHit);
  });

  it("records the search in recent and renders a clickable recent chip", async () => {
    const { root, input, button } = mount();
    input.value = "smad5";
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    const chip = root.querySelector<HTMLButtonElement>(".recent button");
    expect(chip?.textContent).toBe("smad5");
    searchMock.mockClear();
    chip!.click();
    await vi.waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("smad5");
  });

  it("shows protein name and a resolved badge on resolved hits", async () => {
    searchMock = vi.fn(async (q: string) => (q === "Q5MD89" ? [reviewedHit] : []));
    resolveMock = vi.fn(async () => [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89", note: "n" }]);
    const { root, input, button } = mount();
    input.value = "A0A2R8QSE0";
    button.click();
    await vi.waitFor(() => expect(root.querySelectorAll("[role=option]")).toHaveLength(1));
    expect(root.textContent).toContain("from A0A2R8QSE0");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd webui && npm test -- --run test/search.test.ts`
Expected: FAIL — `isAccessionQuery`/`runQuery` not exported, no `.searchbtn`.

- [ ] **Step 5: Implement `webui/src/search.ts` (full rewrite)**

```ts
import { fetchSearch, fetchResolve } from "./api";
import { loadRecent, pushRecent } from "./recent";

export interface SearchHit {
  accession: string; gene: string; organism: string; protein: string;
  reviewed: boolean; hasAlphaFold: boolean;
  resolvedFrom?: string;   // typed accession that resolved to this hit
  resolveNote?: string;
}

// Canonical UniProt accession pattern (Q5MD89, Q9W7E7, A0A2R8QSE0, P12345);
// gene names like smad5/flt4/TP53 do NOT match.
const ACC_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

// Accession list when EVERY whitespace/comma-separated token is an accession.
export function isAccessionQuery(q: string): string[] {
  const toks = q.split(/[\s,]+/).filter(Boolean);
  return toks.length > 0 && toks.every(t => ACC_RE.test(t)) ? toks : [];
}

// One accession: direct search + resolve, merged with the resolved hit first.
export async function accessionHits(acc: string): Promise<SearchHit[]> {
  const [direct, res] = await Promise.all([
    fetchSearch(acc).catch(() => [] as SearchHit[]),
    fetchResolve([acc]).then((r: any[]) => r[0]).catch(() => null),
  ]);
  const hits: SearchHit[] = [];
  if (res?.resolved && res.resolved.toUpperCase() !== acc.toUpperCase()) {
    const target = (await fetchSearch(res.resolved).catch(() => [] as SearchHit[]))
      .find((h: SearchHit) => h.accession === res.resolved);
    hits.push({
      ...(target ?? { accession: res.resolved, gene: "", organism: "", protein: "",
                      reviewed: true, hasAlphaFold: !!res.af_id }),
      resolvedFrom: acc,
      resolveNote: res.note ?? "",
    });
  }
  hits.push(...direct);
  return hits;
}

export async function runQuery(q: string): Promise<SearchHit[]> {
  const accs = isAccessionQuery(q);
  if (!accs.length) return fetchSearch(q);
  const per = await Promise.all(accs.map(accessionHits));
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of per.flat()) {
    const key = h.resolvedFrom ? `${h.accession}<-${h.resolvedFrom}` : h.accession;
    if (!seen.has(key)) { seen.add(key); out.push(h); }
  }
  return out;
}

export function mountSearch(root: HTMLElement, onSelect: (hit: SearchHit) => void): void {
  root.innerHTML = `
    <div class="searchbox">
      <input type="search" placeholder="Gene, accession, or organism — e.g. smad5 or Q9W7E7"
             aria-label="Search UniProt" autocomplete="off" spellcheck="false"/>
      <button class="primary searchbtn" type="button">Search</button>
    </div>
    <div class="recent" hidden></div>`;
  const input = root.querySelector("input")!;
  const btn = root.querySelector<HTMLButtonElement>(".searchbtn")!;
  const recentEl = root.querySelector<HTMLElement>(".recent")!;
  let reqId = 0;
  let active = -1;
  let hits: SearchHit[] = [];

  const close = () => { root.querySelector("[role=listbox]")?.remove(); active = -1; hits = []; };

  const open = (items: SearchHit[], q: string, loading = false) => {
    close();
    hits = items;
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.className = "autocomplete";
    if (loading) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `Searching UniProt for '${q}'…`;
      ul.appendChild(li);
    } else if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No UniProt entries match '${q}'`;
      ul.appendChild(li);
    } else {
      items.forEach((h, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<b>${h.accession}</b> ${h.gene} <span class="org">${h.organism}</span>
          ${h.protein ? `<span class="prot">${h.protein}</span>` : ""}
          ${h.reviewed ? '<span class="tag">reviewed</span>' : ""}
          ${h.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : '<span class="tag warn">no AlphaFold</span>'}
          ${h.resolvedFrom ? `<span class="tag resolved">from ${h.resolvedFrom}</span>` : ""}`;
        li.addEventListener("click", () => { onSelect(h); close(); });
        li.dataset.index = String(i);
        ul.appendChild(li);
      });
    }
    root.querySelector(".searchbox")!.appendChild(ul);
  };

  const renderRecent = () => {
    const list = loadRecent();
    recentEl.hidden = list.length === 0;
    recentEl.innerHTML = list.length ? `<span class="recentlabel">Recent:</span>` : "";
    list.forEach(e => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e.q;
      b.addEventListener("click", () => { input.value = e.q; submit(); });
      recentEl.appendChild(b);
    });
  };
  renderRecent();

  const submit = async () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    const id = ++reqId;
    open([], q, true);
    const rows = await runQuery(q).catch(() => [] as SearchHit[]);
    if (id !== reqId) return; // a newer search superseded this one
    pushRecent({ q });
    renderRecent();
    open(rows, q);
  };

  btn.addEventListener("click", submit);

  const markActive = () => {
    root.querySelectorAll("[role=option]").forEach((li, i) =>
      li.classList.toggle("active", i === active));
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown" && hits.length) { active = Math.min(hits.length - 1, active + 1); markActive(); e.preventDefault(); return; }
    if (e.key === "ArrowUp" && hits.length) { active = Math.max(0, active - 1); markActive(); e.preventDefault(); return; }
    if (e.key === "Enter") {
      if (active >= 0 && hits[active]) { onSelect(hits[active]); close(); }
      else submit();
      e.preventDefault();
    }
  });
}
```

- [ ] **Step 6: Run to verify search tests pass**

Run: `cd webui && npm test -- --run test/search.test.ts test/recent.test.ts`
Expected: PASS.

- [ ] **Step 7: run.ts — resolve-on-select for AlphaFold-less hits**

In `webui/test/run.test.ts`:

a) Add `fetchResolve` to the api mock (inside the existing `vi.mock("../src/api", () => ({...}))`):

```ts
  fetchResolve: (...a: any[]) => resolveMock(...a),
```

and near the other swappable mocks:

```ts
let resolveMock: any = vi.fn(async () => [{ input: "X", resolved: null, note: "no reviewed entry found" }]);
```

Reset it in `beforeEach`:

```ts
    resolveMock = vi.fn(async () => [{ input: "X", resolved: null, note: "no reviewed entry found" }]);
```

b) Add tests inside `describe("mountRunPanel")`:

```ts
  it("offers the resolved reviewed accession when the hit has no AlphaFold model", async () => {
    resolveMock = vi.fn(async () => [{ input: "A0A2R8QSE0", resolved: "Q5MD89", af_id: "Q5MD89",
      note: "resolved to reviewed ortholog (gene=flt4)" }]);
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select({ ...hit, accession: "A0A2R8QSE0", hasAlphaFold: false });
    await vi.advanceTimersByTimeAsync(0);
    const use = root.querySelector<HTMLButtonElement>("button.useresolved");
    expect(use?.textContent).toContain("Q5MD89");
    expect(root.querySelector(".resolve-note")!.textContent).toContain("reviewed ortholog");
    use!.click();
    await vi.advanceTimersByTimeAsync(0); // re-select + cache probe settle
    expect(root.querySelector(".selmain")!.textContent).toContain("Q5MD89");
    expect(root.querySelector(".resolve-note")!.textContent).toContain("A0A2R8QSE0");
  });

  it("points at the custom-structure upload when nothing resolves", async () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select({ ...hit, accession: "A0A0R4IFS9", hasAlphaFold: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector(".resolve-note")!.textContent).toContain("custom structure");
    expect(root.querySelector<HTMLDetailsElement>("details.advanced")!.open).toBe(true);
  });
```

c) In `webui/src/run.ts`:

Add `fetchResolve` to the import:

```ts
import { runPrediction, fetchJob, fetchScore, fetchResolve, ApiError } from "./api";
```

Then replace the entire `return { select(hit) { … }, clear() { … } }` block (lines 34–95 of the current file) with the code below. `select` becomes a hoisted named function so the "Use resolved accession" button can re-select recursively:

```ts
  function select(hit: SearchHit): void {
    gen += 1;
    root.innerHTML = `
      <div class="card selected">
        <div class="selmain">
          <h2>${hit.gene || hit.accession}</h2>
          <p class="sub">${hit.accession} · ${hit.organism}
            ${hit.reviewed ? '<span class="tag">reviewed</span>' : ""}
            ${hit.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : '<span class="tag warn">no AlphaFold</span>'}</p>
          ${hit.protein ? `<p class="sub">${hit.protein}</p>` : ""}
        </div>
        <button class="primary">Run prediction</button>
      </div>
      <p class="resolve-note hint" hidden></p>
      <details class="advanced">
        <summary>Advanced options <span class="hint">(optional — custom structure)</span></summary>
        <div class="advbody">
          <p class="hint">Only needed if this protein has no AlphaFold model. Upload a custom
             .cif structure and, if it covers only part of the protein, the N-terminal residue
             of the structure.</p>
          <label>Custom structure (.cif) <input type="file" accept=".cif" class="cif"/></label>
          <label>N-terminal residue <input type="number" min="1" class="nterm" placeholder="1"/></label>
        </div>
      </details>
      <p class="progress" hidden></p>`;
    const btn = root.querySelector<HTMLButtonElement>("button.primary")!;
    const progress = root.querySelector<HTMLElement>(".progress")!;
    const note = root.querySelector<HTMLElement>(".resolve-note")!;

    // Where this hit came from a resolution, say so.
    if (hit.resolvedFrom) {
      note.hidden = false;
      note.textContent = `Resolved from ${hit.resolvedFrom}${hit.resolveNote ? ` — ${hit.resolveNote}` : ""}`;
    }

    // No AlphaFold model on the selected entry: try to resolve to a reviewed
    // ortholog (e.g. A0A2R8QSE0 -> Q5MD89) and offer a one-click switch.
    if (!hit.hasAlphaFold) {
      const g = gen;
      note.hidden = false;
      note.textContent = `${hit.accession} has no AlphaFold model — checking for a reviewed entry…`;
      fetchResolve([hit.accession]).then((rows: any[]) => {
        if (g !== gen) return; // cleared or re-selected mid-request
        const r = rows?.[0];
        if (r?.resolved && r.resolved !== hit.accession) {
          note.textContent = `${r.note ?? "A reviewed entry is available."} `;
          const use = document.createElement("button");
          use.type = "button";
          use.className = "useresolved";
          use.textContent = `Use ${r.resolved}`;
          use.onclick = () => select({ ...hit, accession: r.resolved, hasAlphaFold: true,
                                       resolvedFrom: hit.accession, resolveNote: r.note ?? "" });
          note.appendChild(use);
        } else {
          note.textContent = `${r?.note ?? "No reviewed entry with an AlphaFold model was found."} Upload a custom structure below to run anyway.`;
          root.querySelector<HTMLDetailsElement>("details.advanced")!.open = true;
        }
      }).catch(() => {
        if (g === gen) note.textContent = "Could not check for a reviewed entry (network error).";
      });
    }

    // Cache probe: results already on disk => offer "View results" (no POST).
    let cached = false;
    fetchScore(hit.accession)
      .then(() => { cached = true; btn.textContent = "View results"; })
      .catch(() => { /* not cached — keep "Run prediction" */ });
    btn.onclick = async () => {
      if (cached) { onDone(hit.accession); return; }
      const g = gen;
      btn.disabled = true;
      progress.hidden = false;
      progress.textContent = `Running prediction for ${hit.accession}… this can take several minutes.`;
      const nterm = root.querySelector<HTMLInputElement>(".nterm")!.value;
      const file = root.querySelector<HTMLInputElement>(".cif")!.files?.[0] ?? null;
      try {
        const { job_id } = await runPrediction(hit.accession, nterm ? Number(nterm) : null, file);
        if (g !== gen) return; // cleared or re-selected while POSTing
        poll(job_id, hit.accession, g);
      } catch (e) {
        if (g !== gen) return; // cleared or re-selected mid-request: no callbacks
        btn.disabled = false;
        if (e instanceof ApiError && e.status === 503) {
          // Reference data still downloading: keep the panel usable, show why.
          progress.textContent = e.message;
        } else {
          progress.hidden = true;
          onError(hit.accession, e instanceof Error ? e.message : String(e));
        }
      }
    };
  }

  return {
    select,
    clear(): void {
      gen += 1;
      if (timer) clearTimeout(timer);
      root.innerHTML = "";
    },
  };
```

Note: the first test's existing `hit` has `protein` undefined — the template guard `${hit.protein ? ... : ""}` handles that, so old fixtures keep working. `SearchHit` in run.ts is `import type { SearchHit } from "./search"` — already there.

d) In `webui/src/info.ts`, add the New search button. Change the signature and downloads block:

```ts
export function renderResultsHeader(
  el: HTMLElement,
  info: any,
  onSiteClick: (pos: number) => void,
  onChartPng: () => void,
  onNewSearch: () => void,
): void {
```

and in the downloads div add as the first button:

```html
      <button data-dl="new">New search</button>
```

and after the existing download handlers:

```ts
  el.querySelector<HTMLElement>('[data-dl="new"]')!.onclick = onNewSearch;
```

- [ ] **Step 8: Run all frontend + backend tests**

Run: `cd webui && npm test && cd .. && uv run pytest tests/web -q`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add webui/src/recent.ts webui/src/search.ts webui/src/run.ts webui/src/info.ts web/uniprot.py webui/test/search.test.ts webui/test/recent.test.ts webui/test/run.test.ts tests/web/test_uniprot.py
git commit -m "feat(webui): button-triggered search with accession resolution and recent searches"
```

---

### Task 6: Wiring (main.ts) + stylesheet + print rules + build

**Files:**
- Modify: `webui/src/main.ts`
- Modify: `webui/src/style.css`

**Interfaces:**
- Consumes everything from Tasks 1–5: `parseChunk`, `bus.setMarked/onMarked`, `renderMsa(...): MsaHandle`, `renderSequence(..., {msa, wrap, onPositionClick})`, `renderResultsHeader(..., onNewSearch)`, `pushRecent`.

- [ ] **Step 1: Wire main.ts (five precise edits)**

**Edit A — imports.** Replace:

```ts
import { renderMsa } from "./msa";
```
with:
```ts
import { renderMsa, type MsaHandle } from "./msa";
```

Replace:
```ts
import { parseUrl, setUrl, onUrlChange } from "./state";
```
with:
```ts
import { parseUrl, setUrl, onUrlChange, parseChunk } from "./state";
import { pushRecent } from "./recent";
```

**Edit B — module state.** Replace:

```ts
let chartHandle: MinChartHandle | null = null;
let busUnsub: (() => void) | null = null;
```
with:
```ts
let chartHandle: MinChartHandle | null = null;
let msaHandle: MsaHandle | null = null;
let busUnsub: (() => void) | null = null;
let markUnsub: (() => void) | null = null;
```

**Edit C — showResults body.** Replace this exact block (the second occurrence of the `compact` line — the one inside `showResults`, immediately followed by the `chartHandle` destroy):

```ts
    $("results").hidden = false;
    $("searchZone").classList.add("compact");
    if (chartHandle) { chartHandle.chart.destroy(); chartHandle = null; }
```
with:
```ts
    $("results").hidden = false;
    $("searchZone").classList.add("compact");
    const wrap = parseChunk();
    if (chartHandle) { chartHandle.chart.destroy(); chartHandle = null; }
```

Replace the chip-click callback (chart pin → mark + scroll MSA):

```ts
      (pos) => chartHandle!.pin(pos),
```
with:
```ts
      (pos) => { bus.setMarked(pos); msaHandle?.scrollToPosition(pos); },
```

Replace the PNG-download callback ending:

```ts
        document.body.appendChild(a); a.click(); a.remove();
      });
```
with (adds the 5th `onNewSearch` argument):
```ts
        document.body.appendChild(a); a.click(); a.remove();
      },
      () => {
        // "New search": bring the (compacted) search box back into focus.
        window.scrollTo({ top: 0, behavior: "smooth" });
        const inp = document.querySelector<HTMLInputElement>("#search input");
        inp?.focus(); inp?.select();
      });
```

Replace:
```ts
    renderSequence($("sequence"), rows);
```
with:
```ts
    renderSequence($("sequence"), rows, { msa, wrap, onPositionClick: (pos) => bus.setMarked(pos) });
```

Replace:
```ts
    renderMsa($("msa"), msa);
```
with:
```ts
    msaHandle = renderMsa($("msa"), msa, { wrap, onPositionClick: (pos) => bus.setMarked(pos) });
```

Replace:
```ts
    busUnsub?.(); busUnsub = bus.onActive((pos) => chartHandle?.highlight(pos));
```
with:
```ts
    busUnsub?.(); markUnsub?.();
    busUnsub = bus.onActive((pos) => chartHandle?.highlight(pos));
    markUnsub = bus.onMarked((pos) => chartHandle?.pin(pos));
```

In the `catch (e) {` block of `showResults`, add as its first line (before the existing comment):
```ts
    msaHandle = null;
```

**Edit D — search mount.** Replace:

```ts
mountSearch($("search"), (hit: SearchHit) => {
  $("errorBox").innerHTML = "";
  setUrl(hit.accession);
  runPanel.select(hit);
});
```
with:
```ts
mountSearch($("search"), (hit: SearchHit) => {
  $("errorBox").innerHTML = "";
  pushRecent({ q: hit.accession }); // selections count as recent searches too
  setUrl(hit.accession);
  runPanel.select(hit);
});
```

`showSkeletons`, `showError`, `watchStatus` and the deep-link block at the bottom of `main.ts` are NOT modified.

- [ ] **Step 2: Stylesheet**

a) Replace the `.chip` rules (red text → red box, white text). Old:

```css
.chip { font-variant-numeric: tabular-nums; border-radius: 999px; padding: .25rem .7rem;
        border: 1px solid var(--danger); color: var(--danger); background: transparent; font-size: .85rem; }
.chip:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
```

New:

```css
.chip { font-variant-numeric: tabular-nums; border-radius: 999px; padding: .25rem .7rem;
        border: 1px solid var(--danger); background: var(--danger); color: #fff; font-size: .85rem; }
.chip:hover { background: #991b1b; }
```

b) Replace `.searchbox` (flex row for the Search button). Old:

```css
.searchbox { position: relative; }
```

New:

```css
.searchbox { position: relative; display: flex; gap: .5rem; }
.searchbox input { flex: 1; }
```

c) Replace the `.msaviewport` rule (the horizontal scrollbar moves into per-chunk blocks). Old:

```css
.msaviewport { max-height: 400px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
```

New:

```css
.msaviewport { max-height: 480px; overflow-y: auto; overflow-x: hidden; border: none; }
```

d) Replace the `.msastrip` and `.msaruler` rules (ruler uses the SAME font metrics as sequence strips — this is the alignment fix). Old:

```css
.msastrip { font-family: var(--mono); font-size: 11px; }
.msaruler { color: var(--muted); white-space: pre; font-size: 9px; line-height: 1.2; }
```

New:

```css
.msastrip { position: relative; display: inline-block; font-family: var(--mono);
            font-size: 11px; line-height: 1.5; white-space: pre; }
.msaruler { color: var(--muted); } /* inherits .msastrip font metrics = aligned columns */
```

e) Append at the end of the file:

```css
/* Recent searches */
.recent { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; margin-top: .5rem; }
.recentlabel { color: var(--muted); font-size: .8rem; }
.recent button { font-size: .8rem; padding: .15rem .6rem; border-radius: 999px; }

/* Search hit extras */
.autocomplete .prot { display: block; color: var(--muted); font-size: .82rem; }
.tag.warn { background: var(--danger); }
.tag.resolved { background: #7c3aed; }

/* Resolve note + switch button in the run panel */
.resolve-note { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }

/* MSA chunked layout: each chunk scrolls horizontally on its own, so the page
   never widens and the other cards stay visible. */
.msachunk { margin-bottom: 1rem; }
.chunkhead { font-size: .75rem; color: var(--muted); margin-bottom: .15rem; }
.msablock { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.cell { cursor: pointer; }
.cell:hover { outline: 1px solid var(--ink); outline-offset: -1px; }
.cell.inrange { background: #9ca3af; color: #111827; }
.cell.marked { outline: 2px solid var(--accent); outline-offset: -2px; }
.msaname.isquery { font-weight: 700; color: var(--accent-ink); }
.msatip { position: fixed; z-index: 30; pointer-events: none; background: var(--ink);
          color: var(--card); font-size: .75rem; padding: .2rem .5rem; border-radius: 6px; }

/* Query sequence aligned to the MSA columns */
.seqchunk { margin-bottom: .5rem; }
.seqstrip.aligned { display: inline-block; white-space: pre; font-family: var(--mono);
                    font-size: 11px; line-height: 1.5; }
.seqstrip.aligned .res { padding: 0; }   /* same advance width as MSA cells */
.res.gap { color: var(--muted); }
.res.marked { background: var(--accent); color: #fff; }

@media (prefers-color-scheme: dark) {
  .cell.inrange { background: #6b7280; color: #f8fafc; }
}

/* Print: chunks become the report's lines (~200 columns each); smaller mono
   type keeps a chunk within the page width. Narrower lines? Use ?msa-chunk=N. */
@media print {
  .msablock { overflow: visible; border: none; }
  .msachunk { break-inside: avoid; }
  .msastrip, .msaruler { font-size: 6px; }
  .msaname { width: 90px; font-size: 6px; position: static; }
  .msatip { display: none; }
}
```

The existing `@media print` rule `.msaviewport { max-height: none; overflow: visible; border: none; }` stays as-is (it now complements the new `.msablock` print rule).

- [ ] **Step 3: Type-check, test, build**

Run:
```bash
cd webui && npm test && npm run build && cd .. && uv run pytest tests/web -q
```
Expected: all PASS; `web/static/` regenerated with the new bundle.

- [ ] **Step 4: Manual smoke (optional but recommended)**

```bash
uv run uvicorn web.app:app --port 8000 &
# browse http://localhost:8000, search "A0A2R8QSE0" → Q5MD89 appears with
# "from A0A2R8QSE0" badge; open Q5MD89 results; click a top-site chip → MSA
# scrolls to the column; hover MSA → tooltip follows the mouse, run greys.
```

- [ ] **Step 5: Commit**

```bash
git add webui/src/main.ts webui/src/style.css web/static
git commit -m "feat(webui): wire chunked MSA, aligned sequence, markers and new-search flow"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** UI #1→Task 6 wiring (`scrollToPosition` on chip click); #2→Task 4; #3→Task 3 `baseName`; #4→Task 3 chunking + Task 6 print CSS; #5→Task 2 `hidden`; #6→Task 2 annotation label + Task 6 `.chip`; #7→Task 3 `.msablock` per-chunk scroll + `?msa-chunk=`; #8→Task 3 per-column cells + `.inrange`; #9→Tasks 1/2/3/4/6 `bus.setMarked`; #10→Task 2 tooltip-at-point + Task 3 `.msatip` at mouse; #11→Task 3 per-chunk `rulerFor` + Task 6 font unification; #12→Task 5 "New search" button; #13→Task 5 recent.ts; Search #14→Task 5 `accessionHits` (verified resolver unchanged); #15→Task 5 run-panel resolve flow + protein name; #16→Task 5 button/Enter.
- **Type consistency:** `MsaHandle.scrollToPosition/markPosition`, `renderResultsHeader` 5-arg signature, `SearchHit.protein/resolvedFrom/resolveNote`, `parseChunk`/`DEFAULT_MSA_WRAP`, `querySeq(msa): string` — all match between producing and consuming tasks.
- **Existing-test impact:** chart.test (onClick test replaced), msa.test (two render tests replaced), search.test (rewritten), run.test (mock extended), test_parsing (extended, old assertions hold), test_uniprot (extended). No other suites touched.
