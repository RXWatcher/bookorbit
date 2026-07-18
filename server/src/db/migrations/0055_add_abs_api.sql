CREATE TABLE "abs_playback_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"library_id" integer,
	"book_id" integer NOT NULL,
	"display_title" text DEFAULT '' NOT NULL,
	"display_author" text DEFAULT '' NOT NULL,
	"cover_path" text,
	"media_metadata" jsonb NOT NULL,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration" double precision DEFAULT 0 NOT NULL,
	"play_method" integer NOT NULL,
	"media_player" varchar(64) DEFAULT 'unknown' NOT NULL,
	"device_info" jsonb,
	"server_version" varchar(32) NOT NULL,
	"date" varchar(10) NOT NULL,
	"day_of_week" varchar(16) NOT NULL,
	"time_listening" double precision DEFAULT 0 NOT NULL,
	"start_time_seconds" double precision DEFAULT 0 NOT NULL,
	"current_time_seconds" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abs_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"refresh_token" text NOT NULL,
	"last_refresh_token" text,
	"last_refresh_token_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "hide_from_continue_listening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "abs_playback_sessions" ADD CONSTRAINT "abs_playback_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abs_sessions" ADD CONSTRAINT "abs_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abs_playback_sessions_user_updated_idx" ON "abs_playback_sessions" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "abs_playback_sessions_user_book_idx" ON "abs_playback_sessions" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "abs_playback_sessions_user_created_idx" ON "abs_playback_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "abs_sessions_user_id_idx" ON "abs_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "abs_sessions_refresh_token_idx" ON "abs_sessions" USING btree ("refresh_token");--> statement-breakpoint
CREATE INDEX "abs_sessions_last_refresh_token_idx" ON "abs_sessions" USING btree ("last_refresh_token");