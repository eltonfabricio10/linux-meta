import {
  boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar,
} from 'drizzle-orm/pg-core';
import { packageTable } from './package.ts';

export const packageProfile = pgTable('package_profile', {
  packageId: integer('package_id').primaryKey().references(() => packageTable.id, { onDelete: 'cascade' }),
  componentType: varchar('component_type', { length: 40 }).notNull().default('unknown'),
  interfaceKinds: jsonb('interface_kinds').notNull().default([]),
  audienceTags: jsonb('audience_tags').notNull().default([]),
  launchable: boolean('launchable').notNull().default(false),
  launchKind: varchar('launch_kind', { length: 32 }).notNull().default('none'),
  launchId: text('launch_id'),
  launchCommand: text('launch_command'),
  launchSource: varchar('launch_source', { length: 32 }).notNull().default('unknown'),
  launchConfidence: varchar('launch_confidence', { length: 16 }).notNull().default('unknown'),
  providedBinaries: jsonb('provided_binaries').notNull().default([]),
  providedLibraries: jsonb('provided_libraries').notNull().default([]),
  mimeTypes: jsonb('mime_types').notNull().default([]),
  keywords: jsonb('keywords').notNull().default([]),
  requiresTerminal: boolean('requires_terminal').notNull().default(false),
  isBackgroundService: boolean('is_background_service').notNull().default(false),
  isDependencyOnly: boolean('is_dependency_only').notNull().default(false),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixComponent: index('package_profile_component_type_idx').on(t.componentType),
  ixLaunchable: index('package_profile_launchable_idx').on(t.launchable),
  ixLaunchKind: index('package_profile_launch_kind_idx').on(t.launchKind),
  ixDependencyOnly: index('package_profile_dependency_only_idx').on(t.isDependencyOnly),
}));

export const packageScreenshot = pgTable('package_screenshot', {
  id: serial('id').primaryKey(),
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  locale: varchar('locale', { length: 8 }),
  url: text('url').notNull(),
  caption: text('caption'),
  width: integer('width'),
  height: integer('height'),
  source: varchar('source', { length: 32 }).notNull().default('admin'),
  status: varchar('status', { length: 16 }).notNull().default('draft'),
  sortOrder: integer('sort_order').notNull().default(0),
  addedBy: text('added_by'),
  reviewedBy: text('reviewed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixPackage: index('package_screenshot_package_idx').on(t.packageId),
  ixStatus: index('package_screenshot_status_idx').on(t.status),
  ixPackageOrder: index('package_screenshot_package_order_idx').on(t.packageId, t.sortOrder),
}));
