import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { and, eq, sql } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';
import { isDeepseekConfigured } from '~/lib/deepseek';
import { translatePackage } from '~/lib/translate-harness';

export const prerender = false;

const BodySchema = z.object({
  packageId: z.number().int().positive(),
  locale: z.string().trim().min(2).max(8),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!isDeepseekConfigured()) {
    return json({ error: 'deepseek_unconfigured', message: 'DEEPSEEK_API_KEY is not set on the server.' }, 503);
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);
  const { packageId, locale } = parsed.data;

  const [pkg] = await db
    .select({
      name: schema.packageTable.name,
      rawMetadata: schema.packageTable.rawMetadata,
    })
    .from(schema.packageTable)
    .where(eq(schema.packageTable.id, packageId))
    .limit(1);
  if (!pkg) return json({ error: 'not found' }, 404);

  /* Source: the en translation row (best status), falling back to upstream desc. */
  const [enRow] = await db
    .select({ summary: schema.packageTranslation.summary, description: schema.packageTranslation.description })
    .from(schema.packageTranslation)
    .where(and(eq(schema.packageTranslation.packageId, packageId), eq(schema.packageTranslation.locale, 'en')))
    .orderBy(sql`CASE status WHEN 'official' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END`)
    .limit(1);
  const upstreamDesc = (pkg.rawMetadata as { desc?: string } | null)?.desc ?? null;
  const sourceSummary = enRow?.summary ?? upstreamDesc;
  const sourceDescription = enRow?.description ?? upstreamDesc;

  if (!sourceSummary && !sourceDescription) {
    return json({ error: 'no_source', message: 'No English source text to translate from.' }, 422);
  }

  /* Light disambiguation context: a few popular names in the same category. */
  const peers = await db.execute<{ name: string }>(sql`
    SELECT name FROM package
    WHERE cat_path = (SELECT cat_path FROM package WHERE id = ${packageId})
      AND moderation_status = 'approved' AND id <> ${packageId}
    ORDER BY popularity DESC NULLS LAST
    LIMIT 8
  `);
  const context = (peers as unknown as Array<{ name: string }>).map((p) => p.name);

  try {
    const result = await translatePackage({
      name: pkg.name,
      sourceSummary,
      sourceDescription,
      targetLocale: locale,
      context,
    });
    return json({
      summary: result.summary,
      description: result.description,
      plainExplanation: result.plainExplanation,
      issues: result.issues,
      attempts: result.attempts,
      refined: result.refined,
      usage: result.usage,
    });
  } catch (e) {
    return json({ error: 'translate_failed', message: (e as Error).message }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
