# EpicTope Web UI — UX Redesign Spec

- **Date:** 2026-09-06
- **Status:** Approved (design), pending implementation plan
- **Goal:** Rebuild the web UI around a clean, linear researcher flow —
  search → select protein → run → results — with a paper-faithful min-score
  chart, a vertically scrollable MSA panel, downloads (CSV / FASTA / PNG /
  print-to-PDF), and polished, accessible styling. Supersedes the UI portions
  of `2026-09-06-epictope-webapp-design.md` §4.4; the backend architecture
  from that spec is unchanged except for two new download endpoints.

## 1. Background

The current UI (`webui/`, Vite + vanilla TS + Chart.js) works but is a rough
single-page dump: a header crowded with search + run + upload controls, a
multi-track chart showing all four features plus sum and min, an unbounded
MSA, and a large per-residue table. The EpicTope paper (Zinski et al.,
bioRxiv 2024.03.03.583232v2, Fig 2) shows what researchers actually need:
the **minimum feature score** per position (raw + window-7 rolling average),
top insertion sites, and the identity-colored MSA.

### Decisions (from brainstorming)

- **Search:** live autocomplete dropdown (debounced, keyboard navigable).
- **Layout:** single-column, stacked results.
- **Chart:** keep Chart.js 4 + annotation plugin; plot only the `min` track
  (raw + smoothed) with top-site annotations, click-to-pin, and zoom/pan.
- **Custom structure (CIF) inputs:** collapsed "Advanced options" disclosure,
  clearly optional.
- **Linked hover:** keep the two-way chart ↔ sequence ↔ MSA sync; top sites
  become clickable chips that pin/zoom the chart.
- **Downloads:** score CSV, MSA FASTA, chart PNG, plus browser print-to-PDF
  via a print stylesheet.

## 2. User flow & page structure

Single screen, three zones. State machine:
`empty → searching → selected → running → results | error`. The selected
protein is mirrored to the URL (`?id=<accession>`) so a refresh or shared
link restores the state (cached results load instantly).

### 2.1 Header (slim)

- EpicTope wordmark + one-line tagline ("Predict non-disruptive epitope tag
  insertion sites").
- A slim banner appears only while reference data downloads ("Preparing
  reference data — search works, predictions start when ready") and
  disappears when `GET /api/status` reports `installed: true`.

### 2.2 Search zone

- Hero when no protein is selected (large, centered); compacts into a bar
  once results are shown.
- **Live autocomplete:** debounced ~300 ms against `GET /api/search`;
  dropdown rows show accession, gene, organism, and `reviewed` / `AlphaFold`
  badges; full keyboard support (↑/↓ move, Enter select, Escape close).
- **Selected-protein card:** gene, organism, accession, length, badges, and
  a primary **Run prediction** button. If `outputs/<ID>/<ID>_score.csv`
  already exists, the button reads **View results** and loads from cache.
- **Advanced options (optional):** a collapsed `<details>`-style disclosure
  below the card containing the CIF file upload and N-terminal residue
  offset, with one sentence of helper text ("Only needed if this protein has
  no AlphaFold model"). Collapsed by default; clearly optional.

### 2.3 Results zone (single column, stacked)

1. **Results header:** protein summary (gene H1, accession/organism
   subtitle) + **top insertion sites as clickable chips**
   (`#181 · min 0.82`) that pin/zoom the chart + a **Downloads** group:
   `Score CSV` · `MSA (FASTA)` · `Chart PNG` · `Print / PDF`.
2. **Chart card** (§3).
3. **Query sequence strip** — retained as the hover bridge between chart
   and MSA.
4. **MSA card** (§4).

The raw per-residue table is **removed from the page**; its data ships as
the CSV download.

### 2.4 Error & empty states

- Search with no results → "No UniProt entries match '<query>'".
- Pipeline failure → inline error card with the R error message and a Retry
  button.
- 503 (reference data downloading) → Run button disabled with explanatory
  tooltip; slim banner shows install progress.

## 3. Min-score chart

Mirrors the paper's Fig 2C and `scripts/plot_scores.R`.

**Content:**

- **Primary track:** raw `min` score per position — filled area line
  (accent color) so spikes read instantly.
- **Overlay:** dashed rolling average (window 7) of `min`, matching the R
  `moving_average` in `plot_scores.R` (symmetric, edge-capped — the existing
  `movingAverage()` in `chart.ts` already mirrors it and stays).
- **Top-site markers:** vertical dashed annotation lines at ranked local
  maxima (existing `topSites()` peak detection, which matches
  `web/parsing.compute_top_sites`), labeled `#181`, `#247`, …
- **Nothing else.** The four feature tracks, `sum_score`, and per-feature
  toggles are removed from the chart; that data remains in the CSV download.
- Axes: x = "Amino acid position"; y = "Minimum feature score (0–1)",
  fixed 0–1 domain.

**Interactions:**

- **Hover:** crosshair + tooltip
  (`Position 181 (S) · min 0.82 · limiting: rsa`); two-way hover-sync with
  the sequence strip and MSA preserved.
- **Click** a top-site chip or chart annotation: **pins** that position
  (persistent vertical marker + tooltip) and centers it when zoomed.
  Clicking elsewhere or pressing Escape unpins.
- **Zoom/pan:** `chartjs-plugin-zoom`; drag-to-zoom on x, wheel zoom with
  modifier key (no scroll-trapping), x-only pan; "Reset zoom" button appears
  when zoomed.
- **PNG export:** canvas rendered at 2× pixel ratio on a white background.

**Implementation:** `chart.ts` rewritten as
`renderMinChart(canvas, rows, topSites)` returning
`{ chart, pin(pos), highlight(pos), exportPng() }`. `topSites()` and
`movingAverage()` are unchanged (tested, match backend). `MIN_DATASET_INDEX`
and multi-dataset indexing are removed.

## 4. MSA panel, downloads & print

### 4.1 MSA panel (vertically scrollable)

- Identity-colored alignment (red = conserved across all species,
  blue = differs, yellow = gap) — same `colorForColumn` logic as today
  (mirrors paper Fig 2A); compact legend in the card header.
- Fixed-height viewport (~400 px) with **vertical scroll** for rows and
  **horizontal scroll** for long alignments; **sticky species-name column**;
  ruler marks every 10 columns.
- Hover-sync with chart/sequence strip preserved.
- **Rendering:** run-length coloring — each row is a sequence of monospace
  text nodes, one per run of same-colored residues (not one `<span>` per
  residue). Per-column hover uses event delegation on the row; the column
  index is computed from mouse x / character width (monospace makes this
  exact). Keeps an ~8×500 alignment snappy.

### 4.2 Downloads (results header group)

- **Score CSV** — new endpoint `GET /api/results/{id}/score.csv` streaming
  the on-disk `<ID>_score.csv` with `Content-Disposition: attachment` (no
  re-serialization).
- **MSA (FASTA)** — new endpoint `GET /api/results/{id}/msa.fasta`,
  same pattern.
- **Chart PNG** — client-side canvas export (§3).
- **Print / PDF** — `window.print()` + dedicated **print stylesheet**:
  hides search zone, downloads group, and interactive chrome; the MSA
  expands from its scroll viewport to full height with clean page breaks;
  the chart prints at full width; the header becomes a document title block
  (protein ID, gene, organism, date). Chrome "Save as PDF" yields a clean
  report. Print always forces the light palette.

## 5. Visual styling

- **Design tokens (CSS custom properties):** off-white background
  (`#f8fafc`), white cards (soft shadow, 12 px radius), slate ink
  (`#0f172a`), single teal accent (`#0d9488`) for primary actions and the
  min-score line, muted red reserved for top-site markers (continuity with
  the paper). System font stack; tabular numerals for scores/positions.
- **Typography:** gene name as results H1; accession/organism subdued
  subtitle; small-caps overline titles on cards.
- **Micro-interactions:** 150 ms ease transitions; skeleton shimmer on
  chart/MSA cards while a job runs; autocomplete fade-slide; focus-visible
  rings everywhere (keyboard accessible).
- **Dark mode:** `prefers-color-scheme` via the same tokens. Print forces
  light.
- **No CSS framework** — one organized `style.css` (~300 lines); Docker
  build unchanged.

## 6. Module structure

Splitting today's `main.ts` into focused modules:

- `src/state.ts` — app state machine + URL sync (`?id=`).
- `src/search.ts` — autocomplete dropdown (debounce, keyboard nav, badges).
- `src/run.ts` — selected-protein card, advanced-options disclosure, job
  polling, progress/skeleton.
- `src/chart.ts` — rewritten min-chart (§3).
- `src/msa.ts` — run-length coloring + event-delegation hover (§4.1).
- `src/downloads.ts` — CSV/FASTA/PNG/print actions.
- `src/sequence.ts`, `src/sync.ts`, `src/info.ts` (→ top-site chips),
  `src/api.ts` (+2 endpoints) — small edits, largely reused.
- `src/table.ts` — **deleted** (replaced by CSV download).

## 7. Backend changes

Two new endpoints in `web/app.py` (streaming, no re-serialization):

- `GET /api/results/{uniprot_id}/score.csv` → `FileResponse` of
  `outputs/<ID>/<ID>_score.csv`, `Content-Disposition: attachment`;
  404 when missing.
- `GET /api/results/{uniprot_id}/msa.fasta` → same for
  `outputs/<ID>/<ID>_msa.fasta`.

No other backend changes. New frontend dependency:
`chartjs-plugin-zoom` (pinned).

## 8. Testing

- **Vitest (extend existing suite):** keep `msa.test.ts`, `score.test.ts`,
  `sync.test.ts`, `chart.test.ts` green (coloring, peak detection, moving
  average unchanged); add tests for run-length coloring chunk boundaries,
  URL state round-trip, and download filename helpers.
- **Backend pytest:** contract tests for the two new streaming endpoints
  (200 + `Content-Disposition: attachment`, 404 when missing).
- **Manual verification:** search "smad5" → select Q9W7E7 → run (cached) →
  verify chart, MSA scroll, downloads, and Chrome print-to-PDF output.

## 9. Non-goals (YAGNI)

- Feature-track toggles in the chart (data stays in the CSV).
- Server-side PDF generation.
- pLDDT track; config.R weight editing in the UI.
- Virtualized MSA for >5k columns (run-length rendering covers observed
  sizes).
- No changes to the R pipeline, job runner, caching, or install flow.

## 10. Files

- **New:** `webui/src/state.ts`, `webui/src/search.ts`, `webui/src/run.ts`,
  `webui/src/downloads.ts`.
- **Rewritten:** `webui/index.html`, `webui/src/style.css`,
  `webui/src/chart.ts`, `webui/src/msa.ts`, `webui/src/main.ts` (thin
  bootstrap), `webui/src/info.ts` (top-site chips).
- **Small edits:** `webui/src/api.ts` (+2 endpoints), `webui/package.json`
  (+`chartjs-plugin-zoom`).
- **Deleted:** `webui/src/table.ts` (no dedicated test file exists for it).
- **Backend:** `web/app.py` (+2 endpoints), `tests/web/test_app.py` (+2
  contract tests).
- **Docs:** README "Web application" section updated to match the new flow.
