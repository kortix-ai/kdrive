CREATE TABLE "recent_opens" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_opens_user_id_workspace_id_path_pk" PRIMARY KEY("user_id","workspace_id","path")
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"target_type" text NOT NULL,
	"detached_at" timestamp with time zone,
	"detached_by_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recent_opens" ADD CONSTRAINT "recent_opens_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_opens" ADD CONSTRAINT "recent_opens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recent_opens_user_opened_idx" ON "recent_opens" USING btree ("user_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recent_opens_ws_path_idx" ON "recent_opens" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "stars_user_ws_path_idx" ON "stars" USING btree ("user_id","workspace_id","path") WHERE detached_at IS NULL;--> statement-breakpoint
CREATE INDEX "stars_ws_path_idx" ON "stars" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "stars_user_created_idx" ON "stars" USING btree ("user_id","created_at" DESC NULLS LAST);