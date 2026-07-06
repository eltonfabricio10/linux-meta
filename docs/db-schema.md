# Database Schema

Canonical schema source:

```text
packages/db/src/schema/*.ts
```

Live dev database:

```text
postgres://linuxmeta:linuxmeta@localhost:5433/linuxmeta
```

Use this file as a table map only. If exact columns/indexes matter, inspect the
Drizzle schema or live DB.

## Core Tables

Auth:

- `"user"`: Better Auth user plus project role.
- `session`: sessions.
- `account`: provider/password records.
- `verification`: Better Auth verification records.

Package data:

- `package`: canonical package rows from Manjaro, AUR, Flathub, Debian.
- `package_official_metadata`: package-manager/source facts.
- `package_translation`: per-locale summary, description, plain explanation.
- `package_profile`: package type, interface, launch metadata, audience.
- `package_embedding`: pgvector embeddings.

Ratings:

- `rating`: observations from upstream, AI, human review.
- `rating_current`: effective denormalized rating.
- `dispute`: rating/metadata disputes.

Enrichment:

- `permission_analysis`: permission observations.
- `cve_link`: CVE observations.
- `project_health`: source/project health signals.

Operations:

- `worker_run`: worker telemetry.
- `audit_log`: append-only audit trail.

## Important Rules

- Quote `"user"` in SQL.
- Preserve official English summaries from `package_official_metadata`.
- `package_translation.plain_explanation` is NULL by default.
- Review writes should update `package`, `package_translation`,
  `rating_current`, `package_profile`, and `audit_log` transactionally.
- Review writes may update `package.cat_path`; they must not update
  `package.name`.
- Do not promote provenance to `human` without real review.

## Inspection Commands

```bash
psql "$DATABASE_URL" -c '\dt'
psql "$DATABASE_URL" -c '\d package_translation'
psql "$DATABASE_URL" -c '\d package_profile'
psql "$DATABASE_URL" -c '\d audit_log'
```

## Review Validation Shape

For a reviewed package block, expected failures are zero:

- blank descriptions
- short descriptions
- missing age
- EN summary mismatch
- `other/*` category unless justified
- PT-BR summary final period
- generic filler
- filled `plain_explanation`
- package-name starts
- missing profile core

Use only `tools/package-review-workbench.mjs` for 10/10 package review.
