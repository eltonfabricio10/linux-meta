/** CLI: embed an arbitrary string and find top-K nearest neighbors. */
import { sql } from 'drizzle-orm';
import { db } from '@linux-meta/db';
import { embed, EMBED_MODEL } from './ollama.ts';

const LIMIT = Math.max(1, Number(process.env.LIMIT ?? 10));
const LOCALE = process.env.LOCALE ?? 'en';

async function main(): Promise<void> {
  const q = process.argv.slice(2).join(' ').trim();
  if (!q) {
    process.stderr.write('usage: query <text>\n');
    process.exit(2);
  }
  const vec = await embed(q);
  const lit = `[${vec.join(',')}]`;
  const rows = await db.execute<{
    package_id: number; slug: string; name: string; score: number;
  }>(sql`
    SELECT e.package_id, p.slug, p.name,
           1 - (e.embedding <=> ${lit}::vector) AS score
    FROM package_embedding e
    JOIN package p ON p.id = e.package_id
    WHERE e.locale = ${LOCALE} AND e.model = ${EMBED_MODEL}
    ORDER BY e.embedding <=> ${lit}::vector
    LIMIT ${LIMIT}
  `);
  process.stdout.write(JSON.stringify({ query: q, results: rows }, null, 2) + '\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
