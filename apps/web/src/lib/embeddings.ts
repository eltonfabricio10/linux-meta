/**
 * In-system embeddings — generate `package_embedding` rows with the local
 * Ollama model (nomic-embed-text, 768-dim). No external API, no new dependency;
 * same model/endpoint the semantic search already queries. Used by the admin
 * backfill endpoint to fill the gap for packages that lack an EN embedding.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
const EMBED_LOCALE = process.env.EMBED_LOCALE ?? 'en';
const EMBED_DIM = 768;
const EMBED_TEXT_MAX = 8000;

export type BackfillResult = { processed: number; failed: number; remaining: number };

/** Embed one text via Ollama. Throws on unreachable service or bad shape. */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, EMBED_TEXT_MAX) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const j = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(j.embedding) || j.embedding.length !== EMBED_DIM) {
    throw new Error('ollama: bad embedding shape');
  }
  return j.embedding;
}

/** True if the Ollama embeddings endpoint answers. */
export async function isOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Count packages that have an EN translation but no EN embedding for the model. */
export async function countMissingEmbeddings(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM package p
    JOIN package_translation t ON t.package_id = p.id AND t.locale = ${EMBED_LOCALE}
    LEFT JOIN package_embedding e
      ON e.package_id = p.id AND e.locale = ${EMBED_LOCALE} AND e.model = ${EMBED_MODEL}
    WHERE p.moderation_status = 'approved' AND e.package_id IS NULL
      AND (t.summary IS NOT NULL OR t.description IS NOT NULL)
  `);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

/**
 * Generate embeddings for up to `limit` packages missing one, highest
 * popularity first. Sequential to respect the local model. Idempotent via
 * ON CONFLICT. Returns processed/failed counts and how many remain after.
 */
export async function generateMissingEmbeddings(limit: number): Promise<BackfillResult> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const targets = await db.execute<{
    id: number; summary: string | null; description: string | null;
  }>(sql`
    SELECT p.id, t.summary, t.description
    FROM package p
    JOIN package_translation t ON t.package_id = p.id AND t.locale = ${EMBED_LOCALE}
    LEFT JOIN package_embedding e
      ON e.package_id = p.id AND e.locale = ${EMBED_LOCALE} AND e.model = ${EMBED_MODEL}
    WHERE p.moderation_status = 'approved' AND e.package_id IS NULL
      AND (t.summary IS NOT NULL OR t.description IS NOT NULL)
    ORDER BY p.popularity DESC NULLS LAST
    LIMIT ${safeLimit}
  `);

  let processed = 0;
  let failed = 0;
  for (const row of targets as unknown as Array<{ id: number; summary: string | null; description: string | null }>) {
    const text = [row.summary, row.description].filter(Boolean).join('\n\n').trim();
    if (!text) { failed++; continue; }
    try {
      const vec = await embedText(text);
      const lit = `[${vec.join(',')}]`;
      await db.execute(sql`
        INSERT INTO package_embedding (package_id, locale, model, embedding)
        VALUES (${row.id}, ${EMBED_LOCALE}, ${EMBED_MODEL}, ${lit}::vector)
        ON CONFLICT (package_id, locale, model)
        DO UPDATE SET embedding = EXCLUDED.embedding, computed_at = now()
      `);
      processed++;
    } catch {
      failed++;
    }
  }

  const remaining = await countMissingEmbeddings();
  return { processed, failed, remaining };
}
