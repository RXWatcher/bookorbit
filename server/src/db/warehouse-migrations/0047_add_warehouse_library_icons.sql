ALTER TABLE "warehouse_settings"
  ADD COLUMN "ebook_library_icon" varchar(100) DEFAULT 'BookOpen' NOT NULL,
  ADD COLUMN "audiobook_library_icon" varchar(100) DEFAULT 'Headphones' NOT NULL,
  ADD COLUMN "comic_library_icon" varchar(100) DEFAULT 'PanelsTopLeft' NOT NULL;
