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
    sidecar = _out_dir(uniprot_id) / "custom_structure.txt"
    if custom_structure:
        if not sidecar.exists() or sidecar.read_text().strip() != custom_structure:
            return False
    elif sidecar.exists():
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
    key = f"{uniprot_id}|{custom_structure}|{n_terminal}"
    return f"{uniprot_id}-{hashlib.sha256(key.encode()).hexdigest()[:12]}"

class JobStore:
    @staticmethod
    def create(uniprot_id, custom_structure=None, n_terminal=None) -> str:
        job_id = make_job_id(uniprot_id, custom_structure, n_terminal)
        with _LOCK:
            existing = JOBS.get(job_id)
            if existing and existing.get("status") in ("queued", "running"):
                return job_id
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
    out = _out_dir(uniprot_id)
    rows = parsing.parse_score_csv(out / f"{uniprot_id}_score.csv")
    meta = {
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

def finalize_meta(uniprot_id: str, custom_structure=None, n_terminal=None,
                  resolution_note: str = ""):
    """Public meta-finalization entry point; delegates to ensure_meta."""
    return ensure_meta(uniprot_id, custom_structure, n_terminal, resolution_note)

def run_job(job_id: str, uniprot_id: str, custom_structure=None, n_terminal=None):
    out = _out_dir(uniprot_id)
    log_path = out / "run.log"
    try:
        out.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        env["EPICTORE_OUTDIR"] = str(out)
        if custom_structure:
            (out / "custom_structure.txt").write_text(custom_structure)
        else:
            (out / "custom_structure.txt").unlink(missing_ok=True)
        cmd = build_command(uniprot_id, custom_structure, n_terminal)
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
        finalize_meta(uniprot_id, custom_structure, n_terminal)
        JobStore.set_status(job_id, "done", progress="", result=_result_links(uniprot_id))
    except Exception as e:  # noqa: BLE001
        JobStore.set_status(job_id, "error", error=str(e))

def _worker():
    while True:
        job_id = _QUEUE.get()
        try:
            job = JobStore.get(job_id)
            JobStore.set_status(job_id, "running")
            run_job(job_id, job["uniprot_id"], job.get("custom_structure"),
                    job.get("n_terminal"))
        except Exception as e:  # noqa: BLE001
            JobStore.set_status(job_id, "error", error=str(e))
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
            return
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