import {
  pgTable, serial, integer, varchar, jsonb, text, timestamp, real, index,
} from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

/** Each row = a classification observation from one source for one package.
 *  Multiple rows per package are expected (OARS official + AI + reviewer). */
export const rating = pgTable('rating', {
  id: serial('id').primaryKey(),
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 32 }).notNull(),
  ageMin: integer('age_min').notNull(),
  oars: jsonb('oars'),
  confidence: real('confidence').notNull().default(1),
  classifierVersion: varchar('classifier_version', { length: 64 }),
  rationale: text('rationale'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixPkg: index('rating_package_idx').on(t.packageId),
  ixSource: index('rating_source_idx').on(t.source),
}));

/** Denormalized "effective" rating per package. Computed from `rating`.
 *  Rule: max age across active sources; human reviewer wins ties.
 *  For now this is a regular table updated by ingestors. */
export const ratingCurrent = pgTable('rating_current', {
  packageId: integer('package_id').primaryKey().references(() => packageTable.id, { onDelete: 'cascade' }),
  ageMin: integer('age_min').notNull(),
  dominantSource: varchar('dominant_source', { length: 32 }).notNull(),
  oars: jsonb('oars'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});
