import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getUserRole, hasRole } from '~/lib/roles';
import { generateMissingEmbeddings, isOllamaReachable } from '~/lib/embeddings';

export const prerender = false;

const BodySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const role = await getUserRole(locals.user?.id);
  if (!hasRole(role, ['admin'])) return json({ error: 'forbidden' }, 403);

  if (!(await isOllamaReachable())) {
    return json({ error: 'ollama_unreachable', message: 'Local embedding service (Ollama) is not reachable.' }, 503);
  }

  let raw: unknown = {};
  try { raw = await request.json(); } catch { /* empty body ok */ }
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) return json({ error: 'invalid body', issues: parsed.error.issues }, 422);

  try {
    const result = await generateMissingEmbeddings(parsed.data.limit ?? 50);
    return json(result);
  } catch (e) {
    return json({ error: 'embed_failed', message: (e as Error).message }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
