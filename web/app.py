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
