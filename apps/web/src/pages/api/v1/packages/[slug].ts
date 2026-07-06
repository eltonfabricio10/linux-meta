import type { APIRoute } from 'astro';
import { getPackageBySlug } from '~/lib/packages';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug) return new Response('Bad request', { status: 400 });
  const pkg = await getPackageBySlug(slug);
  if (!pkg) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(pkg), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
