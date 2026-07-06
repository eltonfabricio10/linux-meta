import {
  pgTable, serial, integer, varchar, jsonb, text, timestamp, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

export const permissionAnalysis = pgTable('permission_analysis', {
  id: serial('id').primaryKey(),
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 32 }).notNull(),
  perms: jsonb('perms').notNull(),
  riskLevel: varchar('risk_level', { length: 16 }).notNull().default('unknown'),
  summary: text('summary'),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uxPkgSrc: uniqueIndex('permission_analysis_pkg_src').on(t.packageId, t.source),
  ixRisk: index('permission_analysis_risk_idx').on(t.riskLevel),
}));

export const cveLink = pgTable('cve_link', {
  id: serial('id').primaryKey(),
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  cveId: varchar('cve_id', { length: 32 }).notNull(),
  severity: varchar('severity', { length: 16 }).notNull().default('unknown'),
  summary: text('summary'),
  fixedInVersion: text('fixed_in_version'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixPkg: index('cve_link_package_idx').on(t.packageId),
  ixCve: index('cve_link_cve_idx').on(t.cveId),
}));

export const projectHealth = pgTable('project_health', {
  packageId: integer('package_id').primaryKey().references(() => packageTable.id, { onDelete: 'cascade' }),
  lastCommitAt: timestamp('last_commit_at', { withTimezone: true }),
  commits90d: integer('commits_90d'),
  issuesOpen: integer('issues_open'),
  issuesClosed: integer('issues_closed'),
  maintainersActive: integer('maintainers_active'),
  status: varchar('status', { length: 16 }).notNull().default('unknown'),
  host: varchar('host', { length: 32 }),
  repoSlug: text('repo_slug'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});
