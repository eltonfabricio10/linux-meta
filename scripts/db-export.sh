#!/usr/bin/env bash
# Export the database to a portable compressed dump under backups/.
# Usage: pnpm db:export   (or: scripts/db-export.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

# Load DATABASE_URL from .env if not already in the environment.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a; . ./.env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL not set (copy .env.example to .env)}"

command -v pg_dump >/dev/null || { echo "pg_dump not found (install postgresql client)" >&2; exit 1; }

mkdir -p backups
ts="$(date +%Y%m%d-%H%M%S)"
out="backups/linuxmeta-${ts}.dump"

echo "Exporting database -> ${out}"
# Custom format (-Fc) is compressed and restorable with pg_restore.
# --no-owner/--no-privileges make the dump portable across roles/machines.
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$out"

ln -sf "$(basename "$out")" backups/latest.dump
echo "Done: ${out} ($(du -h "$out" | cut -f1)) · pointer: backups/latest.dump"
echo "Copy the dump to the target machine and run: pnpm db:import"
