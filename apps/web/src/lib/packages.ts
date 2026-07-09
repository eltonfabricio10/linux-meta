import { sql, inArray, or, eq, and, desc } from 'drizzle-orm';
import { db, schema } from './db';

export type PackageRow = typeof schema.packageTable.$inferSelect;

export type SearchHit = {
  id: number;
  source: string;
  sourceId: string;
  name: string;
  slug: string;
  canonicalSlug: string | null;
  summary: string | null;
  /* Provenance + locale of the displayed summary. */
  summarySource: 'translation_upstream' | 'translation_ai' | 'translation_human' | 'raw_metadata' | 'none';
  summaryLocale: string | null;
  latestVersion: string | null;
  similarity: number;
  sources: string[]; // all distros where this canonical exists
};

// Semantic search is opt-in: it runs only when OLLAMA_URL is configured.
// With no Ollama service (e.g. to save RAM on a shared host), leave it unset
// and search goes straight to trigram — no failed fetch, no error logs.
const OLLAMA_URL = process.env.OLLAMA_URL ?? '';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text';
const EMBED_LOCALE = process.env.EMBED_LOCALE ?? 'en';

async function embedQuery(text: string): Promise<number[]> {
  const ctl = AbortSignal.timeout(5000);
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: ctl,
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const j = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(j.embedding) || j.embedding.length !== 768) {
    throw new Error('ollama: bad embedding shape');
  }
  return j.embedding;
}

export type SemanticOutcome = 'semantic' | 'fallback-trgm';
export type SemanticSearchResult = { hits: SearchHit[]; outcome: SemanticOutcome };

export async function searchPackagesSemantic(
  query: string,
  limit = 25,
): Promise<SemanticSearchResult> {
  const q = query.trim();
  if (q.length === 0) return { hits: [], outcome: 'semantic' };
  // No embeddings backend configured → skip straight to text search.
  if (!OLLAMA_URL) {
    return { hits: await searchPackages(q, limit), outcome: 'fallback-trgm' };
  }
  try {
    const vec = await embedQuery(q);
    const lit = `[${vec.join(',')}]`;
    const rows = await db.execute<{
      id: number; source: string; source_id: string; name: string; slug: string;
      desc: string | null; latest_version_distro: string | null; score: number;
    }>(sql`
      SELECT p.id, p.source, p.source_id, p.name, p.slug,
             COALESCE(t.summary, p.raw_metadata->>'desc') AS desc,
             p.latest_version_distro,
             1 - (e.embedding <=> ${lit}::vector) AS score
      FROM package_embedding e
      JOIN package p ON p.id = e.package_id
      LEFT JOIN package_translation t
        ON t.package_id = p.id AND t.locale = e.locale
      WHERE e.locale = ${EMBED_LOCALE} AND e.model = ${EMBED_MODEL}
      ORDER BY e.embedding <=> ${lit}::vector
      LIMIT ${limit}
    `);
    return {
      hits: rows.map((r) => ({
        id: r.id,
        source: r.source,
        sourceId: r.source_id,
        name: r.name,
        slug: r.slug,
        canonicalSlug: null,
        summary: r.desc,
        summarySource: r.desc ? 'translation_upstream' : 'none',
        summaryLocale: EMBED_LOCALE,
        latestVersion: r.latest_version_distro,
        similarity: Number(r.score),
        sources: [r.source],
      })),
      outcome: 'semantic',
    };
  } catch (e) {
    process.stderr.write(`[search/semantic] fallback: ${(e as Error).message}\n`);
    const hits = await searchPackages(q, limit);
    return { hits, outcome: 'fallback-trgm' };
  }
}

/** Deduplicates by canonical_slug, picking the best representative per group
 *  (Flathub > Manjaro > AUR > Debian for richness; ties → highest popularity).
 *  Returns `sources` array listing all distros where that canonical exists. */
export async function searchPackages(
  query: string,
  limit = 25,
  preferredLocale = 'en',
): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const base = preferredLocale.split('-')[0] ?? 'en';

  const rows = await db.execute<{
    id: number; source: string; source_id: string; name: string; slug: string;
    canonical_slug: string | null;
    desc: string | null; tr_locale: string | null; tr_by: string | null;
    latest_version_distro: string | null;
    sim: number; all_sources: string[] | null;
  }>(sql`
    WITH matches AS (
      SELECT id, source, source_id, name, slug, canonical_slug,
             raw_metadata->>'desc'  AS desc_text,
             latest_version_distro,
             popularity,
             similarity(name, ${q}) AS sim,
             CASE source WHEN 'flathub' THEN 4 WHEN 'manjaro' THEN 3
                          WHEN 'aur' THEN 2 WHEN 'debian' THEN 1 ELSE 0 END AS rnk
      FROM package
      WHERE moderation_status = 'approved' AND (
            name % ${q}
         OR name ILIKE ${'%' + q + '%'}
         OR canonical_slug = lower(${q})
         OR canonical_slug ILIKE ${'%' + q + '%'})
      ORDER BY
        (CASE WHEN canonical_slug = lower(${q}) THEN 0 ELSE 1 END),
        similarity(name, ${q}) DESC,
        popularity DESC
      LIMIT ${limit * 8}
    ),
    grouped AS (
      /* Pick the best representative per canonical group: prefer high name-similarity
         (so 'gimp' beats 'GNU Image Manipulation Program' inside the gimp group),
         then richer source (flathub > manjaro > aur > debian), then popularity. */
      SELECT DISTINCT ON (COALESCE(canonical_slug, slug))
             id, source, source_id, name, slug, canonical_slug, desc_text,
             latest_version_distro, sim
      FROM matches
      ORDER BY COALESCE(canonical_slug, slug),
               sim DESC,
               rnk DESC,
               popularity DESC
    ),
    src_agg AS (
      SELECT canonical_slug, array_agg(DISTINCT source ORDER BY source) AS srcs
      FROM package
      WHERE canonical_slug IN (SELECT canonical_slug FROM grouped WHERE canonical_slug IS NOT NULL)
      GROUP BY canonical_slug
    )
    /* Translation lookup: aggregate across ALL siblings sharing the canonical group.
       Uses expression index package_canonical_or_slug_idx on
       COALESCE(canonical_slug, slug) — Bitmap Index Scan, sub-ms. */
    SELECT g.id, g.source, g.source_id, g.name, g.slug, g.canonical_slug,
           COALESCE(tp.tr_summary, g.desc_text) AS desc,
           tp.tr_locale,
           tp.tr_by,
           g.latest_version_distro, g.sim,
           COALESCE(s.srcs, ARRAY[g.source]::text[]) AS all_sources
    FROM grouped g
    LEFT JOIN src_agg s ON s.canonical_slug = g.canonical_slug
    LEFT JOIN LATERAL (
      SELECT t.locale AS tr_locale, t.summary AS tr_summary, t.translated_by AS tr_by
      FROM package_translation t
      JOIN package p2 ON p2.id = t.package_id
      WHERE COALESCE(p2.canonical_slug, p2.slug) = COALESCE(g.canonical_slug, g.slug)
        AND t.summary IS NOT NULL AND length(t.summary) > 0
      ORDER BY
        CASE WHEN t.locale = ${preferredLocale} THEN 0
             WHEN t.locale = ${base}           THEN 1
             WHEN t.locale = 'en'              THEN 2
             ELSE 3 END,
        CASE t.status WHEN 'official' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END
      LIMIT 1
    ) tp ON true
    ORDER BY g.sim DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const ss: SearchHit['summarySource'] = r.tr_locale
      ? (r.tr_by === 'upstream' ? 'translation_upstream'
         : r.tr_by?.startsWith('ai_') ? 'translation_ai'
         : 'translation_human')
      : (r.desc ? 'raw_metadata' : 'none');
    return {
      id: r.id,
      source: r.source,
      sourceId: r.source_id,
      name: r.name,
      slug: r.slug,
      canonicalSlug: r.canonical_slug,
      summary: r.desc,
      summarySource: ss,
      summaryLocale: r.tr_locale,
      latestVersion: r.latest_version_distro,
      similarity: Number(r.sim),
      sources: r.all_sources ?? [r.source],
    };
  });
}

export type PackageDetail = {
  pkg: PackageRow;
  rating: typeof schema.ratingCurrent.$inferSelect | null;
  translation: {
    summary: string | null;
    description: string | null;
    plainExplanation: string | null;
    locale: string;
    isFallback: boolean;
    translatedBy: string | null;
    status: string | null;
    updatedAt: string | null;
  } | null;
  profile: typeof schema.packageProfile.$inferSelect | null;
  screenshots: Array<typeof schema.packageScreenshot.$inferSelect>;
  variants: Array<{
    id: number;
    source: string;
    sourceId: string;
    slug: string;
    latestVersionDistro: string | null;
  }>;
};

export async function getPackageBySlug(slug: string): Promise<PackageRow | null> {
  /* Match by slug OR canonical_slug. When ambiguous, prefer Flathub > Manjaro > AUR > Debian.
   * Uses drizzle query builder to get camelCase keys (raw db.execute returns snake_case). */
  const rows = await db
    .select()
    .from(schema.packageTable)
    .where(and(
      sql`moderation_status = 'approved'`,
      or(eq(schema.packageTable.slug, slug), eq(schema.packageTable.canonicalSlug, slug))!,
    ))
    .orderBy(sql`CASE ${schema.packageTable.source}
      WHEN 'flathub' THEN 4 WHEN 'manjaro' THEN 3
      WHEN 'aur' THEN 2 WHEN 'debian' THEN 1 ELSE 0 END DESC`,
      sql`${schema.packageTable.popularity} DESC NULLS LAST`)
    .limit(1);
  return rows[0] ?? null;
}

export async function getPackageDetail(
  slug: string,
  preferredLocale: string,
): Promise<PackageDetail | null> {
  const pkg = await getPackageBySlug(slug);
  if (!pkg) return null;

  /* Gather all sibling rows sharing the same canonical_slug, aggregate ratings + translations. */
  const key = pkg.canonicalSlug ?? pkg.slug;
  const siblings = await db
    .select()
    .from(schema.packageTable)
    .where(sql`COALESCE(${schema.packageTable.canonicalSlug}, ${schema.packageTable.slug}) = ${key}`)
    .orderBy(sql`CASE ${schema.packageTable.source}
      WHEN 'flathub' THEN 4 WHEN 'manjaro' THEN 3
      WHEN 'aur' THEN 2 WHEN 'debian' THEN 1 ELSE 0 END DESC`,
      sql`${schema.packageTable.popularity} DESC NULLS LAST`);
  const ids = siblings.map((s) => s.id);

  /* Pick the highest rating across siblings (max age_min, OARS official prioritized). */
  let ratingRow: typeof schema.ratingCurrent.$inferSelect | null = null;
  let tr: Array<typeof schema.packageTranslation.$inferSelect> = [];
  let profile: typeof schema.packageProfile.$inferSelect | null = null;
  let screenshots: Array<typeof schema.packageScreenshot.$inferSelect> = [];
  if (ids.length > 0) {
    const ratingRows = await db
      .select()
      .from(schema.ratingCurrent)
      .where(inArray(schema.ratingCurrent.packageId, ids))
      .orderBy(sql`CASE dominant_source WHEN 'human_reviewer' THEN 4 WHEN 'oars_official' THEN 3 WHEN 'ai_claude_code' THEN 2 WHEN 'ai_codex' THEN 1 ELSE 0 END DESC, age_min DESC`)
      .limit(1);
    ratingRow = ratingRows[0] ?? null;

    /* Aggregate translations across all sibling package_ids, prefer reviewed/official. */
    const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    tr = await db.execute<typeof schema.packageTranslation.$inferSelect>(sql`
      SELECT DISTINCT ON (locale) *
      FROM package_translation
      WHERE package_id IN (${idList})
      ORDER BY locale,
        CASE status WHEN 'official' THEN 3 WHEN 'reviewed' THEN 2 ELSE 1 END DESC,
        updated_at DESC
    `);

    /* Profile: one per package_id. Prefer the representative pkg, then a reviewed/typed one. */
    const profileRows = await db
      .select()
      .from(schema.packageProfile)
      .where(inArray(schema.packageProfile.packageId, ids));
    profile =
      profileRows.find((p) => p.packageId === pkg.id) ??
      profileRows.find((p) => p.reviewedAt != null) ??
      profileRows.find((p) => p.componentType !== 'unknown') ??
      profileRows[0] ??
      null;

    /* Screenshots: published only, across siblings, in display order. */
    screenshots = await db
      .select()
      .from(schema.packageScreenshot)
      .where(and(
        inArray(schema.packageScreenshot.packageId, ids),
        inArray(schema.packageScreenshot.status, ['approved', 'reviewed', 'official']),
      ))
      .orderBy(schema.packageScreenshot.sortOrder, desc(schema.packageScreenshot.id));
  }

  const byLocale = new Map(tr.map((r) => [r.locale, r]));
  const base = preferredLocale.split('-')[0]!;
  const pick =
    byLocale.get(preferredLocale) ??
    byLocale.get(base) ??
    [...byLocale.keys()].filter((l) => l.startsWith(base + '-')).map((l) => byLocale.get(l))[0] ??
    byLocale.get('en') ??
    null;

  let translation: PackageDetail['translation'] = null;
  if (pick) {
    /* Raw db.execute returns snake_case keys. Map both shapes safely. */
    const pickAny = pick as unknown as Record<string, unknown>;
    translation = {
      summary: pick.summary,
      description: pick.description,
      plainExplanation: (pickAny['plain_explanation'] ?? (pick as { plainExplanation?: string }).plainExplanation ?? null) as string | null,
      locale: pick.locale,
      isFallback: pick.locale !== preferredLocale && pick.locale !== base,
      translatedBy: (pickAny['translated_by'] ?? (pick as { translatedBy?: string }).translatedBy ?? null) as string | null,
      status: pick.status ?? null,
      updatedAt: (pickAny['updated_at'] ?? null) as string | null,
    };
  }

  return {
    pkg,
    rating: ratingRow ?? null,
    translation,
    profile,
    screenshots,
    variants: siblings.map((s) => ({
      id: s.id,
      source: s.source,
      sourceId: s.sourceId,
      slug: s.slug,
      latestVersionDistro: s.latestVersionDistro,
    })),
  };
}

export async function countPackages(): Promise<number> {
  const r = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM package`);
  return r[0]?.c ?? 0;
}
