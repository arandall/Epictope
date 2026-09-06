# EpicTope installer (Windows)
#
# Replaces the old conda-based setup. This script:
#   1. Installs uv (if missing) and creates a Python virtual environment with the
#      dependencies listed in pyproject.toml.
#   2. Downloads the binary tools BLAST, MUSCLE and DSSP (mkdssp) so they are
#      available without conda or a system package manager.
#   3. Prints the commands needed to install R and the EpicTope R package.
#
# After running this script, dot-source the generated environment before using
# EpicTope:
#     .\tools\activate.ps1

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Tools = Join-Path $RepoRoot "tools"
$Bin = Join-Path $Tools "bin"
$Blast = Join-Path $Tools "blast"
$Libcifpp = Join-Path $Tools "libcifpp"
New-Item -ItemType Directory -Force -Path $Bin, $Blast, $Libcifpp | Out-Null

# ---------------------------------------------------------------------------
# 1. uv
# ---------------------------------------------------------------------------
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "uv not found, installing..."
    irm https://astral.sh/uv/install.ps1 | iex
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
uv sync

# ---------------------------------------------------------------------------
# 2. Binary tools
# ---------------------------------------------------------------------------
# --- BLAST+ (Windows ships an installer) ---
$BLAST_VER = "2.17.0"
$BLAST_INSTALLER = Join-Path $env:TEMP "ncbi-blast-$BLAST_VER-win64.exe"
Write-Host "Downloading BLAST+ $BLAST_VER..."
Invoke-WebRequest "https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLAST_VER}+-win64.exe" -OutFile $BLAST_INSTALLER
Write-Host "Running BLAST+ installer (requires administrator)..."
Start-Process -FilePath $BLAST_INSTALLER -ArgumentList "/S" -Wait
$BlastProgramFiles = "C:\Program Files\NCBI\blast-$BLAST_VER+\bin"
if (Test-Path $BlastProgramFiles) {
    $env:Path = "$BlastProgramFiles;$env:Path"
    [Environment]::SetEnvironmentVariable("Path", "$BlastProgramFiles;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")
}

# --- MUSCLE v5 ---
Write-Host "Downloading MUSCLE v5..."
Invoke-WebRequest "https://github.com/rcedgar/muscle/releases/download/v5.3/muscle-win64.v5.3.exe" -OutFile (Join-Path $Bin "muscle.exe")

# --- DSSP (mkdssp) ---
Write-Host "Downloading DSSP (mkdssp)..."
Invoke-WebRequest "https://github.com/PDB-REDO/dssp/releases/download/v4.4.0/mkdssp-4.4.0.exe" -OutFile (Join-Path $Bin "mkdssp.exe")

# --- libCIF++ data required by mkdssp ---
Write-Host "Downloading libCIF++ components.cif (this is a large file, ~500MB)..."
Invoke-WebRequest "https://files.wwpdb.org/pub/pdb/data/monomers/components.cif" -OutFile (Join-Path $Libcifpp "components.cif")

# ---------------------------------------------------------------------------
# 3. Environment file for EpicTope
# ---------------------------------------------------------------------------
@"
`$env:Path = "$Bin;`$env:Path"
`$env:Path = "$BlastProgramFiles;`$env:Path"
`$env:LIBCIFPP_DATA_DIR = "$Libcifpp"
"@ | Set-Content (Join-Path $Tools "activate.ps1")

# ---------------------------------------------------------------------------
# 4. R (cannot be installed by uv) -- print instructions
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================================="
Write-Host "EpicTope Python environment and binary tools are installed."
Write-Host "Dot-source the environment before running the R scripts:"
Write-Host "    .\tools\activate.ps1"
Write-Host ""
Write-Host "R must be installed separately (uv cannot install R)."
Write-Host "  - Download from https://cran.r-project.org/bin/windows/base/"
Write-Host ""
Write-Host "Then install the EpicTope R package and its dependencies in R:"
Write-Host '    install.packages(c("remotes","BiocManager"), repos="https://cloud.r-project.org")'
Write-Host '    BiocManager::install("Biostrings")'
Write-Host '    remotes::install_github("FriedbergLab/Epictope")'
Write-Host "==================================================================="
