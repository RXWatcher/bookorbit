ALTER TABLE "email_send_log" ADD COLUMN IF NOT EXISTS "catalog_media_type" varchar(20);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN IF NOT EXISTS "catalog_remote_id" varchar(128);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_send_log_catalog_ref_idx" ON "email_send_log" USING btree ("user_id","catalog_media_type","catalog_remote_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_catalog_media_type_chk" CHECK ("catalog_media_type" is null or "catalog_media_type" in ('ebook', 'audiobook'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_catalog_ref_pair_chk" CHECK (("catalog_remote_id" is null and "catalog_media_type" is null) or ("catalog_remote_id" is not null and "catalog_media_type" is not null));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
