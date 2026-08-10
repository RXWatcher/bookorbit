-- Outbox for the search index. Rows are written in the same transaction as the data change,
-- so the index cannot silently drift from the database, and a failed drain simply retries.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'search_index_entity_type') THEN
    CREATE TYPE "search_index_entity_type" AS ENUM ('catalog_item', 'native_book');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'search_index_operation') THEN
    CREATE TYPE "search_index_operation" AS ENUM ('upsert', 'delete');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "search_index_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" "search_index_entity_type" NOT NULL,
  "entity_id" text NOT NULL,
  "operation" "search_index_operation" NOT NULL,
  "enqueued_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "search_index_events_enqueued_idx"
  ON "search_index_events" ("enqueued_at", "id");
