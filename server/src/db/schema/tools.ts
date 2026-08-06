import { boolean, index, integer, pgTable, real, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const dismissedDuplicatePairs = pgTable(
  'dismissed_duplicate_pairs',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityIdA: integer('entity_id_a').notNull(),
    entityIdB: integer('entity_id_b').notNull(),
    reason: text('reason'),
    dismissedBy: integer('dismissed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dismissed_duplicate_pairs_unique').on(t.entityType, t.entityIdA, t.entityIdB),
    index('dismissed_duplicate_pairs_entity_a_idx').on(t.entityType, t.entityIdA),
    index('dismissed_duplicate_pairs_entity_b_idx').on(t.entityType, t.entityIdB),
  ],
);

export type DismissedDuplicatePair = typeof dismissedDuplicatePairs.$inferSelect;
export type NewDismissedDuplicatePair = typeof dismissedDuplicatePairs.$inferInsert;

export const dismissedInlineDuplicatePairs = pgTable(
  'dismissed_inline_duplicate_pairs',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    valueA: varchar('value_a', { length: 500 }).notNull(),
    valueB: varchar('value_b', { length: 500 }).notNull(),
    reason: text('reason'),
    dismissedBy: integer('dismissed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dismissed_inline_duplicate_pairs_unique').on(t.entityType, t.valueA, t.valueB),
    index('dismissed_inline_pairs_entity_a_idx').on(t.entityType, t.valueA),
    index('dismissed_inline_pairs_entity_b_idx').on(t.entityType, t.valueB),
  ],
);

export type DismissedInlineDuplicatePair = typeof dismissedInlineDuplicatePairs.$inferSelect;
export type NewDismissedInlineDuplicatePair = typeof dismissedInlineDuplicatePairs.$inferInsert;

export const entityDuplicateCandidates = pgTable(
  'entity_duplicate_candidates',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityIdA: integer('entity_id_a').notNull(),
    entityIdB: integer('entity_id_b').notNull(),
    simScore: real('sim_score').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_duplicate_candidates_unique').on(t.entityType, t.entityIdA, t.entityIdB),
    index('entity_dup_candidates_type_sim_idx').on(t.entityType, t.simScore),
    index('entity_dup_candidates_entity_a_idx').on(t.entityType, t.entityIdA),
    index('entity_dup_candidates_entity_b_idx').on(t.entityType, t.entityIdB),
  ],
);

export type EntityDuplicateCandidate = typeof entityDuplicateCandidates.$inferSelect;
export type NewEntityDuplicateCandidate = typeof entityDuplicateCandidates.$inferInsert;

export const entityDuplicateScanStatus = pgTable('entity_duplicate_scan_status', {
  entityType: varchar('entity_type', { length: 50 }).primaryKey(),
  isComputing: boolean('is_computing').notNull().default(false),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  totalPairs: integer('total_pairs'),
  threshold: real('threshold'),
  processedCount: integer('processed_count'),
  totalCount: integer('total_count'),
  errorMessage: text('error_message'),
});

export type EntityDuplicateScanStatus = typeof entityDuplicateScanStatus.$inferSelect;
