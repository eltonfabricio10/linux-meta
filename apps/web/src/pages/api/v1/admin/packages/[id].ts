/** Admin package detail + edit API.
 *
 * GET returns the full package row plus every translation row for any locale.
 * PATCH (admin only) allows narrow metadata overrides — license, upstream URL,
 * popularity — and writes a before/after snapshot to the audit log.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { eq, asc } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const IdSchema = z.coerce.number().int().positive();

const PatchSchema = z
  .object({
    license: z.string().trim().max(200).nullable().optional(),
    upstreamUrl: z.url().trim().max(2000).nullable().optional(),
    popularity: z.number().int().min(0).max(2_000_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const GET: APIRoute = async ({ params, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['translator', 'reviewer', 'admin'])) {
    return json({ error: 'forbidden' }, 403);
  }

  const idParsed = IdSchema.safeParse(params.id);
  if (!idParsed.success) return json({ error: 'invalid id' }, 422);

  const [pkg] = await db
    .select()
    .from(schema.packageTable)
    .where(eq(schema.packageTable.id, idParsed.data))
    .limit(1);
  if (!pkg) return json({ error: 'not found' }, 404);

  const translations = await db
    .select()
    .from(schema.packageTranslation)
    .where(eq(schema.packageTranslation.packageId, idParsed.data))
    .orderBy(asc(schema.packageTranslation.locale));

  return json({ package: pkg, translations });
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  const idParsed = IdSchema.safeParse(params.id);
  if (!idParsed.success) return json({ error: 'invalid id' }, 422);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 422); }
  const body = PatchSchema.safeParse(raw);
  if (!body.success) return json({ error: 'invalid body', issues: body.error.issues }, 422);

  const [before] = await db
    .select()
    .from(schema.packageTable)
    .where(eq(schema.packageTable.id, idParsed.data))
    .limit(1);
  if (!before) return json({ error: 'not found' }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.license !== undefined) patch.licenseSpdx = body.data.license;
  if (body.data.upstreamUrl !== undefined) patch.upstreamUrl = body.data.upstreamUrl;
  if (body.data.popularity !== undefined) patch.popularity = body.data.popularity;

  const [after] = await db
    .update(schema.packageTable)
    .set(patch)
    .where(eq(schema.packageTable.id, idParsed.data))
    .returning();

  await logAdminAction({
    actor: locals.user!.id,
    action: 'package.update',
    entityType: 'package',
    entityId: String(idParsed.data),
    before,
    after,
  });

  return json({ package: after });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
