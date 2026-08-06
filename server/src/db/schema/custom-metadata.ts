import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CustomMetadataFieldType } from '@bookorbit/types';

import { books } from './books';
import { libraries } from './libraries';

export const customMetadataFields = pgTable(
  'custom_metadata_fields',
  {
    id: serial('id').primaryKey(),
    key: varchar('key', { length: 100 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    type: varchar('type', { length: 20 }).$type<CustomMetadataFieldType>().notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('custom_metadata_fields_key_uidx').on(t.key),
    index('custom_metadata_fields_active_order_idx').on(t.archivedAt, t.displayOrder, t.label),
    check('custom_metadata_fields_type_chk', sql`${t.type} in ('text', 'url', 'number', 'date', 'boolean')`),
    check('custom_metadata_fields_key_format_chk', sql`${t.key} ~ '^[a-z0-9][a-z0-9_]{0,99}$'`),
    check('custom_metadata_fields_label_not_blank_chk', sql`length(btrim(${t.label})) > 0`),
    check('custom_metadata_fields_display_order_nonnegative_chk', sql`${t.displayOrder} >= 0`),
  ],
);

export const customMetadataLibraryFields = pgTable(
  'custom_metadata_library_fields',
  {
    fieldId: integer('field_id')
      .notNull()
      .references(() => customMetadataFields.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.libraryId, t.fieldId] }),
    index('custom_metadata_library_fields_field_idx').on(t.fieldId),
    index('custom_metadata_library_fields_library_order_idx').on(t.libraryId, t.displayOrder, t.fieldId),
    check('custom_metadata_library_fields_display_order_nonnegative_chk', sql`${t.displayOrder} >= 0`),
  ],
);

export const bookCustomMetadataValues = pgTable(
  'book_custom_metadata_values',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customMetadataFields.id, { onDelete: 'cascade' }),
    valueText: text('value_text'),
    valueNumber: doublePrecision('value_number'),
    valueDate: date('value_date', { mode: 'string' }),
    valueBoolean: boolean('value_boolean'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.fieldId] }),
    index('book_custom_metadata_values_field_idx').on(t.fieldId),
    check(
      'book_custom_metadata_values_single_value_chk',
      sql`(
        (${t.valueText} is not null)::int +
        (${t.valueNumber} is not null)::int +
        (${t.valueDate} is not null)::int +
        (${t.valueBoolean} is not null)::int
      ) <= 1`,
    ),
  ],
);

export type CustomMetadataField = typeof customMetadataFields.$inferSelect;
export type NewCustomMetadataField = typeof customMetadataFields.$inferInsert;
export type CustomMetadataLibraryField = typeof customMetadataLibraryFields.$inferSelect;
export type NewCustomMetadataLibraryField = typeof customMetadataLibraryFields.$inferInsert;
export type BookCustomMetadataValue = typeof bookCustomMetadataValues.$inferSelect;
export type NewBookCustomMetadataValue = typeof bookCustomMetadataValues.$inferInsert;
