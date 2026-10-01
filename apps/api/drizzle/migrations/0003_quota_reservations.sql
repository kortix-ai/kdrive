CREATE TABLE "quota_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"kind" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"workspaces" integer DEFAULT 0 NOT NULL,
	"volumes" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_reservations_user_idx" ON "quota_reservations" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "quota_reservations_scope_idx" ON "quota_reservations" USING btree ("scope","expires_at");