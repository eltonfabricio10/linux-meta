import { sql } from 'drizzle-orm';
import {
  pgTable, serial, text, varchar, integer, timestamp, jsonb,
  uniqueIndex, index, bigint,
} from 'drizzle-orm/pg-core';

export const packageTable = pgTable('package', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 32 }).notNull(), // manjaro|aur|flathub|appstream|debian|...
  sourceId: text('source_id').notNull(),               // pkgname in source
  name: text('name').notNull(),
  slug: varchar('slug', { length: 220 }).notNull(),
  canonicalSlug: varchar('canonical_slug', { length: 220 }),
  upstreamUrl: text('upstream_url'),
  licenseSpdx: text('license_spdx'),
  latestVersionDistro: text('latest_version_distro'),
  latestVersionUpstream: text('latest_version_upstream'),
  iconUrl: text('icon_url'),
  popularity: integer('popularity').notNull().default(0),
  installSizeKb: bigint('install_size_kb', { mode: 'number' }),
  rawMetadata: jsonb('raw_metadata'),
  moderationStatus: varchar('moderation_status', { length: 16 }).notNull().default('approved'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uxSource: uniqueIndex('package_source_uid').on(t.source, t.sourceId),
  ixSlug: index('package_slug_idx').on(t.slug),
  ixCanonical: index('package_canonical_slug_idx').on(t.canonicalSlug),
  ixModeration: index('package_moderation_status_idx').on(t.moderationStatus),
  /* Expression index: lets searches/detail aggregate across siblings sharing the
   * same canonical group without a Seq Scan. Used in lib/packages.ts LATERAL
   * lookups for translations + variant aggregation. */
  ixCanonicalOrSlug: index('package_canonical_or_slug_idx').on(sql`(COALESCE(canonical_slug, slug))`),
  ixName: index('package_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ixPop: index('package_popularity_idx').on(t.popularity),
}));

export const packageTranslation = pgTable('package_translation', {
  packageId: integer('package_id').notNull().references(() => packageTable.id, { onDelete: 'cascade' }),
  locale: varchar('locale', { length: 8 }).notNull(),
  summary: text('summary'),
  description: text('description'),
  plainExplanation: text('plain_explanation'),
  summarySource: varchar('summary_source', { length: 64 }),
  descriptionSource: varchar('description_source', { length: 64 }),
  plainExplanationSource: varchar('plain_explanation_source', { length: 64 }),
  translatedBy: varchar('translated_by', { length: 64 }), // 'upstream'|'ai_claude_code'|'ai_codex'|'human'
  reviewedBy: text('reviewed_by'),                        // user.id
  status: varchar('status', { length: 16 }).notNull().default('draft'), // draft|reviewed|official
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: uniqueIndex('package_translation_pk').on(t.packageId, t.locale),
}));

export const packageOfficialMetadata = pgTable('package_official_metadata', {
  packageId: integer('package_id').primaryKey().references(() => packageTable.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 32 }).notNull(),
  sourceId: text('source_id').notNull(),
  repo: text('repo'),
  officialName: text('official_name').notNull(),
  officialSummary: text('official_summary'),
  officialVersion: text('official_version'),
  officialUrl: text('official_url'),
  officialLicense: text('official_license'),
  installSizeKb: bigint('install_size_kb', { mode: 'number' }),
  popularity: integer('popularity'),
  rawMetadata: jsonb('raw_metadata').notNull(),
  extractedFrom: text('extracted_from').notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ixSource: index('package_official_metadata_source_idx').on(t.source),
  ixName: index('package_official_metadata_name_idx').on(t.officialName),
}));
