// Exercises the persistence layer end to end against a throwaway database.
// PGlite:    npx tsx scripts/db-check.ts
// Postgres:  DATABASE_URL=postgres://... npx tsx scripts/db-check.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = "/private/tmp/claude-501/-Users-justin-Desktop-Projects-punchlist-pay/b78ddc55-b6a8-46b9-accd-9d88f1334b01/scratchpad";
if (!process.env.DATABASE_URL) {
  const base = fs.existsSync(scratch) ? scratch : os.tmpdir();
  process.env.PGLITE_DIR = fs.mkdtempSync(path.join(base, "pglite-check-"));
}

async function main() {
  const { ensureDb, closeDb, dbDriver } = await import("../lib/db/client");
  const repo = await import("../lib/db/repo");
  await ensureDb();
  console.log(`driver=${dbDriver()} dir=${process.env.PGLITE_DIR ?? "(postgres)"}`);

  // Seed assertions
  const orders = await repo.listWorkOrders();
  assert.equal(orders.length, 7, "7 seeded work orders");
  assert.equal(orders.filter((o) => o.status === "paid").length, 6, "6 paid");
  assert.equal(orders.filter((o) => o.status === "escalated").length, 1, "1 escalated");
  assert.equal((await repo.listContractors()).length, 3, "3 contractors");
  assert.ok(!JSON.stringify(orders).includes("paypal_email"), "view model must not leak paypal_email");
  assert.ok(!JSON.stringify(orders).includes("5O190001S2349870K"), "fixture PayPal ids must not be copied");
  assert.ok(orders.every((o) => !o.contract?.paypal_order_id || o.contract.paypal_order_id.startsWith("SEED-")), "seed ids prefixed");
  assert.ok(orders.every((o) => o.criteria.length === 3), "every seeded row has 3 criteria");
  assert.ok(orders.filter((o) => o.status === "paid").every((o) => o.verdict?.verdict === "pass"), "paid rows carry pass verdicts");
  const esc = orders.find((o) => o.id === "wo-1041")!;
  assert.equal(esc.verdict?.verdict, "fail"); assert.equal(esc.proofs.length, 2); assert.equal(esc.payouts.length, 0);
  assert.equal(esc.property_name, "Alder House"); assert.equal(esc.unit, "4B"); assert.equal(esc.contractor_name, "Sara Kim"); assert.equal(esc.avatar_tone, 1);
  assert.ok(orders[0].updated_at >= orders[orders.length - 1].updated_at, "sorted newest first");
  const paidTotal = orders.filter((o) => o.status === "paid").reduce((n, o) => n + o.payouts.filter((p) => p.status === "paid").reduce((m, p) => m + p.amount_cents, 0), 0);
  console.log(`seed ok: ${orders.length} orders, paid total $${(paidTotal / 100).toFixed(2)}`);

  // Flow
  const created = await repo.createWorkOrder({ title: "Kitchen sink leak", description: "4B kitchen sink leaking under the cabinet, fix today, under $250", unit: "4B", property_id: "p-1", budget_cents: 22000, criteria: [{ id: "c1", text: "After photo shows dry P-trap", check: "photo" }, { id: "c2", text: "Receipt ≤ $60", check: "receipt" }, { id: "c3", text: "Before 6 PM", check: "time" }], deadline: "2026-11-09T18:00:00-05:00" });
  assert.equal(created.id, "wo-1043", "next id after seed is wo-1043");
  assert.equal(created.status, "draft"); assert.equal(created.unit, "4B"); assert.equal(created.property_id, "p-1"); assert.equal(created.unit_id, esc.unit_id, "same unit label resolves to the seeded unit row");
  const created2 = await repo.createWorkOrder({ title: "New unit", description: "x", unit: "7c", budget_cents: 100, criteria: [] });
  assert.equal(created2.id, "wo-1044"); assert.equal(created2.unit, "7C");

  const neg = await repo.updateWorkOrder(created.id, { status: "negotiating", contractor_id: "mike" });
  assert.equal(neg.status, "negotiating"); assert.equal(neg.contractor_id, "mike"); assert.equal(neg.contractor_name, "Mike Torres"); assert.ok(neg.updated_at > created.updated_at || neg.updated_at === created.updated_at);
  await repo.appendNegotiationTurn(created.id, { id: "t1", role: "dispatcher", text: "Budget $220, today.", offer_cents: 22000 });
  await repo.appendNegotiationTurn(created.id, { id: "t2", role: "contractor", text: "$260 after hours.", offer_cents: 26000 });
  assert.equal((await repo.getWorkOrder(created.id))!.negotiation.length, 2);
  await repo.saveNegotiation(created.id, [{ id: "t1", role: "dispatcher", text: "a" }, { id: "t2", role: "contractor", text: "b" }, { id: "t3", role: "system", text: "Order created" }], "agreed");
  assert.equal((await repo.getWorkOrder(created.id))!.negotiation.length, 3);

  await repo.upsertContract(created.id, { contractor_id: "mike", price_cents: 24000, deposit_pct: 20, deadline: "2026-11-09T16:00:00-05:00", criteria: created.criteria, paypal_order_id: "TEST-ORDER-1", approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=TEST-ORDER-1" });
  let wo = (await repo.getWorkOrder(created.id))!;
  assert.equal(wo.contract?.price_cents, 24000); assert.equal(wo.contract?.paypal_order_id, "TEST-ORDER-1"); assert.equal(wo.contract?.approve_url?.includes("TEST-ORDER-1"), true); assert.equal(wo.contract?.paypal_auth_id, undefined);
  assert.equal((await repo.listOrdersAwaitingFunding()).map((o) => o.id).join(), created.id, "awaiting funding lists the unauthorized order");
  assert.equal((await repo.findWorkOrderByPaypalOrderId("TEST-ORDER-1"))?.id, created.id);
  assert.equal(await repo.findWorkOrderByPaypalOrderId("nope"), null);
  await repo.updateContract(created.id, { paypal_auth_id: "TEST-AUTH-1" });
  await repo.updateWorkOrder(created.id, { status: "funded" });
  assert.equal((await repo.listOrdersAwaitingFunding()).length, 0);
  await repo.upsertContract(created.id, { ...(await repo.getWorkOrder(created.id))!.contract!, price_cents: 24000, deposit_pct: 20, criteria: created.criteria, paypal_order_id: "TEST-ORDER-1", paypal_auth_id: "TEST-AUTH-1" });
  assert.equal((await repo.getWorkOrder(created.id))!.contract?.paypal_auth_id, "TEST-AUTH-1", "upsert on existing contract updates in place");

  const proof = await repo.addProof({ work_order_id: created.id, kind: "checkin", url: "/api/files/x.jpg", exif_ts: "2026-11-09T15:11:00-05:00", uploaded_at: new Date().toISOString() });
  assert.equal(proof.kind, "checkin"); assert.equal(proof.exif_missing, undefined);
  const proof2 = await repo.addProof({ work_order_id: created.id, kind: "checkin", url: "/api/files/y.jpg", exif_ts: "", uploaded_at: new Date().toISOString(), exif_missing: true });
  assert.equal(proof2.exif_missing, true); assert.ok(proof2.exif_ts, "exif_ts falls back to upload time");
  wo = (await repo.getWorkOrder(created.id))!;
  assert.equal(wo.proofs.length, 1, "same-kind proof replaced"); assert.equal(wo.proofs[0].url, "/api/files/y.jpg");

  const dep = await repo.upsertPayout({ id: "", work_order_id: created.id, contractor_id: "mike", amount_cents: 4800, kind: "deposit", paypal_batch_id: "TEST-BATCH-D", paypal_item_id: "", status: "pending" });
  assert.equal(dep.id, `pay-${created.id}-deposit`); assert.equal(dep.status, "pending");
  assert.equal((await repo.listPendingPayouts()).length, 1);
  assert.equal((await repo.findPayoutByBatchId("TEST-BATCH-D"))?.id, dep.id);
  await repo.updatePayout(dep.id, { status: "paid", paid_at: new Date().toISOString(), paypal_item_id: "TEST-ITEM-D" });
  assert.equal((await repo.listPendingPayouts()).length, 0);
  const dep2 = await repo.upsertPayout({ ...dep, amount_cents: 4800, paypal_batch_id: "TEST-BATCH-D", paypal_item_id: "TEST-ITEM-D", status: "paid" });
  assert.equal(dep2.status, "paid"); assert.equal((await repo.getWorkOrder(created.id))!.payouts.length, 1, "upsert keyed by kind");
  await repo.upsertPayout({ id: "", work_order_id: created.id, contractor_id: "mike", amount_cents: 19200, kind: "balance", paypal_batch_id: "TEST-BATCH-B", paypal_item_id: "", status: "pending" });
  wo = (await repo.getWorkOrder(created.id))!;
  assert.deepEqual(wo.payouts.map((p) => p.kind), ["deposit", "balance"], "payouts sorted deposit→balance");

  const verdict = { verdict: "pass" as const, confidence: 0.93, criteria: [{ id: "c1", met: true, evidence: "dry" }], amount_to_release_cents: 19200, model: "test" };
  await repo.saveVerdict(created.id, verdict, { proof_hash: "h1", raw: { ok: true } });
  assert.deepEqual(await repo.findVerdictByHash(created.id, "h1"), verdict);
  assert.equal(await repo.findVerdictByHash(created.id, "h2"), null);
  assert.equal((await repo.getWorkOrder(created.id))!.verdict?.confidence, 0.93);
  await repo.saveVerdict(created.id, { ...verdict, confidence: 0.5, verdict: "partial" }, { proof_hash: "h2" });
  assert.equal((await repo.getWorkOrder(created.id))!.verdict?.verdict, "partial", "latest verdict wins");
  await repo.clearVerdict(created.id);
  assert.equal((await repo.getWorkOrder(created.id))!.verdict, undefined);
  await repo.addProof({ work_order_id: created.id, kind: "after", url: "/a.jpg", exif_ts: new Date().toISOString(), uploaded_at: new Date().toISOString() });
  await repo.deleteProofs(created.id, ["after", "receipt"]);
  assert.deepEqual((await repo.getWorkOrder(created.id))!.proofs.map((p) => p.kind), ["checkin"]);

  assert.equal(await repo.recordWebhookEvent("WH-1", "PAYMENT.CAPTURE.COMPLETED", { a: 1 }), true);
  assert.equal(await repo.recordWebhookEvent("WH-1", "PAYMENT.CAPTURE.COMPLETED", { a: 1 }), false, "duplicate webhook returns false");
  await repo.addEvent(created.id, "test.event", { hello: "world" });
  await repo.addEvent(null, "system.event", null);
  const events = await repo.listEvents(created.id);
  assert.equal(events.length, 1); assert.equal(events[0].type, "test.event"); assert.deepEqual(events[0].payload, { hello: "world" });

  const units = await repo.listUnits();
  assert.ok(units.some((u) => u.unit === "7C"), "new unit listed"); assert.ok(units.every((u) => u.property_name));
  assert.equal((await repo.getContractor("mike"))?.paypal_email.length! > 0, true); assert.equal(await repo.getContractor("zed"), null);

  // Shape sanity against lib/types.ts
  wo = (await repo.getWorkOrder(created.id))!;
  for (const key of ["id", "property_id", "property_name", "unit_id", "unit", "title", "description", "criteria", "budget_cents", "status", "created_by", "updated_at", "negotiation", "proofs", "payouts", "contract"]) assert.ok(key in wo, `view model has ${key}`);
  assert.ok(!("paypal_email" in wo));
  assert.match(wo.updated_at, /^\d{4}-\d{2}-\d{2}T.*Z$/, "ISO timestamps");
  assert.equal(await repo.getWorkOrder("wo-0"), null);
  assert.equal((await repo.listWorkOrders()).length, 9);
  console.log(`flow ok: ${created.id} draft→negotiating→funded, proofs/payouts/verdicts/webhook dedupe all behaved (${dbDriver()})`);
  await closeDb();
}

main().catch((err) => { console.error(err); process.exit(1); });
