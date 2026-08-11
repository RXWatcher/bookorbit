CREATE TYPE "public"."warehouse_media_type" AS ENUM('ebook', 'audiobook');--> statement-breakpoint
CREATE TYPE "public"."warehouse_request_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."warehouse_sync_media_type" AS ENUM('ebook', 'audiobook', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."warehouse_sync_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "warehouse_catalog_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_catalog_details_media_remote_unique" UNIQUE("media_type","remote_id")
);
--> statement-breakpoint
CREATE TABLE "warehouse_catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"sort_title" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"narrators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"series" text,
	"genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" varchar(32),
	"publisher" text,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" varchar(64),
	"has_cover" boolean DEFAULT false NOT NULL,
	"upstream_created_at" timestamp with time zone,
	"upstream_updated_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_catalog_items_media_remote_unique" UNIQUE("media_type","remote_id")
);
--> statement-breakpoint
CREATE TABLE "warehouse_catalog_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_type" "warehouse_sync_media_type" NOT NULL,
	"status" "warehouse_sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"saved_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"media_type" "warehouse_media_type" NOT NULL,
	"upstream_request_id" varchar(128),
	"status" "warehouse_request_status" DEFAULT 'unknown' NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"isbn" varchar(32),
	"requested_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_remote_id" varchar(128),
	"last_status_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_key" varchar(64) DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"api_key_encrypted" text,
	"api_key_nonce" varchar(32),
	"api_key_tag" varchar(32),
	"sync_cadence_minutes" integer DEFAULT 360 NOT NULL,
	"last_connection_status" varchar(16) DEFAULT 'untested' NOT NULL,
	"last_connection_checked_at" timestamp with time zone,
	"last_connection_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_settings_profile_key_unique" UNIQUE("profile_key")
);
--> statement-breakpoint
ALTER TABLE "warehouse_requests" ADD CONSTRAINT "warehouse_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_catalog_details_fetched_at_idx" ON "warehouse_catalog_details" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "warehouse_catalog_items_media_type_idx" ON "warehouse_catalog_items" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX "warehouse_catalog_items_title_idx" ON "warehouse_catalog_items" USING btree ("title");--> statement-breakpoint
CREATE INDEX "warehouse_catalog_items_synced_at_idx" ON "warehouse_catalog_items" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "warehouse_catalog_sync_runs_status_idx" ON "warehouse_catalog_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "warehouse_catalog_sync_runs_media_started_idx" ON "warehouse_catalog_sync_runs" USING btree ("media_type","started_at");--> statement-breakpoint
CREATE INDEX "warehouse_requests_user_status_idx" ON "warehouse_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "warehouse_requests_media_status_idx" ON "warehouse_requests" USING btree ("media_type","status");--> statement-breakpoint
CREATE INDEX "warehouse_requests_upstream_request_idx" ON "warehouse_requests" USING btree ("upstream_request_id");
