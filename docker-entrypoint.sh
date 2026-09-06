#!/usr/bin/env bash
set -e
if [ ! -f /app/data/.installed ]; then
  echo "Starting reference data download (install.R) in background..." >&2
  ( Rscript /app/scripts/install.R > /app/data/install.log 2>&1; touch /app/data/.installed ) &
fi
exec uvicorn web.app:app --host 0.0.0.0 --port 8000
