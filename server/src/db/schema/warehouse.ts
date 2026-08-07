import { sql } from 'drizzle-orm';
import type { WarehouseUserReadStatus } from '@bookorbit/types';
import {
  boolean,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

export const warehouseMediaTypeEnum = pgEnum('warehouse_media_type', ['ebook', 'audiobook', 'comic']);

export const warehouseSyncMediaTypeEnum = pgEnum('warehouse_sync_media_type', ['ebook', 'audiobook', 'comic', 'mixed']);

export const warehouseSyncStatusEnum = pgEnum('warehouse_sync_status', ['running', 'completed', 'failed']);

export const warehouseRequestStatusEnum = pgEnum('warehouse_request_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'unknown',
]);

export const warehouseSettings = pgTable(
  'warehouse_settings',
  {
    id: serial('id').primaryKey(),
    profileKey: varchar('profile_key', { length: 64 }).notNull().default('default'),
    enabled: boolean('enabled').notNull().default(false),
    baseUrl: varchar('base_url', { length: 512 }).notNull(),
    apiKeyEncrypted: text('api_key_encrypted'),
    apiKeyNonce: varchar('api_key_nonce', { length: 32 }),
    apiKeyTag: varchar('api_key_tag', { length: 32 }),
    syncCadenceMinutes: integer('sync_cadence_minutes').notNull().default(360),
    ebookLibraryIcon: varchar('ebook_library_icon', { length: 100 }).notNull().default('BookOpen'),
    audiobookLibraryIcon: varchar('audiobook_library_icon', { length: 100 }).notNull().default('Headphones'),
    comicLibraryIcon: varchar('comic_library_icon', { length: 100 }).notNull().default('PanelsTopLeft'),
    lastConnectionStatus: varchar('last_connection_status', { length: 16 }).notNull().default('untested'),
    lastConnectionCheckedAt: timestamp('last_connection_checked_at', { withTimezone: true }),
    lastConnectionError: text('last_connection_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique('warehouse_settings_profile_key_unique').on(t.profileKey)],
);

export const warehouseCatalogItems = pgTable(
  'warehouse_catalog_items',
  {
    id: serial('id').primaryKey(),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    sortTitle: text('sort_title'),
    authors: jsonb('authors')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    narrators: jsonb('narrators')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    series: text('series'),
    seriesIndex: real('series_index'),
    genres: jsonb('genres')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    tags: jsonb('tags')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    language: varchar('language', { length: 32 }),
    publisher: text('publisher'),
    identifiers: jsonb('identifiers')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    format: varchar('format', { length: 64 }),
    durationSeconds: integer('duration_seconds'),
    /** Materialised from raw_payload at sync time — see migration 0048. The
     *  statistics aggregates read this instead of re-deriving it per row,
     *  which for audiobooks meant a correlated subquery over the files array
     *  and four endpoints timing out. */
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    /** Materialised metadata completeness score, 0-100 — see migration 0049.
     *  Refreshed by refreshMetadataScores() after each catalog sync. */
    metadataScore: integer('metadata_score'),
    hasCover: boolean('has_cover').notNull().default(false),
    upstreamCreatedAt: timestamp('upstream_created_at', { withTimezone: true }),
    upstreamUpdatedAt: timestamp('upstream_updated_at', { withTimezone: true }),
    rawPayload: jsonb('raw_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique('warehouse_catalog_items_media_remote_unique').on(t.mediaType, t.remoteId),
    index('warehouse_catalog_items_media_type_idx').on(t.mediaType),
    index('warehouse_catalog_items_title_idx').on(t.title),
    index('warehouse_catalog_items_series_idx').on(t.mediaType, t.series, t.seriesIndex),
    index('warehouse_catalog_items_series_norm_idx').on(t.mediaType, sql`lower(btrim(${t.series}))`, t.seriesIndex, t.remoteId),
    index('warehouse_catalog_items_author_sort_idx').on(t.mediaType, sql`coalesce(${t.authors}->>0, '')`, t.remoteId),
    index('warehouse_catalog_items_series_sort_idx').on(t.mediaType, sql`coalesce(${t.series}, '')`, t.remoteId),
    index('warehouse_catalog_items_narrator_sort_idx').on(t.mediaType, sql`coalesce(${t.narrators}->>0, '')`, t.remoteId),
    index('warehouse_catalog_items_sort_title_idx').on(t.mediaType, sql`coalesce(${t.sortTitle}, ${t.title})`, t.remoteId),
    index('warehouse_catalog_items_created_at_idx').on(t.mediaType, t.createdAt, t.remoteId),
    index('warehouse_catalog_items_duration_idx').on(t.mediaType, t.durationSeconds, t.remoteId),
    index('warehouse_catalog_items_synced_at_idx').on(t.syncedAt),
    index('warehouse_catalog_items_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('warehouse_catalog_items_series_trgm_idx').using('gin', t.series.op('gin_trgm_ops')),
    index('warehouse_catalog_items_publisher_trgm_idx').using('gin', t.publisher.op('gin_trgm_ops')),
    index('warehouse_catalog_items_language_idx').on(t.mediaType, t.language),
    index('warehouse_catalog_items_format_idx').on(t.mediaType, t.format),
    check('warehouse_catalog_items_series_index_nonnegative_chk', sql`${t.seriesIndex} is null or ${t.seriesIndex} >= 0`),
    check('warehouse_catalog_items_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`),
  ],
);

export const warehouseCatalogItemAuthors = pgTable(
  'warehouse_catalog_item_authors',
  {
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    authorId: bigint('author_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    canonicalName: text('canonical_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.mediaType, t.remoteId, t.authorId] }),
    index('warehouse_catalog_item_authors_author_idx').on(t.authorId, t.mediaType, t.remoteId),
    index('warehouse_catalog_item_authors_canonical_idx').on(t.canonicalName, t.mediaType, t.remoteId),
    index('warehouse_catalog_item_authors_media_canonical_idx').on(t.mediaType, t.canonicalName, t.remoteId),
    index('warehouse_catalog_item_authors_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

export const warehouseCatalogDetails = pgTable(
  'warehouse_catalog_details',
  {
    id: serial('id').primaryKey(),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    rawPayload: jsonb('raw_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('warehouse_catalog_details_media_remote_unique').on(t.mediaType, t.remoteId),
    index('warehouse_catalog_details_fetched_at_idx').on(t.fetchedAt),
  ],
);

export const warehouseUserItems = pgTable(
  'warehouse_user_items',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaType, t.remoteId] }),
    index('warehouse_user_items_user_media_idx').on(t.userId, t.mediaType, t.addedAt),
    index('warehouse_user_items_media_remote_idx').on(t.mediaType, t.remoteId),
  ],
);

export const warehouseUserState = pgTable(
  'warehouse_user_state',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    favorite: boolean('favorite').notNull().default(false),
    rating: integer('rating'),
    readStatus: varchar('read_status', { length: 20 }).$type<WarehouseUserReadStatus>(),
    progressPercent: real('progress_percent'),
    positionSeconds: real('position_seconds'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaType, t.remoteId] }),
    index('warehouse_user_state_user_media_updated_idx').on(t.userId, t.mediaType, t.updatedAt),
    index('warehouse_user_state_user_finished_idx').on(t.userId, t.finishedAt),
    index('warehouse_user_state_media_remote_idx').on(t.mediaType, t.remoteId),
    check('warehouse_user_state_rating_range_chk', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check(
      'warehouse_user_state_read_status_chk',
      sql`${t.readStatus} is null or ${t.readStatus} in ('unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned')`,
    ),
    check('warehouse_user_state_progress_percent_range_chk', sql`${t.progressPercent} is null or ${t.progressPercent} between 0 and 100`),
    check('warehouse_user_state_position_seconds_nonnegative_chk', sql`${t.positionSeconds} is null or ${t.positionSeconds} >= 0`),
  ],
);

export const warehouseBookmarks = pgTable(
  'warehouse_bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    cfi: varchar('cfi', { length: 2000 }),
    title: varchar('title', { length: 500 }).notNull(),
    positionSeconds: real('position_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('warehouse_bookmarks_user_item_idx').on(t.userId, t.mediaType, t.remoteId),
    uniqueIndex('warehouse_bookmarks_user_item_cfi_uidx')
      .on(t.userId, t.mediaType, t.remoteId, t.cfi)
      .where(sql`${t.cfi} is not null`),
    uniqueIndex('warehouse_bookmarks_user_item_pos_uidx')
      .on(t.userId, t.mediaType, t.remoteId, t.positionSeconds)
      .where(sql`${t.positionSeconds} is not null and ${t.cfi} is null`),
    check('warehouse_bookmarks_position_seconds_nonnegative_chk', sql`${t.positionSeconds} is null or ${t.positionSeconds} >= 0`),
  ],
);

export const warehouseAnnotations = pgTable(
  'warehouse_annotations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    cfi: varchar('cfi', { length: 2000 }).notNull(),
    text: text('text').notNull(),
    color: varchar('color', { length: 32 }).notNull().default('yellow'),
    style: varchar('style', { length: 32 }).notNull().default('highlight'),
    note: text('note'),
    chapterTitle: varchar('chapter_title', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('warehouse_annotations_user_item_idx').on(t.userId, t.mediaType, t.remoteId),
    index('warehouse_annotations_user_item_cfi_idx').on(t.userId, t.mediaType, t.remoteId, t.cfi),
    check('warehouse_annotations_style_chk', sql`${t.style} in ('highlight', 'underline', 'strikethrough', 'squiggly')`),
  ],
);

export const warehouseReadingSessions = pgTable(
  'warehouse_reading_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    remoteId: varchar('remote_id', { length: 128 }).notNull(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    progressDelta: real('progress_delta'),
    endProgress: real('end_progress'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('wrs_user_session_id_uidx').on(t.userId, t.sessionId),
    index('wrs_user_item_started_idx').on(t.userId, t.mediaType, t.remoteId, t.startedAt),
    index('wrs_item_started_idx').on(t.mediaType, t.remoteId, t.startedAt),
    check('warehouse_reading_sessions_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} >= 0`),
    check('warehouse_reading_sessions_end_progress_range_chk', sql`${t.endProgress} is null or (${t.endProgress} >= 0 and ${t.endProgress} <= 100)`),
    check('warehouse_reading_sessions_ended_after_started_chk', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const warehouseRequests = pgTable(
  'warehouse_requests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    upstreamRequestId: varchar('upstream_request_id', { length: 128 }),
    status: warehouseRequestStatusEnum('status').notNull().default('unknown'),
    title: text('title').notNull(),
    author: text('author'),
    isbn: varchar('isbn', { length: 32 }),
    requestedPayload: jsonb('requested_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    completedRemoteId: varchar('completed_remote_id', { length: 128 }),
    lastStatusSyncedAt: timestamp('last_status_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('warehouse_requests_user_status_idx').on(t.userId, t.status),
    index('warehouse_requests_media_status_idx').on(t.mediaType, t.status),
    index('warehouse_requests_upstream_request_idx').on(t.upstreamRequestId),
  ],
);

export const warehouseCatalogSyncRuns = pgTable(
  'warehouse_catalog_sync_runs',
  {
    id: serial('id').primaryKey(),
    mediaType: warehouseSyncMediaTypeEnum('media_type').notNull(),
    status: warehouseSyncStatusEnum('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    fetchedCount: integer('fetched_count').notNull().default(0),
    savedCount: integer('saved_count').notNull().default(0),
    errorMessage: text('error_message'),
    timings: jsonb('timings')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('warehouse_catalog_sync_runs_status_idx').on(t.status),
    index('warehouse_catalog_sync_runs_media_started_idx').on(t.mediaType, t.startedAt),
  ],
);

export type WarehouseSettingRow = typeof warehouseSettings.$inferSelect;
export type NewWarehouseSettingRow = typeof warehouseSettings.$inferInsert;
export type WarehouseCatalogItemRow = typeof warehouseCatalogItems.$inferSelect;
export type NewWarehouseCatalogItemRow = typeof warehouseCatalogItems.$inferInsert;
export type WarehouseCatalogItemAuthorRow = typeof warehouseCatalogItemAuthors.$inferSelect;
export type NewWarehouseCatalogItemAuthorRow = typeof warehouseCatalogItemAuthors.$inferInsert;
export type WarehouseCatalogDetailRow = typeof warehouseCatalogDetails.$inferSelect;
export type NewWarehouseCatalogDetailRow = typeof warehouseCatalogDetails.$inferInsert;
export type WarehouseUserItemRow = typeof warehouseUserItems.$inferSelect;
export type NewWarehouseUserItemRow = typeof warehouseUserItems.$inferInsert;
export type WarehouseUserStateRow = typeof warehouseUserState.$inferSelect;
export type NewWarehouseUserStateRow = typeof warehouseUserState.$inferInsert;
export type WarehouseBookmarkRow = typeof warehouseBookmarks.$inferSelect;
export type NewWarehouseBookmarkRow = typeof warehouseBookmarks.$inferInsert;
export type WarehouseAnnotationRow = typeof warehouseAnnotations.$inferSelect;
export type NewWarehouseAnnotationRow = typeof warehouseAnnotations.$inferInsert;
export type WarehouseReadingSessionRow = typeof warehouseReadingSessions.$inferSelect;
export type NewWarehouseReadingSessionRow = typeof warehouseReadingSessions.$inferInsert;
export type WarehouseRequestRow = typeof warehouseRequests.$inferSelect;
export type NewWarehouseRequestRow = typeof warehouseRequests.$inferInsert;
export type WarehouseCatalogSyncRunRow = typeof warehouseCatalogSyncRuns.$inferSelect;
export type NewWarehouseCatalogSyncRunRow = typeof warehouseCatalogSyncRuns.$inferInsert;
