// Calls each Claude agent once against the real API (needs ANTHROPIC_API_KEY in .env.local). PayPal is stubbed: no money moves.
//   npx tsx scripts/agents-live-probe.ts
import fs from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local", quiet: true });

async function main() {
  const { draftWorkOrder } = await import("../lib/agents/dispatcher");
  const { runNegotiation } = await import("../lib/agents/negotiation");
  const { verifyProofs } = await import("../lib/agents/verifier");
  const { localNowIso } = await import("../lib/config");
  const now = localNowIso();

  const t0 = Date.now();
  const draft = await draftWorkOrder("4B kitchen sink leaking under the cabinet, fix today, under $250", { units: [{ unit: "4B", property_name: "Alder House", property_id: "p-1" }], now });
  console.log(`dispatcher ok (${Date.now() - t0} ms):`, JSON.stringify({ title: draft.title, unit: draft.unit, budget_cents: draft.budget_cents, deadline: draft.deadline, criteria: draft.criteria }));

  const order = { id: "wo-probe", property_id: "p-1", property_name: "Alder House", unit_id: "u-4b", unit: "4B", title: draft.title, description: draft.description, criteria: draft.criteria, budget_cents: draft.budget_cents, status: "negotiating" as const, created_by: "pm-1", updated_at: now, negotiation: [], proofs: [], payouts: [] };
  const contractor = { id: "mike", name: "Mike Torres", trade: "Plumbing", paypal_email: "x@example.com", hourly_rate_cents: 9500, avatar_tone: 0 as const, profile: { callout_fee_cents: 6000, after_hours_surcharge_pct: 20, min_job_cents: 12000, availability: "today after 3 PM", style: "brief, firm about after-hours pricing, accepts a fair offer quickly", typical_deposit_pct: 20 } };
  const t1 = Date.now(); let toolCalled = false;
  const run = await runNegotiation({ order, contractor, deposit_pct: 20, max_turns: 4, now }, {
    onTurn: t => console.log(`  ${t.role}: ${t.text}${t.offer_cents ? ` [$${t.offer_cents / 100}]` : ""}`),
    createAuthorizeOrder: async a => { toolCalled = true; console.log(`  -> dispatcher called create_authorize_order(${a.amount_cents}, "${a.description}")`); return { order_id: "PROBE-ORDER", status: "PAYER_ACTION_REQUIRED", approve_url: "https://example.invalid" }; },
  });
  console.log(`negotiation ok (${Date.now() - t1} ms): ${run.outcome}${run.outcome === "agreed" ? ` $${run.price_cents / 100} deposit ${run.deposit_pct}% by ${run.deadline} funded_by=${run.funded_by} tool=${toolCalled}` : ` (${run.reason})`}`);

  const img = (n: string) => ({ data: fs.readFileSync(`public/fixtures/${n}.png`), media_type: "image/png" as const });
  const checkin = new Date(Date.now() - 40 * 60000).toISOString(), after = new Date(Date.now() - 5 * 60000).toISOString();
  const contract = { contractor_id: "mike", price_cents: 24000, deposit_pct: 20, deadline: new Date(Date.now() + 3 * 3600000).toISOString(), criteria: draft.criteria };
  const t2 = Date.now();
  const v = await verifyProofs({ order: { ...order, contract }, checkin_ts: checkin, remaining_cents: 19200, now: new Date().toISOString(), images: [
    { kind: "checkin", ...img("sink-before"), exif_ts: checkin, exif_missing: false },
    { kind: "after", ...img("sink-after"), exif_ts: after, exif_missing: false },
    { kind: "receipt", ...img("receipt"), exif_ts: after, exif_missing: false } ] });
  console.log(`verifier ok (${Date.now() - t2} ms): ${v.verdict.verdict} ${v.verdict.confidence} release ${v.verdict.amount_to_release_cents} model ${v.verdict.model}`);
  v.verdict.criteria.forEach(c => console.log(`  ${c.met ? "✓" : "✗"} ${c.id}: ${c.evidence}`));
}
main().catch(e => { console.error("PROBE FAILED:", e?.message ?? e); process.exit(1); });
