import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';

// Load .env from monorepo root so workers/db scripts work from any cwd.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });
import postgres from 'postgres';
import * as schema from './schema/index.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL not set');
}

const client = postgres(url, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  prepare: false,
  onnotice: () => {},
});

export const db = drizzle(client, { schema, casing: 'snake_case' });
export type DB = typeof db;
export { schema };
