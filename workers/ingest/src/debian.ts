/** Debian binary Packages ingestor.
 *  Streams Packages.gz per suite, parses RFC822-like paragraphs, upserts as source='debian'.
 *
 *  Run:
 *    pnpm --filter @linux-meta/ingest debian
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { slugify } from './lib/slug.ts';

const SOURCE = 'debian';
const SUITES = (process.env.DEBIAN_SUITES ?? process.env.DEBIAN_SUITE ?? 'stable')
  .split(',').map((s) => s.trim()).filter(Boolean);
const URL_TMPL = process.env.DEBIAN_URL_TMPL ??
  'https://deb.debian.org/debian/dists/<SUITE>/main/binary-amd64/Packages.gz';
const LIMIT = Number(process.env.LIMIT ?? '0');
const DRY_RUN = /^(1|true)$/i.test(process.env.DRY_RUN ?? '');

type Paragraph = Record<string, string>;
type Row = typeof schema.packageTable.$inferInsert;

/** Parse Debian RFC822-like text. Continuation lines start with space; `\n .` → blank line. */
function* parseParagraphs(text: string): Generator<Paragraph> {
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const p: Paragraph = {};
    let key: string | null = null;
    for (const line of block.split('\n')) {
      if (/^[ \t]/.test(line) && key) {
        // continuation: ` .` → blank line, otherwise append with newline
        const cont = line.replace(/^[ \t]/, '');
        p[key] = (p[key] ?? '') + '\n' + (cont === '.' ? '' : cont);
      } else {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        key = line.slice(0, idx);
        p[key] = line.slice(idx + 1).trim();
      }
    }
    yield p;
  }
}

async function fetchSuite(suite: string): Promise<string> {
  const url = URL_TMPL.replace('<SUITE>', suite);
  process.stderr.write(`[debian/${suite}] GET ${url}\n`);
  const res = await fetch(url, {
    headers: { 'user-agent': 'linux-meta-ingest/0.0 (+https://example.org)' },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  Readable.fromWeb(res.body as never).pipe(gunzip);
  for await (const c of gunzip as unknown as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
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
        latestVersionDistro: sql`excluded.latest_version_distro`,
        installSizeKb: sql`excluded.install_size_kb`,
        rawMetadata: sql`excluded.raw_metadata`,
        updatedAt: sql`now()`,
      },
    });
}

async function ingestSuite(suite: string, remaining: number): Promise<{ seen: number; upserted: number }> {
  const text = await fetchSuite(suite);
  process.stderr.write(`[debian/${suite}] downloaded bytes=${text.length}\n`);

  const BATCH = 500;
  let batch: Row[] = [];
  const seenIds = new Set<string>();
  let seen = 0, upserted = 0, stopped = false;

  for (const p of parseParagraphs(text)) {
    const name = p.Package;
    if (!name) continue;
    const sourceId = `${suite}/${name}`;
    if (seenIds.has(sourceId)) continue;
    seenIds.add(sourceId);
    seen++;

    const desc = p.Description ?? '';
    const nl = desc.indexOf('\n');
    const summary = nl < 0 ? desc : desc.slice(0, nl);
    const description = nl < 0 ? null : desc.slice(nl + 1).replace(/^\n+/, '') || null;
    const installSizeKb = p['Installed-Size'] ? Number(p['Installed-Size']) : null;

    batch.push({
      source: SOURCE,
      sourceId,
      name,
      slug: slugify(name),
      upstreamUrl: p.Homepage ?? null,
      licenseSpdx: null,
      latestVersionDistro: p.Version ?? null,
      installSizeKb: Number.isFinite(installSizeKb) ? installSizeKb : null,
      rawMetadata: {
        desc: summary,
        summary,
        description,
        debianSuite: suite,
        architecture: p.Architecture ?? null,
        section: p.Section ?? null,
        maintainer: p.Maintainer ?? null,
        filename: p.Filename ?? null,
      },
      updatedAt: new Date(),
    });

    if (remaining > 0 && seen >= remaining) { stopped = true; }

    if (batch.length >= BATCH) {
      await upsertBatch(batch);
      upserted += batch.length;
      batch = [];
      if (seen % 5000 === 0 || stopped) {
        process.stderr.write(`[debian/${suite}] progress seen=${seen} upserted=${upserted}\n`);
      }
    }
    if (stopped) break;
  }
  if (batch.length > 0) {
    await upsertBatch(batch);
    upserted += batch.length;
  }
  process.stderr.write(`[debian/${suite}] suite done seen=${seen} upserted=${upserted}\n`);
  return { seen, upserted };
}

async function main() {
  const startedAt = Date.now();
  let totalSeen = 0, totalUpserted = 0;
  let remaining = LIMIT > 0 ? LIMIT : 0;

  for (const suite of SUITES) {
    const cap = LIMIT > 0 ? Math.max(0, LIMIT - totalSeen) : 0;
    if (LIMIT > 0 && cap === 0) break;
    const r = await ingestSuite(suite, cap);
    totalSeen += r.seen;
    totalUpserted += r.upserted;
    if (LIMIT > 0) remaining = Math.max(0, LIMIT - totalSeen);
  }

  if (!DRY_RUN) {
    await db.insert(schema.auditLog).values({
      actor: 'system',
      action: 'ingest_debian',
      entityType: 'ingest_run',
      entityId: null,
      after: {
        source: SOURCE,
        suites: SUITES,
        limit: LIMIT,
        seen: totalSeen,
        upserted: totalUpserted,
        durationMs: Date.now() - startedAt,
      },
    });
  }

  process.stderr.write(
    `[debian] DONE suites=${SUITES.join(',')} seen=${totalSeen} upserted=${totalUpserted} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s${DRY_RUN ? ' (DRY_RUN)' : ''}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
