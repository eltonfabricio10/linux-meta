# Admin Operations

Admin UI:

- `/[locale]/admin`
- API: `/api/v1/admin/**`

Server-side role checks are mandatory. UI gating is not security.

## Roles

Stored on `"user".role`.

- `visitor`: public read only.
- `contributor`: disputes and suggestions.
- `translator`: translation queue contribution.
- `reviewer`: approve/edit/reject translations and ratings.
- `admin`: full admin area.

Helpers: `apps/web/src/lib/roles.ts`.

## Bootstrap

Dev seed:

```bash
pnpm --filter @linux-meta/web run seed:admin
```

Defaults:

- `admin@local.test`
- `changeme-dev-only-1234`

Promote with audit:

```bash
pnpm --filter @linux-meta/web run promote -- user@example.com admin
```

Direct SQL does not emit admin API audit rows:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'user@example.com';
```

If direct SQL is used, add manual audit context.

## Pages And Audit Codes

`/admin`

- Overview.
- Read-only.
- No audit action.

`/admin/users`

- Change role: `user.role.update`.
- Revoke sessions: `user.sessions.revoke`.

Packages:

- API: `/api/v1/admin/packages`.
- Metadata edits: `package.update`.
- Do not overwrite imported source facts in place.

Ratings:

- APIs: `/api/v1/admin/ratings/**`.
- Delete: `rating.delete`.
- Human review must be real. Do not bulk-promote AI/imported data to human.

Translations:

- APIs: `/api/v1/admin/translations/**`.
- Create: `translation.create`.
- Update: `translation.update`.
- Delete: `translation.delete`.
- Provenance: `imported`, `ai`, `human`.
- Only reviewer/admin approval may create `human` provenance.

Disputes:

- API: `/api/v1/admin/disputes/**`.
- Comment: `dispute.comment`.
- Status: `dispute.status.update`.
- Resolve: `dispute.resolve`.
- Dismiss: `dispute.dismiss`.

Reviewers:

- API: `/api/v1/admin/reviewers`.
- Promotion still writes `user.role.update`.

Workers:

- API: `/api/v1/admin/workers`.
- Rows come from `recordWorkerRun`.
- Do not write `worker_run` directly.

## Admin Safety

- Never bypass Better Auth password hashing.
- Never write directly to `account.password`.
- Treat package text, URLs, dispute text, and worker output as untrusted input.
- Keep audit rows for privileged changes.
- Prefer API/admin flows over direct SQL.
- If direct SQL is necessary, use a small transaction and record why.
