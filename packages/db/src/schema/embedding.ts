import { sql } from 'drizzle-orm';
import {
  pgTable, varchar, integer, timestamp, customType, primaryKey,
} from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

/** pgvector `vector(N)` column. Stored/serialized as `[a,b,c]` literal text. */
export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'string') {
      const s = value.replace(/^\[|\]$/g, '');
      return s.length ? s.split(',').map(Number) : [];
    }
    return [];
  },
});

export const packageEmbedding = pgTable('package_embedding', {
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  locale: varchar('locale', { length: 8 }).notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  model: varchar('model', { length: 64 }).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  pk: primaryKey({ columns: [t.packageId, t.locale, t.model] }),
}));
