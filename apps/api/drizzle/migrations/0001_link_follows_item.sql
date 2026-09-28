ALTER TABLE "share_links" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "detached_by_action_id" text;