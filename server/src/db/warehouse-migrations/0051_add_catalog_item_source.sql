-- Distinguish rows synced from the Book Warehouse from rows discovered by
-- scanning the local filesystem, so the two can share one table and one set of
-- indexes without a query time union.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'catalog_item_source') THEN
    CREATE TYPE "catalog_item_source" AS ENUM ('warehouse', 'local');
  END IF;
END
$$;

ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN IF NOT EXISTS "source" "catalog_item_source" DEFAULT 'warehouse' NOT NULL;

ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN IF NOT EXISTS "local_path" text;

CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_source_idx"
  ON "warehouse_catalog_items" ("media_type", "source");

ALTER TABLE "warehouse_catalog_items"
  DROP CONSTRAINT IF EXISTS "warehouse_catalog_items_local_path_chk";

ALTER TABLE "warehouse_catalog_items"
  ADD CONSTRAINT "warehouse_catalog_items_local_path_chk"
  CHECK ("source" <> 'local' OR "local_path" IS NOT NULL);
