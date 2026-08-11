UPDATE "warehouse_catalog_items"
SET
  "series" = coalesce(
    nullif(btrim("raw_payload"->>'series'), ''),
    nullif(btrim("raw_payload"->>'seriesName'), ''),
    nullif(btrim("raw_payload"->>'series_name'), '')
  ),
  "series_index" = coalesce(
    "series_index",
    case
      when coalesce(
        "raw_payload"->>'seriesIndex',
        "raw_payload"->>'series_index',
        "raw_payload"->>'seriesNumber',
        "raw_payload"->>'series_number',
        "raw_payload"->>'volume',
        "raw_payload"->>'bookNumber',
        "raw_payload"->>'book_number',
        "raw_payload"->>'issueNumber',
        "raw_payload"->>'issue_number'
      ) ~ '^[0-9]+(\.[0-9]+)?$'
        then coalesce(
          "raw_payload"->>'seriesIndex',
          "raw_payload"->>'series_index',
          "raw_payload"->>'seriesNumber',
          "raw_payload"->>'series_number',
          "raw_payload"->>'volume',
          "raw_payload"->>'bookNumber',
          "raw_payload"->>'book_number',
          "raw_payload"->>'issueNumber',
          "raw_payload"->>'issue_number'
        )::real
      else null
    end
  ),
  "updated_at" = now()
WHERE nullif(btrim("series"), '') IS NULL
  AND coalesce(
    nullif(btrim("raw_payload"->>'series'), ''),
    nullif(btrim("raw_payload"->>'seriesName'), ''),
    nullif(btrim("raw_payload"->>'series_name'), '')
  ) IS NOT NULL;
