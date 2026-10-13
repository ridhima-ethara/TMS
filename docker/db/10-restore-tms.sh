#!/bin/bash
# Runs once, on first initialisation of an empty data directory.
set -euo pipefail
echo "Restoring TMS database snapshot into ${POSTGRES_DB} (this can take a while)..."
pg_restore --no-owner --no-privileges --exit-on-error -j "$(nproc)" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" /opt/tms/tms.dump
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ANALYZE;"
echo "TMS database restore complete."
