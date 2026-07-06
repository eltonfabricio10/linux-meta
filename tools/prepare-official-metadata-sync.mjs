#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const DEFAULT_AUR_META = '/var/lib/pacman/sync/packages-meta-ext-v1.json.gz';
const DEFAULT_OUT = '/tmp/linux-meta-official-sync';

function usage() {
  console.error(`Usage:
  node tools/prepare-official-metadata-sync.mjs [options]

Options:
  --source pacman|aur|all   Source to prepare. Default: all
  --out-dir PATH            Output directory. Default: ${DEFAULT_OUT}
  --aur-meta PATH           AUR metadata JSON.GZ path
  --aur-min-votes N         Include AUR packages with at least N votes. Default: 0
  --limit N                 Optional limit per prepared source

The script writes:
  official-metadata.tsv
  official-metadata-sync.sql

Apply with:
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f official-metadata-sync.sql`);
}

function parseArgs(argv) {
  const args = {
    source: 'all',
    outDir: DEFAULT_OUT,
    aurMeta: DEFAULT_AUR_META,
    aurMinVotes: 0,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[i];
    };
    if (a === '--source') args.source = next();
    else if (a === '--out-dir') args.outDir = next();
    else if (a === '--aur-meta') args.aurMeta = next();
    else if (a === '--aur-min-votes') args.aurMinVotes = Number.parseInt(next(), 10);
    else if (a === '--limit') args.limit = Number.parseInt(next(), 10);
    else if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!['pacman', 'aur', 'all'].includes(args.source)) throw new Error(`Invalid --source: ${args.source}`);
  if (!Number.isFinite(args.aurMinVotes) || args.aurMinVotes < 0) throw new Error(`Invalid --aur-min-votes: ${args.aurMinVotes}`);
  if (args.limit != null && (!Number.isFinite(args.limit) || args.limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);
  return args;
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 220) || 'package';
}

function run(command, args) {
  const res = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${res.stderr}`);
  return res.stdout;
}

function parsePacmanList() {
  return run('pacman', ['-Sl'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [repo, name] = line.split(/\s+/);
      return { repo, name };
    });
}

function parseSizeKb(value) {
  if (!value || value === 'None') return null;
  const match = value.replace(',', '.').match(/^([0-9.]+)\s*(B|KiB|MiB|GiB)$/i);
  if (!match) return null;
  const n = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'b') return Math.round(n / 1024);
  if (unit === 'kib') return Math.round(n);
  if (unit === 'mib') return Math.round(n * 1024);
  if (unit === 'gib') return Math.round(n * 1024 * 1024);
  return null;
}

function pushPacmanField(record, key, value) {
  if (key === 'Repository') record.repo = value;
  else if (key === 'Name') {
    record.name = value;
    record.source_id = `${record.repo}/${value}`;
  } else if (key === 'Version') record.version = value;
  else if (key === 'Description') record.summary = value === 'None' ? null : value;
  else if (key === 'URL') record.url = value === 'None' ? null : value;
  else if (key === 'Licenses') record.license = value === 'None' ? null : value.replace(/\s+/g, ' ').trim();
  else if (key === 'Installed Size') record.install_size_kb = parseSizeKb(value);
  else if (key === 'Depends On') {
    const values = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
    record.raw.depends = values;
    record.raw.DEPENDS = values;
  }
  else if (key === 'Optional Deps') {
    record.raw.optional_deps ??= [];
    if (value && value !== 'None') record.raw.optional_deps.push(value);
    record.raw.OPTDEPENDS = record.raw.optional_deps;
  } else if (key === 'Groups') {
    const values = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
    record.raw.groups = values;
    record.raw.GROUPS = values;
  } else if (key === 'Provides') {
    const values = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
    record.raw.provides = values;
    record.raw.PROVIDES = values;
  } else if (key === 'Conflicts With') {
    const values = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
    record.raw.conflicts = values;
    record.raw.CONFLICTS = values;
  } else if (key === 'Replaces') {
    const values = value === 'None' ? [] : value.split(/\s+/).filter(Boolean);
    record.raw.replaces = values;
    record.raw.REPLACES = values;
  }
  else if (key === 'Architecture') record.raw.arch = value;
  else if (key === 'Packager') record.raw.packager = value;
  else if (key === 'Build Date') record.raw.build_date = value;
}

function parsePacmanInfo(text) {
  const records = [];
  let record = null;
  let lastKey = null;
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) {
      if (record?.name) {
        record.raw.desc = record.summary;
        record.raw.DESC = record.summary;
        record.raw.NAME = record.name;
        record.raw.VERSION = record.version;
        record.raw.URL = record.url;
        record.raw.LICENSE = record.license;
        record.raw.repo = record.repo;
        records.push(record);
      }
      record = null;
      lastKey = null;
      continue;
    }
    if (!record) record = { source: 'manjaro', raw: {} };
    const field = rawLine.match(/^([^:][^:]+?)\s*:\s*(.*)$/);
    if (field) {
      lastKey = field[1].trim();
      pushPacmanField(record, lastKey, field[2].trim());
      continue;
    }
    const continuation = rawLine.match(/^\s+(.+)$/);
    if (continuation && lastKey === 'Optional Deps') {
      pushPacmanField(record, lastKey, continuation[1].trim());
    }
  }
  if (record?.name) {
    record.raw.desc = record.summary;
    record.raw.DESC = record.summary;
    record.raw.NAME = record.name;
    record.raw.VERSION = record.version;
    record.raw.URL = record.url;
    record.raw.LICENSE = record.license;
    record.raw.repo = record.repo;
    records.push(record);
  }
  return records;
}

function extractPacman(limit) {
  const listed = parsePacmanList().slice(0, limit ?? undefined);
  const records = [];
  const batchSize = 200;
  for (let i = 0; i < listed.length; i += batchSize) {
    const batch = listed.slice(i, i + batchSize).map((p) => `${p.repo}/${p.name}`);
    records.push(...parsePacmanInfo(run('pacman', ['-Si', ...batch])));
  }
  return records;
}

function extractAur(path, minVotes, limit) {
  const data = JSON.parse(gunzipSync(readFileSync(path)));
  if (!Array.isArray(data)) throw new Error(`Unexpected AUR metadata shape in ${path}`);
  return data
    .filter((p) => (p.NumVotes ?? 0) >= minVotes)
    .slice(0, limit ?? undefined)
    .map((p) => ({
    source: 'aur',
    source_id: p.Name,
    repo: null,
    name: p.Name,
    summary: p.Description ?? null,
    version: p.Version ?? null,
    url: p.URL ?? null,
    license: Array.isArray(p.License) && p.License.length ? p.License.join(' OR ') : null,
    install_size_kb: null,
    popularity: p.Popularity == null ? null : Math.round(p.Popularity * 100),
    raw: {
      desc: p.Description ?? null,
      description: p.Description ?? null,
      packageBase: p.PackageBase ?? null,
      numVotes: p.NumVotes ?? 0,
      popularity: p.Popularity ?? 0,
      outOfDate: p.OutOfDate ?? null,
      maintainer: p.Maintainer ?? null,
      submitter: p.Submitter ?? null,
      firstSubmitted: p.FirstSubmitted ?? null,
      lastModified: p.LastModified ?? null,
      depends: p.Depends ?? [],
      keywords: p.Keywords ?? [],
      urlPath: p.URLPath ?? null,
    },
  })).filter((p) => p.name);
}

function tsv(value) {
  if (value == null) return '';
  return String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function writeTsv(records, path) {
  const columns = [
    'source', 'source_id', 'repo', 'name', 'summary', 'version', 'url',
    'license', 'install_size_kb', 'popularity', 'raw_json', 'slug', 'extracted_from',
  ];
  const lines = [columns.join('\t')];
  for (const r of records) {
    const row = {
      ...r,
      slug: slugify(r.name),
      raw_json: JSON.stringify(r.raw),
      extracted_from: r.source === 'aur' ? DEFAULT_AUR_META : 'pacman -Si',
    };
    lines.push(columns.map((c) => tsv(row[c])).join('\t'));
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function writeSql(tsvPath, sqlPath) {
  const escapedPath = tsvPath.replace(/'/g, "''");
  writeFileSync(sqlPath, `BEGIN;

CREATE TEMP TABLE official_metadata_sync (
  source text NOT NULL,
  source_id text NOT NULL,
  repo text,
  name text NOT NULL,
  summary text,
  version text,
  url text,
  license text,
  install_size_kb bigint,
  popularity integer,
  raw_json jsonb NOT NULL,
  slug text NOT NULL,
  extracted_from text NOT NULL
);

\\copy official_metadata_sync FROM '${escapedPath}' WITH (FORMAT text, HEADER true, DELIMITER E'\\t', NULL '');

WITH insert_missing_packages AS (
  INSERT INTO package (
    source, source_id, name, slug, upstream_url, license_spdx,
    latest_version_distro, install_size_kb, popularity, raw_metadata,
    updated_at
  )
  SELECT s.source, s.source_id, s.name, s.slug, s.url, s.license,
         s.version, s.install_size_kb, COALESCE(s.popularity, 0), s.raw_json,
         now()
  FROM official_metadata_sync s
  LEFT JOIN package p ON p.source = s.source AND p.source_id = s.source_id
  WHERE p.id IS NULL
  ON CONFLICT (source, source_id) DO NOTHING
  RETURNING id, source, source_id
),
matched AS (
  SELECT p.id AS package_id, s.*
  FROM official_metadata_sync s
  JOIN package p ON p.source = s.source AND p.source_id = s.source_id
  UNION ALL
  SELECT i.id AS package_id, s.*
  FROM official_metadata_sync s
  JOIN insert_missing_packages i ON i.source = s.source AND i.source_id = s.source_id
),
upsert_official AS (
  INSERT INTO package_official_metadata (
    package_id, source, source_id, repo, official_name, official_summary,
    official_version, official_url, official_license, install_size_kb,
    popularity, raw_metadata, extracted_from, extracted_at
  )
  SELECT package_id, source, source_id, repo, name, summary, version, url,
         license, install_size_kb, popularity, raw_json, extracted_from, now()
  FROM matched
  ON CONFLICT (package_id) DO UPDATE
  SET source = excluded.source,
      source_id = excluded.source_id,
      repo = excluded.repo,
      official_name = excluded.official_name,
      official_summary = excluded.official_summary,
      official_version = excluded.official_version,
      official_url = excluded.official_url,
      official_license = excluded.official_license,
      install_size_kb = excluded.install_size_kb,
      popularity = excluded.popularity,
      raw_metadata = excluded.raw_metadata,
      extracted_from = excluded.extracted_from,
      extracted_at = now()
  RETURNING package_id
),
update_package AS (
  UPDATE package p
  SET name = m.name,
      upstream_url = m.url,
      license_spdx = m.license,
      latest_version_distro = m.version,
      install_size_kb = COALESCE(m.install_size_kb, p.install_size_kb),
      popularity = COALESCE(m.popularity, p.popularity),
      raw_metadata = m.raw_json,
      updated_at = now()
  FROM matched m
  WHERE p.id = m.package_id
  RETURNING p.id
),
insert_missing_en AS (
  INSERT INTO package_translation (
    package_id, locale, summary, summary_source, translated_by, status, updated_at
  )
  SELECT package_id, 'en', summary, 'upstream', 'upstream', 'official', now()
  FROM matched
  WHERE summary IS NOT NULL
  ON CONFLICT (package_id, locale) DO NOTHING
  RETURNING package_id
),
update_existing_en AS (
  UPDATE package_translation t
  SET summary = m.summary,
      summary_source = 'upstream',
      updated_at = now()
  FROM matched m
  WHERE t.package_id = m.package_id
    AND t.locale = 'en'
    AND m.summary IS NOT NULL
    AND (
      t.summary IS DISTINCT FROM m.summary
      OR t.summary_source IS DISTINCT FROM 'upstream'
    )
  RETURNING t.package_id
)
INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after)
SELECT 'codex', 'sync_official_package_metadata', 'package_official_metadata', NULL, NULL,
       jsonb_build_object(
         'prepared_tsv', '${escapedPath}',
         'input_rows', (SELECT count(*) FROM official_metadata_sync),
         'packages_inserted', (SELECT count(*) FROM insert_missing_packages),
         'matched_packages', (SELECT count(*) FROM matched),
         'official_rows_upserted', (SELECT count(*) FROM upsert_official),
         'packages_updated', (SELECT count(*) FROM update_package),
         'en_summaries_inserted', (SELECT count(*) FROM insert_missing_en),
         'en_summaries_updated', (SELECT count(*) FROM update_existing_en)
       );

COMMIT;
`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });
  const records = [];
  if (args.source === 'pacman' || args.source === 'all') records.push(...extractPacman(args.limit));
  if (args.source === 'aur' || args.source === 'all') records.push(...extractAur(args.aurMeta, args.aurMinVotes, args.limit));
  const tsvPath = join(args.outDir, 'official-metadata.tsv');
  const sqlPath = join(args.outDir, 'official-metadata-sync.sql');
  writeTsv(records, tsvPath);
  writeSql(tsvPath, sqlPath);
  console.error(JSON.stringify({ records: records.length, tsvPath, sqlPath }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  usage();
  process.exit(1);
}
