# Setup & database portability

How to run the site on a fresh machine and move the database between computers.

## Requirements

- Docker (for Postgres + pgvector)
- Node >= 22 and pnpm
- PostgreSQL client tools: `pg_dump`, `pg_restore`, `psql`

## One-command bootstrap

```bash
pnpm setup
pnpm dev
```

`pnpm setup` (`scripts/dev-setup.sh`):

1. creates `.env` from `.env.example` if missing,
2. `pnpm install`,
3. `pnpm db:up` — starts Postgres + pgvector (docker, port 5433) and creates the
   `pg_trgm` / `citext` / `vector` extensions on first boot,
4. waits for the database to be healthy,
5. imports `backups/latest.dump` if present, otherwise applies the empty schema
   (`pnpm db:push`).

Web dev server runs at `http://localhost:4400` (not Astro's default 4321).

Manual equivalent:

```bash
pnpm install
cp .env.example .env        # defaults match the docker Postgres
pnpm db:up
pnpm db:import              # or: pnpm db:push  (empty schema)
pnpm dev
```

## Moving the database to another computer

The dump captures the full database (schema + all data, including pgvector
embeddings).

On the **source** machine:

```bash
pnpm db:export
# writes backups/linuxmeta-<timestamp>.dump and updates backups/latest.dump
```

Copy `backups/latest.dump` (and/or the dated file) to the **target** machine,
then:

```bash
pnpm db:import                    # restores backups/latest.dump
pnpm db:import path/to/file.dump  # or a specific dump
```

Notes:

- Dumps live in `backups/` which is **gitignored** — they are large (hundreds of
  MB) and may contain data. Transfer them out of band (scp, rsync, USB).
- The dump is the portable PostgreSQL custom format (`pg_dump -Fc`,
  `--no-owner --no-privileges`), restorable across machines/roles.
- `db:import` **replaces** the target database (`pg_restore --clean --if-exists`).
  It prompts for confirmation when run interactively; set `DB_IMPORT_YES=1` to
  skip (the bootstrap script does this).
- `db:import` first ensures the `pg_trgm`, `citext` and `vector` extensions
  exist, so it works against a fresh database too.

## Semantic search / embeddings (optional)

Semantic search and the embedding features use a local Ollama model
(`nomic-embed-text`, 768-dim) — no external API.

```bash
docker compose -f infra/docker/compose.yml --profile embed up -d ollama
docker exec linuxmeta-ollama ollama pull nomic-embed-text
```

Generate missing `package_embedding` rows from the admin **Quality** page
(the "no embedding" signal has a *Generate embeddings* button), or in bulk:

```bash
pnpm --filter @linux-meta/web exec tsx src/_backfill-embeddings.ts
```

## Admin dev user

```bash
pnpm --filter @linux-meta/web run seed:admin
# default: admin@local.test / changeme-dev-only-1234
```
