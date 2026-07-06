import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '~/lib/db';
import { locales } from '~/i18n';

export const prerender = false;

/** Static per-locale routes that exist as `.astro` files under `src/pages/[locale]/`. */
const STATIC_PATHS = ['', 'browse', 'transparency', 'governanca', 'status', 'lists'] as const;

/** Resolve the canonical site origin. Falls back to the request URL origin so the
 *  emitted sitemap always contains absolute URLs even in dev. */
function siteOrigin(requestUrl: URL): string {
  const configured = (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? process.env.PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${requestUrl.protocol}//${requestUrl.host}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAlternates(origin: string, pathSuffix: string): string {
  return locales
    .map((l) => {
      const href = `${origin}/${l}${pathSuffix ? '/' + pathSuffix : ''}`;
      return `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(href)}"/>`;
    })
    .join('\n');
}

/** Astro endpoint that streams a `urlset` sitemap. Memory-bounded: each URL
 *  is pushed to the stream as soon as it is built, so the 5000-package query
 *  result is the only large in-memory artifact. */
export const GET: APIRoute = async ({ request }) => {
  const reqUrl = new URL(request.url);
  const origin = siteOrigin(reqUrl);

  /** Top packages by popularity. `updated_at` drives `<lastmod>`. */
  type Row = { slug: string; canonical_slug: string | null; updated_at: string };
  const pkgRows = await db.execute<Row>(sql`
    SELECT DISTINCT ON (COALESCE(canonical_slug, slug))
           slug, canonical_slug, updated_at
    FROM package
    ORDER BY COALESCE(canonical_slug, slug), popularity DESC NULLS LAST, updated_at DESC
    LIMIT 5000
  `);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const write = (chunk: string) => controller.enqueue(enc.encode(chunk));

      write(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
          ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n',
      );

      /* Static per-locale roots + section pages. */
      for (const path of STATIC_PATHS) {
        const alternates = buildAlternates(origin, path);
        for (const l of locales) {
          const loc = `${origin}/${l}${path ? '/' + path : ''}`;
          write(
            '  <url>\n' +
              `    <loc>${xmlEscape(loc)}</loc>\n` +
              alternates +
              '\n  </url>\n',
          );
        }
      }

      /* Package detail pages: one URL per (locale, package) with cross-locale alternates. */
      for (const r of pkgRows as unknown as Row[]) {
        const slug = r.canonical_slug ?? r.slug;
        const lastmod = new Date(r.updated_at).toISOString();
        const suffix = `p/${slug}`;
        const alternates = buildAlternates(origin, suffix);
        for (const l of locales) {
          const loc = `${origin}/${l}/${suffix}`;
          write(
            '  <url>\n' +
              `    <loc>${xmlEscape(loc)}</loc>\n` +
              `    <lastmod>${lastmod}</lastmod>\n` +
              alternates +
              '\n  </url>\n',
          );
        }
      }

      write('</urlset>\n');
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
