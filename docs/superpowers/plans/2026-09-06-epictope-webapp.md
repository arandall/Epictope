# EpicTope Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uplift the EpicTope Docker container into a no-auth web app that wraps the R pipeline, adds ID search/resolve, shows FASTA/MSA + metadata, and visualizes per-position scores with a hover-linked Chart.js chart and sequence view.

**Architecture:** A Python FastAPI backend launches `Rscript scripts/single_score.R` as a subprocess (cwd=`/app`) and serves JSON APIs plus a Vite-built vanilla-TS frontend. A multi-stage Dockerfile builds the frontend then layers it onto the existing R image; an entrypoint runs `install.R` in the background and starts uvicorn. Results are cached per-ID under `outputs/<ID>/` and reused from disk.

**Tech Stack:** Python 3.11 + FastAPI + uvicorn; Vite + TypeScript (no framework) + Chart.js; R/`epictope` package; BLAST+/MUSCLE/mkdssp; pytest + FastAPI TestClient; vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-epictope-webapp-design.md`

## Global Constraints

- Wrap, do not rewrite, the R pipeline; `single_score.R` keeps existing CLI behavior (backward compatible).
- No authentication; results stored in the output directory; reuse from disk if already retrieved.
- Container must come up and download everything it needs (proteome/CDS via `install.R`).
- Support UniProt ID, custom AlphaFold `.cif` structure, and N-terminal residue exactly as the existing tool.
- Backend gates prediction runs until `install.R` completes, but search/resolve work immediately.
- Implement in small, incremental, independently committable steps; **write/extend tests alongside code (TDD)**; run lint/tests and commit each task with a focused message. No big-bang commits.
- Chart must be a JS charting library (Chart.js) with precise point hover, and hover must two-way link chart ↔ sequence/FASTA view.
- `single_score.R` requires `cwd=/app` (relative `data/`/`outputs/` paths).

---

## File Structure

**Backend (`web/`)**
- `web/config.py` — paths (`APP_DIR=/app`, `DATA_DIR`, `OUTPUTS_DIR`, `MODELS_DIR`, `R_SCRIPT`, `INSTALL_MARKER`, `INSTALL_LOG`), constants.
- `web/pipeline.py` — `JobStore` (in-memory), `make_job_id` (deterministic sha256), `enqueue_job` (single-flight queue + dedupe), `_worker`, `run_job` (Popen streaming to `run.log` + progress), `build_command`, `result_exists`, `ensure_meta`, `finalize_meta`.
- `web/parsing.py` — `parse_score_csv` (type-coerced), `parse_msa`, `compute_top_sites` (local maxima), `write_meta`, `read_meta`.
- `web/uniprot.py` — `search(term) -> list[dict]` (retry + empty-guard), `resolve(accessions) -> list[dict]` (imports `resolve_one` from `scripts/resolve_accessions.py`).
- `web/app.py` — FastAPI app, all `/api/*` routes, static mount. The entrypoint owns background `install.R`; the app only reports state.
- `web/requirements.txt` — `fastapi`, `uvicorn[standard]`, `python-multipart`, `pytest`, `httpx`.
- `tests/web/test_config.py`, `test_uniprot.py`, `test_pipeline.py`, `test_parsing.py`, `test_pipeline_meta.py`, `test_app.py`.

**Frontend (`webui/`)**
- `webui/package.json`, `webui/tsconfig.json`, `webui/vite.config.ts` (build `outDir: ../web/static`, `base: "./"`).
- `webui/index.html`, `webui/src/main.ts`, `webui/src/api.ts`, `webui/src/style.css`, `webui/src/types.ts`, `webui/src/sync.ts`, `webui/src/chart.ts`, `webui/src/sequence.ts`, `webui/src/msa.ts`, `webui/src/info.ts`, `webui/src/table.ts`.
- `webui/test/sync.test.ts`, `webui/test/score.test.ts`, `webui/test/msa.test.ts`.

**Container / repo**
- `docker-entrypoint.sh` — background `install.R`, write `data/.installed` + `data/install.log`, start uvicorn.
- `Dockerfile` — multi-stage (node build → R image + python).
- `docker-compose.yml` — add `ports: ["8000:8000"]`, command override.
- `scripts/single_score.R` — **modify**: honor `EPICTORE_OUTDIR` env (default `outputs`) as `outputFolder`.
- `.dockerignore` — stop excluding `web/`/`webui/`; keep excluding `data`,`outputs`,`.venv`,`.git`.

---

## Task 1: Backend skeleton — config + FastAPI app + status endpoint

**Files:**
- Create: `web/config.py`, `web/app.py`, `web/requirements.txt`
- Create: `tests/web/test_app.py`

**Interfaces:**
- `config.py` exports `APP_DIR: Path`, `DATA_DIR`, `OUTPUTS_DIR`, `MODELS_DIR`, `R_SCRIPT: Path`, `INSTALL_MARKER: Path` (= `DATA_DIR/".installed"`), `INSTALL_LOG: Path` (= `DATA_DIR/"install.log"`).
- `app.py` exposes `app` (FastAPI) with `GET /api/status` → `{"installed": bool, "progress": str}`.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_app.py
from fastapi.testclient import TestClient
from web import app as app_module

def test_status_shape():
    client = TestClient(app_module.app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "installed" in body and "progress" in body
    assert isinstance(body["installed"], bool)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web'`.

- [ ] **Step 3: Write minimal implementation**
```python
# web/config.py
from pathlib import Path
APP_DIR = Path("/app")
DATA_DIR = APP_DIR / "data"
OUTPUTS_DIR = APP_DIR / "outputs"
MODELS_DIR = DATA_DIR / "models"
R_SCRIPT = APP_DIR / "scripts" / "single_score.R"
INSTALL_MARKER = DATA_DIR / ".installed"
INSTALL_LOG = DATA_DIR / "install.log"
```
```python
# web/app.py
from fastapi import FastAPI
from web import config

app = FastAPI(title="EpicTope")

@app.get("/api/status")
def status():
    installed = config.INSTALL_MARKER.exists()
    progress = ""
    if config.INSTALL_LOG.exists():
        text = config.INSTALL_LOG.read_text().strip()
        progress = text.splitlines()[-1] if text else ""
    return {"installed": installed, "progress": progress}
```
```text
# web/requirements.txt
fastapi
uvicorn[standard]
python-multipart
pytest
httpx
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_app.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/config.py web/app.py web/requirements.txt tests/web/test_app.py
git commit -m "feat(web): backend skeleton with /api/status endpoint"
```

---

## Task 2: Background install on startup (entrypoint + status progress)

**Files:**
- Create: `docker-entrypoint.sh`
- Modify: `web/app.py` (start `install.R` in background on startup via `lifespan`), `docker-compose.yml`

**Interfaces:**
- `config.INSTALL_MARKER` and `config.INSTALL_LOG` used by `app.py`.
- The **entrypoint is the single owner** of background `install.R`: `docker-entrypoint.sh` launches it detached, logs to `INSTALL_LOG`, and writes `INSTALL_MARKER` on completion. `app.py` MUST NOT also start `install.R` (see commit `d02e2d9` — duplicate starters caused a race). `app.py` only reports install state via `/api/status`.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_app.py (append)
def test_install_marker_drives_status(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "INSTALL_MARKER", tmp_path / ".installed")
    monkeypatch.setattr(cfg, "INSTALL_LOG", tmp_path / "install.log")
    from importlib import reload
    import web.app as appmod
    reload(appmod)
    client = TestClient(appmod.app)
    assert client.get("/api/status").json()["installed"] is False
    (tmp_path / ".installed").write_text("")
    assert client.get("/api/status").json()["installed"] is True
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_app.py -v`
Expected: FAIL on the new test (status still reads real `/app/data`).

- [ ] **Step 3: Write minimal implementation**
```python
# web/app.py (replace content)
import subprocess
from contextlib import asynccontextmanager
from fastapi import FastAPI
from web import config

def _start_install_if_needed():
    if config.INSTALL_MARKER.exists():
        return
    log = open(config.INSTALL_LOG, "w")
    subprocess.Popen(
        ["Rscript", str(config.APP_DIR / "scripts" / "install.R")],
        cwd=str(config.APP_DIR),
        stdout=log, stderr=log,
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    _start_install_if_needed()
    yield

app = FastAPI(title="EpicTope", lifespan=lifespan)

@app.get("/api/status")
def status():
    progress = ""
    if config.INSTALL_LOG.exists():
        text = config.INSTALL_LOG.read_text().strip()
        if text:
            progress = text.splitlines()[-1]
    return {"installed": config.INSTALL_MARKER.exists(), "progress": progress}
```
```bash
# docker-entrypoint.sh
#!/usr/bin/env bash
set -e
if [ ! -f /app/data/.installed ]; then
  echo "Starting reference data download (install.R) in background..." >&2
  ( Rscript /app/scripts/install.R > /app/data/install.log 2>&1; touch /app/data/.installed ) &
fi
exec uvicorn web.app:app --host 0.0.0.0 --port 8000
```
```yaml
# docker-compose.yml (full replacement)
services:
  epictope:
    build: .
    image: epictope
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./outputs:/app/outputs
    command: ["/app/docker-entrypoint.sh"]
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_app.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/app.py docker-entrypoint.sh docker-compose.yml tests/web/test_app.py
git commit -m "feat(web): background install.R on startup with status progress"
```

---

## Task 3: UniProt search endpoint + resolve endpoint

**Files:**
- Create: `web/uniprot.py`, `tests/web/test_uniprot.py`
- Modify: `web/app.py` (add `/api/search`, `/api/resolve`)

**Interfaces:**
- `search(term: str) -> list[dict]` where each dict = `{"accession": str, "gene": str, "organism": str, "reviewed": bool, "hasAlphaFold": bool}`.
- `resolve(accessions: list[str]) -> list[dict]` where each = `{"input": str, "resolved": str|None, "reviewed": bool|None, "af_id": str|None, "note": str}`.
- `app.py`: `GET /api/search?q=` and `POST /api/resolve` `{accessions: [...]}`.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_uniprot.py
import json
import urllib.request
from web import uniprot

def test_search_parses_json(monkeypatch):
    fake = {"results": [
        {"primaryAccession": "Q9W7E7", "genes": [{"geneName": {"value": "smad5"}}],
         "organism": {"scientificName": "Danio rerio"},
         "entryType": "UniProtKB reviewed",
         "uniProtKBCrossReferences": [{"database": "AlphaFoldDB", "id": "Q9W7E7"}]}]}
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: type("R", (), {"read": lambda self: json.dumps(fake).encode()})())
    rows = uniprot.search("smad5")
    assert rows[0]["accession"] == "Q9W7E7"
    assert rows[0]["gene"] == "smad5"
    assert rows[0]["organism"] == "Danio rerio"
    assert rows[0]["reviewed"] is True
    assert rows[0]["hasAlphaFold"] is True

def test_resolve_uses_resolve_one(monkeypatch):
    from web.uniprot import resolve
    monkeypatch.setattr("web.uniprot.resolve_one",
                        lambda acc: {"input": acc, "resolved": "P12345", "reviewed": True,
                                     "af_id": "P12345", "note": "ok"})
    rows = resolve(["A0A0R4IFS9"])
    assert rows[0]["resolved"] == "P12345"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_uniprot.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.uniprot'`.

- [ ] **Step 3: Write minimal implementation**
```python
# web/uniprot.py
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from resolve_accessions import resolve_one  # noqa: E402

UNIPROT_API = "https://rest.uniprot.org/uniprotkb/search"

def _get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def search(term: str) -> list[dict]:
    data = _get_json(UNIPROT_API, params={
        "query": term,
        "fields": "accession,id,gene_names,organism_name,reviewed,xref_alphafolddb",
        "format": "json", "size": "20",
    })
    out = []
    for r in data.get("results", []):
        af = any(x.get("database") == "AlphaFoldDB" for x in r.get("uniProtKBCrossReferences", []))
        gene = ""
        if r.get("genes"):
            gene = r["genes"][0].get("geneName", {}).get("value", "")
        out.append({
            "accession": r.get("primaryAccession", ""),
            "gene": gene,
            "organism": r.get("organism", {}).get("scientificName", ""),
            "reviewed": str(r.get("entryType", "")).startswith("UniProtKB reviewed"),
            "hasAlphaFold": af,
        })
    return out

def resolve(accessions: list[str]) -> list[dict]:
    return [resolve_one(acc) for acc in accessions]
```
```python
# web/app.py — add imports + routes (after existing /api/status)
from pydantic import BaseModel
from web import uniprot

class ResolveReq(BaseModel):
    accessions: list[str]

@app.get("/api/search")
def search(q: str = ""):
    return uniprot.search(q)

@app.post("/api/resolve")
def resolve(req: ResolveReq):
    return uniprot.resolve(req.accessions)
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_uniprot.py tests/web/test_app.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/uniprot.py web/app.py tests/web/test_uniprot.py
git commit -m "feat(web): /api/search and /api/resolve endpoints"
```

---

## Task 4: Pipeline orchestration — command build, job store, cache-first

**Files:**
- Create: `web/pipeline.py`, `tests/web/test_pipeline.py`
- Modify: `scripts/single_score.R` (honor `EPICTORE_OUTDIR`), `web/app.py` (add `/api/run`, `/api/jobs/{id}`)

**Interfaces:**
- `build_command(uniprot_id, custom_structure=None, n_terminal=None) -> list[str]` → `Rscript <R_SCRIPT> <id> [cif] [nterm]`.
- `result_exists(uniprot_id, custom_structure=None) -> bool` → `outputs/<ID>/<ID>_score.csv` present (and matched structure sidecar when custom).
- `JobStore` class: `create(uniprot_id, custom_structure, n_terminal) -> job_id`, `get(job_id) -> dict`, `set_status(job_id, status, **extra)`, in-memory dict.
- `enqueue_job(job_id, uniprot_id, custom_structure, n_terminal)` spawns a worker thread that runs `run_job`.
- `run_job(job_id, uniprot_id, custom_structure, n_terminal)`: sets `EPICTORE_OUTDIR=outputs/<ID>`, runs subprocess, marks done/error.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_pipeline.py
from web import pipeline

def test_result_exists_true(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    (tmp_path / "Q9W7E7").mkdir()
    (tmp_path / "Q9W7E7" / "Q9W7E7_score.csv").write_text("position,min\n1,0\n")
    assert pipeline.result_exists("Q9W7E7") is True

def test_result_exists_false(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    assert pipeline.result_exists("Q9W7E7") is False

def test_build_command_basic():
    cmd = pipeline.build_command("Q9W7E7")
    assert cmd[0].endswith("Rscript") and "Q9W7E7" in cmd

def test_build_command_custom():
    cmd = pipeline.build_command("Q9W7E7", custom_structure="/x/m.cif", n_terminal=57)
    assert "/x/m.cif" in cmd and "57" in cmd
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.pipeline'`.

- [ ] **Step 3: Write minimal implementation**
```python
# web/pipeline.py
import os
import subprocess
import threading
from pathlib import Path
from web import config

JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()

def _out_dir(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id

def result_exists(uniprot_id: str, custom_structure: str | None = None) -> bool:
    score = _out_dir(uniprot_id) / f"{uniprot_id}_score.csv"
    if not score.exists():
        return False
    if custom_structure:
        sidecar = _out_dir(uniprot_id) / "custom_structure.txt"
        if not sidecar.exists() or sidecar.read_text().strip() != custom_structure:
            return False
    return True

def build_command(uniprot_id: str, custom_structure: str | None = None,
                  n_terminal: int | None = None) -> list[str]:
    cmd = ["Rscript", str(config.R_SCRIPT), uniprot_id]
    if custom_structure:
        cmd.append(custom_structure)
        if n_terminal is not None:
            cmd.append(str(n_terminal))
    return cmd

class JobStore:
    @staticmethod
    def create(uniprot_id, custom_structure=None, n_terminal=None) -> str:
        job_id = f"{uniprot_id}-{abs(hash((uniprot_id, custom_structure, n_terminal)))}"
        with _LOCK:
            JOBS[job_id] = {"status": "queued", "uniprot_id": uniprot_id,
                            "custom_structure": custom_structure, "n_terminal": n_terminal}
        return job_id

    @staticmethod
    def get(job_id: str) -> dict:
        with _LOCK:
            return dict(JOBS.get(job_id, {}))

    @staticmethod
    def set_status(job_id: str, status: str, **extra):
        with _LOCK:
            JOBS.setdefault(job_id, {})
            JOBS[job_id]["status"] = status
            JOBS[job_id].update(extra)

def run_job(job_id: str, uniprot_id: str, custom_structure=None, n_terminal=None):
    out = _out_dir(uniprot_id)
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["EPICTORE_OUTDIR"] = str(out)
    if custom_structure:
        (out / "custom_structure.txt").write_text(custom_structure)
    cmd = build_command(uniprot_id, custom_structure, n_terminal)
    try:
        proc = subprocess.run(cmd, cwd=str(config.APP_DIR), env=env,
                              capture_output=True, text=True, timeout=1800)
        if proc.returncode != 0:
            JobStore.set_status(job_id, "error", error=proc.stderr[-2000:])
            return
        JobStore.set_status(job_id, "done",
                            result={"score": f"/api/results/{uniprot_id}/score",
                                    "msa": f"/api/results/{uniprot_id}/msa",
                                    "info": f"/api/results/{uniprot_id}/info"})
    except Exception as e:  # noqa: BLE001
        JobStore.set_status(job_id, "error", error=str(e))

def enqueue_job(job_id: str, uniprot_id: str, custom_structure=None, n_terminal=None):
    if result_exists(uniprot_id, custom_structure):
        JobStore.set_status(job_id, "done",
                            result={"score": f"/api/results/{uniprot_id}/score",
                                    "msa": f"/api/results/{uniprot_id}/msa",
                                    "info": f"/api/results/{uniprot_id}/info"})
        return
    JobStore.set_status(job_id, "running")
    t = threading.Thread(target=run_job, args=(job_id, uniprot_id, custom_structure, n_terminal),
                         daemon=True)
    t.start()
```
```r
# scripts/single_score.R — insert right after setup_files(); check_config()
outdir <- Sys.getenv("EPICTORE_OUTDIR", "")
if (outdir != "") {
  outputFolder <- outdir
  if (!dir.exists(outputFolder)) dir.create(outputFolder, recursive = TRUE)
}
```
```python
# web/app.py — add routes (after /api/resolve)
from fastapi import UploadFile, File
from web import pipeline

class RunReq(BaseModel):
    uniprot_id: str
    n_terminal: int | None = None

@app.post("/api/run")
async def run(req: RunReq, custom_structure: UploadFile | None = File(None)):
    path = None
    if custom_structure:
        import pathlib, tempfile
        p = pathlib.Path(tempfile.gettempdir()) / custom_structure.filename
        p.write_bytes(await custom_structure.read())
        path = str(p)
    job_id = pipeline.JobStore.create(req.uniprot_id, path, req.n_terminal)
    pipeline.enqueue_job(job_id, req.uniprot_id, path, req.n_terminal)
    return {"job_id": job_id}

@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    return pipeline.JobStore.get(job_id)
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_pipeline.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/pipeline.py web/app.py scripts/single_score.R tests/web/test_pipeline.py
git commit -m "feat(web): pipeline orchestration, job store, cache-first run"
```

---

## Task 5: Results endpoints — score CSV, MSA, info + top sites

**Files:**
- Create: `web/parsing.py`, `tests/web/test_parsing.py`
- Modify: `web/app.py` (add `/api/results/{id}/{score,msa,info}`)

**Interfaces:**
- `parse_score_csv(path) -> list[dict]` (one dict per residue row).
- `parse_msa(path) -> dict` with `{"records": [{"id": str, "seq": str}], "query": str}`.
- `compute_top_sites(rows: list[dict], n: int = 5) -> list[dict]` = top N positions by `min`.
- `write_meta(uniprot_id, **fields)` writes `outputs/<ID>/<ID>_meta.json`; `read_meta(uniprot_id) -> dict|None`.
- `app.py`: `GET /api/results/{id}/score`, `.../msa`, `.../info`.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_parsing.py
import json
from web import parsing

SCORE = ("position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
         "1,0,1,1.2,0.6,2.8,0,normalized_entropy,M\n"
         "2,0.1,1,0.8,0.65,2.7,0.1,normalized_entropy,T\n")

def test_parse_score_csv(tmp_path):
    p = tmp_path / "Q9W7E7_score.csv"; p.write_text(SCORE)
    rows = parsing.parse_score_csv(p)
    assert rows[0]["position"] == 1 and rows[0]["aa"] == "M"
    assert float(rows[1]["min"]) == 0.1

def test_compute_top_sites():
    rows = [{"position": i, "min": (5 - i)} for i in range(5)]
    top = parsing.compute_top_sites(rows, n=2)
    assert [t["position"] for t in top] == [0, 1]

def test_parse_msa(tmp_path):
    p = tmp_path / "Q9W7E7_msa.fasta"; p.write_text(">Q9W7E7\nACGT\n>other\nAC-T\n")
    msa = parsing.parse_msa(p)
    assert msa["records"][0]["seq"] == "ACGT"
    assert msa["query"] == "Q9W7E7"

def test_meta_roundtrip(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    parsing.write_meta("Q9W7E7", gene="smad5", organism="Danio rerio")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_parsing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.parsing'`.

- [ ] **Step 3: Write minimal implementation**
```python
# web/parsing.py
import csv
import json
from pathlib import Path
from web import config

def parse_score_csv(path) -> list[dict]:
    path = Path(path)
    with path.open() as fh:
        return [dict(r) for r in csv.DictReader(fh)]

def parse_msa(path) -> dict:
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
    return {"records": records, "query": records[0]["id"] if records else ""}

def compute_top_sites(rows: list[dict], n: int = 5) -> list[dict]:
    ranked = sorted(rows, key=lambda r: float(r.get("min", 0)), reverse=True)
    return [{"position": int(r["position"]), "min": float(r["min"]),
             "min_feature": r.get("min_feature", "")} for r in ranked[:n]]

def _meta_path(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_meta.json"

def write_meta(uniprot_id: str, **fields):
    _meta_path(uniprot_id).write_text(json.dumps(fields, indent=2))

def read_meta(uniprot_id: str) -> dict | None:
    p = _meta_path(uniprot_id)
    return json.loads(p.read_text()) if p.exists() else None
```
```python
# web/app.py — add routes
from web import parsing

@app.get("/api/results/{uniprot_id}/score")
def result_score(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_score.csv"
    if not p.exists():
        return {"error": "not found"}, 404
    return parsing.parse_score_csv(p)

@app.get("/api/results/{uniprot_id}/msa")
def result_msa(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_msa.fasta"
    if not p.exists():
        return {"error": "not found"}, 404
    return parsing.parse_msa(p)

@app.get("/api/results/{uniprot_id}/info")
def result_info(uniprot_id: str):
    meta = parsing.read_meta(uniprot_id)
    if meta is None:
        return {"error": "not found"}, 404
    return meta
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_parsing.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/parsing.py web/app.py tests/web/test_parsing.py
git commit -m "feat(web): results endpoints (score, msa, info) with top-site computation"
```

---

## Task 5.5: Backend corrections — run endpoint, 404s, single-flight queue, meta, peaks

> **Why:** Tasks 1–5 are complete (commits `d985c3e`–`ceb2b1c`) but were produced by a
> weaker model. Review with live TestClient probing found correctness gaps the frontend
> (Tasks 6+) builds on. Fix them now so the frontend isn't built on broken contracts:
> - `POST /api/run` returns **422 for every client** — a Pydantic body model (`RunReq`)
>   cannot be combined with `File()` in FastAPI (verified: JSON *and* multipart both 422
>   with `{"loc":["body","req"],"msg":"Field required"}`). The frontend `FormData`
>   (Task 6) and the smoke test `curl -F` (Task 10) would both fail.
> - Missing results/jobs return **HTTP 200**, not 404 — `return {"error": ...}, 404`
>   serializes as the JSON array `[{"error":"not found"},404]` (verified).
> - `enqueue_job` spawns **one thread per job** → concurrent BLAST/R runs, violating
>   spec §4.3 ("only one R run executes at a time"). Job ids use randomized `hash()`
>   (salted per process) and `create()` clobbers an in-flight identical job.
> - Jobs carry **no `progress`** (spec §4.2 promises it) and R output vanishes.
> - `/api/results/{id}/info` **404s for everything** — nothing writes meta JSON yet,
>   including on the cache-hit path (goal #7).
> - `compute_top_sites` is a plain top-N sort → adjacent residues of one peak; spec §4.4
>   wants ranked **distinct** insertion sites (local maxima).
> - `parse_score_csv` leaves numerics as strings and doesn't map R's `NA`.
> - `uniprot.search` raises → 500 on network blips (spec §5 wants retry) and sends
>   empty queries to UniProt.
> - `run_job` trusts exit code 0 without checking the outputs exist.
> - `web/requirements.txt` omits `python-multipart` (the app cannot boot with
>   Form/File params without it; it's in `pyproject.toml` but not here).

**Files:**
- Modify: `web/app.py` (Form-based `/api/run`; real 404s; drop `RunReq`)
- Modify: `web/pipeline.py` (full rewrite below: queue worker, deterministic ids,
  Popen streaming to `run.log`, `ensure_meta`, output verification)
- Modify: `web/parsing.py` (`parse_score_csv` type coercion + NA; `compute_top_sites`
  local maxima)
- Modify: `web/uniprot.py` (`search` retry + empty-guard; close responses)
- Modify: `web/requirements.txt` (add `python-multipart`)
- Modify: `tests/web/test_parsing.py`, `tests/web/test_uniprot.py`,
  `tests/web/test_pipeline.py`, `tests/web/test_app.py` (full content below)

**Interfaces (changed — Tasks 6+ rely on these):**
- `POST /api/run` consumes **multipart/form-data**: `uniprot_id` (str, required),
  `n_terminal` (int, optional), `custom_structure` (.cif file, optional) →
  `{"job_id": str}`. Matches `api.ts` `runPrediction` (FormData) and smoke test `curl -F`.
- `GET /api/jobs/{id}` → `{status: "queued"|"running"|"done"|"error", progress: str,
  error?, result?}`; **404** for unknown ids.
- `GET /api/results/{id}/{score,msa,info}` → **404** (HTTPException) when absent.
- `parse_score_csv(path) -> list[dict]` — numeric columns as `int|float|None`
  (`NA`→`None`); string columns (`aa`, `ss`, `chain`, `min_feature`) unchanged.
- `compute_top_sites(rows, n=5) -> list[dict]` — top-N **local maxima** of `min`
  (strictly greater than both neighbours; terminal residues eligible).
  `webui/src/chart.ts` `topSites` (Task 6) MUST implement the identical rule.
- `pipeline.ensure_meta(uniprot_id, custom_structure=None, n_terminal=None,
  resolution_note="")` → writes `<ID>_meta.json` with `uniprot_id`, `length`,
  `top_sites`, `gene`, `organism`, `reviewed`, `hasAlphaFold`, `resolution_note`;
  tolerant of UniProt failure. Task 9's `finalize_meta` delegates to it.

- [ ] **Step 1: Replace the tests (they must fail against the current code)**

```python
# tests/web/test_parsing.py (full replacement)
from web import parsing

SCORE = ("position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
         "1,0,1,1.2,0.6,2.8,0,normalized_entropy,M\n"
         "2,0.1,1,0.8,0.65,2.7,0.1,normalized_entropy,T\n")

def test_parse_score_csv(tmp_path):
    p = tmp_path / "Q9W7E7_score.csv"; p.write_text(SCORE)
    rows = parsing.parse_score_csv(p)
    assert rows[0]["position"] == 1 and rows[0]["aa"] == "M"
    assert rows[1]["min"] == 0.1                  # coerced to float, not str
    assert rows[0]["normalized_entropy"] == 0

def test_parse_score_csv_na_becomes_none(tmp_path):
    p = tmp_path / "X_score.csv"
    p.write_text("position,min,aa,phi\n1,NA,M,NA\n")
    rows = parsing.parse_score_csv(p)
    assert rows[0]["min"] is None and rows[0]["phi"] is None

def test_compute_top_sites_detects_distinct_peaks():
    rows = [{"position": i + 1, "min": m, "min_feature": "x"}
            for i, m in enumerate([0.1, 0.9, 0.8, 0.2, 0.85, 0.7])]
    top = parsing.compute_top_sites(rows, n=2)
    assert [t["position"] for t in top] == [2, 5]  # two peaks, not residues 2 and 3

def test_parse_msa(tmp_path):
    p = tmp_path / "Q9W7E7_msa.fasta"; p.write_text(">Q9W7E7\nACGT\n>other\nAC-T\n")
    msa = parsing.parse_msa(p)
    assert msa["records"][0]["seq"] == "ACGT"
    assert msa["query"] == "Q9W7E7"

def test_meta_roundtrip(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    parsing.write_meta("Q9W7E7", gene="smad5", organism="Danio rerio")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5"
```

```python
# tests/web/test_uniprot.py (full replacement)
import json
import urllib.error
import urllib.request
from web import uniprot

class FakeResp:
    """urlopen stand-in that also works as a context manager."""
    def __init__(self, payload): self._p = payload
    def read(self): return json.dumps(self._p).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_search_parses_json(monkeypatch):
    fake = {"results": [
        {"primaryAccession": "Q9W7E7", "genes": [{"geneName": {"value": "smad5"}}],
         "organism": {"scientificName": "Danio rerio"},
         "entryType": "UniProtKB reviewed",
         "uniProtKBCrossReferences": [{"database": "AlphaFoldDB", "id": "Q9W7E7"}]}]}
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: FakeResp(fake))
    rows = uniprot.search("smad5")
    assert rows[0]["accession"] == "Q9W7E7"
    assert rows[0]["gene"] == "smad5"
    assert rows[0]["organism"] == "Danio rerio"
    assert rows[0]["reviewed"] is True
    assert rows[0]["hasAlphaFold"] is True

def test_search_network_failure_retries_then_empty(monkeypatch):
    calls = {"n": 0}
    def boom(*a, **k):
        calls["n"] += 1
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr("time.sleep", lambda s: None)
    assert uniprot.search("smad5") == []
    assert calls["n"] == 2  # one retry

def test_search_empty_term_short_circuits(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no network")))
    assert uniprot.search("") == []
    assert uniprot.search("   ") == []

def test_resolve_uses_resolve_one(monkeypatch):
    from web.uniprot import resolve
    monkeypatch.setattr("web.uniprot.resolve_one",
                        lambda acc: {"input": acc, "resolved": "P12345", "reviewed": True,
                                     "af_id": "P12345", "note": "ok"})
    rows = resolve(["A0A0R4IFS9"])
    assert rows[0]["resolved"] == "P12345"
```

```python
# tests/web/test_pipeline.py (full replacement)
import threading
import time
from pathlib import Path
from web import parsing, pipeline

SCORE_CSV = ("position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
             "1,0,1,1,0.6,2.6,0.1,n_e,M\n"
             "2,0.1,1,0.8,0.65,2.55,0.9,n_e,T\n"
             "3,0,1,1,0.6,2.6,0.2,n_e,A\n")

class FakePopen:
    """Minimal Popen stand-in: canned stdout, already-exited returncode."""
    def __init__(self, lines=(), returncode=0):
        import io
        self.stdout = io.StringIO("".join(lines))
        self.returncode = returncode
    def poll(self):
        return self.returncode
    def kill(self):
        self.returncode = -9

def make_fake_popen(uniprot_id="Q9W7E7", lines=("some r output\n",),
                    returncode=0, write_outputs=True):
    captured = {}
    def _fake(cmd, cwd=None, env=None, **kw):
        captured["cmd"], captured["cwd"], captured["env"] = cmd, cwd, env
        if write_outputs:
            out = Path(env["EPICTORE_OUTDIR"])
            (out / f"{uniprot_id}_score.csv").write_text(SCORE_CSV)
            (out / f"{uniprot_id}_msa.fasta").write_text(f">{uniprot_id}\nMA\n")
        return FakePopen(lines=lines, returncode=returncode)
    _fake.captured = captured
    return _fake

def test_result_exists_true(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    (tmp_path / "Q9W7E7").mkdir()
    (tmp_path / "Q9W7E7" / "Q9W7E7_score.csv").write_text("position,min\n1,0\n")
    assert pipeline.result_exists("Q9W7E7") is True

def test_result_exists_false(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    assert pipeline.result_exists("Q9W7E7") is False

def test_build_command_basic():
    cmd = pipeline.build_command("Q9W7E7")
    assert cmd[0].endswith("Rscript") and "Q9W7E7" in cmd

def test_build_command_custom():
    cmd = pipeline.build_command("Q9W7E7", custom_structure="/x/m.cif", n_terminal=57)
    assert "/x/m.cif" in cmd and "57" in cmd

def test_job_id_deterministic():
    assert pipeline.JobStore.create("Q9W7E7") == pipeline.JobStore.create("Q9W7E7")

def test_enqueue_job_cache_first(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(SCORE_CSV)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    monkeypatch.setattr(pipeline.subprocess, "Popen",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not run")))
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.enqueue_job(job_id, "Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
    assert parsing.read_meta("Q9W7E7") is not None  # meta (re)written on cache hit

def test_run_job_sets_outdir_and_cwd(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    fake = make_fake_popen()
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    assert fake.captured["cwd"] == str(tmp_path)
    assert fake.captured["env"]["EPICTORE_OUTDIR"].endswith("Q9W7E7")
    assert pipeline.JobStore.get(job_id)["status"] == "done"
    assert (tmp_path / "Q9W7E7" / "run.log").exists()
    assert parsing.read_meta("Q9W7E7") is not None  # meta written on run success

def test_run_job_custom_structure_sidecar(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [])
    monkeypatch.setattr(pipeline.subprocess, "Popen", make_fake_popen())
    job_id = pipeline.JobStore.create("Q9W7E7", custom_structure="/x/m.cif")
    pipeline.run_job(job_id, "Q9W7E7", custom_structure="/x/m.cif")
    sidecar = tmp_path / "Q9W7E7" / "custom_structure.txt"
    assert sidecar.exists() and sidecar.read_text() == "/x/m.cif"
    assert pipeline.JobStore.get(job_id)["status"] == "done"

def test_run_job_error_path(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    fake = make_fake_popen(lines=("boom: something failed\n",), returncode=1)
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    state = pipeline.JobStore.get(job_id)
    assert state["status"] == "error" and "boom" in state["error"]

def test_run_job_errors_when_outputs_missing(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(cfg, "APP_DIR", tmp_path)
    fake = make_fake_popen(returncode=0, write_outputs=False)  # exit 0, no files
    monkeypatch.setattr(pipeline.subprocess, "Popen", fake)
    job_id = pipeline.JobStore.create("Q9W7E7")
    pipeline.run_job(job_id, "Q9W7E7")
    state = pipeline.JobStore.get(job_id)
    assert state["status"] == "error" and "did not produce" in state["error"]

def test_ensure_meta_writes_json_with_peak_top_sites(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(SCORE_CSV)
    monkeypatch.setattr(pipeline.uniprot, "search", lambda q: [
        {"accession": "Q9W7E7", "gene": "smad5", "organism": "Danio rerio",
         "reviewed": True, "hasAlphaFold": True}])
    pipeline.ensure_meta("Q9W7E7")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5" and meta["length"] == 3
    assert meta["top_sites"][0]["position"] == 2  # the 0.9 peak

def test_ensure_meta_survives_uniprot_failure(tmp_path, monkeypatch):
    import urllib.error
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text("position,min,aa\n1,0.5,M\n")
    def boom(q): raise urllib.error.URLError("offline")
    monkeypatch.setattr(pipeline.uniprot, "search", boom)
    pipeline.ensure_meta("Q9W7E7")
    meta = parsing.read_meta("Q9W7E7")
    assert meta["uniprot_id"] == "Q9W7E7" and meta["gene"] == ""

def test_jobs_run_one_at_a_time(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: False)
    started = threading.Event(); release = threading.Event(); running = []
    def fake_run_job(job_id, uid, custom_structure=None, n_terminal=None):
        running.append(job_id)
        started.set()
        release.wait(5)
        running.remove(job_id)
        pipeline.JobStore.set_status(job_id, "done")
    monkeypatch.setattr(pipeline, "run_job", fake_run_job)
    j1 = pipeline.JobStore.create("AAA")
    pipeline.enqueue_job(j1, "AAA")
    assert started.wait(5)
    j2 = pipeline.JobStore.create("BBB")
    pipeline.enqueue_job(j2, "BBB")
    time.sleep(0.3)
    assert running == [j1]                                    # second job not started
    assert pipeline.JobStore.get(j2)["status"] == "queued"
    # re-submitting the in-flight job must not clobber or duplicate it
    assert pipeline.JobStore.create("AAA") == j1
    pipeline.enqueue_job(j1, "AAA")
    assert pipeline.JobStore.get(j1)["status"] == "running"
    release.set()
    for _ in range(50):
        if pipeline.JobStore.get(j2)["status"] == "done":
            break
        time.sleep(0.1)
    assert pipeline.JobStore.get(j2)["status"] == "done"
```

```python
# tests/web/test_app.py (append — add `from web import pipeline` to the imports)
def test_run_endpoint_accepts_multipart(tmp_path, monkeypatch):
    import web.config as cfg
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "result_exists", lambda *a, **k: True)
    monkeypatch.setattr(pipeline, "ensure_meta", lambda *a, **k: None)
    client = TestClient(app_module.app)
    resp = client.post("/api/run", data={"uniprot_id": "Q9W7E7"})
    assert resp.status_code == 200
    assert resp.json()["job_id"].startswith("Q9W7E7-")

def test_results_404_for_unknown_id():
    client = TestClient(app_module.app)
    assert client.get("/api/results/NOPE/score").status_code == 404
    assert client.get("/api/results/NOPE/msa").status_code == 404
    assert client.get("/api/results/NOPE/info").status_code == 404

def test_unknown_job_404():
    client = TestClient(app_module.app)
    assert client.get("/api/jobs/NOPE").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. .venv/bin/python -m pytest tests/web -q`
Expected: FAIL — new tests fail against current code (e.g. `test_run_endpoint_accepts_multipart`
gets 422, 404 tests get 200, `test_compute_top_sites_detects_distinct_peaks` gets `[2, 3]`,
`test_run_job_*` fail on missing `Popen` fake plumbing).

- [ ] **Step 3: Rewrite `web/parsing.py`**

```python
# web/parsing.py (full replacement)
import csv
import json
from pathlib import Path
from web import config

NUMERIC_COLS = {"position", "normalized_entropy", "ss_score", "rsa", "inv_anchor2",
                "sum_score", "min", "shannon", "resnum", "sasa", "phi", "psi",
                "iupred2", "anchor2"}

def _num(v):
    """Coerce an R write.csv(..., as.character) cell: NA/blank -> None, else number."""
    if v is None:
        return None
    v = str(v).strip()
    if v in ("", "NA", "NaN", "nan"):
        return None
    try:
        f = float(v)
    except ValueError:
        return v
    return int(f) if f.is_integer() else f

def parse_score_csv(path) -> list[dict]:
    with Path(path).open() as fh:
        return [{k: (_num(v) if k in NUMERIC_COLS else v) for k, v in r.items()}
                for r in csv.DictReader(fh)]

def parse_msa(path) -> dict:
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
    return {"records": records, "query": records[0]["id"] if records else ""}

def compute_top_sites(rows: list[dict], n: int = 5) -> list[dict]:
    """Top N local maxima of the `min` score: a residue qualifies only if its `min`
    strictly exceeds both neighbours, so sites are distinct peaks rather than
    adjacent residues of one peak. MUST mirror webui/src/chart.ts topSites."""
    mins = [float(r.get("min") or 0) for r in rows]
    peaks = []
    for i, m in enumerate(mins):
        left = mins[i - 1] if i > 0 else float("-inf")
        right = mins[i + 1] if i < len(mins) - 1 else float("-inf")
        if m > left and m > right:
            r = rows[i]
            peaks.append({"position": int(r["position"]), "min": m,
                          "min_feature": r.get("min_feature", "")})
    peaks.sort(key=lambda p: p["min"], reverse=True)
    return peaks[:n]

def _meta_path(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_meta.json"

def write_meta(uniprot_id: str, **fields):
    p = _meta_path(uniprot_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(fields, indent=2))

def read_meta(uniprot_id: str) -> dict | None:
    p = _meta_path(uniprot_id)
    return json.loads(p.read_text()) if p.exists() else None
```

- [ ] **Step 4: Rewrite `web/uniprot.py`**

```python
# web/uniprot.py (full replacement)
import json
import logging
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
from resolve_accessions import resolve_one  # noqa: E402

UNIPROT_API = "https://rest.uniprot.org/uniprotkb/search"
log = logging.getLogger(__name__)

def _get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def search(term: str) -> list[dict]:
    term = (term or "").strip()
    if not term:
        return []
    params = {"query": term,
              "fields": "accession,id,gene_names,organism_name,reviewed,xref_alphafolddb",
              "format": "json", "size": "20"}
    data = None
    for attempt in (1, 2):  # one retry for network blips (spec §5); then empty, never 500
        try:
            data = _get_json(UNIPROT_API, params=params)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            log.warning("UniProt search attempt %d failed: %s", attempt, e)
            if attempt == 2:
                return []
            time.sleep(1)
    out = []
    for r in (data or {}).get("results", []):
        af = any(x.get("database") == "AlphaFoldDB" for x in r.get("uniProtKBCrossReferences", []))
        gene = ""
        if r.get("genes"):
            gene = r["genes"][0].get("geneName", {}).get("value", "")
        out.append({
            "accession": r.get("primaryAccession", ""),
            "gene": gene,
            "organism": r.get("organism", {}).get("scientificName", ""),
            "reviewed": str(r.get("entryType", "")).startswith("UniProtKB reviewed"),
            "hasAlphaFold": af,
        })
    return out

def resolve(accessions: list[str]) -> list[dict]:
    return [resolve_one(acc) for acc in accessions]
```

- [ ] **Step 5: Rewrite `web/pipeline.py`**

```python
# web/pipeline.py (full replacement)
import hashlib
import os
import queue
import subprocess
import threading
import time
from pathlib import Path

from web import config, parsing, uniprot

JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()
_QUEUE: queue.Queue = queue.Queue()
_ACTIVE: set[str] = set()
_WORKER_STARTED = False
RUN_TIMEOUT_S = 1800

def _out_dir(uniprot_id: str) -> Path:
    return config.OUTPUTS_DIR / uniprot_id

def _result_links(uniprot_id: str) -> dict:
    return {"score": f"/api/results/{uniprot_id}/score",
            "msa": f"/api/results/{uniprot_id}/msa",
            "info": f"/api/results/{uniprot_id}/info"}

def result_exists(uniprot_id: str, custom_structure: str | None = None) -> bool:
    score = _out_dir(uniprot_id) / f"{uniprot_id}_score.csv"
    if not score.exists():
        return False
    if custom_structure:
        sidecar = _out_dir(uniprot_id) / "custom_structure.txt"
        if not sidecar.exists() or sidecar.read_text().strip() != custom_structure:
            return False
    return True

def build_command(uniprot_id: str, custom_structure: str | None = None,
                  n_terminal: int | None = None) -> list[str]:
    cmd = ["Rscript", str(config.R_SCRIPT), uniprot_id]
    if custom_structure:
        cmd.append(custom_structure)
        if n_terminal is not None:
            cmd.append(str(n_terminal))
    return cmd

def make_job_id(uniprot_id: str, custom_structure=None, n_terminal=None) -> str:
    # Deterministic: hash() is salted per process (PYTHONHASHSEED), which would
    # defeat dedupe across restarts and make job ids unstable.
    key = f"{uniprot_id}|{custom_structure}|{n_terminal}"
    return f"{uniprot_id}-{hashlib.sha256(key.encode()).hexdigest()[:12]}"

class JobStore:
    @staticmethod
    def create(uniprot_id, custom_structure=None, n_terminal=None) -> str:
        job_id = make_job_id(uniprot_id, custom_structure, n_terminal)
        with _LOCK:
            existing = JOBS.get(job_id)
            if existing and existing.get("status") in ("queued", "running"):
                return job_id  # identical job already in flight; keep it
            JOBS[job_id] = {"status": "queued", "uniprot_id": uniprot_id,
                            "custom_structure": custom_structure,
                            "n_terminal": n_terminal, "progress": ""}
        return job_id

    @staticmethod
    def get(job_id: str) -> dict:
        with _LOCK:
            return dict(JOBS.get(job_id, {}))

    @staticmethod
    def set_status(job_id: str, status: str, **extra):
        with _LOCK:
            JOBS.setdefault(job_id, {})
            JOBS[job_id]["status"] = status
            JOBS[job_id].update(extra)

def ensure_meta(uniprot_id: str, custom_structure=None, n_terminal=None,
                resolution_note: str = ""):
    """(Re)write outputs/<ID>/<ID>_meta.json so /api/results/<id>/info always
    resolves — for fresh runs and results reused from disk (goal #7).
    Idempotent; a UniProt outage must not fail the job."""
    out = _out_dir(uniprot_id)
    rows = parsing.parse_score_csv(out / f"{uniprot_id}_score.csv")
    meta = {
        "uniprot_id": uniprot_id,
        "length": len(rows),
        "top_sites": parsing.compute_top_sites(rows),
        "resolution_note": resolution_note,
        "custom_structure": custom_structure,
        "n_terminal": n_terminal,
        "gene": "", "organism": "", "reviewed": None, "hasAlphaFold": None,
    }
    try:
        hits = uniprot.search(uniprot_id)
        hit = next((h for h in hits if h["accession"] == uniprot_id),
                   hits[0] if hits else None)
        if hit:
            meta.update({"gene": hit["gene"], "organism": hit["organism"],
                         "reviewed": hit["reviewed"], "hasAlphaFold": hit["hasAlphaFold"]})
    except Exception:  # noqa: BLE001
        pass
    parsing.write_meta(uniprot_id, **meta)

def run_job(job_id: str, uniprot_id: str, custom_structure=None, n_terminal=None):
    out = _out_dir(uniprot_id)
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["EPICTORE_OUTDIR"] = str(out)
    if custom_structure:
        (out / "custom_structure.txt").write_text(custom_structure)
    cmd = build_command(uniprot_id, custom_structure, n_terminal)
    log_path = out / "run.log"
    try:
        proc = subprocess.Popen(
            cmd, cwd=str(config.APP_DIR), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + RUN_TIMEOUT_S
        with log_path.open("w") as log:
            while True:
                line = proc.stdout.readline()
                if line:
                    log.write(line)
                    log.flush()
                    JobStore.set_status(job_id, "running", progress=line.strip()[-200:])
                elif proc.poll() is not None:
                    break
                elif time.time() > deadline:
                    proc.kill()
                    raise TimeoutError(f"pipeline exceeded {RUN_TIMEOUT_S}s")
                else:
                    time.sleep(0.2)
        if proc.returncode != 0:
            JobStore.set_status(job_id, "error", error=log_path.read_text()[-2000:])
            return
        missing = [f for f in (f"{uniprot_id}_score.csv", f"{uniprot_id}_msa.fasta")
                   if not (out / f).exists()]
        if missing:
            JobStore.set_status(job_id, "error",
                                error=f"pipeline exited 0 but did not produce: {', '.join(missing)}")
            return
        ensure_meta(uniprot_id, custom_structure, n_terminal)
        JobStore.set_status(job_id, "done", progress="", result=_result_links(uniprot_id))
    except Exception as e:  # noqa: BLE001
        JobStore.set_status(job_id, "error", error=str(e))

def _worker():
    # Single-flight runner (spec §4.3): BLAST is heavy — one R job at a time.
    while True:
        job_id = _QUEUE.get()
        try:
            job = JobStore.get(job_id)
            JobStore.set_status(job_id, "running")
            run_job(job_id, job["uniprot_id"], job.get("custom_structure"),
                    job.get("n_terminal"))
        finally:
            with _LOCK:
                _ACTIVE.discard(job_id)
            _QUEUE.task_done()

def _ensure_worker():
    global _WORKER_STARTED
    with _LOCK:
        if not _WORKER_STARTED:
            threading.Thread(target=_worker, daemon=True).start()
            _WORKER_STARTED = True

def enqueue_job(job_id: str, uniprot_id: str, custom_structure=None, n_terminal=None):
    with _LOCK:
        if job_id in _ACTIVE:
            return  # identical job already queued/running
        _ACTIVE.add(job_id)
    if result_exists(uniprot_id, custom_structure):
        ensure_meta(uniprot_id, custom_structure, n_terminal)
        JobStore.set_status(job_id, "done", result=_result_links(uniprot_id))
        with _LOCK:
            _ACTIVE.discard(job_id)
        return
    JobStore.set_status(job_id, "queued")
    _ensure_worker()
    _QUEUE.put(job_id)
```

- [ ] **Step 6: Rewrite `web/app.py`**

```python
# web/app.py (full replacement)
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from web import config, parsing, pipeline, uniprot

@asynccontextmanager
async def lifespan(app: FastAPI):
    # The docker entrypoint owns background install.R; the app only reports state.
    yield

app = FastAPI(title="EpicTope", lifespan=lifespan)

@app.get("/api/status")
def status():
    progress = ""
    if config.INSTALL_LOG.exists():
        text = config.INSTALL_LOG.read_text().strip()
        if text:
            progress = text.splitlines()[-1]
    return {"installed": config.INSTALL_MARKER.exists(), "progress": progress}

class ResolveReq(BaseModel):
    accessions: list[str]

@app.get("/api/search")
def search(q: str = ""):
    return uniprot.search(q)

@app.post("/api/resolve")
def resolve(req: ResolveReq):
    return uniprot.resolve(req.accessions)

# multipart/form-data (the .cif upload cannot ride in a JSON body). Flat Form
# fields only — a Pydantic body model combined with File() makes every request
# fail validation with 422.
@app.post("/api/run")
async def run(uniprot_id: str = Form(...),
              n_terminal: int | None = Form(None),
              custom_structure: UploadFile | None = File(None)):
    path = None
    if custom_structure:
        import pathlib, tempfile, uuid
        safe_name = pathlib.Path(custom_structure.filename or "").name or "structure.cif"
        p = pathlib.Path(tempfile.gettempdir()) / f"{uuid.uuid4().hex}_{safe_name}"
        p.write_bytes(await custom_structure.read())
        path = str(p)
    job_id = pipeline.JobStore.create(uniprot_id, path, n_terminal)
    pipeline.enqueue_job(job_id, uniprot_id, path, n_terminal)
    return {"job_id": job_id}

@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    state = pipeline.JobStore.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="unknown job id")
    return state

@app.get("/api/results/{uniprot_id}/score")
def result_score(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_score.csv"
    if not p.exists():
        raise HTTPException(status_code=404, detail="no score result for this ID")
    return parsing.parse_score_csv(p)

@app.get("/api/results/{uniprot_id}/msa")
def result_msa(uniprot_id: str):
    p = config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_msa.fasta"
    if not p.exists():
        raise HTTPException(status_code=404, detail="no MSA result for this ID")
    return parsing.parse_msa(p)

@app.get("/api/results/{uniprot_id}/info")
def result_info(uniprot_id: str):
    meta = parsing.read_meta(uniprot_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="no metadata for this ID")
    return meta
```

- [ ] **Step 7: Update `web/requirements.txt`**

```text
# web/requirements.txt (full replacement)
fastapi
uvicorn[standard]
python-multipart
pytest
httpx
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `PYTHONPATH=. .venv/bin/python -m pytest tests/web -q`
Expected: PASS (all ~25 tests).
Then re-probe the endpoint behaviour that failed review:
```bash
PYTHONPATH=. .venv/bin/python - <<'EOF'
from fastapi.testclient import TestClient
from web import app as app_module, pipeline
pipeline.enqueue_job = lambda *a, **k: None
c = TestClient(app_module.app)
r = c.post("/api/run", data={"uniprot_id": "Q9W7E7"})
assert r.status_code == 200, r.text          # was 422
r = c.get("/api/results/NOPE/score")
assert r.status_code == 404, r.text          # was 200 with [body, status] array
print("probe OK")
EOF
```
Expected: `probe OK`.

- [ ] **Step 9: Commit**

```bash
git add web/app.py web/pipeline.py web/parsing.py web/uniprot.py web/requirements.txt \
        tests/web/test_app.py tests/web/test_pipeline.py tests/web/test_parsing.py tests/web/test_uniprot.py
git commit -m "fix(web): repair run endpoint, error codes, and job runner before frontend work

Review of the Tasks 1-5 implementation (built with a weaker model) found
defects the frontend tasks depend on; correct them before proceeding:

- /api/run 422'd every request (Pydantic body + File can't mix) - use
  multipart Form fields, matching api.ts FormData and the smoke test.
- Results/job 404s returned HTTP 200 with a [body, status] array - raise
  HTTPException instead.
- enqueue_job spawned one thread per job - replace with a single-flight
  queue worker (spec: one R/BLAST run at a time), deterministic sha256
  job ids, and dedupe of in-flight submissions.
- Stream R output to outputs/<ID>/run.log and expose it as job progress;
  verify score/MSA outputs actually exist after exit code 0.
- Write meta JSON on cache hits and run success via ensure_meta so
  /api/results/{id}/info resolves for disk-reused results.
- compute_top_sites now returns distinct local maxima, not adjacent
  residues of one peak; parse_score_csv coerces numeric columns, NA->null.
- uniprot.search retries once then returns [] instead of 500ing, and
  short-circuits empty queries.
- Add missing python-multipart to web/requirements.txt."
```

---

## Task 6: Frontend scaffold (Vite + TS) and score chart

**Files:**
- Create: `webui/package.json`, `webui/tsconfig.json`, `webui/vite.config.ts`, `webui/index.html`, `webui/src/main.ts`, `webui/src/api.ts`, `webui/src/types.ts`, `webui/src/style.css`, `webui/src/chart.ts`
- Test: `webui/test/score.test.ts`
- Modify: `web/app.py` (mount static at root)

**Interfaces:**
- `api.ts`: `fetchSearch(q)`, `fetchResolve(accs)`, `runPrediction({uniprot_id, n_terminal, file})`, `fetchJob(id)`, `fetchScore(id)`, `fetchMsa(id)`, `fetchInfo(id)`.
- `types.ts`: `ScoreRow`, `Msa`, `Info`, `Job`.
- `chart.ts`: `renderScoreChart(canvas, rows, topSites)` using Chart.js; returns `{chart, setHoverCallback, highlight}`; `topSites(rows, n)` exported. Feature tracks are drawn **raw** (goal #5: spikes must sit exactly on their residue); `min` is emphasized and gets an additional dashed rolling-window-7 smoothed overlay via `movingAverage` (mirrors `moving_average(plot_data$min_val, 7)` in `scripts/plot_scores.R`). **Vertical annotations** at the top candidate positions. `topSites` MUST use the same **local-maxima** logic as `parsing.compute_top_sites` (corrected in Task 5.5), not a plain top-N sort.
- Static mount: `app.mount("/", StaticFiles(directory=config.APP_DIR/"web"/"static", html=True, check_dir=False), name="static")` — `check_dir=False` so backend tests still import the app locally before the first frontend build.
- `npm install` generates `webui/package-lock.json`; **commit it** (Task 10's Docker build uses `npm ci`).

- [ ] **Step 1: Write the failing test**
```ts
// webui/test/score.test.ts
import { describe, it, expect } from "vitest";
import { topSites, movingAverage } from "../src/chart";

describe("topSites", () => {
  it("returns the single highest peak", () => {
    const rows = [{ position: 1, min: 0.1 }, { position: 2, min: 0.9 }, { position: 3, min: 0.5 }];
    expect(topSites(rows as any, 1).map(s => s.position)).toEqual([2]);
  });
  it("detects distinct local maxima, not adjacent residues", () => {
    const rows = [
      { position: 1, min: 0.1 }, { position: 2, min: 0.9 }, { position: 3, min: 0.8 },
      { position: 4, min: 0.2 }, { position: 5, min: 0.85 }, { position: 6, min: 0.7 },
    ];
    // peaks at 2 (0.9) and 5 (0.85); position 3 is not a peak
    expect(topSites(rows as any, 2).map(s => s.position)).toEqual([2, 5]);
  });
});

describe("movingAverage", () => {
  it("averages within a centered window", () => {
    const rows = [1, 2, 3, 4, 5].map((x, i) => ({ position: i + 1, min: x }));
    expect(movingAverage(rows as any, "min", 3)[2]).toBeCloseTo(3); // mean(2,3,4)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app/webui && npm install && npx vitest run`
Expected: FAIL — file not found / `topSites` not exported.

- [ ] **Step 3: Write minimal implementation**
```json
// webui/package.json
{
  "name": "epictope-webui",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "chart.js": "^4.4.0", "chartjs-plugin-annotation": "^3.0.0" },
  "devDependencies": { "typescript": "^5.4.0", "vite": "^5.2.0", "vitest": "^1.5.0" }
}
```
```json
// webui/tsconfig.json
{ "compilerOptions": { "target": "ES2020", "module": "ESNext", "moduleResolution": "bundler",
  "strict": true, "lib": ["ES2020", "DOM"], "types": ["vite/client"], "skipLibCheck": true },
  "include": ["src", "test"] }
```
```ts
// webui/vite.config.ts
import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { outDir: "../web/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8000" } },
});
```
```ts
// webui/src/types.ts
export interface ScoreRow { position: number; normalized_entropy: number; ss_score: number;
  rsa: number; inv_anchor2: number; sum_score: number; min: number; min_feature: string; aa: string; }
export interface Msa { records: { id: string; seq: string }[]; query: string; }
export interface Info { gene: string; organism: string; length: number; reviewed: boolean;
  hasAlphaFold: boolean; af_version?: string; resolution_note?: string;
  top_sites: {position:number;min:number;min_feature:string}[]; }
export interface Job { status: string; error?: string; result?: any; }
```
```ts
// webui/src/api.ts
const J = (r: Response) => r.json();
export const fetchSearch = (q: string) => fetch(`/api/search?q=${encodeURIComponent(q)}`).then(J);
export const fetchResolve = (accessions: string[]) => fetch("/api/resolve", { method:"POST",
  headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accessions }) }).then(J);
export const runPrediction = (uniprot_id: string, n_terminal: number | null, file: File | null) => {
  const fd = new FormData(); fd.append("uniprot_id", uniprot_id);
  if (n_terminal != null) fd.append("n_terminal", String(n_terminal));
  if (file) fd.append("custom_structure", file);
  return fetch("/api/run", { method: "POST", body: fd }).then(J);
};
export const fetchJob = (id: string) => fetch(`/api/jobs/${id}`).then(J);
export const fetchScore = (id: string) => fetch(`/api/results/${id}/score`).then(J);
export const fetchMsa = (id: string) => fetch(`/api/results/${id}/msa`).then(J);
export const fetchInfo = (id: string) => fetch(`/api/results/${id}/info`).then(J);
```
```ts
// webui/src/chart.ts
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
  const labels = rows.map(r => Number(r.position));
  const raw = (key: string, color: string, width = 1) => ({
    label: key,
    data: rows.map(r => Number(r[key])),
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    borderWidth: width,
    tension: 0.15,
  });
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [
      raw("normalized_entropy", "#888"), raw("ss_score", "#2a9d8f"),
      raw("rsa", "#e9c46a"), raw("inv_anchor2", "#e76f51"),
      raw("sum_score", "#457b9d"),
      raw("min", "#d62828", 2.5),  // index 5 = MIN_DATASET_INDEX (emphasized)
      { label: "min (smoothed)", data: movingAverage(rows, "min", 7),
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
      chart.tooltip?.setActiveElements(ae);
      chart.update();
    },
  };
}
```
```html
<!-- webui/index.html -->
<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>EpicTope</title><link rel="stylesheet" href="./src/style.css"/></head>
<body><div id="app">
  <header><h1>EpicTope</h1>
    <input id="search" placeholder="Gene, accession, or organism"/>
    <button id="searchBtn">Search</button>
    <div id="results"></div>
    <div id="runBox">
      <input id="nterm" placeholder="N-term residue (optional)"/>
      <input id="cif" type="file" accept=".cif"/>
      <button id="runBtn">Run prediction</button>
    </div>
  </header>
  <main>
    <section id="info"></section>
    <section><canvas id="chart"></canvas></section>
    <section id="sequence"></section>
    <section id="msa"></section>
    <section id="table"></section>
  </main>
</div><script type="module" src="./src/main.ts"></script></body></html>
```
```ts
// webui/src/main.ts (minimal wiring; sequence/msa filled in later tasks)
import { fetchSearch, runPrediction, fetchJob, fetchScore, fetchInfo } from "./api";
import { renderScoreChart, topSites } from "./chart";
const $ = (id:string)=>document.getElementById(id)!;
let chartHandle: any = null;

$("searchBtn").onclick = async () => {
  const rows:any[] = await fetchSearch(($("search") as HTMLInputElement).value);
  ($("results") as HTMLElement).innerHTML = rows.map((r:any)=>
    `<div class="res"><b>${r.accession}</b> ${r.gene} ${r.organism}
     ${r.reviewed?"<span class=tag>reviewed</span>":""}
     ${r.hasAlphaFold?"<span class=tag>AF</span>":""}
     <button data-acc="${r.accession}">Run</button></div>`).join("");
  ($("results") as HTMLElement).querySelectorAll("button[data-acc]").forEach(b=>{
    b.onclick=()=>startRun((b as HTMLElement).dataset.acc!);
  });
};
async function startRun(acc: string) {
  const nterm = ($("nterm") as HTMLInputElement).value;
  const file = ($("cif") as HTMLInputElement).files?.[0] ?? null;
  const { job_id } = await runPrediction(acc, nterm?Number(nterm):null, file);
  poll(job_id, acc);
}
async function poll(job_id:string, acc:string) {
  const job:any = await fetchJob(job_id);
  if (job.status === "done") return showResults(acc);
  if (job.status === "error") { ($("info") as HTMLElement).textContent = "Error: "+job.error; return; }
  setTimeout(()=>poll(job_id, acc), 1500);
}
async function showResults(acc:string) {
  const rows:any[] = await fetchScore(acc);
  const info:any = await fetchInfo(acc);
  ($("info") as HTMLElement).innerHTML = `<h2>${acc}</h2>
     <p>${info.gene} — ${info.organism}</p>
     <p>Top sites: ${info.top_sites.map((s:any)=>s.position).join(", ")}</p>`;
  if (chartHandle) chartHandle.chart.destroy();
  chartHandle = renderScoreChart($("chart") as HTMLCanvasElement, rows, topSites(rows));
}
```
```css
/* webui/src/style.css */
body{font-family:system-ui,Arial,sans-serif;margin:0;color:#1d2433;background:#f7f8fa}
header{padding:1rem;background:#1d2433;color:#fff}
input{padding:.4rem;margin:.2rem}
button{padding:.4rem .8rem;cursor:pointer}
.tag{background:#2a9d8f;color:#fff;border-radius:4px;padding:0 .4rem;font-size:.7rem;margin-left:.3rem}
section{padding:1rem;max-width:1100px;margin:auto}
canvas{max-width:100%}
```
```python
# web/app.py — add at end
from fastapi.staticfiles import StaticFiles
# check_dir=False: web/static doesn't exist until the first frontend build, and
# the backend test suite imports this app before then.
app.mount("/", StaticFiles(directory=str(config.APP_DIR / "web" / "static"),
                           html=True, check_dir=False), name="static")
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app/webui && npx vitest run`
Expected: PASS. (Also `cd /app && PYTHONPATH=/app python -m pytest tests/web -q` stays green.)

- [ ] **Step 5: Commit**
```bash
git add webui web/app.py   # includes webui/package-lock.json (Task 10 runs npm ci)
git commit -m "feat(webui): Vite+TS scaffold and Chart.js score chart"
```

---

## Task 7: Linked hover — sync bus + sequence strip + chart highlight

**Files:**
- Create: `webui/src/sync.ts`, `webui/src/sequence.ts`, `webui/test/sync.test.ts`
- Modify: `webui/src/main.ts` (use sync bus), `webui/src/style.css`

**Interfaces:**
- `sync.ts`: `const bus = { active: number|null, listeners:Set<(p:number|null)=>void>, setActive(p), onActive(cb) }`.
- `sequence.ts`: `renderSequence(el, rows)` builds a `<span data-pos>` per residue; on `mouseenter` calls `bus.setActive(pos)`; subscribes to `bus.onActive` to toggle `.active`.

- [ ] **Step 1: Write the failing test**
```ts
// webui/test/sync.test.ts
import { describe, it, expect } from "vitest";
import { bus } from "../src/sync";
describe("sync bus", () => {
  it("notifies listeners on setActive", () => {
    let got: number | null = -1;
    bus.onActive(p => { got = p; });
    bus.setActive(42);
    expect(got).toBe(42);
    bus.setActive(null);
    expect(got).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app/webui && npx vitest run`
Expected: FAIL — `sync.ts` missing.

- [ ] **Step 3: Write minimal implementation**
```ts
// webui/src/sync.ts
type Listener = (pos: number | null) => void;
class Bus { active: number | null = null; listeners = new Set<Listener>();
  setActive(p: number|null){ this.active = p; this.listeners.forEach(l=>l(p)); }
  onActive(cb: Listener){ this.listeners.add(cb); return ()=>this.listeners.delete(cb); } }
export const bus = new Bus();
```
```ts
// webui/src/sequence.ts
import { bus } from "./sync";
export function renderSequence(el: HTMLElement, rows: any[]) {
  el.innerHTML = "";
  const wrap = document.createElement("div"); wrap.className = "seqstrip";
  rows.forEach(r => {
    const s = document.createElement("span");
    s.className = "res"; s.dataset.pos = String(r.position); s.textContent = r.aa;
    s.onmouseenter = () => bus.setActive(Number(r.position));
    s.onmouseleave = () => bus.setActive(null);
    wrap.appendChild(s);
  });
  el.appendChild(wrap);
  bus.onActive(pos => {
    wrap.querySelectorAll(".res").forEach(n=>{
      (n as HTMLElement).classList.toggle("active", pos!=null && Number((n as HTMLElement).dataset.pos)===pos);
    });
  });
}
```
```ts
// webui/src/main.ts — in showResults, after rendering chart:
import { renderSequence } from "./sequence";
import { bus } from "./sync";
renderSequence($("sequence") as HTMLElement, rows);
chartHandle.setHoverCallback((pos:number|null)=>bus.setActive(pos));
bus.onActive((pos)=>chartHandle.highlight(pos));
```
```css
/* append to style.css */
.seqstrip{display:flex;flex-wrap:wrap;font-family:monospace;font-size:12px;line-height:1.4}
.seqstrip .res{padding:0 1px;cursor:pointer}
.seqstrip .res.active{background:#ffd166;outline:1px solid #d62828}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app/webui && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add webui/src/sync.ts webui/src/sequence.ts webui/src/main.ts webui/src/style.css webui/test/sync.test.ts
git commit -m "feat(webui): linked hover between chart and sequence strip"
```

---

## Task 8: FASTA/MSA viewer with identity coloring + linked highlight

**Files:**
- Create: `webui/src/msa.ts`, `webui/test/msa.test.ts`
- Modify: `webui/src/main.ts` (render MSA on results, subscribe to bus), `webui/src/style.css`

**Interfaces:**
- `colorForColumn(seqs: string[], col: number): "red"|"blue"|"yellow"` — yellow if any char is `-`; else red if all equal; else blue.
- `renderMsa(el, msa)` builds a grid; hovering a column calls `bus.setActive(position)` where `position` is the **true query residue number** for that column (gap-aware via `queryPositions`), so the chart link stays correct even when the MSA contains gaps; subscribes to `bus` to highlight the active column.

- [ ] **Step 1: Write the failing test**
```ts
// webui/test/msa.test.ts
import { describe, it, expect } from "vitest";
import { colorForColumn, queryPositions } from "../src/msa";
describe("colorForColumn", () => {
  it("red when all identical", () => expect(colorForColumn(["A","A","A"],0)).toBe("red"));
  it("blue when differing", () => expect(colorForColumn(["A","C","A"],0)).toBe("blue"));
  it("yellow when gap present", () => expect(colorForColumn(["A","-","A"],0)).toBe("yellow"));
});
describe("queryPositions", () => {
  it("maps gap-containing query columns to residue numbers", () => {
    const msa = { query: "A", records: [{ id: "A", seq: "A-C" }] };
    expect(queryPositions(msa as any)).toEqual([1, null, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app/webui && npx vitest run`
Expected: FAIL — `msa.ts` missing.

- [ ] **Step 3: Write minimal implementation**
```ts
// webui/src/msa.ts
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
export function renderMsa(el: HTMLElement, msa: { query: string; records: { id: string; seq: string }[] }) {
  const seqs = msa.records.map(r => r.seq);
  const qpos = queryPositions(msa);
  el.innerHTML = "";
  const head = document.createElement("div"); head.className = "msahead";
  head.textContent = "MSA (red=conserved, blue=differs, yellow=gap) — hover links to chart by residue";
  el.appendChild(head);
  msa.records.forEach(rec => {
    const row = document.createElement("div"); row.className = "msarow";
    const name = document.createElement("span"); name.className="msaname"; name.textContent = rec.id;
    row.appendChild(name);
    const strip = document.createElement("span"); strip.className="msastrip";
    for (let c=0;c<rec.seq.length;c++){
      const s=document.createElement("span"); s.className=`cell ${colorForColumn(seqs,c)}`;
      s.dataset.pos=String(qpos[c] ?? ""); s.textContent=rec.seq[c];
      s.onmouseenter=()=>bus.setActive(qpos[c]); s.onmouseleave=()=>bus.setActive(null);
      strip.appendChild(s);
    }
    row.appendChild(strip); el.appendChild(row);
  });
  bus.onActive(pos => {
    el.querySelectorAll(".cell").forEach(n=>{
      const p=(n as HTMLElement).dataset.pos;
      (n as HTMLElement).classList.toggle("active", pos!=null && p!=="" && Number(p)===pos);
    });
  });
}
```
```ts
// webui/src/main.ts — in showResults add:
import { renderMsa } from "./msa";
const msa = await fetchMsa(acc);
renderMsa($("msa") as HTMLElement, msa);
```
```css
/* append */
.msaname{display:inline-block;width:140px;font-family:monospace;font-size:11px;overflow:hidden}
.msastrip{font-family:monospace;font-size:11px;white-space:nowrap}
.cell.red{background:#e63946;color:#fff}.cell.blue{background:#a8dadc}.cell.yellow{background:#ffd166}
.cell.active{outline:1px solid #1d2433}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app/webui && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add webui/src/msa.ts webui/src/main.ts webui/src/style.css webui/test/msa.test.ts
git commit -m "feat(webui): MSA viewer with identity coloring and linked hover"
```

---

## Task 9: Feature table + ranked insertion sites + meta writing on run

**Files:**
- Create: `webui/src/table.ts`, `webui/src/info.ts`
- Modify: `web/pipeline.py` (`finalize_meta`), `web/app.py` (info returns computed fields via meta), `webui/src/main.ts`

**Interfaces:**
- `pipeline.finalize_meta(uniprot_id, custom_structure, n_terminal, resolution_note?)` reads score CSV, computes `top_sites`, queries `uniprot.search` for gene/organism/reviewed/hasAlphaFold, writes meta JSON. Called at end of `run_job`.
- `info.ts`: `renderInfo(el, info)` shows metadata + ranked top sites (li hover sets `bus.setActive`).
- `table.ts`: `renderTable(el, rows)` sortable/filterable per-residue feature table sharing `bus`.

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_pipeline_meta.py
from web import pipeline, parsing
import web.config as cfg

def test_finalize_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(cfg, "OUTPUTS_DIR", tmp_path)
    d = tmp_path / "Q9W7E7"; d.mkdir()
    (d / "Q9W7E7_score.csv").write_text(
        "position,normalized_entropy,ss_score,rsa,inv_anchor2,sum_score,min,min_feature,aa\n"
        "1,0,1,1,0.6,2.6,0,n_e,M\n2,0.1,1,0.8,0.65,2.55,0.1,n_e,T\n")
    monkeypatch.setattr(pipeline.uniprot, "search",
                        lambda q: [{"accession":"Q9W7E7","gene":"smad5","organism":"Danio rerio","reviewed":True,"hasAlphaFold":True}])
    pipeline.finalize_meta("Q9W7E7", None, None)
    meta = parsing.read_meta("Q9W7E7")
    assert meta["gene"] == "smad5"
    assert meta["top_sites"][0]["position"] == 2
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_pipeline_meta.py -v`
Expected: FAIL — `AttributeError: module 'web.pipeline' has no attribute 'finalize_meta'`.

- [ ] **Step 3: Write minimal implementation**
```python
# web/pipeline.py — finalize_meta wraps ensure_meta (added in Task 5.5).
# ensure_meta already reads the score CSV, computes top sites (local maxima via
# parsing.compute_top_sites), queries uniprot.search, and writes <ID>_meta.json.
# Here we just expose the public name run_job calls and guarantee resolution_note
# is applied. (Do NOT re-implement the logic — it lives in ensure_meta.)
from web import parsing, uniprot

def finalize_meta(uniprot_id: str, custom_structure=None, n_terminal=None, resolution_note: str = ""):
    return ensure_meta(uniprot_id, custom_structure, n_terminal, resolution_note)
```
```python
# web/pipeline.py — in run_job, change the Task 5.5 `ensure_meta(...)` call to the
# public name (same effect; finalize_meta delegates to ensure_meta):
    finalize_meta(uniprot_id, custom_structure, n_terminal)
```
```ts
// webui/src/info.ts
import { bus } from "./sync";
export function renderInfo(el: HTMLElement, info: any) {
  el.innerHTML = `<h2>${info.uniprot_id} — ${info.gene||""}</h2>
    <p>${info.organism||""} · ${info.length} aa
       ${info.reviewed?"<span class=tag>reviewed</span>":""}
       ${info.hasAlphaFold?"<span class=tag>AlphaFold</span>":""}</p>
    ${info.resolution_note?`<p class=note>${info.resolution_note}</p>`:""}
    <h3>Top insertion sites</h3>
    <ul>${info.top_sites.map((s:any)=>`<li data-pos="${s.position}">${s.position}
       (min ${s.min}, limiting: ${s.min_feature})</li>`).join("")}</ul>`;
  el.querySelectorAll("li[data-pos]").forEach(li=>{
    li.onmouseenter=()=>bus.setActive(Number((li as HTMLElement).dataset.pos));
    li.onmouseleave=()=>bus.setActive(null);
  });
}
```
```ts
// webui/src/table.ts
import { bus } from "./sync";
export function renderTable(el: HTMLElement, rows: any[]) {
  const cols = Object.keys(rows[0]||{});
  el.innerHTML = `<input id="ftFilter" placeholder="filter..."/>
    <table class="ft"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
    <tbody></tbody></table>`;
  const tbody = el.querySelector("tbody")!;
  // Rows carry data-pos so the linked highlight survives filtering (index-based
  // mapping would point at the wrong residues after the tbody is re-drawn).
  const draw = (data:any[]) => { tbody.innerHTML = data.map(r=>
    `<tr data-pos="${r.position}">${cols.map(c=>`<td>${r[c]}</td>`).join("")}</tr>`).join(""); };
  draw(rows);
  (el.querySelector("#ftFilter") as HTMLInputElement).oninput = (e)=>{
    const v=(e.target as HTMLInputElement).value.toLowerCase();
    draw(rows.filter(r=>cols.some(c=>String(r[c]).toLowerCase().includes(v))));
  };
  bus.onActive(pos=>{
    tbody.querySelectorAll("tr[data-pos]").forEach(tr=>{
      (tr as HTMLElement).style.background =
        (pos!=null && Number((tr as HTMLElement).dataset.pos)===pos)?"#ffd166":"";
    });
  });
}
```
```ts
// webui/src/main.ts — replace info render + add table
import { renderInfo } from "./info";
import { renderTable } from "./table";
renderInfo($("info") as HTMLElement, info);
renderTable($("table") as HTMLElement, rows);
```
```css
/* append */
table.ft{border-collapse:collapse;font-size:11px} table.ft th,table.ft td{border:1px solid #ccc;padding:1px 4px}
#ftFilter{margin-bottom:.4rem}
.note{color:#9a6a00}
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_pipeline_meta.py -v && cd /app/webui && npx vitest run`
Expected: PASS both.

- [ ] **Step 5: Commit**
```bash
git add web/pipeline.py web/app.py webui/src/info.ts webui/src/table.ts webui/src/main.ts webui/src/style.css tests/web/test_pipeline_meta.py
git commit -m "feat: meta finalization, ranked sites, and per-residue feature table"
```

---

## Task 10: Multi-stage Docker build + compose + .dockerignore + smoke test

**Files:**
- Modify: `Dockerfile`, `.dockerignore`
- Create: `tests/smoke/smoke.sh`

**Interfaces:** Built image serves UI on `:8000`; `GET /api/status` works; a small known ID run end-to-end produces `outputs/<ID>/<ID>_score.csv` + `<ID>_msa.fasta`.

- [ ] **Step 1: Write the failing smoke test**
```bash
# tests/smoke/smoke.sh
#!/usr/bin/env bash
set -e
ID=Q9W7E7
docker build -t epictope:smoke .
docker run --rm -d --name epictope_smoke -p 8000:8000 -v "$PWD/data:/app/data" -v "$PWD/outputs:/app/outputs" epictope:smoke
for i in $(seq 1 120); do
  INSTALLED=$(curl -s localhost:8000/api/status | grep -o '"installed":[a-z]*' | cut -d: -f2)
  [ "$INSTALLED" = "true" ] && break
  sleep 10
done
echo "Triggering run for $ID"
JOB=$(curl -s -X POST localhost:8000/api/run -F "uniprot_id=$ID")
JID=$(echo "$JOB" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
for i in $(seq 1 60); do
  ST=$(curl -s localhost:8000/api/jobs/$JID | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  [ "$ST" = "done" ] && break
  [ "$ST" = "error" ] && { echo "JOB ERROR"; docker logs epictope_smoke; exit 1; }
  sleep 10
done
curl -s localhost:8000/api/results/$ID/score | head -c 80; echo
test -f outputs/$ID/$ID"_score.csv" && echo "SCORE OK"
test -f outputs/$ID/$ID"_msa.fasta" && echo "MSA OK"
docker stop epictope_smoke
```

- [ ] **Step 2: Run test to verify it fails**
Run: `bash tests/smoke/smoke.sh`
Expected: FAIL — image build fails (Dockerfile not yet multi-stage / no python deps).

- [ ] **Step 3: Write minimal implementation**
```dockerfile
# Dockerfile (full replacement, multi-stage)
# --- Frontend build ---
FROM node:20 AS frontend
WORKDIR /src
COPY webui/package.json webui/package-lock.json* ./
RUN npm ci   # reproducible; package-lock.json was committed in Task 6
COPY webui/ ./
RUN npm run build

# --- R base (existing toolchain) ---
FROM rocker/r-ver:4
ENV DEBIAN_FRONTEND=noninteractive \
    BLAST_VER=2.17.0 MUSCLE_VER=5.3 DSSP_VER=4.4.0 \
    LIBCIFPP_DATA_DIR=/opt/libcifpp PATH="/opt/blast/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends \
    libtiff-dev libcairo2-dev libpng-dev libcurl4-openssl-dev libssl-dev \
    libxml2-dev zlib1g-dev ca-certificates curl wget bzip2 gzip python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN install2.r --error --ncpus=-1 rvest httr jsonlite R.utils BiocManager \
    && R -e "BiocManager::install('Biostrings', ask=FALSE, update=FALSE)" \
    && rm -rf /usr/local/lib/R/site-library/*/help
RUN mkdir -p /opt/blast && curl -L "https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLAST_VER}+-x64-linux.tar.gz" | tar -xz -C /opt/blast --strip-components=1
RUN curl -L "https://github.com/rcedgar/muscle/releases/download/v${MUSCLE_VER}/muscle-linux-x86.v${MUSCLE_VER}" -o /usr/local/bin/muscle && chmod +x /usr/local/bin/muscle
RUN curl -L "https://github.com/PDB-REDO/dssp/releases/download/v${DSSP_VER}/mkdssp-${DSSP_VER}-linux-x64" -o /usr/local/bin/mkdssp && chmod +x /usr/local/bin/mkdssp \
    && mkdir -p /opt/libcifpp && curl -L "https://files.wwpdb.org/pub/pdb/data/monomers/components.cif" -o /opt/libcifpp/components.cif
# PEP 668: the rocker/r-ver base (Ubuntu >= 24.04) marks the system Python
# externally-managed, so pip needs --break-system-packages. python-multipart is
# required for the /api/run Form/File parameters.
RUN pip3 install --no-cache-dir --break-system-packages fastapi "uvicorn[standard]" httpx python-multipart
WORKDIR /app
COPY . /app
RUN R CMD INSTALL .
# vite.config.ts sets build.outDir = "../web/static"; in this stage webui/ is at /src,
# so the build output lands at /web/static (NOT /src/dist).
COPY --from=frontend /web/static /app/web/static
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 8000
CMD ["/app/docker-entrypoint.sh"]
```
```text
# .dockerignore (full replacement)
.git
.kilo
.venv
.env
data
outputs
tools
ignore
Rplots.pdf
*.log
.python-version
uv.lock
node_modules
webui/node_modules
__pycache__
```
> Note: `data`, `outputs`, `.git` remain excluded (persisted via volumes); `web/` and `webui/` are included so the image builds.

- [ ] **Step 4: Run test to verify it passes**
Run: `bash tests/smoke/smoke.sh`
Expected: PASS — image builds, status reaches `installed:true`, run completes, `SCORE OK` + `MSA OK` printed. (Long-running integration test; run when ready to validate the full container.)

- [ ] **Step 5: Commit**
```bash
git add Dockerfile .dockerignore tests/smoke/smoke.sh docker-compose.yml docker-entrypoint.sh
git commit -m "feat: multi-stage Docker build, compose ports, and container smoke test"
```

---

## Task 11: Docs + final polish

**Files:**
- Modify: `README.md` (add a "Web app" section)
- Test: `tests/web/test_app.py` (add static-serve check)

- [ ] **Step 1: Write the failing test**
```python
# tests/web/test_app.py (append)
from web import config

def test_index_served():
    import os
    client = TestClient(app_module.app)
    if os.path.exists(str(config.APP_DIR / "web" / "static" / "index.html")):
        assert client.get("/").status_code == 200
```

- [ ] **Step 2: Run test to verify it passes (no-op if dist absent)**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web/test_app.py -q`
Expected: PASS.

- [ ] **Step 3: Update README**
Add a "## Web application" section documenting: `docker compose up --build`, open `http://localhost:8000`, search/resolve, run prediction, results cached under `outputs/<ID>/`, and that first boot downloads reference data.

- [ ] **Step 4: Run full test suites**
Run: `cd /app && PYTHONPATH=/app python -m pytest tests/web -q && cd /app/webui && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add README.md tests/web/test_app.py
git commit -m "docs: document web app usage and finalize"
```

---

## Self-Review

1. **Spec coverage:** §2 goals 1–8 all mapped — startup download (Tasks 2,10), UniProt/custom/N-term (Task 4 + `single_score.R` env pass-through), search/resolve (Task 3), FASTA/MSA + info (Tasks 8,9), JS chart with precise hover (Tasks 6,7), two-way linked hover (Tasks 7,8), no auth + disk caching (Tasks 4,5,5.5), clean UI + useful info (Tasks 6,8,9). Incremental/committed/TDD (Global Constraints + every task ends in commit; tests per task). ✅
2. **Placeholder scan:** No TBD/TODO. Every code step has concrete code. ✅
3. **Type consistency:** `bus.setActive(pos:number|null)` used consistently in `sync.ts`, `sequence.ts`, `msa.ts`, `chart.ts` (`highlight(pos)`), `info.ts`, `table.ts`. `renderScoreChart` returns `{chart, setHoverCallback, highlight}` referenced in Task 7 main.ts; `MIN_DATASET_INDEX` exported and used by `highlight`. `parse_score_csv`/`parse_msa`/`compute_top_sites`/`write_meta`/`read_meta` names stable across Tasks 5, 5.5, 9; local-maxima rule identical in `parsing.compute_top_sites` and `chart.ts topSites`. `ensure_meta` introduced in 5.5; `finalize_meta` (Task 9) delegates to it. `/api/run` Form fields match `api.ts` FormData keys and `smoke.sh -F` usage. ✅
4. **Post-implementation review (Tasks 1–5):** done after a weaker model built them — defects found by reading the code + live TestClient probes (422 `/api/run`, 200-status 404s, thread-per-job, missing meta/progress, top-N sort, string scores, brittle search, unverified outputs, missing `python-multipart`) are corrected in Task 5.5 with full replacement code and tests. ✅
