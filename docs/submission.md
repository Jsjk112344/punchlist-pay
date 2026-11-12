# Devpost submission

**Tagline:** AI agents scope, negotiate and verify maintenance jobs, and PayPal pays the contractor the moment the work is proven.

**Live demo:** https://punchlist-pay.onrender.com · **Repo:** https://github.com/Jsjk112344/punchlist-pay

## Inspiration

I'm from Singapore, where almost everyone has a renovation or repair story, and most of them aren't good ones. Homeowners pay up front for work that turns out half-done: a leak "fixed" that drips again a week later, a hinge screwed into a splintered frame, grout that cracks before the paint is dry. When you complain, it's your word against the contractor's, and the money has already left your account. It isn't just anecdotes: in 2024 the Consumers Association of Singapore (CASE) received **962 complaints about renovation contractors**, and renovation had the **largest prepayment losses of any industry, about S\$728,000**.

The other side is just as broken. Good contractors finish the job properly and then wait to be paid, chasing invoices and arguing over whether the work was "done". Singapore even has a law for it, the Security of Payment Act, because contractors not getting paid on time is common enough to need one.

I'm now in the US on a short-term programme, so I looked at the same problem here, and found it from the contractor's side. In Rabbet's 2024 survey, **82% of US contractors waited more than 30 days to get paid**. Its 2025 report found 88% had declined to bid for clients with a slow-pay reputation, and that slow payments cost US construction an estimated **\$299B** that year. That's why Punchlist Pay is built for US property managers and contractors first, with PayPal's sandbox in US dollars.

Both problems come from the same gap: **nobody agrees on what "done" means before the work starts, and nobody checks the proof when it ends.** So homeowners pay for bad work, and contractors wait for good work to be believed.

Punchlist Pay closes that gap: agree on what "done" looks like up front, check the proof the moment it arrives, and release the money as soon as it holds up, but not before.

## What it does

A property manager types a request in plain English, such as *"4B kitchen sink leaking under the cabinet, fix today, under \$250"*. Then:

1. **Scope:** a Claude *Dispatcher* agent turns it into a work order with a unit, budget, deadline and exactly three acceptance criteria. Each one must be checkable from a photo, a receipt or a timestamp. Vague words like "workmanlike" are rejected.
2. **Negotiate:** two separate Claude agents negotiate the job, ours for the manager and one for the contractor, which knows the contractor's real rates. Every turn is a tool call: counter, agree or walk away. On agreement, our agent creates a **PayPal order with AUTHORIZE intent** for exactly the agreed price.
3. **Fund:** the manager approves it in PayPal. The money is **held, not taken**.
4. **Check in:** the contractor checks in on site with a photo, which releases a deposit through **PayPal Payouts**.
5. **Prove:** the contractor uploads an after photo and a receipt. A Claude *Verifier* checks each criterion against the images and quotes what it sees ("Receipt total reads \$41.07").
6. **Pay or escalate:** on a confident pass, the authorization is captured and the balance is paid out in seconds. On a fail or low confidence, nothing moves and the job goes to the manager with the evidence side by side.

The payout rule is enforced in code, whatever the model says:

$$
\text{auto-pay} \iff \text{verdict} = \texttt{pass} \;\land\; c \ge 0.8 \;\land\; t_{\text{proof}} > t_{\text{check-in}}
$$

where $c$ is the Verifier's confidence. The deposit is a fixed share $d$ of the agreed price $P$, and nothing can ever pay out more than what's left:

$$
\text{deposit} = d \cdot P, \qquad \text{balance} = P - \text{deposit}, \qquad \sum \text{payouts} \le P
$$

## How we built it

- **Next.js 15 + React 19 + TypeScript**, with **Drizzle** on Postgres, or embedded PGlite locally so it runs with zero setup.
- **PayPal:** Orders v2 (AUTHORIZE intent), Payments v2 authorize, capture and void, **Payouts v1** for the deposit and balance, the JS SDK button for funding, and signed webhooks. Every write sends a `PayPal-Request-Id`, and each payout's `sender_batch_id` is `<work order>:<kind>`, so a retry can never pay twice. A payout only shows as paid after PayPal confirms it.
- **Claude** (`claude-sonnet-5-5`): structured outputs for the Dispatcher and Verifier, and strict tool calls for the negotiation. The Dispatcher's `create_authorize_order` tool is executed server-side against PayPal, so the agent really moves money, inside guardrails.
- **Teaching the Verifier what good work looks like:** you can't fine-tune Claude through the API, so we built a library of labelled photos from Wikimedia Commons and Unsplash: good and bad hinges, grout, plumbing, drywall and cleaning. A few are shown to the Verifier as reference examples, and **58 are held out** for an evaluation script. On those, it got 53 of 58 right, and **marked zero pieces of bad work as done**.
- **AG Grid** is the ledger, where every payout meets its proof. Each row shows the after photo and verdict, a proof-to-pay timer, live pinned totals of held and paid, quick search and grouping. Cells flash green when PayPal confirms a payment.
- **Render** hosts everything from one Blueprint: the web service plus Render Postgres, with migrations and seed data at boot.

## Challenges we ran into

- **The agent toolkit couldn't do what we needed.** PayPal's Agent Toolkit had no authorize-then-capture and no Payouts, so we wrapped the REST APIs as the agent's own strict tools instead.
- **Making the AI strict without making it useless.** Early prompts happily passed blurry photos. We added per-criterion evidence quotes, reference examples and a held-out eval, so we could measure whether a change made the Verifier better or just more agreeable.
- **Proof is only proof if it's in order.** A photo taken *before* check-in proves nothing. We read EXIF capture times and fail any proof that predates check-in. In our demo, the sample photos have no EXIF, so the Verifier honestly refuses to pass them and the manager approves with a logged override. We kept that in the demo on purpose.
- **Money must never move twice.** Retries, webhooks and polling can all report the same payout. Idempotent request ids, de-duplicated webhook events and a 3-second reconciliation poll keep the ledger correct even without webhooks.

## What we learned

- The best use of an AI agent in payments is **deciding**, not **paying**. Claude scopes, negotiates and judges; PayPal and plain code move the money; and a human funds every order.
- "Done" has to be defined *before* the work starts. Once the criteria are concrete (dry pipes, receipt under \$100, before 6 PM), checking them is fast, and both sides can trust the result.
- An evaluation set changes how you build. Without held-out photos, every prompt tweak *felt* like an improvement.

## What's next

- Contractor ratings built from verified jobs, not reviews.
- Partial payouts for partially finished work, and multi-currency payouts. Payouts already support currency codes, which matters for cross-border contractors in Southeast Asia.
- Bringing it home: piloting with property managers and renovation firms in Singapore, where paying in stages against verified proof would protect homeowners' prepayments.
