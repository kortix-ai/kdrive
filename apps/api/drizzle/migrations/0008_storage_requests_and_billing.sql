CREATE TABLE "billing_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"subscription_id" text,
	"plan" text,
	"status" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_requests" ADD CONSTRAINT "storage_requests_user_id_bauth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_requests" ADD CONSTRAINT "storage_requests_resolved_by_bauth_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."bauth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_requests_one_open_idx" ON "storage_requests" USING btree ("user_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "storage_requests_user_idx" ON "storage_requests" USING btree ("user_id","created_at" DESC NULLS LAST);