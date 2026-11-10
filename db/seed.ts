// Demo seed: 1 PM org (pm-1), 2 properties, 3 contractors, 6 historical paid jobs + 1 escalated row.
// Every PayPal-looking id here is prefixed SEED- so nobody mistakes it for sandbox activity.
// Historical rows reuse the fixture scene (fixtures/work-orders.json) so fixture mode and live mode tell the same story.
import { count, sql } from "drizzle-orm";
import fixtureOrders from "@/fixtures/work-orders.json";
import { env } from "@/lib/config";
import type { Criterion, CriterionResult, Payout, Proof, Verdict, WorkOrder } from "@/lib/types";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

const d = (iso: string) => new Date(iso);
const unitId = (property_id: string, label: string) => `u-${property_id}-${label.toLowerCase()}`;

export const seedProperties = [
  { id: "p-1", name: "Alder House", address: "118 Alder St" },
  { id: "p-2", name: "Birch Court", address: "42 Birch Ct" },
];

export const seedContractors = [
  { id: "mike", name: "Mike Torres", trade: "Plumbing", paypal_email: env.contractorEmails.mike, hourly_rate_cents: 9500, avatar_tone: 0,
    profile_json: { callout_fee_cents: 6000, after_hours_surcharge_pct: 20, min_job_cents: 12000, availability: "today after 3 PM", style: "brief, firm about after-hours pricing, accepts a fair offer quickly", typical_deposit_pct: 20 } },
  { id: "sara", name: "Sara Kim", trade: "Cleaning", paypal_email: env.contractorEmails.sara, hourly_rate_cents: 4500, avatar_tone: 1,
    profile_json: { callout_fee_cents: 0, after_hours_surcharge_pct: 0, min_job_cents: 8000, availability: "today", style: "friendly, flexible on timing, firm on scope", typical_deposit_pct: 0 } },
  { id: "leo", name: "Leo Grant", trade: "Handyman", paypal_email: env.contractorEmails.leo, hourly_rate_cents: 7500, avatar_tone: 2,
    profile_json: { callout_fee_cents: 4000, after_hours_surcharge_pct: 15, min_job_cents: 10000, availability: "tomorrow morning or today after 5 PM", style: "methodical, asks for parts allowance", typical_deposit_pct: 20 } },
];

const KEEP_FROM_FIXTURE = ["wo-1041", "wo-1039", "wo-1038", "wo-1037", "wo-1036"];

const defaultCriteria: Record<string, Criterion[]> = {
  "wo-1038": [{ id: "c1", text: "After photo shows new lockset installed and latched", check: "photo" }, { id: "c2", text: "Hardware receipt totals $120 or less", check: "receipt" }, { id: "c3", text: "Completed before 5:00 PM", check: "time" }],
  "wo-1037": [{ id: "c1", text: "After photo shows fan mounted flush with no visible wobble", check: "photo" }, { id: "c2", text: "Parts receipt totals $80 or less", check: "receipt" }, { id: "c3", text: "Completed before 12:00 PM", check: "time" }],
  "wo-1036": [{ id: "c1", text: "After photo shows door closing square on the frame", check: "photo" }, { id: "c2", text: "Hinge hardware receipt attached", check: "receipt" }, { id: "c3", text: "Completed before 4:00 PM", check: "time" }],
};
const defaultEvidence: Record<string, CriterionResult[]> = {
  "wo-1038": [{ id: "c1", met: true, evidence: "New lockset visible, latch engaged" }, { id: "c2", met: true, evidence: "Receipt total $84.19" }, { id: "c3", met: true, evidence: "Completed 4:02 PM" }],
  "wo-1037": [{ id: "c1", met: true, evidence: "Fan canopy flush, blades level" }, { id: "c2", met: true, evidence: "Receipt total $23.40 (balance kit)" }, { id: "c3", met: true, evidence: "Completed 11:25 AM" }],
  "wo-1036": [{ id: "c1", met: true, evidence: "Door sits square, even reveal" }, { id: "c2", met: true, evidence: "Receipt total $11.98" }, { id: "c3", met: true, evidence: "Completed 2:48 PM" }],
};

function fixtureSeedOrders(): WorkOrder[] {
  return (fixtureOrders as WorkOrder[]).filter((o) => KEEP_FROM_FIXTURE.includes(o.id)).map((o) => {
    const n = o.id.replace("wo-", "");
    const criteria = o.criteria.length ? o.criteria : defaultCriteria[o.id] ?? [];
    const verdict: Verdict | undefined = o.verdict ?? (o.status === "paid" ? { verdict: "pass", confidence: 0.94, criteria: defaultEvidence[o.id] ?? [], amount_to_release_cents: o.contract?.price_cents ?? o.budget_cents, model: "seed/claude-vision" } : undefined);
    return {
      ...o,
      unit_id: unitId(o.property_id, o.unit),
      criteria,
      contract: o.contract ? { ...o.contract, criteria, paypal_order_id: `SEED-ORDER-${n}`, paypal_auth_id: `SEED-AUTH-${n}`, paypal_capture_id: o.status === "paid" ? `SEED-CAPTURE-${n}` : undefined } : undefined,
      verdict: verdict ? { ...verdict, model: verdict.model.replace("fixture/", "seed/") } : undefined,
      payouts: o.payouts.map((p) => ({ ...p, paypal_batch_id: `SEED-BATCH-${n}-${p.kind.toUpperCase()}`, paypal_item_id: `SEED-ITEM-${n}-${p.kind.toUpperCase()}` })),
    };
  });
}

function extraPaidOrders(): WorkOrder[] {
  const mk = (id: string, property_id: string, property_name: string, unit: string, title: string, description: string, contractor: typeof seedContractors[number], price_cents: number, paidAt: string, deadline: string, criteria: Criterion[], evidence: CriterionResult[], proofUrl: string): WorkOrder => {
    const n = id.replace("wo-", "");
    const paid = d(paidAt); const proofAt = new Date(paid.getTime() - 4 * 60_000).toISOString(); const checkinAt = new Date(paid.getTime() - 95 * 60_000).toISOString();
    const proofs: Proof[] = [
      { id: `p-${n}-checkin`, work_order_id: id, kind: "checkin", url: "/fixtures/door-4b.svg", exif_ts: checkinAt, uploaded_at: checkinAt },
      { id: `p-${n}-after`, work_order_id: id, kind: "after", url: proofUrl, exif_ts: proofAt, uploaded_at: proofAt },
      { id: `p-${n}-receipt`, work_order_id: id, kind: "receipt", url: "/fixtures/receipt.svg", exif_ts: proofAt, uploaded_at: proofAt },
    ];
    const payouts: Payout[] = [{ id: `pay-${n}`, work_order_id: id, contractor_id: contractor.id, amount_cents: price_cents, kind: "balance", paypal_batch_id: `SEED-BATCH-${n}-BALANCE`, paypal_item_id: `SEED-ITEM-${n}-BALANCE`, status: "paid", paid_at: paidAt }];
    return { id, property_id, property_name, unit_id: unitId(property_id, unit), unit, title, description, criteria, budget_cents: price_cents, status: "paid", created_by: "pm-1",
      contractor_id: contractor.id, contractor_name: contractor.name, contractor_trade: contractor.trade, avatar_tone: contractor.avatar_tone as 0 | 1 | 2, updated_at: paidAt,
      contract: { contractor_id: contractor.id, price_cents, deposit_pct: 0, deadline, criteria, paypal_order_id: `SEED-ORDER-${n}`, paypal_auth_id: `SEED-AUTH-${n}`, paypal_capture_id: `SEED-CAPTURE-${n}` },
      negotiation: [], proofs, verdict: { verdict: "pass", confidence: 0.95, criteria: evidence, amount_to_release_cents: price_cents, model: "seed/claude-vision" }, payouts };
  };
  return [
    mk("wo-1034", "p-2", "Birch Court", "3B", "Unclog bathtub drain", "Bathtub draining slowly; clear the trap and test flow.", seedContractors[0], 13500, "2026-11-05T14:10:00-05:00", "2026-11-05T17:00:00-05:00",
      [{ id: "c1", text: "After photo shows tub draining with no standing water", check: "photo" }, { id: "c2", text: "Parts receipt totals $25 or less", check: "receipt" }, { id: "c3", text: "Completed before 5:00 PM", check: "time" }],
      [{ id: "c1", met: true, evidence: "Tub empty, drain clear" }, { id: "c2", met: true, evidence: "Receipt total $8.49" }, { id: "c3", met: true, evidence: "Completed 2:06 PM" }], "/fixtures/sink-after.jpg"),
    mk("wo-1033", "p-1", "Alder House", "6A", "Patch drywall in hallway", "Patch and paint the fist-sized hole beside the hallway closet.", seedContractors[2], 21000, "2026-11-04T16:35:00-05:00", "2026-11-04T18:00:00-05:00",
      [{ id: "c1", text: "After photo shows patch sanded and painted to match", check: "photo" }, { id: "c2", text: "Materials receipt totals $40 or less", check: "receipt" }, { id: "c3", text: "Completed before 6:00 PM", check: "time" }],
      [{ id: "c1", met: true, evidence: "Patch flush, paint matches wall" }, { id: "c2", met: true, evidence: "Receipt total $27.80" }, { id: "c3", met: true, evidence: "Completed 4:31 PM" }], "/fixtures/door-4b.svg"),
  ];
}

export function seedWorkOrders(): WorkOrder[] { return [...fixtureSeedOrders(), ...extraPaidOrders()]; }

/** Inserts the full demo data set. Assumes empty tables. */
export async function seedDatabase(db: Db): Promise<void> {
  const orders = seedWorkOrders();
  await db.insert(s.properties).values(seedProperties);
  const unitRows = new Map<string, { id: string; property_id: string; label: string }>();
  for (const o of orders) unitRows.set(o.unit_id, { id: o.unit_id, property_id: o.property_id, label: o.unit });
  unitRows.set(unitId("p-1", "4B"), { id: unitId("p-1", "4B"), property_id: "p-1", label: "4B" });
  unitRows.set(unitId("p-2", "5F"), { id: unitId("p-2", "5F"), property_id: "p-2", label: "5F" });
  await db.insert(s.units).values([...unitRows.values()]);
  await db.insert(s.contractors).values(seedContractors);
  for (const o of orders) {
    await db.insert(s.workOrders).values({ id: o.id, unit_id: o.unit_id, title: o.title, description: o.description, criteria_json: o.criteria, budget_cents: o.budget_cents, status: o.status, created_by: o.created_by, contractor_id: o.contractor_id ?? null, deadline: o.contract ? d(o.contract.deadline) : null, created_at: new Date(d(o.updated_at).getTime() - 2 * 3600_000), updated_at: d(o.updated_at) });
    if (o.negotiation.length) await db.insert(s.negotiations).values({ id: `neg-${o.id}`, work_order_id: o.id, transcript_json: o.negotiation, outcome: "agreed" });
    if (o.contract) await db.insert(s.contracts).values({ id: `ct-${o.id}`, work_order_id: o.id, contractor_id: o.contract.contractor_id, price_cents: o.contract.price_cents, deposit_pct: o.contract.deposit_pct, deadline: d(o.contract.deadline), criteria_json: o.contract.criteria, paypal_order_id: o.contract.paypal_order_id ?? null, paypal_auth_id: o.contract.paypal_auth_id ?? null, paypal_capture_id: o.contract.paypal_capture_id ?? null, approve_url: null });
    if (o.proofs.length) await db.insert(s.proofs).values(o.proofs.map((p) => ({ id: p.id, work_order_id: o.id, kind: p.kind, url: p.url, exif_ts: d(p.exif_ts), uploaded_at: d(p.uploaded_at), exif_missing: Boolean(p.exif_missing) })));
    if (o.verdict) await db.insert(s.verdicts).values({ id: `vd-${o.id}`, work_order_id: o.id, verdict: o.verdict.verdict, confidence: o.verdict.confidence, criteria_results_json: o.verdict.criteria, amount_to_release_cents: o.verdict.amount_to_release_cents, model: o.verdict.model, raw: null, proof_hash: null, created_at: d(o.updated_at) });
    if (o.payouts.length) await db.insert(s.payouts).values(o.payouts.map((p) => ({ id: p.id, work_order_id: o.id, contractor_id: p.contractor_id, amount_cents: p.amount_cents, kind: p.kind, paypal_batch_id: p.paypal_batch_id, paypal_item_id: p.paypal_item_id, status: p.status, paid_at: p.paid_at ? d(p.paid_at) : null, created_at: p.paid_at ? d(p.paid_at) : d(o.updated_at) })));
    await db.insert(s.events).values({ id: `ev-seed-${o.id}`, work_order_id: o.id, type: "seed.work_order", payload_json: { status: o.status, source: "db/seed.ts" }, at: d(o.updated_at) });
  }
}

export async function isEmpty(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(s.contractors);
  return Number(row?.n ?? 0) === 0;
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  if (!(await isEmpty(db))) return false;
  await seedDatabase(db);
  return true;
}

/** Deletes every row (dependency order) and reseeds. */
export async function reseed(db: Db): Promise<void> {
  for (const table of [s.paypalWebhookEvents, s.events, s.payouts, s.verdicts, s.proofs, s.contracts, s.negotiations, s.workOrders, s.contractors, s.units, s.properties]) {
    await db.delete(table).where(sql`true`);
  }
  await seedDatabase(db);
}

// CLI: `npm run db:seed` (seed when empty), `npm run db:seed -- --force` (wipe + reseed), `npm run db:migrate` (migrate only).
async function main() {
  const { config } = await import("dotenv");
  config({ path: ".env.local" }); config();
  const { getDb, closeDb, dbDriver } = await import("@/lib/db/client");
  const force = process.argv.includes("--force");
  const migrateOnly = process.argv.includes("--migrate-only");
  const db = await getDb({ seed: false });
  if (migrateOnly) console.log(`Migrations applied (${dbDriver()}).`);
  else if (force) { await reseed(db); console.log(`Reseeded ${dbDriver()} database.`); }
  else console.log((await seedIfEmpty(db)) ? `Seeded empty ${dbDriver()} database.` : `Database already seeded (${dbDriver()}); nothing to do. Use --force to wipe and reseed.`);
  await closeDb();
}
const isCli = typeof process !== "undefined" && process.argv[1] !== undefined && /[\\/]db[\\/]seed\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isCli) main().catch((err) => { console.error(err); process.exit(1); });
