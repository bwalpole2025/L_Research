#!/usr/bin/env bash
# Restore the self-hosted stack from a backup directory produced by backup.sh.
# DESTRUCTIVE: replaces the database contents and the compile workspace.
# See docs/deploy-single-host.md → "Restore".
#
#   ./scripts/restore.sh backups/20260613-030000
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:?usage: scripts/restore.sh <backups/TIMESTAMP>}"
PROD_FILE="${PROD_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a

WORKSPACE="${COMPILE_WORKSPACE:?COMPILE_WORKSPACE not set (check $ENV_FILE)}"
DC=(docker compose -f docker-compose.yml -f "$PROD_FILE" --env-file "$ENV_FILE")

[ -f "$SRC/db.sql.gz" ] || { echo "no db.sql.gz in $SRC" >&2; exit 1; }
[ -f "$SRC/workspace.tar.gz" ] || { echo "no workspace.tar.gz in $SRC" >&2; exit 1; }

if [ -f "$SRC/SHA256SUMS" ]; then
  echo "[restore] verifying checksums"; ( cd "$SRC" && sha256sum -c SHA256SUMS )
fi

echo "[restore] restoring database (the dump drops & recreates objects)…"
gunzip -c "$SRC/db.sql.gz" | "${DC[@]}" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-latex}" -d "${POSTGRES_DB:-latex_studio}"

echo "[restore] restoring workspace → $WORKSPACE"
mkdir -p "$(dirname "$WORKSPACE")"
rm -rf "${WORKSPACE:?}/"* 2>/dev/null || true
tar -xzf "$SRC/workspace.tar.gz" -C "$(dirname "$WORKSPACE")"
# Re-assert the non-root sandbox ownership (matches workspace-init).
"${DC[@]}" run --rm -T workspace-init >/dev/null 2>&1 || true

echo "[restore] done. Recommended: ${DC[*]} restart api web"
