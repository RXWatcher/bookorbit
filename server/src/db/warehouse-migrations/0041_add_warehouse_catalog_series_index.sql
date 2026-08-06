ALTER TABLE "warehouse_catalog_items" ADD COLUMN IF NOT EXISTS "series_index" real;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_series_idx" ON "warehouse_catalog_items" USING btree ("media_type","series","series_index");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_catalog_items" ADD CONSTRAINT "warehouse_catalog_items_series_index_nonnegative_chk" CHECK ("series_index" is null or "series_index" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
