# EpicTope Web App — Design Spec

- **Date:** 2026-09-06
- **Status:** Approved (design), pending implementation plan
- **Goal:** Uplift the EpicTope Docker container into a self-contained, no-auth web
  application that wraps the existing R pipeline, adds easy ID search/resolve,
  shows FASTA/MSA + useful metadata, and visualizes per-position scores with a
  JS chart that is precisely hoverable and linked to the sequence view.

## 1. Background & current state

EpicTope predicts epitope-tag insertion sites in a protein using four features:
sequence conservation (Shannon entropy from a 7-species MSA via BLAST+MUSCLE),
secondary structure and relative solvent accessibility (DSSP on the AlphaFold
mmCIF), and disordered-binding regions (IUPred2A). The "tagging score" at each
position is the **minimum** of the normalized feature scores (`min` column); the
highest-`min` positions are the recommended insertion sites.

Current artifacts (unchanged in behavior):
- `Dockerfile` — `rocker/r-ver:4` image bundling R, the `epictope` package,
  BLAST+/MUSCLE/mkdssp, and libCIF++ components data.
- `scripts/install.R` — downloads ~3 GB of proteome/CDS data for 7 species and
  builds BLAST DBs (writes to `data/CDS`).
- `scripts/single_score.R` — takes a UniProt ID (plus optional custom `.cif`
  structure and N-terminal residue) and writes
  `outputs/<ID>_score.csv` and `outputs/<ID>_msa.fasta`.
- `scripts/resolve_accessions.py` — maps TrEMBL IDs to a reviewed ortholog that
  has an AlphaFold model (commit `6ac60a0`).
- `R/*` — pipeline functions; `setup_files.R` hardcodes `outputFolder="outputs"`
  using **relative** paths, so the pipeline must run with `cwd=/app`.

Score CSV columns (per residue): `position, normalized_entropy, ss_score, rsa,
inv_anchor2, sum_score, min, min_feature, aa, shannon, resnum, chain, ss, sasa,
phi, psi, iupred2, anchor2`.

Reference paper (PMC10979891) informs the UI: plot the four normalized feature
tracks and the `min` track, highlight top insertion sites, render the MSA with
identity coloring (red=identical, blue=differs, yellow=gap), and surface
structure confidence (pLDDT).

## 2. Goals (from the request)

1. Container comes up and downloads everything it needs (proteome/CDS data).
2. Support: UniProt ID, custom AlphaFold structures, and N-terminal residue —
   exactly as the existing tool does.
3. Easy resolution/search of the correct IDs (build on commit `6ac60a0`).
4. UI shows FASTA files for manual analysis plus other useful information.
5. Score chart uses a JS charting library, making it easy to see exactly what
   point the spikes occur at.
6. Hovering the chart or the FASTA/sequence data shows a visible indicator that
   links the matching point in both views (two-way linked highlight).
7. No authentication; results stored in the output directory; reuse from disk if
   the ID was already retrieved.
8. Clean UI that pulls out useful, researcher-relevant information.

## 3. Non-goals

- No user accounts, auth, or multi-tenant isolation.
- No reimplementation of the scientific R pipeline in another language; the R
  code is wrapped, not rewritten.
- No automated bulk/batch queue beyond one-in-flight job (see §6).

## 4. Architecture

- **Backend:** Python **FastAPI + uvicorn**. Wraps the R pipeline by launching
  `Rscript scripts/single_score.R` as a subprocess (`cwd=/app`, with
  BLAST/MUSCLE/mkdssp and R on `PATH`). Serves JSON APIs and the built frontend.
- **Frontend:** **Vite + vanilla TypeScript** (no React), bundled to static
  assets and served by FastAPI. **Chart.js** for the score chart.
- **Container (multi-stage Dockerfile):**
  - Stage 1 (`node`): `npm ci && npm run build` of the `webui/` Vite project,
    producing `dist/`.
  - Stage 2: current `rocker/r-ver` base + Python 3.11 + uv + FastAPI/uvicorn;
    copy `dist/` into `/app/web/static`; install the `epictope` R package as now.
- **Persistence:** host mounts `./data` and `./outputs` (unchanged from today).

### 4.1 Startup & data download
- `docker-entrypoint.sh` runs `Rscript scripts/install.R` in the **background**,
  writing a progress log and a completion marker `data/.installed`, then starts
  uvicorn immediately.
- `GET /api/status` reports `{ installed: bool, progress }`. The UI shows a
  "Preparing reference data…" state and **gates prediction runs** until
  installed, but **search and resolve work immediately**.

### 4.2 Backend API
- `GET /api/status` → install state + progress.
- `GET /api/search?q=<term>` → UniProt REST search (same endpoint as
  `query_uniProt`); returns
  `[{accession, gene, organism, reviewed, hasAlphaFold}]`.
- `POST /api/resolve` `{accessions:[...]}` → resolver mapping per
  `resolve_accessions.py` (`input, resolved, reviewed, af_id, note`).
- `POST /api/run` (**multipart/form-data**: `uniprot_id` field, optional
  `n_terminal` field, optional `custom_structure` `.cif` file upload — a file
  upload cannot ride in a JSON body) → creates a job, returns `job_id`.
- `GET /api/jobs/{id}` → `{status, progress, error?, result?}`.
- `GET /api/results/{id}/score` → JSON array of score-CSV rows (for chart+table).
- `GET /api/results/{id}/msa` → parsed MSA (per-sequence rows + per-column
  consensus/identity) for the FASTA viewer.
- `GET /api/results/{id}/info` → metadata: gene, organism, length, reviewed,
  AlphaFold model version, resolution note, and ranked predicted top insertion
  sites.

### 4.3 Pipeline orchestration (`web/pipeline.py`)
- One global job runner (background thread + queue) — BLAST is heavy, so only
  one R run executes at a time.
- **Cache-first:** if `outputs/<ID>/<ID>_score.csv` exists (and, for custom
  structures, a matching structure-hash sidecar), reuse it without re-running.
- **Enhancement to `scripts/single_score.R`:** honor an optional **`EPICTORE_OUTDIR`
  environment variable** (defaults to `outputs`) as `outputFolder`, so results land
  in `outputs/<ID>/`. This is backward compatible with the existing CLI (when the env
  var is unset, behavior is unchanged). The Python backend sets `EPICTORE_OUTDIR` to
  `outputs/<ID>` when launching the R subprocess.
- Custom structure + N-terminal residue are forwarded to `single_score.R`
  exactly as the existing CLI does.
- **Optional enhancement:** parse per-residue **pLDDT** from the AlphaFold mmCIF
  and expose it as an optional chart track / annotation (paper Fig 2D). Out of
  scope for v1 if it risks pipeline stability; flagged as optional.

### 4.4 Frontend UI (single screen, clean)
- **Top bar:** search box (gene / accession / organism) → result list with
  `reviewed` and `AlphaFold` badges and a **Resolve** action for TrEMBL entries;
  "Run prediction" button; custom-structure upload + N-terminal residue field.
- **Info panel:** gene, organism, length, reviewed status, AlphaFold model
  version, resolution note, and **ranked predicted insertion sites** (top
  local maxima of the `min` score), with their min score and the
  `min_feature` driving them.
- **Score chart (Chart.js):** multi-track of the four normalized features
   (`normalized_entropy`, `ss_score`, `rsa`, `inv_anchor2`) plus `sum_score` and
   `min`; `min` emphasized, others toggleable. Tracks are drawn **raw** so
   spikes sit exactly on their residue (goal 5), plus a dashed rolling-window-7
   smoothed overlay on `min`, mirroring `plot_scores.R`. **Top candidate
   positions (ranked local maxima of `min`) marked with vertical
   annotations.**
- **Linked hover (core requirement):** a shared position index links the chart
  and a **query-sequence strip** (and the MSA viewer). Hovering a residue cell
  highlights the matching chart point (programmatic active element + tooltip);
  hovering the chart highlights the matching residue cell. Two-way.
- **FASTA / MSA viewer:** scrollable, identity-colored per the paper
  (red = conserved across all species, blue = differs, yellow = gap), for manual
  analysis. Plus a **sortable/filterable per-residue feature table** (the score
  CSV) sharing the same linked highlight.

## 5. Error handling
- Pipeline failures (`No alphafold file found`, non-resolvable TrEMBL, etc.) are
  captured from R stderr and surfaced as job `error` with the resolver's
  suggested resolution where applicable.
- Network timeouts on UniProt / IUPred2A are retried with clear messages.
- Invalid/404 accession handled in search/resolve with a friendly message.

## 6. Testing & quality (mandatory process)

Implementation proceeds in **small, incremental steps**, each ending in a commit,
and **test cases are written alongside the code** (test-driven where practical).

- **Backend (`pytest` + FastAPI `TestClient`):**
  - API contract tests for every endpoint above.
  - `uniprot.py` search/resolve tested with mocked HTTP (no live network).
  - Pipeline cache-hit / cache-miss logic tested with a fixture score CSV.
  - `single_score.R` output-dir argument verified (backward-compatible default).
- **Container smoke test:** build the image, boot it, assert `/api/status`,
  run a known small ID end-to-end, and assert `score.csv` + `msa.fasta` are
  produced and `/api/results` serves them.
- **Frontend (`vitest`):** MSA identity-coloring and score-row parsing logic;
  optional Playwright e2e asserting the **linked chart↔sequence hover**.

### 6.1 Incremental delivery plan (commit-as-you-go)
Work is sliced so each slice is independently committable and verifiable:
1. Backend skeleton + `/api/status` + install backgrounding + entrypoint.
2. `/api/search` + `/api/resolve` (reuse `resolve_accessions.py`).
3. `/api/run` + `/api/jobs` + `pipeline.py` wrapping `single_score.R` (with the
   output-dir arg enhancement) + cache-first.
4. `/api/results/{id}/{score,msa,info}` endpoints + parsing.
5. Vite+TS frontend scaffold + Chart.js score chart (multi-track + annotations).
6. Linked hover (chart ↔ sequence strip ↔ MSA ↔ table).
7. FASTA/MSA viewer + identity coloring + feature table.
8. Container multi-stage build + compose ports + smoke test.
9. Docs/polish.

Each step: implement → write/extend tests → run lint/tests → commit with a
focused message. No large "big bang" commits.

## 7. Files

- **New:** `web/` (`app.py`, `pipeline.py`, `uniprot.py`, `config.py`,
  `requirements.txt`), `webui/` (Vite + TS source: `index.html`, `src/main.ts`,
  `src/chart.ts`, `src/sequence.ts`, `src/api.ts`, `vite.config.ts`,
  `package.json`, `tsconfig.json`), `docker-entrypoint.sh`, updated `Dockerfile`
  (multi-stage), updated `docker-compose.yml` (ports/command).
- **Modified (backward compatible):** `scripts/single_score.R` (optional
  output-dir 4th arg).
- **Reused as-is:** `install.R`, `resolve_accessions.py` (minor refactor to
  expose importable `resolve_one`/`fetch_model`), `R/*`, binary tools.

## 8. Open / optional
- pLDDT track (§4.3) — optional, gated on pipeline stability.
- Configurable feature weights via `config.R` exposed in the UI — optional v2.
- Playwright e2e — optional, depending on CI availability.
