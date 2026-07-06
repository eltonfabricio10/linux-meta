import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const QuerySchema = z.object({
  locale: z.string().min(2).max(8).default('pt'),
  status: z.enum(['draft', 'reviewed', 'official']).default('draft'),
});

export const GET: APIRoute = async ({ url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = QuerySchema.safeParse({
    locale: url.searchParams.get('locale') ?? 'pt',
    status: url.searchParams.get('status') ?? 'draft',
  });
  if (!parsed.success) return json({ error: 'invalid query' }, 422);

  const rows = await db
    .select({
      packageId: schema.packageTranslation.packageId,
      locale: schema.packageTranslation.locale,
      packageName: schema.packageTable.name,
      packageSlug: schema.packageTable.slug,
      summary: schema.packageTranslation.summary,
      description: schema.packageTranslation.description,
      plainExplanation: schema.packageTranslation.plainExplanation,
      translatedBy: schema.packageTranslation.translatedBy,
      status: schema.packageTranslation.status,
      updatedAt: schema.packageTranslation.updatedAt,
    })
    .from(schema.packageTranslation)
    .innerJoin(schema.packageTable, eq(schema.packageTranslation.packageId, schema.packageTable.id))
    .where(and(
      eq(schema.packageTranslation.locale, parsed.data.locale),
      eq(schema.packageTranslation.status, parsed.data.status),
    ))
    .orderBy(desc(schema.packageTranslation.updatedAt))
    .limit(200);

  return json({ items: rows, count: rows.length });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
