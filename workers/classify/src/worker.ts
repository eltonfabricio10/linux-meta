/** Classify worker.
 *
 *  Picks packages that lack `rating_current`, builds a prompt from their
 *  description/summary, invokes the CLI, validates output, writes rating
 *  + rating_current.
 *
 *  Env:
 *    LIMIT        = how many packages to classify in this run  (default 25)
 *    CLI          = 'claude' (default) or 'codex'
 *    MODEL        = model alias passed to CLI                  (default 'haiku')
 *    CONCURRENCY  = parallel CLI invocations                   (default 1)
 *    MIN_POPULARITY = skip pkgs below this popularity          (default 0)
 *    DRY_RUN      = if set, do not write to DB
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { callCli, extractJson, type CliKind } from './cli-driver.ts';
import { validate, type ClassifyResult } from './validate.ts';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 25));
const CLI = (process.env.CLI ?? 'claude') as CliKind;
const MODEL = process.env.MODEL ?? 'haiku';
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CONCURRENCY ?? 1)));
const MIN_POP = Number(process.env.MIN_POPULARITY ?? 0);
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const here = dirname(fileURLToPath(import.meta.url));
const promptTemplate = await readFile(resolve(here, '../prompts/classify-package.md'), 'utf8');

const CLASSIFIER_VERSION = `${CLI}:${MODEL}:v1`;

type Candidate = {
  id: number;
  name: string;
  source: string;
  sourceId: string;
  summary: string | null;
  description: string | null;
  upstreamUrl: string | null;
};

async function pickCandidates(): Promise<Candidate[]> {
  /* Canonical-aware: skip packages whose canonical_slug already has a rating
   * via any sibling. Reduces redundant LLM calls for the same upstream app
   * packaged across multiple distros (firefox manjaro/flathub/aur/debian). */
  return db.execute<Candidate>(sql`
    WITH covered AS (
      SELECT DISTINCT COALESCE(p2.canonical_slug, p2.slug) AS cs
      FROM rating r
      JOIN package p2 ON p2.id = r.package_id
    )
    SELECT
      p.id,
      p.name,
      p.source,
      p.source_id        AS "sourceId",
      COALESCE(pt.summary,     p.raw_metadata->>'desc')  AS summary,
      COALESCE(pt.description, p.raw_metadata->>'desc')  AS description,
      p.upstream_url     AS "upstreamUrl"
    FROM package p
    LEFT JOIN rating_current rc ON rc.package_id = p.id
    LEFT JOIN package_translation pt
      ON pt.package_id = p.id AND pt.locale = 'en'
    WHERE rc.package_id IS NULL
      AND COALESCE(p.canonical_slug, p.slug) NOT IN (SELECT cs FROM covered)
      AND p.popularity >= ${MIN_POP}
      AND (
            COALESCE(pt.summary,     p.raw_metadata->>'desc') IS NOT NULL
         OR COALESCE(pt.description, p.raw_metadata->>'desc') IS NOT NULL
      )
    ORDER BY p.popularity DESC, p.id ASC
    LIMIT ${LIMIT}
  `);
}

function buildPrompt(c: Candidate): string {
  const parts = [
    promptTemplate,
    `name: ${c.name}`,
    `source: ${c.source} (${c.sourceId})`,
  ];
  if (c.upstreamUrl) parts.push(`upstream_url: ${c.upstreamUrl}`);
  if (c.summary) parts.push(`summary: ${c.summary}`);
  if (c.description && c.description !== c.summary) {
    parts.push(`description: ${truncate(c.description, 2000)}`);
  }
  parts.push('', 'Respond with the JSON object only.');
  return parts.join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

async function classifyOne(c: Candidate): Promise<{ ok: boolean; pkgId: number; result?: ClassifyResult; reason?: string; ms: number; cost?: number | null }> {
  const prompt = buildPrompt(c);
  const cli = await callCli(prompt, { kind: CLI, model: MODEL });
  if (!cli.ok) return { ok: false, pkgId: c.id, reason: cli.error, ms: cli.durationMs };

  const parsed = extractJson(cli.text);
  if (parsed == null) return { ok: false, pkgId: c.id, reason: `no json in: ${cli.text.slice(0, 200)}`, ms: cli.durationMs, cost: cli.costUsd };

  const v = validate(parsed);
  if ('error' in v) return { ok: false, pkgId: c.id, reason: v.error, ms: cli.durationMs, cost: cli.costUsd };

  return { ok: true, pkgId: c.id, result: v, ms: cli.durationMs, cost: cli.costUsd };
}

async function writeRating(pkgId: number, r: ClassifyResult): Promise<void> {
  const srcLabel = CLI === 'claude' ? 'ai_claude_code' : 'ai_codex';
  await db.transaction(async (tx) => {
    /* Write authoritative rating on the classified pid */
    await tx.insert(schema.rating).values({
      packageId: pkgId,
      source: srcLabel,
      ageMin: r.age_min,
      oars: r.oars,
      confidence: r.confidence,
      classifierVersion: CLASSIFIER_VERSION,
      rationale: r.rationale,
    });
    await tx
      .insert(schema.ratingCurrent)
      .values({
        packageId: pkgId,
        ageMin: r.age_min,
        dominantSource: srcLabel,
        oars: r.oars,
      })
      .onConflictDoUpdate({
        target: schema.ratingCurrent.packageId,
        set: {
          ageMin: sql`excluded.age_min`,
          dominantSource: sql`excluded.dominant_source`,
          oars: sql`excluded.oars`,
          computedAt: sql`now()`,
        },
      });

    /* Fanout to canonical siblings without a rating. Marks source='fanout',
     * rationale traces back to the original pid. Skips siblings already rated. */
    await tx.execute(sql`
      WITH src AS (SELECT COALESCE(canonical_slug, slug) AS cs FROM package WHERE id = ${pkgId}),
           siblings AS (
             SELECT p.id FROM package p, src
             WHERE COALESCE(p.canonical_slug, p.slug) = src.cs
               AND p.id <> ${pkgId}
               AND NOT EXISTS (SELECT 1 FROM rating WHERE package_id = p.id)
           )
      INSERT INTO rating (package_id, source, age_min, oars, confidence, classifier_version, rationale, status, created_at)
      SELECT s.id, 'fanout', ${r.age_min}, ${r.oars}::jsonb, ${r.confidence}, ${CLASSIFIER_VERSION},
             ${'derived from pkg #' + pkgId + ' (orig source: ' + srcLabel + '). ' + (r.rationale ?? '')},
             'pending', NOW()
      FROM siblings s
    `);
    await tx.execute(sql`
      WITH src AS (SELECT COALESCE(canonical_slug, slug) AS cs FROM package WHERE id = ${pkgId}),
           siblings AS (
             SELECT p.id FROM package p, src
             WHERE COALESCE(p.canonical_slug, p.slug) = src.cs
               AND p.id <> ${pkgId}
               AND NOT EXISTS (SELECT 1 FROM rating_current WHERE package_id = p.id)
           )
      INSERT INTO rating_current (package_id, age_min, dominant_source, oars, computed_at)
      SELECT s.id, ${r.age_min}, 'fanout', ${r.oars}::jsonb, NOW() FROM siblings s
      ON CONFLICT (package_id) DO NOTHING
    `);
  });
}

async function pool<T, U>(items: T[], n: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out: U[] = [];
  let i = 0;
  const worker = async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const candidates = await pickCandidates();
  process.stderr.write(`[classify] candidates=${candidates.length} cli=${CLI} model=${MODEL} concurrency=${CONCURRENCY} dry=${DRY}\n`);
  if (candidates.length === 0) {
    process.stderr.write(`[classify] nothing to do.\n`);
    process.exit(0);
  }

  let ok = 0;
  let fail = 0;
  let totalCost = 0;

  const results = await pool(candidates, CONCURRENCY, async (c) => {
    const t0 = Date.now();
    const r = await classifyOne(c);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.ok && r.result) {
      ok++;
      if (typeof r.cost === 'number') totalCost += r.cost;
      const oarsKeys = Object.keys(r.result.oars).join(',') || '∅';
      process.stderr.write(
        `[classify] ✓ id=${c.id} ${c.name} → age=${r.result.age_min} conf=${r.result.confidence.toFixed(2)} oars=[${oarsKeys}] ${elapsed}s\n`,
      );
      if (!DRY) await writeRating(c.id, r.result);
    } else {
      fail++;
      process.stderr.write(`[classify] ✗ id=${c.id} ${c.name}: ${r.reason} (${elapsed}s)\n`);
    }
    return r;
  });

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'classify_run',
    entityType: 'classify',
    after: {
      cli: CLI, model: MODEL,
      attempted: candidates.length, ok, fail,
      costUsd: totalCost,
      durationMs: Date.now() - startedAt,
      dry: DRY,
    },
  });

  process.stderr.write(
    `[classify] DONE ok=${ok} fail=${fail} cost=$${totalCost.toFixed(4)} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`,
  );
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
  void results;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
