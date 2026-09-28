CREATE TABLE "bauth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bauth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bauth_session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "bauth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bauth_user_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "bauth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_paths" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"op" text NOT NULL,
	"path" text NOT NULL,
	"from_path" text,
	"entry_type" text NOT NULL,
	"size" bigint,
	"prev_size" bigint,
	"content_hash" text,
	"block_hashes" text[],
	"mtime" bigint
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"base_commit_id" text,
	"commit_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"head_commit_id" text,
	"bytes_delta" bigint DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"undo_of_action_id" text,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"actor_email" text,
	"workspace_id" text,
	"kind" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"tag" text NOT NULL,
	"commit_id" text NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"path" text NOT NULL,
	"target_type" text NOT NULL,
	"mode" text NOT NULL,
	"commit_id" text,
	"tag" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action_id" text,
	"pt_upload_id" text,
	"status" text NOT NULL,
	"plan" jsonb NOT NULL,
	"total_bytes" bigint NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"quota_bytes" bigint NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"volume_name" text NOT NULL,
	"volume_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"forked_from_workspace_id" text,
	"forked_at_commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_volume_name_unique" UNIQUE("volume_name")
);
--> statement-breakpoint
ALTER TABLE "bauth_account" ADD CONSTRAINT "bauth_account_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_session" ADD CONSTRAINT "bauth_session_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_paths" ADD CONSTRAINT "action_paths_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_created_by_bauth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_forked_from_workspace_id_workspaces_id_fk" FOREIGN KEY ("forked_from_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bauth_account_user_idx" ON "bauth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_account_provider_idx" ON "bauth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "bauth_session_user_idx" ON "bauth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_verification_identifier_idx" ON "bauth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "action_paths_ws_path_idx" ON "action_paths" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "action_paths_action_idx" ON "action_paths" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "action_paths_ws_deleted_idx" ON "action_paths" USING btree ("workspace_id") WHERE op = 'deleted';--> statement-breakpoint
CREATE INDEX "actions_ws_created_idx" ON "actions" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "actions_ws_head_idx" ON "actions" USING btree ("workspace_id","head_commit_id");--> statement-breakpoint
CREATE INDEX "actions_commit_ids_gin" ON "actions" USING gin ("commit_ids");--> statement-breakpoint
CREATE INDEX "actions_pending_idx" ON "actions" USING btree ("workspace_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "audit_user_created_idx" ON "audit_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_kind_created_idx" ON "audit_events" USING btree ("kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_ws_tag_idx" ON "checkpoints" USING btree ("workspace_id","tag");--> statement-breakpoint
CREATE INDEX "checkpoints_ws_commit_idx" ON "checkpoints" USING btree ("workspace_id","commit_id");--> statement-breakpoint
CREATE INDEX "share_links_ws_idx" ON "share_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "uploads_ws_status_idx" ON "uploads" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "workspaces_user_idx" ON "workspaces" USING btree ("user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_default_idx" ON "workspaces" USING btree ("user_id") WHERE is_default AND deleted_at IS NULL;