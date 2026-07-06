import { createAuthClient } from 'better-auth/client';

/* Same-origin: avoids hardcoded port that drifts between dev/prod and i18n locales. */
export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined'
    ? (import.meta.env.PUBLIC_SITE_URL ?? 'http://localhost:4400')
    : window.location.origin,
});

export const { signIn, signUp, signOut, useSession } = authClient;
