ALTER TABLE "share_links" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "allow_download" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "allowed_emails" text[] DEFAULT '{}'::text[] NOT NULL;