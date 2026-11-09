// Fixture agents: deterministic stand-ins used when ANTHROPIC_API_KEY is absent or a live agent call fails.
// They are explicitly labelled (model: "fixture/*") and never pretend to be Claude.
import { seedDraft, seedNegotiation, seedPass } from "@/lib/fixtures";
import type { DispatcherDraft, DispatcherContext } from "@/lib/agents/dispatcher";
import type { NegotiationContext, NegotiationHooks, NegotiationRun } from "@/lib/agents/negotiation";
import { enforceHardRules, type VerifierInput } from "@/lib/agents/verifier";
import type { Criterion, TranscriptTurn, Verdict } from "@/lib/types";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const roundToDollar = (cents: number) => Math.round(cents / 100) * 100;
const floorToTen = (cents: number) => Math.floor(cents / 1000) * 1000;
const roundToTen = (cents: number) => Math.round(cents / 1000) * 1000;
export function clockLabel(iso: string): string { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }); }
function todayAt(now: string, hour: number): string {
  // Demo timezone is America/New_York (PLAN.md timeline). Builds "today at hour:00" in that zone with its real offset.
  const d = new Date(now); const tz = "America/New_York";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "longOffset" }).formatToParts(d).map(p => [p.type, p.value]));
  const offset = (parts.timeZoneName ?? "GMT-05:00").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, "0")}:00:00${offset}`;
}

export function fallbackDraft(text: string, ctx: DispatcherContext): DispatcherDraft {
  const unitMatch = /\b(\d{1,3}[A-Za-z])\b/.exec(text); const unit = (unitMatch?.[1] ?? seedDraft.unit).toUpperCase();
  const known = ctx.units.find(u => u.unit.toUpperCase() === unit);
  const cap = /(?:under|below|max(?:imum)?|less than|<)\s*\$?\s*(\d{2,5})/i.exec(text) ?? /\$\s*(\d{2,5})/.exec(text);
  const budget_cents = cap ? roundToDollar(Number(cap[1]) * 100 * 0.88) : 20000;
  const lower = text.toLowerCase();
  const sink = /sink|leak|drain|faucet|p-trap|plumb/.test(lower), clean = /clean|turnover|move-out/.test(lower);
  const title = sink ? "Kitchen sink leak" : clean ? "Move-out cleaning" : text.replace(/^\s*\d{1,3}[A-Za-z]\b[\s,:-]*/, "").split(/[.,;]/)[0].trim().slice(0, 40).replace(/^./, c => c.toUpperCase()) || "Maintenance request";
  const deadline = todayAt(ctx.now, 18);
  const criteria: Criterion[] = sink ? seedDraft.criteria.map(c => ({ ...c })) : [
    { id: "c1", text: clean ? `After photo shows unit ${unit} clean and clear` : "After photo shows the completed repair", check: "photo" },
    { id: "c2", text: clean ? "Photo captured after check-in" : `Parts receipt totals ${Math.round(budget_cents / 100 / 4)} dollars or less`, check: clean ? "time" : "receipt" },
    { id: "c3", text: `Completed before ${clockLabel(deadline)}`, check: "time" },
  ];
  return { title, unit, property_id: known?.property_id, budget_cents, deadline, criteria, description: text };
}

/** Scripted Dispatcher/Contractor exchange shaped like fixtures/negotiation.json, scaled to the budget. */
export async function fallbackNegotiation(ctx: NegotiationContext, hooks: NegotiationHooks, delayMs = 220): Promise<NegotiationRun> {
  const budget = ctx.order.budget_cents; const surcharge = 1 + (ctx.contractor.profile.after_hours_surcharge_pct ?? 18) / 100;
  const counter = floorToTen(budget * Math.max(surcharge, 1.1)); const agreed = roundToTen(budget + (counter - budget) / 2);
  const nyHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(ctx.now)));
  const deadline = todayAt(ctx.now, nyHour < 14 ? 16 : Math.min(23, nyHour + 2)); const by = clockLabel(deadline);
  const turns: TranscriptTurn[] = [
    { id: "t1", role: "dispatcher", text: `${ctx.order.title}, Unit ${ctx.order.unit}. Budget $${budget / 100}, today.`, offer_cents: budget },
    { id: "t2", role: "contractor", text: `${ctx.contractor.profile.after_hours_surcharge_pct ? "After-hours callout. " : ""}I can do $${counter / 100}.`, offer_cents: counter },
    { id: "t3", role: "dispatcher", text: `$${agreed / 100} if finished by ${by}.`, offer_cents: agreed },
    { id: "t4", role: "contractor", text: seedNegotiation[3]?.text ?? "Agreed. I'll take it.", offer_cents: agreed },
  ];
  for (const t of turns) { await hooks.onTurn({ ...t, timestamp: new Date().toISOString() }); if (delayMs) await sleep(delayMs); }
  const criteria = ctx.order.criteria.map(c => c.check === "time" ? { ...c, text: `Completed before ${by}` } : { ...c });
  const order = await hooks.createAuthorizeOrder({ amount_cents: agreed, description: `${ctx.order.title} · Unit ${ctx.order.unit} · ${ctx.order.property_name}` });
  return { outcome: "agreed", price_cents: agreed, deadline, deposit_pct: ctx.deposit_pct, criteria, transcript: turns, paypal_order_id: order.order_id, approve_url: order.approve_url };
}

/** Heuristic verdict: every criterion met with fixture evidence, then the same hard rules the live verifier enforces. */
export function fallbackVerdict(input: VerifierInput): Verdict {
  const receipt = input.images.find(i => i.kind === "receipt"), after = input.images.find(i => i.kind === "after");
  const criteria = input.order.contract?.criteria?.length ? input.order.contract.criteria : input.order.criteria;
  const deadline = input.order.contract?.deadline;
  const late = (ts: string) => Boolean(deadline) && Date.parse(ts) > Date.parse(deadline!);
  const results = criteria.map((c, i) => {
    const seeded = seedPass.criteria[i];
    const evidence = c.check === "receipt" ? (receipt ? seeded?.evidence ?? "Receipt attached" : "No receipt uploaded")
      : c.check === "time" ? (after ? `Submitted ${clockLabel(after.exif_ts)}${late(after.exif_ts) ? `, after the ${clockLabel(deadline!)} deadline` : ""}` : "No after photo")
      : (after ? seeded?.evidence ?? "After photo shows the completed work" : "No after photo");
    const met = c.check === "receipt" ? Boolean(receipt) : c.check === "time" ? Boolean(after) && !late(after!.exif_ts) : Boolean(after);
    return { id: c.id, met, evidence };
  });
  const allMet = results.every(r => r.met);
  const verdict: Verdict = { verdict: allMet ? "pass" : "fail", confidence: allMet ? seedPass.confidence : 0.55, criteria: results, amount_to_release_cents: allMet ? input.remaining_cents : 0, model: "fixture/heuristic-verifier" };
  return enforceHardRules(verdict, input);
}
