import type { APIRoute } from 'astro';

export const prerender = false;

/** PWA manifest. Theme colors mirror `--color-primary` (navy-900) and
 *  `--color-paper` background tokens from `src/styles/tokens.css`. Icons
 *  reference the SVG favicon shipped in `public/`. */
export const GET: APIRoute = async () => {
  const manifest = {
    name: 'linux-meta',
    short_name: 'linux-meta',
    description: 'Cross-distro Linux package metadata, translations and ratings.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafaf7',
    theme_color: '#0f1f3d',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
