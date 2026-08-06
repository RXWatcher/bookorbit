CREATE TABLE "collection_catalog_items" (
	"collection_id" integer NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_catalog_items_collection_id_media_type_remote_id_pk" PRIMARY KEY("collection_id","media_type","remote_id")
);
--> statement-breakpoint
ALTER TABLE "collection_catalog_items" ADD CONSTRAINT "collection_catalog_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_catalog_items_media_remote_idx" ON "collection_catalog_items" USING btree ("media_type","remote_id");