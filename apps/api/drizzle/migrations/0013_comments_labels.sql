CREATE TABLE "file_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"parent_id" text,
	"user_id" text,
	"body" text NOT NULL,
	"commit_id" text,
	"edited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"detached_at" timestamp with time zone,
	"detached_by_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_label_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label_id" text NOT NULL,
	"path" text NOT NULL,
	"created_by" text,
	"detached_at" timestamp with time zone,
	"detached_by_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_parent_id_file_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_resolved_by_bauth_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_label_assignments" ADD CONSTRAINT "file_label_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_label_assignments" ADD CONSTRAINT "file_label_assignments_label_id_file_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."file_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_label_assignments" ADD CONSTRAINT "file_label_assignments_created_by_bauth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_labels" ADD CONSTRAINT "file_labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_labels" ADD CONSTRAINT "file_labels_created_by_bauth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_comments_ws_path_idx" ON "file_comments" USING btree ("workspace_id","path") WHERE detached_at IS NULL;--> statement-breakpoint
CREATE INDEX "file_comments_parent_idx" ON "file_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "file_comments_detached_by_idx" ON "file_comments" USING btree ("workspace_id","detached_by_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_label_assignments_live_idx" ON "file_label_assignments" USING btree ("label_id","path") WHERE detached_at IS NULL;--> statement-breakpoint
CREATE INDEX "file_label_assignments_ws_path_idx" ON "file_label_assignments" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "file_label_assignments_detached_by_idx" ON "file_label_assignments" USING btree ("workspace_id","detached_by_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_labels_ws_name_idx" ON "file_labels" USING btree ("workspace_id",lower("name"));