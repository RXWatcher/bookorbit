-- Materialise each catalogue item's file size.
--
-- The statistics queries derived it per row from raw_payload, and for
-- audiobooks that meant a correlated subquery over
-- jsonb_array_elements(raw_payload->'files') — executed for every one of
-- ~184,000 rows, because audiobooks carry no top-level size (the warehouse's
-- Audiobook model has none; only its per-file rows do). Four endpoints hit the
-- 30s statement_timeout because of it, and no index can help: Postgres cannot
-- index an expression containing a subquery.
--
-- Storing the value turns those aggregates into a plain column scan. A
-- comparable grouped scan of this table runs in about 97 ms.
ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN "file_size_bytes" bigint;

-- Ebooks publish it at the top level under several spellings.
UPDATE "warehouse_catalog_items"
SET "file_size_bytes" = NULLIF(
  COALESCE(
    "raw_payload"->>'fileSizeBytes',
    "raw_payload"->>'file_size_bytes',
    "raw_payload"->>'sizeBytes',
    "raw_payload"->>'size_bytes',
    "raw_payload"->>'fileSize',
    "raw_payload"->>'file_size',
    "raw_payload"->>'bytes',
    "raw_payload"->>'size'
  ), ''
)::bigint
WHERE "file_size_bytes" IS NULL
  AND COALESCE(
    "raw_payload"->>'fileSizeBytes',
    "raw_payload"->>'file_size_bytes',
    "raw_payload"->>'sizeBytes',
    "raw_payload"->>'size_bytes',
    "raw_payload"->>'fileSize',
    "raw_payload"->>'file_size',
    "raw_payload"->>'bytes',
    "raw_payload"->>'size'
  ) ~ '^[0-9]+$';

-- Audiobooks only have per-file sizes, so sum them. One set-based pass here
-- replaces the per-row lateral every statistics query was paying for.
UPDATE "warehouse_catalog_items" AS i
SET "file_size_bytes" = f.total
FROM (
  SELECT
    it."id" AS id,
    SUM(
      NULLIF(
        COALESCE(
          fi.value->>'fileSizeBytes',
          fi.value->>'file_size_bytes',
          fi.value->>'sizeBytes',
          fi.value->>'size_bytes',
          fi.value->>'fileSize',
          fi.value->>'file_size',
          fi.value->>'bytes',
          fi.value->>'size'
        ), ''
      )::bigint
    ) AS total
  FROM "warehouse_catalog_items" it
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(it."raw_payload"->'files') = 'array'
         THEN it."raw_payload"->'files'
         ELSE '[]'::jsonb END
  ) AS fi(value)
  WHERE it."file_size_bytes" IS NULL
  GROUP BY it."id"
) AS f
WHERE i."id" = f.id AND f.total IS NOT NULL;

CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_file_size_idx"
  ON "warehouse_catalog_items" ("media_type", "file_size_bytes");
