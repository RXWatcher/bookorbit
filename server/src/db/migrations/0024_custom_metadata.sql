CREATE TABLE "book_custom_metadata_values" (
	"book_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"value_text" text,
	"value_number" double precision,
	"value_date" date,
	"value_boolean" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_custom_metadata_values_book_id_field_id_pk" PRIMARY KEY("book_id","field_id"),
	CONSTRAINT "book_custom_metadata_values_single_value_chk" CHECK ((
        ("book_custom_metadata_values"."value_text" is not null)::int +
        ("book_custom_metadata_values"."value_number" is not null)::int +
        ("book_custom_metadata_values"."value_date" is not null)::int +
        ("book_custom_metadata_values"."value_boolean" is not null)::int
      ) <= 1)
);
--> statement-breakpoint
CREATE TABLE "custom_metadata_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_metadata_fields_type_chk" CHECK ("custom_metadata_fields"."type" in ('text', 'url', 'number', 'date', 'boolean')),
	CONSTRAINT "custom_metadata_fields_key_format_chk" CHECK ("custom_metadata_fields"."key" ~ '^[a-z0-9][a-z0-9_]{0,99}$'),
	CONSTRAINT "custom_metadata_fields_label_not_blank_chk" CHECK (length(btrim("custom_metadata_fields"."label")) > 0),
	CONSTRAINT "custom_metadata_fields_display_order_nonnegative_chk" CHECK ("custom_metadata_fields"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custom_metadata_library_fields" (
	"field_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_metadata_library_fields_library_id_field_id_pk" PRIMARY KEY("library_id","field_id"),
	CONSTRAINT "custom_metadata_library_fields_display_order_nonnegative_chk" CHECK ("custom_metadata_library_fields"."display_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_custom_metadata_values" ADD CONSTRAINT "book_custom_metadata_values_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_custom_metadata_values" ADD CONSTRAINT "book_custom_metadata_values_field_id_custom_metadata_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_metadata_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_metadata_library_fields" ADD CONSTRAINT "custom_metadata_library_fields_field_id_custom_metadata_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_metadata_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_metadata_library_fields" ADD CONSTRAINT "custom_metadata_library_fields_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_custom_metadata_values_field_idx" ON "book_custom_metadata_values" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_metadata_fields_key_uidx" ON "custom_metadata_fields" USING btree ("key");--> statement-breakpoint
CREATE INDEX "custom_metadata_fields_active_order_idx" ON "custom_metadata_fields" USING btree ("archived_at","display_order","label");--> statement-breakpoint
CREATE INDEX "custom_metadata_library_fields_field_idx" ON "custom_metadata_library_fields" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "custom_metadata_library_fields_library_order_idx" ON "custom_metadata_library_fields" USING btree ("library_id","display_order","field_id");