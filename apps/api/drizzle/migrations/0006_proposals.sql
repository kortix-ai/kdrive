CREATE TABLE "proposal_blocks" (
	"user_id" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_blocks_user_id_sha256_pk" PRIMARY KEY("user_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "proposal_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"seq" integer NOT NULL,
	"op" text NOT NULL,
	"path" text NOT NULL,
	"from_path" text,
	"entry_type" text NOT NULL,
	"size" bigint,
	"block_hashes" text[],
	"content_hash" text,
	"mime" text,
	"base_version" text,
	"base_size" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"action_id" text
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"agent_credential" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"base_commit_id" text NOT NULL,
	"checkpoint_name" text,
	"op_count" integer NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"accepted_action_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"decided_at" timestamp with time zone,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_blocks" ADD CONSTRAINT "proposal_blocks_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_files" ADD CONSTRAINT "proposal_files_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_files_seq_idx" ON "proposal_files" USING btree ("proposal_id","seq");--> statement-breakpoint
CREATE INDEX "proposal_files_proposal_idx" ON "proposal_files" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_ws_status_idx" ON "proposals" USING btree ("workspace_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "proposals_user_open_idx" ON "proposals" USING btree ("user_id") WHERE status = 'open';