ALTER TABLE "hardcover_book_state" ADD COLUMN "sync_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hardcover_book_state" ADD COLUMN "sync_override" varchar(20);--> statement-breakpoint
ALTER TABLE "hardcover_user_settings" ADD COLUMN "book_sync_mode" varchar(20) DEFAULT 'all_eligible' NOT NULL;
