#!/usr/bin/env node
/**
 * embed-backfill.mjs — Backfill `package_embedding` rows for every package
 * that has an EN translation but no embedding yet.
 *
 * Reuses the same Ollama embeddings provider as workers/embed (model
 * `nomic-embed-text`, 768 dims).
 *
 * Design:
 *   - Batches of EMBED_BATCH (default 100) selected by `WHERE e.package_id
 *     IS NULL` — naturally resumable across restarts.
 *   - Composes text = `${name}\n\n${summary}\n\n${description}` truncated
 *     to 8000 chars.
 *   - Token-bucket rate limit at EMBED_RPS req/s (default 5).
 *   - Inserts each batch in a single transaction (ON CONFLICT DO UPDATE).
 *   - Records the run in `worker_run` (inline insert; the TS helper in
 *     apps/web/src/lib/worker-run.ts is not importable from a .mjs worker
 *     without a build step).
 *
 * Env:
 *   DATABASE_URL          required, e.g. postgres://linuxmeta:...@localhost:5432/linuxmeta
 *   OLLAMA_URL            default http://localhost:11434
 *   EMBED_MODEL           default nomic-embed-text
 *   EMBED_LOCALE          default en
 *   EMBED_BATCH           default 100
 *   EMBED_RPS             default 5  (requests/sec ceiling)
 *   EMBED_MAX             default 0  (0 = unlimited; cap rows processed)
 *   EMBED_TEXT_MAX        default 8000 (char cap on composed text)
 *
 * Run:
 *   cd workers && node embed-backfill.mjs
 *   # or via the script wired in workers/package.json (see README).
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  process.stderr.write('[embed-backfill] FATAL: DATABASE_URL not set\n');
  process.exit(2);
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text';
const EMBED_DIM = 768;
const LOCALE = process.env.EMBED_LOCALE ?? 'en';
const BATCH = Math.max(1, Number(process.env.EMBED_BATCH ?? 100));
const RPS = Math.max(0.1, Number(process.env.EMBED_RPS ?? 5));
const MAX = Math.max(0, Number(process.env.EMBED_MAX ?? 0));
const TEXT_MAX = Math.max(256, Number(process.env.EMBED_TEXT_MAX ?? 8000));

/* ------------------------------------------------------------------ utils */

/** Simple token-bucket: resolves at most RPS times per second. */
function makeLimiter(rps) {
  const intervalMs = 1000 / rps;
  let next = 0;
  return async function take() {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + intervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}

function composeText(row) {
  const parts = [row.name];
  if (row.summary) parts.push(row.summary);
  if (row.description) parts.push(row.description);
  const txt = parts.join('\n\n');
  return txt.length > TEXT_MAX ? txt.slice(0, TEXT_MAX) : txt;
}

function toVectorLiteral(vec) {
  return `[${vec.join(',')}]`;
}

/* --------------------------------------------------------------- provider */

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ollama http ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  if (!Array.isArray(j.embedding)) throw new Error('ollama: missing embedding');
  if (j.embedding.length !== EMBED_DIM) {
    throw new Error(`ollama: expected ${EMBED_DIM} dims, got ${j.embedding.length}`);
  }
  return j.embedding;
}

/* ------------------------------------------------------------------- main */

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

async function startRun() {
  const { rows } = await pool.query(
    `INSERT INTO worker_run (worker, status, meta)
     VALUES ($1, 'running', $2::jsonb)
     RETURNING id`,
    ['embed-backfill', JSON.stringify({ model: EMBED_MODEL, locale: LOCALE, rps: RPS, batch: BATCH })],
  );
  return rows[0].id;
}

async function finishRun(runId, status, items, errors, summary) {
  await pool.query(
    `UPDATE worker_run
        SET status = $2,
            items_processed = $3,
            errors_count = $4,
            error_summary = $5,
            finished_at = now()
      WHERE id = $1`,
    [runId, status, items, errors, summary],
  );
}

async function pickBatch() {
  const { rows } = await pool.query(
    `SELECT p.id, p.name,
            t.summary       AS summary,
            t.description   AS description
       FROM package p
       JOIN package_translation t
         ON t.package_id = p.id AND t.locale = $1
       LEFT JOIN package_embedding e
         ON e.package_id = p.id AND e.locale = $1 AND e.model = $2
      WHERE t.summary IS NOT NULL
        AND e.package_id IS NULL
      ORDER BY p.popularity DESC NULLS LAST, p.id ASC
      LIMIT $3`,
    [LOCALE, EMBED_MODEL, BATCH],
  );
  return rows;
}

async function writeBatch(results) {
  if (results.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      await client.query(
        `INSERT INTO package_embedding (package_id, locale, embedding, model, computed_at)
         VALUES ($1, $2, $3::vector, $4, now())
         ON CONFLICT (package_id, locale, model)
         DO UPDATE SET embedding = EXCLUDED.embedding, computed_at = now()`,
        [r.id, LOCALE, toVectorLiteral(r.vec), EMBED_MODEL],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const startedAt = Date.now();
  process.stderr.write(
    `[embed-backfill] model=${EMBED_MODEL} locale=${LOCALE} batch=${BATCH} rps=${RPS} max=${MAX || '∞'}\n`,
  );

  const runId = await startRun();
  const limiter = makeLimiter(RPS);

  let okTotal = 0;
  let failTotal = 0;
  const failMsgs = [];

  try {
    while (true) {
      const batch = await pickBatch();
      if (batch.length === 0) {
        process.stderr.write('[embed-backfill] no more candidates\n');
        break;
      }
      const results = [];
      for (const row of batch) {
        if (MAX > 0 && okTotal >= MAX) break;
        await limiter();
        try {
          const vec = await embed(composeText(row));
          results.push({ id: row.id, vec });
          okTotal += 1;
          if (okTotal % 25 === 0) {
            process.stderr.write(`[embed-backfill] progress ok=${okTotal} fail=${failTotal}\n`);
          }
        } catch (e) {
          failTotal += 1;
          const msg = `id=${row.id} ${row.name}: ${e.message}`;
          if (failMsgs.length < 20) failMsgs.push(msg);
          process.stderr.write(`[embed-backfill] FAIL ${msg}\n`);
        }
      }
      await writeBatch(results);
      if (MAX > 0 && okTotal >= MAX) {
        process.stderr.write(`[embed-backfill] MAX=${MAX} reached\n`);
        break;
      }
    }

    const status = failTotal > 0 ? 'error' : 'success';
    await finishRun(runId, status, okTotal, failTotal, failMsgs.join('\n') || null);
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    process.stderr.write(`[embed-backfill] DONE ok=${okTotal} fail=${failTotal} in ${secs}s (run_id=${runId})\n`);
    process.exit(failTotal > 0 ? 1 : 0);
  } catch (e) {
    await finishRun(runId, 'error', okTotal, failTotal + 1, `${e.message}\n${failMsgs.join('\n')}`).catch(() => {});
    process.stderr.write(`[embed-backfill] FATAL ${e.message}\n`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
