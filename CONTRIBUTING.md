# Contributing

Keep changes small, factual, and reviewable.

## Before Work

- Read `AGENTS.md`.
- Read `README.md` for setup.
- Read topic docs only when needed.

## Issues

Use issues for:

- Bugs: steps, expected, observed, environment, package id if relevant.
- Metadata disputes: package id, field, source, suggested value, reason.
- Features: user-visible behavior and scope.

Security reports: use `SECURITY.md`, not public issues.

## Pull Requests

- One logical change per PR.
- No unrelated formatting churn.
- Imperative commit subject.
- Explain what changed, why, and how tested.
- Link issue when relevant.

## Required Checks

Run focused checks for touched area.

Common web checks:

```bash
pnpm --filter @linux-meta/web check
pnpm --filter @linux-meta/web build
```

E2E when user flow changes:

```bash
pnpm --filter @linux-meta/e2e test
```

DB schema changes:

```bash
pnpm --filter @linux-meta/db push
```

## Metadata Review

- Use `tools/package-review-workbench.mjs`.
- Review 25 packages per block.
- Preserve official EN summaries.
- Use package name as immutable context. Do not edit it.
- Review PT-BR summary, descriptions, category, age, profile.
- Keep `plain_explanation` NULL by default.
- Validate before reporting completion.
- Do not commit per DB review block.

## Workers

Workers write imported/AI data and must record telemetry.

Use `recordWorkerRun` from `apps/web/src/lib/worker-run.ts`.

Minimum pattern:

```ts
await recordWorkerRun('worker-name', async (ctx) => {
  for (const item of input) {
    try {
      await process(item);
      ctx.addItems(1);
    } catch (error) {
      ctx.addError(error instanceof Error ? error.message : String(error));
    }
  }
});
```

Rules:

- Do not write directly to `worker_run`.
- Do not swallow errors.
- Do not mark AI/imported rows as human-reviewed.

## Reviewers

Reviewer role is granted by admins.

Reviewer actions may approve translation, category, age, and metadata fixes.

Role promotions must be audited.

## References

- Setup: `README.md`
- Agent rules: `AGENTS.md`
- Package writing: `docs/package-profile.md`
- Admin: `docs/admin.md`
- Security: `SECURITY.md`
