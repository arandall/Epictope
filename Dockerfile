# EpicTope web-app container image (multi-stage).
#
# Stage 1 (frontend): build the Vite/TypeScript UI with node.
#   vite.config.ts sets build.outDir = "../web/static"; with WORKDIR /src the
#   webui/ tree lives at /src, so the build output lands at /web/static
#   (NOT /src/dist) — the final stage copies it from there.
#
# Stage 2 (runtime): rocker/r-ver with the R toolchain, BLAST+/MUSCLE/DSSP
#   binaries, and the FastAPI backend; the local `epictope` R package is
#   installed from the copied repo. At startup docker-entrypoint.sh runs
#   scripts/install.R in the background (populating the mounted data/ volume)
#   and serves the app on :8000.
#
# Build:
#   docker build -t epictope .
# Run:
#   docker run --rm -d -p 8000:8000 -v "$PWD/data:/app/data" \
#     -v "$PWD/outputs:/app/outputs" epictope
#
# Persist downloaded CDS/proteome data by mounting ./data; persist results by
# mounting ./outputs.
#
# The image is linux/amd64 only: BLAST+, MUSCLE, and mkdssp are installed from
# upstream-published x86-64 Linux binaries and no ARM builds are provided.

# --- Frontend build ----------------------------------------------------------
FROM node:24 AS frontend
WORKDIR /src
# package-lock.json was committed in Task 6; npm ci is reproducible.
COPY webui/package.json webui/package-lock.json* ./
RUN npm ci
COPY webui/ ./
RUN npm run build

# --- R base (existing toolchain) --------------------------------------------
FROM rocker/r-ver:4

ENV DEBIAN_FRONTEND=noninteractive \
    BLAST_VER=2.17.0 \
    MUSCLE_VER=5.3 \
    DSSP_VER=4.4.0 \
    LIBCIFPP_DATA_DIR=/opt/libcifpp \
    PATH="/opt/blast/bin:${PATH}"

# System libraries: R device support (tiff/png/cairo), tools for the
# CRAN/Bioconductor packages below, and python3/pip for the FastAPI backend.
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
        python3 \
        python3-pip \
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

# Python backend deps. PEP 668: the rocker/r-ver base (Ubuntu >= 24.04) marks
# the system Python externally-managed, so pip needs --break-system-packages.
# python-multipart is required for the /api/run Form/File parameters.
RUN pip3 install --no-cache-dir --break-system-packages fastapi "uvicorn[standard]" httpx python-multipart

WORKDIR /app

# Copy the repo (source only; data/, outputs/, tools/ are gitignored and
# excluded by .dockerignore) and install the local epictope package.
COPY . /app
RUN R CMD INSTALL .

# Static UI from the frontend stage (see note at the top of this file).
COPY --from=frontend /web/static /app/web/static

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000
CMD ["/app/docker-entrypoint.sh"]
