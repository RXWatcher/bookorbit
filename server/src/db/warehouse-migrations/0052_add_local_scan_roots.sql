-- Configured filesystem roots the local scanner walks, one per media type.
CREATE TABLE IF NOT EXISTS "local_scan_roots" (
  "id" serial PRIMARY KEY NOT NULL,
  "media_type" "warehouse_media_type" NOT NULL,
  "absolute_path" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_scan_started_at" timestamp with time zone,
  "last_scan_finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "local_scan_roots_media_path_unique" UNIQUE ("media_type", "absolute_path")
);
