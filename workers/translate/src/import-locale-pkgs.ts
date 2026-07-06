/* Import PT-BR translations from /home/bruno/elton/locale-pkgs/.
 *
 * Sources (priority order, highest first — written first, others skip via ON CONFLICT):
 *   1. appstream-extra-pt.json   → has summary+description (HTML <p>) — provenance: ai_legacy_locale_pkgs (curated/MT mix)
 *   2. flathub-pt.json           → has description (HTML <p>) for flathub apps — provenance: ai_legacy_locale_pkgs
 *   3. flatpak_pt_BR.txt         → flatpak app-id \t summary — provenance: ai_legacy_locale_pkgs
 *   4. pacman_pt_BR.txt          → pkg \t summary (Arch official repos) — provenance: ai_legacy_locale_pkgs
 *   5. snap_pt_BR.txt            → snap-name \t summary — provenance: ai_legacy_locale_pkgs
 *   6. pt.txt                    → pkg \t summary (largest, mixed) — provenance: ai_legacy_locale_pkgs
 *
 * All marked ai_legacy_locale_pkgs because we can't tell which lines are curated vs MT.
 * status='draft'. ON CONFLICT DO NOTHING — never overwrites existing translation.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';

const ROOT = '/home/bruno/elton/locale-pkgs';
const TRANSLATED_BY = 'ai_legacy_locale_pkgs';
const LOCALE = 'pt-br';
const BATCH = 1000;
const DRY = process.env.DRY_RUN === '1';

type Entry = { name: string; summary: string | null; description: string | null };

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

async function loadTsv(path: string): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  const txt = await readFile(path, 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const name = line.slice(0, tab).trim().toLowerCase();
    const summary = clean(line.slice(tab + 1));
    if (!name || !summary) continue;
    if (!m.has(name)) m.set(name, { name, summary, description: null });
  }
  return m;
}

async function loadJsonAppstream(path: string): Promise<Map<string, Entry>> {
  const m = new Map<string, Entry>();
  const arr = JSON.parse(await readFile(path, 'utf8')) as Array<{ pkgname?: string; summary?: string; description?: string }>;
  for (const e of arr) {
    const name = (e.pkgname ?? '').trim().toLowerCase();
    if (!name) continue;
    const summary = clean(e.summary);
    const description = stripHtml(e.description);
    if (!summary && !description) continue;
    /* If we already have this pkg from another JSON, prefer the one with both fields. */
    const prev = m.get(name);
    const curScore = (summary ? 1 : 0) + (description ? 2 : 0);
    const prevScore = prev ? ((prev.summary ? 1 : 0) + (prev.description ? 2 : 0)) : -1;
    if (curScore > prevScore) m.set(name, { name, summary, description });
  }
  return m;
}

async function loadJsonFlathub(path: string): Promise<Map<string, Entry>> {
  /* Flathub-pt.json has id+name+description but no summary. We treat name as the
   * short label and description as the long form. Match by id only. */
  const m = new Map<string, Entry>();
  const arr = JSON.parse(await readFile(path, 'utf8')) as Array<{ id?: string; name?: string; description?: string }>;
  for (const e of arr) {
    const name = (e.id ?? '').trim().toLowerCase();
    if (!name) continue;
    const description = stripHtml(e.description);
    const summary = clean(e.name);
    if (!summary && !description) continue;
    m.set(name, { name, summary, description });
  }
  return m;
}

function mergeInto(target: Map<string, Entry>, src: Map<string, Entry>): void {
  for (const [k, v] of src) {
    const prev = target.get(k);
    if (!prev) { target.set(k, v); continue; }
    /* keep prev unless v has strictly more (description that prev lacks). */
    const prevHasDesc = !!prev.description;
    const vHasDesc = !!v.description;
    if (!prevHasDesc && vHasDesc) {
      target.set(k, { name: k, summary: prev.summary ?? v.summary, description: v.description });
    } else if (prevHasDesc && !prev.summary && v.summary) {
      target.set(k, { name: k, summary: v.summary, description: prev.description });
    }
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  process.stderr.write(`[locale-pkgs] loading sources from ${ROOT}\n`);

  /* Load priority order (highest quality first → wins on merge if extra fields). */
  const appstream = await loadJsonAppstream(join(ROOT, 'appstream-extra-pt.json'));
  const flathub   = await loadJsonFlathub(join(ROOT, 'flathub-pt.json'));
  const flatpak   = await loadTsv(join(ROOT, 'flatpak_pt_BR.txt'));
  const pacman    = await loadTsv(join(ROOT, 'pacman_pt_BR.txt'));
  const snap      = await loadTsv(join(ROOT, 'snap_pt_BR.txt'));
  const ptbig     = await loadTsv(join(ROOT, 'pt.txt'));

  process.stderr.write(
    `[locale-pkgs] sizes: appstream=${appstream.size} flathub=${flathub.size} flatpak=${flatpak.size} pacman=${pacman.size} snap=${snap.size} pt.txt=${ptbig.size}\n`,
  );

  /* Merge in priority order. */
  const merged = new Map<string, Entry>();
  mergeInto(merged, appstream);
  mergeInto(merged, flathub);
  mergeInto(merged, flatpak);
  mergeInto(merged, pacman);
  mergeInto(merged, snap);
  mergeInto(merged, ptbig);
  process.stderr.write(`[locale-pkgs] merged unique names: ${merged.size}\n`);

  /* Fetch packages that are MISSING any pt translation. Pull source+source_id too
   * so we can match flathub apps via their reverse-DNS source_id, not just name. */
  const missing = await db.execute<{ id: number; name: string; source: string; source_id: string }>(sql`
    SELECT p.id, p.name, p.source, p.source_id
    FROM package p
    LEFT JOIN package_translation t
      ON t.package_id=p.id AND t.locale IN ('pt','pt-br') AND COALESCE(t.summary,t.description) IS NOT NULL
    WHERE t.package_id IS NULL
  `);
  process.stderr.write(`[locale-pkgs] DB missing pt: ${missing.length}\n`);

  /* Build insert list. */
  let matched = 0, matchedSourceId = 0, junk = 0;
  const rows: Array<{ packageId: number; locale: string; summary: string | null; description: string | null; translatedBy: string; status: 'draft' }> = [];
  for (const row of missing) {
    const name = row.name.toLowerCase();
    let e = merged.get(name);
    if (!e && row.source === 'flathub' && row.source_id) {
      /* Try source_id match for flathub (reverse-DNS app ids in flathub-pt.json). */
      e = merged.get(row.source_id.toLowerCase());
      if (e) matchedSourceId++;
    }
    if (!e) continue;
    if (junky(name, e.summary, e.description)) { junk++; continue; }
    matched++;
    rows.push({
      packageId: row.id,
      locale: LOCALE,
      summary: e.summary,
      description: e.description,
      translatedBy: TRANSLATED_BY,
      status: 'draft',
    });
  }
  process.stderr.write(`[locale-pkgs] matched=${matched} (via source_id=${matchedSourceId}) junk=${junk} to_insert=${rows.length}\n`);

  if (DRY) {
    for (const r of rows.slice(0, 8)) {
      process.stderr.write(`  id=${r.packageId} sum="${(r.summary ?? '').slice(0, 80)}" desc=${r.description ? `"${r.description.slice(0, 80)}…"` : 'NULL'}\n`);
    }
    process.exit(0);
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db
      .insert(schema.packageTranslation)
      .values(chunk)
      .onConflictDoNothing({
        target: [schema.packageTranslation.packageId, schema.packageTranslation.locale],
      });
    inserted += chunk.length;
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'import_locale_pkgs_pt',
    entityType: 'translation',
    after: {
      source: ROOT,
      translated_by: TRANSLATED_BY,
      locale: LOCALE,
      sizes: { appstream: appstream.size, flathub: flathub.size, flatpak: flatpak.size, pacman: pacman.size, snap: snap.size, ptbig: ptbig.size },
      merged: merged.size,
      missing_in_db: missing.length,
      matched, junk, attempted_inserts: rows.length,
      duration_ms: Date.now() - t0,
    },
  });

  process.stderr.write(`[locale-pkgs] DONE inserted/attempted=${inserted} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
