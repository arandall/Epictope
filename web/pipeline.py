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
