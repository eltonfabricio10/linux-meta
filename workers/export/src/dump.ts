/** Export worker.
 *
 *  Dumps curated subset of DB to JSONL + CSV under OUT_DIR.
 *  Writes manifest.json, CHANGELOG.md, README.md, LICENSE.
 *
 *  Env:
 *    OUT_DIR  = output directory (default /home/bruno/elton/linux-meta/data-export/)
 *    DRY_RUN  = if set, compute counts only, no writes
 *    CHUNK    = page size for streaming (default 5000)
 */

import { mkdir, writeFile, readFile, open, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const OUT_DIR = process.env.OUT_DIR ?? '/home/bruno/elton/linux-meta/data-export/';
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const CHUNK = Math.max(100, Number(process.env.CHUNK ?? 5000));

// ---------- CSV helpers (RFC 4180) ----------

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cols: string[], row: Record<string, unknown>): string {
  return cols.map((c) => csvField(row[c])).join(',') + '\n';
}

function jsonlRow(row: Record<string, unknown>): string {
  // Normalize Date → ISO; keep everything else as-is (snake_case keys from SQL aliases).
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return JSON.stringify(out) + '\n';
}

// ---------- file sink ----------

type Sink = {
  write: (s: string) => Promise<void>;
  close: () => Promise<void>;
  path: string;
};

async function openSink(path: string): Promise<Sink> {
  if (DRY) {
    return {
      write: async () => {},
      close: async () => {},
      path,
    };
  }
  const fh = await open(path, 'w');
  return {
    path,
    write: async (s: string) => { await fh.write(s); },
    close: async () => { await fh.close(); },
  };
}

// ---------- table specs ----------

type TableSpec = {
  name: string;            // file basename
  cols: string[];          // CSV header order; also JSONL key order
  selectSql: ReturnType<typeof sql>;
  partitionBy?: string;    // column to also split into separate files
};

const SPECS: TableSpec[] = [
  {
    name: 'package',
    cols: [
      'id', 'source', 'source_id', 'name', 'slug',
      'upstream_url', 'license_spdx',
      'latest_version_distro', 'latest_version_upstream',
      'icon_url', 'popularity', 'install_size_kb',
      'created_at', 'updated_at',
    ],
    selectSql: sql`
      SELECT id, source, source_id, name, slug, upstream_url, license_spdx,
             latest_version_distro, latest_version_upstream,
             icon_url, popularity, install_size_kb,
             created_at, updated_at
      FROM package
      ORDER BY id
    `,
    partitionBy: 'source',
  },
  {
    name: 'package_translation',
    cols: [
      'package_id', 'locale', 'summary', 'description', 'plain_explanation',
      'translated_by', 'reviewed_by', 'status', 'updated_at',
    ],
    selectSql: sql`
      SELECT package_id, locale, summary, description, plain_explanation,
             translated_by, reviewed_by, status, updated_at
      FROM package_translation
      WHERE status IN ('reviewed','official') OR translated_by = 'upstream'
      ORDER BY package_id, locale
    `,
  },
  {
    name: 'rating_current',
    cols: ['package_id', 'age_min', 'dominant_source', 'oars', 'computed_at'],
    selectSql: sql`
      SELECT package_id, age_min, dominant_source, oars, computed_at
      FROM rating_current
      ORDER BY package_id
    `,
  },
  {
    name: 'rating',
    cols: [
      'id', 'package_id', 'source', 'age_min', 'oars',
      'confidence', 'classifier_version', 'rationale', 'created_at',
    ],
    selectSql: sql`
      SELECT id, package_id, source, age_min, oars,
             confidence, classifier_version, rationale, created_at
      FROM rating
      ORDER BY id
    `,
  },
  {
    name: 'dispute',
    cols: ['id', 'package_id', 'suggested_age', 'reason', 'status', 'created_at', 'resolved_at'],
    selectSql: sql`
      SELECT id, package_id, suggested_age, reason, status, created_at, resolved_at
      FROM dispute
      WHERE status = 'resolved'
      ORDER BY id
    `,
  },
];

// ---------- export driver ----------

type FileStat = { count: number; byteSize: number };

async function exportSpec(spec: TableSpec, outDir: string): Promise<Record<string, FileStat>> {
  const t0 = Date.now();
  const stats: Record<string, FileStat> = {};

  const jsonlPath = join(outDir, `${spec.name}.jsonl`);
  const csvPath = join(outDir, `${spec.name}.csv`);

  const jsonlSink = await openSink(jsonlPath);
  const csvSink = await openSink(csvPath);

  // header
  const header = spec.cols.join(',') + '\n';
  await csvSink.write(header);

  // partition sinks (created lazily)
  const partJsonl = new Map<string, Sink>();
  const partCsv = new Map<string, Sink>();

  const ensurePartition = async (key: string) => {
    if (!spec.partitionBy) return;
    if (partJsonl.has(key)) return;
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const jp = join(outDir, `${spec.name}.${safe}.jsonl`);
    const cp = join(outDir, `${spec.name}.${safe}.csv`);
    const js = await openSink(jp);
    const cs = await openSink(cp);
    await cs.write(header);
    partJsonl.set(key, js);
    partCsv.set(key, cs);
  };

  // size accumulators (DRY too — count bytes we *would* write)
  let mainJsonlBytes = 0;
  let mainCsvBytes = header.length;
  const partBytes = new Map<string, { j: number; c: number; n: number }>();
  let count = 0;

  let offset = 0;
  while (true) {
    const page = await db.execute<Record<string, unknown>>(
      sql`${spec.selectSql} LIMIT ${CHUNK} OFFSET ${offset}`,
    );
    if (page.length === 0) break;
    for (const row of page) {
      const jl = jsonlRow(row);
      const cl = csvRow(spec.cols, row);
      mainJsonlBytes += Buffer.byteLength(jl);
      mainCsvBytes += Buffer.byteLength(cl);
      await jsonlSink.write(jl);
      await csvSink.write(cl);
      count++;

      if (spec.partitionBy) {
        const key = String(row[spec.partitionBy] ?? 'unknown');
        await ensurePartition(key);
        const js = partJsonl.get(key)!;
        const cs = partCsv.get(key)!;
        await js.write(jl);
        await cs.write(cl);
        const pb = partBytes.get(key) ?? { j: 0, c: header.length, n: 0 };
        pb.j += Buffer.byteLength(jl);
        pb.c += Buffer.byteLength(cl);
        pb.n += 1;
        partBytes.set(key, pb);
      }
    }
    if (page.length < CHUNK) break;
    offset += page.length;
  }

  await jsonlSink.close();
  await csvSink.close();
  for (const s of partJsonl.values()) await s.close();
  for (const s of partCsv.values()) await s.close();

  stats[`${spec.name}.jsonl`] = { count, byteSize: mainJsonlBytes };
  stats[`${spec.name}.csv`] = { count, byteSize: mainCsvBytes };
  for (const [k, pb] of partBytes) {
    const safe = k.replace(/[^a-zA-Z0-9_-]/g, '_');
    stats[`${spec.name}.${safe}.jsonl`] = { count: pb.n, byteSize: pb.j };
    stats[`${spec.name}.${safe}.csv`] = { count: pb.n, byteSize: pb.c };
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[export] table=${spec.name} rows=${count} written in ${secs}s\n`);
  return stats;
}

// ---------- manifest + changelog + docs ----------

const README_TEMPLATE = `# linux-meta dataset

Curated, openly-licensed metadata for Linux desktop packages and their
content-rating signals. Generated by \`@linux-meta/export\`.

## Contents

- \`package.{jsonl,csv}\` — package catalog (id, source, slug, upstream URL,
  license, version, popularity, install size). Also partitioned by source
  (e.g. \`package.flathub.csv\`).
- \`package_translation.{jsonl,csv}\` — reviewed/official translations and
  upstream-supplied descriptions (raw AI drafts excluded).
- \`rating.{jsonl,csv}\` — full classification observations per package
  (one row per source: upstream, AI, human reviewer).
- \`rating_current.{jsonl,csv}\` — denormalized effective rating per package.
- \`dispute.{jsonl,csv}\` — resolved rating disputes (no reporter PII).
- \`manifest.json\` — counts, byte sizes, schema version, generation timestamp.
- \`CHANGELOG.md\` — per-export delta of row counts.

## Schema

Columns mirror the Postgres schema in
\`packages/db/src/schema/\` of the linux-meta repo. Field names are
snake_case in both JSONL and CSV.

## License

[CC0 1.0 Universal](./LICENSE) — public domain dedication.

## Consume

\`\`\`bash
# stream JSONL with jq
cat package.jsonl | jq 'select(.popularity > 100) | .name'

# load CSV in Python
import pandas as pd
df = pd.read_csv('package.csv')
\`\`\`
`;

const LICENSE_TEXT = `Creative Commons Legal Code

CC0 1.0 Universal

The person who associated a work with this deed has dedicated the work to
the public domain by waiving all of his or her rights to the work worldwide
under copyright law, including all related and neighboring rights, to the
extent allowed by law.

You can copy, modify, distribute and perform the work, even for commercial
purposes, all without asking permission.

In no way are the patent or trademark rights of any person affected by CC0,
nor are the rights that other persons may have in the work or in how the
work is used, such as publicity or privacy rights.

Unless expressly stated otherwise, the person who associated a work with
this deed makes no warranties about the work, and disclaims liability for
all uses of the work, to the fullest extent permitted by applicable law.

When using or citing the work, you should not imply endorsement by the
author or the affirmer.

For the full legal text see:
https://creativecommons.org/publicdomain/zero/1.0/legalcode
`;

type Manifest = {
  generatedAt: string;
  schemaVersion: string;
  tool: string;
  notes: string[];
  counts: Record<string, number>;
  byteSize: Record<string, number>;
};

async function readPrevManifest(outDir: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(join(outDir, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildChangelogEntry(prev: Manifest | null, curr: Manifest): string {
  const date = todayISODate();
  if (!prev) {
    const lines = [`# ${date} — initial export`, ''];
    for (const k of Object.keys(curr.counts).sort()) {
      lines.push(`- ${k}: ${curr.counts[k]}`);
    }
    lines.push('');
    return lines.join('\n');
  }
  const lines = [`# ${date}`, ''];
  const keys = new Set([...Object.keys(prev.counts), ...Object.keys(curr.counts)]);
  for (const k of Array.from(keys).sort()) {
    const a = prev.counts[k] ?? 0;
    const b = curr.counts[k] ?? 0;
    const diff = b - a;
    const sign = diff > 0 ? `+${diff}` : `${diff}`;
    if (diff !== 0 || prev.counts[k] === undefined) {
      lines.push(`- ${k}: ${sign} (${a} → ${b})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function prependChangelog(outDir: string, entry: string): Promise<void> {
  const path = join(outDir, 'CHANGELOG.md');
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch {}
  await writeFile(path, entry + (existing ? '\n' + existing : ''), 'utf8');
}

// ---------- main ----------

async function main(): Promise<void> {
  const startedAt = Date.now();
  const outDir = resolve(OUT_DIR);

  if (!DRY) await mkdir(outDir, { recursive: true });

  process.stderr.write(`[export] out_dir=${outDir} dry=${DRY} chunk=${CHUNK}\n`);

  const allStats: Record<string, FileStat> = {};
  for (const spec of SPECS) {
    const s = await exportSpec(spec, outDir);
    Object.assign(allStats, s);
  }

  const counts: Record<string, number> = {};
  const byteSize: Record<string, number> = {};
  for (const [k, v] of Object.entries(allStats)) {
    counts[k] = v.count;
    byteSize[k] = v.byteSize;
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0.0',
    tool: 'linux-meta-export',
    notes: [
      'Excludes package.raw_metadata jsonb (noisy upstream blob).',
      'Excludes dispute.reporter_email and dispute.reporter_user_id (PII).',
      'package_translation filtered to status IN (reviewed,official) or translated_by=upstream.',
      'dispute filtered to status=resolved.',
      'CSV is RFC 4180; JSONL uses snake_case keys matching DB columns.',
    ],
    counts,
    byteSize,
  };

  const prev = await readPrevManifest(outDir);

  if (!DRY) {
    await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const entry = buildChangelogEntry(prev, manifest);
    await prependChangelog(outDir, entry);
    await writeFile(join(outDir, 'README.md'), README_TEMPLATE, 'utf8');
    await writeFile(join(outDir, 'LICENSE'), LICENSE_TEXT, 'utf8');

    // refresh manifest byteSize for files we just wrote on-disk if needed.
    // (Optional; in-memory tallies are accurate.)
    void stat;
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'export_dataset',
    entityType: 'export',
    after: {
      outDir,
      dry: DRY,
      durationMs: Date.now() - startedAt,
      counts,
      byteSize,
      schemaVersion: manifest.schemaVersion,
    },
  });

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalBytes = Object.values(byteSize).reduce((a, b) => a + b, 0);
  process.stderr.write(
    `[export] DONE files=${Object.keys(counts).length} rows=${totalRows} bytes=${totalBytes} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
