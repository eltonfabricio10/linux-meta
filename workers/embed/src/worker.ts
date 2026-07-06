/** Embed packages with EN translations missing a `package_embedding` row.
 *
 *  Env: LIMIT (default 200), CONCURRENCY (default 4), LOCALE (default 'en'),
 *       OLLAMA_URL, EMBED_MODEL.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { embed, EMBED_MODEL } from './ollama.ts';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 200));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 4));
const LOCALE = process.env.LOCALE ?? 'en';

type Candidate = {
  id: number;
  name: string;
  summary: string | null;
  description: string | null;
};

async function pick(): Promise<Candidate[]> {
  return db.execute<Candidate>(sql`
    SELECT p.id, p.name,
           t.summary AS "summary",
           t.description AS "description"
    FROM package p
    JOIN package_translation t
      ON t.package_id = p.id AND t.locale = ${LOCALE}
    LEFT JOIN package_embedding e
      ON e.package_id = p.id AND e.locale = ${LOCALE} AND e.model = ${EMBED_MODEL}
    WHERE t.summary IS NOT NULL
      AND e.package_id IS NULL
    ORDER BY p.popularity DESC, p.id ASC
    LIMIT ${LIMIT}
  `);
}

function buildText(c: Candidate): string {
  const parts = [c.name];
  if (c.summary) parts.push(c.summary);
  if (c.description) parts.push(c.description.slice(0, 800));
  return parts.join('\n');
}

async function workOne(c: Candidate): Promise<'ok' | 'fail'> {
  try {
    const vec = await embed(buildText(c));
    await db.insert(schema.packageEmbedding).values({
      packageId: c.id,
      locale: LOCALE,
      embedding: vec,
      model: EMBED_MODEL,
    }).onConflictDoUpdate({
      target: [schema.packageEmbedding.packageId, schema.packageEmbedding.locale, schema.packageEmbedding.model],
      set: { embedding: vec, computedAt: sql`now()` },
    });
    process.stderr.write(`[embed] ✓ id=${c.id} ${c.name}\n`);
    return 'ok';
  } catch (e) {
    process.stderr.write(`[embed] ✗ id=${c.id} ${c.name}: ${(e as Error).message}\n`);
    return 'fail';
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const cands = await pick();
  process.stderr.write(`[embed] candidates=${cands.length} concurrency=${CONCURRENCY} model=${EMBED_MODEL} locale=${LOCALE}\n`);
  if (cands.length === 0) {
    process.stderr.write('[embed] DONE ok=0 fail=0 (nothing to do)\n');
    process.exit(0);
  }

  let ok = 0, fail = 0;
  const queue = cands.slice();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const r = await workOne(next);
      if (r === 'ok') ok++; else fail++;
    }
  });
  await Promise.all(workers);

  process.stderr.write(`[embed] DONE ok=${ok} fail=${fail} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
