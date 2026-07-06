import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Prioritized review queue. The 217k-draft backlog is the core admin job, but a
 * flat packageId order wastes reviewer time on obscure packages. Order by impact:
 *   open dispute  →  popularity  →  still AI-drafted  →  stable id tiebreak.
 * Keyset is awkward over a computed key, so the page walks the queue with an
 * accumulating `excludeIds` (skip) list — handled items leave the draft set on
 * their own, skipped ones are excluded explicitly.
 */
export type ReviewItem = {
  packageId: number;
  name: string;
  slug: string;
  popularity: number;
  summary: string | null;
  description: string | null;
  plainExplanation: string | null;
  translatedBy: string | null;
  hasDispute: boolean;
};

export type ReviewQueue = { item: ReviewItem | null; total: number };

export async function getReviewQueueItem(
  reviewLocale: string,
  excludeIds: number[] = [],
): Promise<ReviewQueue> {
  const excludePred = excludeIds.length > 0
    ? sql`AND pt.package_id <> ALL(${sql`ARRAY[${sql.join(excludeIds.map((i) => sql`${i}`), sql`, `)}]::int[]`})`
    : sql``;

  const rows = await db.execute<{
    package_id: number; name: string; slug: string; popularity: number;
    summary: string | null; description: string | null; plain_explanation: string | null;
    translated_by: string | null; has_dispute: boolean;
  }>(sql`
    SELECT pt.package_id, p.name, p.slug, p.popularity,
           pt.summary, pt.description, pt.plain_explanation, pt.translated_by,
           EXISTS (
             SELECT 1 FROM dispute d
             WHERE d.package_id = pt.package_id AND d.status IN ('open','reviewing')
           ) AS has_dispute
    FROM package_translation pt
    JOIN package p ON p.id = pt.package_id
    WHERE pt.locale = ${reviewLocale} AND pt.status = 'draft' ${excludePred}
    ORDER BY has_dispute DESC,
             p.popularity DESC NULLS LAST,
             (pt.translated_by LIKE 'ai\\_%' ESCAPE '\\') DESC,
             pt.package_id ASC
    LIMIT 1
  `);

  const totalRow = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM package_translation
    WHERE locale = ${reviewLocale} AND status = 'draft'
  `);
  const total = (totalRow as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  const r = (rows as unknown as Array<{
    package_id: number; name: string; slug: string; popularity: number;
    summary: string | null; description: string | null; plain_explanation: string | null;
    translated_by: string | null; has_dispute: boolean;
  }>)[0];
  if (!r) return { item: null, total };

  return {
    item: {
      packageId: r.package_id,
      name: r.name,
      slug: r.slug,
      popularity: r.popularity,
      summary: r.summary,
      description: r.description,
      plainExplanation: r.plain_explanation,
      translatedBy: r.translated_by,
      hasDispute: r.has_dispute,
    },
    total,
  };
}
