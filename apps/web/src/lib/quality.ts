import { sql, type SQL } from 'drizzle-orm';
import { db } from './db';

/**
 * Data-quality radar. Computes per-signal triage lists live (no migration);
 * each signal is a cheap-ish query over existing tables, deduped by canonical
 * and ordered by popularity so the worst high-traffic gaps surface first.
 */
export type QualitySignal =
  | 'no-human-tr'
  | 'ai-rating'
  | 'missing-profile'
  | 'no-embedding'
  | 'open-cve';

export const QUALITY_SIGNALS: QualitySignal[] = [
  'no-human-tr', 'ai-rating', 'missing-profile', 'no-embedding', 'open-cve',
];

export type QualityItem = {
  id: number;
  name: string;
  slug: string;
  popularity: number;
  detail: string;
};

export type QualityListing = { items: QualityItem[]; total: number };

/* Per-signal JOIN + predicate + detail expression. Kept explicit (not string
 * interpolation) so the SQL is auditable and injection-free. */
function signalParts(signal: QualitySignal): { join: SQL; pred: SQL; detail: SQL } {
  switch (signal) {
    case 'no-human-tr':
      return {
        join: sql`JOIN package_translation t ON t.package_id = p.id AND t.locale = 'pt-br'`,
        pred: sql`t.status = 'draft'`,
        detail: sql`'rascunho pt-br'`,
      };
    case 'ai-rating':
      return {
        join: sql`JOIN rating_current rc ON rc.package_id = p.id`,
        pred: sql`rc.dominant_source LIKE 'ai\\_%' ESCAPE '\\'`,
        detail: sql`rc.dominant_source`,
      };
    case 'missing-profile':
      return {
        join: sql`LEFT JOIN package_profile pp ON pp.package_id = p.id`,
        pred: sql`(pp.package_id IS NULL OR pp.component_type = 'unknown')`,
        detail: sql`COALESCE(pp.component_type, 'sem perfil')`,
      };
    case 'no-embedding':
      return {
        join: sql`LEFT JOIN package_embedding pe ON pe.package_id = p.id AND pe.locale = 'en'`,
        pred: sql`pe.package_id IS NULL`,
        detail: sql`'sem embedding'`,
      };
    case 'open-cve':
      return {
        join: sql`JOIN cve_link cv ON cv.package_id = p.id`,
        pred: sql`cv.fixed_in_version IS NULL`,
        detail: sql`cv.cve_id || ' · ' || COALESCE(cv.severity, '?')`,
      };
  }
}

export async function getQualityList(
  signal: QualitySignal,
  limit: number,
  offset: number,
): Promise<QualityListing> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const { join, pred, detail } = signalParts(signal);

  const rows = await db.execute<{
    id: number; name: string; slug: string; popularity: number; detail: string; total: number;
  }>(sql`
    WITH cand AS (
      SELECT DISTINCT ON (COALESCE(p.canonical_slug, p.slug))
        p.id, p.name, COALESCE(p.canonical_slug, p.slug) AS slug, p.popularity,
        ${detail} AS detail
      FROM package p
      ${join}
      WHERE p.moderation_status = 'approved' AND ${pred}
      ORDER BY COALESCE(p.canonical_slug, p.slug), p.popularity DESC NULLS LAST
    ),
    counted AS (SELECT COUNT(*)::int AS total FROM cand)
    SELECT c.id, c.name, c.slug, c.popularity, c.detail, x.total
    FROM cand c, counted x
    ORDER BY c.popularity DESC NULLS LAST, c.name ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `);

  const list = rows as unknown as Array<{
    id: number; name: string; slug: string; popularity: number; detail: string; total: number;
  }>;
  return {
    total: list[0]?.total ?? 0,
    items: list.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, popularity: r.popularity, detail: r.detail,
    })),
  };
}

export type QualityRollup = Record<QualitySignal, number>;

let rollupCache: { value: QualityRollup; expiresAt: number } | null = null;
const ROLLUP_TTL_MS = 60_000;

export async function getQualityRollup(): Promise<QualityRollup> {
  if (rollupCache && rollupCache.expiresAt > Date.now()) return rollupCache.value;
  const row = await db.execute<Record<QualitySignal, number>>(sql`
    SELECT
      (SELECT COUNT(DISTINCT COALESCE(p.canonical_slug, p.slug))::int
         FROM package p JOIN package_translation t ON t.package_id = p.id AND t.locale = 'pt-br'
         WHERE p.moderation_status = 'approved' AND t.status = 'draft')                                AS "no-human-tr",
      (SELECT COUNT(*)::int FROM rating_current WHERE dominant_source LIKE 'ai\\_%' ESCAPE '\\')        AS "ai-rating",
      (SELECT COUNT(*)::int FROM package p LEFT JOIN package_profile pp ON pp.package_id = p.id
         WHERE p.moderation_status = 'approved' AND (pp.package_id IS NULL OR pp.component_type = 'unknown')) AS "missing-profile",
      (SELECT COUNT(*)::int FROM package p LEFT JOIN package_embedding pe ON pe.package_id = p.id AND pe.locale = 'en'
         WHERE p.moderation_status = 'approved' AND pe.package_id IS NULL)                             AS "no-embedding",
      (SELECT COUNT(DISTINCT package_id)::int FROM cve_link WHERE fixed_in_version IS NULL)            AS "open-cve"
  `);
  const r = (row as unknown as Array<Record<QualitySignal, number>>)[0] ?? {
    'no-human-tr': 0, 'ai-rating': 0, 'missing-profile': 0, 'no-embedding': 0, 'open-cve': 0,
  };
  rollupCache = { value: r, expiresAt: Date.now() + ROLLUP_TTL_MS };
  return r;
}
