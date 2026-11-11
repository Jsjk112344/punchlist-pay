"""Render the Devpost image gallery (3:2, 2700x1800 JPG) from screenshots of a recorded take.

    python scripts/video/gallery.py --src <dir of screenshots> --out docs/gallery

Expects in --src: draft, negotiation, fund, review, approved (.jpg desktop frames from a take),
p_job, p_ready, p_verify, p_paid (.jpg phone frames), grid-expanded, door (.png 2x captures).
"""

import argparse
import asyncio
import base64
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
W, H = 1800, 1200
FONT = (ROOT / "docs/video/fonts/InterVariable.woff2").as_uri()
LOGO = '<span class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16 9.4"/></svg></span>'

CSS = f"""
@font-face{{font-family:Inter;src:url('{FONT}')}}
*{{box-sizing:border-box}}html,body{{margin:0;font-family:Inter,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}}
.s{{width:{W}px;height:{H}px;position:relative;overflow:hidden;background:#F3F6FB;color:#172336}}
.dark{{background:#172336;color:#F8FAFC}}
.brand{{position:absolute;top:64px;left:90px;display:flex;align-items:center;gap:14px;font-size:28px;font-weight:700;letter-spacing:-.04em}}
.logo{{width:46px;height:46px;border-radius:12px;background:#2259D5;display:grid;place-items:center}}.logo svg{{width:28px;height:28px}}
.big .logo{{width:84px;height:84px;border-radius:22px}}.big .logo svg{{width:52px;height:52px}}
.kicker{{font-size:20px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2259D5}}
.dark .kicker{{color:#8DB0FF}}
.head{{position:absolute;top:140px;left:90px;right:90px}}
.head h2{{margin:14px 0 0;font-size:54px;line-height:1.1;letter-spacing:-.045em;font-weight:720}}
.head p{{margin:14px 0 0;font-size:25px;line-height:1.45;color:#667386;max-width:1400px}}
.dark .head p{{color:#A9B6C8}}
.shotl{{display:flex;flex-direction:column;padding:140px 90px 64px}}
.shotl .head{{position:static}}
.shotl .frame{{position:relative;left:auto;right:auto;bottom:auto;flex:1;min-height:0;margin-top:34px}}
.frame{{position:absolute;left:90px;right:90px;bottom:70px;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(23,35,54,.18);border:1px solid #DCE3EC;background:#fff}}
.frame img{{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}}
.phones{{position:absolute;left:90px;right:90px;top:340px;display:flex;justify-content:space-between}}
.phone{{width:360px;text-align:center}}
.phone .dev{{height:720px;border-radius:52px;background:#172336;padding:12px;box-shadow:0 30px 70px rgba(23,35,54,.22)}}
.phone .dev img{{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:42px;display:block}}
.phone b{{display:block;margin-top:24px;font-size:24px;letter-spacing:-.02em}}
.phone span{{display:block;margin-top:6px;font-size:19px;color:#667386}}
.stats{{position:absolute;left:90px;right:90px;top:380px;display:grid;grid-template-columns:repeat(3,1fr);gap:56px}}
.stat strong{{display:block;font-size:150px;line-height:1;letter-spacing:-.06em;font-weight:760;color:#8DB0FF}}
.stat p{{font-size:31px;line-height:1.35;margin:24px 0 12px}}
.stat small{{font-size:20px;color:#A9B6C8}}
.source{{position:absolute;left:90px;bottom:70px;font-size:20px;color:#A9B6C8}}
.flow{{position:absolute;left:90px;right:90px;top:430px;display:grid;grid-template-columns:repeat(6,1fr);gap:18px}}
.step{{background:#fff;border:1px solid #DCE3EC;border-radius:22px;padding:34px 26px 80px;min-height:540px;position:relative;box-shadow:0 14px 40px rgba(23,35,54,.07)}}
.step .n{{width:46px;height:46px;border-radius:50%;background:#2259D5;color:#fff;display:grid;place-items:center;font-weight:700;font-size:21px}}
.step b{{display:block;margin-top:24px;font-size:31px;letter-spacing:-.03em}}
.step p{{margin:14px 0 0;font-size:22px;line-height:1.45;color:#667386}}
.step .who{{position:absolute;left:24px;bottom:26px;font-size:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2259D5}}
.step.money .n{{background:#16804C}}.step.money .who{{color:#16804C}}
.grid{{position:absolute;left:90px;right:90px;top:420px;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}}
.box{{border:1px solid #2E3E57;border-radius:22px;padding:28px 30px 30px}}
.box b{{display:block;font-size:31px;letter-spacing:-.03em;margin-bottom:10px}}
.box p{{margin:0;font-size:22px;line-height:1.5;color:#A9B6C8}}
.cover h1{{font-size:104px;line-height:1.02;letter-spacing:-.06em;margin:0;font-weight:760}}
.cover .tag{{font-size:32px;line-height:1.4;color:#A9B6C8;margin-top:30px;max-width:720px}}
.paid{{color:#4ADE80}}.light .paid{{color:#16804C}}
.pill{{display:inline-block;margin-top:40px;padding:12px 22px;border-radius:999px;background:#22314A;font-size:20px;font-weight:600;color:#C9D6EA}}
.tilt{{position:absolute;border-radius:18px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.45);border:1px solid #2E3E57}}
.tilt img{{display:block;width:100%}}
.callout{{position:absolute;background:#172336;color:#fff;border-radius:16px;padding:16px 22px;font-size:21px;line-height:1.35;box-shadow:0 18px 40px rgba(23,35,54,.3);max-width:380px}}
.callout b{{color:#8DB0FF}}
"""


def img(src: Path):
    mime = "image/png" if src.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(src.read_bytes()).decode()}"


def brand(dark=False):
    return f'<div class="brand">{LOGO}Punchlist Pay</div>'


def shot(kicker, title, sub, src, height=820, pos="top center", extra=""):
    return (f'<div class="s shotl">{brand()}<div class="head"><div class="kicker">{kicker}</div><h2>{title}</h2><p>{sub}</p></div>'
            f'<div class="frame"><img src="{img(src)}" style="object-position:{pos}"></div>{extra}</div>')


def slides(src: Path):
    s = {}
    s["01-cover"] = (f'<div class="s dark cover"><div class="brand">{LOGO}Punchlist Pay</div>'
                     f'<div style="position:absolute;left:90px;top:300px;width:760px"><div class="kicker">PayPal + Claude</div><h1 style="margin-top:22px">Promised.<br>Proven.<br><span class="paid">Paid.</span></h1>'
                     f'<div class="tag">AI agents scope, negotiate and verify maintenance jobs. PayPal pays the contractor the moment the work is proven.</div></div>'
                     f'<div class="tilt" style="left:880px;top:290px;width:840px;transform:rotate(-2deg)"><img src="{img(src / "approved.jpg")}"></div>'
                     f'<div class="tilt" style="left:1420px;top:560px;width:260px;border-radius:38px;border:9px solid #0E1726;transform:rotate(3deg)"><img src="{img(src / "p_paid.jpg")}"></div></div>')
    s["02-problem"] = (f'<div class="s dark">{brand(True)}<div class="head"><div class="kicker">The problem</div><h2>Contractors do the work. Then they wait to get paid.</h2>'
                       f'<p>Payment is slow because proof is slow: photos, invoices, and someone checking them before any money moves.</p></div>'
                       f'<div class="stats"><div class="stat"><strong>82%</strong><p>of US contractors wait more<br>than 30 days to get paid</p><small>2024 · up from 49% in 2022</small></div>'
                       f'<div class="stat"><strong>88%</strong><p>declined to bid for clients<br>with a slow-pay reputation</p><small>2025</small></div>'
                       f'<div class="stat"><strong>$299B</strong><p>cost of slow payments<br>to US construction</p><small>2025 · a hidden 14% tax</small></div></div>'
                       f'<div class="source">Source: Rabbet, 2024 and 2025 Construction Payments Reports</div></div>')
    steps = [("1", "Scope", "Plain English becomes a work order with three checkable criteria.", "Claude Dispatcher", ""),
             ("2", "Negotiate", "Two agents agree a price. Ours creates the PayPal order.", "Claude agents", ""),
             ("3", "Fund", "The manager approves. Funds are authorized and held.", "PayPal Orders", "money"),
             ("4", "Check in", "A photo on site releases the deposit.", "PayPal Payouts", "money"),
             ("5", "Prove", "After photo and receipt, checked criterion by criterion.", "Claude Verifier", ""),
             ("6", "Pay", "Pass: capture and pay the balance. Fail: hold and escalate.", "PayPal Payouts", "money")]
    s["03-how-it-works"] = (f'<div class="s">{brand()}<div class="head"><div class="kicker">How it works</div><h2>From a text about a leak to a paid contractor.</h2>'
                            f'<p>Claude decides. PayPal moves the money. Hard rules in code decide when it is allowed to.</p></div><div class="flow">'
                            + "".join(f'<div class="step {c}"><div class="n">{n}</div><b>{t}</b><p>{d}</p><div class="who">{w}</div></div>' for n, t, d, w, c in steps)
                            + "</div></div>")
    s["04-scope"] = shot("Step 1 · Scope", "Plain English in. A checkable work order out.",
                         "The Dispatcher sets unit, budget and deadline, and three criteria a photo, a receipt or a timestamp can prove.", src / "draft.jpg")
    s["05-negotiate"] = shot("Step 2 · Negotiate", "Two Claude agents negotiate the job.",
                             "Ours works for the manager; Mike's knows his real rates. On agreement, our agent creates a PayPal order for exactly that price.", src / "negotiation.jpg", pos="center 75%")
    s["06-fund"] = shot("Step 3 · Fund with PayPal", "Authorized and held. Not captured, not yet paid.",
                        "The manager approves the order with the PayPal button. Money is captured only when the proof passes or the manager approves.", src / "fund.jpg", pos="center 70%")
    phones = [("p_job.jpg", "Check in", "Photo on site releases the deposit"), ("p_ready.jpg", "Prove", "After photo and receipt"),
              ("p_verify.jpg", "Verify", "Claude checks each criterion"), ("p_paid.jpg", "Paid", "Straight to his PayPal")]
    s["07-contractor"] = (f'<div class="s">{brand()}<div class="head"><div class="kicker">Steps 4–6 · The contractor\'s phone</div><h2>Check in, prove it, get paid.</h2>'
                          f'<p>No invoice to send and no one to chase.</p></div><div class="phones">'
                          + "".join(f'<div class="phone"><div class="dev"><img src="{img(src / f)}"></div><b>{t}</b><span>{d}</span></div>' for f, t, d in phones) + "</div></div>")
    s["08-verdict"] = shot("Step 5 · Verify", "Claude quotes its evidence for every criterion.",
                           "Here it read the $41.07 receipt and saw dry pipes, but the sample photos had no timestamps. So nothing paid itself: the job went to the manager.", src / "review.jpg")
    s["09-paid"] = shot("Step 6 · Decide and pay", "The manager decides. PayPal pays. Every step is logged.",
                        "The override is recorded next to the original verdict. The authorization is captured and the deposit and balance go out as PayPal payouts.", src / "approved.jpg")
    s["10-caught"] = shot("Guardrails", "Wrong unit, photo taken before check-in. Nothing paid.",
                          "No automatic payment on a fail or below 0.8 confidence. Proof must postdate check-in. The manager can request a redo.", src / "door.png", pos="top center")
    s["11-ag-grid"] = shot("AG Grid ledger", "Every payout, tied to the proof that released it.",
                           "Proof thumbnails and verdicts per row, proof-to-pay timing, pinned live totals, quick search, grouping, and cells that flash when PayPal confirms.", src / "grid-expanded.png", pos="center 32%")
    boxes = [("PayPal", "Orders v2 with AUTHORIZE intent, capture on first release, Payouts for the deposit and balance, JS SDK button, signed webhooks, idempotent request ids."),
             ("Claude", "Dispatcher with structured outputs, two negotiating agents with strict tool calls, a vision Verifier calibrated with labelled reference photos."),
             ("Hard rules", "No pay on a fail or below 0.8 confidence. Proof must postdate check-in. Payouts never exceed the agreed price. Overrides are logged."),
             ("AG Grid", "The ledger: custom renderers, pinned totals, quick filter, expandable rows, grouping, live cell flash."),
             ("Render", "One Blueprint: Next.js web service plus Render Postgres. Migrations and seed run at boot."),
             ("Stack", "Next.js 15, React 19, TypeScript, Drizzle on Postgres (PGlite locally), Tailwind.")]
    s["12-architecture"] = (f'<div class="s dark">{brand(True)}<div class="head"><div class="kicker">Built with</div><h2>Agents decide. PayPal moves the money.<br>Code holds the leash.</h2></div><div class="grid">'
                            + "".join(f'<div class="box"><b>{t}</b><p>{d}</p></div>' for t, d in boxes) + "</div></div>")
    s["13-try-it"] = (f'<div class="s light big" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">'
                      f'{LOGO}<h1 style="font-size:110px;letter-spacing:-.06em;margin:40px 0 0;font-weight:760">Promised. Proven. <span class="paid">Paid.</span></h1>'
                      f'<div style="font-size:34px;color:#667386;margin-top:36px;line-height:1.6">punchlist-pay.onrender.com<br>github.com/Jsjk112344/punchlist-pay</div></div>')
    return s


async def main(args):
    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1.5)
        for name, body in slides(src).items():
            await page.set_content(f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>{body}')
            await page.evaluate("document.fonts.ready")
            await page.wait_for_timeout(200)
            await page.screenshot(path=str(out / f"{name}.jpg"), type="jpeg", quality=88)
            print(name)
        await b.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default=str(ROOT / "docs/gallery"))
    asyncio.run(main(ap.parse_args()))
