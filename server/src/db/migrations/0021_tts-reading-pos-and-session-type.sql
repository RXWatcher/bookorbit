CREATE TABLE "tts_book_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"provider_id" integer,
	"voice_id" varchar(200),
	"speed" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(500),
	"default_model" varchar(100),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_reading_position" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"cfi" text NOT NULL,
	"chapter_index" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer,
	"voice_id" varchar(200),
	"speed" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "session_type" varchar(20) DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_provider_id_tts_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tts_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_reading_position" ADD CONSTRAINT "tts_reading_position_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_reading_position" ADD CONSTRAINT "tts_reading_position_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_user_preferences" ADD CONSTRAINT "tts_user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_user_preferences" ADD CONSTRAINT "tts_user_preferences_provider_id_tts_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tts_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tts_book_prefs_user_book_uidx" ON "tts_book_preferences" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_reading_pos_user_file_uidx" ON "tts_reading_position" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_user_prefs_user_uidx" ON "tts_user_preferences" USING btree ("user_id");