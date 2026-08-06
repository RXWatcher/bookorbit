CREATE TABLE IF NOT EXISTS "warehouse_reading_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "media_type" "warehouse_media_type" NOT NULL,
  "remote_id" varchar(128) NOT NULL,
  "session_id" varchar(64) NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone NOT NULL,
  "duration_seconds" integer NOT NULL,
  "progress_delta" real,
  "end_progress" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "warehouse_reading_sessions_duration_seconds_nonnegative_chk" CHECK ("warehouse_reading_sessions"."duration_seconds" >= 0),
  CONSTRAINT "warehouse_reading_sessions_end_progress_range_chk" CHECK ("warehouse_reading_sessions"."end_progress" is null or ("warehouse_reading_sessions"."end_progress" >= 0 and "warehouse_reading_sessions"."end_progress" <= 100)),
  CONSTRAINT "warehouse_reading_sessions_ended_after_started_chk" CHECK ("warehouse_reading_sessions"."ended_at" >= "warehouse_reading_sessions"."started_at")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_reading_sessions" ADD CONSTRAINT "warehouse_reading_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wrs_user_session_id_uidx" ON "warehouse_reading_sessions" USING btree ("user_id","session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wrs_user_item_started_idx" ON "warehouse_reading_sessions" USING btree ("user_id","media_type","remote_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wrs_item_started_idx" ON "warehouse_reading_sessions" USING btree ("media_type","remote_id","started_at");
