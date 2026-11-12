// Business flows shared by the API routes and the smoke tests. Routes stay thin; every state change lives here.
// Money moves only through lib/money.ts; agents only through lib/agents (with lib/fallbacks when Claude is unavailable).
import { createHash } from "node:crypto";
import { AUTO_PAY_MIN_CONFIDENCE, DEFAULT_DEPOSIT_PCT, MAX_NEGOTIATION_TURNS, claudeConfigured, localNowIso } from "@/lib/config";
import * as repo from "@/lib/db/repo";
import { ensureDb } from "@/lib/db/client";
import { moneyRail, depositCents, type CreateOrderResult } from "@/lib/money";
import { draftWorkOrder, type DispatcherDraft } from "@/lib/agents/dispatcher";
import { runNegotiation, type NegotiationHooks, type NegotiationRun } from "@/lib/agents/negotiation";
import { verifyProofs, type VerifierImage, type VerifierInput } from "@/lib/agents/verifier";
import { fallbackDraft, fallbackNegotiation, fallbackVerdict } from "@/lib/fallbacks";
import { saveUpload, loadImageForVision } from "@/lib/uploads";
import { money } from "@/lib/format";
import type { Contract, Payout, PayoutKind, PayoutStatus, Proof, ProofKind, TranscriptTurn, Verdict, WorkOrder } from "@/lib/types";

export class FlowError extends Error { constructor(message: string, public status = 400) { super(message); this.name = "FlowError"; } }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const paidCents = (o: WorkOrder) => o.payouts.filter(p => p.status === "paid").reduce((n, p) => n + p.amount_cents, 0);
const committedCents = (o: WorkOrder) => o.payouts.filter(p => p.status !== "failed").reduce((n, p) => n + p.amount_cents, 0);
const priceCents = (o: WorkOrder) => o.contract?.price_cents ?? o.budget_cents;
const systemTurn = (text: string, offer_cents?: number): TranscriptTurn => ({ id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", text, offer_cents, timestamp: new Date().toISOString() });

export async function mustGet(id: string): Promise<WorkOrder> {
  await ensureDb();
  const o = await repo.getWorkOrder(id);
  if (!o) throw new FlowError("Work order not found", 404);
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Request → structured work order (Dispatcher)
export async function createWorkOrderFromText(text: string): Promise<WorkOrder> {
  await ensureDb();
  const units = await repo.listUnits();
  const ctx = { units: units.map(u => ({ unit: u.unit, property_name: u.property_name, property_id: u.property_id })), now: localNowIso() };
  let draft: DispatcherDraft; let agent = "fixture/heuristic-dispatcher";
  if (claudeConfigured()) {
    try { draft = await draftWorkOrder(text, ctx); agent = "claude"; }
    catch (e) { console.error("[dispatcher] falling back:", errMsg(e)); draft = fallbackDraft(text, ctx); agent = `fixture/after-error`; }
  } else draft = fallbackDraft(text, ctx);
  const wo = await repo.createWorkOrder({ title: draft.title, description: draft.description || text, unit: draft.unit, property_id: draft.property_id ?? "p-1", budget_cents: draft.budget_cents, criteria: draft.criteria, deadline: draft.deadline, created_by: "pm-1" });
  await repo.addEvent(wo.id, "work_order.created", { agent, budget_cents: wo.budget_cents, criteria: wo.criteria.length });
  return wo;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Negotiation (Dispatcher ↔ Contractor agents) ending in a contract + PayPal order
export interface NegotiateResult { contract: Contract | null; approve_url?: string; paypal_order_id?: string; outcome: "agreed" | "walked_away"; reason?: string; work_order: WorkOrder; agent: string }

export async function negotiateWorkOrder(id: string, contractor_id: string, onTurn?: (turn: TranscriptTurn) => void | Promise<void>): Promise<NegotiateResult> {
  const order = await mustGet(id);
  if (order.contract?.paypal_auth_id || !["draft", "negotiating"].includes(order.status)) throw new FlowError(`Work order is already ${order.status}`, 409);
  const contractor = await repo.getContractor(contractor_id);
  if (!contractor) throw new FlowError("Unknown contractor", 404);
  await repo.updateWorkOrder(id, { status: "negotiating", contractor_id });
  await repo.saveNegotiation(id, [], "pending");

  const transcript: TranscriptTurn[] = [];
  const emit = async (turn: TranscriptTurn) => {
    const t = { ...turn, id: `t${transcript.length + 1}`, timestamp: turn.timestamp ?? new Date().toISOString() };
    transcript.push(t); await repo.appendNegotiationTurn(id, t); await onTurn?.(t);
  };
  const rail = moneyRail();
  let created: CreateOrderResult | undefined;
  // A PayPal failure is not an agent failure: keep the real transcript, never replay a scripted one over it.
  let paypalError: unknown;
  const createOrder = async (args: Parameters<typeof rail.createOrder>[0]) => {
    try { return await rail.createOrder(args); } catch (e) { paypalError = e; throw e; }
  };
  const failOnPaypal = async (e: unknown): Promise<never> => {
    console.error("[negotiation] PayPal order failed:", errMsg(e));
    await emit(systemTurn("Couldn't create the PayPal order · nothing was charged · retry"));
    await repo.saveNegotiation(id, transcript, "pending");
    await repo.updateWorkOrder(id, { status: "draft" });
    await repo.addEvent(id, "paypal.order.failed", { error: errMsg(e) });
    throw new FlowError(`Couldn't create the PayPal order: ${errMsg(e)}`, 502);
  };
  const hooks: NegotiationHooks = {
    onTurn: emit,
    createAuthorizeOrder: async ({ amount_cents, description }) => {
      if (created) return { order_id: created.order_id, approve_url: created.approve_url, status: created.status }; // idempotent within one negotiation
      created = await createOrder({ work_order_id: id, amount_cents, description });
      await repo.addEvent(id, "paypal.order.created", { order_id: created.order_id, amount_cents, mode: rail.mode, by: "dispatcher-agent" });
      return { order_id: created.order_id, approve_url: created.approve_url, status: created.status };
    },
  };
  const ctx = { order: { ...order, status: "negotiating" as const, contractor_id }, contractor, deposit_pct: contractor.profile.typical_deposit_pct ?? DEFAULT_DEPOSIT_PCT, max_turns: MAX_NEGOTIATION_TURNS, now: localNowIso() };

  let run: NegotiationRun; let agent = "fixture/scripted-negotiation";
  if (claudeConfigured()) {
    try { run = await runNegotiation(ctx, hooks); agent = "claude"; }
    catch (e) {
      if (paypalError) await failOnPaypal(paypalError);
      console.error("[negotiation] falling back:", errMsg(e));
      await emit(systemTurn("Agent unavailable · replaying scripted negotiation"));
      run = await fallbackNegotiation(ctx, hooks).catch(err => paypalError ? failOnPaypal(paypalError) : Promise.reject(err)); agent = "fixture/after-error";
    }
  } else run = await fallbackNegotiation(ctx, hooks).catch(e => paypalError ? failOnPaypal(paypalError) : Promise.reject(e));

  if (run.outcome === "walked_away") {
    await emit(systemTurn(`No agreement · ${run.reason}`));
    await repo.saveNegotiation(id, transcript, "walked_away");
    await repo.updateWorkOrder(id, { status: "draft", contractor_id: null });
    await repo.addEvent(id, "negotiation.walked_away", { reason: run.reason, agent });
    return { contract: null, outcome: "walked_away", reason: run.reason, work_order: await mustGet(id), agent };
  }
  if (!created) { // the agent agreed but never called the tool; the Dispatcher is still accountable for funding
    created = await createOrder({ work_order_id: id, amount_cents: run.price_cents, description: `${order.title} · Unit ${order.unit} · ${order.property_name}` }).catch(failOnPaypal);
    await repo.addEvent(id, "paypal.order.created", { order_id: created.order_id, amount_cents: run.price_cents, mode: rail.mode, by: "code" });
  }
  const authorized = created.authorized && Boolean(created.authorization_id);
  const contract: repo.ContractRecord = { contractor_id, price_cents: run.price_cents, deposit_pct: run.deposit_pct, deadline: run.deadline, criteria: run.criteria, paypal_order_id: created.order_id, paypal_auth_id: authorized ? created.authorization_id : undefined, approve_url: created.approve_url };
  await repo.upsertContract(id, contract);
  await emit(systemTurn(authorized ? `Order authorized · ${money(run.price_cents)}` : `Order created · ${money(run.price_cents)} · awaiting PM approval`, run.price_cents));
  await repo.saveNegotiation(id, transcript, "agreed");
  await repo.updateWorkOrder(id, { status: authorized ? "funded" : "negotiating", criteria: run.criteria, contractor_id });
  await repo.addEvent(id, authorized ? "paypal.order.authorized" : "negotiation.agreed", { price_cents: run.price_cents, deposit_pct: run.deposit_pct, deadline: run.deadline, order_id: created.order_id, mode: rail.mode, agent });
  const work_order = await mustGet(id);
  return { contract: work_order.contract ?? contract, approve_url: created.approve_url, paypal_order_id: created.order_id, outcome: "agreed", work_order, agent };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Funding: the PM approves the PayPal order in the browser, then we authorize it server-side
export async function confirmFunding(id: string, paypal_order_id?: string): Promise<WorkOrder> {
  const order = await mustGet(id);
  const c = order.contract;
  if (!c?.paypal_order_id) throw new FlowError("This work order has no PayPal order yet", 409);
  if (paypal_order_id && paypal_order_id !== c.paypal_order_id) throw new FlowError("PayPal order id does not match this work order", 400);
  if (c.paypal_auth_id) return order; // already funded: idempotent
  const rail = moneyRail();
  const auth = await rail.authorize({ work_order_id: id, order_id: c.paypal_order_id });
  return markAuthorized(id, auth.authorization_id);
}

/** Records an authorization (from confirmFunding, the poll, or a webhook) and flips the order to funded. */
export async function markAuthorized(id: string, authorization_id: string): Promise<WorkOrder> {
  const order = await mustGet(id);
  if (order.contract?.paypal_auth_id === authorization_id) return order;
  await repo.updateContract(id, { paypal_auth_id: authorization_id });
  if (["draft", "negotiating"].includes(order.status)) await repo.updateWorkOrder(id, { status: "funded" });
  await repo.appendNegotiationTurn(id, systemTurn(`Order authorized · ${money(priceCents(order))}`, priceCents(order)));
  await repo.addEvent(id, "paypal.order.authorized", { authorization_id, mode: moneyRail().mode });
  return mustGet(id);
}

export async function markCaptured(id: string, capture_id: string): Promise<void> {
  const order = await mustGet(id);
  if (order.contract?.paypal_capture_id === capture_id) return;
  await repo.updateContract(id, { paypal_capture_id: capture_id });
  await repo.addEvent(id, "paypal.capture.completed", { capture_id });
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Proofs (check-in triggers the deposit)
export async function recordProof(id: string, kind: ProofKind, file: File): Promise<Proof> {
  const order = await mustGet(id);
  if (!order.contract) throw new FlowError("Work order has no contract yet", 409);
  if (!order.contract.paypal_auth_id) throw new FlowError("Work order is not funded yet", 409);
  if (["draft", "negotiating", "paid", "disputed"].includes(order.status)) throw new FlowError(`Cannot add proof while the work order is ${order.status}`, 409);
  const saved = await saveUpload(file, id, kind);
  const proof = await repo.addProof({ work_order_id: id, kind, url: saved.url, exif_ts: saved.exif_ts, uploaded_at: saved.uploaded_at, exif_missing: saved.exif_missing });
  await repo.addEvent(id, "proof.uploaded", { kind, exif_ts: saved.exif_ts, exif_missing: saved.exif_missing, media_type: saved.media_type });
  if (kind === "checkin") {
    if (order.status === "funded") await repo.updateWorkOrder(id, { status: "in_progress" });
    const deposit = depositCents(order.contract.price_cents, order.contract.deposit_pct);
    if (deposit > 0 && !order.payouts.some(p => p.kind === "deposit" && p.status !== "failed")) {
      try { await releasePayout(id, deposit, "deposit"); }
      catch (e) { console.error("[deposit] payout failed:", errMsg(e)); await repo.addEvent(id, "payout.error", { kind: "deposit", error: errMsg(e) }); }
    }
  }
  return proof;
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Payouts (deposit on check-in, balance/partial after verification or explicit PM approval)
export async function releasePayout(id: string, amount_cents: number, kind: PayoutKind, opts: { override?: boolean } = {}): Promise<Payout> {
  const order = await mustGet(id);
  const c = order.contract;
  if (!c) throw new FlowError("Work order has no contract", 409);
  if (!c.paypal_auth_id) throw new FlowError("Work order is not funded", 409);
  const contractor = await repo.getContractor(c.contractor_id);
  if (!contractor) throw new FlowError("Contractor not found", 409);
  const existing = order.payouts.find(p => p.kind === kind);
  if (existing && existing.status !== "failed") return existing; // idempotent per (work order, kind)
  if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) throw new FlowError("Payout amount must be a positive integer of cents", 400);
  const remaining = c.price_cents - committedCents(order) + (existing?.amount_cents ?? 0);
  if (amount_cents > remaining) throw new FlowError(`Payout ${money(amount_cents)} exceeds the remaining balance ${money(remaining)}`, 409);
  if (kind === "deposit") {
    if (!order.proofs.some(p => p.kind === "checkin")) throw new FlowError("Deposit requires a check-in photo", 409);
    const expected = depositCents(c.price_cents, c.deposit_pct);
    if (amount_cents !== expected) throw new FlowError(`Deposit must equal ${money(expected)}`, 409);
  } else {
    const v = order.verdict;
    const allowed = opts.override || (v && v.verdict !== "fail" && v.confidence >= AUTO_PAY_MIN_CONFIDENCE);
    if (!allowed) throw new FlowError("Payout blocked: verdict is fail, confidence is below 0.8, or no verdict yet", 409);
    if (!c.paypal_capture_id) { // capture the PM's authorization once before releasing funds
      const cap = await moneyRail().capture({ work_order_id: id, authorization_id: c.paypal_auth_id });
      await markCaptured(id, cap.capture_id);
    }
  }
  const result = await moneyRail().payout({ work_order_id: id, kind, receiver_email: contractor.paypal_email, amount_cents, note: `${order.title} · Unit ${order.unit} · ${kind}`, scope: c.paypal_order_id });
  const payout: Payout = { id: existing?.id ?? `pay-${id}-${kind}`, work_order_id: id, contractor_id: c.contractor_id, amount_cents, kind, paypal_batch_id: result.batch_id, paypal_item_id: result.item_id, status: result.status, paid_at: result.paid_at };
  await repo.upsertPayout(payout);
  await repo.addEvent(id, `payout.${result.status}`, { kind, amount_cents, batch_id: result.batch_id, mode: moneyRail().mode, override: Boolean(opts.override) });
  await settleStatus(id);
  return payout;
}

/** Recomputes the work-order status from settled payouts. Only here does a job become `paid`. */
export async function settleStatus(id: string): Promise<WorkOrder> {
  const o = await mustGet(id);
  if (!o.contract) return o;
  let next = o.status;
  if (paidCents(o) >= o.contract.price_cents) next = "paid";
  else if (o.payouts.some(p => p.kind !== "deposit" && p.status === "pending") && !["under_review", "escalated", "disputed"].includes(o.status)) next = "in_progress";
  if (next !== o.status) { await repo.updateWorkOrder(id, { status: next }); await repo.addEvent(id, "status.changed", { from: o.status, to: next }); return mustGet(id); }
  return o;
}

/** Applies a confirmed payout status (poll or webhook). Never marks paid without a confirmed API/webhook result. */
export async function applyPayoutUpdate(payout: Payout, status: PayoutStatus, paid_at?: string, item_id?: string): Promise<void> {
  if (payout.status === status) return;
  await repo.updatePayout(payout.id, { status, paid_at: status === "paid" ? paid_at ?? new Date().toISOString() : undefined, ...(item_id ? { paypal_item_id: item_id } : {}) });
  await repo.addEvent(payout.work_order_id, `payout.${status}`, { kind: payout.kind, amount_cents: payout.amount_cents, batch_id: payout.paypal_batch_id, confirmed: true });
  if (status === "failed") await repo.updateWorkOrder(payout.work_order_id, { status: "escalated" });
  else await settleStatus(payout.work_order_id);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Verification (Claude vision) → capture + payout, or escalation
export async function verifyWorkOrder(id: string): Promise<Verdict> {
  const order = await mustGet(id);
  if (!order.contract) throw new FlowError("Work order has no contract", 409);
  const criteria = order.contract.criteria.length ? order.contract.criteria : order.criteria;
  const after = order.proofs.find(p => p.kind === "after");
  const receipt = order.proofs.find(p => p.kind === "receipt");
  const checkin = order.proofs.find(p => p.kind === "checkin");
  if (!after) throw new FlowError("Missing after photo", 409);
  if (criteria.some(c => c.check === "receipt") && !receipt) throw new FlowError("Missing receipt", 409);
  if (order.status === "paid" && order.verdict) return order.verdict;
  const remaining = order.contract.price_cents - committedCents(order);
  const proof_hash = createHash("sha256").update(JSON.stringify({ proofs: order.proofs.map(p => [p.kind, p.url, p.exif_ts]), criteria, checkin: checkin?.exif_ts })).digest("hex");

  let verdict = await repo.findVerdictByHash(id, proof_hash);
  if (!verdict) {
    const images: VerifierImage[] = [];
    for (const p of [checkin, after, receipt]) {
      if (!p) continue;
      const img = await loadImageForVision(p.url);
      if (img) images.push({ kind: p.kind, data: img.data, media_type: img.media_type, exif_ts: p.exif_ts, exif_missing: Boolean(p.exif_missing) });
    }
    const input: VerifierInput = { order: { ...order, criteria }, images, checkin_ts: checkin?.exif_ts, remaining_cents: remaining, now: localNowIso() };
    let raw: unknown;
    if (claudeConfigured() && images.some(i => i.kind === "after")) {
      try { const r = await verifyProofs(input); verdict = r.verdict; raw = r.raw; }
      catch (e) { console.error("[verifier] falling back:", errMsg(e)); verdict = fallbackVerdict(input); raw = { fallback: true, error: errMsg(e) }; }
    } else { verdict = fallbackVerdict(input); raw = { fallback: true, reason: claudeConfigured() ? "no readable after image" : "ANTHROPIC_API_KEY not set" }; }
    await repo.saveVerdict(id, verdict, { proof_hash, raw });
    await repo.addEvent(id, "verdict.recorded", { verdict: verdict.verdict, confidence: verdict.confidence, amount_to_release_cents: verdict.amount_to_release_cents, model: verdict.model, images: images.length });
  } else await repo.addEvent(id, "verdict.cached", { proof_hash });

  const autoPay = verdict.verdict !== "fail" && verdict.confidence >= AUTO_PAY_MIN_CONFIDENCE && verdict.amount_to_release_cents > 0;
  if (!autoPay) {
    await repo.updateWorkOrder(id, { status: "escalated" });
    await repo.addEvent(id, "verdict.escalated", { verdict: verdict.verdict, confidence: verdict.confidence });
    return verdict;
  }
  const amount = Math.min(verdict.amount_to_release_cents, remaining);
  try {
    await releasePayout(id, amount, verdict.verdict === "pass" ? "balance" : "partial");
    if (verdict.verdict === "partial") await repo.updateWorkOrder(id, { status: "under_review" }); // PM decides the remainder
  } catch (e) {
    console.error("[verify] payout failed:", errMsg(e));
    await repo.addEvent(id, "payout.error", { kind: verdict.verdict === "pass" ? "balance" : "partial", error: errMsg(e) });
    await repo.updateWorkOrder(id, { status: "escalated" });
  }
  return verdict;
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. PM decision on an escalation
export async function decideWorkOrder(id: string, action: "approve" | "redo" | "dispute"): Promise<WorkOrder> {
  const order = await mustGet(id);
  if (action === "redo") {
    await repo.clearVerdict(id);
    await repo.deleteProofs(id, ["after", "receipt"]);
    await repo.updateWorkOrder(id, { status: "redo_requested" });
    await repo.addEvent(id, "decision.redo", { reviewer: "pm-1" });
  } else if (action === "dispute") {
    await repo.updateWorkOrder(id, { status: "disputed" });
    await repo.addEvent(id, "decision.disputed", { reviewer: "pm-1" });
  } else {
    if (!order.contract?.paypal_auth_id) throw new FlowError("Work order is not funded", 409);
    // Explicit human override. The original verdict stays on record; the event carries the reviewer.
    await repo.addEvent(id, "decision.approved", { reviewer: "pm-1", override: true, previous_verdict: order.verdict?.verdict ?? null, previous_confidence: order.verdict?.confidence ?? null });
    const remaining = order.contract.price_cents - committedCents(order);
    if (remaining > 0) await releasePayout(id, remaining, "balance", { override: true });
    else await settleStatus(id);
  }
  return mustGet(id);
}
