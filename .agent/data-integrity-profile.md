# Data Integrity Profile

Project: `linux-meta`.

Store: PostgreSQL from `DATABASE_URL`.

Rules:

- Use transactional writes.
- Package review fast path: workbench export, fill review JSON, apply, validate.
- Preserve official English summaries.
- Keep `plain_explanation` NULL by default.
- Validate every review block before success.
- Do not run frontend/build/test checks for DB-only package review.
- Do not create narrative reports for successful 25-row blocks.
- Do not use Git commits as DB rollback for review blocks.
- Backup PostgreSQL every 5,000 reviewed packages.
- Commit only code/docs/tooling changes.
- Keep temporary review JSON/SQL in `/tmp`.
- Do not reset, truncate, broad-delete, or run destructive migrations without
  explicit user approval.

Package-review block must pass:

- Expected count matches block size.
- Package `name` was used as context and not modified.
- `en.summary` equals `package_official_metadata.official_summary`.
- EN/PT-BR descriptions present and didactic.
- Description lead answers "why install this?", not "how to open it".
- Reject leads like "Opens/Launches/Runs..." and "Abre/Inicia/Executa...".
- PT-BR summary short, faithful, no final period.
- `plain_explanation` NULL.
- Category reviewed; no `other/*` unless explicitly justified.
- Age present.
- `package_profile` core fields present.
- No generic repository/upstream/license filler.

Rollback:

- Before milestone backup: apply corrective transaction.
- After milestone backup: restore backup or apply corrective transaction.
- Repo artifacts: use Git revert only for tracked files.
