// Drizzle schema — PLAN.md "Data model" plus paypal_webhook_events for dedupe.
// Statuses and kinds are plain text (no pg enums) so the view-model unions in lib/types.ts stay the source of truth.
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Criterion, CriterionResult, TranscriptTurn } from "@/lib/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const properties = pgTable("properties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
});

export const units = pgTable("units", {
  id: text("id").primaryKey(),
  property_id: text("property_id").notNull().references(() => properties.id),
  label: text("label").notNull(),
}, (t) => [uniqueIndex("units_property_label_idx").on(t.property_id, t.label)]);

export const contractors = pgTable("contractors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  trade: text("trade").notNull(),
  paypal_email: text("paypal_email").notNull(),
  hourly_rate_cents: integer("hourly_rate_cents").notNull().default(0),
  profile_json: jsonb("profile_json").$type<Record<string, unknown>>().notNull().default({}),
  avatar_tone: integer("avatar_tone").notNull().default(0),
});

export const workOrders = pgTable("work_orders", {
  id: text("id").primaryKey(),
  unit_id: text("unit_id").notNull().references(() => units.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  criteria_json: jsonb("criteria_json").$type<Criterion[]>().notNull().default([]),
  budget_cents: integer("budget_cents").notNull().default(0),
  status: text("status").notNull().default("draft"),
  created_by: text("created_by").notNull().default("pm-1"),
  contractor_id: text("contractor_id").references(() => contractors.id),
  deadline: ts("deadline"),
  created_at: ts("created_at").notNull().defaultNow(),
  updated_at: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("work_orders_status_idx").on(t.status), index("work_orders_updated_idx").on(t.updated_at)]);

export const negotiations = pgTable("negotiations", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  transcript_json: jsonb("transcript_json").$type<TranscriptTurn[]>().notNull().default([]),
  outcome: text("outcome").notNull().default("pending"),
}, (t) => [uniqueIndex("negotiations_work_order_idx").on(t.work_order_id)]);

export const contracts = pgTable("contracts", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  contractor_id: text("contractor_id").notNull().references(() => contractors.id),
  price_cents: integer("price_cents").notNull(),
  deposit_pct: integer("deposit_pct").notNull().default(0),
  deadline: ts("deadline").notNull(),
  criteria_json: jsonb("criteria_json").$type<Criterion[]>().notNull().default([]),
  paypal_order_id: text("paypal_order_id"),
  paypal_auth_id: text("paypal_auth_id"),
  paypal_capture_id: text("paypal_capture_id"),
  approve_url: text("approve_url"),
}, (t) => [uniqueIndex("contracts_work_order_idx").on(t.work_order_id), index("contracts_paypal_order_idx").on(t.paypal_order_id)]);

export const proofs = pgTable("proofs", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  url: text("url").notNull(),
  exif_ts: ts("exif_ts").notNull(),
  uploaded_at: ts("uploaded_at").notNull().defaultNow(),
  exif_missing: boolean("exif_missing").notNull().default(false),
}, (t) => [index("proofs_work_order_idx").on(t.work_order_id)]);

export const verdicts = pgTable("verdicts", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(),
  confidence: real("confidence").notNull(),
  criteria_results_json: jsonb("criteria_results_json").$type<CriterionResult[]>().notNull().default([]),
  amount_to_release_cents: integer("amount_to_release_cents").notNull().default(0),
  model: text("model").notNull(),
  raw: jsonb("raw"),
  proof_hash: text("proof_hash"),
  created_at: ts("created_at").notNull().defaultNow(),
}, (t) => [index("verdicts_work_order_idx").on(t.work_order_id), index("verdicts_proof_hash_idx").on(t.work_order_id, t.proof_hash)]);

export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  contractor_id: text("contractor_id").notNull(),
  amount_cents: integer("amount_cents").notNull(),
  kind: text("kind").notNull(),
  paypal_batch_id: text("paypal_batch_id").notNull().default(""),
  paypal_item_id: text("paypal_item_id").notNull().default(""),
  status: text("status").notNull().default("pending"),
  paid_at: ts("paid_at"),
  created_at: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("payouts_work_order_kind_idx").on(t.work_order_id, t.kind), index("payouts_status_idx").on(t.status), index("payouts_batch_idx").on(t.paypal_batch_id)]);

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  work_order_id: text("work_order_id"),
  type: text("type").notNull(),
  payload_json: jsonb("payload_json"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("events_work_order_idx").on(t.work_order_id, t.at)]);

export const paypalWebhookEvents = pgTable("paypal_webhook_events", {
  id: text("id").primaryKey(),
  event_id: text("event_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  received_at: ts("received_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("paypal_webhook_events_event_idx").on(t.event_id)]);

export const schema = { properties, units, contractors, workOrders, negotiations, contracts, proofs, verdicts, payouts, events, paypalWebhookEvents };
export type Schema = typeof schema;
