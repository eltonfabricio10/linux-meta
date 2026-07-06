/** Bulk translation operations.
 *
 * Only deletion is supported in v0.1 — it's the workflow we need first for
 * purging poor AI fills at scale. Bounded at 500 ids per call so a runaway
 * client cannot lock the table. Each row deletion logs its own audit entry so
 * forensic queries can rebuild any historical state.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { and, eq } from 'drizzle-orm';
import { getUserRole, hasRole } from '~/lib/roles';
import { logAdminAction } from '~/lib/audit';

export const prerender = false;

const BodySchema = z.object({
  action: z.literal('delete'),
  ids: z
    .array(z.object({
      packageId: z.number().int().positive(),
      locale: z.string().min(2).max(8),
    }))
    .min(1)
    .max(500),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid json' }, 422); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  let deleted = 0;
  let missing = 0;

  for (const { packageId, locale } of parsed.data.ids) {
    const [before] = await db
      .select()
      .from(schema.packageTranslation)
      .where(and(
        eq(schema.packageTranslation.packageId, packageId),
        eq(schema.packageTranslation.locale, locale),
      ))
      .limit(1);
    if (!before) { missing += 1; continue; }

    await db
      .delete(schema.packageTranslation)
      .where(and(
        eq(schema.packageTranslation.packageId, packageId),
        eq(schema.packageTranslation.locale, locale),
      ));

    deleted += 1;
    await logAdminAction({
      actor: locals.user!.id,
      action: 'translation.delete',
      entityType: 'package_translation',
      entityId: `${packageId}:${locale}`,
      before,
      after: null,
    });
  }

  return json({ deleted, missing, requested: parsed.data.ids.length });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
