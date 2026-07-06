# Package Review State

Purpose: lightweight checkpoint for agents.

Detailed per-package changes live in PostgreSQL `audit_log`.

Do not append long package-name lists here.

## Current Method

- Review in blocks of 25.
- Use only `tools/package-review-workbench.mjs`.
- Store temporary JSON in `/tmp`.
- Apply one transaction per block.
- Validate before reporting success.
- Do not run frontend/build checks for DB-only review.
- Do not write narrative reports for successful blocks.
- Backup PostgreSQL every 5,000 reviewed packages.
- Do not commit every DB block.

Commands:

```bash
pnpm review:workbench export --start-id <id> --limit 25 --out /tmp/block.json
pnpm review:workbench validate --input /tmp/block.reviewed.json --expect 25
pnpm review:workbench apply --input /tmp/block.reviewed.json --block <block-id> --expect 25
```

## Quality Rules

Canonical writing rules: `docs/package-profile.md`.

Short version:

- Preserve official English summary.
- Use package name as immutable context. Do not edit it.
- Translate PT-BR summary faithfully.
- Put effort into descriptions.
- Do not start descriptions with "opens/abre", package name, or obvious launch
  behavior.
- The first sentence must explain value, not that the app opens.
- Keep `plain_explanation` NULL by default.
- Explain package purpose for normal users.
- Always review category, age, profile, launch metadata, dependency/service
  flags, audience, keywords.

## Latest Manual Review Progress

Latest applied 25-row validation passed:

- Block: `V2-S0001-P001-025`
- Package IDs: `1-25`
- Date: 2026-05-27
- Result: 25/25 valid

Validation fields all zero:

- blank descriptions
- short descriptions
- missing age
- summary mismatch
- `other/*` category
- PT-BR summary final period
- generic filler
- filled `plain_explanation`
- package-name starts
- missing profile core

## Historical Notes

Older long-form review logs were removed from this file to reduce agent context
noise. Use `audit_log` for authoritative block history.

Useful query:

```sql
SELECT
  after->>'block' AS block,
  count(*) AS packages,
  min(entity_id::int) AS first_id,
  max(entity_id::int) AS last_id,
  max(at) AS reviewed_at
FROM audit_log
WHERE actor = 'codex'
  AND action = 'core_quality_rereviewed'
GROUP BY after->>'block'
ORDER BY reviewed_at DESC
LIMIT 20;
```
