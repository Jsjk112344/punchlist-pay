// Dispatcher ↔ Contractor agent negotiation. Owner: lib/agents.
import type Anthropic from "@anthropic-ai/sdk";
import type { ContractorProfile, Criterion, NegotiationResult, TranscriptTurn, WorkOrder } from "@/lib/types";
import { callModel, fillPrompt, readPrompt, textOf, toolUsesOf } from "./client";
import { contractorTools, dispatcherTools, fundingTools, parseAgree, parseCounter, parseCreateAuthorizeOrder, parseWalkAway } from "./tools";
import { defaultDeadline } from "./dispatcher";

export interface NegotiationHooks {
  /** Called for every turn as soon as it exists so the route can stream it. */
  onTurn: (turn: TranscriptTurn) => void | Promise<void>;
  /** Executes the Dispatcher's `create_authorize_order` tool call server-side. */
  createAuthorizeOrder: (args: { amount_cents: number; description: string }) => Promise<{ order_id: string; approve_url?: string; status: string }>;
}
export interface NegotiationContext { order: WorkOrder; contractor: ContractorProfile; deposit_pct: number; max_turns: number; now: string }
/** `funded_by` says whether the Dispatcher agent made the PayPal tool call itself or code had to do it for it. */
export type NegotiationRun = NegotiationResult & { paypal_order_id?: string; approve_url?: string; funded_by?: "agent" | "code" };

type Role = "dispatcher" | "contractor";
type Action =
  | { kind: "counter"; text: string; offer_cents?: number; deadline?: string }
  | { kind: "agree"; text: string; price_cents: number; deadline: string; deposit_pct: number }
  | { kind: "walk_away"; text: string; reason: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Alternates Dispatcher and Contractor (max_turns total, ≤2 sentences each). Ends with agree or walk_away.
 * On agreement the Dispatcher must call create_authorize_order itself; the hook result is returned as paypal_order_id/approve_url.
 */
export async function runNegotiation(ctx: NegotiationContext, hooks: NegotiationHooks): Promise<NegotiationRun> {
  const transcript: TranscriptTurn[] = [];
  const systems: Record<Role, string> = { dispatcher: dispatcherSystem(ctx), contractor: contractorSystem(ctx) };
  const tools: Record<Role, Anthropic.Beta.Messages.BetaTool[]> = { dispatcher: dispatcherTools, contractor: contractorTools };
  const maxTurns = Math.max(1, ctx.max_turns);
  let agreed: Extract<Action, { kind: "agree" }> | null = null;
  let walked: Extract<Action, { kind: "walk_away" }> | null = null;
  let lastDeadline = defaultDeadline(ctx.now);

  for (let n = 1; n <= maxTurns && !agreed && !walked; n++) {
    const role: Role = n % 2 === 1 ? "dispatcher" : "contractor";
    const msg = await callModel({
      max_tokens: 2048,
      system: systems[role],
      tools: tools[role],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      output_config: { effort: "low" },
      messages: buildMessages(role, transcript, ctx, n, maxTurns),
    });
    const action = interpretTurn(msg, n === maxTurns);
    if (action.kind === "counter" && action.deadline) lastDeadline = action.deadline;
    if (action.kind === "agree" && !Number.isFinite(Date.parse(action.deadline))) action.deadline = lastDeadline;
    const turn: TranscriptTurn = {
      id: `t${n}`, role, text: action.text, timestamp: new Date().toISOString(),
      offer_cents: action.kind === "agree" ? action.price_cents : action.kind === "counter" ? action.offer_cents : undefined,
    };
    transcript.push(turn);
    await hooks.onTurn(turn);
    if (action.kind === "agree") agreed = action;
    else if (action.kind === "walk_away") walked = action;
  }

  if (!agreed) return { outcome: "walked_away", reason: walked?.reason || "no agreement within turn limit", transcript };

  const criteria = rewriteTimeCriteria(ctx.order.criteria, agreed.deadline);
  const funding = await fundViaDispatcher(ctx, systems.dispatcher, transcript, agreed, hooks);
  return {
    outcome: "agreed", price_cents: agreed.price_cents, deadline: agreed.deadline, deposit_pct: agreed.deposit_pct, criteria, transcript,
    paypal_order_id: funding.order_id, approve_url: funding.approve_url, funded_by: funding.funded_by,
  };
}

// ---- prompt assembly -----------------------------------------------------------------------------------------

function dispatcherSystem(ctx: NegotiationContext): string {
  const o = ctx.order;
  return fillPrompt(readPrompt("negotiator-dispatcher.md"), {
    title: o.title, description: o.description, unit: o.unit, property: o.property_name, budget: money(o.budget_cents), budget_cents: o.budget_cents,
    ceiling: money(Math.round(o.budget_cents * 1.15)), ceiling_cents: Math.round(o.budget_cents * 1.15), deadline: defaultDeadline(ctx.now), deposit_pct: ctx.deposit_pct,
    criteria: o.criteria.map((c) => `- ${c.text} (${c.check})`).join("\n") || "- (none listed)", contractor_name: ctx.contractor.name, trade: ctx.contractor.trade,
    now: ctx.now, max_turns: ctx.max_turns,
  });
}
function contractorSystem(ctx: NegotiationContext): string {
  const p = ctx.contractor.profile;
  return fillPrompt(readPrompt("negotiator-contractor.md"), {
    name: ctx.contractor.name, trade: ctx.contractor.trade, hourly_rate: money(ctx.contractor.hourly_rate_cents),
    callout_fee: money(p.callout_fee_cents ?? 0), after_hours_surcharge_pct: p.after_hours_surcharge_pct ?? 0, min_job: money(p.min_job_cents ?? 0),
    availability: p.availability ?? "available today", style: p.style ?? "friendly and direct", typical_deposit_pct: p.typical_deposit_pct ?? ctx.deposit_pct,
    notes: p.notes ?? "", title: ctx.order.title, description: ctx.order.description, unit: ctx.order.unit, property: ctx.order.property_name,
    criteria: ctx.order.criteria.map((c) => `- ${c.text} (${c.check})`).join("\n") || "- (none listed)", now: ctx.now, max_turns: ctx.max_turns,
  });
}

/** The transcript from one side's point of view: its own turns as assistant text, the other side's as user text. */
function buildMessages(role: Role, transcript: TranscriptTurn[], ctx: NegotiationContext, n: number, maxTurns: number): Anthropic.Beta.Messages.BetaMessageParam[] {
  const other = role === "dispatcher" ? "Contractor agent" : "Dispatcher";
  const brief = role === "dispatcher"
    ? `Negotiate the job "${ctx.order.title}" (Unit ${ctx.order.unit}) with ${ctx.contractor.name}'s agent. Open with your offer at the budget of ${money(ctx.order.budget_cents)} using the counter tool.`
    : `The property manager's Dispatcher is offering you the job "${ctx.order.title}" (Unit ${ctx.order.unit}). Respond to each message with exactly one tool call.`;
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  let pending: string[] = [brief];
  const flush = () => { if (pending.length) { messages.push({ role: "user", content: pending.join("\n\n") }); pending = []; } };
  for (const t of transcript) {
    const offer = t.offer_cents !== undefined ? ` [${money(t.offer_cents)}]` : "";
    if (t.role === role) { flush(); messages.push({ role: "assistant", content: `${t.text}${offer}` }); }
    else pending.push(`${other}: "${t.text}"${offer}`);
  }
  const remaining = maxTurns - n;
  pending.push(
    n === maxTurns
      ? "This is the final turn of the negotiation. Call agree or walk_away now; counter is not allowed."
      : remaining === 1
        ? "Reply with exactly one tool call (counter, agree or walk_away). Only one turn remains after yours, so move toward a close."
        : "Reply with exactly one tool call (counter, agree or walk_away).",
  );
  flush();
  return messages;
}

/** First tool_use wins. No tool_use → text counter with the first $amount as the offer (fallback only). */
function interpretTurn(msg: Anthropic.Beta.Messages.BetaMessage, isFinal: boolean): Action {
  const spoken = textOf(msg);
  for (const use of toolUsesOf(msg)) {
    if (use.name === "agree") { const a = parseAgree(use.input); if (a) return { kind: "agree", text: a.text || spoken, price_cents: a.price_cents, deadline: a.deadline, deposit_pct: a.deposit_pct }; }
    if (use.name === "walk_away") { const w = parseWalkAway(use.input); if (w) return { kind: "walk_away", text: w.text || spoken, reason: w.reason || "walked away" }; }
    if (use.name === "counter") { const c = parseCounter(use.input); if (c) return { kind: "counter", text: c.text || spoken, offer_cents: c.offer_cents, deadline: c.deadline ?? undefined }; }
  }
  void isFinal; // a counter on the final turn simply exhausts the limit; the caller reports "no agreement within turn limit"
  return { kind: "counter", text: spoken || "(no response)", offer_cents: extractDollars(spoken) };
}

export function extractDollars(text: string): number | undefined {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(text);
  if (!m) return undefined;
  const dollars = Number(m[1].replace(/,/g, ""));
  const cents = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return dollars * 100 + cents;
}

/** "Completed before 4:00 PM" using the wall-clock time written in the ISO string's own offset. */
export function rewriteTimeCriteria(criteria: Criterion[], deadline: string): Criterion[] {
  const label = formatClock(deadline);
  return criteria.map((c) => (c.check === "time" && label ? { ...c, text: `Completed before ${label}` } : { ...c }));
}
export function formatClock(iso: string): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null; }
  const h = Number(m[1]), min = m[2];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${min} ${suffix}`;
}

// ---- funding: the Dispatcher's own PayPal tool call -----------------------------------------------------------

async function fundViaDispatcher(
  ctx: NegotiationContext, system: string, transcript: TranscriptTurn[], agreed: Extract<Action, { kind: "agree" }>, hooks: NegotiationHooks,
): Promise<{ order_id: string; approve_url?: string; funded_by: "agent" | "code" }> {
  const history = buildMessages("dispatcher", transcript, ctx, ctx.max_turns + 1, ctx.max_turns + 2).slice(0, -1); // drop the per-turn instruction
  const description = `${ctx.order.title} · Unit ${ctx.order.unit} · ${ctx.contractor.name}`;
  const ask = `Agreement reached at ${money(agreed.price_cents)} (deadline ${agreed.deadline}, deposit ${agreed.deposit_pct}%). Fund the order now by calling create_authorize_order with amount_cents ${agreed.price_cents} and a one-line description such as "${description}". Do not call any other tool.`;
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [...history, { role: "user", content: ask }];
  const prompts = [ask, `You must call the create_authorize_order tool now with amount_cents ${agreed.price_cents}. Reply with that tool call only.`];
  for (let attempt = 0; attempt < prompts.length; attempt++) {
    if (attempt > 0) messages.push({ role: "user", content: prompts[attempt] });
    const msg = await callModel({ max_tokens: 1024, system, tools: fundingTools, tool_choice: { type: "auto", disable_parallel_tool_use: true }, output_config: { effort: "low" }, messages });
    const use = toolUsesOf(msg).find((u) => u.name === "create_authorize_order");
    const input = use ? parseCreateAuthorizeOrder(use.input) : null;
    if (!use || !input) { messages.push({ role: "assistant", content: textOf(msg) || "(no tool call)" }); continue; }
    const amount = input.amount_cents === agreed.price_cents ? input.amount_cents : agreed.price_cents; // the agreed price is the contract; never hold a different amount
    const result = await hooks.createAuthorizeOrder({ amount_cents: amount, description: input.description || description });
    // Feed the result back so the Dispatcher's transcript is well-formed; its acknowledgement is not needed, so failures here are ignored.
    try {
      await callModel({
        max_tokens: 256, system, tools: fundingTools, tool_choice: { type: "none" }, output_config: { effort: "low" },
        messages: [...messages, { role: "assistant", content: msg.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ order_id: result.order_id, status: result.status, approve_url: result.approve_url ?? null }) }] }],
      });
    } catch { /* acknowledgement only */ }
    return { order_id: result.order_id, approve_url: result.approve_url, funded_by: "agent" };
  }
  const result = await hooks.createAuthorizeOrder({ amount_cents: agreed.price_cents, description });
  return { order_id: result.order_id, approve_url: result.approve_url, funded_by: "code" };
}
