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
- `web/pipeline.py` — `JobStore` (in-memory + file markers), `enqueue_job`, `run_job` (subprocess wrapper), `build_command`, `result_exists`, `parse_score_csv`, `parse_msa`, `compute_top_sites`, `write_meta`, `read_meta`, `finalize_meta`.
- `web/uniprot.py` — `search(term) -> list[dict]`, `resolve(accessions) -> list[dict]` (imports `resolve_one` from `scripts/resolve_accessions.py`).
- `web/app.py` — FastAPI app, all `/api/*` routes, static mount, background startup of `install.R`.
- `web/requirements.txt` — `fastapi`, `uvicorn[standard]`, `pytest`, `httpx`.
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
- `app.py` runs `install.R` (if marker absent) as a detached subprocess at startup, logging to `INSTALL_LOG`; writes `INSTALL_MARKER` on completion (entrypoint handles marker).

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

## Task 6: Frontend scaffold (Vite + TS) and score chart

**Files:**
- Create: `webui/package.json`, `webui/tsconfig.json`, `webui/vite.config.ts`, `webui/index.html`, `webui/src/main.ts`, `webui/src/api.ts`, `webui/src/types.ts`, `webui/src/style.css`, `webui/src/chart.ts`
- Test: `webui/test/score.test.ts`
- Modify: `web/app.py` (mount static at root)

**Interfaces:**
- `api.ts`: `fetchSearch(q)`, `fetchResolve(accs)`, `runPrediction({uniprot_id, n_terminal, file})`, `fetchJob(id)`, `fetchScore(id)`, `fetchMsa(id)`, `fetchInfo(id)`.
- `types.ts`: `ScoreRow`, `Msa`, `Info`, `Job`.
- `chart.ts`: `renderScoreChart(canvas, rows, topSites)` using Chart.js; returns `{chart, setHoverCallback, highlight}`; `topSites(rows, n)` exported.
- Static mount: `app.mount("/", StaticFiles(directory=config.APP_DIR/"web"/"static", html=True), name="static")`.

- [ ] **Step 1: Write the failing test**
```ts
// webui/test/score.test.ts
import { describe, it, expect } from "vitest";
import { topSites } from "../src/chart";

describe("topSites", () => {
  it("returns highest min positions", () => {
    const rows = [{ position: 1, min: 0.1 }, { position: 2, min: 0.9 }, { position: 3, min: 0.5 }];
    expect(topSites(rows as any, 1).map(s => s.position)).toEqual([2]);
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
  "dependencies": { "chart.js": "^4.4.0" },
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
Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, CategoryScale);

export interface TopSite { position: number; min: number; min_feature: string; }
export function topSites(rows: any[], n = 5): TopSite[] {
  return [...rows].sort((a,b)=>Number(b.min)-Number(a.min)).slice(0,n)
    .map(r=>({ position: Number(r.position), min: Number(r.min), min_feature: r.min_feature }));
}
let hoverCb: ((pos: number|null)=>void) | null = null;
export function renderScoreChart(canvas: HTMLCanvasElement, rows: any[]) {
  const labels = rows.map(r=>r.position);
  const mk = (key:string, color:string, hidden=false) => ({
    label: key, data: rows.map(r=>Number(r[key])), borderColor: color,
    backgroundColor: color, hidden, pointRadius: 0, borderWidth: 1.5, tension: 0.2 });
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [
      mk("normalized_entropy","#888"), mk("ss_score","#2a9d8f"),
      mk("rsa","#e9c46a"), mk("inv_anchor2","#e76f51"),
      mk("sum_score","#457b9d"), mk("min","#d62828") ] },
    options: { parsing:false,
      scales: { x: { type:"linear", title:{display:true,text:"Amino acid position"} },
                y: { title:{display:true,text:"Score (0-1)"} } },
      plugins: { tooltip: { callbacks: {
        title: (items)=>`Position ${rows[items[0].dataIndex].position} (${rows[items[0].dataIndex].aa})`,
        label: (it)=>`${it.dataset.label}: ${it.formattedValue}` } } },
      onHover: (_, els) => { if (hoverCb) hoverCb(els.length ? rows[els[0].index].position : null); } }
  });
  return { chart, setHoverCallback:(cb:any)=>{ hoverCb = cb; }, highlight:(pos:number|null)=>{
    const idx = pos==null ? -1 : rows.map(r=>Number(r.position)).indexOf(pos);
    const ae = idx<0 ? [] : [{datasetIndex:5,index:idx}];
    chart.setActiveElements(ae);
    chart.tooltip?.setActiveElements(ae);
    chart.update();
  } };
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
import { renderScoreChart } from "./chart";
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
  chartHandle = renderScoreChart($("chart") as HTMLCanvasElement, rows);
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
app.mount("/", StaticFiles(directory=str(config.APP_DIR / "web" / "static"), html=True), name="static")
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `cd /app/webui && npx vitest run`
Expected: PASS. (Also `cd /app && PYTHONPATH=/app python -m pytest tests/web -q` stays green.)

- [ ] **Step 5: Commit**
```bash
git add webui web/app.py
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
- `renderMsa(el, msa)` builds a grid; hovering a column calls `bus.setActive(position)` (column+1); subscribes to `bus` to highlight active column.

- [ ] **Step 1: Write the failing test**
```ts
// webui/test/msa.test.ts
import { describe, it, expect } from "vitest";
import { colorForColumn } from "../src/msa";
describe("colorForColumn", () => {
  it("red when all identical", () => expect(colorForColumn(["A","A","A"],0)).toBe("red"));
  it("blue when differing", () => expect(colorForColumn(["A","C","A"],0)).toBe("blue"));
  it("yellow when gap present", () => expect(colorForColumn(["A","-","A"],0)).toBe("yellow"));
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
export function renderMsa(el: HTMLElement, msa: { records: {id:string;seq:string}[] }) {
  const seqs = msa.records.map(r => r.seq);
  el.innerHTML = "";
  const head = document.createElement("div"); head.className = "msahead";
  head.textContent = "MSA (red=conserved, blue=differs, yellow=gap) — hover links to chart";
  el.appendChild(head);
  msa.records.forEach(rec => {
    const row = document.createElement("div"); row.className = "msarow";
    const name = document.createElement("span"); name.className="msaname"; name.textContent = rec.id;
    row.appendChild(name);
    const strip = document.createElement("span"); strip.className="msastrip";
    for (let c=0;c<rec.seq.length;c++){
      const s=document.createElement("span"); s.className=`cell ${colorForColumn(seqs,c)}`;
      s.dataset.col=String(c); s.textContent=rec.seq[c];
      s.onmouseenter=()=>bus.setActive(c+1); s.onmouseleave=()=>bus.setActive(null);
      strip.appendChild(s);
    }
    row.appendChild(strip); el.appendChild(row);
  });
  bus.onActive(pos => {
    el.querySelectorAll(".cell").forEach(n=>{
      (n as HTMLElement).classList.toggle("active",
        pos!=null && Number((n as HTMLElement).dataset.col)+1===pos);
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
# web/pipeline.py — add imports + function (keep existing content)
from web import parsing, uniprot

def finalize_meta(uniprot_id: str, custom_structure=None, n_terminal=None, resolution_note: str = ""):
    rows = parsing.parse_score_csv(config.OUTPUTS_DIR / uniprot_id / f"{uniprot_id}_score.csv")
    top = parsing.compute_top_sites(rows, n=5)
    seq = "".join(r.get("aa","") for r in rows)
    meta = {"uniprot_id": uniprot_id, "length": len(rows), "sequence": seq,
            "top_sites": top, "resolution_note": resolution_note,
            "gene": "", "organism": "", "reviewed": False, "hasAlphaFold": False}
    try:
        found = uniprot.search(uniprot_id)
        if found:
            f = found[0]; meta.update(gene=f["gene"], organism=f["organism"],
                                      reviewed=f["reviewed"], hasAlphaFold=f["hasAlphaFold"])
    except Exception:
        pass
    parsing.write_meta(uniprot_id, **meta)
    return meta
```
```python
# web/pipeline.py — in run_job, just BEFORE JobStore.set_status(job_id, "done", ...):
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
  const draw = (data:any[]) => { tbody.innerHTML = data.map(r=>`<tr>${cols.map(c=>`<td>${r[c]}</td>`).join("")}</tr>`).join(""); };
  draw(rows);
  (el.querySelector("#ftFilter") as HTMLInputElement).oninput = (e)=>{
    const v=(e.target as HTMLInputElement).value.toLowerCase();
    draw(rows.filter(r=>cols.some(c=>String(r[c]).toLowerCase().includes(v))));
  };
  bus.onActive(pos=>{
    tbody.querySelectorAll("tr").forEach((tr,i)=>{
      (tr as HTMLElement).style.background = (pos!=null && rows[i] && Number(rows[i].position)===pos)?"#ffd166":"";
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
RUN npm install
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
RUN pip3 install --no-cache-dir fastapi "uvicorn[standard]" httpx
WORKDIR /app
COPY . /app
RUN R CMD INSTALL .
COPY --from=frontend /src/dist /app/web/static
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

1. **Spec coverage:** §2 goals 1–8 all mapped — startup download (Tasks 2,10), UniProt/custom/N-term (Task 4 + `single_score.R` arg pass-through), search/resolve (Task 3), FASTA/MSA + info (Tasks 8,9), JS chart with precise hover (Tasks 6,7), two-way linked hover (Tasks 7,8), no auth + disk caching (Tasks 4,5), clean UI + useful info (Tasks 6,8,9). Incremental/committed/TDD (Global Constraints + every task ends in commit; tests per task). ✅
2. **Placeholder scan:** No TBD/TODO. Every code step has concrete code. ✅
3. **Type consistency:** `bus.setActive(pos:number|null)` used consistently in `sync.ts`, `sequence.ts`, `msa.ts`, `chart.ts` (`highlight(pos)`), `info.ts`, `table.ts`. `renderScoreChart` returns `{chart, setHoverCallback, highlight}` referenced in Task 7 main.ts. `parse_score_csv`/`parse_msa`/`compute_top_sites`/`write_meta`/`read_meta` names stable across Tasks 5 and 9. `finalize_meta` added in Task 9 and named in test. ✅
