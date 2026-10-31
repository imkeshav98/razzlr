-- Asset names and tags (#52): what a brand calls each image and the words it finds them by.
ALTER TABLE "assets" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;
