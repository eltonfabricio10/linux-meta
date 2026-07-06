/* Seed dev admin user. Idempotent: skips if email exists.
 * Run via:
 *   pnpm --filter @linux-meta/web exec tsx src/lib/_seed-admin.ts
 *
 * Reads env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME.
 * Defaults: admin@local.test / changeme-dev-only-1234 / Dev Admin.
 * Production-safe: refuses to run if NODE_ENV='production'. */
import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { auth } from './auth';

if (process.env.NODE_ENV === 'production') {
  console.error('[seed-admin] refuses to run in production');
  process.exit(2);
}

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme-dev-only-1234';
const name = process.env.SEED_ADMIN_NAME ?? 'Dev Admin';

const [existing] = await db.select({ id: schema.user.id, role: schema.user.role })
  .from(schema.user).where(eq(schema.user.email, email)).limit(1);

if (existing) {
  if (existing.role !== 'admin') {
    await db.update(schema.user).set({ role: 'admin' })
      .where(eq(schema.user.id, existing.id));
    console.log(`[seed-admin] promoted existing ${email} to admin`);
  } else {
    console.log(`[seed-admin] ${email} already admin, nothing to do`);
  }
  process.exit(0);
}

try {
  await auth.api.signUpEmail({ body: { email, password, name } });
} catch (err) {
  console.error('[seed-admin] signUpEmail failed:', (err as Error).message);
  process.exit(1);
}

const [created] = await db.select({ id: schema.user.id })
  .from(schema.user).where(eq(schema.user.email, email)).limit(1);
if (!created) {
  console.error('[seed-admin] user not found after signup');
  process.exit(1);
}
await db.update(schema.user).set({ role: 'admin' })
  .where(eq(schema.user.id, created.id));
console.log(`[seed-admin] created ${email} (password: ${password}) as admin`);
process.exit(0);
