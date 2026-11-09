# Build prompt — Punchlist Pay (PayPal AI Hackathon 2026)

You are building and shipping a hackathon submission solo with me (Justin) in a loop: plan → build → verify → fix. Hard deadline: **Wed Nov 12, 2026, 12:00 PM PT (3:00 PM ET)**. Video must be uploaded and the Devpost form filled by **11:00 AM PT**. Do not ask routine permission questions; batch anything that needs my accounts, secrets, or paid actions into one "NEEDS JUSTIN" message and keep working.

## What we're building

**Punchlist Pay** — a property manager's work-order desk where AI agents scope, negotiate, verify, and *pay* outsourced contractors through PayPal.

Persona: a small property manager (20–200 units) who dispatches plumbers, electricians, handymen and cleaners for small jobs and pays them on net-30/60 by check or manual transfer. Contractors hate the wait; PMs hate chasing photos and invoices. Punchlist Pay funds the work order up front, verifies completion from the contractor's proof, and releases a PayPal Payout within seconds of a pass.

Two AI agents, one human in the loop:

- **Dispatcher agent** (PM side, Claude): turns a plain-English maintenance request into a structured work order with acceptance criteria and a budget; negotiates scope/price with the contractor's agent; holds the funds.
- **Contractor agent** (trade side, Claude with a different system prompt + the contractor's profile/rates): counters on price and scope, accepts, and later submits proof on the contractor's behalf (the human contractor just uploads photos from their phone).
- **Verifier** (Claude vision): compares proof (before/after photos, parts receipt, check-in timestamp) against the acceptance criteria, returns pass / partial / fail with reasons and a confidence. Pass → PayPal Payout. Partial → partial payout + remainder held. Fail or low confidence → escalates to the PM with a one-tap approve/dispute.

The PM never leaves the dashboard; the contractor never sends an invoice.

### Why it wins (map to rubric)

- **Technological implementation**: PayPal Orders v2 (authorize now, capture on pass) + Payouts API + webhooks + PayPal Agent Toolkit/MCP driving the money moves from the agents; Claude vision for verification; agent-to-agent negotiation with a settlement contract. Non-trivial and visibly real in the sandbox.
- **Design**: one coherent product — request → work order → negotiation → proof → payout — with a PM dashboard (AG Grid ledger) and a mobile contractor view.
- **Impact**: specific audience, specific pain (payment delay for trades; PM admin time). Before/after: 30–60 days → under a minute; zero invoices.
- **Innovation**: money released on AI-verified proof of physical work, with agent-to-agent negotiation setting the terms it's verified against.
- **Presentation**: visual demo — photos in, reasoning on screen, payout lands, grid row flips.
- **Special prizes targeted**: Best Use of Agentic Commerce, Best Use of PayPal + AI, Best Demo Delivery, Best Use of AG Grid, Best Use of Render.

## Stack

- Next.js 15 (App Router, TS), Tailwind + shadcn/ui, Postgres (Neon or Render Postgres) via Drizzle, deployed on **Render** (web service + Postgres; `render.yaml` blueprint in repo).
- Claude API (Anthropic SDK) for Dispatcher, Contractor, Verifier. Tool use for structured outputs.
- PayPal: REST sandbox (Orders v2, Payments v2 authorizations/captures, Payouts v1, Webhooks). Install the **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) and expose its tools to the Dispatcher agent so the *agent* is the one creating orders/payouts via tool calls — that's the agentic-commerce story. Fall back to direct REST calls if a toolkit tool is missing or flaky.
- **AG Grid** (community) for the work-order/payout ledger: grouping by contractor and property, status cell renderers, live updates on webhook events, master/detail row showing proof + verifier reasoning, export to CSV.
- Uploads: UploadThing or S3-compatible (Render disk is fine for the demo). Store photo EXIF timestamp.

## Demo path (the video, ≤ 2:45)

```
Problem (15s):  "Unit 4B texts: kitchen sink is leaking. Today the PM calls three plumbers,
                 one shows up, sends a blurry photo and a paper invoice, and gets paid in 45 days."
Tension (10s):  Good trades stop taking PM work. PMs drown in photos and checks.
Solution (~2m, chronological):
  1. PM types "4B kitchen sink leaking under the cabinet, fix today, keep it under $250."
     → Dispatcher produces a work order: scope, 3 acceptance criteria (after-photo shows dry
       P-trap and connections, parts receipt ≤ $60, completed before 6pm), budget $220.
  2. Dispatcher invites Mike's Plumbing. The two agents negotiate in a visible thread:
     Contractor agent counters $260 citing after-hours; Dispatcher offers $240 if done by 4pm;
     agreed. Terms become the contract. Dispatcher calls PayPal → Order created & authorized
     for $240 (funds held). Grid row: "Funded".
  3. Mike (phone view) taps Check in → timestamped photo of the leak. Verifier confirms
     location/time → 20% deposit payout fires ($48). Grid: "In progress · deposit paid".
  4. Mike uploads after-photo + receipt. Verifier reasons on screen: dry trap ✓, receipt $41 ✓,
     3:52pm ✓ → PASS, confidence 0.93. Dispatcher captures the authorization and sends the
     $192 balance Payout. Mike's phone shows "Paid $240 · PayPal". Grid: "Paid".
  5. Second job (quick): cleaner submits a photo of the wrong unit. Verifier: FAIL — unit
     number on door doesn't match, photo EXIF predates check-in. Escalated to PM with the
     evidence side by side; PM taps "Request redo". Nothing paid. (Shows the AI is judging.)
Payoff (15s):   Ledger view: 6 jobs this week, all paid within 90 seconds of verification,
                 zero invoices, every payout linked to its proof. 45 days → 90 seconds.
```

## Features

**Must-have (demo breaks without it)**
1. Work-order creation from plain English (Dispatcher) with structured acceptance criteria.
2. Agent-to-agent negotiation thread (Dispatcher ↔ Contractor agent), max 4 turns, ending in a signed `Contract` record (price, scope, criteria, deadline, deposit %).
3. PayPal Order (intent AUTHORIZE) created on agreement; authorization stored. Webhook or poll updates status.
4. Contractor mobile view: check-in photo, proof upload (photos + receipt).
5. Verifier (Claude vision) → `{verdict: pass|partial|fail, confidence, criteria: [{id, met, evidence}], amount_to_release}`.
6. Payouts API call on pass/partial (deposit and balance); capture of the authorization on completion; status back to the grid.
7. Escalation path on fail/low confidence: PM approve / request redo / dispute, with evidence shown.
8. AG Grid ledger with grouping, status renderers, master/detail (proof + reasoning), live refresh.
9. Hosted on Render, seeded demo data, README with 10-minute reproduce steps, MIT license, demo video.

**Nice-to-have (only if ahead on day 2)**
- Pay Later / financing line for the PM on large jobs (just a quote via Dispatcher, no API).
- Weekly PM digest; contractor rating from verifier history.
- Multi-currency contractors (Payouts supports currency codes) — mention, don't demo.

**Cut**
- Real auth/multi-tenant. Hardcode one PM org and 3 contractors; magic-link style "sign in as Mike".
- Real marketplace/Multiparty split payments (needs partner approval, not sandbox-friendly).
- Native mobile app; the contractor view is a responsive web route.
- Discord/Switch rooms. The dashboard is the UI.

## Simplification ladder (pre-decided fallbacks)

| Must-have | If it fails by the checkpoint |
|---|---|
| Agent Toolkit tool calls | Agents call our own `/api/paypal/*` route handlers that wrap REST directly; still shown as agent tool calls in the thread |
| Orders authorize → capture | Capture immediately at agreement (intent CAPTURE); escrow becomes "funded balance" in our ledger |
| Payouts to contractor | Record payout intent + show sandbox API response; if Payouts flaky, send via Agent Toolkit `create_payout` or fall back to an invoice-paid flow |
| Webhooks (ngrok/Render URL) | Poll order/payout status every 3s from the server |
| Claude vision on real photos | Pre-shot demo photos with known EXIF; verifier prompt tuned on them; cached verdicts in fixtures |
| Live negotiation on camera | Record it once; replay transcript with typewriter effect from fixture if the API hiccups |

## Data model (Drizzle)

- `properties(id, name, address)` · `units(id, property_id, label)`
- `contractors(id, name, trade, paypal_email, hourly_rate, profile_json)`
- `work_orders(id, unit_id, title, description, criteria_json, budget_cents, status, created_by)`
  - status: `draft → negotiating → funded → in_progress → under_review → paid | escalated | disputed | redo_requested`
- `negotiations(id, work_order_id, transcript_json, outcome)`
- `contracts(id, work_order_id, contractor_id, price_cents, deposit_pct, deadline, criteria_json, paypal_order_id, paypal_auth_id)`
- `proofs(id, work_order_id, kind: checkin|after|receipt, url, exif_ts, uploaded_at)`
- `verdicts(id, work_order_id, verdict, confidence, criteria_results_json, amount_to_release_cents, model, raw)`
- `payouts(id, work_order_id, contractor_id, amount_cents, kind: deposit|balance|partial, paypal_batch_id, paypal_item_id, status)`
- `events(id, work_order_id, type, payload_json, at)` — everything the grid and the activity feed render.

## API contracts (so agents/you can work independently)

- `POST /api/work-orders` `{text}` → Dispatcher → `{work_order}` with `criteria: [{id, text, check: "photo"|"receipt"|"time"}]`
- `POST /api/work-orders/:id/negotiate` `{contractor_id}` → runs both agents server-side, streams turns (SSE), ends with `{contract}`; side effect: PayPal order created + authorized (sandbox approve step automated with the sandbox buyer account or pre-approved via Agent Toolkit flow — verify which is quickest; fallback: a "Fund" button that opens PayPal checkout).
- `POST /api/work-orders/:id/proofs` multipart → `{proof}`; on `kind=after` auto-triggers verify.
- `POST /api/work-orders/:id/verify` → Verifier → `{verdict}`; if pass/partial → `POST /api/payouts` internally.
- `POST /api/payouts` `{work_order_id, amount_cents, kind}` → Payouts batch → `{payout}`; on balance, capture authorization.
- `POST /api/paypal/webhook` → verifies signature, writes `events`, updates statuses.
- `POST /api/work-orders/:id/decision` `{action: approve|redo|dispute}` (PM escalation).
- `GET /api/ledger` → rows for AG Grid (`work_order` joined with contract, latest verdict, payouts).

Agent tool schemas live in `/lib/agents/tools.ts`; agent prompts in `/lib/agents/prompts/*.md`. Verifier prompt must demand per-criterion evidence quotes and must refuse to pass if the check-in timestamp is missing or the EXIF predates check-in.

## PayPal specifics to verify on day 1 (don't trust me blindly)

- Sandbox business account = the PM; sandbox personal accounts = contractors (their emails are Payout receivers). Payouts work in sandbox without the live-enablement review.
- Orders v2 `intent: AUTHORIZE` → payer approval → `POST /v2/checkout/orders/{id}/authorize` → later `POST /v2/payments/authorizations/{id}/capture`. Authorization honor period ~3 days, valid 29 days — fine for the demo.
- Payouts: `POST /v1/payments/payouts` with `sender_batch_header.sender_batch_id` as idempotency key; `items[].receiver` = contractor sandbox email; check `batch_status` or webhook `PAYMENT.PAYOUTSBATCH.SUCCESS` / `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`.
- Agent Toolkit (`@paypal/agent-toolkit`, MCP server + Vercel AI SDK / LangChain adapters): confirm which tools it exposes (orders, invoices, payouts?) and use the ones it has; wrap the rest.
- Webhook signature verification endpoint `/v1/notifications/verify-webhook-signature`.

## Repo layout

```
punchlist-pay/
  README.md            # what/why, 90s architecture, demo video, reproduce in 10 min, judging map, what's next
  LICENSE              # MIT
  render.yaml
  .env.example         # PAYPAL_CLIENT_ID/SECRET, PAYPAL_WEBHOOK_ID, ANTHROPIC_API_KEY, DATABASE_URL
  app/                 # (pm)/dashboard, (pm)/work-orders/[id], (contractor)/m/[contractorId]/jobs/[id], api/*
  lib/agents/          # dispatcher.ts, contractor.ts, verifier.ts, tools.ts, prompts/
  lib/paypal/          # client.ts, orders.ts, payouts.ts, webhooks.ts
  db/                  # schema.ts, seed.ts (3 contractors, 2 properties, 6 historical paid jobs for the ledger)
  fixtures/            # demo photos (leak before/after, receipt, wrong-unit door), cached verdicts + negotiation transcript
  docs/demo-script.md  # exact clicks/lines + timestamps
  docs/submission.md   # Devpost text: tagline, description, tools used, PayPal usage, AI usage
  scripts/smoke.ts     # fixture-mode end-to-end: create → negotiate → fund → proof → verify → payout
```

## Timeline (ET)

- **Sun Nov 9 (tonight)**: repo, Render deploy of hello-world + Postgres, PayPal sandbox apps/accounts, verify Orders authorize + one Payout by hand with curl. Write agent prompts. Commit `PLAN.md`.
- **Mon Nov 10**: must-haves 1–7 in fixture mode, then live. Checkpoint 6pm: can a work order go request → paid end to end? If not, cut negotiation to a 2-turn scripted exchange.
- **Tue Nov 11**: AG Grid ledger, contractor mobile polish, escalation flow, seed data, README. Shoot demo photos. Checkpoint 6pm: run the full demo script twice without touching code. Record screen takes.
- **Wed Nov 12 AM**: edit video (≤2:45, voiceover, no third-party music), upload to YouTube, Devpost form, final README pass, tag release. Submit by 11:00 AM PT.

## Guardrails

- Sandbox only. No live credentials anywhere. `.env.example` + Render env vars.
- Idempotency keys on every PayPal write (`PayPal-Request-Id`, `sender_batch_id`).
- Never auto-pay on `confidence < 0.8` or on any `fail`; escalate. Say so in the README — judges care that the agent has a leash.
- Commit small, push often; CI runs `smoke.ts` in fixture mode.

## NEEDS JUSTIN (surface once, early)

- PayPal developer account: create sandbox business app (client id/secret), 3 sandbox personal accounts for contractors, webhook subscription pointing at the Render URL.
- Anthropic API key; GitHub repo name/visibility (`gh auth status`); Render account connected to GitHub.
- Demo photos: a real under-sink before/after is far more convincing than stock. Shoot them on a phone (EXIF intact) or I'll stage with fixtures.
- Record the 2:45 video and submit the form.

## Demo-ready checklist

- [ ] Hosted URL on Render loads seeded dashboard; "Sign in as PM" / "Sign in as Mike" work
- [ ] Request → work order with criteria in < 10s
- [ ] Negotiation thread streams and ends in a Contract; PayPal order authorized (visible in sandbox)
- [ ] Check-in → deposit Payout appears in contractor's sandbox account
- [ ] After-photo + receipt → PASS verdict with per-criterion evidence → balance Payout + capture
- [ ] Wrong-unit proof → FAIL → escalation UI, nothing paid
- [ ] AG Grid: grouping, status renderers, master/detail, live update after webhook
- [ ] README reproduce steps verified from a clean clone; MIT license; `docs/submission.md` written
- [ ] Video ≤ 3:00 on YouTube (public), shows the working build, no third-party music
