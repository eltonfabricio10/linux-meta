/** AUR ingestor.
 *  Downloads packages-meta-v1.json.gz, filters by NumVotes, upserts as source='aur'.
 *
 *  Run:
 *    pnpm --filter @linux-meta/ingest aur
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { slugify } from './lib/slug.ts';

const SOURCE = 'aur';
const URL = process.env.AUR_META_URL ??
  'https://aur.archlinux.org/packages-meta-v1.json.gz';
const MIN_VOTES = Number(process.env.MIN_VOTES ?? '5');
const DRY_RUN = /^(1|true)$/i.test(process.env.DRY_RUN ?? '');

type AurPkg = {
  Name: string;
  Description?: string | null;
  URL?: string | null;
  License?: string[] | null;
  NumVotes?: number;
  Popularity?: number;
  OutOfDate?: number | null;
  Maintainer?: string | null;
  Version?: string;
};

type Row = typeof schema.packageTable.$inferInsert;

async function fetchJson(): Promise<AurPkg[]> {
  process.stderr.write(`[aur] GET ${URL}\n`);
  const res = await fetch(URL, {
    headers: { 'user-agent': 'linux-meta-ingest/0.0 (+https://example.org)' },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${URL}`);
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  Readable.fromWeb(res.body as never).pipe(gunzip);
  for await (const c of gunzip as unknown as AsyncIterable<Buffer>) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  process.stderr.write(`[aur] downloaded bytes=${text.length}\n`);
  return JSON.parse(text) as AurPkg[];
}

async function upsertBatch(rows: Row[]) {
  if (rows.length === 0 || DRY_RUN) return;
  await db
    .insert(schema.packageTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.packageTable.source, schema.packageTable.sourceId],
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
        upstreamUrl: sql`excluded.upstream_url`,
        licenseSpdx: sql`excluded.license_spdx`,
        latestVersionDistro: sql`excluded.latest_version_distro`,
        popularity: sql`excluded.popularity`,
        rawMetadata: sql`excluded.raw_metadata`,
        updatedAt: sql`now()`,
      },
    });
}

async function main() {
  const startedAt = Date.now();
  const all = await fetchJson();
  const kept = all.filter((p) => (p.NumVotes ?? 0) >= MIN_VOTES && p.Name);
  process.stderr.write(`[aur] kept ${kept.length}/${all.length} after threshold (MIN_VOTES=${MIN_VOTES})\n`);

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < kept.length; i += BATCH) {
    const slice = kept.slice(i, i + BATCH);
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const p of slice) {
      if (seen.has(p.Name)) continue;
      seen.add(p.Name);
      const lic = Array.isArray(p.License) && p.License.length > 0 ? p.License.join(' OR ') : null;
      rows.push({
        source: SOURCE,
        sourceId: p.Name,
        name: p.Name,
        slug: slugify(p.Name),
        upstreamUrl: p.URL ?? null,
        licenseSpdx: lic,
        latestVersionDistro: p.Version ?? null,
        popularity: Math.round((p.Popularity ?? 0) * 100),
        rawMetadata: {
          desc: p.Description ?? null,
          description: p.Description ?? null,
          numVotes: p.NumVotes ?? 0,
          popularity: p.Popularity ?? 0,
          outOfDate: p.OutOfDate ?? null,
          maintainer: p.Maintainer ?? null,
        },
        updatedAt: new Date(),
      });
    }
    await upsertBatch(rows);
    upserted += rows.length;
    if (i % (BATCH * 10) === 0) {
      process.stderr.write(`[aur] progress ${Math.min(i + BATCH, kept.length)}/${kept.length}\n`);
    }
  }

  if (!DRY_RUN) {
    await db.insert(schema.auditLog).values({
      actor: 'system',
      action: 'ingest_aur',
      entityType: 'ingest_run',
      entityId: null,
      after: {
        source: SOURCE,
        url: URL,
        minVotes: MIN_VOTES,
        total: all.length,
        kept: kept.length,
        upserted,
        durationMs: Date.now() - startedAt,
      },
    });
  }

  process.stderr.write(
    `[aur] DONE total=${all.length} kept=${kept.length} upserted=${upserted} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s${DRY_RUN ? ' (DRY_RUN)' : ''}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
