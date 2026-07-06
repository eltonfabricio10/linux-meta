#!/usr/bin/env bash
# One-command dev bootstrap for a fresh machine.
#   - installs deps, starts Postgres+pgvector (docker), loads data, prints next steps.
# Usage: pnpm setup   (or: scripts/dev-setup.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "Missing required tool: $1" >&2; exit 1; }; }
need docker
need pnpm
need pg_restore

echo "==> .env"
if [ ! -f .env ]; then cp .env.example .env; echo "created .env from .env.example"; else echo ".env present"; fi

echo "==> installing dependencies"
pnpm install

echo "==> starting Postgres (docker)"
pnpm db:up

echo "==> waiting for Postgres to be ready"
for _ in $(seq 1 60); do
  if docker exec linuxmeta-postgres pg_isready -U linuxmeta -d linuxmeta >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "${ok:-}" = 1 ] || { echo "Postgres did not become ready in time." >&2; exit 1; }

if [ -f backups/latest.dump ]; then
  echo "==> importing data from backups/latest.dump"
  DB_IMPORT_YES=1 scripts/db-import.sh
else
  echo "==> no dump found (backups/latest.dump) — applying empty schema"
  pnpm db:push
  echo "    To load real data: copy a dump to backups/latest.dump and run 'pnpm db:import'."
fi

echo
echo "Setup complete. Next:"
echo "  pnpm dev            # web app at http://localhost:4400"
echo "  pnpm --filter @linux-meta/web run seed:admin   # dev admin user"
echo
echo "Optional — semantic search / embeddings (Ollama):"
echo "  docker compose -f infra/docker/compose.yml --profile embed up -d ollama"
echo "  docker exec linuxmeta-ollama ollama pull nomic-embed-text"
