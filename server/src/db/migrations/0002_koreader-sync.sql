CREATE TABLE "book_file_chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_file_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"title" varchar(500),
	"href" varchar(1000),
	"spine_index" integer
);
--> statement-breakpoint
CREATE TABLE "book_file_hash_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_file_id" integer NOT NULL,
	"file_hash" varchar(32) NOT NULL,
	"reason" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan'))
);
--> statement-breakpoint
CREATE TABLE "koreader_device_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_file_id" integer,
	"user_id" integer NOT NULL,
	"device" varchar(100) DEFAULT 'KOReader' NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"percentage" real,
	"progress" text,
	"chapter_index" integer,
	"sync_timestamp" bigint,
	"orphaned" boolean DEFAULT false NOT NULL,
	"orphaned_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_progress_percentage_range_chk" CHECK ("koreader_device_progress"."percentage" is null or ("koreader_device_progress"."percentage" >= 0 and "koreader_device_progress"."percentage" <= 1))
);
--> statement-breakpoint
CREATE TABLE "koreader_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"password_md5" varchar(32),
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_files" RENAME COLUMN "hash" TO "file_hash";--> statement-breakpoint
DROP INDEX "book_files_hash_idx";--> statement-breakpoint
DROP INDEX "book_files_library_folder_hash_idx";--> statement-breakpoint
ALTER TABLE "book_file_chapters" ADD CONSTRAINT "book_file_chapters_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_progress" ADD CONSTRAINT "koreader_device_progress_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_progress" ADD CONSTRAINT "koreader_device_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_users" ADD CONSTRAINT "koreader_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_file_chapters_book_file_id_chapter_index_uidx" ON "book_file_chapters" USING btree ("book_file_id","chapter_index");--> statement-breakpoint
CREATE INDEX "book_file_chapters_book_file_id_idx" ON "book_file_chapters" USING btree ("book_file_id");--> statement-breakpoint
CREATE INDEX "book_file_hash_history_file_hash_idx" ON "book_file_hash_history" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "book_file_hash_history_book_file_id_file_hash_idx" ON "book_file_hash_history" USING btree ("book_file_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_device_progress_book_user_device_uidx" ON "koreader_device_progress" USING btree ("book_file_id","user_id","device","device_id") WHERE "koreader_device_progress"."orphaned" = false;--> statement-breakpoint
CREATE INDEX "koreader_device_progress_orphaned_hash_idx" ON "koreader_device_progress" USING btree ("orphaned_hash") WHERE "koreader_device_progress"."orphaned" = true;--> statement-breakpoint
CREATE INDEX "koreader_device_progress_user_updated_at_idx" ON "koreader_device_progress" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "koreader_device_progress_book_file_id_idx" ON "koreader_device_progress" USING btree ("book_file_id") WHERE "koreader_device_progress"."book_file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_users_user_id_uidx" ON "koreader_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_users_username_uidx" ON "koreader_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "book_files_file_hash_idx" ON "book_files" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "book_files_library_folder_file_hash_idx" ON "book_files" USING btree ("library_folder_id","file_hash");