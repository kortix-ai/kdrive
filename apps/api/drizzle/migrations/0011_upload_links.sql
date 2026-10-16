ALTER TABLE "share_links" ADD COLUMN "kind" text DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "max_file_bytes" bigint;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "max_files" integer;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "upload_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "upload_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "upload_day" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "upload_day_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "upload_day_files" integer DEFAULT 0 NOT NULL;