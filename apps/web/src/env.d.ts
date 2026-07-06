/// <reference path="../.astro/types.d.ts" />

import type { auth as authInstance } from '~/lib/auth';
import type { Role } from '~/lib/roles';

declare global {
  namespace App {
    interface Locals {
      user: typeof authInstance.$Infer.Session.user | null;
      session: typeof authInstance.$Infer.Session.session | null;
      /** Role of `user`, resolved once per request by middleware.
       * `null` when anonymous. */
      role: Role | null;
    }
  }
}

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL: string;
  readonly PUBLIC_SITE_URL: string;
  readonly PUBLIC_DEFAULT_LOCALE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
