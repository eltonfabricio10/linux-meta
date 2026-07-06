/** Admin translation row CRUD.
 *
 * Single-row reads and edits on `package_translation`. PUT performs an upsert
 * so admins can author translations from scratch when a row does not yet exist.
 * Every mutation logs a before/after diff to the audit log. DELETE is the
 * escape hatch for purging poor-quality AI fills.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { and, eq } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const ParamsSchema = z.object({
  packageId: z.coerce.number().int().positive(),
  locale: z.string().trim().min(2).max(8),
});

const StatusEnum = z.enum(['draft', 'reviewed', 'official']);

const PutSchema = z.object({
  summary: z.string().max(4000).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  plain_explanation: z.string().max(20000).nullable().optional(),
  status: StatusEnum.optional(),
  translated_by: z.string().trim().max(64).optional(),
});

export const GET: APIRoute = async ({ params, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }
  const p = ParamsSchema.safeParse(params);
  if (!p.success) return json({ error: 'invalid params' }, 422);

  const [row] = await db
    .select()
    .from(schema.packageTranslation)
    .where(and(
      eq(schema.packageTranslation.packageId, p.data.packageId),
      eq(schema.packageTranslation.locale, p.data.locale),
    ))
    .limit(1);

  if (!row) return json({ error: 'not found' }, 404);
  return json({ translation: row });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin', 'reviewer'])) return json({ error: 'forbidden' }, 403);

  const p = ParamsSchema.safeParse(params);
  if (!p.success) return json({ error: 'invalid params' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 422); }
  const body = PutSchema.safeParse(raw);
  if (!body.success) return json({ error: 'invalid body', issues: body.error.issues }, 422);

  const [before] = await db
    .select()
    .from(schema.packageTranslation)
    .where(and(
      eq(schema.packageTranslation.packageId, p.data.packageId),
      eq(schema.packageTranslation.locale, p.data.locale),
    ))
    .limit(1);

  // Confirm the package exists for fresh inserts.
  if (!before) {
    const [pkg] = await db
      .select({ id: schema.packageTable.id })
      .from(schema.packageTable)
      .where(eq(schema.packageTable.id, p.data.packageId))
      .limit(1);
    if (!pkg) return json({ error: 'package not found' }, 404);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.summary !== undefined) patch.summary = body.data.summary;
  if (body.data.description !== undefined) patch.description = body.data.description;
  if (body.data.plain_explanation !== undefined) patch.plainExplanation = body.data.plain_explanation;
  if (body.data.status !== undefined) patch.status = body.data.status;
  if (body.data.translated_by !== undefined) patch.translatedBy = body.data.translated_by;

  let after: typeof schema.packageTranslation.$inferSelect | undefined;
  if (before) {
    [after] = await db
      .update(schema.packageTranslation)
      .set(patch)
      .where(and(
        eq(schema.packageTranslation.packageId, p.data.packageId),
        eq(schema.packageTranslation.locale, p.data.locale),
      ))
      .returning();
  } else {
    [after] = await db
      .insert(schema.packageTranslation)
      .values({
        packageId: p.data.packageId,
        locale: p.data.locale,
        summary: body.data.summary ?? null,
        description: body.data.description ?? null,
        plainExplanation: body.data.plain_explanation ?? null,
        status: body.data.status ?? 'draft',
        translatedBy: body.data.translated_by ?? 'human',
      })
      .returning();
  }

  const transition = before && body.data.status && before.status !== body.data.status
    ? { from: before.status, to: body.data.status }
    : null;

  await logAdminAction({
    actor: locals.user!.id,
    action: before ? 'translation.update' : 'translation.create',
    entityType: 'package_translation',
    entityId: `${p.data.packageId}:${p.data.locale}`,
    before: before ?? null,
    after: { ...after, _transition: transition },
  });

  return json({ translation: after });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const p = ParamsSchema.safeParse(params);
  if (!p.success) return json({ error: 'invalid params' }, 422);

  const [before] = await db
    .select()
    .from(schema.packageTranslation)
    .where(and(
      eq(schema.packageTranslation.packageId, p.data.packageId),
      eq(schema.packageTranslation.locale, p.data.locale),
    ))
    .limit(1);
  if (!before) return json({ error: 'not found' }, 404);

  await db
    .delete(schema.packageTranslation)
    .where(and(
      eq(schema.packageTranslation.packageId, p.data.packageId),
      eq(schema.packageTranslation.locale, p.data.locale),
    ));

  await logAdminAction({
    actor: locals.user!.id,
    action: 'translation.delete',
    entityType: 'package_translation',
    entityId: `${p.data.packageId}:${p.data.locale}`,
    before,
    after: null,
  });

  return new Response(null, { status: 204 });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
