// Scores the live Verifier on the held-out reference library (fixtures/reference, role=eval).
// Each case is one proof image against one criterion with a known answer. Runs with and without reference examples.
//   npx tsx scripts/verifier-eval.ts            both configurations
//   npx tsx scripts/verifier-eval.ts --refs     only with references   (--no-refs: only without)
// Needs ANTHROPIC_API_KEY in .env.local. Roughly two dozen vision calls per configuration.
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: ".env.local", quiet: true });

type Row = { id: string; trade: string; expected: boolean; met: boolean; confidence: number; verdict: string; evidence: string; ms: number };

async function main() {
  const { verifyProofs } = await import("../lib/agents/verifier");
  const { loadManifest } = await import("../lib/agents/references");
  const cases = loadManifest().filter(i => i.role === "eval");
  const configs = process.argv.includes("--refs") ? [true] : process.argv.includes("--no-refs") ? [false] : [false, true];
  const checkin = new Date(Date.now() - 60 * 60000).toISOString();
  const after = new Date(Date.now() - 10 * 60000).toISOString();
  const deadline = new Date(Date.now() + 3 * 3600000).toISOString();

  for (const refs of configs) {
    const rows: Row[] = [];
    const queue = [...cases];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const criterion = { id: "c1", text: c.criterion.text, check: c.criterion.check };
        const now = new Date().toISOString();
        const order = { id: `eval-${c.id}`, property_id: "p-1", property_name: "Alder House", unit_id: "u", unit: c.unit ?? "4B",
          title: `${c.trade} job`, description: c.criterion.text, criteria: [criterion], budget_cents: 20000, status: "under_review" as const,
          created_by: "pm-1", updated_at: now, negotiation: [], proofs: [], payouts: [],
          contract: { contractor_id: "mike", price_cents: 20000, deposit_pct: 0, deadline, criteria: [criterion] } };
        const data = fs.readFileSync(path.join("fixtures/reference", c.file));
        const t = Date.now();
        try {
          const { verdict } = await verifyProofs({ order, checkin_ts: checkin, remaining_cents: 20000, now, references: refs,
            images: [{ kind: c.criterion.check === "receipt" ? "receipt" : "after", data, media_type: "image/jpeg", exif_ts: after, exif_missing: false }] });
          const r = verdict.criteria[0];
          rows.push({ id: c.id, trade: c.trade, expected: c.expected_met, met: r.met, confidence: verdict.confidence, verdict: verdict.verdict, evidence: r.evidence, ms: Date.now() - t });
        } catch (e) {
          rows.push({ id: c.id, trade: c.trade, expected: c.expected_met, met: !c.expected_met, confidence: 0, verdict: "error", evidence: e instanceof Error ? e.message : String(e), ms: Date.now() - t });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    rows.sort((a, b) => a.id.localeCompare(b.id));

    const right = rows.filter(r => r.met === r.expected);
    const falsePass = rows.filter(r => r.met && !r.expected), falseFail = rows.filter(r => !r.met && r.expected);
    const wouldPay = rows.filter(r => r.met && r.verdict === "pass" && r.confidence >= 0.8);
    console.log(`\n=== ${refs ? "WITH" : "WITHOUT"} reference examples · ${right.length}/${rows.length} correct (${Math.round(100 * right.length / rows.length)}%) ===`);
    console.log(`bad work marked met: ${falsePass.length}   good work marked unmet: ${falseFail.length}   auto-pay (met, pass, conf ≥ 0.8): ${wouldPay.length}, of which bad: ${wouldPay.filter(r => !r.expected).length}`);
    const trades = [...new Set(rows.map(r => r.trade))];
    console.log(trades.map(t => { const tr = rows.filter(r => r.trade === t); return `${t} ${tr.filter(r => r.met === r.expected).length}/${tr.length}`; }).join(" · "));
    for (const r of rows) console.log(`${r.met === r.expected ? "  ok " : "  MISS"} ${r.id.padEnd(30)} expected ${r.expected ? "met  " : "unmet"} got ${r.met ? "met  " : "unmet"} ${r.verdict} ${r.confidence.toFixed(2)}  ${r.evidence.slice(0, 110)}`);
    const out = `fixtures/reference/eval-${refs ? "with" : "without"}-refs.json`;
    fs.writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5", references: refs, correct: right.length, total: rows.length, rows }, null, 1));
  }
}
main().catch(e => { console.error("EVAL FAILED:", e?.message ?? e); process.exit(1); });
