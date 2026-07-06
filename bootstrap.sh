#!/usr/bin/env bash
# ============================================================================
# linux-meta — ativar TUDO com um comando.
#
#   ./bootstrap.sh
#
# Sobe Postgres+pgvector e Ollama (docker), instala dependências, importa o
# banco (backups/latest.dump), baixa o modelo de embeddings, faz o build e
# deixa o site rodando em http://localhost:4400.
#
# Requisitos na máquina: docker (com plugin compose), node >= 22 e pnpm.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m%s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$1"; }

# 1. Pré-requisitos -----------------------------------------------------------
miss=0
for c in docker node pnpm; do
  command -v "$c" >/dev/null 2>&1 || { echo "Faltando: $c"; miss=1; }
done
docker compose version >/dev/null 2>&1 || { echo "Faltando: 'docker compose' (plugin)"; miss=1; }
if [ "$miss" != 0 ]; then
  echo "Instale os itens acima e rode novamente."
  exit 1
fi

# 2. .env ---------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say ".env criado a partir de .env.example"
fi

# 3. Dependências -------------------------------------------------------------
say "Instalando dependências (pnpm install)"
pnpm install

# 4. Serviços: Postgres + Ollama ---------------------------------------------
say "Subindo Postgres + Ollama (docker)"
docker compose -f infra/docker/compose.yml --profile embed up -d

# 5. Esperar o Postgres -------------------------------------------------------
say "Aguardando o Postgres ficar pronto"
for _ in $(seq 1 60); do
  if docker exec linuxmeta-postgres pg_isready -U linuxmeta -d linuxmeta >/dev/null 2>&1; then
    pg_ready=1; break
  fi
  sleep 1
done
[ "${pg_ready:-}" = 1 ] || { echo "Postgres não ficou pronto a tempo."; exit 1; }

# 6. Importar o banco ---------------------------------------------------------
if [ -f backups/latest.dump ]; then
  say "Importando o banco (backups/latest.dump)"
  DB_IMPORT_YES=1 bash scripts/db-import.sh backups/latest.dump
else
  say "Sem dump em backups/latest.dump — aplicando schema vazio"
  pnpm db:push
fi

# 7. Modelo de embeddings (busca semântica) -----------------------------------
say "Baixando o modelo de embeddings no Ollama (nomic-embed-text)"
docker exec linuxmeta-ollama ollama pull nomic-embed-text \
  || warn "Aviso: pull do modelo falhou. Rode depois: docker exec linuxmeta-ollama ollama pull nomic-embed-text"

# 8. Build do site ------------------------------------------------------------
say "Compilando o site (build de produção)"
pnpm --filter @linux-meta/web build

# 9. Subir o servidor ---------------------------------------------------------
say "Subindo o site em http://localhost:4400"
set -a; . ./.env; set +a
if command -v ss >/dev/null 2>&1; then
  prev=$(ss -ltnp 2>/dev/null | grep ":4400 " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
  [ -n "${prev:-}" ] && kill "$prev" 2>/dev/null || true
fi
( cd apps/web && HOST=127.0.0.1 PORT=4400 nohup node dist/server/entry.mjs > /tmp/linux-meta-server.log 2>&1 & )
sleep 3

echo
ok   "Pronto! Tudo ativado."
echo "  Site:        http://localhost:4400/pt"
echo "  Logs:        /tmp/linux-meta-server.log"
echo "  Admin (dev): pnpm --filter @linux-meta/web run seed:admin"
echo "  Parar tudo:  docker compose -f infra/docker/compose.yml down ; pkill -f dist/server/entry.mjs"
