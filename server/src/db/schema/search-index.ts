import { index, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const searchIndexEntityTypeEnum = pgEnum('search_index_entity_type', ['catalog_item', 'native_book']);

export const searchIndexOperationEnum = pgEnum('search_index_operation', ['upsert', 'delete']);

export const searchIndexEvents = pgTable(
  'search_index_events',
  {
    id: serial('id').primaryKey(),
    entityType: searchIndexEntityTypeEnum('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    operation: searchIndexOperationEnum('operation').notNull(),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('search_index_events_enqueued_idx').on(t.enqueuedAt, t.id)],
);
