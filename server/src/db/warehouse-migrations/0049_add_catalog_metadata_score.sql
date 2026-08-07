-- Materialise the metadata completeness score.
--
-- metadata-score-distribution recomputed a 19-term weighted score for every one
-- of ~348,000 rows and then sorted them four times for percentile_cont, on
-- every request. It timed out at the 30s statement_timeout even with the
-- catalogue fully cached.
--
-- The score stays defined in SQL rather than being reimplemented in the sync
-- mapper: it is 19 weighted presence checks across columns, jsonb payloads and
-- the detail table, and a TypeScript copy would drift from this one silently.
-- The column is refreshed by WarehouseRepository.refreshMetadataScores() after
-- each catalog sync, which runs the same statement as the backfill below.
ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN "metadata_score" integer;

-- The backfill touches every row and is deliberately exempt from the caller's
-- statement_timeout; it runs once.
SET LOCAL statement_timeout = 0;

UPDATE "warehouse_catalog_items" AS i
SET "metadata_score" = s.score
FROM (
  SELECT
    it."id" AS id,
    floor((
      (
        CASE WHEN nullif(trim(it."title"), '') IS NOT NULL THEN 10 ELSE 0 END +
        CASE WHEN jsonb_typeof(it."authors") = 'array' AND jsonb_array_length(it."authors") > 0 THEN 10 ELSE 0 END +
        CASE WHEN it."has_cover" = true THEN 10 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(
          it."raw_payload"->>'description', it."raw_payload"->>'summary', it."raw_payload"->>'overview',
          d."raw_payload"->>'description', d."raw_payload"->>'summary', d."raw_payload"->>'overview'
        )), '') IS NOT NULL THEN 8 ELSE 0 END +
        CASE WHEN jsonb_typeof(it."genres") = 'array' AND jsonb_array_length(it."genres") > 0 THEN 6 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'isbn13', it."identifiers"->>'isbn_13')), '') IS NOT NULL THEN 7 ELSE 0 END +
        CASE WHEN nullif(trim(it."publisher"), '') IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN coalesce(
          it."raw_payload"->>'publishedYear', it."raw_payload"->>'published_year',
          it."raw_payload"->>'publicationYear', it."raw_payload"->>'publication_year',
          left(nullif(coalesce(it."raw_payload"->>'publishedDate', it."raw_payload"->>'published_date'), ''), 4)
        ) ~ '^[0-9]{4}$' THEN 4 ELSE 0 END +
        CASE WHEN nullif(trim(it."language"), '') IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'isbn10', it."identifiers"->>'isbn_10')), '') IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN coalesce(
          it."raw_payload"->>'pageCount', it."raw_payload"->>'page_count', it."raw_payload"->>'pages'
        ) ~ '^[0-9]+$' THEN 2 ELSE 0 END +
        CASE WHEN coalesce(
          it."raw_payload"->>'rating', it."raw_payload"->>'averageRating', it."raw_payload"->>'average_rating'
        ) ~ '^[0-9]+(\.[0-9]+)?$' THEN 1 ELSE 0 END +
        CASE WHEN jsonb_typeof(it."tags") = 'array' AND jsonb_array_length(it."tags") > 0 THEN 2 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'googleBooksId', it."identifiers"->>'google_books_id')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'goodreadsId', it."identifiers"->>'goodreads_id')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'amazonId', it."identifiers"->>'amazon_id', it."identifiers"->>'asin')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'hardcoverId', it."identifiers"->>'hardcover_id')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'openLibraryId', it."identifiers"->>'open_library_id')), '') IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(it."identifiers"->>'itunesId', it."identifiers"->>'itunes_id', it."identifiers"->>'itunes')), '') IS NOT NULL THEN 1 ELSE 0 END
      )::numeric / 76
    ) * 100)::int AS score
  FROM "warehouse_catalog_items" it
  LEFT JOIN "warehouse_catalog_details" d
    ON d."media_type" = it."media_type" AND d."remote_id" = it."remote_id"
) AS s
WHERE i."id" = s.id;

CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_metadata_score_idx"
  ON "warehouse_catalog_items" ("media_type", "metadata_score");
