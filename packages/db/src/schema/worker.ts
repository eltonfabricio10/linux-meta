import { pgTable, serial, text, varchar, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

/** worker_run — operational telemetry for background workers (ingest, AI,
 * embeddings). One row per run. `status` transitions running -> success|error.
 */
export const workerRun = pgTable('worker_run', {
  id: serial('id').primaryKey(),
  worker: varchar('worker', { length: 64 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: varchar('status', { length: 16 }).notNull().default('running'), // running|success|error
  itemsProcessed: integer('items_processed').notNull().default(0),
  errorsCount: integer('errors_count').notNull().default(0),
  errorSummary: text('error_summary'),
  meta: jsonb('meta'),
});
