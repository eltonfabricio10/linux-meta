/* Generalized importer for all locales in /home/bruno/elton/locale-pkgs/.
 *
 * For each locale: load appstream-extra-<L>.json + flathub-<L>.json + flatpak/pacman/snap/aur
 * <REGIONAL>.txt files, merge in priority order, and insert ON CONFLICT DO NOTHING
 * into package_translation with translated_by='ai_legacy_locale_pkgs', status='draft'.
 *
 * Locale mapping table: source filename → DB locale code (lowercase BCP-47).
 *
 * Env:
 *   ONLY    = comma-sep locales to run (default: all)
 *   DRY_RUN = 1 to skip writes
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const ROOT = '/home/bruno/elton/locale-pkgs';
const TRANSLATED_BY = 'ai_legacy_locale_pkgs';
const BATCH = 1000;
const DRY = process.env.DRY_RUN === '1';
const ONLY = (process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);

type Entry = { summary: string | null; description: string | null };
type Sources = {
  appstreamJson?: string;
  flathubJson?: string;
  flatpakTsv?: string;
  pacmanTsv?: string;
  snapTsv?: string;
  aurTsv?: string;
};

/* Locale → { dbCode, sources }. Skip pt-br (already done in previous run, but
 * idempotent ON CONFLICT keeps it safe to re-include). */
const LOCALES: Record<string, { dbCode: string; sources: Sources }> = {
  'pt-br': { dbCode: 'pt-br', sources: { appstreamJson: 'appstream-extra-pt.json', flathubJson: 'flathub-pt.json', flatpakTsv: 'flatpak_pt_BR.txt', pacmanTsv: 'pacman_pt_BR.txt', snapTsv: 'snap_pt_BR.txt' } },
  'en':    { dbCode: 'en',    sources: { flatpakTsv: 'flatpak_en_US.txt', snapTsv: 'snap_en_US.txt', aurTsv: 'aur_en_US.txt' } },
  'es':    { dbCode: 'es',    sources: { appstreamJson: 'appstream-extra-es.json', flathubJson: 'flathub-es.json', flatpakTsv: 'flatpak_es_ES.txt', snapTsv: 'snap_es_ES.txt', aurTsv: 'aur_es_ES.txt' } },
  'de':    { dbCode: 'de',    sources: { appstreamJson: 'appstream-extra-de.json', flathubJson: 'flathub-de.json', flatpakTsv: 'flatpak_de_DE.txt', snapTsv: 'snap_de_DE.txt', aurTsv: 'aur_de_DE.txt' } },
  'fr':    { dbCode: 'fr',    sources: { appstreamJson: 'appstream-extra-fr.json', flathubJson: 'flathub-fr.json', flatpakTsv: 'flatpak_fr_FR.txt', snapTsv: 'snap_fr_FR.txt', aurTsv: 'aur_fr_FR.txt' } },
  'it':    { dbCode: 'it',    sources: { appstreamJson: 'appstream-extra-it.json', flathubJson: 'flathub-it.json', flatpakTsv: 'flatpak_it_IT.txt', snapTsv: 'snap_it_IT.txt', aurTsv: 'aur_it_IT.txt' } },
  'nl':    { dbCode: 'nl',    sources: { appstreamJson: 'appstream-extra-nl.json', flathubJson: 'flathub-nl.json', flatpakTsv: 'flatpak_nl_NL.txt', snapTsv: 'snap_nl_NL.txt', aurTsv: 'aur_nl_NL.txt' } },
  'ru':    { dbCode: 'ru',    sources: { appstreamJson: 'appstream-extra-ru.json', flathubJson: 'flathub-ru.json', flatpakTsv: 'flatpak_ru_RU.txt', snapTsv: 'snap_ru_RU.txt' } },
  'pl':    { dbCode: 'pl',    sources: { appstreamJson: 'appstream-extra-pl.json', flathubJson: 'flathub-pl.json', flatpakTsv: 'flatpak_pl_PL.txt', snapTsv: 'snap_pl_PL.txt' } },
  'cs':    { dbCode: 'cs',    sources: { appstreamJson: 'appstream-extra-cs.json', flathubJson: 'flathub-cs.json', flatpakTsv: 'flatpak_cs_CZ.txt', snapTsv: 'snap_cs_CZ.txt', aurTsv: 'aur_cs_CZ.txt' } },
  'da':    { dbCode: 'da',    sources: { appstreamJson: 'appstream-extra-da.json', flathubJson: 'flathub-da.json', flatpakTsv: 'flatpak_da_DK.txt', snapTsv: 'snap_da_DK.txt', aurTsv: 'aur_da_DK.txt' } },
  'fi':    { dbCode: 'fi',    sources: { appstreamJson: 'appstream-extra-fi.json', flathubJson: 'flathub-fi.json', flatpakTsv: 'flatpak_fi_FI.txt', snapTsv: 'snap_fi_FI.txt', aurTsv: 'aur_fi_FI.txt' } },
  'sv':    { dbCode: 'sv',    sources: { appstreamJson: 'appstream-extra-sv.json', flathubJson: 'flathub-sv.json', flatpakTsv: 'flatpak_sv_SE.txt', snapTsv: 'snap_sv_SE.txt' } },
  'nb':    { dbCode: 'nb',    sources: { appstreamJson: 'appstream-extra-nb.json', flathubJson: 'flathub-nb.json', flatpakTsv: 'flatpak_nb_NO.txt', snapTsv: 'snap_nb_NO.txt' } },
  'hu':    { dbCode: 'hu',    sources: { appstreamJson: 'appstream-extra-hu.json', flathubJson: 'flathub-hu.json', flatpakTsv: 'flatpak_hu_HU.txt', snapTsv: 'snap_hu_HU.txt', aurTsv: 'aur_hu_HU.txt' } },
  'ja':    { dbCode: 'ja',    sources: { appstreamJson: 'appstream-extra-ja.json', flathubJson: 'flathub-ja.json', flatpakTsv: 'flatpak_ja_JP.txt', snapTsv: 'snap_ja_JP.txt', aurTsv: 'aur_ja_JP.txt' } },
  'ko':    { dbCode: 'ko',    sources: { appstreamJson: 'appstream-extra-ko.json', flathubJson: 'flathub-ko.json', flatpakTsv: 'flatpak_ko_KR.txt', snapTsv: 'snap_ko_KR.txt', aurTsv: 'aur_ko_KR.txt' } },
  'zh-cn': { dbCode: 'zh-cn', sources: { appstreamJson: 'appstream-extra-zh_CN.json', flathubJson: 'flathub-zh_CN.json', flatpakTsv: 'flatpak_zh_CN.txt', snapTsv: 'snap_zh_CN.txt', aurTsv: 'aur_zh_CN.txt' } },
  'zh-tw': { dbCode: 'zh-tw', sources: { appstreamJson: 'appstream-extra-zh_TW.json', flathubJson: 'flathub-zh_TW.json', flatpakTsv: 'flatpak_zh_TW.txt', snapTsv: 'snap_zh_TW.txt', aurTsv: 'aur_zh_TW.txt' } },
  'tr':    { dbCode: 'tr',    sources: { appstreamJson: 'appstream-extra-tr.json', flathubJson: 'flathub-tr.json', flatpakTsv: 'flatpak_tr_TR.txt', snapTsv: 'snap_tr_TR.txt' } },
  'uk':    { dbCode: 'uk',    sources: { appstreamJson: 'appstream-extra-uk.json', flathubJson: 'flathub-uk.json', flatpakTsv: 'flatpak_uk_UA.txt', snapTsv: 'snap_uk_UA.txt' } },
  'ro':    { dbCode: 'ro',    sources: { appstreamJson: 'appstream-extra-ro.json', flathubJson: 'flathub-ro.json', flatpakTsv: 'flatpak_ro_RO.txt', snapTsv: 'snap_ro_RO.txt' } },
  'sk':    { dbCode: 'sk',    sources: { appstreamJson: 'appstream-extra-sk.json', flathubJson: 'flathub-sk.json', flatpakTsv: 'flatpak_sk_SK.txt', snapTsv: 'snap_sk_SK.txt' } },
  'sl':    { dbCode: 'sl',    sources: { appstreamJson: 'appstream-extra-sl.json', flathubJson: 'flathub-sl.json', flatpakTsv: 'flatpak_sl_SI.txt', snapTsv: 'snap_sl_SI.txt' } },
  'hr':    { dbCode: 'hr',    sources: { appstreamJson: 'appstream-extra-hr.json', flathubJson: 'flathub-hr.json', flatpakTsv: 'flatpak_hr_HR.txt', snapTsv: 'snap_hr_HR.txt', aurTsv: 'aur_hr_HR.txt' } },
  'bg':    { dbCode: 'bg',    sources: { appstreamJson: 'appstream-extra-bg.json', flathubJson: 'flathub-bg.json', flatpakTsv: 'flatpak_bg_BG.txt', snapTsv: 'snap_bg_BG.txt', aurTsv: 'aur_bg_BG.txt' } },
  'el':    { dbCode: 'el',    sources: { appstreamJson: 'appstream-extra-el.json', flathubJson: 'flathub-el.json', flatpakTsv: 'flatpak_el_GR.txt', snapTsv: 'snap_el_GR.txt', aurTsv: 'aur_el_GR.txt' } },
  'he':    { dbCode: 'he',    sources: { appstreamJson: 'appstream-extra-he.json', flathubJson: 'flathub-he.json', flatpakTsv: 'flatpak_he_IL.txt', snapTsv: 'snap_he_IL.txt', aurTsv: 'aur_he_IL.txt' } },
  'is':    { dbCode: 'is',    sources: { appstreamJson: 'appstream-extra-is.json', flathubJson: 'flathub-is.json', flatpakTsv: 'flatpak_is_IS.txt', snapTsv: 'snap_is_IS.txt', aurTsv: 'aur_is_IS.txt' } },
  'et':    { dbCode: 'et',    sources: { appstreamJson: 'appstream-extra-et.json', flathubJson: 'flathub-et.json', flatpakTsv: 'flatpak_et_EE.txt', snapTsv: 'snap_et_EE.txt', aurTsv: 'aur_et_EE.txt' } },
  'be':    { dbCode: 'be',    sources: { appstreamJson: 'appstream-extra-be.json', flathubJson: 'flathub-be.json', flatpakTsv: 'flatpak_be_BY.txt', snapTsv: 'snap_be_BY.txt', aurTsv: 'aur_be_BY.txt' } },
  'ar':    { dbCode: 'ar',    sources: { appstreamJson: 'appstream-extra-ar.json', flathubJson: 'flathub-ar.json' } },
  'bn':    { dbCode: 'bn',    sources: { appstreamJson: 'appstream-extra-bn.json', flathubJson: 'flathub-bn.json' } },
  'hi':    { dbCode: 'hi',    sources: { appstreamJson: 'appstream-extra-hi.json', flathubJson: 'flathub-hi.json' } },
  'id':    { dbCode: 'id',    sources: { appstreamJson: 'appstream-extra-id.json', flathubJson: 'flathub-id.json' } },
  'mr':    { dbCode: 'mr',    sources: { appstreamJson: 'appstream-extra-mr.json', flathubJson: 'flathub-mr.json' } },
  'sw':    { dbCode: 'sw',    sources: { appstreamJson: 'appstream-extra-sw.json', flathubJson: 'flathub-sw.json' } },
  'te':    { dbCode: 'te',    sources: { appstreamJson: 'appstream-extra-te.json', flathubJson: 'flathub-te.json' } },
};

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?\s*p\s*>/gi, '\n\n')
    .replace(/<\s*li\s*>/gi, '\n• ')
    .replace(/<\s*\/?\s*(ul|ol|li|em|strong|i|b|code|span|div)\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > 0 ? t : null;
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

function junky(name: string, summary: string | null, desc: string | null): boolean {
  if (!summary && !desc) return true;
  const big = ((summary ?? '') + ' ' + (desc ?? '')).trim().toLowerCase();
  if (big.length < 8) return true;
  if (big === name.toLowerCase()) return true;
  return false;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function loadTsv(path: string): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  if (!await fileExists(path)) return m;
  const txt = await readFile(path, 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const name = line.slice(0, tab).trim().toLowerCase();
    const summary = clean(line.slice(tab + 1));
    if (!name || !summary) continue;
    if (!m.has(name)) m.set(name, { summary, description: null });
  }
  return m;
}

async function loadJsonAppstream(path: string): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  if (!await fileExists(path)) return m;
  const arr = JSON.parse(await readFile(path, 'utf8')) as Array<{ pkgname?: string; summary?: string; description?: string }>;
  for (const e of arr) {
    const name = (e.pkgname ?? '').trim().toLowerCase();
    if (!name) continue;
    const summary = clean(e.summary);
    const description = stripHtml(e.description);
    if (!summary && !description) continue;
    const prev = m.get(name);
    const curScore = (summary ? 1 : 0) + (description ? 2 : 0);
    const prevScore = prev ? ((prev.summary ? 1 : 0) + (prev.description ? 2 : 0)) : -1;
    if (curScore > prevScore) m.set(name, { summary, description });
  }
  return m;
}

async function loadJsonFlathub(path: string): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  if (!await fileExists(path)) return m;
  const arr = JSON.parse(await readFile(path, 'utf8')) as Array<{ id?: string; name?: string; description?: string }>;
  for (const e of arr) {
    const name = (e.id ?? '').trim().toLowerCase();
    if (!name) continue;
    const description = stripHtml(e.description);
    const summary = clean(e.name);
    if (!summary && !description) continue;
    m.set(name, { summary, description });
  }
  return m;
}

function mergeInto(target: Map<string, Entry>, src: Map<string, Entry>): void {
  for (const [k, v] of src) {
    const prev = target.get(k);
    if (!prev) { target.set(k, v); continue; }
    const prevHasDesc = !!prev.description;
    const vHasDesc = !!v.description;
    if (!prevHasDesc && vHasDesc) target.set(k, { summary: prev.summary ?? v.summary, description: v.description });
    else if (prevHasDesc && !prev.summary && v.summary) target.set(k, { summary: v.summary, description: prev.description });
  }
}

async function buildMerged(srcs: Sources): Promise<Map<string, Entry>> {
  const merged = new Map<string, Entry>();
  if (srcs.appstreamJson) mergeInto(merged, await loadJsonAppstream(join(ROOT, srcs.appstreamJson)));
  if (srcs.flathubJson)   mergeInto(merged, await loadJsonFlathub(join(ROOT, srcs.flathubJson)));
  if (srcs.flatpakTsv)    mergeInto(merged, await loadTsv(join(ROOT, srcs.flatpakTsv)));
  if (srcs.pacmanTsv)     mergeInto(merged, await loadTsv(join(ROOT, srcs.pacmanTsv)));
  if (srcs.snapTsv)       mergeInto(merged, await loadTsv(join(ROOT, srcs.snapTsv)));
  if (srcs.aurTsv)        mergeInto(merged, await loadTsv(join(ROOT, srcs.aurTsv)));
  return merged;
}

async function importLocale(loc: string, dbCode: string, srcs: Sources): Promise<{ matched: number; inserted: number }> {
  const merged = await buildMerged(srcs);
  if (merged.size === 0) {
    process.stderr.write(`[${loc}] no source data; skipping\n`);
    return { matched: 0, inserted: 0 };
  }

  /* For multi-locale: missing means missing for THIS db code (not pt fallback). */
  const missing = await db.execute<{ id: number; name: string; source: string; source_id: string }>(sql`
    SELECT p.id, p.name, p.source, p.source_id
    FROM package p
    LEFT JOIN package_translation t
      ON t.package_id=p.id AND t.locale = ${dbCode} AND COALESCE(t.summary,t.description) IS NOT NULL
    WHERE t.package_id IS NULL
  `);

  let matched = 0, srcIdMatched = 0, junk = 0;
  const rows: Array<{ packageId: number; locale: string; summary: string | null; description: string | null; translatedBy: string; status: 'draft' }> = [];
  for (const row of missing) {
    const name = row.name.toLowerCase();
    let e = merged.get(name);
    if (!e && row.source === 'flathub' && row.source_id) {
      e = merged.get(row.source_id.toLowerCase());
      if (e) srcIdMatched++;
    }
    if (!e) continue;
    if (junky(name, e.summary, e.description)) { junk++; continue; }
    matched++;
    rows.push({ packageId: row.id, locale: dbCode, summary: e.summary, description: e.description, translatedBy: TRANSLATED_BY, status: 'draft' });
  }
  process.stderr.write(`[${loc}] merged=${merged.size} missing=${missing.length} matched=${matched} (via src_id=${srcIdMatched}) junk=${junk}\n`);

  if (DRY) return { matched, inserted: 0 };

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db
      .insert(schema.packageTranslation)
      .values(chunk)
      .onConflictDoNothing({ target: [schema.packageTranslation.packageId, schema.packageTranslation.locale] });
    inserted += chunk.length;
  }
  return { matched, inserted };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const locales = ONLY.length ? ONLY : Object.keys(LOCALES);
  process.stderr.write(`[locale-pkgs-all] locales: ${locales.join(', ')}\n`);

  const summary: Array<{ loc: string; matched: number; inserted: number }> = [];
  for (const loc of locales) {
    const cfg = LOCALES[loc];
    if (!cfg) { process.stderr.write(`[${loc}] no config; skipping\n`); continue; }
    const r = await importLocale(loc, cfg.dbCode, cfg.sources);
    summary.push({ loc, ...r });
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'import_locale_pkgs_all',
    entityType: 'translation',
    after: { translated_by: TRANSLATED_BY, summary, duration_ms: Date.now() - t0 },
  });

  process.stderr.write(`[locale-pkgs-all] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  process.stderr.write(`[locale-pkgs-all] totals:\n`);
  let totalIns = 0;
  for (const s of summary) { process.stderr.write(`  ${s.loc}: matched=${s.matched} inserted=${s.inserted}\n`); totalIns += s.inserted; }
  process.stderr.write(`  TOTAL inserted/attempted: ${totalIns}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
