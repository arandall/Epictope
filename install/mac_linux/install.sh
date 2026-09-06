#!/bin/bash
# EpicTope installer (macOS / Linux)
#
# Replaces the old conda-based setup. This script:
#   1. Installs uv (if missing) and creates a Python virtual environment with the
#      dependencies listed in pyproject.toml.
#   2. Downloads the binary tools BLAST, MUSCLE and DSSP (mkdssp) into ./tools
#      so they are available without conda or a system package manager.
#   3. Prints the commands needed to install R and the EpicTope R package.
#
# After running this script, source the generated environment before using EpicTope:
#     source tools/activate
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
TOOLS="$REPO_ROOT/tools"

# ---------------------------------------------------------------------------
# 1. uv
# ---------------------------------------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
    echo "uv not found, installing..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
uv sync

# ---------------------------------------------------------------------------
# 2. Binary tools
# ---------------------------------------------------------------------------
mkdir -p "$TOOLS/bin" "$TOOLS/blast" "$TOOLS/libcifpp"

OS="$(uname -s)"
ARCH="$(uname -m)"

# --- BLAST+ ---
BLAST_VER="2.17.0"
echo "Downloading BLAST+ $BLAST_VER..."
if [ "$OS" = "Darwin" ]; then
    BLAST_URL="https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLAST_VER}+-x64-macosx.tar.gz"
else
    BLAST_URL="https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLAST_VER}+-x64-linux.tar.gz"
fi
curl -L "$BLAST_URL" | tar -xz -C "$TOOLS/blast" --strip-components=1

# --- MUSCLE v5 ---
echo "Downloading MUSCLE v5..."
if [ "$OS" = "Darwin" ]; then
    if [ "$ARCH" = "arm64" ]; then
        MUSCLE_URL="https://github.com/rcedgar/muscle/releases/download/v5.3/muscle-osx-arm64.v5.3"
    else
        MUSCLE_URL="https://github.com/rcedgar/muscle/releases/download/v5.3/muscle-osx-x86.v5.3"
    fi
else
    MUSCLE_URL="https://github.com/rcedgar/muscle/releases/download/v5.3/muscle-linux-x86.v5.3"
fi
curl -L "$MUSCLE_URL" -o "$TOOLS/bin/muscle"
chmod +x "$TOOLS/bin/muscle"

# --- DSSP (mkdssp) ---
echo "Downloading DSSP (mkdssp)..."
DSSP_OK=1
if [ "$OS" = "Darwin" ]; then
    # No official macOS binary is published; install via Homebrew instead.
    DSSP_OK=0
    echo "No official macOS binary for mkdssp is available."
    echo "Install it with Homebrew:  brew install brewsci/bio/dssp"
else
    DSSP_URL="https://github.com/PDB-REDO/dssp/releases/download/v4.4.0/mkdssp-4.4.0-linux-x64"
    if [ "$OS" = "MINGW" ] || [ "$OS" = "CYGWIN" ] || [ "${OS%_*}" = "MINGW64" ]; then
        DSSP_URL="https://github.com/PDB-REDO/dssp/releases/download/v4.4.0/mkdssp-4.4.0.exe"
        curl -L "$DSSP_URL" -o "$TOOLS/bin/mkdssp.exe"
        DSSP_OK=1
    else
        curl -L "$DSSP_URL" -o "$TOOLS/bin/mkdssp"
        chmod +x "$TOOLS/bin/mkdssp"
    fi
fi

# --- libCIF++ data required by mkdssp ---
echo "Downloading libCIF++ components.cif (this is a large file, ~500MB)..."
curl -L "https://files.wwpdb.org/pub/pdb/data/monomers/components.cif" -o "$TOOLS/libcifpp/components.cif"

# ---------------------------------------------------------------------------
# 3. Environment file for EpicTope
# ---------------------------------------------------------------------------
cat > "$TOOLS/activate" <<EOF
export PATH="$TOOLS/bin:\$PATH"
export PATH="$TOOLS/blast/bin:\$PATH"
export LIBCIFPP_DATA_DIR="$TOOLS/libcifpp"
EOF
chmod +x "$TOOLS/activate"

# ---------------------------------------------------------------------------
# 4. R (cannot be installed by uv) -- print instructions
# ---------------------------------------------------------------------------
echo
echo "==================================================================="
echo "EpicTope Python environment and binary tools are installed in ./tools"
echo "Source the environment before running the R scripts:"
echo "    source tools/activate"
echo
echo "R must be installed separately (uv cannot install R)."
echo "  - Debian/Ubuntu:  sudo apt install r-base r-base-dev"
echo "  - macOS:          brew install r"
echo "  - Windows:        https://cran.r-project.org/bin/windows/base/"
echo
echo "Then install the EpicTope R package and its dependencies:"
echo "    R -e \"install.packages(c('remotes','BiocManager'), repos='https://cloud.r-project.org')\""
echo "    R -e \"BiocManager::install('Biostrings')\""
echo "    R -e \"remotes::install_github('FriedbergLab/Epictope')\""
if [ "$DSSP_OK" -eq 0 ]; then
echo
echo "NOTE: mkdssp was not downloaded (no official macOS binary)."
echo "      Install it with:  brew install brewsci/bio/dssp"
fi
echo "==================================================================="
