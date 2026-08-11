-- Materialise the published year.
--
-- publication-year-timeline derived it per row from raw_payload — eight jsonb
-- extractions and two regex tests across ~348,000 rows on every request — and
-- was the last statistics endpoint still slow (~14s warm, 30s timeout cold).
-- Same treatment as file_size_bytes (0048) and metadata_score (0049).
ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN "published_year" integer;

SET LOCAL statement_timeout = 0;

UPDATE "warehouse_catalog_items"
SET "published_year" = CASE
  WHEN COALESCE(
    "raw_payload"->>'publishedYear', "raw_payload"->>'published_year',
    "raw_payload"->>'publicationYear', "raw_payload"->>'publication_year'
  ) ~ '^[0-9]{4}$'
    THEN COALESCE(
      "raw_payload"->>'publishedYear', "raw_payload"->>'published_year',
      "raw_payload"->>'publicationYear', "raw_payload"->>'publication_year'
    )::int
  WHEN COALESCE(
    "raw_payload"->>'publishedDate', "raw_payload"->>'published_date',
    "raw_payload"->>'releaseDate', "raw_payload"->>'release_date'
  ) ~ '^[0-9]{4}'
    THEN substring(COALESCE(
      "raw_payload"->>'publishedDate', "raw_payload"->>'published_date',
      "raw_payload"->>'releaseDate', "raw_payload"->>'release_date'
    ) FROM 1 FOR 4)::int
  ELSE NULL
END;

CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_published_year_idx"
  ON "warehouse_catalog_items" ("media_type", "published_year");
