#!/usr/bin/env bash
# Nightly backup for the self-hosted stack: a Postgres dump + a compile-workspace
# archive, written to ./backups/<timestamp>/ and mirrored to a SECOND location on
# the host (or an attached drive). See docs/deploy-single-host.md → "Backups".
#
#   ./scripts/backup.sh
#
# Env (optional):
#   PROD_FILE      prod override file      (default: docker-compose.prod.yml)
#   ENV_FILE       env file                (default: .env.production)
#   BACKUP_DIR     primary dest            (default: ./backups)
#   BACKUP_MIRROR  second copy location    (default: ./backups-mirror — set to /mnt/backup etc.)
#   BACKUP_KEEP_DAYS  prune older than N   (default: 14)
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_FILE="${PROD_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a

WORKSPACE="${COMPILE_WORKSPACE:?COMPILE_WORKSPACE not set (check $ENV_FILE)}"
DEST="${BACKUP_DIR:-backups}"
MIRROR="${BACKUP_MIRROR:-backups-mirror}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DC=(docker compose -f docker-compose.yml -f "$PROD_FILE" --env-file "$ENV_FILE")

ts="$(date +%Y%m%d-%H%M%S)"
out="$DEST/$ts"
mkdir -p "$out"

echo "[backup] pg_dump → $out/db.sql.gz"
"${DC[@]}" exec -T postgres pg_dump --clean --if-exists \
  -U "${POSTGRES_USER:-latex}" -d "${POSTGRES_DB:-latex_studio}" | gzip > "$out/db.sql.gz"

echo "[backup] workspace ($WORKSPACE) → $out/workspace.tar.gz"
tar -czf "$out/workspace.tar.gz" -C "$(dirname "$WORKSPACE")" "$(basename "$WORKSPACE")"

( cd "$out" && sha256sum db.sql.gz workspace.tar.gz > SHA256SUMS )

if [ -n "$MIRROR" ]; then
  echo "[backup] mirror → $MIRROR/$ts"
  mkdir -p "$MIRROR/$ts" && cp -a "$out/." "$MIRROR/$ts/"
fi

# Prune backups older than KEEP_DAYS (both locations).
find "$DEST" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
[ -n "$MIRROR" ] && find "$MIRROR" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[backup] done: $out"
