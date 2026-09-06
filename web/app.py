from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi import UploadFile, File
from pydantic import BaseModel
from web import config
from web import uniprot
from web import pipeline

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
