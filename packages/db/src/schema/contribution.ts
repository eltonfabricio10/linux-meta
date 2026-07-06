import { pgTable, serial, integer, text, varchar, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

export const volunteerApplication = pgTable('volunteer_application', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  requestedRole: varchar('requested_role', { length: 32 }).notNull(), // reviewer|translator|contributor
  bio: text('bio').notNull(),
  areas: text('areas'),
  languages: text('languages'),
  links: text('links'),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // pending|approved|rejected
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixUser: index('volunteer_application_user_idx').on(t.userId),
  ixStatus: index('volunteer_application_status_idx').on(t.status),
  ixCreated: index('volunteer_application_created_idx').on(t.createdAt),
}));

export const packageSubmission = pgTable('package_submission', {
  id: serial('id').primaryKey(),
  submitterUserId: text('submitter_user_id').notNull(),
  name: text('name').notNull(),
  source: varchar('source', { length: 32 }).notNull().default('user'),
  upstreamUrl: text('upstream_url'),
  summary: text('summary'),
  description: text('description'),
  justification: text('justification'),
  metadata: jsonb('metadata'),
  packageId: integer('package_id').references(() => packageTable.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // pending|approved|rejected
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixSubmitter: index('package_submission_submitter_idx').on(t.submitterUserId),
  ixStatus: index('package_submission_status_idx').on(t.status),
  ixCreated: index('package_submission_created_idx').on(t.createdAt),
}));
