CREATE TABLE "admins" (
	"email" text PRIMARY KEY NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_workspace_idx" ON "audit_events" USING btree ("workspace_id","id" DESC NULLS LAST);--> statement-breakpoint
-- The first admin. Admins manage the rest in the admin panel (VOLUMES_ADMIN_EMAILS is no longer read).
INSERT INTO "admins" ("email") VALUES ('allen@kortix.ai') ON CONFLICT DO NOTHING;