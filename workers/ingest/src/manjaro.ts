/** Manjaro repository ingestor.
 *  Downloads sync DBs (core/extra/multilib), parses `desc` entries, upserts
 *  rows into `package` keyed by (source, source_id).
 *
 *  Run:
 *    pnpm --filter @linux-meta/ingest manjaro
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract as tarExtract } from 'tar-stream';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { parseDesc, getString, getNumber } from './lib/desc.ts';
import { slugify } from './lib/slug.ts';

const SOURCE = 'manjaro';
const ARCH = 'x86_64';
const BRANCH = process.env.MANJARO_BRANCH ?? 'stable';
const REPOS = (process.env.MANJARO_REPOS ?? 'core,extra,multilib').split(',');
const MIRROR =
  process.env.MANJARO_MIRROR ?? 'https://repo.manjaro.org/repo';

type ParsedPkg = {
  sourceId: string;
  name: string;
  slug: string;
  version: string | null;
  desc: string | null;
  url: string | null;
  license: string | null;
  packager: string | null;
  installSizeKb: number | null;
  buildDate: number | null;
  repo: string;
  raw: Record<string, unknown>;
};

async function* iterRepo(repo: string): AsyncGenerator<ParsedPkg> {
  const url = `${MIRROR}/${BRANCH}/${repo}/${ARCH}/${repo}.db.tar.gz`;
  process.stderr.write(`[manjaro/${repo}] GET ${url}\n`);

  const res = await fetch(url, {
    headers: { 'user-agent': 'linux-meta-ingest/0.0 (+https://example.org)' },
  });
  if (!res.ok || !res.body) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }

  const gunzip = createGunzip();
  const extractor = tarExtract();
  // Async iterator over tar entries.
  const entries = (async function* () {
    for await (const entry of extractor as AsyncIterable<{
      header: { name: string; type: string };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [Symbol.asyncIterator](): AsyncIterator<any>;
      resume(): void;
    }>) {
      yield entry;
    }
  })();

  // Wire pipeline in background; iterate entries in foreground.
  const pump = pipeline(Readable.fromWeb(res.body as never), gunzip, extractor);

  for await (const entry of entries) {
    const { header } = entry;
    if (header.type === 'file' && header.name.endsWith('/desc')) {
      const chunks: Buffer[] = [];
      for await (const c of entry as unknown as AsyncIterable<Buffer>) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      const rec = parseDesc(text);
      const name = getString(rec, 'NAME');
      if (!name) continue;
      yield {
        sourceId: name,
        name,
        slug: slugify(name),
        version: getString(rec, 'VERSION'),
        desc: getString(rec, 'DESC'),
        url: getString(rec, 'URL'),
        license: getString(rec, 'LICENSE'),
        packager: getString(rec, 'PACKAGER'),
        installSizeKb: kb(getNumber(rec, 'ISIZE')),
        buildDate: getNumber(rec, 'BUILDDATE'),
        repo,
        raw: rec as Record<string, unknown>,
      };
    } else {
      entry.resume();
    }
  }

  await pump;
}

function kb(bytes: number | null): number | null {
  return bytes == null ? null : Math.round(bytes / 1024);
}

async function upsertBatch(rows: ParsedPkg[]) {
  if (rows.length === 0) return;
  await db
    .insert(schema.packageTable)
    .values(
      rows.map((p) => ({
        source: SOURCE,
        sourceId: `${p.repo}/${p.sourceId}`,
        name: p.name,
        slug: p.slug,
        upstreamUrl: p.url,
        licenseSpdx: p.license,
        latestVersionDistro: p.version,
        installSizeKb: p.installSizeKb,
        rawMetadata: { repo: p.repo, packager: p.packager, buildDate: p.buildDate, desc: p.desc, ...p.raw },
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.packageTable.source, schema.packageTable.sourceId],
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
        upstreamUrl: sql`excluded.upstream_url`,
        licenseSpdx: sql`excluded.license_spdx`,
        latestVersionDistro: sql`excluded.latest_version_distro`,
        installSizeKb: sql`excluded.install_size_kb`,
        rawMetadata: sql`excluded.raw_metadata`,
        updatedAt: sql`now()`,
      },
    });
}

async function main() {
  const startedAt = Date.now();
  let total = 0;
  let inserted = 0;

  for (const repo of REPOS) {
    const repoStart = Date.now();
    const batch: ParsedPkg[] = [];
    let count = 0;
    for await (const pkg of iterRepo(repo.trim())) {
      batch.push(pkg);
      count++;
      if (batch.length >= 200) {
        await upsertBatch(batch);
        inserted += batch.length;
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await upsertBatch(batch);
      inserted += batch.length;
    }
    total += count;
    process.stderr.write(
      `[manjaro/${repo}] ${count} pkgs in ${((Date.now() - repoStart) / 1000).toFixed(1)}s\n`,
    );
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'ingest_manjaro',
    entityType: 'ingest_run',
    entityId: null,
    after: {
      source: SOURCE,
      branch: BRANCH,
      repos: REPOS,
      total,
      inserted,
      durationMs: Date.now() - startedAt,
    },
  });

  process.stderr.write(
    `[manjaro] DONE total=${total} upserted=${inserted} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
