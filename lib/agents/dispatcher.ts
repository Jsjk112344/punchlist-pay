// Dispatcher agent: plain-English request → structured work order. Owner: lib/agents.
import type { Criterion, CriterionCheck } from "@/lib/types";
import { AgentOutputError, callModel, isRecord, parseJsonOutput, readPrompt } from "./client";
import { CRITERION_CHECKS, dispatcherOutputSchema } from "./tools";

export interface DispatcherContext { units: { unit: string; property_name: string; property_id: string }[]; now: string }
export interface DispatcherDraft { title: string; unit: string; property_id?: string; budget_cents: number; deadline: string; criteria: Criterion[]; description: string }

/** Exactly 3 criteria, each verifiable from a photo, a receipt, or a timestamp. Throws on model/API failure (caller falls back). */
export async function draftWorkOrder(text: string, ctx: DispatcherContext): Promise<DispatcherDraft> {
  const units = ctx.units.length ? ctx.units.map((u) => `${u.unit} at ${u.property_name} (property_id ${u.property_id})`).join("; ") : "none on file";
  const user = [`Current time: ${ctx.now}`, `Known units: ${units}`, "", "Maintenance request:", `"""${text.trim()}"""`, "", "Return the work order as JSON matching the schema."].join("\n");
  const msg = await callModel({
    max_tokens: 2048,
    system: readPrompt("dispatcher.md"),
    output_config: { effort: "low", format: { type: "json_schema", schema: dispatcherOutputSchema } },
    messages: [{ role: "user", content: user }],
  });
  return validateDraft(parseJsonOutput(msg), text, ctx);
}

/** Pure validation/normalisation of the model's JSON. Exported for tests and for the fixture fallback. */
export function validateDraft(raw: unknown, text: string, ctx: DispatcherContext): DispatcherDraft {
  if (!isRecord(raw)) throw new AgentOutputError("Dispatcher output is not an object", raw);
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 40) : null;
  if (!title) throw new AgentOutputError("Dispatcher output has no title", raw);
  const unitToken = typeof raw.unit === "string" ? raw.unit.trim() : "";
  if (!unitToken) throw new AgentOutputError("Dispatcher output has no unit", raw);
  const budget = typeof raw.budget_cents === "number" ? Math.round(raw.budget_cents) : NaN;
  if (!Number.isFinite(budget) || budget <= 0) throw new AgentOutputError("Dispatcher budget must be a positive integer", raw);
  if (!Array.isArray(raw.criteria) || raw.criteria.length !== 3) throw new AgentOutputError("Dispatcher must return exactly 3 criteria", raw);
  const criteria: Criterion[] = raw.criteria.map((c, i) => {
    if (!isRecord(c) || typeof c.text !== "string" || !c.text.trim()) throw new AgentOutputError(`Criterion ${i + 1} has no text`, raw);
    if (!CRITERION_CHECKS.includes(c.check as CriterionCheck)) throw new AgentOutputError(`Criterion ${i + 1} has an invalid check`, raw);
    return { id: `c${i + 1}`, text: c.text.trim(), check: c.check as CriterionCheck };
  });
  const known = ctx.units.find((u) => u.unit.toLowerCase() === unitToken.toLowerCase());
  const property_id = known?.property_id ?? (typeof raw.property_id === "string" && ctx.units.some((u) => u.property_id === raw.property_id) ? raw.property_id : undefined);
  const deadline = normalizeDeadline(typeof raw.deadline === "string" ? raw.deadline : "", ctx.now);
  return { title, unit: known?.unit ?? unitToken, property_id, budget_cents: budget, deadline, criteria, description: text.trim() };
}

/** Valid ISO in → canonical ISO out (offset preserved as written). Anything else → 18:00 on the day of `now`, in now's offset. */
export function normalizeDeadline(candidate: string, now: string): string {
  if (candidate && Number.isFinite(Date.parse(candidate))) return candidate;
  return defaultDeadline(now);
}
export function defaultDeadline(now: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(now);
  if (m) return `${m[1]}T18:00:00${m[2] ?? ""}`;
  const d = new Date(Number.isFinite(Date.parse(now)) ? now : Date.now());
  return `${d.toISOString().slice(0, 10)}T18:00:00Z`;
}
