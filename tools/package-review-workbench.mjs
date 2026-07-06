#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY_FILE = resolve(ROOT, 'apps/web/src/lib/categories.ts');
const DEFAULT_LIMIT = 25;
const DEFAULT_RULESET = 'didactic-10-10-profile-2026-05-27';

const VALID_LAUNCH_KINDS = new Set(['desktop-id', 'command', 'flatpak-id', 'service', 'url', 'none']);
const VALID_LAUNCH_CONFIDENCE = new Set(['official', 'detected', 'probable', 'unknown', 'high', 'medium', 'low', 'none']);
const VALID_LAUNCH_SOURCE = new Set([
  'desktop_file',
  'flatpak_manifest',
  'appstream',
  'pkg_binary',
  'manual_review',
  'heuristic',
  'codex',
  'unknown',
]);

const FILLER_RE = /Install it when this capability is needed directly|provides:|Packaged for the official Manjaro repositories|metadados oficiais não trazem|repositórios oficiais do Manjaro|Empacotado para/i;
const LOW_VALUE_RE = /é um programa que|este programa é|disponibilizado pelos repositórios|consulte a página do projeto|sem atrasos|alta qualidade e sem atrasos|^(open|opens|launch|launches|start|starts|run|runs|show|shows|display|displays)\s+(the\s+)?[\p{L}0-9_.+-]+|^(abre|abra|abrir|inicia|inicie|iniciar|executa|execute|executar|roda|rode|rodar|mostra|mostre|mostrar|exibe|exiba|exibir)\s+((o|a|os|as|um|uma)\s+)?[\p{L}0-9_.+-]+|^(allows|lets)\s+(you\s+)?(to\s+)?(open|launch|start|run|show|display)\s+(the\s+)?[\p{L}0-9_.+-]+|^(permite|deixa)\s+(abrir|iniciar|executar|rodar|mostrar|exibir)\s+((o|a|os|as|um|uma)\s+)?[\p{L}0-9_.+-]+|^(gives|provides)\s+access\s+to\s+(the\s+)?[\p{L}0-9_.+-]+|^(da|dá|fornece)\s+acesso\s+(ao|a|à|aos|às|para)\s+[\p{L}0-9_.+-]+/iu;
const LOW_VALUE_SQL_RE = String.raw`é um programa que|este programa é|disponibilizado pelos repositórios|consulte a página do projeto|sem atrasos|alta qualidade e sem atrasos|^(open|opens|launch|launches|start|starts|run|runs|show|shows|display|displays)[[:space:]]+(the[[:space:]]+)?[[:alnum:]_.+-]+|^(abre|abra|abrir|inicia|inicie|iniciar|executa|execute|executar|roda|rode|rodar|mostra|mostre|mostrar|exibe|exiba|exibir)[[:space:]]+((o|a|os|as|um|uma)[[:space:]]+)?[[:alnum:]_.+-]+|^(allows|lets)[[:space:]]+(you[[:space:]]+)?(to[[:space:]]+)?(open|launch|start|run|show|display)[[:space:]]+(the[[:space:]]+)?[[:alnum:]_.+-]+|^(permite|deixa)[[:space:]]+(abrir|iniciar|executar|rodar|mostrar|exibir)[[:space:]]+((o|a|os|as|um|uma)[[:space:]]+)?[[:alnum:]_.+-]+|^(gives|provides)[[:space:]]+access[[:space:]]+to[[:space:]]+(the[[:space:]]+)?[[:alnum:]_.+-]+|^(da|dá|fornece)[[:space:]]+acesso[[:space:]]+(ao|a|à|aos|às|para)[[:space:]]+[[:alnum:]_.+-]+`;

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
const options = parseArgs(args);

function usage() {
  console.log(`Usage:
  pnpm review:workbench rules
  pnpm review:workbench export --start-id 10092 [--limit 25] [--out /tmp/block.json]
  pnpm review:workbench apply --input /tmp/block.reviewed.json --block V2-S0001-P001-025 [--expect 25] [--dry-run]
  pnpm review:workbench validate --input /tmp/block.reviewed.json [--expect 25]

Review rule:
  Keep official English summaries. Put the effort into didactic English and pt-br descriptions.
  plain_explanation is intentionally cleared unless the product later gives it a distinct UI purpose.`);
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
    if (!next || next.startsWith('--')) out[key] = true;
    else {
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

function asInt(value, name, fallback = undefined) {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be an integer >= 1`);
  return number;
}

function runPsql(psqlArgs, stdin = null) {
  const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', databaseUrl(), ...psqlArgs], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    err += chunk.toString('utf8');
  });
  if (stdin !== null) child.stdin.end(stdin);
  else child.stdin.end();
  return new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`psql exited with ${code}: ${err.trim()}`));
      else resolvePromise(out);
    });
  });
}

async function jsonQuery(sql) {
  const out = await runPsql(['-A', '-t', '-c', sql]);
  return JSON.parse(out.trim() || 'null');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function dollarQuote(value) {
  const text = String(value);
  let tag = '$review$';
  let i = 0;
  while (text.includes(tag)) {
    i += 1;
    tag = `$review_${i}$`;
  }
  return `${tag}${text}${tag}`;
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function asArray(value, field, id) {
  if (!Array.isArray(value)) throw new Error(`package ${id}: ${field} must be an array`);
  return value;
}

function loadCategoryPaths() {
  const body = readFileSync(CATEGORY_FILE, 'utf8');
  const paths = new Set();
  const categoryRe = /slug: '([^']+)',\n\s*labels:[\s\S]*?subcategories: \[([\s\S]*?)\n\s*\],\n\s*\}/g;
  let categoryMatch;
  while ((categoryMatch = categoryRe.exec(body)) !== null) {
    const category = categoryMatch[1];
    for (const subcategoryMatch of categoryMatch[2].matchAll(/slug: '([^']+)'/g)) {
      paths.add(`${category}/${subcategoryMatch[1]}`);
    }
  }
  if (paths.size === 0) throw new Error('could not load category taxonomy');
  return paths;
}

function normalizeRecord(item) {
  const source = item.review && typeof item.review === 'object' ? { package_id: item.package_id, ...item.review } : item;
  const id = Number(source.package_id);
  if (!Number.isInteger(id) || id < 1) throw new Error('package_id must be an integer >= 1');
  const profile = source.profile && typeof source.profile === 'object' ? source.profile : source;
  return {
    package_id: id,
    category: cleanString(source.category ?? source.cat_path),
    pt_summary: cleanString(source.pt_summary),
    en_description: cleanString(source.en_description),
    pt_description: cleanString(source.pt_description),
    age_min: Number(source.age_min),
    component_type: cleanString(profile.component_type),
    interface_kinds: asArray(profile.interface_kinds ?? [], 'interface_kinds', id),
    audience_tags: asArray(profile.audience_tags ?? [], 'audience_tags', id),
    launchable: Boolean(profile.launchable),
    launch_kind: cleanString(profile.launch_kind ?? 'none'),
    launch_id: cleanString(profile.launch_id),
    launch_command: cleanString(profile.launch_command),
    launch_source: cleanString(profile.launch_source ?? 'manual_review'),
    launch_confidence: cleanString(profile.launch_confidence ?? 'probable'),
    keywords: asArray(profile.keywords ?? [], 'keywords', id),
    requires_terminal: Boolean(profile.requires_terminal),
    is_background_service: Boolean(profile.is_background_service),
    is_dependency_only: Boolean(profile.is_dependency_only),
  };
}

export function validateReviewRecords(items, { expect = null, allowOther = false } = {}) {
  if (!Array.isArray(items)) throw new Error('review file must contain a JSON array');
  const records = items.map(normalizeRecord);
  const validCategoryPaths = loadCategoryPaths();
  const errors = [];
  const ids = new Set();

  if (expect !== null && records.length !== expect) {
    errors.push(`expected ${expect} records, got ${records.length}`);
  }

  for (const record of records) {
    const id = record.package_id;
    if (ids.has(id)) errors.push(`package ${id}: duplicate package_id`);
    ids.add(id);

    if (!record.category) errors.push(`package ${id}: category is required`);
    if (record.category && !validCategoryPaths.has(record.category)) {
      errors.push(`package ${id}: category is not in taxonomy: ${record.category}`);
    }
    if (!allowOther && (record.category === 'other' || record.category?.startsWith('other/'))) {
      errors.push(`package ${id}: category must be reviewed, got ${record.category}`);
    }
    if (!record.pt_summary) errors.push(`package ${id}: pt_summary is required`);
    if (record.pt_summary?.endsWith('.')) errors.push(`package ${id}: pt_summary must not end with a period`);
    if (!record.en_description || record.en_description.length < 120) {
      errors.push(`package ${id}: en_description must be didactic and at least 120 characters`);
    }
    if (!record.pt_description || record.pt_description.length < 140) {
      errors.push(`package ${id}: pt_description must be didactic and at least 140 characters`);
    }
    if (record.en_description && (FILLER_RE.test(record.en_description) || LOW_VALUE_RE.test(record.en_description))) {
      errors.push(`package ${id}: en_description contains generic or low-value wording`);
    }
    if (record.pt_description && (FILLER_RE.test(record.pt_description) || LOW_VALUE_RE.test(record.pt_description))) {
      errors.push(`package ${id}: pt_description contains generic or low-value wording`);
    }
    if (!Number.isInteger(record.age_min) || record.age_min < 0 || record.age_min > 18) {
      errors.push(`package ${id}: age_min must be an integer between 0 and 18`);
    }
    if (!record.component_type) errors.push(`package ${id}: component_type is required`);
    if (!record.interface_kinds.length) errors.push(`package ${id}: interface_kinds must not be empty`);
    if (!VALID_LAUNCH_KINDS.has(record.launch_kind)) errors.push(`package ${id}: invalid launch_kind`);
    if (!VALID_LAUNCH_SOURCE.has(record.launch_source)) errors.push(`package ${id}: invalid launch_source`);
    if (!VALID_LAUNCH_CONFIDENCE.has(record.launch_confidence)) {
      errors.push(`package ${id}: invalid launch_confidence`);
    }
    if (record.launch_kind === 'command' && !record.launch_command) {
      errors.push(`package ${id}: launch_command is required when launch_kind is command`);
    }
    if ((record.launch_kind === 'desktop-id' || record.launch_kind === 'flatpak-id' || record.launch_kind === 'service' || record.launch_kind === 'url') && !record.launch_id) {
      errors.push(`package ${id}: launch_id is required when launch_kind is ${record.launch_kind}`);
    }
    if (record.launch_kind === 'none' && (record.launch_command || record.launch_id)) {
      errors.push(`package ${id}: launch_id and launch_command must be empty when launch_kind is none`);
    }
  }

  return { records, errors };
}

async function readReviewFile(path) {
  const body = await readFile(resolve(ROOT, path), 'utf8');
  return JSON.parse(body);
}

async function writeJsonAtomic(path, value) {
  const outPath = resolve(ROOT, path);
  await mkdir(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  const handle = await open(tmpPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, outPath);
}

function exportSql(startId, limit) {
  return `
SELECT coalesce(json_agg(row_to_json(src) ORDER BY package_id), '[]'::json)
FROM (
  SELECT
    p.id AS package_id,
    p.name,
    p.source,
    p.source_id,
    p.cat_path,
    p.upstream_url,
    p.license_spdx,
    p.latest_version_distro,
    om.official_summary,
    om.official_version,
    en.summary AS current_en_summary,
    en.description AS current_en_description,
    pt.summary AS current_pt_summary,
    pt.description AS current_pt_description,
    rc.age_min AS current_age_min,
    jsonb_build_object(
      'component_type', pp.component_type,
      'interface_kinds', coalesce(pp.interface_kinds, '[]'::jsonb),
      'audience_tags', coalesce(pp.audience_tags, '[]'::jsonb),
      'launchable', coalesce(pp.launchable, false),
      'launch_kind', coalesce(pp.launch_kind, 'none'),
      'launch_id', pp.launch_id,
      'launch_command', pp.launch_command,
      'launch_source', coalesce(pp.launch_source, 'manual_review'),
      'launch_confidence', coalesce(pp.launch_confidence, 'probable'),
      'keywords', coalesce(pp.keywords, '[]'::jsonb),
      'requires_terminal', coalesce(pp.requires_terminal, false),
      'is_background_service', coalesce(pp.is_background_service, false),
      'is_dependency_only', coalesce(pp.is_dependency_only, false)
    ) AS current_profile,
    jsonb_build_object(
      'category', p.cat_path,
      'pt_summary', coalesce(pt.summary, ''),
      'en_description', '',
      'pt_description', '',
      'age_min', coalesce(rc.age_min, 0),
      'profile', jsonb_build_object(
        'component_type', coalesce(pp.component_type, ''),
        'interface_kinds', coalesce(pp.interface_kinds, '[]'::jsonb),
        'audience_tags', coalesce(pp.audience_tags, '[]'::jsonb),
        'launchable', coalesce(pp.launchable, false),
        'launch_kind', coalesce(pp.launch_kind, 'none'),
        'launch_id', pp.launch_id,
        'launch_command', pp.launch_command,
        'launch_source', coalesce(pp.launch_source, 'manual_review'),
        'launch_confidence', coalesce(pp.launch_confidence, 'probable'),
        'keywords', coalesce(pp.keywords, '[]'::jsonb),
        'requires_terminal', coalesce(pp.requires_terminal, false),
        'is_background_service', coalesce(pp.is_background_service, false),
        'is_dependency_only', coalesce(pp.is_dependency_only, false)
      )
    ) AS review
  FROM package p
  JOIN package_official_metadata om ON om.package_id = p.id
  LEFT JOIN package_translation en ON en.package_id = p.id AND en.locale = 'en'
  LEFT JOIN package_translation pt ON pt.package_id = p.id AND pt.locale = 'pt-br'
  LEFT JOIN rating_current rc ON rc.package_id = p.id
  LEFT JOIN package_profile pp ON pp.package_id = p.id
  WHERE p.id >= ${sqlLiteral(startId)}
  ORDER BY p.id
  LIMIT ${sqlLiteral(limit)}
) src`;
}

function applySql(records, { block, dryRun }) {
  const payload = dollarQuote(JSON.stringify(records));
  const blockName = block ?? 'manual-review-block';
  return `
BEGIN;

WITH reviewed AS (
  SELECT *
  FROM jsonb_to_recordset(${payload}::jsonb) AS r(
    package_id int,
    category text,
    pt_summary text,
    en_description text,
    pt_description text,
    age_min int,
    component_type text,
    interface_kinds jsonb,
    audience_tags jsonb,
    launchable boolean,
    launch_kind text,
    launch_id text,
    launch_command text,
    launch_source text,
    launch_confidence text,
    keywords jsonb,
    requires_terminal boolean,
    is_background_service boolean,
    is_dependency_only boolean
  )
),
updated_package AS (
  UPDATE package p
  SET cat_path = r.category,
      updated_at = now()
  FROM reviewed r
  WHERE p.id = r.package_id
  RETURNING p.id
),
upsert_en AS (
  INSERT INTO package_translation AS t (
    package_id, locale, summary, description, plain_explanation, translated_by, reviewed_by, status,
    summary_source, description_source, plain_explanation_source, updated_at
  )
  SELECT r.package_id, 'en', om.official_summary, r.en_description, NULL,
         'official+codex', 'codex', 'reviewed',
         'official', 'codex', NULL, now()
  FROM reviewed r
  JOIN package_official_metadata om ON om.package_id = r.package_id
  ON CONFLICT (package_id, locale) DO UPDATE
  SET summary = EXCLUDED.summary,
      description = EXCLUDED.description,
      plain_explanation = NULL,
      translated_by = EXCLUDED.translated_by,
      reviewed_by = EXCLUDED.reviewed_by,
      status = EXCLUDED.status,
      summary_source = EXCLUDED.summary_source,
      description_source = EXCLUDED.description_source,
      plain_explanation_source = NULL,
      updated_at = now()
  RETURNING package_id
),
upsert_pt AS (
  INSERT INTO package_translation AS t (
    package_id, locale, summary, description, plain_explanation, translated_by, reviewed_by, status,
    summary_source, description_source, plain_explanation_source, updated_at
  )
  SELECT r.package_id, 'pt-br', r.pt_summary, r.pt_description, NULL,
         'codex', 'codex', 'reviewed',
         'codex_translation', 'codex', NULL, now()
  FROM reviewed r
  ON CONFLICT (package_id, locale) DO UPDATE
  SET summary = EXCLUDED.summary,
      description = EXCLUDED.description,
      plain_explanation = NULL,
      translated_by = EXCLUDED.translated_by,
      reviewed_by = EXCLUDED.reviewed_by,
      status = EXCLUDED.status,
      summary_source = EXCLUDED.summary_source,
      description_source = EXCLUDED.description_source,
      plain_explanation_source = NULL,
      updated_at = now()
  RETURNING package_id
),
upsert_rating AS (
  INSERT INTO rating_current AS rc (package_id, age_min, dominant_source, oars, computed_at)
  SELECT package_id, age_min, 'codex', '{}'::jsonb, now()
  FROM reviewed
  ON CONFLICT (package_id) DO UPDATE
  SET age_min = EXCLUDED.age_min,
      dominant_source = EXCLUDED.dominant_source,
      oars = EXCLUDED.oars,
      computed_at = now()
  RETURNING package_id
),
upsert_profile AS (
  INSERT INTO package_profile AS pp (
    package_id, component_type, interface_kinds, audience_tags, launchable, launch_kind, launch_id,
    launch_command, launch_source, launch_confidence, provided_binaries, provided_libraries, mime_types,
    keywords, requires_terminal, is_background_service, is_dependency_only, reviewed_by, reviewed_at, updated_at
  )
  SELECT package_id, component_type, interface_kinds, audience_tags, launchable, launch_kind, launch_id,
         launch_command, launch_source, launch_confidence,
         CASE WHEN launch_command IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(launch_command) END,
         '[]'::jsonb, '[]'::jsonb, keywords, requires_terminal, is_background_service, is_dependency_only,
         'codex', now(), now()
  FROM reviewed
  ON CONFLICT (package_id) DO UPDATE
  SET component_type = EXCLUDED.component_type,
      interface_kinds = EXCLUDED.interface_kinds,
      audience_tags = EXCLUDED.audience_tags,
      launchable = EXCLUDED.launchable,
      launch_kind = EXCLUDED.launch_kind,
      launch_id = EXCLUDED.launch_id,
      launch_command = EXCLUDED.launch_command,
      launch_source = EXCLUDED.launch_source,
      launch_confidence = EXCLUDED.launch_confidence,
      provided_binaries = EXCLUDED.provided_binaries,
      provided_libraries = EXCLUDED.provided_libraries,
      mime_types = EXCLUDED.mime_types,
      keywords = EXCLUDED.keywords,
      requires_terminal = EXCLUDED.requires_terminal,
      is_background_service = EXCLUDED.is_background_service,
      is_dependency_only = EXCLUDED.is_dependency_only,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at,
      updated_at = now()
  RETURNING package_id
)
INSERT INTO audit_log (actor, action, entity_type, entity_id, before, after, at)
SELECT 'codex', 'core_quality_rereviewed', 'package', package_id::text, NULL,
       jsonb_build_object('block', ${sqlLiteral(blockName)}, 'ruleset', ${sqlLiteral(DEFAULT_RULESET)}),
       now()
FROM reviewed;

${dryRun ? 'ROLLBACK;' : 'COMMIT;'}`;
}

function validationSql(ids) {
  return `
WITH ids(package_id) AS (
  SELECT unnest(ARRAY[${ids.join(',')}])::int
),
block AS (
  SELECT p.id, p.name, p.cat_path, en.summary AS en_summary, om.official_summary,
         en.description AS en_desc, pt.summary AS pt_summary, pt.description AS pt_desc,
         en.plain_explanation AS en_plain, pt.plain_explanation AS pt_plain,
         rc.age_min, prof.package_id AS prof_id, prof.component_type, prof.interface_kinds,
         prof.launch_kind, prof.launch_command
  FROM ids
  JOIN package p ON p.id = ids.package_id
  JOIN package_official_metadata om ON om.package_id = p.id
  LEFT JOIN package_translation en ON en.package_id = p.id AND en.locale = 'en'
  LEFT JOIN package_translation pt ON pt.package_id = p.id AND pt.locale = 'pt-br'
  LEFT JOIN rating_current rc ON rc.package_id = p.id
  LEFT JOIN package_profile prof ON prof.package_id = p.id
)
SELECT row_to_json(v)
FROM (
  SELECT
    count(*) AS reviewed_count,
    count(prof_id) AS profile_count,
    count(*) FILTER (WHERE coalesce(en_desc,'') = '' OR coalesce(pt_desc,'') = '') AS blank_desc,
    count(*) FILTER (WHERE length(coalesce(en_desc,'')) < 120 OR length(coalesce(pt_desc,'')) < 140) AS short_desc,
    count(*) FILTER (WHERE age_min IS NULL) AS missing_age,
    count(*) FILTER (WHERE en_summary IS DISTINCT FROM official_summary) AS summary_mismatch,
    count(*) FILTER (WHERE cat_path LIKE 'other/%' OR cat_path = 'other' OR cat_path IS NULL) AS other_cat,
    count(*) FILTER (WHERE pt_summary ~ '\\.$') AS pt_summary_final_period,
    count(*) FILTER (WHERE en_desc ~* ${sqlLiteral(FILLER_RE.source)} OR pt_desc ~* ${sqlLiteral(FILLER_RE.source)} OR en_desc ~* ${sqlLiteral(LOW_VALUE_SQL_RE)} OR pt_desc ~* ${sqlLiteral(LOW_VALUE_SQL_RE)}) AS generic_filler,
    count(*) FILTER (WHERE en_plain IS NOT NULL OR pt_plain IS NOT NULL) AS plain_explanation_filled,
    count(*) FILTER (WHERE lower(en_desc) LIKE lower(name) || '%' OR lower(pt_desc) LIKE lower(name) || '%') AS starts_pkg,
    count(*) FILTER (WHERE component_type IS NULL OR interface_kinds IS NULL OR launch_kind IS NULL) AS missing_profile_core
  FROM block
) v`;
}

function failingValidationKeys(result) {
  return Object.entries(result)
    .filter(([key, value]) => key !== 'reviewed_count' && key !== 'profile_count' && Number(value) !== 0)
    .map(([key]) => key);
}

async function exportCommand() {
  const startId = asInt(options['start-id'], '--start-id');
  const limit = asInt(options.limit, '--limit', DEFAULT_LIMIT);
  const out = options.out ? String(options.out) : `/tmp/linux-meta-review-${startId}-${startId + limit - 1}.json`;
  const rows = await jsonQuery(exportSql(startId, limit));
  await writeJsonAtomic(out, rows);
  console.log(`Exported ${rows.length} packages to ${out}`);
}

async function validateCommand({ apply = false } = {}) {
  if (!options.input) throw new Error('--input is required');
  const raw = await readReviewFile(String(options.input));
  const expect = options.expect === undefined ? null : asInt(options.expect, '--expect');
  const { records, errors } = validateReviewRecords(raw, {
    expect,
    allowOther: options['allow-other'] === true,
  });
  if (errors.length) {
    throw new Error(`Review validation failed:\n- ${errors.join('\n- ')}`);
  }

  if (apply) {
    const block = options.block ? String(options.block) : undefined;
    await runPsql(['-c', applySql(records, { block, dryRun: options['dry-run'] === true })]);
    if (options['dry-run'] === true) {
      console.log(`Dry-run applied and rolled back ${records.length} packages`);
      return;
    }
  }

  if (apply || options.db === true) {
    const result = await jsonQuery(validationSql(records.map((record) => record.package_id)));
    const failures = failingValidationKeys(result);
    console.log(JSON.stringify(result, null, 2));
    if (failures.length) throw new Error(`DB validation failed: ${failures.join(', ')}`);
  } else {
    console.log(`Review file validation passed for ${records.length} packages`);
  }
}

function rulesCommand() {
  console.log(`Package review rules (${DEFAULT_RULESET})

1. English summary:
   - Preserve package_official_metadata.official_summary.
   - Do not rewrite with AI prose unless the official identity is demonstrably wrong.

2. pt-br summary:
   - Short, faithful translation of the official summary.
   - No final period.
   - No invented benefit.

3. Descriptions:
   - This is the main quality field.
   - Answer: what is it, what can the user do with it, how is it used, who needs it, what changes after install, and what caution matters.
   - Identify type: app, CLI, service, library, theme, data, plugin, driver, docs, compatibility layer, or metapackage.
   - Prefer plain language for non-technical users.
   - Start with concrete user value, task, visible result, or enabled capability.
   - First sentence must answer why the package matters, not how it launches or what window opens.
   - Never use launch behavior as the user benefit. "Opening the app" is assumed and belongs only in launch fields.
   - If the first draft starts with "opens/launches/starts" or "abre/inicia", rewrite it from the user's goal: create, edit, manage, monitor, convert, protect, connect, automate, diagnose, or configure.
   - Use two short paragraphs by default.
   - For GUI apps, do not lead with opening/starting the app. The launch fields store that. The description must explain the useful screen/workflow.
   - For data/dependency packages, say what concrete files are needed by which app and whether a separate launcher appears.
   - Avoid vague words like "resources", "support files", "data assets", or "runtime behavior" unless immediately explained.
   - Add safety/privacy notes for network services, camera, credentials, cryptography, system administration, offensive security, adult content, public chat, hardware, boot, storage, or destructive operations.
   - Do not start by repeating the package name.
   - Do not start with "opens/launches" or "abre/inicia"; opening an app is obvious.
   - Treat old reviewed rows that start this way as defects to re-review.
   - Do not use "Open/Abra/Abre [name]" as a value statement anywhere in the lead paragraph.
   - Do not hide the same problem behind "allows opening" / "permite abrir"; that still describes launch mechanics, not user value.
   - Do not use "starts/runs/shows/gives access to [app]" as the lead value.
   - Preferred lead: "Creates/edits/manages/converts/monitors/synchronizes [real user object] for [real purpose]."
   - Do not merely restate the summary.
   - Do not add repository, license, upstream, or installation filler.

4. plain_explanation:
   - Keep NULL by default.
   - Only fill later if the product gives it a distinct UI purpose.

5. Metadata:
   - Always review category, recommended age, component type, interface kind, launch hint, terminal/service/dependency flags, audience tags, and keywords.
   - Leave category as other/* only when the package is genuinely ambiguous after review.`);
}

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  if (command === 'rules') {
    rulesCommand();
    return;
  }
  if (command === 'export') {
    await exportCommand();
    return;
  }
  if (command === 'validate') {
    await validateCommand();
    return;
  }
  if (command === 'apply') {
    await validateCommand({ apply: true });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
