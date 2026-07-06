/* Import legacy PT translations from /mnt/OldRoot/@home/bruno/description/.
 *
 *  Folder layout: <pkg>/pt_BR/{summary,desc}
 *
 *  Provenance: translated_by='ai_legacy_bigaitor', status='draft', locale='pt-br'.
 *  Never overwrites an existing row (ON CONFLICT DO NOTHING).
 *
 *  Cleaning:
 *   - strip <br>, <br/>, <br />, &nbsp;, \r
 *   - collapse runs of whitespace to single space (preserve paragraph breaks)
 *   - trim
 *   - reject obvious junk (empty, < 15 chars summary, < 30 chars desc,
 *     contains literal "lorem ipsum", or just package name)
 *
 *  Env:
 *    ROOT      = source folder root (default /mnt/OldRoot/@home/bruno/description)
 *    LIMIT     = max packages to import (default 0 = all)
 *    DRY_RUN   = if set, no DB writes
 *    BATCH     = insert batch size (default 500)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const ROOT = process.env.ROOT ?? '/mnt/OldRoot/@home/bruno/description';
const LIMIT = Number(process.env.LIMIT ?? 0);
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const BATCH = Math.max(1, Number(process.env.BATCH ?? 500));
const TRANSLATED_BY = 'ai_legacy_bigaitor';
const LOCALE = 'pt-br';

function clean(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeJunk(name: string, summary: string, desc: string): boolean {
  if (!summary && !desc) return true;
  if (summary && summary.length < 15 && !desc) return true;
  if (desc && desc.length < 30 && !summary) return true;
  const lower = (summary + ' ' + desc).toLowerCase();
  if (lower.includes('lorem ipsum')) return true;
  if (lower.includes('description not available')) return true;
  if (lower.includes('descrição não disponível')) return true;
  /* just the package name repeated */
  if (summary && summary.replace(/[^a-z0-9]/gi, '').toLowerCase() === name.replace(/[^a-z0-9]/gi, '').toLowerCase()) return true;
  return false;
}

async function readPair(dir: string): Promise<{ summary: string; desc: string }> {
  let summary = '';
  let desc = '';
  try { summary = clean(await readFile(join(dir, 'summary'), 'utf8')); } catch { /* missing */ }
  try { desc = clean(await readFile(join(dir, 'desc'), 'utf8')); } catch { /* missing */ }
  return { summary, desc };
}

type Row = { packageId: number; locale: string; summary: string | null; description: string | null; translatedBy: string; status: 'draft' };

async function main(): Promise<void> {
  const t0 = Date.now();
  process.stderr.write(`[legacy-pt] scanning ${ROOT}\n`);

  /* 1) names → ids for packages MISSING any pt/pt-br translation. */
  const missingRows = await db.execute<{ id: number; name: string }>(sql`
    SELECT p.id, p.name
    FROM package p
    LEFT JOIN package_translation t
      ON t.package_id = p.id AND t.locale IN ('pt','pt-br')
     AND COALESCE(t.summary, t.description) IS NOT NULL
    WHERE t.package_id IS NULL
  `);
  const wanted = new Map<string, number>();
  for (const r of missingRows) wanted.set(r.name.toLowerCase(), r.id);
  process.stderr.write(`[legacy-pt] DB packages missing pt: ${wanted.size}\n`);

  /* 2) walk folder. */
  const entries = await readdir(ROOT);
  process.stderr.write(`[legacy-pt] folder entries: ${entries.length}\n`);

  let scanned = 0, matched = 0, rejectedJunk = 0, rejectedNotWanted = 0, rejectedNoLocale = 0;
  const rows: Row[] = [];

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (LIMIT > 0 && rows.length >= LIMIT) break;
    scanned++;
    const lower = name.toLowerCase();
    const pkgId = wanted.get(lower);
    if (pkgId == null) { rejectedNotWanted++; continue; }
    const localeDir = join(ROOT, name, 'pt_BR');
    let s;
    try { s = await stat(localeDir); } catch { rejectedNoLocale++; continue; }
    if (!s.isDirectory()) { rejectedNoLocale++; continue; }
    const { summary, desc } = await readPair(localeDir);
    if (looksLikeJunk(name, summary, desc)) { rejectedJunk++; continue; }
    matched++;
    rows.push({
      packageId: pkgId,
      locale: LOCALE,
      summary: summary || null,
      description: desc || null,
      translatedBy: TRANSLATED_BY,
      status: 'draft',
    });
  }

  process.stderr.write(
    `[legacy-pt] scanned=${scanned} matched=${matched} notWanted=${rejectedNotWanted} noLocale=${rejectedNoLocale} junk=${rejectedJunk}\n`,
  );

  if (DRY) {
    process.stderr.write(`[legacy-pt] DRY_RUN — would insert ${rows.length} rows. Sample:\n`);
    for (const r of rows.slice(0, 5)) {
      process.stderr.write(`  id=${r.packageId} sum="${(r.summary ?? '').slice(0, 80)}" desc="${(r.description ?? '').slice(0, 80)}"\n`);
    }
    process.exit(0);
  }

  /* 3) batch insert. */
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await db
      .insert(schema.packageTranslation)
      .values(chunk)
      .onConflictDoNothing({
        target: [schema.packageTranslation.packageId, schema.packageTranslation.locale],
      });
    inserted += chunk.length;
    if ((i / BATCH) % 10 === 0) process.stderr.write(`[legacy-pt] inserted ${inserted}/${rows.length}\n`);
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'import_legacy_pt',
    entityType: 'translation',
    after: {
      source: ROOT,
      translated_by: TRANSLATED_BY,
      locale: LOCALE,
      scanned, matched, rejected_not_wanted: rejectedNotWanted,
      rejected_no_locale: rejectedNoLocale, rejected_junk: rejectedJunk,
      inserted_or_conflicted: inserted,
      duration_ms: Date.now() - t0,
    },
  });

  process.stderr.write(`[legacy-pt] DONE inserted=${inserted} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
