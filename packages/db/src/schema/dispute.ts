import { pgTable, serial, integer, text, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

export const dispute = pgTable('dispute', {
  id: serial('id').primaryKey(),
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  reporterEmail: text('reporter_email'),
  reporterUserId: text('reporter_user_id'),
  suggestedAge: integer('suggested_age').notNull(),
  reason: text('reason').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('open'), // open|reviewing|resolved|rejected
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixPkg: index('dispute_package_idx').on(t.packageId),
  ixStatus: index('dispute_status_idx').on(t.status),
  ixCreated: index('dispute_created_idx').on(t.createdAt),
}));
