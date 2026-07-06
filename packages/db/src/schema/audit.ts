import { pgTable, serial, text, jsonb, timestamp, varchar } from 'drizzle-orm/pg-core';

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  actor: text('actor'),                          // user.id or 'system'
  action: varchar('action', { length: 64 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
