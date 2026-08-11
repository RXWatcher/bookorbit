ALTER TABLE warehouse_catalog_items ADD COLUMN IF NOT EXISTS duration_seconds integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouse_catalog_items_duration_seconds_nonnegative_chk'
      AND conrelid = 'warehouse_catalog_items'::regclass
  ) THEN
    ALTER TABLE warehouse_catalog_items
      ADD CONSTRAINT warehouse_catalog_items_duration_seconds_nonnegative_chk
      CHECK (duration_seconds is null or duration_seconds >= 0);
  END IF;
END $$;
