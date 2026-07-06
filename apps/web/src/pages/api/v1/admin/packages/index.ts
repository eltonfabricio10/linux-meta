/** Admin packages listing API.
 *
 * Returns a flat list of packages with a LEFT JOIN to the PT translation row so
 * the admin UI can show translation status without N+1 queries. Filtering is
 * powered entirely by zod; the SQL is built from validated fragments only.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { and, eq, ilike, or, isNull, isNotNull, sql, desc, type SQL } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';

export const prerender = false;

const SourceEnum = z.enum(['aur', 'debian', 'flathub', 'manjaro']);
const StatusEnum = z.enum(['draft', 'reviewed', 'official']);
const EditorEnum = z.enum(['codex', 'claude', 'ai', 'imported']);
const TRANSLATION_LOCALE = 'pt-br';

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  source: SourceEnum.optional(),
  has_translation_pt: z.enum(['true', 'false']).optional(),
  translation_status: StatusEnum.optional(),
  translated_by: z.string().trim().min(1).max(64).optional(),
  editor: EditorEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET: APIRoute = async ({ url, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: 'invalid query', issues: parsed.error.issues }, 422);
  const f = parsed.data;

  const conds: SQL[] = [];
  if (f.q) {
    const q = `%${f.q}%`;
    const qOr = or(ilike(schema.packageTable.name, q), ilike(schema.packageTable.slug, q));
    if (qOr) conds.push(qOr);
  }
  if (f.source) conds.push(eq(schema.packageTable.source, f.source));
  if (f.has_translation_pt === 'true') conds.push(isNotNull(schema.packageTranslation.packageId));
  if (f.has_translation_pt === 'false') conds.push(isNull(schema.packageTranslation.packageId));
  if (f.translation_status) conds.push(eq(schema.packageTranslation.status, f.translation_status));
  if (f.translated_by) conds.push(eq(schema.packageTranslation.translatedBy, f.translated_by));
  if (f.editor) {
    if (f.editor === 'codex') {
      conds.push(sql`${schema.packageTranslation.translatedBy} LIKE 'ai_codex%'`);
    } else if (f.editor === 'claude') {
      conds.push(eq(schema.packageTranslation.translatedBy, 'ai_claude_code'));
    } else if (f.editor === 'ai') {
      conds.push(sql`${schema.packageTranslation.translatedBy} LIKE 'ai\\_%' ESCAPE '\\'`);
    } else if (f.editor === 'imported') {
      conds.push(sql`${schema.packageTranslation.translatedBy} IN ('upstream', 'flathub_appstream', 'debian_ddtp', 'reingest_external')`);
    }
  }

  const whereExpr = conds.length ? and(...conds) : undefined;

  const items = await db
    .select({
      id: schema.packageTable.id,
      name: schema.packageTable.name,
      slug: schema.packageTable.slug,
      source: schema.packageTable.source,
      license: schema.packageTable.licenseSpdx,
      popularity: schema.packageTable.popularity,
      ptStatus: schema.packageTranslation.status,
      ptTranslatedBy: schema.packageTranslation.translatedBy,
      ptUpdatedAt: schema.packageTranslation.updatedAt,
    })
    .from(schema.packageTable)
    .leftJoin(
      schema.packageTranslation,
      and(
        eq(schema.packageTranslation.packageId, schema.packageTable.id),
        eq(schema.packageTranslation.locale, TRANSLATION_LOCALE),
      ),
    )
    .where(whereExpr)
    .orderBy(desc(schema.packageTable.popularity), schema.packageTable.name)
    .limit(f.limit)
    .offset(f.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.packageTable)
    .leftJoin(
      schema.packageTranslation,
      and(
        eq(schema.packageTranslation.packageId, schema.packageTable.id),
        eq(schema.packageTranslation.locale, TRANSLATION_LOCALE),
      ),
    )
    .where(whereExpr);

  return json({ items, total });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
