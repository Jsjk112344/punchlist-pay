# How Punchlist Pay meets the technology requirement

**Punchlist Pay runs live on the PayPal sandbox and uses Anthropic's Claude for every decision.** The agents decide, PayPal moves the money, and code rules decide when money is allowed to move.

## PayPal developer platform (sandbox)

- **REST OAuth 2.0 (client credentials):** server-side access tokens, cached and refreshed (`lib/paypal/client.ts`). Every write sends a `PayPal-Request-Id`, so retries are idempotent.
- **Orders API v2, `intent: AUTHORIZE`:** when the agents agree a price, the Dispatcher agent's `create_authorize_order` tool creates a PayPal order for exactly that amount. Funds are held, not taken.
- **PayPal JavaScript SDK (Buttons):** the property manager approves and funds the order with the PayPal button on the work-order page.
- **Payments API v2 (authorize / capture):** the approved order is authorized when funded. The authorization is captured only when the first non-deposit release happens, after the AI's verdict passes or the manager approves.
- **Payouts API v1:** sends the contractor a deposit when they check in on site, and the balance when the proof passes. Each batch's `sender_batch_id` is `<work order>:<kind>`, so a payout can never be sent twice. Payout status is polled until PayPal confirms it, and only then does the app show it as paid.
- **Webhooks + verify-webhook-signature:** `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.SUCCESS` and `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/FAILED` are verified and de-duplicated. A 3-second reconciliation poll settles everything when webhooks aren't configured, as on the live demo.
- **Sandbox accounts:** a business account (the platform), a personal account for the property manager who funds orders, and three personal accounts for the contractors who receive payouts.

## AI: Anthropic Claude (`claude-sonnet-5-5`, Claude API via the official TypeScript SDK)

- **Dispatcher agent (structured outputs):** turns a plain-English request ("4B kitchen sink leaking, fix today, under $250") into a work order with a unit, budget, deadline and exactly three acceptance criteria. Each criterion must be checkable from a photo, a receipt or a timestamp.
- **Negotiation agents (two separate Claude conversations, strict tool use):** one agent represents the property manager and one the contractor, the latter using the contractor's real rates. Every turn is a tool call (counter, agree or walk away). On agreement, the Dispatcher calls `create_authorize_order`, which the server executes against the PayPal Orders API.
- **Verifier (Claude vision + structured outputs):** reads the check-in photo, after photo and receipt against the contract criteria. It returns a verdict per criterion with quoted evidence (for example "Receipt total reads $41.07") and a confidence score. It's calibrated with labelled reference photos of good and bad work, sent with prompt caching, and was scored on 58 held-out photos: 53 correct, and zero pieces of bad work marked as done.

## How they connect

The AI's verdict decides whether PayPal releases money, but never on its own. Code enforces the rules: no capture or payout on a fail or below 0.8 confidence, proof photos must be taken after check-in, payouts can never exceed the agreed price, a human funds every order, and any manager override is logged next to the original verdict.
