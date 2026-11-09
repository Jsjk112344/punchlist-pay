# Punchlist Pay demo — 2:45 (fixture dry-run)

Use desktop 1440×900 and phone 390×844, preferably two windows of the same browser origin. Start `npm run dev`, then visit `/dashboard?fixture=1`. Click **Reset demo** once. Phone window: `/m/mike?fixture=1`.

| Video time | Screen | Exact action | What must be visible |
| --- | --- | --- | --- |
| 00:00–00:15 | Desktop dashboard | Show Ledger and three stats | Paid this week **$1,284.00**, verify→pay **74s**, one review |
| 00:15–00:30 | Desktop | **New request** → paste `4B kitchen sink leaking under the cabinet, fix today, under $250` → **Create work order** | Structured **$220.00** draft and 3 criteria appear in card |
| 00:30–00:54 | Desktop | **Invite contractor** | Thread: **$260.00** counter → **$240.00 by 4 PM**, agreement and authorized PayPal order; money rail **Held $240.00** |
| 00:54–01:12 | Phone | Open newest **Kitchen sink leak** → **Check in** | Deposit **$48.00** paid, desktop ledger updates **In progress** |
| 01:12–01:38 | Phone | **After photo → Use sample**, **Receipt → Use sample**, **Submit proof** | Three checks stagger, then **Paid $240.00**, “Sent to your PayPal” |
| 01:38–02:02 | Desktop | Open same work order → expand **Proof** | After photo + **$41.07** receipt beside **PASS 93%**, rail **Held $0.00 / Paid $240.00** and payout batch IDs |
| 02:02–02:27 | Desktop | Return Ledger → **Needs review** filter → open **Move-out cleaning** | Expected **4B** vs found **4C**, EXIF predates check-in, no money paid → **Request redo** |
| 02:27–02:45 | Desktop | Return Ledger → **All** | Funded → verified → paid in seconds, proof tied to transfers |

## Screenshot checklist (real app, not illustrative previews)

At **1440×900**: `desktop-switcher.png`, `desktop-dashboard.png`, `desktop-new-request.png`, `desktop-negotiation.png`, `desktop-checkin-ledger.png`, `desktop-verdict.png`, `desktop-review.png`, `desktop-redo.png`.

At **390×844**: `mobile-jobs.png`, `mobile-job-funded.png`, `mobile-proof-upload.png`, `mobile-verifying.png`, `mobile-paid.png`, `mobile-review.png`.

Save into `docs/assets/` using browser screenshots. Do not label any screenshot as route-verified until the Next.js app has been installed, served and clicked through. The provided archive is source-only and has not passed this browser QA in the offline environment.
