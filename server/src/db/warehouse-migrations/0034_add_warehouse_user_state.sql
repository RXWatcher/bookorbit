CREATE TABLE IF NOT EXISTS "warehouse_user_items" (
	"user_id" integer NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_user_items_user_id_media_type_remote_id_pk" PRIMARY KEY("user_id","media_type","remote_id"),
	CONSTRAINT "warehouse_user_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_user_state" (
	"user_id" integer NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"rating" integer,
	"read_status" varchar(20),
	"progress_percent" real,
	"position_seconds" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_user_state_user_id_media_type_remote_id_pk" PRIMARY KEY("user_id","media_type","remote_id"),
	CONSTRAINT "warehouse_user_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "warehouse_user_state_rating_range_chk" CHECK ("warehouse_user_state"."rating" is null or "warehouse_user_state"."rating" between 1 and 5),
	CONSTRAINT "warehouse_user_state_read_status_chk" CHECK ("warehouse_user_state"."read_status" is null or "warehouse_user_state"."read_status" in ('unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned')),
	CONSTRAINT "warehouse_user_state_progress_percent_range_chk" CHECK ("warehouse_user_state"."progress_percent" is null or "warehouse_user_state"."progress_percent" between 0 and 100),
	CONSTRAINT "warehouse_user_state_position_seconds_nonnegative_chk" CHECK ("warehouse_user_state"."position_seconds" is null or "warehouse_user_state"."position_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_user_items_user_media_idx" ON "warehouse_user_items" USING btree ("user_id","media_type","added_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_user_items_media_remote_idx" ON "warehouse_user_items" USING btree ("media_type","remote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_user_state_user_media_updated_idx" ON "warehouse_user_state" USING btree ("user_id","media_type","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_user_state_media_remote_idx" ON "warehouse_user_state" USING btree ("media_type","remote_id");
