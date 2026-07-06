#!/usr/bin/env bash
# Import a database dump into DATABASE_URL. Replaces existing objects.
# Usage: pnpm db:import [path/to.dump]   (default: backups/latest.dump)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a; . ./.env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL not set (copy .env.example to .env)}"

command -v pg_restore >/dev/null || { echo "pg_restore not found (install postgresql client)" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql not found (install postgresql client)" >&2; exit 1; }

dump="${1:-backups/latest.dump}"
[ -f "$dump" ] || { echo "Dump not found: ${dump}" >&2; echo "Run 'pnpm db:export' on the source machine and copy the file here." >&2; exit 1; }

# Safety: this drops and recreates objects in the target database.
echo "About to RESTORE '${dump}' into:"
echo "  ${DATABASE_URL%%\?*}"
echo "This replaces existing data in that database."
if [ -t 0 ] && [ "${DB_IMPORT_YES:-}" != "1" ]; then
  read -r -p "Continue? [y/N] " reply
  case "$reply" in y|Y|yes) ;; *) echo "Aborted."; exit 1 ;; esac
fi

echo "Ensuring required extensions exist..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS vector;"

echo "Restoring (this can take a minute)..."
# --clean --if-exists drops existing objects first; --no-owner/--no-privileges
# ignore the source roles. Benign 'does not exist' notices are expected.
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$dump" || true

echo "Done. Verify:"
echo "  psql \"\$DATABASE_URL\" -c 'SELECT count(*) FROM package;'"
