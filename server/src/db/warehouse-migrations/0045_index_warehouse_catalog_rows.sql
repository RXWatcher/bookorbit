CREATE TABLE IF NOT EXISTS "warehouse_catalog_item_authors" (
  "media_type" "warehouse_media_type" NOT NULL,
  "remote_id" varchar(128) NOT NULL,
  "author_id" bigint NOT NULL,
  "name" text NOT NULL,
  "canonical_name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "warehouse_catalog_item_authors_media_remote_author_pk" PRIMARY KEY("media_type","remote_id","author_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_item_authors_author_idx" ON "warehouse_catalog_item_authors" USING btree ("author_id","media_type","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_item_authors_canonical_idx" ON "warehouse_catalog_item_authors" USING btree ("canonical_name","media_type","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_item_authors_media_canonical_idx" ON "warehouse_catalog_item_authors" USING btree ("media_type","canonical_name","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_item_authors_name_trgm_idx" ON "warehouse_catalog_item_authors" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_series_norm_idx" ON "warehouse_catalog_items" USING btree ("media_type",lower(btrim("series")),"series_index","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_author_sort_idx" ON "warehouse_catalog_items" USING btree ("media_type",coalesce("authors"->>0, ''),"remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_series_sort_idx" ON "warehouse_catalog_items" USING btree ("media_type",coalesce("series", ''),"remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_narrator_sort_idx" ON "warehouse_catalog_items" USING btree ("media_type",coalesce("narrators"->>0, ''),"remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_sort_title_idx" ON "warehouse_catalog_items" USING btree ("media_type",coalesce("sort_title","title"),"remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_created_at_idx" ON "warehouse_catalog_items" USING btree ("media_type","created_at","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_duration_idx" ON "warehouse_catalog_items" USING btree ("media_type","duration_seconds","remote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_title_trgm_idx" ON "warehouse_catalog_items" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_series_trgm_idx" ON "warehouse_catalog_items" USING gin ("series" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_publisher_trgm_idx" ON "warehouse_catalog_items" USING gin ("publisher" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_language_idx" ON "warehouse_catalog_items" USING btree ("media_type","language");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_format_idx" ON "warehouse_catalog_items" USING btree ("media_type","format");
--> statement-breakpoint
INSERT INTO "warehouse_catalog_item_authors" ("media_type","remote_id","author_id","name","canonical_name","sort_order")
SELECT DISTINCT ON (media_type, remote_id, author_id)
  media_type,
  remote_id,
  author_id,
  display_name,
  lower(display_name),
  sort_order
FROM (
  SELECT
    item."media_type" as media_type,
    item."remote_id" as remote_id,
    -((('x' || substr(md5(lower(display_name)), 1, 13))::bit(52)::bigint) + 1000) as author_id,
    display_name,
    expanded.ordinality::integer - 1 as sort_order
  FROM "warehouse_catalog_items" item
  CROSS JOIN LATERAL jsonb_array_elements_text(item."authors") WITH ORDINALITY as author_value(name, ordinality)
  CROSS JOIN LATERAL regexp_split_to_table(btrim(author_value.name), '\s*(?:;|\s+&\s+|\s+and\s+)\s*') WITH ORDINALITY as expanded(name, ordinality)
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN array_length(regexp_split_to_array(btrim(expanded.name), '\s*,\s*'), 1) = 2
       AND split_part(btrim(expanded.name), ',', 1) !~ '\.'
       AND array_length(regexp_split_to_array(btrim(split_part(btrim(expanded.name), ',', 1)), '\s+'), 1) <= 2
       AND array_length(regexp_split_to_array(btrim(split_part(btrim(expanded.name), ',', 2)), '\s+'), 1) <= 3
        THEN btrim(split_part(btrim(expanded.name), ',', 2)) || ' ' || btrim(split_part(btrim(expanded.name), ',', 1))
      ELSE btrim(expanded.name)
    END as display_name
  ) normalized
  WHERE nullif(display_name, '') is not null
) rows
ON CONFLICT DO NOTHING;
