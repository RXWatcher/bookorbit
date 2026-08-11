import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgEnum, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { warehouseMediaTypeEnum } from './warehouse';

export const localScanStatusEnum = pgEnum('local_scan_status', ['idle', 'running', 'completed', 'failed']);

export const localScanRoots = pgTable(
  'local_scan_roots',
  {
    id: serial('id').primaryKey(),
    mediaType: warehouseMediaTypeEnum('media_type').notNull(),
    absolutePath: text('absolute_path').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    excludePatterns: jsonb('exclude_patterns')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastScanStartedAt: timestamp('last_scan_started_at', { withTimezone: true }),
    lastScanFinishedAt: timestamp('last_scan_finished_at', { withTimezone: true }),
    lastScanStatus: localScanStatusEnum('last_scan_status').notNull().default('idle'),
    lastScanError: text('last_scan_error'),
    lastScanSummary: jsonb('last_scan_summary').$type<Record<string, number>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique('local_scan_roots_media_path_unique').on(t.mediaType, t.absolutePath)],
);
