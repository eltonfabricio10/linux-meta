/* Promote a user to a role. Run via:
 *   pnpm --filter @linux-meta/web exec tsx src/lib/_promote-user.ts <email> <role>
 * Roles: visitor|contributor|translator|reviewer|admin */
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

const email = process.argv[2];
const role = process.argv[3];
if (!email || !role) {
  console.error('usage: tsx _promote-user.ts <email> <role>');
  process.exit(2);
}
if (!['visitor', 'contributor', 'translator', 'reviewer', 'admin'].includes(role)) {
  console.error(`invalid role: ${role}`);
  process.exit(2);
}

const [u] = await db.select({ id: schema.user.id, role: schema.user.role })
  .from(schema.user).where(eq(schema.user.email, email)).limit(1);
if (!u) {
  console.error(`no user with email ${email}`);
  process.exit(1);
}
await db.update(schema.user).set({ role }).where(eq(schema.user.id, u.id));
console.log(`${email}: ${u.role} -> ${role}`);
process.exit(0);
