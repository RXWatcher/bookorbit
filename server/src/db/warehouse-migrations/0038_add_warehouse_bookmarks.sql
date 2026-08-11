CREATE TABLE "warehouse_bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"cfi" varchar(2000),
	"title" varchar(500) NOT NULL,
	"position_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_bookmarks_position_seconds_nonnegative_chk" CHECK ("warehouse_bookmarks"."position_seconds" is null or "warehouse_bookmarks"."position_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "warehouse_bookmarks" ADD CONSTRAINT "warehouse_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_bookmarks_user_item_idx" ON "warehouse_bookmarks" USING btree ("user_id","media_type","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_bookmarks_user_item_cfi_uidx" ON "warehouse_bookmarks" USING btree ("user_id","media_type","remote_id","cfi") WHERE "warehouse_bookmarks"."cfi" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_bookmarks_user_item_pos_uidx" ON "warehouse_bookmarks" USING btree ("user_id","media_type","remote_id","position_seconds") WHERE "warehouse_bookmarks"."position_seconds" is not null and "warehouse_bookmarks"."cfi" is null;