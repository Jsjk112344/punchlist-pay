// Deterministic unit tests for lib/agents with a scripted fake Anthropic client. No network, no API key.
// Run: npx tsx scripts/agents-unit.ts
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { __setClientForTests, AgentOutputError } from "../lib/agents/client";
import { validateDraft, draftWorkOrder, defaultDeadline } from "../lib/agents/dispatcher";
import { runNegotiation, extractDollars, rewriteTimeCriteria, formatClock } from "../lib/agents/negotiation";
import { enforceHardRules, normalizeVerdict, verifyProofs } from "../lib/agents/verifier";
import type { ContractorProfile, TranscriptTurn, Verdict, WorkOrder } from "../lib/types";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Block = BetaMessage["content"][number];
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function message(content: Block[], stop_reason: BetaMessage["stop_reason"] = "end_turn"): BetaMessage {
  return { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason, stop_sequence: null, stop_details: null, container: null, context_management: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null, output_tokens_details: null } } as unknown as BetaMessage;
}
const text = (t: string): Block => ({ type: "text", text: t, citations: null } as unknown as Block);
const tool = (name: string, input: unknown, id = `tu_${Math.random().toString(36).slice(2, 8)}`): Block => ({ type: "tool_use", id, name, input } as unknown as Block);
const json = (obj: unknown) => message([text(JSON.stringify(obj))]);
const names = (tools: Params["tools"]) => tools?.map((t) => (t as { name: string }).name);

function fakeClient(queue: BetaMessage[]) {
  const calls: Params[] = [];
  const client = { beta: { messages: { create: async (params: Params) => { calls.push(params); const next = queue.shift(); if (!next) throw new Error("fake client: no scripted response left"); return next; } } } };
  __setClientForTests(client as unknown as Anthropic);
  return { calls, remaining: () => queue.length };
}

const NOW = "2026-11-09T15:05:00-05:00";
const units = [{ unit: "4B", property_name: "Alder House", property_id: "p-1" }, { unit: "12A", property_name: "Birch Court", property_id: "p-2" }];
const order: WorkOrder = {
  id: "wo-1", property_id: "p-1", property_name: "Alder House", unit_id: "u-4b", unit: "4B", title: "Kitchen sink leak",
  description: "4B kitchen sink leaking under the cabinet, fix today, under $250", budget_cents: 22000, status: "draft", created_by: "pm-1", updated_at: NOW,
  criteria: [{ id: "c1", text: "After photo shows dry P-trap and connections", check: "photo" }, { id: "c2", text: "Parts receipt totals $60 or less", check: "receipt" }, { id: "c3", text: "Completed before 6:00 PM", check: "time" }],
  negotiation: [], proofs: [], payouts: [],
};
const mike: ContractorProfile = { id: "mike", name: "Mike Torres", trade: "Plumbing", paypal_email: "sb-mike@personal.example.com", hourly_rate_cents: 9500, avatar_tone: 0,
  profile: { callout_fee_cents: 6000, after_hours_surcharge_pct: 15, min_job_cents: 12000, availability: "today after 2 PM", style: "direct", typical_deposit_pct: 20 } };

async function testDispatcher() {
  // validation: 2 criteria rejected
  assert.throws(() => validateDraft({ title: "x", unit: "4B", property_id: null, budget_cents: 22000, deadline: NOW, criteria: [{ text: "a", check: "photo" }, { text: "b", check: "time" }] }, "t", { units, now: NOW }), AgentOutputError);
  assert.throws(() => validateDraft({ title: "x", unit: "4B", property_id: null, budget_cents: 0, deadline: NOW, criteria: [{ text: "a", check: "photo" }, { text: "b", check: "time" }, { text: "c", check: "receipt" }] }, "t", { units, now: NOW }), /positive/);
  assert.throws(() => validateDraft({ title: "x", unit: "4B", property_id: null, budget_cents: 100, deadline: NOW, criteria: [{ text: "a", check: "smell" }, { text: "b", check: "time" }, { text: "c", check: "receipt" }] }, "t", { units, now: NOW }), /invalid check/);
  // full call through the fake client with structured output
  const fake = fakeClient([json({ title: "Kitchen sink leak that is a very long title indeed", unit: "4b", property_id: null, budget_cents: 22000, deadline: "not a date",
    criteria: [{ text: "After photo shows dry P-trap and connections", check: "photo" }, { text: "Parts receipt totals $60 or less", check: "receipt" }, { text: "Completed before 6:00 PM", check: "time" }] })]);
  const draft = await draftWorkOrder(order.description, { units, now: NOW });
  assert.equal(draft.unit, "4B"); assert.equal(draft.property_id, "p-1"); assert.equal(draft.title.length, 40);
  assert.equal(draft.deadline, "2026-11-09T18:00:00-05:00"); assert.deepEqual(draft.criteria.map((c) => c.id), ["c1", "c2", "c3"]); assert.equal(draft.description, order.description);
  const p = fake.calls[0];
  assert.equal(p.model, "claude-sonnet-5-5"); assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]); assert.equal((p as unknown as { fallbacks: string }).fallbacks, "default");
  assert.equal(p.output_config?.effort, "low"); assert.equal(p.output_config?.format?.type, "json_schema"); assert.equal(p.max_tokens, 2048);
  assert.equal(defaultDeadline("2026-11-09T09:00:00Z"), "2026-11-09T18:00:00Z");
  // refusal surfaces as a typed error
  fakeClient([{ ...json({}), stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "nope" } } as unknown as BetaMessage]);
  await assert.rejects(draftWorkOrder("x", { units, now: NOW }), /declined.*cyber/);
  console.log("✓ dispatcher");
}

async function testNegotiationAgreed() {
  const deadline = "2026-11-09T16:00:00-05:00";
  const fake = fakeClient([
    message([tool("counter", { text: "Kitchen sink leak, Unit 4B. Budget $220, today.", offer_cents: 22000, deadline: null })]),
    message([tool("counter", { text: "After-hours callout. I can do $260.", offer_cents: 26000, deadline: null })]),
    message([tool("counter", { text: "$240 if finished by 4 PM.", offer_cents: 24000, deadline })]),
    message([tool("agree", { text: "Agreed. I'll take it.", price_cents: 24000, deadline, deposit_pct: 20 })]),
    message([text("Funding now."), tool("create_authorize_order", { amount_cents: 24000, description: "Kitchen sink leak · Unit 4B · Mike Torres" }, "tu_fund")], "tool_use"),
    message([text("Order created; awaiting PM approval.")]),
  ]);
  const turns: TranscriptTurn[] = []; const hookCalls: { amount_cents: number; description: string }[] = [];
  const run = await runNegotiation({ order, contractor: mike, deposit_pct: 20, max_turns: 4, now: NOW }, {
    onTurn: (t) => { turns.push(t); },
    createAuthorizeOrder: async (args) => { hookCalls.push(args); return { order_id: "5O190001S2349870K", approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=5O190001S2349870K", status: "PAYER_ACTION_REQUIRED" }; },
  });
  assert.equal(run.outcome, "agreed"); if (run.outcome !== "agreed") return;
  assert.equal(run.price_cents, 24000); assert.equal(run.deadline, deadline); assert.equal(run.deposit_pct, 20);
  assert.equal(run.paypal_order_id, "5O190001S2349870K"); assert.ok(run.approve_url?.includes("checkoutnow")); assert.equal(run.funded_by, "agent");
  assert.deepEqual(hookCalls, [{ amount_cents: 24000, description: "Kitchen sink leak · Unit 4B · Mike Torres" }]);
  assert.equal(turns.length, 4); assert.deepEqual(turns.map((t) => t.offer_cents), [22000, 26000, 24000, 24000]);
  assert.deepEqual(turns.map((t) => t.role), ["dispatcher", "contractor", "dispatcher", "contractor"]); assert.deepEqual(turns.map((t) => t.id), ["t1", "t2", "t3", "t4"]);
  assert.ok(turns.every((t) => t.timestamp && t.text.length > 0));
  assert.deepEqual(run.transcript, turns);
  assert.equal(run.criteria.find((c) => c.check === "time")?.text, "Completed before 4:00 PM");
  assert.equal(run.criteria.find((c) => c.id === "c1")?.text, order.criteria[0].text);
  // request shapes: strict tools, auto tool choice, dispatcher gets no PayPal tool during talk, funding call gets only that tool
  const [t1, t2, , , fund, ack] = fake.calls;
  assert.equal(t1.tool_choice?.type, "auto"); assert.ok(t1.tools?.every((t) => (t as { strict?: boolean }).strict === true));
  assert.deepEqual(names(t1.tools), ["counter", "agree", "walk_away"]); assert.deepEqual(names(t2.tools), ["counter", "agree", "walk_away"]);
  assert.deepEqual(names(fund.tools), ["create_authorize_order"]); assert.equal(ack.tool_choice?.type, "none");
  assert.ok(typeof t1.system === "string" && t1.system.includes("$220.00") && t1.system.includes("20%"));
  assert.ok(typeof t2.system === "string" && t2.system.includes("Mike Torres") && t2.system.includes("15%"));
  // the contractor's second message sees the dispatcher's opener as a user turn
  assert.equal(t2.messages.length, 1); assert.ok(String(t2.messages[0].content).includes("Dispatcher: \"Kitchen sink leak"));
  // the dispatcher's third call sees its own opener as assistant and the contractor's counter as user, with the "one turn remains" nudge
  const t3 = fake.calls[2]; assert.deepEqual(t3.messages.map((m) => m.role), ["user", "assistant", "user"]); assert.ok(String(t3.messages[2].content).includes("Only one turn remains"));
  // the ack call carries the tool_result for the funding tool_use id
  const ackLast = ack.messages.at(-1)!; assert.equal(ackLast.role, "user"); assert.equal((ackLast.content as { tool_use_id: string }[])[0].tool_use_id, "tu_fund");
  assert.equal(fake.remaining(), 0);
  console.log("✓ negotiation agreed on turn 4 with agent-made PayPal tool call");
}

async function testNegotiationTextFallbackAndLimit() {
  // no tool_use → $-regex counter; max_turns 2 → walk away at the limit
  fakeClient([
    message([text("I can offer $220 for this job today, finishing by 6 PM.")]),
    message([text("Can't do it under $300, sorry.")]),
  ]);
  const turns: TranscriptTurn[] = []; let funded = false;
  const run = await runNegotiation({ order, contractor: mike, deposit_pct: 20, max_turns: 2, now: NOW }, { onTurn: (t) => { turns.push(t); }, createAuthorizeOrder: async () => { funded = true; return { order_id: "x", status: "CREATED" }; } });
  assert.equal(run.outcome, "walked_away"); if (run.outcome !== "walked_away") return;
  assert.equal(run.reason, "no agreement within turn limit"); assert.equal(funded, false);
  assert.deepEqual(turns.map((t) => t.offer_cents), [22000, 30000]);
  assert.equal(extractDollars("costs $1,250.5 total"), 125050); assert.equal(extractDollars("no money here"), undefined);
  // explicit walk_away tool
  fakeClient([message([tool("counter", { text: "Budget $220.", offer_cents: 22000, deadline: null })]), message([tool("walk_away", { text: "Not tonight.", reason: "unavailable after hours" })])]);
  const run2 = await runNegotiation({ order, contractor: mike, deposit_pct: 20, max_turns: 4, now: NOW }, { onTurn: () => {}, createAuthorizeOrder: async () => { throw new Error("must not fund"); } });
  assert.equal(run2.outcome, "walked_away"); if (run2.outcome === "walked_away") assert.equal(run2.reason, "unavailable after hours");
  assert.equal(run2.transcript.length, 2);
  console.log("✓ negotiation text fallback + turn limit + walk_away");
}

async function testNegotiationFundingByCode() {
  // dispatcher never calls the PayPal tool → after one retry, code funds and marks funded_by: "code"; invalid agree deadline falls back to the last proposed deadline
  const deadline = "2026-11-09T17:30:00-05:00";
  fakeClient([
    message([tool("counter", { text: "Budget $220.", offer_cents: 22000, deadline })]),
    message([tool("agree", { text: "Deal.", price_cents: 22000, deadline: "soon", deposit_pct: 20 })]),
    message([text("Great, the order is funded.")]),
    message([text("Done.")]),
  ]);
  const calls: number[] = [];
  const run = await runNegotiation({ order, contractor: mike, deposit_pct: 20, max_turns: 4, now: NOW }, { onTurn: () => {}, createAuthorizeOrder: async (a) => { calls.push(a.amount_cents); return { order_id: "ORD1", approve_url: "https://example/approve", status: "CREATED" }; } });
  assert.equal(run.outcome, "agreed"); if (run.outcome !== "agreed") return;
  assert.equal(run.funded_by, "code"); assert.deepEqual(calls, [22000]); assert.equal(run.paypal_order_id, "ORD1"); assert.equal(run.deadline, deadline);
  assert.equal(run.criteria.find((c) => c.check === "time")?.text, "Completed before 5:30 PM");
  assert.equal(formatClock("2026-11-09T00:05:00Z"), "12:05 AM"); assert.equal(formatClock("2026-11-09T12:00:00-05:00"), "12:00 PM");
  assert.deepEqual(rewriteTimeCriteria(order.criteria, "garbage").map((c) => c.text), order.criteria.map((c) => c.text));
  console.log("✓ negotiation funding fallback to code");
}

function img(kind: "checkin" | "after" | "receipt", exif_ts: string, exif_missing = false) { return { kind, data: Buffer.from("x"), media_type: "image/jpeg" as const, exif_ts, exif_missing }; }
const passVerdict = (): Verdict => ({ verdict: "pass", confidence: 0.93, model: "m", amount_to_release_cents: 99999,
  criteria: [{ id: "c1", met: true, evidence: "Dry trap visible" }, { id: "c2", met: true, evidence: "Receipt total $41.07" }, { id: "c3", met: true, evidence: "EXIF 15:52" }] });

async function testHardRules() {
  const base = { order, remaining_cents: 19200 };
  // missing check-in → fail, amount 0, flags kept except the time criterion carries the note when nothing was unmet
  const noCheckin = enforceHardRules(passVerdict(), { ...base, images: [img("after", "2026-11-09T15:52:00-05:00")], checkin_ts: undefined });
  assert.equal(noCheckin.verdict, "fail"); assert.equal(noCheckin.amount_to_release_cents, 0);
  assert.equal(noCheckin.criteria.find((c) => c.id === "c3")?.met, false); assert.match(noCheckin.criteria.find((c) => c.id === "c3")!.evidence, /No check-in timestamp/);
  assert.equal(noCheckin.criteria.find((c) => c.id === "c1")?.met, true);
  const v2 = passVerdict(); v2.criteria[1].met = false;
  const noCheckin2 = enforceHardRules(v2, { ...base, images: [], checkin_ts: undefined });
  assert.equal(noCheckin2.criteria[1].evidence, "Receipt total $41.07 · No check-in timestamp"); assert.equal(noCheckin2.criteria[2].met, true);
  // EXIF before check-in → fail with the evidence on the time criterion
  const stale = enforceHardRules(passVerdict(), { ...base, images: [img("checkin", "2026-11-09T14:22:00-05:00"), img("after", "2026-11-09T13:49:00-05:00")], checkin_ts: "2026-11-09T14:22:00-05:00" });
  assert.equal(stale.verdict, "fail"); assert.equal(stale.amount_to_release_cents, 0);
  assert.match(stale.criteria[2].evidence, /EXIF 2026-11-09T13:49:00-05:00 \(after photo\) predates check-in 2026-11-09T14:22:00-05:00/);
  // exif_missing images are not treated as stale
  const okMissing = enforceHardRules(passVerdict(), { ...base, images: [img("after", "2026-11-09T13:00:00-05:00", true)], checkin_ts: "2026-11-09T14:22:00-05:00" });
  assert.equal(okMissing.verdict, "pass"); assert.equal(okMissing.amount_to_release_cents, 19200);
  // partial clamp
  const partial: Verdict = { ...passVerdict(), verdict: "partial", amount_to_release_cents: 50000 };
  assert.equal(enforceHardRules(partial, { ...base, images: [], checkin_ts: "2026-11-09T14:22:00-05:00" }).amount_to_release_cents, 19200);
  const partialZero: Verdict = { ...passVerdict(), verdict: "partial", amount_to_release_cents: 0 };
  assert.equal(enforceHardRules(partialZero, { ...base, images: [], checkin_ts: "2026-11-09T14:22:00-05:00" }).verdict, "fail");
  // pass sets remaining; confidence clamped; pass with an unmet criterion becomes partial
  const pass = enforceHardRules({ ...passVerdict(), confidence: 1.7 }, { ...base, images: [img("after", "2026-11-09T15:52:00-05:00")], checkin_ts: "2026-11-09T15:11:00-05:00" });
  assert.equal(pass.verdict, "pass"); assert.equal(pass.amount_to_release_cents, 19200); assert.equal(pass.confidence, 1);
  const v3 = passVerdict(); v3.criteria[1].met = false; v3.amount_to_release_cents = 10000;
  const downgraded = enforceHardRules(v3, { ...base, images: [], checkin_ts: "2026-11-09T15:11:00-05:00" });
  assert.equal(downgraded.verdict, "partial"); assert.equal(downgraded.amount_to_release_cents, 10000);
  // the input verdict is never mutated
  const original = passVerdict(); enforceHardRules(original, { ...base, images: [], checkin_ts: undefined }); assert.equal(original.verdict, "pass");
  // normalizeVerdict fills missing/unknown ids
  const n = normalizeVerdict({ verdict: "partial", confidence: 0.5, amount_to_release_cents: 100, criteria: [{ id: "c2", met: true, evidence: "x" }, { id: "zz", met: true, evidence: "y" }] }, order.criteria, "claude-sonnet-5-5");
  assert.deepEqual(n.criteria.map((c) => c.id), ["c1", "c2", "c3"]); assert.equal(n.criteria[0].evidence, "No evidence provided"); assert.equal(n.model, "claude-sonnet-5-5");
  console.log("✓ hard rules");
}

async function testVerifierCall() {
  const fake = fakeClient([{ ...json({ verdict: "pass", confidence: 0.93, amount_to_release_cents: 19200, criteria: [{ id: "c1", met: true, evidence: "Dry P-trap and connections visible" }, { id: "c2", met: true, evidence: "Receipt total $41.07" }, { id: "c3", met: true, evidence: "EXIF 15:52 before 16:00" }] }), model: "claude-sonnet-5-5-test" } as unknown as BetaMessage]);
  const funded: WorkOrder = { ...order, status: "in_progress", contract: { contractor_id: "mike", price_cents: 24000, deposit_pct: 20, deadline: "2026-11-09T16:00:00-05:00", criteria: order.criteria } };
  const { verdict, raw } = await verifyProofs({ order: funded, images: [img("checkin", "2026-11-09T15:11:00-05:00"), img("after", "2026-11-09T15:52:00-05:00"), img("receipt", "2026-11-09T15:38:00-05:00", true)], checkin_ts: "2026-11-09T15:11:00-05:00", remaining_cents: 19200, now: "2026-11-09T15:53:00-05:00" });
  assert.equal(verdict.verdict, "pass"); assert.equal(verdict.amount_to_release_cents, 19200); assert.equal(verdict.model, "claude-sonnet-5-5-test"); assert.ok(raw && typeof raw === "object");
  const p = fake.calls[0]; assert.equal(p.output_config?.effort, "medium"); assert.equal(p.max_tokens, 4096);
  const schema = p.output_config?.format?.schema as { properties: { criteria: { items: { properties: { id: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.criteria.items.properties.id.enum, ["c1", "c2", "c3"]);
  const content = p.messages[0].content as { type: string; text?: string; source?: { media_type: string } }[];
  assert.deepEqual(content.map((b) => b.type), ["text", "image", "text", "image", "text", "image", "text"]);
  assert.match(content[0].text!, /check-in photo, EXIF 2026-11-09T15:11:00-05:00/); assert.match(content[4].text!, /receipt, EXIF missing \(upload time used\)/);
  assert.equal(content[1].source?.media_type, "image/jpeg"); assert.match(content[6].text!, /Check-in timestamp: 2026-11-09T15:11:00-05:00/); assert.match(content[6].text!, /- c2: Parts receipt totals \$60 or less \[check: receipt\]/);
  console.log("✓ verifier request + response");
}

(async () => {
  await testDispatcher(); await testNegotiationAgreed(); await testNegotiationTextFallbackAndLimit(); await testNegotiationFundingByCode(); await testHardRules(); await testVerifierCall();
  __setClientForTests(null);
  console.log("agents-unit: all tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
