/* One-off backfill of package.cat_path using in-tree taxonomy. Run via:
 *   pnpm --filter @linux-meta/web exec tsx src/lib/_backfill-cat-path.ts */
import { classifyPackage } from './categories';
import { db } from './db';
import { sql } from 'drizzle-orm';

const BATCH = 2000;
const totalRow = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM package`);
const total = totalRow[0]?.n ?? 0;
console.log(`total packages: ${total}`);

let offset = 0;
let processed = 0;
const startedAt = Date.now();

while (offset < total) {
  const rows = await db.execute<{ id: number; source: string; name: string; raw_metadata: Record<string, unknown> | null }>(sql`
    SELECT id, source, name, raw_metadata FROM package ORDER BY id LIMIT ${BATCH} OFFSET ${offset}
  `);
  if (rows.length === 0) break;

  const updates: Array<[number, string]> = [];
  for (const r of rows) {
    const matches = classifyPackage({ source: r.source, name: r.name, raw_metadata: r.raw_metadata });
    const m = matches[0];
    if (m) updates.push([r.id, `${m.category}/${m.subcategory}`]);
  }

  if (updates.length) {
    const valuesSql = sql.join(
      updates.map(([id, cp]) => sql`(${id}::int, ${cp}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE package SET cat_path = u.cp
      FROM (VALUES ${valuesSql}) AS u(id, cp)
      WHERE package.id = u.id
    `);
  }
  processed += rows.length;
  offset += BATCH;
  if (processed % 10000 === 0 || processed >= total) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`processed ${processed}/${total} in ${elapsed}s`);
  }
}

const hist = await db.execute<{ cat_path: string; n: number }>(sql`
  SELECT cat_path, COUNT(*)::int AS n FROM package GROUP BY cat_path ORDER BY n DESC LIMIT 20
`);
console.log('top cat_paths:');
for (const h of hist) console.log(`  ${h.cat_path}: ${h.n}`);

process.exit(0);
