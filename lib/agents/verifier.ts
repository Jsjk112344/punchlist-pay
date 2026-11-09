// Verifier agent: Claude vision over proofs vs. contract criteria. Owner: lib/agents.
import type Anthropic from "@anthropic-ai/sdk";
import type { Criterion, CriterionResult, ProofKind, Verdict, WorkOrder } from "@/lib/types";
import { AgentOutputError, callModel, isRecord, parseJsonOutput, readPrompt } from "./client";
import { verifierOutputSchema } from "./tools";

export type VisionMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export interface VerifierImage { kind: ProofKind; data: Buffer; media_type: VisionMediaType; exif_ts: string; exif_missing: boolean }
export interface VerifierInput { order: WorkOrder; images: VerifierImage[]; checkin_ts?: string; remaining_cents: number; now: string }

const kindLabel: Record<ProofKind, string> = { checkin: "check-in photo", after: "after photo", receipt: "receipt" };

export function criteriaFor(order: WorkOrder): Criterion[] {
  return order.contract?.criteria?.length ? order.contract.criteria : order.criteria;
}

/**
 * Returns a Verdict shaped exactly like lib/types.ts. Hard rules are enforced here in code regardless of the model:
 * missing check-in → fail; any proof EXIF earlier than check-in → fail; partial → amount ≤ remaining; fail → amount 0.
 */
export async function verifyProofs(input: VerifierInput): Promise<{ verdict: Verdict; raw: unknown }> {
  const criteria = criteriaFor(input.order);
  if (!criteria.length) throw new AgentOutputError("Work order has no acceptance criteria to verify against");
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  for (const img of input.images) {
    content.push({ type: "text", text: `${kindLabel[img.kind]}, ${img.exif_missing ? "EXIF missing (upload time used)" : `EXIF ${img.exif_ts}`}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data.toString("base64") } });
  }
  if (!input.images.length) content.push({ type: "text", text: "No proof images were submitted." });
  content.push({
    type: "text",
    text: [
      "Contract acceptance criteria (verify each by id):",
      ...criteria.map((c) => `- ${c.id}: ${c.text} [check: ${c.check}]`),
      "",
      `Work order: ${input.order.title} — ${input.order.description}`,
      `Unit: ${input.order.unit} (${input.order.property_name})`,
      `Check-in timestamp: ${input.checkin_ts ?? "none"}`,
      `Deadline: ${input.order.contract?.deadline ?? "none stated"}`,
      `Remaining balance available to release: ${input.remaining_cents} cents`,
      `Current time: ${input.now}`,
      "",
      "Return the verdict JSON.",
    ].join("\n"),
  });
  const msg = await callModel({
    max_tokens: 4096,
    system: readPrompt("verifier.md"),
    output_config: { effort: "medium", format: { type: "json_schema", schema: verifierOutputSchema(criteria.map((c) => c.id)) } },
    messages: [{ role: "user", content }],
  });
  const raw = parseJsonOutput(msg);
  const verdict = normalizeVerdict(raw, criteria, msg.model);
  return { verdict: enforceHardRules(verdict, input), raw };
}

/** Shapes any JSON into a Verdict covering every criterion id exactly once. Exported for tests and fallbacks. */
export function normalizeVerdict(raw: unknown, criteria: Criterion[], model: string): Verdict {
  if (!isRecord(raw)) throw new AgentOutputError("Verifier output is not an object", raw);
  const verdict = raw.verdict === "pass" || raw.verdict === "partial" || raw.verdict === "fail" ? raw.verdict : "fail";
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0;
  const amount = typeof raw.amount_to_release_cents === "number" && Number.isFinite(raw.amount_to_release_cents) ? Math.max(0, Math.round(raw.amount_to_release_cents)) : 0;
  const given = Array.isArray(raw.criteria) ? raw.criteria.filter(isRecord) : [];
  const results: CriterionResult[] = criteria.map((c) => {
    const r = given.find((g) => g.id === c.id);
    return { id: c.id, met: r?.met === true, evidence: typeof r?.evidence === "string" && r.evidence.trim() ? r.evidence.trim() : "No evidence provided" };
  });
  return { verdict, confidence, criteria: results, amount_to_release_cents: amount, model };
}

/**
 * Same hard rules, applied to any verdict (used by the fixture fallback too). Pure: returns a new object.
 * Pass `order` too when you have it so the time criterion can carry the EXIF evidence.
 */
export function enforceHardRules(verdict: Verdict, input: Pick<VerifierInput, "images" | "checkin_ts" | "remaining_cents"> & Partial<Pick<VerifierInput, "order">>): Verdict {
  const v: Verdict = { ...verdict, criteria: verdict.criteria.map((c) => ({ ...c })), confidence: Math.min(1, Math.max(0, Number.isFinite(verdict.confidence) ? verdict.confidence : 0)) };
  const criteria = input.order ? criteriaFor(input.order) : [];
  const timeId = criteria.find((c) => c.check === "time")?.id ?? v.criteria.at(-1)?.id;
  const remaining = Math.max(0, Math.round(input.remaining_cents));
  const append = (c: CriterionResult, note: string) => { c.evidence = c.evidence && c.evidence !== "No evidence provided" ? `${c.evidence} · ${note}` : note; };

  if (!input.checkin_ts) {
    v.verdict = "fail";
    const unmet = v.criteria.filter((c) => !c.met);
    if (unmet.length) unmet.forEach((c) => append(c, "No check-in timestamp"));
    else { const t = v.criteria.find((c) => c.id === timeId); if (t) { t.met = false; append(t, "No check-in timestamp"); } }
  } else {
    const checkin = Date.parse(input.checkin_ts);
    const stale = input.images.filter((i) => !i.exif_missing && i.kind !== "checkin" && Number.isFinite(Date.parse(i.exif_ts)) && Date.parse(i.exif_ts) < checkin);
    if (stale.length) {
      v.verdict = "fail";
      const t = v.criteria.find((c) => c.id === timeId) ?? v.criteria[0];
      if (t) { t.met = false; append(t, `EXIF ${stale[0].exif_ts} (${kindLabel[stale[0].kind]}) predates check-in ${input.checkin_ts}`); }
    }
  }
  if (v.verdict === "pass" && v.criteria.some((c) => !c.met)) v.verdict = "partial"; // never release everything on an unmet criterion
  if (v.verdict === "fail") v.amount_to_release_cents = 0;
  else if (v.verdict === "partial") { v.amount_to_release_cents = Math.min(Math.max(0, v.amount_to_release_cents), remaining); if (v.amount_to_release_cents <= 0) { v.verdict = "fail"; } }
  else v.amount_to_release_cents = remaining;
  return v;
}
