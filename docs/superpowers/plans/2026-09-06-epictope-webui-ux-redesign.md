# EpicTope Web UI — UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the EpicTope web UI around a clean linear flow — search → select → run → stacked results — with a paper-faithful min-score chart, scrollable MSA panel, downloads (CSV/FASTA/PNG/print), and polished accessible styling.

**Architecture:** Backend stays FastAPI; two new streaming download endpoints are added. Frontend stays Vite + vanilla TypeScript + Chart.js 4; `main.ts` is split into focused modules (state, search, run, chart, msa, downloads), the per-residue table is deleted in favor of CSV download, and styling is a single token-driven `style.css`.

**Tech Stack:** FastAPI + pytest (backend), Vite + TypeScript + Chart.js 4 + chartjs-plugin-annotation + chartjs-plugin-zoom + vitest/jsdom (frontend).

**Spec:** `docs/superpowers/specs/2026-09-06-epictope-webui-ux-redesign.md`

## Global Constraints

- Chart plots **only** the `min` track: raw filled area + dashed window-7 rolling average; y-axis fixed 0–1; top-site vertical annotations. No feature-track toggles.
- `topSites()` peak detection must keep matching `web/parsing.compute_top_sites` (strict `>` over both neighbors); `movingAverage()` keeps mirroring `scripts/plot_scores.R` (symmetric, edge-capped, window 7). Both already exist and are tested — do not change their behavior.
- MSA identity coloring (red = conserved, blue = differs, yellow = gap) via existing `colorForColumn` — unchanged.
- Two-way hover-sync (chart ↔ sequence strip ↔ MSA) via the existing `bus` in `src/sync.ts` — preserved.
- Custom structure (CIF) upload + N-terminal offset must live in a collapsed "Advanced options" disclosure, clearly optional.
- No CSS framework; one `style.css` using CSS custom properties; print stylesheet forces light palette.
- Backend changes limited to two new streaming endpoints; no changes to the R pipeline, job runner, caching, or install flow.
- Commit after every task with a focused message (repo style: `feat(webui): …`, `fix(web): …`, `docs: …`).
- **`npm run build` / `tsc --noEmit` only pass from Task 9 onward.** Tasks 5–8 leave `main.ts` importing modules that no longer exist (`renderScoreChart`, `renderTable`, old `renderInfo`); per-task vitest runs are the verification until the Task 9 rewire lands.

### Commands

- Frontend tests: `npm test` (run in `webui/`)
- Frontend typecheck+build: `npm run build` (run in `webui/`; outputs to `web/static/`)
- Backend tests: `.venv/bin/python -m pytest tests/web -q` (run at repo root; the venv has fastapi/pytest/httpx)

---

### Task 1: Backend download endpoints (score.csv + msa.fasta)

**Files:**
- Modify: `web/app.py` (add after the existing `result_info` endpoint, line 76)
- Test: `tests/web/test_app.py`

**Interfaces:**
- Consumes: `config.OUTPUTS_DIR` (existing), FastAPI `FileResponse`.
- Produces: `GET /api/results/{uniprot_id}/score.csv` and `GET /api/results/{uniprot_id}/msa.fasta` — 200 streams the on-disk file with `Content-Disposition: attachment; filename="<ID>_score.csv"` (resp. `_msa.fasta`); 404 `{"detail": "no score result for this ID"}` (resp. "no MSA result for this ID") when missing. Frontend `src/api.ts` (Task 6) relies on these exact paths.

- [ ] **Step 1: Write the failing tests**

Append to `tests/web/test_app.py`:

```python
def test_score_csv_download(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"
    d.mkdir()
    (d / "Q9W7E7_score.csv").write_text("position,min\n1,0.5\n")
    client = TestClient(app_module.app)
    resp = client.get("/api/results/Q9W7E7/score.csv")
    assert resp.status_code == 200
    assert resp.text == "position,min\n1,0.5\n"
    assert "attachment" in resp.headers["content-disposition"]
    assert "Q9W7E7_score.csv" in resp.headers["content-disposition"]

def test_msa_fasta_download(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"
    d.mkdir()
    (d / "Q9W7E7_msa.fasta").write_text(">Q9W7E7\nMKV\n")
    client = TestClient(app_module.app)
    resp = client.get("/api/results/Q9W7E7/msa.fasta")
    assert resp.status_code == 200
    assert resp.text == ">Q9W7E7\nMKV\n"
    assert "attachment" in resp.headers["content-disposition"]
    assert "Q9W7E7_msa.fasta" in resp.headers["content-disposition"]

def test_downloads_404_for_unknown_id():
    client = TestClient(app_module.app)
    assert client.get("/api/results/NOPE/score.csv").status_code == 404
    assert client.get("/api/results/NOPE/msa.fasta").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/web/test_app.py -q -k "download"`
Expected: FAIL — 404 tests pass trivially for the wrong reason (route missing → 404 from no match is actually FastAPI's 404, fine) but the two 200-tests fail with 404.

- [ ] **Step 3: Implement the endpoints**

In `web/app.py`, after the `result_info` function (line 76), before the `StaticFiles` import block:

```python
from fastapi.responses import FileResponse

@app.get("/api/results/{uniprot_id}/score.csv")
def result_score_csv(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_score.csv"
    if not p.exists():
        raise HTTPException(status_code=404, detail="no score result for this ID")
    return FileResponse(p, media_type="text/csv", filename=f"{uniprot_id}_score.csv")

@app.get("/api/results/{uniprot_id}/msa.fasta")
def result_msa_fasta(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_msa.fasta"
    if not p.exists():
        raise HTTPException(status_code=404, detail="no MSA result for this ID")
    return FileResponse(p, media_type="text/plain", filename=f"{uniprot_id}_msa.fasta")
```

Note: `config.OUTPUTS_DIR` is read at request time inside the function body, so the tests' `monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)` works — same pattern as the existing endpoints.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/web -q`
Expected: all PASS (including the pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add web/app.py tests/web/test_app.py
git commit -m "feat(web): stream score CSV and MSA FASTA as downloads"
```

---

### Task 2: State machine + URL sync module

**Files:**
- Create: `webui/src/state.ts`
- Test: `webui/test/state.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 5, 6, 7, 9):

```typescript
export type AppState =
  | { kind: "empty" }
  | { kind: "selected"; acc: string }
  | { kind: "running"; acc: string; jobId: string }
  | { kind: "results"; acc: string }
  | { kind: "error"; acc: string; message: string };

export function parseUrl(): string | null;          // accession from ?id=, or null
export function setUrl(acc: string | null): void;   // replaceState ?id=<acc> or bare path
export function onUrlChange(cb: (acc: string | null) => void): void; // popstate listener
```

- [ ] **Step 1: Write the failing test**

Create `webui/test/state.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseUrl, setUrl } from "../src/state";

describe("URL state", () => {
  it("parses ?id= from the location", () => {
    window.history.replaceState(null, "", "/?id=Q9W7E7");
    expect(parseUrl()).toBe("Q9W7E7");
  });
  it("returns null without ?id=", () => {
    window.history.replaceState(null, "", "/");
    expect(parseUrl()).toBeNull();
  });
  it("setUrl writes and clears ?id= without reloading", () => {
    window.history.replaceState(null, "", "/");
    setUrl("Q9W7E7");
    expect(window.location.search).toBe("?id=Q9W7E7");
    setUrl(null);
    expect(window.location.search).toBe("");
  });
  it("round-trips: setUrl then parseUrl", () => {
    setUrl("P57102");
    expect(parseUrl()).toBe("P57102");
    setUrl(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webui && npx vitest run test/state.test.ts`
Expected: FAIL — `Cannot find module '../src/state'`.

- [ ] **Step 3: Implement `state.ts`**

Create `webui/src/state.ts`:

```typescript
export type AppState =
  | { kind: "empty" }
  | { kind: "selected"; acc: string }
  | { kind: "running"; acc: string; jobId: string }
  | { kind: "results"; acc: string }
  | { kind: "error"; acc: string; message: string };

export function parseUrl(): string | null {
  return new URLSearchParams(window.location.search).get("id");
}

export function setUrl(acc: string | null): void {
  const url = acc == null ? window.location.pathname : `?id=${encodeURIComponent(acc)}`;
  window.history.replaceState(null, "", url);
}

export function onUrlChange(cb: (acc: string | null) => void): void {
  window.addEventListener("popstate", () => cb(parseUrl()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webui && npx vitest run test/state.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/state.ts webui/test/state.test.ts
git commit -m "feat(webui): app state type and URL ?id= sync module"
```

---

### Task 3: Downloads module (CSV / FASTA / PNG / print)

**Files:**
- Create: `webui/src/downloads.ts`
- Test: `webui/test/downloads.test.ts`

**Interfaces:**
- Consumes: the Task 1 endpoints (via URL paths, not `fetch` — browser navigation handles the download).
- Produces (used by Task 9 results header):

```typescript
export function downloadScoreCsv(acc: string): void;
export function downloadMsaFasta(acc: string): void;
export function downloadChartPng(chart: { toBase64Image(): string }, acc: string): void;
export function printResults(): void;
```

- [ ] **Step 1: Write the failing test**

Create `webui/test/downloads.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadScoreCsv, downloadMsaFasta, downloadChartPng, printResults } from "../src/downloads";

let clicks: string[];
beforeEach(() => {
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.href);
  });
});

describe("downloads", () => {
  it("score CSV points at the streaming endpoint", () => {
    downloadScoreCsv("Q9W7E7");
    expect(clicks[0]).toContain("/api/results/Q9W7E7/score.csv");
  });
  it("MSA FASTA points at the streaming endpoint", () => {
    downloadMsaFasta("Q9W7E7");
    expect(clicks[0]).toContain("/api/results/Q9W7E7/msa.fasta");
  });
  it("chart PNG downloads a data URL named after the protein", () => {
    let downloadAttr = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadAttr = this.download;
    });
    const fakeChart = { toBase64Image: () => "data:image/png;base64,AAAA" };
    downloadChartPng(fakeChart, "Q9W7E7");
    expect(downloadAttr).toBe("Q9W7E7_min_score.png");
  });
  it("printResults calls window.print", () => {
    const spy = vi.spyOn(window, "print").mockImplementation(() => {});
    printResults();
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webui && npx vitest run test/downloads.test.ts`
Expected: FAIL — `Cannot find module '../src/downloads'`.

- [ ] **Step 3: Implement `downloads.ts`**

Create `webui/src/downloads.ts`:

```typescript
function navigate(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadScoreCsv(acc: string): void {
  navigate(`/api/results/${encodeURIComponent(acc)}/score.csv`);
}

export function downloadMsaFasta(acc: string): void {
  navigate(`/api/results/${encodeURIComponent(acc)}/msa.fasta`);
}

export function downloadChartPng(chart: { toBase64Image(): string }, acc: string): void {
  const a = document.createElement("a");
  a.href = chart.toBase64Image();
  a.download = `${acc}_min_score.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function printResults(): void {
  window.print();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webui && npx vitest run test/downloads.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/downloads.ts webui/test/downloads.test.ts
git commit -m "feat(webui): downloads module (CSV, FASTA, chart PNG, print)"
```

---

### Task 4: MSA run-length rendering + delegation hover

**Files:**
- Modify: `webui/src/msa.ts` (rewrite `renderMsa`; keep `colorForColumn` and `queryPositions` byte-for-byte)
- Test: `webui/test/msa.test.ts` (extend)

**Interfaces:**
- Consumes: `bus` from `./sync` (existing), existing `colorForColumn`, `queryPositions`.
- Produces:
  - `export function colorRuns(seqs: string[], row: number): { color: CellColor; text: string }[]` — NEW, pure; run-length chunks of `seqs[row]` colored per column.
  - `renderMsa(el, msa)` — same signature as today; `main`/Task 9 calls it unchanged. Rows are `.msarow` with a sticky `.msaname` span and a `.msastrip` containing one `<span class="cell <color>" data-start data-end>` per run. Hover: delegated `mousemove` on the strip computes the column from `offsetX / charWidth` and calls `bus.setActive(qpos[col])`; `mouseleave` clears. Active highlight: run whose `[start,end]` contains the active position gets `.active`.

- [ ] **Step 1: Write the failing tests**

Extend the import at the top of `webui/test/msa.test.ts`:

```typescript
import { colorForColumn, queryPositions, colorRuns, renderMsa } from "../src/msa";
```

Then append to `webui/test/msa.test.ts`:

```typescript
describe("colorRuns", () => {
  it("merges consecutive same-colored columns into one run", () => {
    // cols 0-1 red (all A), col 2 yellow (gap in row 0), cols 3-4 blue (differ, no gaps)
    const seqs = ["AA-AA", "AACCB", "AABCG"];
    const runs = colorRuns(seqs, 0);
    expect(runs).toEqual([
      { color: "red", text: "AA" },
      { color: "yellow", text: "-" },
      { color: "blue", text: "AA" },
    ]);
  });
  it("keeps row text identical to the input sequence", () => {
    const seqs = ["AC-DE", "ACADE", "AC-DE"];
    for (let r = 0; r < seqs.length; r++) {
      expect(colorRuns(seqs, r).map(x => x.text).join("")).toBe(seqs[r]);
    }
  });
  it("handles an all-identical row as a single run", () => {
    expect(colorRuns(["MMM", "MMM"], 1)).toEqual([{ color: "red", text: "MMM" }]);
  });
  it("renderMsa prepends a ruler marking every 10 columns", () => {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    document.body.appendChild(el);
    const seq = "ACDEFGHIKLMNPQRSTVWY"; // 20 columns
    renderMsa(el, { query: "Q", records: [{ id: "Q", seq }, { id: "H", seq }] });
    const ruler = el.querySelector(".msaruler")!;
    expect(ruler).not.toBeNull();
    // labels right-aligned on their column: "10" ends at col 10, "20" at col 20
    expect(ruler.textContent).toContain("10");
    expect(ruler.textContent).toContain("20");
    // tick line: "|" at every 10th column
    const tick = ruler.textContent!.split("\n")[1];
    expect(tick[9]).toBe("|");
    expect(tick[19]).toBe("|");
    expect(tick[0]).toBe(" ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webui && npx vitest run test/msa.test.ts`
Expected: FAIL — `colorRuns is not a function` / not exported.

- [ ] **Step 3: Implement `colorRuns` and rewrite `renderMsa`**

Replace the whole of `webui/src/msa.ts` with:

```typescript
import { bus } from "./sync";
export type CellColor = "red"|"blue"|"yellow";
export function colorForColumn(seqs: string[], col: number): CellColor {
  const chars = seqs.map(s => s[col] ?? "-");
  if (chars.some(c => c === "-")) return "yellow";
  if (chars.every(c => c === chars[0])) return "red";
  return "blue";
}
// True query residue number per MSA column (counts non-gap chars in the query row),
// so hover links to the chart by real residue position even when gaps exist.
export function queryPositions(msa: { query: string; records: { id: string; seq: string }[] }): (number|null)[] {
  const q = (msa.records.find(r => r.id === msa.query) ?? msa.records[0])?.seq ?? "";
  let count = 0;
  return q.split("").map(ch => {
    if (ch === "-") return null;
    count += 1;
    return count;
  });
}

export interface ColorRun { color: CellColor; text: string; }

// Run-length encode one alignment row: consecutive columns sharing a color
// become a single run, so the DOM gets O(runs) nodes per row instead of
// O(columns) — keeps large alignments snappy.
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

export function renderMsa(el: HTMLElement, msa: { query: string; records: { id: string; seq: string }[] }) {
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  el.innerHTML = "";
  const head = document.createElement("div"); head.className = "msahead";
  head.innerHTML = `<span class="legend"><i class="sw red"></i>conserved <i class="sw blue"></i>differs <i class="sw yellow"></i>gap</span>`;
  el.appendChild(head);
  const viewport = document.createElement("div"); viewport.className = "msaviewport";
  el.appendChild(viewport);
  // Ruler: monospace strip aligned with the columns below; "|" marks every
  // 10th column and multiples of 10 are labeled (labels overflow harmlessly
  // at the strip's end — it scrolls with the rows).
  const nCols = Math.max(...msa.records.map(r => r.seq.length), 0);
  if (nCols > 0) {
    const tick = Array.from({ length: nCols }, (_, i) => ((i + 1) % 10 === 0 ? "|" : " ")).join("");
    const label = Array.from({ length: nCols }, () => " ");
    for (let c = 10; c <= nCols; c += 10) {
      const s = String(c);
      for (let k = 0; k < s.length && c - s.length + k >= 0; k++) label[c - s.length + k] = s[k];
    }
    const rrow = document.createElement("div"); rrow.className = "msarow";
    const rname = document.createElement("span"); rname.className = "msaname";
    rrow.appendChild(rname);
    const ruler = document.createElement("span"); ruler.className = "msastrip msaruler";
    ruler.textContent = `${label.join("")}\n${tick}`;
    rrow.appendChild(ruler); viewport.appendChild(rrow);
  }
  msa.records.forEach((rec, rowIdx) => {
    const row = document.createElement("div"); row.className = "msarow";
    const name = document.createElement("span"); name.className = "msaname"; name.textContent = rec.id;
    row.appendChild(name);
    const strip = document.createElement("span"); strip.className = "msastrip";
    let col = 0;
    for (const run of colorRuns(seqs, rowIdx)) {
      const s = document.createElement("span");
      s.className = `cell ${run.color}`;
      s.dataset.start = String(col);
      s.dataset.end = String(col + run.text.length - 1);
      s.textContent = run.text;
      strip.appendChild(s);
      col += run.text.length;
    }
    // Delegated hover: monospace strip => column = offsetX / char width.
    strip.addEventListener("mousemove", (e) => {
      const w = strip.getBoundingClientRect().width;
      const len = rec.seq.length;
      if (w <= 0 || len === 0) return;
      const c = Math.min(len - 1, Math.max(0, Math.floor((e.offsetX / w) * len)));
      bus.setActive(qpos[c]);
    });
    strip.addEventListener("mouseleave", () => bus.setActive(null));
    row.appendChild(strip); viewport.appendChild(row);
  });
  bus.onActive(pos => {
    el.querySelectorAll<HTMLElement>(".cell").forEach(n => {
      const start = Number(n.dataset.start), end = Number(n.dataset.end);
      const qIdx = pos == null ? -1 : qpos.indexOf(pos);
      n.classList.toggle("active", qIdx >= 0 && qIdx >= start && qIdx <= end);
    });
  });
}
```

Note: the old per-cell `data-pos` approach is replaced by `data-start`/`data-end` ranges; active lookup maps residue → column via `qpos.indexOf(pos)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webui && npx vitest run test/msa.test.ts test/sync.test.ts`
Expected: all PASS (3 new + 3 pre-existing msa + sync).

- [ ] **Step 5: Commit**

```bash
git add webui/src/msa.ts webui/test/msa.test.ts
git commit -m "feat(webui): run-length MSA rendering with delegated hover"
```

---

### Task 5: Min-score chart rewrite

**Files:**
- Modify: `webui/src/chart.ts` (rewrite `renderScoreChart` → `renderMinChart`; keep `topSites` and `movingAverage` byte-for-byte)
- Modify: `webui/package.json` (add `chartjs-plugin-zoom`)
- Test: `webui/test/chart.test.ts` (rewrite)

**Interfaces:**
- Consumes: `chart.js`, `chartjs-plugin-annotation` (existing), `chartjs-plugin-zoom` (new), `topSites`, `movingAverage`.
- Produces (used by Task 9):

```typescript
export interface TopSite { position: number; min: number; min_feature: string; }
export function topSites(rows: any[], n = 5): TopSite[];            // unchanged
export function movingAverage(rows: any[], key: string, window = 7): number[]; // unchanged
export const MIN_DATASET_INDEX = 0;
export interface MinChartHandle {
  chart: Chart;
  setHoverCallback(cb: (pos: number | null) => void): void;
  highlight(pos: number | null): void;   // hover-sync (transient)
  pin(pos: number | null): void;         // persistent marker + centers when zoomed
  exportPng(): string;                   // 2x, white background data URL
}
export function renderMinChart(canvas: HTMLCanvasElement, rows: any[], top: TopSite[]): MinChartHandle;
```

- [ ] **Step 1: Add the zoom plugin dependency**

In `webui/package.json` dependencies, add `"chartjs-plugin-zoom": "^2.0.1"` after the annotation plugin line. Then:

Run: `cd webui && npm install`
Expected: `package-lock.json` updated, install succeeds.

- [ ] **Step 2: Write the failing test**

Replace `webui/test/chart.test.ts` entirely (same jsdom canvas-stub harness as before, retargeted at `renderMinChart`):

```typescript
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
  it("clicking empty chart area unpins; Escape unpins", () => {
    const { chart, pin } = makeChart();
    pin(5);
    (chart.options.onClick as any)({}, []);
    expect((chart.options.plugins as any).annotation.annotations.pinned).toBeUndefined();
    pin(3);
    chart.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((chart.options.plugins as any).annotation.annotations.pinned).toBeUndefined();
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd webui && npx vitest run test/chart.test.ts`
Expected: FAIL — `renderMinChart is not a function`. (The score.test.ts imports of `topSites`/`movingAverage` keep passing throughout, since those functions are preserved.)

- [ ] **Step 4: Rewrite `chart.ts`**

Replace the whole of `webui/src/chart.ts` with:

```typescript
import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale, Filler } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import zoomPlugin from "chartjs-plugin-zoom";
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
             color: "#b91c1c", font: { size: 10 } },
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
        fill: true, pointRadius: 0, borderWidth: 2, tension: 0.15 },
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
      onClick: (_, els) => { if (els.length === 0) handle.pin(null); },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: {
          title: (items) => { const r = rows[items[0].dataIndex];
            return `Position ${r.position} (${r.aa}) · min ${r.min}`; },
          label: (it) => `${it.dataset.label}: ${it.formattedValue} · limiting: ${rows[it.dataIndex].min_feature}`,
        } },
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
      const idx = pos == null ? -1 : rows.map(r => Number(r.position)).indexOf(pos);
      const ae = idx < 0 ? [] : [{ datasetIndex: MIN_DATASET_INDEX, index: idx }];
      chart.setActiveElements(ae);
      chart.tooltip?.setActiveElements(ae, { x: 0, y: 0 });
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
  canvas.addEventListener("keydown", (e) => { if (e.key === "Escape") handle.pin(null); });

  return handle;
}
```

Note: `renderScoreChart` is gone; Task 9 rewires the caller. `chartjs-plugin-zoom` v2 needs no extra imports (Hammer.js is only required for pinch-zoom on some setups; drag/wheel work without it).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd webui && npx vitest run test/chart.test.ts test/score.test.ts`
Expected: all PASS (10 chart + 3 score).

- [ ] **Step 6: Commit**

```bash
git add webui/src/chart.ts webui/test/chart.test.ts webui/package.json webui/package-lock.json
git commit -m "feat(webui): paper-faithful min-score chart with pin and zoom"
```

---

### Task 6: Search autocomplete module

**Files:**
- Create: `webui/src/search.ts`
- Modify: `webui/src/api.ts` (add `fetchStatus`, `ApiError`, harden `runPrediction`)
- Test: `webui/test/search.test.ts`

**Interfaces:**
- Consumes: `fetchSearch(q)` from `./api` (existing).
- Produces (used by Tasks 7, 9):

```typescript
export interface SearchHit { accession: string; gene: string; organism: string; reviewed: boolean; hasAlphaFold: boolean; }
export function mountSearch(root: HTMLElement, onSelect: (hit: SearchHit) => void): void;
// api.ts additions:
export const fetchStatus: () => Promise<{ installed: boolean; progress: string }>;
export class ApiError extends Error { status: number; }
```

Behavior: input event → debounce 300 ms → `fetchSearch` → dropdown `<ul role="listbox">` of rows (accession bold, gene, organism, badges); ↑/↓ moves an `.active` row, Enter selects, Escape closes; click selects; selecting calls `onSelect(hit)` and closes. Empty result set renders one "No UniProt entries match '<q>'" row. Out-of-order responses are dropped (a monotonically increasing request id).

The `api.ts` changes (made in Step 3 below):

- [ ] **Step 1: Write the failing test**

Create `webui/test/search.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSearch } from "../src/search";

const hits = [
  { accession: "Q9W7E7", gene: "smad5", organism: "Danio rerio", reviewed: true, hasAlphaFold: true },
  { accession: "A0A0R4IFS9", gene: "smad5", organism: "Danio rerio", reviewed: false, hasAlphaFold: false },
];

vi.mock("../src/api", () => ({
  fetchSearch: vi.fn(async (q: string) => (q === "smad5" ? hits : [])),
}));

import { fetchSearch } from "../src/api";

function mount(onSelect = vi.fn()) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountSearch(root, onSelect);
  return { root, onSelect, input: root.querySelector("input")! };
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(350);
}

describe("mountSearch", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; });
  it("debounces input and renders a listbox of hits", async () => {
    const { root, input } = mount();
    await type(input, "smad5");
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    const items = root.querySelectorAll("[role=option]");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Q9W7E7");
    expect(items[0].textContent).toContain("reviewed");
  });
  it("Enter selects the active option and calls onSelect", async () => {
    const { root, input, onSelect } = mount();
    await type(input, "smad5");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith(hits[0]);
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });
  it("shows an empty message when there are no hits", async () => {
    const { root, input } = mount();
    await type(input, "zzzz");
    expect(root.textContent).toContain("No UniProt entries match");
  });
  it("Escape closes the dropdown", async () => {
    const { root, input } = mount();
    await type(input, "smad5");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });
});
```

(Note: `vi.useFakeTimers()` per test; the module must use `setTimeout` for debounce.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webui && npx vitest run test/search.test.ts`
Expected: FAIL — `Cannot find module '../src/search'`.

- [ ] **Step 3: Implement `search.ts` and extend `api.ts`**

Extend `webui/src/api.ts` — add `fetchStatus`, and harden `runPrediction` against non-200 responses (replace the existing `runPrediction`):

```typescript
export const fetchStatus = () => fetch("/api/status").then(J);

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export const runPrediction = async (uniprot_id: string, n_terminal: number | null, file: File | null) => {
  const fd = new FormData(); fd.append("uniprot_id", uniprot_id);
  if (n_terminal != null) fd.append("n_terminal", String(n_terminal));
  if (file) fd.append("custom_structure", file);
  const r = await fetch("/api/run", { method: "POST", body: fd });
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({})))?.detail ?? r.statusText;
    throw new ApiError(r.status, String(detail));
  }
  return r.json() as Promise<{ job_id: string }>;
};
```

(Without the `!r.ok` check, a 503 during reference-data download yields `job_id: undefined` and the Task 7 poller would loop forever on the 404 job response.)

Create `webui/src/search.ts`:

```typescript
import { fetchSearch } from "./api";

export interface SearchHit {
  accession: string; gene: string; organism: string;
  reviewed: boolean; hasAlphaFold: boolean;
}

export function mountSearch(root: HTMLElement, onSelect: (hit: SearchHit) => void): void {
  root.innerHTML = `
    <div class="searchbox">
      <input type="search" placeholder="Gene, accession, or organism — e.g. smad5 or Q9W7E7"
             aria-label="Search UniProt" autocomplete="off" spellcheck="false"/>
    </div>`;
  const input = root.querySelector("input")!;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reqId = 0;
  let active = -1;
  let hits: SearchHit[] = [];

  const close = () => { root.querySelector("[role=listbox]")?.remove(); active = -1; };

  const open = (items: SearchHit[], q: string) => {
    close();
    hits = items;
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.className = "autocomplete";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `No UniProt entries match '${q}'`;
      ul.appendChild(li);
    } else {
      items.forEach((h, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<b>${h.accession}</b> ${h.gene} <span class="org">${h.organism}</span>
          ${h.reviewed ? '<span class="tag">reviewed</span>' : ""}
          ${h.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : ""}`;
        li.addEventListener("click", () => { onSelect(h); close(); });
        li.dataset.index = String(i);
        ul.appendChild(li);
      });
    }
    root.querySelector(".searchbox")!.appendChild(ul);
  };

  const markActive = () => {
    root.querySelectorAll("[role=option]").forEach((li, i) =>
      li.classList.toggle("active", i === active));
  };

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    const id = ++reqId;
    timer = setTimeout(async () => {
      const rows: SearchHit[] = await fetchSearch(q);
      if (id !== reqId) return; // a newer query superseded this one
      open(rows, q);
    }, 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); markActive(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); markActive(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { onSelect(hits[active]); close(); e.preventDefault(); }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webui && npx vitest run test/search.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/search.ts webui/src/api.ts webui/test/search.test.ts
git commit -m "feat(webui): live autocomplete search with keyboard navigation"
```

---

### Task 7: Run panel module (selected card + advanced options + polling)

**Files:**
- Create: `webui/src/run.ts`
- Test: `webui/test/run.test.ts`

**Interfaces:**
- Consumes: `runPrediction`, `fetchJob`, `ApiError` from `./api` (ApiError + hardening added in Task 6); `SearchHit` from `./search` (Task 6); `fetchScore` from `./api` (existing — used for the cache probe).
- Produces (used by Task 9):

```typescript
export function mountRunPanel(root: HTMLElement, onDone: (acc: string) => void, onError: (acc: string, message: string) => void): { select(hit: SearchHit): void; clear(): void; };
```

Behavior: `select(hit)` renders the selected-protein card (gene H2, accession/organism, badges), a primary button, and a collapsed `<details class="advanced">` containing the CIF file input + N-term number input + helper sentence. The button label is cache-aware: `select` fires `fetchScore(hit.accession)`; if it resolves, results are cached and the button reads **View results** (clicking calls `onDone(acc)` directly — no POST); while the probe is in flight it reads **Run prediction**. Clicking Run (uncached) disables the button, shows a progress line ("Running prediction for \<acc\>… this can take several minutes"), POSTs via `runPrediction(acc, nterm, file)`, polls `fetchJob` every 1500 ms; `done` → `onDone(acc)`; `error` → `onError(acc, job.error)`. If `runPrediction` throws an `ApiError` with `status === 503`, the button is re-enabled and the progress line shows the server's "reference data is still downloading" detail instead of calling `onError`. `clear()` empties the root.

- [ ] **Step 1: Write the failing test**

Create `webui/test/run.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountRunPanel } from "../src/run";
import { ApiError } from "../src/api";

const jobs: Record<string, { status: string }> = { "job-1": { status: "running" } };
let runMock = vi.fn(async () => ({ job_id: "job-1" }));
let scoreMock = vi.fn(async () => { const e = new Error("404"); throw e; }); // default: not cached
vi.mock("../src/api", () => ({
  ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } },
  runPrediction: (...a: any[]) => runMock(...a),
  fetchScore: (...a: any[]) => scoreMock(...a),
  fetchJob: vi.fn(async (id: string) => {
    // first poll: running; second poll: done
    const j = jobs[id];
    if (j.status === "running") { jobs["job-1"] = { status: "done" }; }
    return j;
  }),
}));

const hit = { accession: "Q9W7E7", gene: "smad5", organism: "Danio rerio", reviewed: true, hasAlphaFold: true };

describe("mountRunPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    jobs["job-1"] = { status: "running" };
    runMock = vi.fn(async () => ({ job_id: "job-1" }));
    scoreMock = vi.fn(async () => { throw new Error("404"); });
  });

  it("renders the selected card with a collapsed advanced disclosure", () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select(hit);
    expect(root.textContent).toContain("smad5");
    expect(root.textContent).toContain("Q9W7E7");
    const details = root.querySelector("details.advanced")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("optional");
    expect((root.querySelector("button.primary") as HTMLButtonElement).textContent).toContain("Run prediction");
  });

  it("labels the button 'View results' when results are cached, and skips POST", async () => {
    scoreMock = vi.fn(async () => [{ position: 1 }]); // cache hit
    const root = document.createElement("div");
    const onDone = vi.fn();
    const panel = mountRunPanel(root, onDone, vi.fn());
    panel.select(hit);
    await vi.advanceTimersByTimeAsync(0); // let the cache probe resolve
    const btn = root.querySelector("button.primary") as HTMLButtonElement;
    expect(btn.textContent).toContain("View results");
    btn.click();
    expect(onDone).toHaveBeenCalledWith("Q9W7E7");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("runs, polls, and calls onDone when the job completes", async () => {
    const root = document.createElement("div");
    const onDone = vi.fn();
    const panel = mountRunPanel(root, onDone, vi.fn());
    panel.select(hit);
    (root.querySelector("button.primary") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);      // let runPrediction resolve
    await vi.advanceTimersByTimeAsync(1600);   // first poll -> running
    await vi.advanceTimersByTimeAsync(1600);   // second poll -> done
    expect(onDone).toHaveBeenCalledWith("Q9W7E7");
  });

  it("a 503 from /api/run re-enables the button and shows the detail, no onError", async () => {
    runMock = vi.fn(async () => { throw new ApiError(503, "reference data is still downloading; try again soon"); });
    const root = document.createElement("div");
    const onError = vi.fn();
    const panel = mountRunPanel(root, vi.fn(), onError);
    panel.select(hit);
    const btn = root.querySelector("button.primary") as HTMLButtonElement;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
    expect(root.querySelector(".progress")!.textContent).toContain("still downloading");
  });

  it("clear() empties the panel", () => {
    const root = document.createElement("div");
    const panel = mountRunPanel(root, vi.fn(), vi.fn());
    panel.select(hit);
    panel.clear();
    expect(root.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webui && npx vitest run test/run.test.ts`
Expected: FAIL — `Cannot find module '../src/run'`.

- [ ] **Step 3: Implement `run.ts`**

Create `webui/src/run.ts`:

```typescript
import { runPrediction, fetchJob, fetchScore, ApiError } from "./api";
import type { SearchHit } from "./search";

export function mountRunPanel(
  root: HTMLElement,
  onDone: (acc: string) => void,
  onError: (acc: string, message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = (jobId: string, acc: string) => {
    timer = setTimeout(async () => {
      const job = await fetchJob(jobId);
      if (job.status === "done") { onDone(acc); return; }
      if (job.status === "error") { onError(acc, job.error ?? "unknown error"); return; }
      poll(jobId, acc);
    }, 1500);
  };

  return {
    select(hit: SearchHit): void {
      root.innerHTML = `
        <div class="card selected">
          <div class="selmain">
            <h2>${hit.gene || hit.accession}</h2>
            <p class="sub">${hit.accession} · ${hit.organism}
              ${hit.reviewed ? '<span class="tag">reviewed</span>' : ""}
              ${hit.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : ""}</p>
          </div>
          <button class="primary">Run prediction</button>
        </div>
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
      // Cache probe: results already on disk => offer "View results" (no POST).
      let cached = false;
      fetchScore(hit.accession)
        .then(() => { cached = true; btn.textContent = "View results"; })
        .catch(() => { /* not cached — keep "Run prediction" */ });
      btn.onclick = async () => {
        if (cached) { onDone(hit.accession); return; }
        btn.disabled = true;
        progress.hidden = false;
        progress.textContent = `Running prediction for ${hit.accession}… this can take several minutes.`;
        const nterm = root.querySelector<HTMLInputElement>(".nterm")!.value;
        const file = root.querySelector<HTMLInputElement>(".cif")!.files?.[0] ?? null;
        try {
          const { job_id } = await runPrediction(hit.accession, nterm ? Number(nterm) : null, file);
          poll(job_id, hit.accession);
        } catch (e) {
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
    },
    clear(): void {
      if (timer) clearTimeout(timer);
      root.innerHTML = "";
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webui && npx vitest run test/run.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add webui/src/run.ts webui/test/run.test.ts
git commit -m "feat(webui): selected-protein run panel with advanced options"
```

---

### Task 8: Full stylesheet rewrite (tokens, layout, print)

**Files:**
- Modify: `webui/src/style.css` (full rewrite)

**Interfaces:**
- Consumes: the class names emitted by Tasks 4–7 and Task 9 (`.searchbox`, `.autocomplete`, `.card`, `.selected`, `.advanced`, `.primary`, `.tag`, `.hint`, `.progress`, `.sites .chip`, `.downloads`, `.msaviewport`, `.msarow`, `.msaname`, `.msastrip`, `.cell.red/.blue/.yellow/.active`, `.seqstrip .res`, `.legend .sw`, `.banner`, `.skeleton`, `.errorcard`).
- Produces: visual language per spec §5 (tokens, cards, typography, dark mode, print).

- [ ] **Step 1: Rewrite `style.css`**

Replace the whole of `webui/src/style.css` with:

```css
/* Design tokens */
:root {
  --bg: #f8fafc; --card: #ffffff; --ink: #0f172a; --muted: #64748b;
  --accent: #0d9488; --accent-ink: #134e4a; --danger: #b91c1c;
  --border: #e2e8f0; --shadow: 0 1px 3px rgba(15,23,42,.08), 0 4px 12px rgba(15,23,42,.05);
  --radius: 12px; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b1220; --card: #111a2c; --ink: #e2e8f0; --muted: #94a3b8;
          --border: #1e293b; --shadow: 0 1px 3px rgba(0,0,0,.4); }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
       font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }

/* Header */
header.top { display: flex; align-items: baseline; gap: .75rem; padding: .9rem 1.25rem;
             background: var(--card); border-bottom: 1px solid var(--border); }
header.top h1 { font-size: 1.25rem; margin: 0; letter-spacing: -.01em; }
header.top .tagline { color: var(--muted); font-size: .85rem; }
.banner { background: #fef3c7; color: #92400e; padding: .45rem 1.25rem; font-size: .85rem; }
@media (prefers-color-scheme: dark) { .banner { background: #3a2f0b; color: #fbbf24; } }

main { max-width: 980px; margin: 0 auto; padding: 1.25rem; display: grid; gap: 1.25rem; }

/* Search */
.searchzone { margin: 8vh auto 0; max-width: 640px; width: 100%; transition: margin .15s ease; }
.searchzone.compact { margin-top: 0; }
.searchbox { position: relative; }
.searchbox input { width: 100%; padding: .8rem 1rem; font-size: 1.05rem; border-radius: var(--radius);
                   border: 1px solid var(--border); background: var(--card); color: var(--ink);
                   box-shadow: var(--shadow); }
.searchbox input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.autocomplete { position: absolute; z-index: 10; left: 0; right: 0; margin: .35rem 0 0; padding: .25rem;
                list-style: none; background: var(--card); border: 1px solid var(--border);
                border-radius: var(--radius); box-shadow: var(--shadow); max-height: 320px; overflow-y: auto; }
.autocomplete li { padding: .5rem .6rem; border-radius: 8px; cursor: pointer; font-size: .92rem; }
.autocomplete li.active, .autocomplete li:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.autocomplete li.empty { cursor: default; color: var(--muted); }
.autocomplete .org { color: var(--muted); }

/* Cards & tags */
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); padding: 1rem 1.25rem; }
.card > .overline { text-transform: uppercase; letter-spacing: .08em; font-size: .7rem;
                    color: var(--muted); margin: 0 0 .5rem; }
.tag { background: var(--accent); color: #fff; border-radius: 4px; padding: 0 .4rem;
       font-size: .7rem; margin-left: .3rem; white-space: nowrap; }
.hint { color: var(--muted); font-size: .85rem; }
.sub { color: var(--muted); margin: .15rem 0 0; }

/* Selected protein + run */
.selected { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.selected h2 { margin: 0; font-size: 1.35rem; letter-spacing: -.01em; }
button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--border);
         background: var(--card); color: var(--ink); padding: .45rem .9rem;
         transition: background .15s ease, border-color .15s ease; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff;
                 font-weight: 600; padding: .6rem 1.2rem; }
button.primary:hover { background: var(--accent-ink); }
button.primary:disabled { opacity: .55; cursor: wait; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.advanced { margin-top: .6rem; }
.advanced summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
.advanced .advbody { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end;
                     padding: .6rem 0 0; }
.advanced label { display: grid; gap: .25rem; font-size: .85rem; color: var(--muted); }
.advanced input { padding: .4rem .5rem; border: 1px solid var(--border); border-radius: 8px;
                  background: var(--card); color: var(--ink); }
.progress { color: var(--muted); font-size: .9rem; }

/* Results header */
.reshead h2 { margin: 0; font-size: 1.5rem; letter-spacing: -.01em; }
.sites { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
.chip { font-variant-numeric: tabular-nums; border-radius: 999px; padding: .25rem .7rem;
        border: 1px solid var(--danger); color: var(--danger); background: transparent; font-size: .85rem; }
.chip:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.downloads { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .8rem; }
.downloads button { font-size: .85rem; color: var(--muted); }
.downloads button:hover { color: var(--accent); }

/* Chart */
.chartwrap { position: relative; height: 340px; }
.chartwrap canvas { max-width: 100%; }
.resetzoom { position: absolute; top: .5rem; right: .5rem; font-size: .8rem; color: var(--muted); }

/* Sequence strip */
.seqstrip { display: flex; flex-wrap: wrap; font-family: var(--mono); font-size: 12px; line-height: 1.6; }
.seqstrip .res { padding: 0 1px; cursor: pointer; border-radius: 2px; }
.seqstrip .res.active { background: #ffd166; outline: 1px solid var(--danger); }

/* MSA */
.msahead { display: flex; justify-content: flex-end; margin-bottom: .4rem; }
.legend { font-size: .8rem; color: var(--muted); display: flex; gap: .8rem; align-items: center; }
.legend .sw { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; margin-right: .25rem; }
.legend .sw.red { background: #e63946; } .legend .sw.blue { background: #a8dadc; } .legend .sw.yellow { background: #ffd166; }
.msaviewport { max-height: 400px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.msarow { display: flex; white-space: nowrap; }
.msaname { position: sticky; left: 0; z-index: 1; width: 150px; flex: none; overflow: hidden;
           text-overflow: ellipsis; font-family: var(--mono); font-size: 11px; padding: 0 .5rem;
           background: var(--card); }
.msastrip { font-family: var(--mono); font-size: 11px; }
.msaruler { color: var(--muted); white-space: pre; font-size: 9px; line-height: 1.2; }
.cell.red { background: #e63946; color: #fff; } .cell.blue { background: #a8dadc; } .cell.yellow { background: #ffd166; }
.cell.active { outline: 2px solid var(--ink); outline-offset: -2px; }

/* Skeleton + error */
.skeleton { border-radius: var(--radius); min-height: 120px;
            background: linear-gradient(100deg, var(--border) 40%, var(--card) 50%, var(--border) 60%);
            background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.errorcard { border-color: var(--danger); }
.errorcard h3 { color: var(--danger); margin-top: 0; }

/* Print: clean report, light palette, MSA unrolled */
@media print {
  :root { --bg: #fff; --card: #fff; --ink: #000; --muted: #444; --border: #ccc; --shadow: none; }
  header.top .tagline, .banner, .searchzone, .downloads, .advanced, .progress { display: none !important; }
  main { max-width: none; padding: 0; }
  .card { border: none; box-shadow: none; padding: .5rem 0; break-inside: avoid; }
  .msaviewport { max-height: none; overflow: visible; border: none; }
  .chartwrap { height: auto; }
}
```

- [ ] **Step 2: Run the frontend test suite**

CSS is not type-checked, and `main.ts` still references the old modules until Task 9, so the build is not expected to pass yet — the vitest suite is the verification for this task.

Run: `cd webui && npm test`
Expected: all existing tests still PASS (CSS changes don't affect them).

- [ ] **Step 3: Commit**

```bash
git add webui/src/style.css
git commit -m "feat(webui): token-driven stylesheet with dark mode and print report"
```

---

### Task 9: index.html + main.ts rewire (composition root)

**Files:**
- Modify: `webui/index.html` (rewrite)
- Modify: `webui/src/main.ts` (rewrite — thin bootstrap composing Tasks 2–8)
- Modify: `webui/src/info.ts` (top-site chips + results header rendering)
- Delete: `webui/src/table.ts`

**Interfaces:**
- Consumes: `parseUrl`, `setUrl`, `onUrlChange` (Task 2); `downloadScoreCsv`, `downloadMsaFasta`, `downloadChartPng`, `printResults` (Task 3); `renderMsa` (Task 4); `renderMinChart`, `topSites`, `MinChartHandle` (Task 5); `mountSearch`, `SearchHit` (Task 6); `mountRunPanel` (Task 7); `renderSequence` (existing); `bus` (existing); `fetchScore`, `fetchMsa`, `fetchInfo`, `fetchStatus` (api).
- Produces: the assembled page. `renderInfo` is replaced by a results-header renderer:

```typescript
// info.ts
export function renderResultsHeader(
  el: HTMLElement,
  info: any,
  onSiteClick: (pos: number) => void,
  onChartPng: () => void,
): void;
```

- [ ] **Step 1: Rewrite `index.html`**

Replace `webui/index.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>EpicTope — epitope tag insertion site prediction</title>
  <link rel="stylesheet" href="./src/style.css"/>
</head>
<body>
  <header class="top">
    <h1>EpicTope</h1>
    <span class="tagline">Predict non-disruptive epitope tag insertion sites</span>
  </header>
  <div id="banner" class="banner" hidden></div>
  <main>
    <section id="searchZone" class="searchzone">
      <div id="search"></div>
      <div id="runPanel"></div>
      <div id="errorBox"></div>
    </section>
    <section id="results" hidden>
      <div id="reshead" class="card reshead"></div>
      <div class="card" id="chartCard"></div>
      <div class="card" id="seqCard"></div>
      <div class="card" id="msaCard"></div>
    </section>
  </main>
  <script type="module" src="./src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite `info.ts`**

Replace `webui/src/info.ts` with:

```typescript
import { bus } from "./sync";
import { downloadScoreCsv, downloadMsaFasta, printResults } from "./downloads";

// Results header: protein summary, clickable top-site chips, downloads group.
export function renderResultsHeader(
  el: HTMLElement,
  info: any,
  onSiteClick: (pos: number) => void,
  onChartPng: () => void,
): void {
  el.innerHTML = `
    <h2>${info.uniprot_id} — ${info.gene || ""}</h2>
    <p class="sub">${info.organism || ""} · ${info.length} aa
      ${info.reviewed ? '<span class="tag">reviewed</span>' : ""}
      ${info.hasAlphaFold ? '<span class="tag">AlphaFold</span>' : ""}</p>
    ${info.resolution_note ? `<p class="hint">${info.resolution_note}</p>` : ""}
    <p class="overline">Top insertion sites</p>
    <div class="sites">${info.top_sites.map((s: any) =>
      `<button class="chip" data-pos="${s.position}">#${s.position} · min ${Number(s.min).toFixed(2)}</button>`).join("")}</div>
    <div class="downloads">
      <button data-dl="csv">Score CSV</button>
      <button data-dl="msa">MSA (FASTA)</button>
      <button data-dl="png">Chart PNG</button>
      <button data-dl="print">Print / PDF</button>
    </div>`;
  el.querySelectorAll<HTMLElement>(".chip").forEach(chip => {
    const pos = Number(chip.dataset.pos);
    chip.onclick = () => onSiteClick(pos);
    chip.onmouseenter = () => bus.setActive(pos);
    chip.onmouseleave = () => bus.setActive(null);
  });
  el.querySelector<HTMLElement>('[data-dl="csv"]')!.onclick = () => downloadScoreCsv(info.uniprot_id);
  el.querySelector<HTMLElement>('[data-dl="msa"]')!.onclick = () => downloadMsaFasta(info.uniprot_id);
  el.querySelector<HTMLElement>('[data-dl="png"]')!.onclick = onChartPng;
  el.querySelector<HTMLElement>('[data-dl="print"]')!.onclick = printResults;
}
```

- [ ] **Step 3: Rewrite `main.ts` and delete `table.ts`**

Replace `webui/src/main.ts` with:

```typescript
import { fetchScore, fetchInfo, fetchMsa, fetchStatus } from "./api";
import { renderMinChart, topSites, type MinChartHandle } from "./chart";
import { renderSequence } from "./sequence";
import { renderMsa } from "./msa";
import { renderResultsHeader } from "./info";
import { mountSearch, type SearchHit } from "./search";
import { mountRunPanel } from "./run";
import { parseUrl, setUrl, onUrlChange } from "./state";
import { bus } from "./sync";

const $ = (id: string) => document.getElementById(id)!;
let chartHandle: MinChartHandle | null = null;

function showSkeletons() {
  $("results").hidden = false;
  $("searchZone").classList.add("compact");
  $("reshead").innerHTML = "";
  for (const id of ["chartCard", "seqCard", "msaCard"]) {
    $(id).innerHTML = `<div class="skeleton"></div>`;
  }
}

async function showResults(acc: string) {
  showSkeletons();
  const [rows, info, msa] = await Promise.all([fetchScore(acc), fetchInfo(acc), fetchMsa(acc)]);
  $("results").hidden = false;
  $("searchZone").classList.add("compact");
  if (chartHandle) { chartHandle.chart.destroy(); chartHandle = null; }
  $("chartCard").innerHTML = `<p class="overline">Tagging score</p>
    <div class="chartwrap"><canvas id="chart"></canvas></div>`;
  chartHandle = renderMinChart($("chart") as HTMLCanvasElement, rows, topSites(rows));
  renderResultsHeader($("reshead"), info,
    (pos) => chartHandle!.pin(pos),
    () => {
      if (!chartHandle) return;
      const a = document.createElement("a");
      a.href = chartHandle.exportPng();
      a.download = `${acc}_min_score.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });
  $("seqCard").innerHTML = `<p class="overline">Query sequence</p><div id="sequence"></div>`;
  renderSequence($("sequence"), rows);
  $("msaCard").innerHTML = `<p class="overline">Multiple sequence alignment</p><div id="msa"></div>`;
  renderMsa($("msa"), msa);
  chartHandle.setHoverCallback((pos) => bus.setActive(pos));
  bus.onActive((pos) => chartHandle?.highlight(pos));
}

function showError(acc: string, message: string) {
  $("errorBox").innerHTML = `<div class="card errorcard">
    <h3>Prediction failed for ${acc}</h3><p>${message}</p>
    <button class="retry">Try again</button></div>`;
  $("errorBox").querySelector<HTMLButtonElement>(".retry")!.onclick = () => {
    $("errorBox").innerHTML = "";
    location.reload();
  };
}

const runPanel = mountRunPanel($("runPanel"), (acc) => { setUrl(acc); showResults(acc); }, showError);

mountSearch($("search"), (hit: SearchHit) => {
  $("errorBox").innerHTML = "";
  setUrl(hit.accession);
  runPanel.select(hit);
});

// Install-progress banner + run gating.
async function watchStatus() {
  const banner = $("banner");
  for (;;) {
    const s = await fetchStatus();
    if (s.installed) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.textContent = `Preparing reference data — search works, predictions start when ready. ${s.progress || ""}`;
    await new Promise(r => setTimeout(r, 5000));
  }
}
watchStatus();

// Deep link + browser back/forward: ?id=<acc> restores results from cache.
const initial = parseUrl();
if (initial) showResults(initial);
onUrlChange((acc) => { if (acc) showResults(acc); });
```

Note on the PNG export: `downloadChartPng` (Task 3) takes a chart-like object and calls `toBase64Image()` — the results header instead receives an `onChartPng` closure that uses `chartHandle.exportPng()` (2×, white background) directly, so the spec's PNG fidelity is honored. `downloadChartPng` remains tested and available for any future raw-canvas export.

Delete `webui/src/table.ts`:

```bash
git rm webui/src/table.ts
```

- [ ] **Step 4: Typecheck and run the full frontend suite**

Run: `cd webui && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 5: Build the static bundle**

Run: `cd webui && npm run build`
Expected: `web/static/` regenerated without errors.

- [ ] **Step 6: Commit**

```bash
git add webui/index.html webui/src/main.ts webui/src/info.ts webui/src/table.ts web/static
git commit -m "feat(webui): compose redesigned page; drop per-residue table"
```

---

### Task 10: End-to-end verification + README update

**Files:**
- Modify: `README.md` ("Web application" section, lines 187–203)

**Interfaces:**
- Consumes: everything above.
- Produces: verified app + accurate docs.

- [ ] **Step 1: Run the full test suites**

Run: `cd webui && npm test && cd .. && .venv/bin/python -m pytest tests/web -q`
Expected: all PASS.

- [ ] **Step 2: Boot the app and verify manually**

Run: `.venv/bin/python -m uvicorn web.app:app --port 8000` (background), then in a browser at `http://localhost:8000`:
1. Search "smad5" → autocomplete shows Q9W7E7 with variants; select it → selected card appears; because Q9W7E7 is cached in `outputs/`, the button reads **View results**; collapsed Advanced options below.
2. Click it → skeletons flash, then results render: chips for the top sites (e.g. `#181`, `#247`), min chart with smoothed overlay + markers, sequence strip, scrollable MSA with ruler.
3. Hover chart ↔ sequence ↔ MSA sync works; click a chip → pin appears; click empty chart area or press Escape → pin clears; drag-zoom → "Reset zoom" button appears and restores.
4. Downloads: CSV and FASTA download via the new endpoints; PNG exports at 2× on white; `Print / PDF` in Chrome shows a clean report with the MSA unrolled.
5. Reload with `?id=Q9W7E7` → results restore from cache; browser back/forward works.
6. Error path: temporarily rename `outputs/Q9W7E7` and run a bogus ID through `/api/run` failure (or stop the server mid-job) → error card shows with a **Try again** button. (Restore the directory afterward.)

Kill the server afterward.

- [ ] **Step 3: Update the README**

Replace the numbered list in the "Web application" section (lines 197–199) with:

```markdown
1. Type a gene name, accession, or organism in the search box and pick the right
   UniProt entry from the autocomplete (badges show reviewed status and whether an
   AlphaFold model exists).
2. Click **Run prediction**. If the protein has no AlphaFold model, expand
   **Advanced options** first to upload a custom `.cif` structure and set the
   N-terminal residue, as described in [example 1C](#example-1c-generating-epictope-predictions-for-custom-alphafold-structures).
3. When the run finishes, the page shows the tagging-score chart (minimum feature
   score per position, with a window-7 smoothed overlay and marked top sites), the
   multiple sequence alignment in a scrollable panel, and download buttons for the
   score CSV, the MSA FASTA, a chart PNG, and a print/PDF report.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the redesigned web interface flow"
```

---

## Self-Review Notes

- **Spec coverage:** §2.2 autocomplete → Task 6; "View results" cache label → Task 7 (fetchScore probe); advanced disclosure → Task 7; §2.3 results header/chips/downloads → Tasks 3, 9; §2.4 empty-search message → Task 6, error card + Retry → Task 9, 503 → Tasks 6 (ApiError) + 7; §3 chart (min-only, smoothed, markers, pin/unpin, zoom + reset, tooltip limiting feature, 2× white PNG) → Task 5; §4.1 MSA scroll/sticky/ruler/run-length → Tasks 4, 8; §4.2 CSV/FASTA/PNG/print → Tasks 1, 3, 8, 9; §5 styling/skeletons/dark/print → Tasks 8, 9; §6 modules → Tasks 2–7, 9; §7 backend → Task 1; §8 testing → per-task TDD + Task 10; §9 non-goals respected (no feature toggles, no server PDF, no pLDDT).
- **Type consistency:** `MinChartHandle.pin/highlight/exportPng` used consistently in Tasks 5, 9 (PNG export goes through `exportPng`, not `downloadChartPng`); `mountRunPanel` callbacks `(acc) => void` / `(acc, message) => void` match Task 7 tests and Task 9 wiring; `renderResultsHeader(el, info, onSiteClick, onChartPng)` (4 params) matches its Task 9 call site; `exportPng` renders the chart canvas onto a 2× white-background offscreen canvas, matching spec §3.
