/** Role helpers. Better Auth session doesn't include the `role` column yet,
 * so we look it up from the `user` table by id. Keep this dependency-light
 * and cache nothing — calls are infrequent (admin pages + API mutations).
 */
import { db, schema } from '~/lib/db';
import { eq } from 'drizzle-orm';

export type Role = 'visitor' | 'contributor' | 'translator' | 'reviewer' | 'admin';

export async function getUserRole(userId: string | null | undefined): Promise<Role> {
  if (!userId) return 'visitor';
  const [row] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return ((row?.role as Role) ?? 'visitor');
}

export function hasRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}

/** Where a logged-in user should land for their main job. Path is locale-relative
 * (prefix with the locale). Visitors/contributors get the public browse page. */
export function landingFor(role: Role): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'reviewer': return '/revisar/queue';
    case 'translator': return '/traduzir';
    default: return '/browse';
  }
}
