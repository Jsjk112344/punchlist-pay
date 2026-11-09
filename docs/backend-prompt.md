# Backend session prompt — Punchlist Pay (PayPal + Claude integration)

Read `PLAN.md`, `docs/ui-notes.md`, `lib/types.ts`, `lib/api.ts` and `lib/server-fixtures.ts` first. The UI is finished and runs against fixture stubs in `app/api/*` (every stub is marked `TODO(api)`). Your job is to make those routes real without changing a single request/response shape the UI depends on. Keep `?fixture=1` working as the fallback the whole time. Deadline: **Wed Nov 12, 12:00 PM PT**; everything below must be demoable by **Tue Nov 11, 6 PM ET**.

Work in this order; commit after each step; stop and batch any account/secret/paid asks into one "NEEDS JUSTIN" message.

## 0. Sandbox accounts & roles (get this right first)

- **Platform account** = the sandbox *business* account that owns the REST app (client id/secret). It receives order funds and sends payouts.
- **PM** = a second sandbox account (business or personal) that acts as the *payer*. Funding a work order = the PM approving a PayPal order in the browser. This is a real PayPal button in the UI — good for the demo, so don't try to hide it.
- **Contractors** = 3 sandbox *personal* accounts. Their emails are Payout receivers. Seed them in `db/seed.ts` (`contractors.paypal_email`).
- Prove the rails by hand before writing code (`scripts/paypal-smoke.sh`): get token → create order `intent: AUTHORIZE` → approve in browser as PM → `authorize` → `capture` → `POST /v1/payments/payouts` to a contractor → check contractor's sandbox balance. If any step fails, fix the account setup now, not on Tuesday.

## 1. `lib/paypal/`

- `client.ts`: OAuth token with in-memory cache + refresh; base URL from `PAYPAL_ENV=sandbox`; every write sends `PayPal-Request-Id` (idempotency).
- `orders.ts`: `createAuthorizeOrder({work_order_id, amount_cents, description})`, `authorizeOrder(orderId)`, `captureAuthorization(authId, amount_cents?)`, `voidAuthorization(authId)`, `getOrder`.
- `payouts.ts`: `sendPayout({work_order_id, kind, receiver_email, amount_cents, note})` with `sender_batch_id = ${work_order_id}:${kind}` so retries are idempotent; `getPayoutBatch(batchId)`; map `batch_status`/item status → our `pending|paid`.
- `webhooks.ts`: `verifySignature(headers, rawBody)` via `/v1/notifications/verify-webhook-signature`. Handle `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/FAILED`. Unsigned → 400, never mutate state.
- Fallback already decided: if webhooks don't arrive on Render within 30 min of trying, add `lib/paypal/poll.ts` that reconciles pending orders/payouts every 3 s from the ledger route. Don't block on webhooks.

## 2. Persistence

- Drizzle + Postgres (Neon free tier or Render Postgres). Schema exactly as `PLAN.md` "Data model"; add `paypal_webhook_events(id, event_id unique, type, payload, received_at)` for dedupe.
- Replace `lib/server-fixtures.ts` internals with a `lib/db/repo.ts` that returns the same `WorkOrder` view model `lib/types.ts` defines (one query joining contract, latest verdict, proofs, payouts). The UI never learns the DB exists.
- `db/seed.ts`: 1 PM org, 2 properties, 3 contractors, 6 historical *paid* work orders with realistic timestamps so the dashboard and AG Grid aren't empty on first load. Include one `escalated` row.
- If Postgres is costing more than 2 hours, fall back to the existing in-memory `globalThis` store + a JSON snapshot on disk, seed on boot, and note it in README. Judges running locally won't care; the demo won't either.

## 3. Funding flow (new, the UI needs one small addition)

- `POST /api/work-orders/:id/negotiate` currently fabricates `paypal_order_id`. Real version: run the negotiation (step 4), then call `createAuthorizeOrder` and return `{contract, approve_url, paypal_order_id}`.
- Add `POST /api/work-orders/:id/fund/confirm` `{paypal_order_id}` → `authorizeOrder` → store `paypal_auth_id` → status `funded`.
- UI change (coordinate with the UI session or do it yourself, minimal): after the Agreement card, render the PayPal JS SDK Buttons (`intent=authorize`, `createOrder` returns our order id, `onApprove` calls `/fund/confirm`). Until approved, the money rail shows `Awaiting funding`. Keep it to one component: `components/fund-button.tsx`.

## 4. Claude agents (`lib/agents/`)

Use `@anthropic-ai/sdk`, model `claude-sonnet-4-5` (or latest Sonnet) for speed; tool use / JSON schema for every structured output. Prompts in `lib/agents/prompts/*.md`.

- **Dispatcher** `POST /api/work-orders`: text → `{title, unit, budget_cents, deadline, criteria[3]: {id, text, check: photo|receipt|time}}`. Criteria must be *verifiable from a photo, a receipt, or a timestamp* — reject vague ones in the prompt ("workmanlike", "clean").
- **Negotiation** `negotiate` route: two `messages.create` loops alternating Dispatcher (PM budget, deadline, deposit policy 20%) and Contractor (profile from `contractors.profile_json`: rates, after-hours surcharge, availability). Max 4 turns, each ≤ 2 sentences, must end in a tool call `agree({price_cents, deadline, deposit_pct, criteria})` or `walk_away`. Stream each turn as the existing SSE `TranscriptTurn` shape; emit a `system` turn `Order authorized · $240.00` after the PayPal call. **Agent-to-agent is a must-have**: the Dispatcher's PayPal actions should be *its own tool calls* — register `create_authorize_order` as a tool and execute it server-side when the model calls it. Try the PayPal Agent Toolkit (`@paypal/agent-toolkit`) tools first; if its tool set or auth fights you for more than 45 min, wrap `lib/paypal/*` as tools yourself. Either way the transcript shows the agent moving money.
- **Verifier** `verify` route: Claude vision over `after` + `receipt` + `checkin` images (fetch bytes, pass as image blocks) plus the contract criteria and check-in timestamp. Output `Verdict` exactly as `lib/types.ts`. Hard rules in prompt and in code: `fail` or `confidence < 0.8` → status `escalated`, no payout; missing check-in or EXIF earlier than check-in → fail with that evidence; `partial` → `amount_to_release_cents` ≤ remaining balance. On `pass`: `captureAuthorization` then `sendPayout(balance)`; on check-in proof: `sendPayout(deposit)`.
- Cache verdicts by proof-set hash so re-running verify on the same photos doesn't re-bill or flip results.

## 5. Real proof assets

Replace `public/fixtures/*.svg` with real JPEGs that keep EXIF: `sink-before.jpg`, `sink-after.jpg`, `receipt.jpg`, `door-4b.jpg`, `door-4c.jpg`. Read EXIF server-side (`exifr`) into `proofs.exif_ts`; fall back to upload time with a `exif_missing` flag the Verifier sees. Uploads: local disk under `/uploads` for dev, Render persistent disk or S3-compatible bucket for prod; store URLs only.

## 6. Deploy & docs

- `render.yaml`: web service + Postgres (if used) + env vars; build runs `drizzle-kit push` + seed on first deploy.
- `.env.example`: `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `APP_URL`.
- `scripts/smoke.ts`: add a `--live` mode that runs request → negotiate → (auto-approve is impossible; print the approve URL and wait for `--order-id`) → check-in → deposit payout → after+receipt → verify → balance payout, asserting statuses at each step.
- README: reproduce in 10 minutes (sandbox account setup included, with screenshots of where the client id lives), "Which PayPal APIs and why", "Where the AI makes decisions and where it can't" (the leash), judging map.

## Guardrails

- Sandbox only; secrets only in env. Never log tokens or full webhook payloads with payer PII.
- Never mark a payout `paid` without a successful API response or a webhook/poll confirmation.
- Keep every existing route's response shape; run `npm run typecheck` and `npm run smoke` (fixture) before each commit.
- If something takes > 45 min with no progress, take the pre-decided fallback and write one line in `PLAN.md` under "Decisions".

## NEEDS JUSTIN (collect and send once)

- PayPal developer dashboard: create the REST app on the platform business account (sandbox client id/secret), 1 PM payer account, 3 contractor personal accounts; note all logins in a private file (not the repo).
- Webhook subscription for the Render URL once deployed (or ngrok for local).
- Anthropic API key; Neon/Render Postgres connection string; Render service connected to the GitHub repo.
- Five real photos taken on a phone (EXIF intact): under-sink before/after, a hardware-store receipt, two apartment doors with visible unit numbers.

## Done when

- [ ] `scripts/paypal-smoke.sh` passes end to end against sandbox
- [ ] Hosted URL: request → negotiation (real agents, PayPal tool call visible) → PayPal button → funded → check-in → deposit in contractor sandbox → proof → PASS → balance payout → grid flashes `Paid`
- [ ] Wrong-door scenario → FAIL → `escalated`, nothing paid; PM `Request redo` works
- [ ] `?fixture=1` still runs the full story offline
- [ ] README reproduce steps verified from a clean clone
