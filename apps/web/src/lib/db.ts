/** Re-export of the shared DB client so app code imports look local. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { db as baseDb, schema } from '@linux-meta/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Re-create drizzle with a `query` builder that knows the schema (for findFirst etc.).
const url = process.env.DATABASE_URL!;
const client = postgres(url, { prepare: false, max: 10, onnotice: () => {} });
export const db = drizzle(client, { schema, casing: 'snake_case' });
export { schema };
export type DB = typeof db;
void baseDb;
