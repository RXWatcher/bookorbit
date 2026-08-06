ALTER TABLE "warehouse_user_state" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_user_state_user_finished_idx" ON "warehouse_user_state" USING btree ("user_id","finished_at");
