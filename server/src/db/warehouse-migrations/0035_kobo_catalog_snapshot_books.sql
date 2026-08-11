CREATE TABLE "kobo_catalog_snapshot_books" (
	"snapshot_id" integer NOT NULL,
	"catalog_item_id" integer NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"pending_delete" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT true NOT NULL,
	"removed_by_device" boolean DEFAULT false NOT NULL,
	"metadata_hash" varchar(64),
	CONSTRAINT "kobo_catalog_snapshot_books_snapshot_id_catalog_item_id_pk" PRIMARY KEY("snapshot_id","catalog_item_id")
);
--> statement-breakpoint
ALTER TABLE "kobo_catalog_snapshot_books" ADD CONSTRAINT "kobo_catalog_snapshot_books_snapshot_id_kobo_library_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."kobo_library_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_catalog_snapshot_books" ADD CONSTRAINT "kobo_catalog_snapshot_books_catalog_item_id_warehouse_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."warehouse_catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kobo_catalog_snapshot_books_snapshot_synced_item_idx" ON "kobo_catalog_snapshot_books" USING btree ("snapshot_id","synced","catalog_item_id");