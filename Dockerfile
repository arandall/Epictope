# EpicTope container image
#
# Builds a self-contained environment to run the EpicTope R pipeline:
#   - R (with TIFF, PNG, cairo device support)
#   - The local `epictope` R package (installed from this repo)
#   - CRAN/Bioconductor dependencies (rvest, httr, jsonlite, R.utils, Biostrings)
#   - Binary tools on PATH: BLAST+ (blastp/makeblastdb/blastdbcmd), MUSCLE, mkdssp
#   - libCIF++ components.cif data for mkdssp
#
# Build:
#   docker build -t epictope .
#
# Run the pipeline (interactive R shell):
#   docker run --rm -it -v "$PWD/outputs:/app/outputs" -v "$PWD/data:/app/data" epictope
#
# Run a script directly:
#   docker run --rm -v "$PWD/outputs:/app/outputs" \
#     epictope Rscript scripts/single_score.R Q9W7E7
#
# Persist downloaded CDS/proteome data by mounting ./data; persist results by
# mounting ./outputs. The pipeline writes relative to /app (the repo root).

FROM rocker/r-ver:4

ENV DEBIAN_FRONTEND=noninteractive \
    BLAST_VER=2.17.0 \
    MUSCLE_VER=5.3 \
    DSSP_VER=4.4.0 \
    LIBCIFPP_DATA_DIR=/opt/libcifpp \
    PATH="/opt/blast/bin:${PATH}"

# System libraries: R device support (tiff/png/cairo) and tools for the
# CRAN/Bioconductor packages we install below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libtiff-dev \
        libcairo2-dev \
        libpng-dev \
        libcurl4-openssl-dev \
        libssl-dev \
        libxml2-dev \
        zlib1g-dev \
        ca-certificates \
        curl \
        wget \
        bzip2 \
        gzip \
    && rm -rf /var/lib/apt/lists/*

# R package dependencies.
RUN install2.r --error --ncpus=-1 \
        rvest httr jsonlite R.utils BiocManager \
    && R -e "BiocManager::install('Biostrings', ask = FALSE, update = FALSE)" \
    && rm -rf /usr/local/lib/R/site-library/*/help

# --- Binary tools -----------------------------------------------------------
# BLAST+
RUN mkdir -p /opt/blast \
    && curl -L "https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/ncbi-blast-${BLAST_VER}+-x64-linux.tar.gz" \
       | tar -xz -C /opt/blast --strip-components=1

# MUSCLE v5
RUN curl -L "https://github.com/rcedgar/muscle/releases/download/v${MUSCLE_VER}/muscle-linux-x86.v${MUSCLE_VER}" \
       -o /usr/local/bin/muscle \
    && chmod +x /usr/local/bin/muscle

# mkdssp (DSSP) + libCIF++ components data
RUN curl -L "https://github.com/PDB-REDO/dssp/releases/download/v${DSSP_VER}/mkdssp-${DSSP_VER}-linux-x64" \
       -o /usr/local/bin/mkdssp \
    && chmod +x /usr/local/bin/mkdssp \
    && mkdir -p /opt/libcifpp \
    && curl -L "https://files.wwpdb.org/pub/pdb/data/monomers/components.cif" \
       -o /opt/libcifpp/components.cif

WORKDIR /app

# Copy the repo (source only; data/, outputs/, tools/ are gitignored and
# excluded by .dockerignore) and install the local epictope package.
COPY . /app
RUN R CMD INSTALL .

CMD ["R"]
