# linux-meta

Open Linux software metadata catalog.

Goal: package descriptions, categories, age ratings, provenance, and exports that
software centers can use safely.

## Canonical Context

- Agent rules: `AGENTS.md`.
- DB schema source: `packages/db/src/schema/*.ts`.
- Live schema reference: `docs/db-schema.md`.
- Package writing rules: `docs/package-profile.md`.
- Review log and historical notes: `REVIEW.md`.

If docs disagree with code or live DB, trust code/DB and update docs.

## Stack

- Node >= 22.
- `pnpm@11.2.2`.
- Astro SSR web app in `apps/web`.
- Preact islands.
- PostgreSQL + pgvector.
- Drizzle ORM in `packages/db`.
- Better Auth.
- Workers in `workers`.

## Repo Map

- `apps/web`: site, API routes, admin UI.
- `packages/db`: Drizzle schema and DB tooling.
- `packages/api-client`: generated TS client.
- `workers`: ingest, classify, translate, enrich, embed, export.
- `tools`: local review/sync helpers.
- `docs`: operating references.
- `data-export`: generated dataset export.
- `infra/docker`: local services.
- `e2e`: Playwright tests.

## Dev Setup

```bash
pnpm install
pnpm db:up
pnpm --filter @linux-meta/db push
pnpm dev
```

Web dev server: `http://localhost:4400`.

Do not assume Astro default port `4321`.

## Database

Dev URL:

```text
postgres://linuxmeta:linuxmeta@localhost:5433/linuxmeta
```

Container:

```text
linuxmeta-postgres
```

Useful commands:

```bash
pnpm db:up
pnpm db:down
pnpm --filter @linux-meta/db push
```

Manual SQL:

```bash
psql "$DATABASE_URL"
```

`"user"` is a reserved table name. Quote it in handwritten SQL.

## Admin Dev User

Seed script refuses production.

```bash
pnpm --filter @linux-meta/web run seed:admin
```

Defaults:

- Email: `admin@local.test`
- Password: `changeme-dev-only-1234`

Admin URL:

```text
http://localhost:4400/pt/admin
```

Promote an existing account with audit:

```bash
pnpm --filter @linux-meta/web run promote -- user@example.com admin
```

## Package Review

Use only the workbench for 10/10 review. Do not hand-write long SQL blocks.

```bash
pnpm review:workbench export --start-id 1 --limit 25 --out /tmp/block.json
pnpm review:workbench validate --input /tmp/block.reviewed.json --expect 25
pnpm review:workbench apply --input /tmp/block.reviewed.json --block V2-S0001-P001-025 --expect 25
```

Rules:

- Preserve official English summaries.
- Use package name as immutable context. Do not edit it.
- Translate `pt-br.summary` faithfully.
- Put effort into `description`.
- Start descriptions with concrete user value, not "opens/abre" or package
  name.
- Reject any lead like "opens/launches/starts/abre/inicia + app name".
- Reject any first sentence whose main information is that the program opens,
  starts, runs, shows, or gives access to itself.
- Treat old rows with this lead as not fully reviewed.
- Never spend the first sentence saying the app opens. Explain the useful
  outcome instead.
- Put launcher/start information only in profile launch fields, never as the
  description lead.
- Lead pattern: "Does useful task for user/context", not "Opens package name".
- Keep `plain_explanation` NULL by default.
- Validate 25/25 before reporting completion.
- Do not run web/build checks for DB-only review.
- Do not create narrative reports for successful blocks.
- Commit tooling/docs, not every DB block.
- Backup PostgreSQL every 5,000 reviewed packages.

## Official Metadata

Use local package-manager metadata for package names, English summaries,
versions, URLs, licenses, install sizes, and raw facts.

```bash
pnpm metadata:sync:prepare -- --source all --aur-min-votes 1 --out-dir /tmp/linux-meta-official-sync
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/linux-meta-official-sync/official-metadata-sync.sql
```

Details: `docs/official-metadata-sync.md`.

## Validation

Common checks:

```bash
pnpm --filter @linux-meta/web check
pnpm --filter @linux-meta/web build
pnpm --filter @linux-meta/e2e test
```

Run focused checks for the touched area first.

## Security

- Do not bypass Better Auth password hashing.
- Do not write directly to `account.password`.
- Server-side role checks are required for `/[locale]/admin` and
  `/api/v1/admin/**`.
- SQL direct writes do not automatically produce admin API audit rows. Add
  audit rows where needed.
- Report vulnerabilities privately. See `SECURITY.md`.

## Licenses

- Code: AGPL-3.0. See `LICENSE`.
- Project-created dataset: CC0-1.0. See `LICENSE-DATA`.
- Redistributed upstream metadata keeps upstream license/provenance.
