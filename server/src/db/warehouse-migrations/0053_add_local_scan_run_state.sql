-- Track the outcome of a scan run on the root itself.
--
-- Before this, a scan that threw left last_scan_started_at set and
-- last_scan_finished_at stale, which is indistinguishable from a run still in
-- progress. Scans are also long enough (about 4 minutes for the audiobook
-- root) that they cannot be served on a synchronous request, so the run state
-- has to live somewhere pollable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'local_scan_status') THEN
    CREATE TYPE "local_scan_status" AS ENUM ('idle', 'running', 'completed', 'failed');
  END IF;
END
$$;

ALTER TABLE "local_scan_roots"
  ADD COLUMN IF NOT EXISTS "last_scan_status" "local_scan_status" DEFAULT 'idle' NOT NULL;

ALTER TABLE "local_scan_roots"
  ADD COLUMN IF NOT EXISTS "last_scan_error" text;

ALTER TABLE "local_scan_roots"
  ADD COLUMN IF NOT EXISTS "last_scan_summary" jsonb;
