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
