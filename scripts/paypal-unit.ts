// Offline unit checks for lib/paypal with a mocked fetch. Run: npx tsx scripts/paypal-unit.ts
// No network, no credentials. Exercises pure helpers plus token caching/refresh, idempotency headers,
// approve-link extraction, authorize parsing, duplicate-payout resolution and webhook verification.
import assert from "node:assert/strict";

process.env.PAYPAL_ENV = "sandbox";
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
process.env.APP_URL = "http://localhost:3000";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Mock = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> } | Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;
const calls: Call[] = [];
let queue: Mock[] = [];
let fallbackMock: Mock | null = null;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let body: unknown = undefined;
  if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  const call: Call = { method: init?.method ?? "GET", url, headers, body };
  calls.push(call);
  const mock = queue.shift() ?? fallbackMock;
  if (!mock) throw new Error(`Unexpected fetch ${call.method} ${url}`);
  const r = await mock(call);
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
}) as typeof fetch;

const tokenOk: Mock = (c) => { assert.match(c.url, /\/v1\/oauth2\/token$/); assert.equal(c.method, "POST"); assert.match(c.headers.authorization, /^Basic /); return { status: 200, body: { access_token: `tok-${calls.length}`, expires_in: 32400 } }; };
const reset = () => { calls.length = 0; queue = []; fallbackMock = null; };

async function main() {
const client = await import("../lib/paypal/client");
const orders = await import("../lib/paypal/orders");
const payouts = await import("../lib/paypal/payouts");
const webhooks = await import("../lib/paypal/webhooks");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { reset(); client.invalidateAccessToken(); await fn(); passed++; console.log(`ok  ${name}`); }

await test("centsToAmount / amountToCents round-trip", () => {
  assert.equal(client.centsToAmount(24000), "240.00");
  assert.equal(client.centsToAmount(4800), "48.00");
  assert.equal(client.centsToAmount(5), "0.05");
  assert.equal(client.amountToCents("240.00"), 24000);
  assert.equal(client.amountToCents("0.10"), 10);
  assert.equal(client.amountToCents(41.07), 4107);
  assert.equal(client.paypalBaseUrl(), "https://api-m.sandbox.paypal.com");
});

await test("senderBatchId", () => {
  assert.equal(payouts.senderBatchId("wo-1042", "deposit"), "wo-1042:deposit");
  assert.equal(payouts.senderBatchId("wo-1042", "balance"), "wo-1042:balance");
});

await test("mapPayoutStatus covers every documented enum", () => {
  const m = payouts.mapPayoutStatus;
  assert.equal(m("PENDING", "SUCCESS"), "paid");
  assert.equal(m("SUCCESS"), "paid");
  for (const s of ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "CANCELED"]) assert.equal(m("SUCCESS", s), "failed", s);
  for (const s of ["PENDING", "UNCLAIMED", "ONHOLD", "NEW"]) assert.equal(m("SUCCESS", s), "pending", s);
  for (const s of ["PENDING", "PROCESSING", "NEW", ""]) assert.equal(m(s), "pending", s || "(empty)");
  assert.equal(m("DENIED"), "failed");
  assert.equal(m("CANCELED"), "failed");
  assert.equal(m("success", "success"), "paid"); // case-insensitive
});

await test("parseEvent validates id and event_type", () => {
  const e = webhooks.parseEvent(JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", create_time: "2026-11-09T20:00:00Z", resource_type: "capture", resource: { id: "CAP1" }, summary: "s" }));
  assert.equal(e.id, "WH-1"); assert.equal(e.event_type, "PAYMENT.CAPTURE.COMPLETED"); assert.equal(e.resource.id, "CAP1"); assert.equal(e.summary, "s");
  assert.throws(() => webhooks.parseEvent("not json"), /valid JSON/);
  assert.throws(() => webhooks.parseEvent("[]"), /JSON object/);
  assert.throws(() => webhooks.parseEvent(JSON.stringify({ event_type: "X" })), /missing id/);
  assert.throws(() => webhooks.parseEvent(JSON.stringify({ id: "WH-2" })), /missing event_type/);
  assert.deepEqual(webhooks.parseEvent(JSON.stringify({ id: "WH-3", event_type: "X", resource: "oops" })).resource, {});
  assert.equal(webhooks.isHandledEvent("PAYMENT.PAYOUTS-ITEM.FAILED"), true);
  assert.equal(webhooks.isHandledEvent("BILLING.PLAN.CREATED"), false);
});

await test("approveLink prefers payer-action, falls back to approve, then checkoutnow", () => {
  assert.equal(orders.approveLink([{ rel: "approve", href: "https://a" }, { rel: "payer-action", href: "https://p" }]), "https://p");
  assert.equal(orders.approveLink([{ rel: "self", href: "https://s" }, { rel: "approve", href: "https://a" }]), "https://a");
  assert.equal(orders.approveLink([{ rel: "self", href: "https://s" }], "ORD1"), "https://www.sandbox.paypal.com/checkoutnow?token=ORD1");
  assert.equal(orders.approveLink(undefined), undefined);
});

await test("createAuthorizeOrder: body, idempotency header, approve url, token cached across calls", async () => {
  queue = [tokenOk, (c) => {
    assert.match(c.url, /\/v2\/checkout\/orders$/);
    assert.equal(c.headers.authorization, "Bearer tok-1");
    assert.equal(c.headers["paypal-request-id"], "wo-1042:order");
    assert.equal(c.headers.prefer, "return=representation");
    const b = c.body as { intent: string; purchase_units: { reference_id: string; custom_id: string; amount: { currency_code: string; value: string } }[]; payment_source: { paypal: { experience_context: Record<string, string> } } };
    assert.equal(b.intent, "AUTHORIZE");
    assert.equal(b.purchase_units[0].reference_id, "wo-1042");
    assert.equal(b.purchase_units[0].custom_id, "wo-1042");
    assert.deepEqual(b.purchase_units[0].amount, { currency_code: "USD", value: "240.00" });
    assert.equal(b.payment_source.paypal.experience_context.user_action, "PAY_NOW");
    assert.equal(b.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
    assert.equal(b.payment_source.paypal.experience_context.return_url, "http://localhost:3000/dashboard?fixture=0");
    return { status: 200, body: { id: "5O190001S2349870K", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190001S2349870K" }, { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190001S2349870K" }] } };
  }, (c) => { assert.equal(c.headers.authorization, "Bearer tok-1"); return { status: 201, body: { id: "ORD2", status: "CREATED", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD2" }] } }; }];
  const created = await orders.createAuthorizeOrder({ work_order_id: "wo-1042", amount_cents: 24000, description: "Kitchen sink leak · Unit 4B" });
  assert.deepEqual(created, { order_id: "5O190001S2349870K", status: "PAYER_ACTION_REQUIRED", approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=5O190001S2349870K" });
  const second = await orders.createAuthorizeOrder({ work_order_id: "wo-2", amount_cents: 100, description: "x" });
  assert.equal(second.approve_url, "https://www.sandbox.paypal.com/checkoutnow?token=ORD2");
  assert.equal(calls.filter(c => c.url.endsWith("/v1/oauth2/token")).length, 1, "token fetched once");
  await assert.rejects(orders.createAuthorizeOrder({ work_order_id: "wo-3", amount_cents: 0, description: "x" }), /positive integer/);
});

await test("paypalRequest refreshes the token once on 401 and surfaces PayPalError with debug id", async () => {
  queue = [tokenOk, () => ({ status: 401, body: { error: "invalid_token" } }), tokenOk, (c) => { assert.equal(c.headers.authorization, "Bearer tok-3"); return { status: 200, body: { id: "ORD9", status: "CREATED", links: [{ rel: "approve", href: "https://x" }] } }; }];
  const r = await orders.createAuthorizeOrder({ work_order_id: "wo-9", amount_cents: 100, description: "x" });
  assert.equal(r.order_id, "ORD9");
  assert.equal(calls.filter(c => c.url.endsWith("/v1/oauth2/token")).length, 2);
  reset(); client.invalidateAccessToken();
  queue = [tokenOk, () => ({ status: 422, headers: { "paypal-debug-id": "dbg-123" }, body: { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed.", details: [{ issue: "INSTRUMENT_DECLINED", description: "declined" }] } })];
  try { await orders.captureAuthorization("AUTH1", 19200, "wo-1:capture"); assert.fail("should throw"); }
  catch (e) {
    assert.ok(e instanceof client.PayPalError);
    assert.equal(e.status, 422); assert.equal(e.debugId, "dbg-123"); assert.equal(e.issue, "INSTRUMENT_DECLINED");
    assert.match(e.message, /UNPROCESSABLE_ENTITY: The requested action could not be performed\. \[INSTRUMENT_DECLINED\] \(422\)/);
  }
});

await test("authorizeOrder reads purchase_units[0].payments.authorizations[0] and recovers ORDER_ALREADY_AUTHORIZED", async () => {
  queue = [tokenOk, (c) => { assert.match(c.url, /\/v2\/checkout\/orders\/ORD1\/authorize$/); assert.deepEqual(c.body, {}); assert.equal(c.headers["paypal-request-id"], "ORD1:authorize"); return { status: 201, body: { id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "8A4209933V000912E", status: "CREATED", amount: { currency_code: "USD", value: "240.00" } }] } }] } }; }];
  const a = await orders.authorizeOrder("ORD1");
  assert.deepEqual(a, { order_id: "ORD1", authorization_id: "8A4209933V000912E", status: "CREATED", amount_cents: 24000 });
  reset(); client.invalidateAccessToken();
  queue = [tokenOk, () => ({ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_AUTHORIZED" }] } }), (c) => { assert.equal(c.method, "GET"); assert.match(c.url, /\/v2\/checkout\/orders\/ORD1$/); return { status: 200, body: { id: "ORD1", status: "COMPLETED", purchase_units: [{ amount: { value: "240.00" }, payments: { authorizations: [{ id: "AUTH-EXISTING", status: "CREATED" }] } }] } }; }];
  const again = await orders.authorizeOrder("ORD1");
  assert.equal(again.authorization_id, "AUTH-EXISTING"); assert.equal(again.amount_cents, 24000);
});

await test("captureAuthorization / voidAuthorization / getOrder", async () => {
  queue = [tokenOk, (c) => { assert.match(c.url, /\/v2\/payments\/authorizations\/AUTH1\/capture$/); assert.deepEqual(c.body, { final_capture: true, amount: { currency_code: "USD", value: "192.00" } }); assert.equal(c.headers["paypal-request-id"], "wo-1:capture"); return { status: 201, body: { id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "192.00" } } }; },
    (c) => { assert.deepEqual(c.body, { final_capture: true }); assert.equal(c.headers["paypal-request-id"], undefined); return { status: 201, body: { id: "CAP2", status: "PENDING", amount: { value: "240.00" } } }; },
    (c) => { assert.match(c.url, /\/void$/); assert.equal(c.body, undefined); return { status: 204 }; },
    (c) => { assert.equal(c.method, "GET"); return { status: 200, body: { id: "ORD1", status: "COMPLETED", purchase_units: [{ amount: { value: "240.00" }, payments: { authorizations: [{ id: "AUTH1" }], captures: [{ id: "CAP1" }] } }], links: [{ rel: "self", href: "x" }] } }; }];
  assert.deepEqual(await orders.captureAuthorization("AUTH1", 19200, "wo-1:capture"), { capture_id: "CAP1", status: "COMPLETED", amount_cents: 19200 });
  assert.deepEqual(await orders.captureAuthorization("AUTH1"), { capture_id: "CAP2", status: "PENDING", amount_cents: 24000 });
  await orders.voidAuthorization("AUTH1");
  assert.deepEqual(await orders.getOrder("ORD1"), { order_id: "ORD1", status: "COMPLETED", authorization_id: "AUTH1", capture_id: "CAP1", approve_url: undefined, amount_cents: 24000 });
});

await test("sendPayout: request body, idempotent sender_batch_id, follow-up GET for item id", async () => {
  queue = [tokenOk, (c) => {
    assert.match(c.url, /\/v1\/payments\/payouts$/);
    assert.equal(c.headers["paypal-request-id"], "wo-1042:deposit");
    const b = c.body as { sender_batch_header: { sender_batch_id: string; email_subject: string }; items: { recipient_type: string; receiver: string; amount: { value: string; currency: string }; sender_item_id: string }[] };
    assert.equal(b.sender_batch_header.sender_batch_id, "wo-1042:deposit");
    assert.equal(b.sender_batch_header.email_subject, "Punchlist Pay payout");
    assert.equal(b.items.length, 1);
    assert.equal(b.items[0].recipient_type, "EMAIL");
    assert.equal(b.items[0].receiver, "sb-mike@personal.example.com");
    assert.deepEqual(b.items[0].amount, { value: "48.00", currency: "USD" });
    assert.equal(b.items[0].sender_item_id, "wo-1042:deposit");
    return { status: 201, body: { batch_header: { payout_batch_id: "BATCH123", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "wo-1042:deposit" } }, links: [] } };
  }, (c) => { assert.equal(c.method, "GET"); assert.match(c.url, /\/v1\/payments\/payouts\/BATCH123$/); return { status: 200, body: { batch_header: { payout_batch_id: "BATCH123", batch_status: "PENDING" }, items: [{ payout_item_id: "ITEM123", transaction_status: "PENDING" }] } }; }];
  const r = await payouts.sendPayout({ work_order_id: "wo-1042", kind: "deposit", receiver_email: "sb-mike@personal.example.com", amount_cents: 4800 });
  assert.deepEqual(r, { batch_id: "BATCH123", item_id: "ITEM123", status: "pending", batch_status: "PENDING", item_status: "PENDING", paid_at: undefined });
  await assert.rejects(payouts.sendPayout({ work_order_id: "wo-1", kind: "deposit", receiver_email: "nope", amount_cents: 100 }), /email/);
  await assert.rejects(payouts.sendPayout({ work_order_id: "wo-1", kind: "deposit", receiver_email: "a@b.c", amount_cents: -5 }), /positive integer/);
});

await test("sendPayout: duplicate sender_batch_id resolves to the original batch via the HATEOAS link", async () => {
  queue = [tokenOk, () => ({ status: 400, body: { name: "USER_BUSINESS_ERROR", message: "User business error.", debug_id: "abc", details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists", links: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/EXISTING77", rel: "self", method: "GET" }] }] } }),
    (c) => { assert.equal(c.method, "GET"); assert.match(c.url, /\/v1\/payments\/payouts\/EXISTING77$/); return { status: 200, body: { batch_header: { payout_batch_id: "EXISTING77", batch_status: "SUCCESS", time_completed: "2026-11-09T20:10:00Z" }, items: [{ payout_item_id: "ITEM77", transaction_status: "SUCCESS", time_processed: "2026-11-09T20:09:30Z" }] } }; }];
  const r = await payouts.sendPayout({ work_order_id: "wo-1042", kind: "balance", receiver_email: "sb-mike@personal.example.com", amount_cents: 19200 });
  assert.deepEqual(r, { batch_id: "EXISTING77", item_id: "ITEM77", status: "paid", batch_status: "SUCCESS", item_status: "SUCCESS", paid_at: "2026-11-09T20:09:30Z" });
  assert.equal(payouts.existingBatchIdFromError({ links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/TOP9", rel: "self" }] }), "TOP9");
  assert.equal(payouts.existingBatchIdFromError({ details: [{ issue: "VALIDATION_ERROR" }] }), undefined);
  reset(); client.invalidateAccessToken();
  queue = [tokenOk, () => ({ status: 400, body: { name: "VALIDATION_ERROR", details: [{ issue: "INVALID_RECEIVER" }] } })];
  await assert.rejects(payouts.sendPayout({ work_order_id: "wo-5", kind: "deposit", receiver_email: "a@b.c", amount_cents: 100 }), (e: unknown) => e instanceof client.PayPalError && e.status === 400 && e.issue === "INVALID_RECEIVER");
});

await test("getPayoutBatch maps paid/failed/pending with timestamps", async () => {
  queue = [tokenOk, () => ({ status: 200, body: { batch_header: { payout_batch_id: "B1", batch_status: "SUCCESS", time_completed: "2026-11-09T20:10:00Z" }, items: [{ payout_item_id: "I1", transaction_status: "UNCLAIMED" }] } }),
    () => ({ status: 200, body: { batch_header: { payout_batch_id: "B2", batch_status: "SUCCESS", time_completed: "2026-11-09T20:10:00Z" }, items: [] } }),
    () => ({ status: 200, body: { batch_header: { payout_batch_id: "B3", batch_status: "PROCESSING" }, items: [{ payout_item_id: "I3", transaction_status: "FAILED" }] } })];
  assert.equal((await payouts.getPayoutBatch("B1")).status, "pending"); // unclaimed item wins over SUCCESS batch
  assert.deepEqual(await payouts.getPayoutBatch("B2"), { batch_id: "B2", item_id: "", status: "paid", batch_status: "SUCCESS", item_status: undefined, paid_at: "2026-11-09T20:10:00Z" });
  assert.equal((await payouts.getPayoutBatch("B3")).status, "failed");
});

await test("verifySignature: false without webhook id, headers, or PayPal cert host; true only on SUCCESS; never throws", async () => {
  const body = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} });
  const good = new Headers({ "PAYPAL-AUTH-ALGO": "SHA256withRSA", "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270", "PAYPAL-TRANSMISSION-ID": "t-1", "PAYPAL-TRANSMISSION-SIG": "sig", "PAYPAL-TRANSMISSION-TIME": "2026-11-09T20:00:00Z" });
  queue = [tokenOk, (c) => {
    assert.match(c.url, /\/v1\/notifications\/verify-webhook-signature$/);
    const b = c.body as Record<string, unknown>;
    assert.equal(b.webhook_id, "WH-TEST"); assert.equal(b.auth_algo, "SHA256withRSA"); assert.equal(b.transmission_id, "t-1"); assert.equal(b.transmission_sig, "sig"); assert.equal(b.transmission_time, "2026-11-09T20:00:00Z");
    assert.deepEqual(b.webhook_event, JSON.parse(body));
    return { status: 200, body: { verification_status: "SUCCESS" } };
  }, () => ({ status: 200, body: { verification_status: "FAILURE" } }), () => ({ status: 500, body: { name: "INTERNAL_SERVER_ERROR" } })];
  assert.equal(await webhooks.verifySignature(good, body), true);
  assert.equal(await webhooks.verifySignature(good, body), false); // FAILURE
  assert.equal(await webhooks.verifySignature(good, body), false); // 500 → false, not thrown
  const missing = new Headers({ "PAYPAL-AUTH-ALGO": "SHA256withRSA" });
  assert.equal(await webhooks.verifySignature(missing, body), false);
  const evilCert = new Headers(good); evilCert.set("PAYPAL-CERT-URL", "https://evil.example.com/cert");
  assert.equal(await webhooks.verifySignature(evilCert, body), false);
  assert.equal(await webhooks.verifySignature(good, "not json"), false);
  const fetches = calls.length;
  process.env.PAYPAL_WEBHOOK_ID = "";
  // env is read at import time, so emulate the unconfigured case through a fresh module instance
  const { env } = await import("../lib/config");
  const saved = env.paypal.webhookId; (env.paypal as { webhookId: string }).webhookId = "";
  assert.equal(await webhooks.verifySignature(good, body), false);
  assert.equal(calls.length, fetches, "no network call when webhook id is unset");
  (env.paypal as { webhookId: string }).webhookId = saved;
});

await test("getAccessToken rejects clearly when credentials are missing", async () => {
  const { env } = await import("../lib/config");
  const savedId = env.paypal.clientId; (env.paypal as { clientId: string }).clientId = "";
  await assert.rejects(client.getAccessToken(), /not configured/);
  (env.paypal as { clientId: string }).clientId = savedId;
  assert.equal(calls.length, 0);
});

console.log(`\npaypal-unit: ${passed} checks passed`);
}

main().catch((err) => { console.error(err); process.exit(1); });
