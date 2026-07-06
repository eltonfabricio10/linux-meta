# Agent Operating Rules

Use this file as the first project context. Keep it short. Prefer code and live
schema over stale prose.

## Project

- `linux-meta`: Linux package metadata catalog.
- Core value: correct package identity, clear user-facing descriptions, age
  rating, category, provenance.
- Current review scope: English and Brazilian Portuguese only. Other locales can
  be regenerated later from reviewed EN/PT-BR.

## Stack

- Node >= 22. Package manager: `pnpm@11.2.2`.
- Web: Astro SSR + Preact islands in `apps/web`.
- DB: PostgreSQL + pgvector. Drizzle schema in `packages/db/src/schema`.
- Workers: `workers/*`.
- Review helper: `tools/package-review-workbench.mjs`.

## Database

- Dev `DATABASE_URL`: `postgres://linuxmeta:linuxmeta@localhost:5433/linuxmeta`.
- Preserve official English summaries from `package_official_metadata`.
- Direct review writes are allowed only through transactional scripts/tools.
- Do not run broad deletes, resets, or destructive migrations without explicit
  user approval.
- Backup strategy for long package-review runs: PostgreSQL backup each 5,000
  reviewed packages, not Git commits per review block.

## Package Review

- Use only `tools/package-review-workbench.mjs`.
- Export 25 packages.
- Review package by package.
- Fill only `review` data.
- Use package `name` as immutable context. Never change it.
- Apply one transaction with `pnpm review:workbench apply`.
- Validate 25/25 before reporting success.
- Continue directly to next block when asked for long runs.
- Do not stop to narrate batch composition.
- Do not write batch reports unless a blocker needs evidence.
- Do not run web checks, Astro, build, lint, or tests for DB-only review.
- Report only final validation or blockers.

Quality bar:

- `en.summary`: official metadata, unchanged.
- `pt-br.summary`: short faithful translation. No final period.
- `description`: main effort. Explain for normal users.
- `plain_explanation`: NULL by default.
- Always review category, age, component type, interface, launch metadata,
  background/dependency flags, audience, keywords.

Description must answer:

- What user problem does it solve?
- What is it?
- What can the user do with it, or what does it enable?
- Is it an app, CLI, service, library, theme, data, plugin, driver, docs,
  compatibility layer, or metapackage?
- Does the user open it, run a command, configure it, or only receive it as a
  dependency?
- Who needs it?
- What changes after install?
- What risks matter: network, credentials, firewall, camera/mic, files, boot,
  permissions, hardware, online content, destructive writes, public chat, or
  offensive security?

Avoid:

- Hard fail: lead centered on obvious mechanics: opens, launches, starts, runs,
  shows, installs, adds, provides access, keeps ready, or PT-BR equivalents.
- Hard fail: first sentence that only says the app opens, starts, runs, shows,
  or provides access to itself.
- Existing reviewed rows with this lead are still defects. Re-review them.
- Do not describe launch behavior as user value. Use `launch_*` profile fields.
- Starting with package name.
- Repeating the summary.
- Generic repository/upstream/license filler.
- Vague text like "support files", "resources", "runtime behavior" without
  saying what that means for the user.
- Invented features.

Lead sentence pattern:

- Start with the useful outcome, not the action of opening, running, installing,
  displaying, or adding the program.
- First sentence must answer: "Why would I install this?"
- Good: "Creates visual audio patches for live performance and sound design."
- Bad: "Opens Pure Data, a visual programming environment for music."
- Better PT-BR: "Cria patches visuais de áudio para música ao vivo e design de
  som."
- Good PT-BR: "Cria patches visuais de áudio para apresentações ao vivo e
  desenho de som."
- Bad PT-BR: "Abre o Pure Data, um ambiente de programação visual para música."

## Git

- Preserve user changes.
- Commit only code/docs/tooling changes when useful.
- Do not commit every DB review block.
- Temporary review JSON/SQL belongs in `/tmp`, not the repo.

## Validation

- Code/docs: focused check first.
- Package review: workbench validation plus DB validation.
- Web changes: `pnpm --filter @linux-meta/web check` and build when relevant.

## Docs

- Keep docs English, telegraphic, current.
- `AGENTS.md`: agent rules.
- `README.md`: human quickstart and repo map.
- `docs/package-profile.md`: package metadata and writing standard.
- `docs/official-metadata-sync.md`: official metadata sync.
- `docs/admin.md`: admin operations.
- `docs/db-schema.md`: generated/observed schema reference.
