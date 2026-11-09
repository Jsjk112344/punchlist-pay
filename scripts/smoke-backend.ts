// Backend smoke: drives the real flows (the code behind every API route) against a throwaway database.
//
//   npx tsx scripts/smoke-backend.ts            offline: fixture money rail + fixture agents, fresh PGlite. No network.
//   npx tsx scripts/smoke-backend.ts --live     uses .env.local (PayPal sandbox + Claude). Creates a real sandbox order,
//                                               prints the approve URL, and waits until you approve it as the PM account.
//
// Offline asserts the full story: request → negotiate → funded → check-in deposit → proof → PASS → balance → paid,
// guardrails (no balance payout without a passing verdict, deposit idempotency), and wrong-door → redo with nothing paid.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const live = process.argv.includes("--live");
if (live) { require("dotenv").config({ path: ".env.local" }); }
else {
  for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "ANTHROPIC_API_KEY", "DATABASE_URL"]) delete process.env[k];
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "punchlist-uploads-"));
}
if (!process.env.DATABASE_URL) process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "punchlist-smoke-"));

const step = (msg: string) => console.log(`  ✓ ${msg}`);
const fileFrom = (p: string, type = "image/png") => new File([fs.readFileSync(p)], path.basename(p), { type });
const pick = (name: string) => { const jpg = `public/fixtures/${name}.jpg`; return fs.existsSync(jpg) ? fileFrom(jpg, "image/jpeg") : fileFrom(`public/fixtures/${name}.png`); };

async function main() {
  const { moneyMode, agentMode } = await import("../lib/config");
  const flows = await import("../lib/flows");
  const repo = await import("../lib/db/repo");
  const { ensureDb, closeDb, dbDriver } = await import("../lib/db/client");
  await ensureDb();
  console.log(`backend smoke · money=${moneyMode()} agents=${agentMode()} db=${dbDriver()}`);
  if (live) assert.equal(moneyMode(), "live", "--live needs PAYPAL_CLIENT_ID/SECRET in .env.local");

  // 1. Request → structured work order
  const wo = await flows.createWorkOrderFromText("4B kitchen sink leaking under the cabinet, fix today, under $250");
  assert.equal(wo.status, "draft"); assert.equal(wo.unit, "4B"); assert.equal(wo.criteria.length, 3);
  assert.ok(wo.budget_cents > 0 && wo.budget_cents <= 25000, `budget ${wo.budget_cents} within the $250 cap`);
  assert.ok(wo.criteria.every(c => ["photo", "receipt", "time"].includes(c.check)));
  step(`dispatcher → ${wo.id} "${wo.title}" budget $${wo.budget_cents / 100}`);

  // 2. Negotiation → contract + PayPal order created by the Dispatcher's tool call
  const turns: string[] = [];
  const neg = await flows.negotiateWorkOrder(wo.id, "mike", t => { turns.push(`${t.role}: ${t.text}`); });
  assert.equal(neg.outcome, "agreed", `negotiation outcome ${neg.outcome} ${neg.reason ?? ""}`);
  assert.ok(neg.contract?.paypal_order_id, "contract carries the PayPal order id");
  const spoken = turns.filter(t => !t.startsWith("system"));
  assert.ok(spoken.length >= 2 && spoken.length <= 4, `2–4 spoken turns (got ${spoken.length})`);
  turns.forEach(t => console.log(`      ${t}`));
  step(`negotiated $${neg.contract!.price_cents / 100}, deposit ${neg.contract!.deposit_pct}% · order ${neg.paypal_order_id}`);

  // 3. Funding
  let funded = await flows.mustGet(wo.id);
  if (!funded.contract?.paypal_auth_id) {
    assert.ok(neg.approve_url, "live order has an approve URL");
    console.log(`\n  Approve as the PM sandbox account:\n  ${neg.approve_url}\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("  Press Enter after approving in PayPal… "); rl.close();
    funded = await flows.confirmFunding(wo.id, neg.paypal_order_id);
  }
  assert.equal(funded.status, "funded"); assert.ok(funded.contract?.paypal_auth_id);
  step(`funded · authorization ${funded.contract!.paypal_auth_id}`);

  // Guardrail: no balance payout before a passing verdict
  await assert.rejects(flows.releasePayout(wo.id, 1000, "balance"), /blocked|check-in|not funded/i);
  step("balance payout blocked before verification");

  // 4. Check-in → deposit
  await flows.recordProof(wo.id, "checkin", pick("sink-before"));
  let o = await flows.mustGet(wo.id);
  const deposit = Math.round(o.contract!.price_cents * o.contract!.deposit_pct / 100);
  assert.equal(o.status, "in_progress");
  const dep = o.payouts.find(p => p.kind === "deposit");
  if (deposit > 0) { assert.equal(dep?.amount_cents, deposit); assert.ok(dep && dep.status !== "failed"); }
  const again = deposit > 0 ? await flows.releasePayout(wo.id, deposit, "deposit") : null;
  if (again) assert.equal(again.paypal_batch_id, dep!.paypal_batch_id, "deposit is idempotent");
  step(`check-in → deposit $${deposit / 100} ${dep?.status ?? "n/a"} (${dep?.paypal_batch_id ?? "none"})`);

  // 5. Proof → verify → capture + balance
  await flows.recordProof(wo.id, "receipt", pick("receipt"));
  await flows.recordProof(wo.id, "after", pick("sink-after"));
  const verdict = await flows.verifyWorkOrder(wo.id);
  o = await flows.mustGet(wo.id);
  console.log(`      verdict ${verdict.verdict} ${Math.round(verdict.confidence * 100)}% · ${verdict.model}`);
  verdict.criteria.forEach(c => console.log(`      ${c.met ? "✓" : "✗"} ${c.id}: ${c.evidence}`));
  if (!live) {
    assert.equal(verdict.verdict, "pass"); assert.equal(o.status, "paid");
    assert.equal(o.payouts.reduce((n, p) => n + (p.status === "paid" ? p.amount_cents : 0), 0), o.contract!.price_cents);
    assert.ok(o.contract?.paypal_capture_id, "authorization captured before the balance payout");
    const cached = await flows.verifyWorkOrder(wo.id); assert.deepEqual(cached, verdict, "re-verify returns the cached verdict");
  } else {
    assert.ok(["paid", "in_progress", "escalated", "under_review"].includes(o.status));
    for (let i = 0; i < 20 && o.status !== "paid" && o.payouts.some(p => p.status === "pending"); i++) {
      await new Promise(r => setTimeout(r, 3000)); await (await import("../lib/reconcile")).reconcilePending(true); o = await flows.mustGet(wo.id);
    }
  }
  step(`after + receipt → ${verdict.verdict.toUpperCase()} → status ${o.status} · payouts ${o.payouts.map(p => `${p.kind}:${p.status}`).join(", ")}`);

  // 6. Wrong-door job: escalated, nothing paid, PM requests redo
  const bad = await flows.mustGet("wo-1041");
  assert.equal(bad.status, "escalated"); assert.equal(bad.payouts.length, 0); assert.equal(bad.verdict?.verdict, "fail");
  await assert.rejects(flows.releasePayout("wo-1041", 16000, "balance"), /blocked/i);
  const redo = await flows.decideWorkOrder("wo-1041", "redo");
  assert.equal(redo.status, "redo_requested"); assert.equal(redo.payouts.length, 0); assert.equal(redo.verdict, undefined);
  assert.ok(redo.proofs.every(p => p.kind === "checkin"));
  step("wrong door → escalated, payout blocked, redo requested, nothing paid");

  // 7. Ledger + events
  const ledger = await repo.listWorkOrders();
  assert.ok(ledger.some(x => x.id === wo.id)); assert.ok(!JSON.stringify(ledger).includes("paypal_email"));
  const events = await repo.listEvents(wo.id);
  assert.ok(events.some(e => e.type === "paypal.order.created")); assert.ok(events.some(e => e.type === "verdict.recorded"));
  step(`ledger ${ledger.length} rows · ${events.length} events on ${wo.id}`);

  await closeDb();
  console.log(`Backend smoke passed (${live ? "live" : "offline"}).`);
}
main().catch(e => { console.error("Backend smoke FAILED:", e); process.exit(1); });
