/** Test-only endpoint: promote a user to a given role by email.
 *  Returns 404 when NODE_ENV === 'production'. Used by Playwright e2e only. */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, schema } from '~/lib/db';
import { eq } from 'drizzle-orm';

export const prerender = false;

const BodySchema = z.object({
  email: z.email().max(254),
  role: z.enum(['visitor', 'contributor', 'translator', 'reviewer', 'admin']),
});

export const POST: APIRoute = async ({ request }) => {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  const [updated] = await db
    .update(schema.user)
    .set({ role: parsed.data.role })
    .where(eq(schema.user.email, parsed.data.email))
    .returning({ id: schema.user.id, email: schema.user.email, role: schema.user.role });

  if (!updated) return json({ error: 'user not found' }, 404);
  return json({ ok: true, user: updated });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
