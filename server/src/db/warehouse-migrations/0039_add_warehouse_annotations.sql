CREATE TABLE "warehouse_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"media_type" "warehouse_media_type" NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"cfi" varchar(2000) NOT NULL,
	"text" text NOT NULL,
	"color" varchar(32) DEFAULT 'yellow' NOT NULL,
	"style" varchar(32) DEFAULT 'highlight' NOT NULL,
	"note" text,
	"chapter_title" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_annotations_style_chk" CHECK ("warehouse_annotations"."style" in ('highlight', 'underline', 'strikethrough', 'squiggly'))
);
--> statement-breakpoint
ALTER TABLE "warehouse_annotations" ADD CONSTRAINT "warehouse_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warehouse_annotations_user_item_idx" ON "warehouse_annotations" USING btree ("user_id","media_type","remote_id");--> statement-breakpoint
CREATE INDEX "warehouse_annotations_user_item_cfi_idx" ON "warehouse_annotations" USING btree ("user_id","media_type","remote_id","cfi");