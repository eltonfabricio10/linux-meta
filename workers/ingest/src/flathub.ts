/** Flathub AppStream collection ingestor.
 *  Pulls appstream.xml.gz (rich OARS coverage), upserts as source=flathub,
 *  writes ratings and translations.
 *
 *  Run:
 *    pnpm --filter @linux-meta/ingest flathub
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { sql } from 'drizzle-orm';
import { db, schema } from '@linux-meta/db';
import { slugify } from './lib/slug.ts';
import { computeAgeFromOars, isOarsLevel, type OarsMap } from './lib/oars.ts';

const SOURCE = 'flathub';
const ARCH = process.env.FLATHUB_ARCH ?? 'x86_64';
const URL = process.env.FLATHUB_APPSTREAM_URL ??
  `https://dl.flathub.org/repo/appstream/${ARCH}/appstream.xml.gz`;

type LocalizedText = string | { '#text': string; '@_xml:lang'?: string } | Array<string | { '#text': string; '@_xml:lang'?: string }>;

type RawComp = {
  '@_type'?: string;
  id?: string;
  pkgname?: string;
  name?: LocalizedText;
  summary?: LocalizedText;
  description?: unknown;
  url?: { '#text'?: string; '@_type'?: string } | Array<{ '#text'?: string; '@_type'?: string }>;
  project_license?: string;
  content_rating?: {
    '@_type'?: string;
    content_attribute?: Array<{ '@_id': string; '#text': string }> | { '@_id': string; '#text': string };
  };
  icon?: unknown;
};

function pickLocalized(node: LocalizedText | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (node == null) return out;
  const arr = Array.isArray(node) ? node : [node];
  for (const item of arr) {
    if (typeof item === 'string') {
      out['default'] = item;
    } else if (typeof item === 'object' && item) {
      const lang = item['@_xml:lang'] ?? 'default';
      out[lang] = item['#text'] ?? '';
    }
  }
  return out;
}

function pickUrl(u: RawComp['url']): string | null {
  if (!u) return null;
  const arr = Array.isArray(u) ? u : [u];
  for (const item of arr) {
    if (item?.['@_type'] === 'homepage' && item['#text']) return item['#text'];
  }
  return arr[0]?.['#text'] ?? null;
}

function pickOars(c: RawComp['content_rating']): { oars: OarsMap; ageMin: number } | null {
  if (!c) return null;
  const attrs = c.content_attribute;
  if (!attrs) return null;
  const arr = Array.isArray(attrs) ? attrs : [attrs];
  const oars: OarsMap = {};
  for (const a of arr) {
    const id = a['@_id'];
    const level = (a['#text'] ?? '').trim();
    if (id && isOarsLevel(level)) oars[id] = level;
  }
  if (Object.keys(oars).length === 0) return null;
  return { oars, ageMin: computeAgeFromOars(oars) };
}

function flattenDescription(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenDescription).filter(Boolean).join('\n\n');
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    // Common: { p: [...], ul: {...} }
    const parts: string[] = [];
    for (const v of Object.values(obj)) {
      const s = flattenDescription(v);
      if (s) parts.push(s);
    }
    return parts.join('\n\n') || null;
  }
  return null;
}

async function fetchAppstream(): Promise<string> {
  process.stderr.write(`[flathub] GET ${URL}\n`);
  const res = await fetch(URL, {
    headers: { 'user-agent': 'linux-meta-ingest/0.0 (+https://example.org)' },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${URL}`);

  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  Readable.fromWeb(res.body as never).pipe(gunzip);
  for await (const c of gunzip as unknown as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const startedAt = Date.now();
  const xml = await fetchAppstream();
  process.stderr.write(`[flathub] parsed bytes=${xml.length}\n`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    isArray: (name) =>
      ['component', 'content_attribute', 'url', 'name', 'summary', 'description'].includes(name),
  });
  const parsed = parser.parse(xml) as { components?: { component?: RawComp[] } };
  const components = parsed.components?.component ?? [];
  process.stderr.write(`[flathub] components=${components.length}\n`);

  let upserted = 0;
  let ratings = 0;
  let translations = 0;
  const BATCH = 100;

  for (let i = 0; i < components.length; i += BATCH) {
    const slice = components.slice(i, i + BATCH);
    // Dedupe by id inside the batch — Flathub can publish multiple components per id.
    const seenIds = new Set<string>();
    const sliceUniq = slice.filter((c) => {
      if (!c.id) return false;
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });
    const pkgRows = sliceUniq
      .map((c) => {
        const id = c.id!;
        const names = pickLocalized(c.name);
        const name = names['default'] ?? names['C'] ?? id;
        return {
          source: SOURCE,
          sourceId: id,
          name,
          slug: slugify(id),
          upstreamUrl: pickUrl(c.url),
          licenseSpdx: c.project_license ?? null,
          latestVersionDistro: null,
          installSizeKb: null,
          rawMetadata: { kind: c['@_type'], pkgname: c.pkgname ?? id } as Record<string, unknown>,
          updatedAt: new Date(),
        };
      });

    if (pkgRows.length === 0) continue;

    const inserted = await db
      .insert(schema.packageTable)
      .values(pkgRows)
      .onConflictDoUpdate({
        target: [schema.packageTable.source, schema.packageTable.sourceId],
        set: {
          name: sql`excluded.name`,
          slug: sql`excluded.slug`,
          upstreamUrl: sql`excluded.upstream_url`,
          licenseSpdx: sql`excluded.license_spdx`,
          rawMetadata: sql`excluded.raw_metadata`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.packageTable.id, sourceId: schema.packageTable.sourceId });

    upserted += inserted.length;
    const idBySource = new Map(inserted.map((r) => [r.sourceId, r.id]));

    // Ratings + translations
    const ratingRows: Array<typeof schema.rating.$inferInsert> = [];
    const ratingCurrentRows: Array<typeof schema.ratingCurrent.$inferInsert> = [];
    const trRows: Array<typeof schema.packageTranslation.$inferInsert> = [];

    for (const c of sliceUniq) {
      if (!c.id) continue;
      const pid = idBySource.get(c.id);
      if (!pid) continue;

      const oars = pickOars(c.content_rating);
      if (oars) {
        ratingRows.push({
          packageId: pid,
          source: 'oars_official',
          ageMin: oars.ageMin,
          oars: oars.oars,
          confidence: 1,
          classifierVersion: 'appstream-oars-1.1',
          rationale: 'Extracted from upstream AppStream content_rating',
        });
        ratingCurrentRows.push({
          packageId: pid,
          ageMin: oars.ageMin,
          dominantSource: 'oars_official',
          oars: oars.oars,
        });
        ratings++;
      }

      const summaries = pickLocalized(c.summary);
      const descRaw = c.description;
      const descLocs: Record<string, string> = {};
      if (descRaw && typeof descRaw === 'object' && !Array.isArray(descRaw)) {
        const obj = descRaw as Record<string, unknown>;
        const flat = flattenDescription(obj);
        if (flat) descLocs['default'] = flat;
      } else if (Array.isArray(descRaw)) {
        for (const item of descRaw) {
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;
            const lang = (obj['@_xml:lang'] as string | undefined) ?? 'default';
            const flat = flattenDescription(obj);
            if (flat) descLocs[lang] = flat;
          }
        }
      }

      const allLocales = new Set([...Object.keys(summaries), ...Object.keys(descLocs)]);
      for (const rawLoc of allLocales) {
        const locale = normalizeLocale(rawLoc);
        if (!locale) continue;
        trRows.push({
          packageId: pid,
          locale,
          summary: summaries[rawLoc] ?? null,
          description: descLocs[rawLoc] ?? null,
          translatedBy: 'upstream',
          status: 'official',
        });
      }
    }

    if (ratingRows.length > 0) {
      await db.insert(schema.rating).values(ratingRows);
    }
    if (ratingCurrentRows.length > 0) {
      const seenPid = new Map<number, typeof ratingCurrentRows[number]>();
      for (const r of ratingCurrentRows) seenPid.set(r.packageId, r);
      await db
        .insert(schema.ratingCurrent)
        .values([...seenPid.values()])
        .onConflictDoUpdate({
          target: schema.ratingCurrent.packageId,
          set: {
            ageMin: sql`excluded.age_min`,
            dominantSource: sql`excluded.dominant_source`,
            oars: sql`excluded.oars`,
            computedAt: sql`now()`,
          },
        });
    }
    if (trRows.length > 0) {
      // Dedupe by (packageId, locale) keeping last
      const seen = new Map<string, typeof trRows[number]>();
      for (const r of trRows) seen.set(`${r.packageId}:${r.locale}`, r);
      await db
        .insert(schema.packageTranslation)
        .values([...seen.values()])
        .onConflictDoUpdate({
          target: [schema.packageTranslation.packageId, schema.packageTranslation.locale],
          set: {
            summary: sql`excluded.summary`,
            description: sql`excluded.description`,
            translatedBy: sql`excluded.translated_by`,
            status: sql`excluded.status`,
            updatedAt: sql`now()`,
          },
        });
      translations += seen.size;
    }
  }

  await db.insert(schema.auditLog).values({
    actor: 'system',
    action: 'ingest_flathub',
    entityType: 'ingest_run',
    after: {
      source: SOURCE, url: URL,
      components: components.length, upserted, ratings, translations,
      durationMs: Date.now() - startedAt,
    },
  });

  process.stderr.write(
    `[flathub] DONE components=${components.length} upserted=${upserted} ratings=${ratings} translations=${translations} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`,
  );
  process.exit(0);
}

function normalizeLocale(raw: string): string | null {
  if (raw === 'default' || raw === 'C' || raw === 'POSIX') return 'en';
  // AppStream uses `pt-BR`, `pt`, etc. Keep base + region; cap length.
  const cleaned = raw.replace('_', '-').slice(0, 8);
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)?$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
