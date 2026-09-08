from pathlib import Path

APP_DIR = Path("/app")
DATA_DIR = APP_DIR / "data"
OUTPUTS_DIR = APP_DIR / "outputs"
MODELS_DIR = DATA_DIR / "models"
R_SCRIPT = APP_DIR / "scripts" / "single_score.R"
INSTALL_MARKER = DATA_DIR / ".installed"
INSTALL_LOG = DATA_DIR / "install.log"
