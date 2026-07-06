#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_MD = resolve(ROOT, 'REVIEW.md');
const BATCH_SIZE = 500;
const BASELINE_LOCALE = 'pt-br';
const BASELINE_IDS = [
  222, 820, 859, 1009, 1127, 1446, 1522, 1994, 2650, 2668, 2725, 3229, 3676,
  3700, 3757, 4718, 7221, 7298, 7325, 7329, 7635, 8643, 8695, 8734, 9079,
  9152, 9187, 9306, 10115, 11678, 11959, 12117, 12762, 14096, 14572, 15156,
  15493, 15664, 18725, 19149, 19170, 19877, 20376, 20398, 20534, 20583, 20587,
  20637, 20645, 20786, 20803, 21076, 21542, 21602, 22041, 22078, 22146, 22367,
  22516, 22908, 23131, 23235, 23261, 23392, 23453, 23665, 23975, 24711, 25666,
  25713, 25767, 25864, 25886, 25913, 25932, 25984, 26054, 26232, 26268, 26353,
  26378, 26491, 27418, 27439, 27538, 27552, 27611, 27681, 27685, 27923, 28020,
  28135, 28152, 28201, 28252, 28262, 28279, 28291, 28306, 28489,
];

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function usage() {
  console.log(`Usage:
  pnpm review summary
  pnpm review blocks [--limit 20] [--offset 0] [--json]
  pnpm review export --block 1 [--format csv|jsonl] [--out path]
  pnpm review core-summary
  pnpm review core-blocks [--limit 20] [--offset 0] [--json]
  pnpm review core-export --block 1 [--format csv|jsonl] [--out path]
  pnpm review official-en-summary [--all] [--apply]
  pnpm review official-summary-followup --init
  pnpm review official-summary-followup [--limit 50] [--json] [--all]
  pnpm review core-complete --block 1 --reviewer name --artifact path [--notes text] [--dry-run]
  pnpm review validate-spark --block 1 --input path
  pnpm review apply-spark --block 1 --input path --out-dir /tmp/linux-meta-review-spark [--dry-run]
  pnpm review complete --block 1 --reviewer name --artifact path [--notes text] [--dry-run]

Notes:
  - Uses DATABASE_URL from .env or the current environment.
  - Batch membership is deterministic: locale, package_id.
  - The fixed 100-row baseline sample is excluded from pending batches.`);
}

function parseArgs(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) {
      out._ ??= [];
      out._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = items[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  try {
    const body = readFileSync(envPath, 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function databaseUrl() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set. Copy .env.example to .env or export DATABASE_URL.');
  }
  return process.env.DATABASE_URL;
}

function assertInt(value, name, min = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return number;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function baselineCte() {
  return `
WITH baseline_reviewed(package_id, locale) AS (
  SELECT unnest(ARRAY[${BASELINE_IDS.join(',')}])::int AS package_id,
         ${shellQuote(BASELINE_LOCALE)}::varchar AS locale
),
pending AS (
  SELECT
    t.package_id,
    t.locale,
    p.name,
    p.source,
    p.source_id,
    p.upstream_url,
    p.license_spdx,
    p.latest_version_distro,
    p.popularity,
    p.cat_path,
    coalesce(
      p.raw_metadata->>'desc',
      p.raw_metadata->>'Description',
      p.raw_metadata->>'description'
    ) AS source_description,
    t.summary,
    t.description,
    t.plain_explanation,
    t.translated_by,
    t.reviewed_by,
    t.status,
    t.updated_at
  FROM package_translation t
  JOIN package p ON p.id = t.package_id
  LEFT JOIN baseline_reviewed b
    ON b.package_id = t.package_id
   AND b.locale = t.locale
  WHERE b.package_id IS NULL
),
ordered AS (
  SELECT
    *,
    row_number() OVER (ORDER BY locale, package_id) AS row_no
  FROM pending
)`;
}

function blocksCte() {
  return `
${baselineCte()},
blocks AS (
  SELECT
    ((row_no - 1) / ${BATCH_SIZE}) + 1 AS block_no,
    count(*) AS rows,
    count(*) FILTER (WHERE cat_path = 'other/uncategorized') AS category_review_rows,
    (array_agg(locale || '/' || package_id ORDER BY row_no))[1] AS first_key,
    (array_agg(locale || '/' || package_id ORDER BY row_no DESC))[1] AS last_key,
    md5(string_agg(locale || ':' || package_id, ',' ORDER BY row_no)) AS fingerprint
  FROM ordered
  GROUP BY block_no
)`;
}

function blockRowsQuery(blockNo) {
  return `
${baselineCte()}
SELECT
  row_no,
  ((row_no - 1) / ${BATCH_SIZE}) + 1 AS block_no,
  package_id,
  locale,
  name,
  source,
  source_id,
  upstream_url,
  license_spdx,
  latest_version_distro,
  popularity,
  cat_path,
  cat_path = 'other/uncategorized' AS category_review_required,
  source_description,
  summary,
  description,
  plain_explanation,
  translated_by,
  reviewed_by,
  status,
  updated_at
FROM ordered
WHERE ((row_no - 1) / ${BATCH_SIZE}) + 1 = ${blockNo}
ORDER BY row_no`;
}

function coreCte() {
  return `
WITH baseline_reviewed(package_id) AS (
  SELECT unnest(ARRAY[${BASELINE_IDS.join(',')}])::int AS package_id
),
pending_core AS (
  SELECT DISTINCT
    p.id AS package_id,
    p.name,
    p.source,
    p.source_id,
    p.upstream_url,
    p.license_spdx,
    p.latest_version_distro,
    p.popularity,
    p.cat_path,
    coalesce(
      p.raw_metadata->>'desc',
      p.raw_metadata->>'Description',
      p.raw_metadata->>'description'
    ) AS source_description,
    en.summary AS en_summary,
    en.description AS en_description,
    en.plain_explanation AS en_plain_explanation,
    en.translated_by AS en_translated_by,
    en.reviewed_by AS en_reviewed_by,
    en.status AS en_status,
    pt.summary AS ptbr_summary,
    pt.description AS ptbr_description,
    pt.plain_explanation AS ptbr_plain_explanation,
    pt.translated_by AS ptbr_translated_by,
    pt.reviewed_by AS ptbr_reviewed_by,
    pt.status AS ptbr_status
  FROM package p
  JOIN (
    SELECT DISTINCT package_id
    FROM package_translation
    WHERE locale IN ('en', 'pt-br')
  ) scope ON scope.package_id = p.id
  LEFT JOIN package_translation en
    ON en.package_id = p.id
   AND en.locale = 'en'
  LEFT JOIN package_translation pt
    ON pt.package_id = p.id
   AND pt.locale = 'pt-br'
  LEFT JOIN baseline_reviewed b
    ON b.package_id = p.id
  WHERE b.package_id IS NULL
),
core_ordered AS (
  SELECT
    *,
    row_number() OVER (ORDER BY package_id) AS row_no
  FROM pending_core
)`;
}

function coreBlocksCte() {
  return `
${coreCte()},
core_blocks AS (
  SELECT
    ((row_no - 1) / ${BATCH_SIZE}) + 1 AS block_no,
    count(*) AS packages,
    count(*) FILTER (WHERE cat_path = 'other/uncategorized') AS category_review_packages,
    count(*) FILTER (WHERE en_summary IS NOT NULL OR en_description IS NOT NULL OR en_plain_explanation IS NOT NULL) AS packages_with_en,
    count(*) FILTER (WHERE ptbr_summary IS NOT NULL OR ptbr_description IS NOT NULL OR ptbr_plain_explanation IS NOT NULL) AS packages_with_ptbr,
    (array_agg(package_id ORDER BY row_no))[1] AS first_package_id,
    (array_agg(package_id ORDER BY row_no DESC))[1] AS last_package_id,
    md5(string_agg(package_id::text, ',' ORDER BY row_no)) AS fingerprint
  FROM core_ordered
  GROUP BY block_no
)`;
}

function coreBlockRowsQuery(blockNo) {
  return `
${coreCte()}
SELECT
  row_no,
  ((row_no - 1) / ${BATCH_SIZE}) + 1 AS block_no,
  package_id,
  name,
  source,
  source_id,
  upstream_url,
  license_spdx,
  latest_version_distro,
  popularity,
  cat_path,
  cat_path = 'other/uncategorized' AS category_review_required,
  source_description,
  en_summary,
  en_description,
  en_plain_explanation,
  en_translated_by,
  en_reviewed_by,
  en_status,
  ptbr_summary,
  ptbr_description,
  ptbr_plain_explanation,
  ptbr_translated_by,
  ptbr_reviewed_by,
  ptbr_status
FROM core_ordered
WHERE ((row_no - 1) / ${BATCH_SIZE}) + 1 = ${blockNo}
ORDER BY row_no`;
}

function runPsql(argsForPsql, { stdout = 'pipe' } = {}) {
  const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', databaseUrl(), ...argsForPsql], {
    cwd: ROOT,
    stdio: ['ignore', stdout, 'pipe'],
  });

  let out = '';
  let err = '';
  if (child.stdout) child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });

  return new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited with ${code}: ${err.trim()}`));
      } else {
        resolvePromise(out);
      }
    });
  });
}

async function jsonQuery(sql) {
  const out = await runPsql(['-A', '-t', '-c', sql]);
  const text = out.trim();
  return text ? JSON.parse(text) : null;
}

async function summary() {
  const data = await jsonQuery(`
${blocksCte()}
SELECT json_build_object(
  'total_translation_rows', (SELECT count(*) FROM package_translation),
  'baseline_reviewed_rows', ${BASELINE_IDS.length},
  'pending_review_rows', (SELECT count(*) FROM ordered),
  'batch_size', ${BATCH_SIZE},
  'pending_batches', (SELECT count(*) FROM blocks),
  'full_batches', (SELECT count(*) FROM blocks WHERE rows = ${BATCH_SIZE}),
  'final_batch_rows', (SELECT rows FROM blocks ORDER BY block_no DESC LIMIT 1),
  'packages_in_outros', (
    SELECT count(*) FROM package WHERE cat_path = 'other/uncategorized'
  ),
  'pending_rows_tied_to_outros', (
    SELECT count(*) FROM ordered WHERE cat_path = 'other/uncategorized'
  )
)`);

  console.log(`Total translation rows: ${data.total_translation_rows}`);
  console.log(`Baseline reviewed rows: ${data.baseline_reviewed_rows}`);
  console.log(`Pending review rows: ${data.pending_review_rows}`);
  console.log(`Batch size: ${data.batch_size}`);
  console.log(`Pending batches: ${data.pending_batches}`);
  console.log(`Full batches: ${data.full_batches}`);
  console.log(`Final batch rows: ${data.final_batch_rows}`);
  console.log(`Packages in Outros: ${data.packages_in_outros}`);
  console.log(`Pending rows tied to Outros: ${data.pending_rows_tied_to_outros}`);
}

async function blocks(options) {
  const limit = assertInt(options.limit ?? 20, '--limit', 1);
  const offset = assertInt(options.offset ?? 0, '--offset', 0);
  const rows = await jsonQuery(`
${blocksCte()}
SELECT coalesce(json_agg(row_to_json(b)), '[]'::json)
FROM (
  SELECT
    'B' || lpad(block_no::text, 4, '0') AS block,
    block_no,
    rows,
    category_review_rows,
    first_key,
    last_key,
    fingerprint
  FROM blocks
  ORDER BY block_no
  LIMIT ${limit}
  OFFSET ${offset}
) b`);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log('block  rows  Outros  first_key     last_key      fingerprint');
  for (const row of rows) {
    console.log(
      `${row.block.padEnd(6)} ${String(row.rows).padStart(4)}  ` +
      `${String(row.category_review_rows).padStart(6)}  ` +
      `${row.first_key.padEnd(13)} ${row.last_key.padEnd(13)} ${row.fingerprint}`,
    );
  }
}

async function coreSummary() {
  const data = await jsonQuery(`
${coreBlocksCte()}
SELECT json_build_object(
  'total_translation_rows', (SELECT count(*) FROM package_translation),
  'en_rows', (SELECT count(*) FROM package_translation WHERE locale = 'en'),
  'ptbr_rows', (SELECT count(*) FROM package_translation WHERE locale = 'pt-br'),
  'core_package_scope', (
    SELECT count(DISTINCT package_id)
    FROM package_translation
    WHERE locale IN ('en', 'pt-br')
  ),
  'baseline_reviewed_packages', ${BASELINE_IDS.length},
  'pending_core_packages', (SELECT count(*) FROM core_ordered),
  'batch_size_packages', ${BATCH_SIZE},
  'pending_core_batches', (SELECT count(*) FROM core_blocks),
  'full_core_batches', (SELECT count(*) FROM core_blocks WHERE packages = ${BATCH_SIZE}),
  'final_core_batch_packages', (SELECT packages FROM core_blocks ORDER BY block_no DESC LIMIT 1),
  'packages_in_outros', (
    SELECT count(*) FROM package WHERE cat_path = 'other/uncategorized'
  ),
  'pending_core_packages_in_outros', (
    SELECT count(*) FROM core_ordered WHERE cat_path = 'other/uncategorized'
  ),
  'non_core_locale_rows', (
    SELECT count(*) FROM package_translation WHERE locale NOT IN ('en', 'pt-br')
  )
)`);

  console.log(`Total translation rows: ${data.total_translation_rows}`);
  console.log(`en rows: ${data.en_rows}`);
  console.log(`pt-br rows: ${data.ptbr_rows}`);
  console.log(`Core package scope: ${data.core_package_scope}`);
  console.log(`Baseline reviewed packages: ${data.baseline_reviewed_packages}`);
  console.log(`Pending core packages: ${data.pending_core_packages}`);
  console.log(`Batch size: ${data.batch_size_packages} packages`);
  console.log(`Pending core batches: ${data.pending_core_batches}`);
  console.log(`Full core batches: ${data.full_core_batches}`);
  console.log(`Final core batch packages: ${data.final_core_batch_packages}`);
  console.log(`Packages in Outros: ${data.packages_in_outros}`);
  console.log(`Pending core packages in Outros: ${data.pending_core_packages_in_outros}`);
  console.log(`Non-core locale rows for later fanout: ${data.non_core_locale_rows}`);
}

async function coreBlocks(options) {
  const limit = assertInt(options.limit ?? 20, '--limit', 1);
  const offset = assertInt(options.offset ?? 0, '--offset', 0);
  const rows = await jsonQuery(`
${coreBlocksCte()}
SELECT coalesce(json_agg(row_to_json(b)), '[]'::json)
FROM (
  SELECT
    'C' || lpad(block_no::text, 4, '0') AS block,
    block_no,
    packages,
    category_review_packages,
    packages_with_en,
    packages_with_ptbr,
    first_package_id,
    last_package_id,
    fingerprint
  FROM core_blocks
  ORDER BY block_no
  LIMIT ${limit}
  OFFSET ${offset}
) b`);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log('block  pkgs  Outros  en   ptbr  first_id  last_id   fingerprint');
  for (const row of rows) {
    console.log(
      `${row.block.padEnd(6)} ${String(row.packages).padStart(4)}  ` +
      `${String(row.category_review_packages).padStart(6)}  ` +
      `${String(row.packages_with_en).padStart(4)} ` +
      `${String(row.packages_with_ptbr).padStart(5)}  ` +
      `${String(row.first_package_id).padStart(8)}  ` +
      `${String(row.last_package_id).padStart(7)}  ${row.fingerprint}`,
    );
  }
}

function officialSummarySql({ all = false } = {}) {
  const scope = all
    ? ''
    : "  WHERE t.translated_by = 'ai_codex_manual_review'\n";
  return `
WITH candidates AS (
  SELECT
    p.id AS package_id,
    p.name,
    p.source,
    t.summary AS current_summary,
    coalesce(
      nullif(btrim(p.raw_metadata->>'desc'), ''),
      nullif(btrim(p.raw_metadata->>'Description'), ''),
      nullif(btrim(p.raw_metadata->>'description'), ''),
      nullif(btrim(p.raw_metadata->>'pkgdesc'), '')
    ) AS official_summary
  FROM package p
  JOIN package_translation t
    ON t.package_id = p.id
   AND t.locale = 'en'
${scope}
),
changed AS (
  SELECT *
  FROM candidates
  WHERE official_summary IS NOT NULL
    AND current_summary IS DISTINCT FROM official_summary
)`;
}

async function officialEnSummary(options) {
  const all = options.all === true;
  const data = await jsonQuery(`
${officialSummarySql({ all })}
SELECT json_build_object(
  'scope', ${sqlLiteral(all ? 'all_en_rows' : 'ai_codex_manual_review')},
  'candidate_en_rows', (SELECT count(*) FROM candidates),
  'with_official_summary', (
    SELECT count(*) FROM candidates WHERE official_summary IS NOT NULL
  ),
  'changed_rows', (SELECT count(*) FROM changed),
  'missing_official_summary', (
    SELECT count(*) FROM candidates WHERE official_summary IS NULL
  ),
  'sample', (
    SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
    FROM (
      SELECT package_id, name, source, current_summary, official_summary
      FROM changed
      ORDER BY package_id
      LIMIT 20
    ) s
  )
)`);

  console.log(JSON.stringify(data, null, 2));

  if (!options.apply) return;

  await runPsql(['-c', `
BEGIN;

${officialSummarySql({ all })}
UPDATE package_translation t
SET summary = changed.official_summary,
    updated_at = now()
FROM changed
WHERE t.package_id = changed.package_id
  AND t.locale = 'en';

COMMIT;
`]);

  const after = await jsonQuery(`
${officialSummarySql({ all })}
SELECT json_build_object(
  'remaining_changed_rows', (SELECT count(*) FROM changed),
  'candidate_en_rows', (SELECT count(*) FROM candidates),
  'with_official_summary', (
    SELECT count(*) FROM candidates WHERE official_summary IS NOT NULL
  )
)`);
  console.log(JSON.stringify(after, null, 2));
}

const OFFICIAL_SUMMARY_RESTORE_TIMESTAMPS = [
  '2026-05-25 21:48:44.903671+00',
  '2026-05-25 21:50:34.724521+00',
];

function officialSummaryFollowupScopeSql() {
  return `
WITH restored AS (
  SELECT
    t.package_id,
    t.updated_at AS en_summary_restored_at
  FROM package_translation t
  WHERE t.locale = 'en'
    AND t.updated_at IN (${OFFICIAL_SUMMARY_RESTORE_TIMESTAMPS.map((ts) => `${sqlLiteral(ts)}::timestamptz`).join(', ')})
)`;
}

async function officialSummaryFollowup(options) {
  const all = options.all === true;
  if (options.init) {
    await runPsql(['-c', `
BEGIN;

${officialSummaryFollowupScopeSql()}
INSERT INTO audit_log (actor, action, entity_type, entity_id, after, at)
SELECT
  'codex',
  'official_summary_followup_required',
  'package',
  restored.package_id::text,
  jsonb_build_object(
    'reason', 'en_summary_restored_from_official_metadata',
    'en_summary_restored_at', restored.en_summary_restored_at
  ),
  now()
FROM restored
WHERE NOT EXISTS (
  SELECT 1
  FROM audit_log a
  WHERE a.action = 'official_summary_followup_required'
    AND a.entity_type = 'package'
    AND a.entity_id = restored.package_id::text
);

COMMIT;
`]);
  }

  const limit = assertInt(options.limit ?? 50, '--limit', 1);
  const scopeJoin = all
    ? ''
    : `JOIN package_translation scope_en
    ON scope_en.package_id = a.entity_id::int
   AND scope_en.locale = 'en'
   AND scope_en.translated_by = 'ai_codex_manual_review'`;
  const rows = await jsonQuery(`
WITH queued AS (
  SELECT DISTINCT a.entity_id::int AS package_id
  FROM audit_log a
  ${scopeJoin}
  WHERE a.action = 'official_summary_followup_required'
    AND a.entity_type = 'package'
    AND NOT EXISTS (
      SELECT 1
      FROM audit_log done
      WHERE done.action = 'official_summary_followup_reviewed'
        AND done.entity_type = 'package'
        AND done.entity_id = a.entity_id
    )
),
ordered AS (
  SELECT package_id, row_number() OVER (ORDER BY package_id) AS queue_no
  FROM queued
)
SELECT coalesce(json_agg(row_to_json(q) ORDER BY q.queue_no), '[]'::json)
FROM (
  SELECT
    ordered.queue_no,
    p.id AS package_id,
    p.name,
    p.source,
    p.source_id,
    p.cat_path,
    en.summary AS en_summary,
    en.description AS en_description,
    en.plain_explanation AS en_plain_explanation,
    pt.summary AS ptbr_summary,
    pt.description AS ptbr_description,
    pt.plain_explanation AS ptbr_plain_explanation
  FROM ordered
  JOIN package p ON p.id = ordered.package_id
  JOIN package_translation en
    ON en.package_id = p.id
   AND en.locale = 'en'
  JOIN package_translation pt
    ON pt.package_id = p.id
   AND pt.locale = 'pt-br'
  ORDER BY ordered.queue_no
  LIMIT ${limit}
) q`);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log('queue package_id name source cat_path');
  for (const row of rows) {
    console.log(`${String(row.queue_no).padStart(5)} ${String(row.package_id).padStart(10)} ${row.name} ${row.source} ${row.cat_path}`);
  }
}

async function coreExportBlock(options) {
  const blockNo = assertInt(options.block, '--block', 1);
  const format = options.format ?? 'csv';
  if (!['csv', 'jsonl'].includes(format)) {
    throw new Error('--format must be csv or jsonl');
  }

  const outPath = resolve(ROOT, options.out ?? `data-review-C${String(blockNo).padStart(4, '0')}.${format}`);
  await mkdir(dirname(outPath), { recursive: true });

  const sql = format === 'csv'
    ? `COPY (${coreBlockRowsQuery(blockNo)}) TO STDOUT WITH CSV HEADER`
    : `COPY (SELECT row_to_json(q)::text FROM (${coreBlockRowsQuery(blockNo)}) q) TO STDOUT`;

  const output = await runPsql(['-c', sql]);
  await atomicWrite(outPath, output);
  console.log(`Exported C${String(blockNo).padStart(4, '0')} to ${outPath}`);
}

async function exportBlock(options) {
  const blockNo = assertInt(options.block, '--block', 1);
  const format = options.format ?? 'csv';
  if (!['csv', 'jsonl'].includes(format)) {
    throw new Error('--format must be csv or jsonl');
  }

  const outPath = resolve(ROOT, options.out ?? `data-review-B${String(blockNo).padStart(4, '0')}.${format}`);
  await mkdir(dirname(outPath), { recursive: true });

  const sql = format === 'csv'
    ? `COPY (${blockRowsQuery(blockNo)}) TO STDOUT WITH CSV HEADER`
    : `COPY (SELECT row_to_json(q)::text FROM (${blockRowsQuery(blockNo)}) q) TO STDOUT`;

  const output = await runPsql(['-c', sql]);
  await atomicWrite(outPath, output);
  console.log(`Exported B${String(blockNo).padStart(4, '0')} to ${outPath}`);
}

async function blockInfo(blockNo) {
  return jsonQuery(`
${blocksCte()}
SELECT row_to_json(b)
FROM (
  SELECT
    'B' || lpad(block_no::text, 4, '0') AS block,
    block_no,
    rows,
    category_review_rows,
    first_key,
    last_key,
    fingerprint
  FROM blocks
  WHERE block_no = ${blockNo}
) b`);
}

async function coreBlockInfo(blockNo) {
  return jsonQuery(`
${coreBlocksCte()}
SELECT row_to_json(b)
FROM (
  SELECT
    'C' || lpad(block_no::text, 4, '0') AS block,
    block_no,
    packages AS rows,
    category_review_packages AS category_review_rows,
    fingerprint
  FROM core_blocks
  WHERE block_no = ${blockNo}
) b`);
}

async function expectedBlockRows(blockNo) {
  return jsonQuery(`
${baselineCte()}
SELECT coalesce(json_agg(row_to_json(q) ORDER BY row_no), '[]'::json)
FROM (${blockRowsQuery(blockNo)}) q`);
}

function readJsonl(path) {
  const text = readFileSync(path, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`);
      }
    });
}

async function validCategories() {
  const rows = await jsonQuery(`
SELECT json_agg(cat_path ORDER BY cat_path)
FROM (SELECT DISTINCT cat_path FROM package WHERE cat_path IS NOT NULL) s`);
  return new Set(rows);
}

const SPARK_KEYS = [
  'package_id',
  'locale',
  'summary',
  'description',
  'plain_explanation',
  'translation_action',
  'translation_confidence',
  'needs_human_review',
  'category_action',
  'category_cat_path',
  'category_confidence',
  'reason',
];

async function validateSparkFile(blockNo, inputPath) {
  const expectedRows = await expectedBlockRows(blockNo);
  const expectedByKey = new Map(expectedRows.map((row) => [`${row.package_id}:${row.locale}`, row]));
  const categories = await validCategories();
  const records = readJsonl(inputPath);
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const forbidden = /BigLinux|reposit[oó]rios oficiais|arquivo oficial do Debian|cat[aá]logo linux-meta|Tradu[cç][aã]o completa em portugu[eê]s ainda n[aã]o dispon[ií]vel|API|lei exige|revisado por humano/i;

  if (records.length !== expectedRows.length) {
    errors.push(`expected ${expectedRows.length} JSONL records, got ${records.length}`);
  }

  for (const [index, record] of records.entries()) {
    const line = index + 1;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`line ${line}: record must be an object`);
      continue;
    }

    const keys = Object.keys(record).sort();
    const expectedKeys = [...SPARK_KEYS].sort();
    if (keys.join('|') !== expectedKeys.join('|')) {
      errors.push(`line ${line}: invalid keys ${keys.join(',')}`);
      continue;
    }

    const key = `${record.package_id}:${record.locale}`;
    const expected = expectedByKey.get(key);
    if (!expected) {
      errors.push(`line ${line}: unexpected key ${key}`);
      continue;
    }
    if (seen.has(key)) errors.push(`line ${line}: duplicate key ${key}`);
    seen.add(key);

    if (!['keep', 'update'].includes(record.translation_action)) {
      errors.push(`line ${line}: invalid translation_action`);
    }
    if (!['keep', 'update', 'human'].includes(record.category_action)) {
      errors.push(`line ${line}: invalid category_action`);
    }
    if (!categories.has(record.category_cat_path)) {
      errors.push(`line ${line}: invalid category_cat_path ${record.category_cat_path}`);
    }
    if (
      (record.category_action === 'keep' || record.category_action === 'human') &&
      record.category_cat_path !== expected.cat_path
    ) {
      errors.push(`line ${line}: ${record.category_action} must keep current cat_path ${expected.cat_path}`);
    }
    if (
      record.category_action === 'update' &&
      record.category_confidence < 0.8
    ) {
      errors.push(`line ${line}: category update requires confidence >= 0.8`);
    }
    for (const field of ['translation_confidence', 'category_confidence']) {
      if (typeof record[field] !== 'number' || record[field] < 0 || record[field] > 1) {
        errors.push(`line ${line}: ${field} must be a number between 0 and 1`);
      }
    }
    if (typeof record.needs_human_review !== 'boolean') {
      errors.push(`line ${line}: needs_human_review must be boolean`);
    }
    for (const field of ['summary', 'description', 'plain_explanation']) {
      if (record[field] !== null && typeof record[field] !== 'string') {
        errors.push(`line ${line}: ${field} must be string or null`);
      }
      if (typeof record[field] === 'string' && forbidden.test(record[field])) {
        warnings.push(`line ${line}: ${field} contains a risky phrase`);
      }
    }
    if (typeof record.reason !== 'string' || record.reason.length > 160) {
      errors.push(`line ${line}: reason must be a string with <=160 chars`);
    }
  }

  for (const key of expectedByKey.keys()) {
    if (!seen.has(key)) errors.push(`missing expected key ${key}`);
  }

  const summary = {
    block: `B${String(blockNo).padStart(4, '0')}`,
    rows: records.length,
    translation_updates: records.filter((r) => r.translation_action === 'update').length,
    needs_human_review: records.filter((r) => r.needs_human_review).length,
    category_updates: records.filter((r) => r.category_action === 'update').length,
    category_human: records.filter((r) => r.category_action === 'human').length,
    low_translation_confidence: records.filter((r) => r.translation_confidence < 0.75).length,
    warnings,
    errors,
  };

  return { summary, records, expectedRows };
}

async function validateSpark(options) {
  const blockNo = assertInt(options.block, '--block', 1);
  const input = resolve(ROOT, String(options.input ?? ''));
  if (!options.input) throw new Error('--input is required');
  const { summary } = await validateSparkFile(blockNo, input);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0) process.exitCode = 1;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function translationValues(records) {
  const safe = records.filter((row) => (
    row.translation_action === 'update' &&
    row.needs_human_review === false &&
    row.translation_confidence >= 0.75
  ));
  return safe.map((row) => `(${[
    Number(row.package_id),
    sqlLiteral(row.locale),
    sqlLiteral(row.summary),
    sqlLiteral(row.description),
    sqlLiteral(row.plain_explanation),
  ].join(', ')})`).join(',\n');
}

function rollbackTranslationValues(records, expectedRows) {
  const safeKeys = new Set(records
    .filter((row) => (
      row.translation_action === 'update' &&
      row.needs_human_review === false &&
      row.translation_confidence >= 0.75
    ))
    .map((row) => `${row.package_id}:${row.locale}`));
  return expectedRows
    .filter((row) => safeKeys.has(`${row.package_id}:${row.locale}`))
    .map((row) => `(${[
    Number(row.package_id),
    sqlLiteral(row.locale),
    sqlLiteral(row.summary),
    sqlLiteral(row.description),
    sqlLiteral(row.plain_explanation),
    sqlLiteral(row.translated_by),
    sqlLiteral(row.reviewed_by),
    sqlLiteral(row.status),
  ].join(', ')})`).join(',\n');
}

function categoryValues(records) {
  const byPackage = new Map();
  for (const row of records) {
    if (row.category_action !== 'update') continue;
    const existing = byPackage.get(row.package_id);
    if (existing && existing !== row.category_cat_path) {
      throw new Error(`conflicting category updates for package_id ${row.package_id}`);
    }
    byPackage.set(row.package_id, row.category_cat_path);
  }
  return [...byPackage.entries()]
    .map(([id, catPath]) => `(${Number(id)}, ${sqlLiteral(catPath)})`)
    .join(',\n');
}

function rollbackCategoryValues(records, expectedRows) {
  const updatedIds = new Set(records.filter((row) => row.category_action === 'update').map((row) => row.package_id));
  const byPackage = new Map(expectedRows.map((row) => [row.package_id, row.cat_path]));
  return [...updatedIds]
    .map((id) => `(${Number(id)}, ${sqlLiteral(byPackage.get(id))})`)
    .join(',\n');
}

function applySql(records) {
  const txValues = translationValues(records);
  const translationSql = txValues
    ? `UPDATE package_translation t
SET summary = v.summary,
    description = v.description,
    plain_explanation = v.plain_explanation,
    translated_by = 'ai_codex_spark',
    reviewed_by = NULL,
    status = 'draft',
    updated_at = now()
FROM (VALUES
${txValues}
) AS v(package_id, locale, summary, description, plain_explanation)
WHERE t.package_id = v.package_id
  AND t.locale = v.locale;`
    : '';
  const catValues = categoryValues(records);
  const categorySql = catValues
    ? `
UPDATE package p
SET cat_path = v.cat_path,
    updated_at = now()
FROM (VALUES
${catValues}
) AS v(package_id, cat_path)
WHERE p.id = v.package_id;`
    : '';

  return `BEGIN;

${translationSql}
${categorySql}

COMMIT;
`;
}

function rollbackSql(records, expectedRows) {
  const txValues = rollbackTranslationValues(records, expectedRows);
  const translationSql = txValues
    ? `UPDATE package_translation t
SET summary = v.summary,
    description = v.description,
    plain_explanation = v.plain_explanation,
    translated_by = v.translated_by,
    reviewed_by = v.reviewed_by,
    status = v.status,
    updated_at = now()
FROM (VALUES
${txValues}
) AS v(package_id, locale, summary, description, plain_explanation, translated_by, reviewed_by, status)
WHERE t.package_id = v.package_id
  AND t.locale = v.locale;`
    : '';
  const catValues = rollbackCategoryValues(records, expectedRows);
  const categorySql = catValues
    ? `
UPDATE package p
SET cat_path = v.cat_path,
    updated_at = now()
FROM (VALUES
${catValues}
) AS v(package_id, cat_path)
WHERE p.id = v.package_id;`
    : '';

  return `BEGIN;

${translationSql}
${categorySql}

COMMIT;
`;
}

async function applySpark(options) {
  const blockNo = assertInt(options.block, '--block', 1);
  const input = resolve(ROOT, String(options.input ?? ''));
  const outDir = resolve(ROOT, String(options['out-dir'] ?? '/tmp/linux-meta-review-spark'));
  if (!options.input) throw new Error('--input is required');

  const { summary, records, expectedRows } = await validateSparkFile(blockNo, input);
  summary.safe_translation_updates = records.filter((row) => (
    row.translation_action === 'update' &&
    row.needs_human_review === false &&
    row.translation_confidence >= 0.75
  )).length;
  summary.applied_category_updates = new Set(records
    .filter((row) => row.category_action === 'update')
    .map((row) => row.package_id)).size;
  await mkdir(outDir, { recursive: true });
  const block = `B${String(blockNo).padStart(4, '0')}`;
  const reportPath = resolve(outDir, `${block}.apply-report.json`);
  const applyPath = resolve(outDir, `${block}.apply.sql`);
  const rollbackPath = resolve(outDir, `${block}.rollback.sql`);

  await atomicWrite(reportPath, JSON.stringify(summary, null, 2) + '\n');
  if (summary.errors.length > 0) {
    console.log(JSON.stringify(summary, null, 2));
    throw new Error(`validation failed; report written to ${reportPath}`);
  }

  await atomicWrite(applyPath, applySql(records));
  await atomicWrite(rollbackPath, rollbackSql(records, expectedRows));

  if (options['dry-run']) {
    console.log(`Dry run OK. Report: ${reportPath}`);
    console.log(`Apply SQL: ${applyPath}`);
    console.log(`Rollback SQL: ${rollbackPath}`);
    return;
  }

  await runPsql(['-f', applyPath], { stdout: 'pipe' });
  console.log(`Applied ${block}. Report: ${reportPath}`);
  console.log(`Rollback SQL: ${rollbackPath}`);
}

async function complete(options, { core = false } = {}) {
  const blockNo = assertInt(options.block, '--block', 1);
  const reviewer = String(options.reviewer ?? '').trim();
  const artifact = String(options.artifact ?? '').trim();
  const notes = String(options.notes ?? '').trim();

  if (!reviewer) throw new Error('--reviewer is required');
  if (!artifact) throw new Error('--artifact is required');
  await access(resolve(ROOT, artifact)).catch(async () => {
    await access(resolve(artifact));
  });

  const info = core ? await coreBlockInfo(blockNo) : await blockInfo(blockNo);
  if (!info) throw new Error(`Block ${blockNo} not found`);

  const date = new Date().toISOString().slice(0, 10);
  const line = [
    `\`${info.block}\``,
    date,
    String(info.rows),
    String(info.category_review_rows),
    escapeCell(reviewer),
    `\`${escapeCell(artifact)}\``,
    `\`${info.fingerprint}\``,
    escapeCell(notes),
  ].join(' | ');

  if (options['dry-run']) {
    console.log(`Would mark ${info.block} complete:`);
    console.log(`| ${line} |`);
    return;
  }

  const body = await readFile(REVIEW_MD, 'utf8');
  const updated = upsertCompletedBlock(body, `| ${line} |`, info.block);
  await atomicWrite(REVIEW_MD, updated);
  console.log(`Marked ${info.block} complete in ${REVIEW_MD}`);
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function upsertCompletedBlock(body, line, block) {
  const markers = [
    '| Block | Date | Packages | `Outros` packages | Reviewer | Correction artifact | Fingerprint | Notes |',
    '| Block | Date | Rows | `Outros` rows | Reviewer | Correction artifact | Fingerprint | Notes |',
  ];
  const header = markers
    .map((marker) => body.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (header < 0) throw new Error('Completed Blocks table not found in REVIEW.md');

  const afterHeader = body.indexOf('\n', header);
  const afterSeparator = body.indexOf('\n', afterHeader + 1);
  if (afterSeparator < 0) throw new Error('Completed Blocks table separator not found');

  const before = body.slice(0, afterSeparator + 1);
  const rest = body.slice(afterSeparator + 1);
  const nextSection = rest.search(/\n## /);
  const tableBody = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
  const suffix = nextSection >= 0 ? rest.slice(nextSection) : '';
  const lines = tableBody.split('\n');
  const blockPrefix = `| \`${block}\` |`;
  const kept = [];
  let inserted = false;

  for (const existing of lines) {
    if (existing.startsWith('| `B') || existing.startsWith('| `C')) {
      if (existing.startsWith(blockPrefix)) {
        if (!inserted) {
          kept.push(line);
          inserted = true;
        }
        continue;
      }
    } else if (!inserted) {
      kept.push(line);
      inserted = true;
    }
    kept.push(existing);
  }

  if (!inserted) kept.push(line);
  return before + kept.join('\n') + suffix;
}

async function atomicWrite(path, content) {
  const dir = dirname(path);
  const tmp = `${path}.tmp-${process.pid}`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
  const dirHandle = await open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

async function main() {
  const options = parseArgs(args);
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
  } else if (command === 'summary') {
    await summary();
  } else if (command === 'blocks') {
    await blocks(options);
  } else if (command === 'export') {
    await exportBlock(options);
  } else if (command === 'core-summary') {
    await coreSummary();
  } else if (command === 'core-blocks') {
    await coreBlocks(options);
  } else if (command === 'core-export') {
    await coreExportBlock(options);
  } else if (command === 'official-en-summary') {
    await officialEnSummary(options);
  } else if (command === 'official-summary-followup') {
    await officialSummaryFollowup(options);
  } else if (command === 'core-complete') {
    await complete(options, { core: true });
  } else if (command === 'validate-spark') {
    await validateSpark(options);
  } else if (command === 'apply-spark') {
    await applySpark(options);
  } else if (command === 'complete') {
    await complete(options);
  } else {
    usage();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
