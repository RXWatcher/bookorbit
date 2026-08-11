CREATE TABLE "koreader_catalog_device_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_document_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"device" varchar(100) DEFAULT 'KOReader' NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"percentage" real,
	"progress" text,
	"chapter_index" integer,
	"sync_timestamp" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_catalog_device_progress_percentage_range_chk" CHECK ("koreader_catalog_device_progress"."percentage" is null or ("koreader_catalog_device_progress"."percentage" >= 0 and "koreader_catalog_device_progress"."percentage" <= 1))
);
--> statement-breakpoint
CREATE TABLE "koreader_catalog_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"catalog_item_id" integer NOT NULL,
	"document_hash" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_catalog_documents_hash_chk" CHECK ("koreader_catalog_documents"."document_hash" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "koreader_catalog_device_progress" ADD CONSTRAINT "koreader_catalog_device_progress_catalog_document_id_koreader_catalog_documents_id_fk" FOREIGN KEY ("catalog_document_id") REFERENCES "public"."koreader_catalog_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_catalog_device_progress" ADD CONSTRAINT "koreader_catalog_device_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_catalog_documents" ADD CONSTRAINT "koreader_catalog_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_catalog_documents" ADD CONSTRAINT "koreader_catalog_documents_catalog_item_id_warehouse_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."warehouse_catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_catalog_device_progress_doc_user_device_uidx" ON "koreader_catalog_device_progress" USING btree ("catalog_document_id","user_id","device","device_id");--> statement-breakpoint
CREATE INDEX "koreader_catalog_device_progress_user_updated_at_idx" ON "koreader_catalog_device_progress" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "koreader_catalog_device_progress_document_idx" ON "koreader_catalog_device_progress" USING btree ("catalog_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_catalog_documents_user_hash_uidx" ON "koreader_catalog_documents" USING btree ("user_id","document_hash");--> statement-breakpoint
CREATE INDEX "koreader_catalog_documents_user_item_idx" ON "koreader_catalog_documents" USING btree ("user_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "koreader_catalog_documents_hash_idx" ON "koreader_catalog_documents" USING btree ("document_hash");