/** Create pgvector HNSW index on package_embedding.embedding. Idempotent. */
import { sql } from 'drizzle-orm';
import { db } from '@linux-meta/db';

async function main(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS package_embedding_hnsw
    ON package_embedding
    USING hnsw (embedding vector_cosine_ops)
  `);
  process.stderr.write('[embed/init] HNSW index ready.\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
