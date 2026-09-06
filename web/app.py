from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from web import config
from web import uniprot

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
