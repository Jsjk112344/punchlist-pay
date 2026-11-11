# Punchlist Pay

A property manager's work-order desk where Claude agents scope a job, negotiate it with the contractor's agent, verify photo proof, and pay the contractor through PayPal within seconds of a pass. Built for the PayPal AI Hackathon 2026.

**Live demo:** https://punchlist-pay.onrender.com (PayPal sandbox + Claude, on Render; the free instance sleeps when idle, so the first load can take about a minute) · **Video:** [`docs/video/punchlist-pay.mp4`](docs/video/punchlist-pay.mp4)

**Why:** 82% of US contractors wait more than 30 days to get paid, and slow payments cost US construction an estimated $299B in 2025 ([Rabbet 2024 and 2025 Construction Payments Reports](https://rabbet.com/reports/construction-payments-2025)). Payment is slow because proof is slow. Punchlist Pay makes the proof the trigger.

**Promised → proven → paid:** request → work order → agent negotiation → PM funds with PayPal → check-in (deposit payout) → after-photo + receipt → Claude vision verdict → capture + balance payout. Fail or low confidence escalates to the PM, and nothing is paid.

## Reproduce in 10 minutes

```bash
git clone https://github.com/Jsjk112344/punchlist-pay && cd punchlist-pay
npm install
cp .env.example .env.local    # fill in what you have; everything is optional
npm run dev                   # http://localhost:3000
```

- `http://localhost:3000/?fixture=0` runs against the real backend (API routes + database).
- `http://localhost:3000/?fixture=1` is the fully offline browser demo (localStorage only).

With an empty `.env.local` the backend still runs end to end: an embedded Postgres (PGlite) is created under `data/pglite` and seeded, the agents are scripted, and the money rail is simulated. Every simulated id starts with `FIXTURE-` and every API response carries `X-Punchlist-Mode: fixture`. Add keys to make each layer real. `GET /api/health` shows which layers are live.

### PayPal sandbox setup

1. Sign in at developer.paypal.com and open **Testing Tools → Sandbox Accounts**.
2. Keep or create one **Business** account. This is the platform: it owns the REST app, receives order funds and sends payouts.
3. Create one more account (personal is fine) to act as the **property manager** who approves orders.
4. Create three **Personal** accounts for the contractors. Put their emails in `CONTRACTOR_EMAIL_MIKE`, `_SARA` and `_LEO`.
5. Open **Apps & Credentials**, make sure the toggle says **Sandbox**, and create an app owned by the Business account. Copy the client id into `PAYPAL_CLIENT_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, and the secret into `PAYPAL_CLIENT_SECRET`.
6. Prove the rails by hand before anything else:

```bash
npm run paypal:smoke -- sb-contractor@personal.example.com
```

It gets a token, creates an authorize order, waits while you approve it as the PM, then authorizes, captures, sends a payout and polls it.

7. Optional: add a webhook for `https://<your-host>/api/paypal/webhook` with the events below and put its id in `PAYPAL_WEBHOOK_ID`. Without it, the 3-second ledger poll settles everything.

### Claude

Put an API key in `ANTHROPIC_API_KEY`. Agents use `claude-sonnet-5-5` by default; set `CLAUDE_MODEL` to change it.

### Checks

```bash
npm run typecheck
npm run smoke         # fixture-data checks, then the full backend story offline on a fresh database
npm run test:unit     # PayPal client (mocked fetch), agents (mocked Claude), persistence
npm run smoke:live    # same story against PayPal sandbox + Claude from .env.local; pauses for PM approval
```

## Which PayPal APIs and why

| API | Used for |
|---|---|
| Orders v2, intent `AUTHORIZE` | The Dispatcher agent creates the order at the agreed price. The PM approves it in the PayPal button, so funds are held, not taken. |
| Payments v2 authorize / capture | Authorize on approval. Capture once, right before the first non-deposit payout. |
| Payouts v1 | Deposit on check-in, balance or partial after a passing verdict. `sender_batch_id` is `<work order>:<kind>`, so a retry can never pay twice. |
| Webhooks + verify-webhook-signature | `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/FAILED`. Unsigned requests get a 400 and change nothing. Events are de-duplicated by id. |
| JS SDK Buttons | The PM's funding step on the work-order page. |

Every write sends `PayPal-Request-Id`. A payout is shown as paid only after PayPal confirms it through the API response, the poll or a webhook.

## Where the AI decides, and where it can't

- **Dispatcher** turns plain English into a title, unit, budget, deadline and exactly three criteria. Each criterion must be checkable from a photo, a receipt or a timestamp. Vague words like "workmanlike" are rejected.
- **Negotiation** is two separate Claude conversations, Dispatcher and Contractor, each with its own instructions and the contractor's real rates. It runs at most four turns, two sentences each, and every turn is a tool call: counter, agree or walk away. On agreement the Dispatcher calls its own `create_authorize_order` tool, and the server executes that call against PayPal.
- **Verifier** looks at the check-in, after-photo and receipt images with the contract criteria and returns a verdict per criterion, with quoted evidence and a confidence.

The Verifier also sees labelled reference photos for the job's trade before the proof: one good and one bad example each for cleaning, plumbing, drywall, hinges and grout. They come from `fixtures/reference/` (openly licensed Wikimedia Commons and Unsplash images, see `ATTRIBUTION.md`). Claude can't be fine-tuned through the API, so this is how it learns what finished work looks like. `npm run eval:verifier` scores the Verifier on 58 held-out photos with and without the references.

The leash, enforced in code regardless of what the model says:

- No automatic payment on a `fail` or on confidence below 0.8. The job escalates to the PM.
- A missing check-in, or a proof photo whose EXIF time predates check-in, is a fail.
- A partial payout can never exceed the remaining balance. A deposit must equal the agreed percentage and needs a check-in photo.
- Verdicts are cached by a hash of the proof set, so re-running verify never re-bills or flips a result.
- Money only moves after a human funded the order. "Approve anyway" is an explicit PM override that is logged with the original verdict.

## AG Grid and Render

**AG Grid** (`ag-grid-react` 33, Community) is the ledger on the dashboard (`components/ledger-grid.tsx`), where every payout meets its proof:

- **Proof column:** after-photo thumbnail plus the Verifier's verdict and confidence (a PM override shows as "PM OK").
- **Proof → pay column:** seconds from proof upload to the PayPal-confirmed payout, sortable.
- **Pinned bottom row:** live totals of agreed, held and paid, and the average proof → pay, following the filters and search.
- **Quick filter search** across unit, job, contractor and property; status chips; CSV export.
- **Cell flash:** when a 3-second poll or webhook sees PayPal confirm a payout, the status and paid cells flash green in place (row ids are stable).
- **Expandable rows and grouping:** full-width rows expand a job into its check-in, after and receipt photos, the per-criterion evidence and the payout timeline. "Group by property" builds collapsible property groups on the same grid.
- Custom cell renderers throughout, on a Quartz theme matched to the app.

**Render** hosts the whole app from `render.yaml`, a Blueprint with a Node web service (Next.js) and a Render Postgres database. Drizzle migrations and the demo seed run at boot, `APP_URL` falls back to Render's `RENDER_EXTERNAL_URL`, and `/api/health` is the health check. The same code runs on embedded PGlite locally, so `npm run dev` needs no database.

## Architecture

```
app/api/*          thin route handlers (shapes unchanged from the UI contract)
lib/flows.ts       every state transition: create, negotiate, fund, proof, verify, payout, decide
lib/agents/*       Claude: dispatcher, negotiation, verifier, strict tools, prompts/*.md
lib/paypal/*       REST client (token cache, idempotency), orders, payouts, webhooks
lib/money.ts       live PayPal rail or the explicitly simulated FIXTURE rail
lib/reconcile.ts   3s poll + webhook handler that settle orders and payouts
lib/db/*           Drizzle schema + repo returning the UI view model; Postgres or PGlite
db/seed.ts         1 PM org, 2 properties, 3 contractors, 6 paid jobs, 1 escalated
```

Proof photos are stored under `UPLOAD_DIR` and served from `/api/files/<name>`. EXIF capture time is read with `exifr`; when it is missing the upload time is used and the Verifier is told.

## Deploy on Render

`render.yaml` is a Blueprint: a Node web service plus a free Render Postgres. In the Render dashboard choose **New → Blueprint**, pick this repo, and paste the `sync: false` values (PayPal sandbox keys, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `ANTHROPIC_API_KEY`, the three contractor emails; `PAYPAL_WEBHOOK_ID` is optional). Migrations and the seed run at boot. `APP_URL` defaults to Render's `RENDER_EXTERNAL_URL`. The free plan sleeps when idle (the first request takes about a minute) and uploaded photos live on the instance, so they vanish on redeploy.

## Fixture mode

`?fixture=1` is sandbox demonstration data in the browser, not a PayPal transaction. Seeded database rows use `SEED-` ids for the same reason.

The demo proof photos in `public/fixtures/` (`sink-before.jpg`, `sink-after.jpg`) are real under-sink photos from Wikimedia Commons (see `public/fixtures/ATTRIBUTION.md`). They carry no EXIF and the two shots don't obviously show the same cabinet, so in a live run the Verifier will usually not pass them on its own: it says the sequence can't be verified and escalates. That is the intended live demo. The balance stays held, and the PM reviews the evidence and either requests a redo or clicks **Approve anyway**, which pays the balance and logs the override next to the original verdict. Phone photos that keep EXIF, taken in order on the same fixture, pass and pay automatically.

## License

MIT
