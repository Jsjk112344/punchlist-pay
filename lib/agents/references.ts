// Labelled reference photos (fixtures/reference) shown to the Verifier as calibration examples.
// Claude cannot be fine-tuned through the API; a few good/bad examples per trade in the prompt is the equivalent.
// Owner: lib/agents. Held-out role=eval items are never shown here; scripts/verifier-eval.ts scores against them.
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

export interface ReferenceItem {
  id: string; file: string; trade: string; label: "good" | "bad"; role: "reference" | "eval";
  criterion: { text: string; check: "photo" | "receipt" | "time" }; expected_met: boolean; note: string; unit: string | null;
  source: { title: string; page: string; license: string; author: string };
}

const DIR = () => path.join(process.cwd(), "fixtures", "reference");
let cache: ReferenceItem[] | null = null;
export function loadManifest(): ReferenceItem[] {
  if (cache) return cache;
  try { cache = (JSON.parse(fs.readFileSync(path.join(DIR(), "manifest.json"), "utf8")) as { items: ReferenceItem[] }).items; }
  catch { cache = []; }
  return cache;
}

/** Keyword → trade. Order matters only for readability; a job can match several trades. */
const TRADE_WORDS: Record<string, RegExp> = {
  plumbing: /\b(sink|p-trap|trap|leak\w*|drain|faucet|pipe|plumb\w*|valve|toilet)\b/i,
  cleaning: /\b(clean\w*|grime|turnover|move-out|debris)\b/i,
  drywall: /\b(drywall|patch\w*|plaster|ceiling|wall|repaint\w*|water stain\w*)\b/i,
  hinge: /\bhinges?\b/i,
  grout: /\b(grout\w*|tile\w*|caulk\w*)\b/i,
};
export function tradesFor(text: string): string[] { return Object.entries(TRADE_WORDS).filter(([, re]) => re.test(text)).map(([t]) => t); }

/** At most one good + one bad reference per matched trade, capped at `max` images. */
export function pickReferences(text: string, max = 4): ReferenceItem[] {
  const items = loadManifest().filter(i => i.role === "reference");
  const out: ReferenceItem[] = [];
  for (const trade of tradesFor(text)) {
    for (const label of ["good", "bad"] as const) {
      const hit = items.find(i => i.trade === trade && i.label === label);
      if (hit && out.length < max) out.push(hit);
    }
  }
  return out;
}

/** Content blocks for the start of the Verifier's user message. The last block is cached so repeat verifications of a trade are cheap. */
export function referenceBlocks(refs: ReferenceItem[]): Anthropic.Beta.Messages.BetaContentBlockParam[] {
  if (!refs.length) return [];
  const blocks: Anthropic.Beta.Messages.BetaContentBlockParam[] = [{ type: "text", text: "REFERENCE EXAMPLES. These are labelled photos from other jobs, shown only to calibrate your judgement of workmanship. They are not proof for this job; never cite them as evidence." }];
  for (const r of refs) {
    let data: string;
    try { data = fs.readFileSync(path.join(DIR(), r.file)).toString("base64"); } catch { continue; }
    blocks.push({ type: "text", text: `Reference (${r.label.toUpperCase()}, ${r.trade}) for "${r.criterion.text}": ${r.note}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  }
  blocks.push({ type: "text", text: "END OF REFERENCE EXAMPLES. The proof for this job follows.", cache_control: { type: "ephemeral" } });
  return blocks;
}
