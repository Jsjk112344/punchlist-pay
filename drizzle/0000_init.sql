CREATE TABLE "contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trade" text NOT NULL,
	"paypal_email" text NOT NULL,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"profile_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avatar_tone" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"deposit_pct" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"criteria_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paypal_order_id" text,
	"paypal_auth_id" text,
	"paypal_capture_id" text,
	"approve_url" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text,
	"type" text NOT NULL,
	"payload_json" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"transcript_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"contractor_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"paypal_batch_id" text DEFAULT '' NOT NULL,
	"paypal_item_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"exif_ts" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exif_missing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"verdict" text NOT NULL,
	"confidence" real NOT NULL,
	"criteria_results_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_to_release_cents" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"raw" jsonb,
	"proof_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"criteria_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text DEFAULT 'pm-1' NOT NULL,
	"contractor_id" text,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_work_order_idx" ON "contracts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "contracts_paypal_order_idx" ON "contracts" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "events_work_order_idx" ON "events" USING btree ("work_order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "negotiations_work_order_idx" ON "negotiations" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_work_order_kind_idx" ON "payouts" USING btree ("work_order_id","kind");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_batch_idx" ON "payouts" USING btree ("paypal_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_webhook_events_event_idx" ON "paypal_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "proofs_work_order_idx" ON "proofs" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_property_label_idx" ON "units" USING btree ("property_id","label");--> statement-breakpoint
CREATE INDEX "verdicts_work_order_idx" ON "verdicts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "verdicts_proof_hash_idx" ON "verdicts" USING btree ("work_order_id","proof_hash");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_orders_updated_idx" ON "work_orders" USING btree ("updated_at");