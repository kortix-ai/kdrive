CREATE TABLE "bauth_jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bauth_oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scopes" text[] NOT NULL,
	CONSTRAINT "bauth_oauth_access_token_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "bauth_oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"token_endpoint_auth_method" text,
	"grant_types" text[],
	"response_types" text[],
	"public" boolean,
	"type" text,
	"require_pkce" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "bauth_oauth_client_client_id_key" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "bauth_oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bauth_oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"scopes" text[] NOT NULL,
	CONSTRAINT "bauth_oauth_refresh_token_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "bauth_oauth_access_token" ADD CONSTRAINT "bauth_oauth_access_token_client_id_bauth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."bauth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_access_token" ADD CONSTRAINT "bauth_oauth_access_token_session_id_bauth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."bauth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_access_token" ADD CONSTRAINT "bauth_oauth_access_token_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_access_token" ADD CONSTRAINT "bauth_oauth_access_token_refresh_id_bauth_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."bauth_oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_client" ADD CONSTRAINT "bauth_oauth_client_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_consent" ADD CONSTRAINT "bauth_oauth_consent_client_id_bauth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."bauth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_consent" ADD CONSTRAINT "bauth_oauth_consent_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_refresh_token" ADD CONSTRAINT "bauth_oauth_refresh_token_client_id_bauth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."bauth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_refresh_token" ADD CONSTRAINT "bauth_oauth_refresh_token_session_id_bauth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."bauth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bauth_oauth_refresh_token" ADD CONSTRAINT "bauth_oauth_refresh_token_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bauth_oauth_access_token_client_idx" ON "bauth_oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_access_token_session_idx" ON "bauth_oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_access_token_user_idx" ON "bauth_oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_access_token_refresh_idx" ON "bauth_oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_access_token_reference_idx" ON "bauth_oauth_access_token" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_client_user_idx" ON "bauth_oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_client_reference_idx" ON "bauth_oauth_client" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_consent_client_idx" ON "bauth_oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_consent_user_idx" ON "bauth_oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_consent_reference_idx" ON "bauth_oauth_consent" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_refresh_token_client_idx" ON "bauth_oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_refresh_token_session_idx" ON "bauth_oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_refresh_token_user_idx" ON "bauth_oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bauth_oauth_refresh_token_reference_idx" ON "bauth_oauth_refresh_token" USING btree ("reference_id");