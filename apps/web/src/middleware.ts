import { defineMiddleware, sequence } from 'astro:middleware';
import { auth } from '~/lib/auth';
import { defaultLocale, locales } from '~/i18n';
import { getUserRole, landingFor } from '~/lib/roles';

/** Negotiate Accept-Language at `/`, redirect to the visitor's preferred locale. */
const localeRedirect = defineMiddleware(async (ctx, next) => {
  if (ctx.url.pathname === '/') {
    const accept = ctx.request.headers.get('accept-language') ?? '';
    const preferred = pickLocale(accept);
    return ctx.redirect(`/${preferred}/`, 302);
  }
  return next();
});

/** Hydrate Astro.locals.user/session from Better Auth so .astro pages can read it. */
const session = defineMiddleware(async (ctx, next) => {
  const result = await auth.api.getSession({ headers: ctx.request.headers });
  ctx.locals.user = result?.user ?? null;
  ctx.locals.session = result?.session ?? null;
  ctx.locals.role = result?.user ? await getUserRole(result.user.id) : null;
  return next();
});

/** Role landing: non-admins hitting /{locale}/admin/* are sent to their own
 * workspace (reviewer→queue, translator→translate, else browse) instead of the
 * login wall. Runs after `session` so ctx.locals.role is populated. */
const adminGate = defineMiddleware(async (ctx, next) => {
  const match = ctx.url.pathname.match(/^\/([a-z]{2})\/admin(?:\/|$)/);
  if (match) {
    const loc = match[1];
    const role = ctx.locals.role ?? 'visitor';
    if (role !== 'admin') {
      const dest = ctx.locals.user ? landingFor(role) : '/auth/login';
      return ctx.redirect(`/${loc}${dest}`, 302);
    }
  }
  return next();
});

export const onRequest = sequence(localeRedirect, session, adminGate);

function pickLocale(accept: string): string {
  const ranked = accept
    .split(',')
    .map((p) => {
      const [tag, q] = p.trim().split(';q=');
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (base && (locales as readonly string[]).includes(base)) return base;
  }
  return defaultLocale;
}
