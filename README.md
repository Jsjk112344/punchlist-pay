# Punchlist Pay — Front end

A fixture-first Next.js 15 UI for the PayPal AI Hackathon. Designed to make **promised → proven → paid** visible across the PM ledger, work-order story and a 390px contractor flow.

## Start (under 10 minutes)

```bash
npm install
npm run dev
```

Open `http://localhost:3000/?fixture=1` and choose **Property manager** or **Mike's Plumbing**. Open both in the same browser origin to demonstrate cross-window fixture updates. `npm run smoke` validates fixture amounts and review conditions. `npm run typecheck` validates TypeScript; `npm run build` builds the app.

## Routes

- `/` — two-role sign-in switcher (no auth)
- `/dashboard?fixture=1` — PM dashboard, new request, ledger, property grouping
- `/work-orders/wo-1042?fixture=1` — funded kitchen-sink job; negotiation + money rail
- `/work-orders/wo-1041?fixture=1` — cleaning job: wrong unit, low trust, **Request redo**
- `/m/mike?fixture=1` — contractor jobs and full mobile payout path
- `/m/mike?job=wo-1042&fixture=1` — direct phone demo state

## Fixture mode vs live mode

`?fixture=1` is **sandbox demonstration data**, not a PayPal transaction. All payment IDs prefixed with `FIXTURE-` are synthetic. The seeded sample PayPal-looking object IDs are also fictional and **not evidence of PayPal sandbox activity**. Fixture state persists in localStorage; dashboard and phone poll same-origin changes. The `Reset demo` action returns to the initial 7 job fixtures.

`?fixture=0` calls the endpoint names and request bodies from `PLAN.md` using **fixture route stubs** bundled in `app/api/` until the real backend replaces them: `POST /api/work-orders` with `{text}`, `POST /api/work-orders/:id/negotiate` with `{contractor_id}`, multipart `POST /api/work-orders/:id/proofs`, `POST /api/work-orders/:id/verify`, `POST /api/work-orders/:id/decision` with `{action}`, `POST /api/payouts` with `{work_order_id,amount_cents,kind}`, and `GET /api/ledger` every 3s. The route stubs return `X-Punchlist-Mode: fixture`; they do **not** process real PayPal payments or call Claude. The client preserves the PLAN.md request/response contract. Response-envelope details, EXIF capture, Claude verification, signature checking, and PayPal authorization/capture/payout writes are marked `TODO(api)` pending the real back end. The backend owns all authorization/capture/payout logic. **Never show a paid state in live mode without a confirmed ledger update.**

## System boundaries

- `lib/types.ts`: view model projected from the `PLAN.md` schema, not a replacement for Drizzle models.
- `lib/api.ts`: typed client wrappers for the exact existing routes and payloads.
- `lib/store.ts`: fixture-only event store and cross-tab refresh.
- `lib/demo.ts`: deterministic, explicitly simulated check-in and payout transitions.
- `fixtures/`: scene data, negotiation transcript, verifier pass/fail, vector proof illustrations.
- `components/`: shadcn-style controls, AG Grid Quartz, evidence/verdict/money layouts.

AG Grid **Community** does not include Enterprise row grouping or Enterprise master/detail. This UI uses synthetic group header rows and **full-width detail rows**, both available in Community. CSV export is native Community functionality. Only status/verdict/money changes animate.

## Safety and limits

The real backend must enforce the PLAN guardrail: no automatic payment on a **fail** or confidence **below 0.8**; verify PayPal webhooks and use idempotency keys for each write. The UI does not claim that local fixture payouts represent a sandbox response. These vector “photos” are visual fixtures. Replace them with real EXIF-preserving phone images for the actual demo.

This archive contains the requested source, route-contract fixture stubs, 7 seeded work orders, vector proof fixtures, 10-line UI component map, timestamped demo script, and a Playwright screenshot runner (`scripts/capture.py`). The original `PLAN.md` lives in your file library; its API contracts are reflected in this code, but the original file is not copied into the ZIP. **Not verified in a running Next.js browser here:** package installation is blocked by unavailable npm registry access; therefore `docs/assets/` deliberately contains no falsely attributed app screenshots. Run the demo-script checklist at 1440×900 and 390×844 after installing dependencies.
