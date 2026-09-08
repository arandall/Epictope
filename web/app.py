from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from web import config, parsing, pipeline, uniprot

@asynccontextmanager
async def lifespan(app: FastAPI):
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

@app.post("/api/run")
def run(uniprot_id: str = Form(...),
        n_terminal: int | None = Form(None),
        custom_structure: UploadFile | None = File(None)):
    if not config.INSTALL_MARKER.exists():
        raise HTTPException(status_code=503,
                            detail="reference data is still downloading; try again soon")
    path = None
    if custom_structure:
        import pathlib, tempfile, uuid
        safe_name = pathlib.Path(custom_structure.filename or "").name or "structure.cif"
        p = pathlib.Path(tempfile.gettempdir()) / f"{uuid.uuid4().hex}_{safe_name}"
        p.write_bytes(custom_structure.file.read())
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
    return parsing.parse_msa(p, uniprot_id)

@app.get("/api/results/{uniprot_id}/info")
def result_info(uniprot_id: str):
    meta = parsing.read_meta(uniprot_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="no metadata for this ID")
    return meta

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

from fastapi.staticfiles import StaticFiles
# check_dir=False: web/static doesn't exist until the first frontend build, and
# the backend test suite imports this app before then.
app.mount("/", StaticFiles(directory=str(config.APP_DIR / "web" / "static"),
                           html=True, check_dir=False), name="static")