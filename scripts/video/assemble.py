"""Cut a take from scripts/video/record.py into the submission video.

    python scripts/video/assemble.py --take <dir> --out docs/video

Writes punchlist-pay.mp4 (guide captions burned in), punchlist-pay-clean.mp4, captions.srt,
narration.txt and timeline.json. Silent: the voice-over is recorded on top, following narration.txt.
Cards, step labels and captions are HTML rendered with Playwright (this ffmpeg build has no text filters).
"""

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
FPS = 30
W, H = 1920, 1080
FONT = (ROOT / "docs/video/fonts/InterVariable.woff2").as_uri()

CSS = f"""
@font-face{{font-family:Inter;src:url('{FONT}')}}
*{{box-sizing:border-box}}html,body{{margin:0;background:transparent;font-family:Inter,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}}
.card{{width:{W}px;height:{H}px;background:#F8FAFC;color:#172336;display:flex;flex-direction:column;justify-content:center;padding:0 170px;position:relative;overflow:hidden}}
.card.dark{{background:#172336;color:#F8FAFC}}
.brand{{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700;letter-spacing:-.04em;position:absolute;top:84px;left:170px}}
.dark .brand{{color:#F8FAFC}}
.logo{{width:54px;height:54px;border-radius:14px;background:#2259D5;display:grid;place-items:center}}
.logo svg{{width:32px;height:32px}}
h1{{font-size:96px;line-height:1.08;letter-spacing:-.055em;font-weight:720;margin:0;max-width:1500px}}
h2{{font-size:64px;line-height:1.15;letter-spacing:-.045em;font-weight:680;margin:0;max-width:1500px}}
.sub{{font-size:38px;line-height:1.45;color:#667386;margin-top:36px;max-width:1450px;letter-spacing:-.015em}}
.dark .sub{{color:#A9B6C8}}
.kicker{{font-size:24px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2259D5;margin-bottom:34px}}
.dark .kicker{{color:#8DB0FF}}
.text{{font-size:30px;color:#A9B6C8;margin-top:24px}}
.msg{{display:inline-block;background:#fff;border:1px solid #E5EAF0;border-radius:28px 28px 28px 8px;padding:34px 44px;font-size:52px;letter-spacing:-.03em;font-weight:560;box-shadow:0 20px 50px rgba(23,35,54,.08);margin-top:24px}}
.flow{{display:flex;align-items:center;gap:26px;margin-top:70px;font-size:44px;font-weight:680;letter-spacing:-.03em}}
.flow span.arrow{{color:#2259D5}}.paid{{color:#16804C}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:64px}}
.box{{border:1px solid #2E3E57;border-radius:22px;padding:34px 34px 38px}}
.box b{{display:block;font-size:34px;letter-spacing:-.03em;margin-bottom:16px}}
.box p{{margin:0;font-size:25px;line-height:1.55;color:#A9B6C8}}
.pill{{position:absolute;left:44px;top:40px;background:#172336;color:#fff;border-radius:999px;padding:14px 26px;font-size:24px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 10px 30px rgba(23,35,54,.25)}}
.pill em{{font-style:normal;color:#8DB0FF;margin-right:12px}}
.cap{{position:absolute;left:0;right:0;bottom:64px;display:flex;justify-content:center}}
.cap div{{background:rgba(15,23,36,.82);color:#fff;font-size:36px;line-height:1.38;font-weight:560;letter-spacing:-.01em;padding:14px 28px;border-radius:14px;text-align:center;max-width:1500px}}
.stage{{width:{W}px;height:{H}px;background:#EEF2F7;position:relative;overflow:hidden}}
.stage .side{{position:absolute;left:170px;top:0;bottom:0;width:820px;display:flex;flex-direction:column;justify-content:center}}
.stage h2{{font-size:66px}}
.stage .who{{display:flex;align-items:center;gap:16px;font-size:28px;font-weight:650;color:#667386;margin-bottom:30px}}
.stage .who i{{width:46px;height:46px;border-radius:50%;background:#2259D5;display:grid;place-items:center}}
.device{{position:absolute;left:{1130 - 16}px;top:{(H - 978) // 2 - 16}px;width:{452 + 32}px;height:{978 + 32}px;border-radius:64px;background:#172336;box-shadow:0 40px 90px rgba(23,35,54,.28)}}
"""
LOGO = '<span class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16 9.4"/></svg></span>'
WRENCH = '<i><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L22 13.6 13.6 22l-2.3-2.3a4 4 0 0 0-5-5L3 11.4 11.4 3z"/></svg></i>'
PHONE_X, PHONE_Y, PHONE_W, PHONE_H = 1130, (H - 978) // 2, 452, 978


def html(body):
    return f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>{body}'


def money(cents):
    return f"${cents / 100:,.2f}".replace(".00", "")


def facts(take):
    o = json.loads((take / "order.json").read_text())
    offers = [t for t in o["negotiation"] if t["role"] in ("dispatcher", "contractor") and t.get("offer_cents")]
    counter = next((t["offer_cents"] for t in offers if t["role"] == "contractor"), None)
    first = next((t["offer_cents"] for t in offers if t["role"] == "dispatcher"), None)
    return {
        "price": money(o["contract"]["price_cents"]),
        "first": money(first) if first else "",
        "counter": money(counter) if counter else "",
        "deposit": money(next(p["amount_cents"] for p in o["payouts"] if p["kind"] == "deposit")),
        "balance": money(next(p["amount_cents"] for p in o["payouts"] if p["kind"] != "deposit")),
        "pct": o["contract"]["deposit_pct"],
        "verdict": o["verdict"]["verdict"],
        "confidence": round(o["verdict"]["confidence"] * 100),
        "turns": len(offers),
    }


def beats(f):
    """Each beat: shots in order, one step label, and narration (each sentence becomes one or more captions)."""
    neg = f"They settle at {f['price']} in {f['turns']} turns" + (f", after a {f['counter']} counter" if f["counter"] else "") + "."
    escalated = f["verdict"] != "pass"
    decide = (
        "It reads the receipt and sees dry pipes. But these sample photos carry no timestamps, and it can't confirm it's the same cabinet as the check-in. "
        "So nothing pays itself. The rules in code hold the balance and send the job to the manager with the evidence."
        if escalated else
        "Every criterion is met, with quoted evidence, above the confidence bar."
    )
    pay = (
        f"The manager approves it. That override is logged next to the original verdict. The authorization is captured, and the {f['balance']} balance goes out as a PayPal payout, confirmed by PayPal."
        if escalated else
        f"So the authorization is captured, and the {f['balance']} balance goes out as a PayPal payout, confirmed by PayPal. No invoice, no waiting."
    )
    return [
        dict(label=None, shots=[("card", "hook", 6.5)],
             text="A tenant texts the property manager: the kitchen sink in 4B is leaking."),
        dict(label=None, shots=[("card", "problem", 11.0)],
             text="Today that means phoning around for a plumber, chasing a photo, and processing an invoice. The manager does the paperwork. The plumber waits weeks to be paid."),
        dict(label=None, shots=[("card", "thesis", 6.0)],
             text="Punchlist Pay pays the contractor the moment the work is proven."),
        dict(label=(1, "Scope the job"), shots=[("desk", "dash", "invite", 1.25)],
             text="The manager types the request in plain English. Claude turns it into a work order: the unit, a budget, a deadline, and three criteria that a photo, a receipt or a timestamp can prove."),
        dict(label=(2, "Agents negotiate"), shots=[("desk", "invite", "negotiation_page", 3.0), ("desk", "negotiation_page", "paypal_ready", 1.15)],
             text=f"Then two Claude agents negotiate. Ours works for the manager. Mike's agent knows his real rates. {neg} Our agent then creates a PayPal order for exactly that amount."),
        dict(label=(3, "Fund with PayPal"), shots=[("desk", "paypal_ready-1", "paypal_popup+1.2", 1.0), ("desk", "funded_view", "funded_view+3", 1.0)],
             text="The manager approves it in PayPal. The money is authorized and held. Not captured, and not yet paid."),
        dict(label=(4, "Check in"), shots=[("phone", "phone_jobs", "checked_in", 1.1, "Mike's phone", "On site, Mike checks in with a photo."), ("phone", "checked_in", "deposit_paid", 4.0, "Mike's phone", "20% deposit, paid by PayPal Payouts."), ("phone", "deposit_paid", "deposit_paid+1.5", 1.0, "Mike's phone", "20% deposit, paid by PayPal Payouts.")],
             text=f"On site, Mike checks in with a photo. That releases the {f['pct']}% deposit, {f['deposit']}, through PayPal Payouts."),
        dict(label=(5, "Prove it"), shots=[("phone", "deposit_paid+1.5", "verdict+2.5", 1.0, "Mike's phone", "After photo and receipt go to Claude.")],
             text="When he's done, he uploads the after photo and the receipt. Claude's Verifier checks each criterion against the images and quotes what it sees."),
        dict(label=(6, "Verdict"), shots=[("desk", "review", "approve" if escalated else "paid", 1.15)],
             text=decide),
        dict(label=(6, "Verdict"), shots=[("desk", "approve" if escalated else "paid", "paid", 3.0), ("desk", "paid", "paid_view+4", 1.0), ("phone", "phone_paid", "phone_paid+3.5", 1.0, "Mike's phone", "Paid, to his PayPal.")],
             text=pay + " Mike sees it on his phone."),
        dict(label=(7, "Wrong unit, nothing paid"), shots=[("desk2", "ledger", "ledger_final", 1.2)],
             text="Here's a job that failed. A cleaner sent a photo of unit 4C, taken before check-in. The Verifier caught both. Nothing was paid, and the manager can request a redo."),
        dict(label=None, shots=[("desk2", "ledger_final", "end", 1.0)],
             text="Every payout in the ledger is tied to the proof that released it."),
        dict(label=None, shots=[("card", "arch", 11.0)],
             text="PayPal Orders, Payments and Payouts move the money. Claude scopes the job, negotiates it and verifies it. And hard rules in code decide when money is allowed to move."),
        dict(label=None, shots=[("card", "end", 5.5)],
             text="Punchlist Pay. Promised, proven, paid."),
    ]


CARDS = {
    "hook": f'<div class="card">{"<div class=brand>" + LOGO + "Punchlist Pay</div>"}<div class="kicker">Alder House · Unit 4B · 2:14 PM</div><div><span class="msg">The kitchen sink is leaking under the cabinet 💧</span></div></div>',
    "problem": f'<div class="card dark"><div class=brand>{LOGO}Punchlist Pay</div><div class="kicker">Today</div><h2>Phone around for a plumber.<br>Chase a photo. Process an invoice.</h2><div class="sub">The manager does the paperwork. The plumber waits weeks to be paid.</div></div>',
    "thesis": f'<div class="card"><div class=brand>{LOGO}Punchlist Pay</div><h1>Pay the contractor the moment<br>the work is proven.</h1><div class="flow"><span>Promised</span><span class="arrow">→</span><span>Proven</span><span class="arrow">→</span><span class="paid">Paid</span></div></div>',
    "arch": f'<div class="card dark"><div class=brand>{LOGO}Punchlist Pay</div><div class="kicker">How it works</div><h2>Agents decide. PayPal moves the money.<br>Code holds the leash.</h2><div class="grid">'
            '<div class="box"><b>PayPal</b><p>Orders v2 with AUTHORIZE intent holds the funds. Capture on the first release. Payouts for the deposit and the balance. Idempotent request ids.</p></div>'
            '<div class="box"><b>Claude</b><p>Dispatcher scopes the job. Two agents negotiate with tool calls. The Verifier reads the photos and receipt and quotes its evidence.</p></div>'
            '<div class="box"><b>Hard rules</b><p>No pay on a fail or below 0.8 confidence. Photos must postdate check-in. A human funds every order. Overrides are logged.</p></div>'
            '</div></div>',
    "end": f'<div class="card"><div class=brand>{LOGO}Punchlist Pay</div><h1>Promised. Proven. <span class="paid">Paid.</span></h1><div class="sub">github.com/Jsjk112344/punchlist-pay · PayPal sandbox + Claude</div></div>',
}


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True)


def resolve(marks, spec):
    m = re.fullmatch(r"([a-z_]+)([+-][0-9.]+)?", spec)
    return marks[m.group(1)] + float(m.group(2) or 0)


def frames_clip(take, cam, a, b, speed, out, size):
    frames = take_json(take)["cams"][cam]["frames"]
    pick = [fr for fr in frames if a <= fr[0] < b]
    before = [fr for fr in frames if fr[0] < a]
    if before:
        pick.insert(0, [a, before[-1][1]])
    lst = out.with_suffix(".txt")
    lines = []
    for i, (t, f) in enumerate(pick):
        nxt = pick[i + 1][0] if i + 1 < len(pick) else b
        lines += [f"file '{take / cam / f}'", f"duration {max(0.001, (nxt - max(t, a)) / speed):.4f}"]
    lines.append(f"file '{take / cam / pick[-1][1]}'")
    lst.write_text("\n".join(lines) + "\n")
    dur = (b - a) / speed
    ff("-f", "concat", "-safe", "0", "-i", lst, "-vf", f"fps={FPS},scale={size[0]}:{size[1]}:flags=lanczos,format=yuv420p",
       "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "fast", "-crf", "17", out)
    return dur


_TAKE = {}


def take_json(take):
    if take not in _TAKE:
        j = json.loads((take / "take.json").read_text())
        m = j["marks"]
        if "paypal_end" not in m:
            # Approved in the popup: show through the click. Approved elsewhere: show the popup opening only.
            m["paypal_end"] = m["paypal_approve"] + 2.5 if "paypal_approve" in m else m["paypal_popup"] + 3.0
            m["paypal_end"] = min(m["paypal_end"], m["paypal_closed"])
        _TAKE[take] = j
    return _TAKE[take]


async def render_png(page, body, path, transparent=False):
    await page.set_content(html(body))
    await page.evaluate("document.fonts.ready")
    await page.screenshot(path=str(path), omit_background=transparent)


def cues_for(text, start, end):
    """Split narration into caption cues (<= 2 lines of 52 chars), timed by length across [start, end]."""
    parts = []
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        lines = textwrap.wrap(sentence, 52)
        for i in range(0, len(lines), 2):
            parts.append(" ".join(lines[i:i + 2]))
    total = sum(len(p) + 12 for p in parts)
    t, out = start + 0.25, []
    usable = end - start - 0.5
    for p in parts:
        d = usable * (len(p) + 12) / total
        out.append({"start": round(t, 2), "end": round(t + d - 0.08, 2), "text": p})
        t += d
    return out


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


async def main(args):
    take = Path(args.take).resolve()
    out = Path(args.out).resolve()
    work = take / "_edit"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    marks = take_json(take)["marks"]
    f = facts(take)
    plan = beats(f)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": W, "height": H})
        segs, timeline, cues, labels = [], [], [], []
        pos = 0.0
        for bi, beat in enumerate(plan):
            b_start = pos
            for si, shot in enumerate(beat["shots"]):
                name = f"b{bi:02d}s{si}"
                seg = work / f"{name}.mp4"
                if shot[0] == "card":
                    png = work / f"{name}.png"
                    await render_png(page, CARDS[shot[1]], png)
                    dur = shot[2]
                    ff("-loop", "1", "-framerate", FPS, "-i", png, "-vf", f"fade=t=in:st=0:d=0.35,format=yuv420p", "-t", dur, "-c:v", "libx264", "-preset", "fast", "-crf", "17", seg)
                elif shot[0] in ("desk", "desk2", "paypal"):
                    a, b = resolve(marks, shot[1]), resolve(marks, shot[2])
                    dur = frames_clip(take, shot[0], a, b, shot[3], seg, (W, H))
                else:  # phone on a stage with a side title
                    a, b = resolve(marks, shot[1]), resolve(marks, shot[2])
                    raw = work / f"{name}-raw.mp4"
                    dur = frames_clip(take, "phone", a, b, shot[3], raw, (PHONE_W, PHONE_H))
                    stage, mask = work / f"{name}-stage.png", work / "mask.png"
                    await render_png(page, f'<div class="stage"><div class="side"><div class="who">{WRENCH}{shot[4]}</div><h2>{shot[5]}</h2></div><div class="device"></div></div>', stage)
                    if not mask.exists():
                        await page.set_viewport_size({"width": PHONE_W, "height": PHONE_H})
                        await render_png(page, f'<div style="width:{PHONE_W}px;height:{PHONE_H}px;background:#000"><div style="width:100%;height:100%;border-radius:50px;background:#fff"></div></div>', mask)
                        await page.set_viewport_size({"width": W, "height": H})
                    ff("-loop", "1", "-i", stage, "-i", raw, "-loop", "1", "-i", mask, "-filter_complex",
                       f"[2:v]format=gray[m];[1:v][m]alphamerge[ph];[0:v][ph]overlay={PHONE_X}:{PHONE_Y}:shortest=1,format=yuv420p",
                       "-t", f"{dur:.3f}", "-r", FPS, "-c:v", "libx264", "-preset", "fast", "-crf", "17", seg)
                segs.append(seg)
                timeline.append({"beat": bi + 1, "shot": shot[0], "spec": [str(x) for x in shot[1:4]], "start": round(pos, 2), "end": round(pos + dur, 2)})
                pos += dur
            cues += cues_for(beat["text"], b_start, pos)
            if beat["label"]:
                if labels and labels[-1]["label"] == beat["label"] and abs(labels[-1]["end"] - b_start) < 0.01:
                    labels[-1]["end"] = pos
                else:
                    labels.append({"label": beat["label"], "start": b_start, "end": pos})

        # Concatenate the clean cut
        lst = work / "concat.txt"
        lst.write_text("".join(f"file '{s}'\n" for s in segs))
        clean = work / "clean-nolabels.mp4"
        ff("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", clean)

        # Step labels go on both cuts; captions only on the captioned cut.
        async def overlays(items, kind):
            pngs = []
            for i, it in enumerate(items):
                png = work / f"{kind}-{i:03d}.png"
                body = (f'<div class="pill"><em>Step {it["label"][0]}</em>{it["label"][1]}</div>' if kind == "label"
                        else f'<div class="cap"><div>{it["text"]}</div></div>')
                await render_png(page, f'<div style="width:{W}px;height:{H}px;position:relative">{body}</div>', png, transparent=True)
                pngs.append((png, it["start"], it["end"]))
            return pngs

        label_pngs = await overlays(labels, "label")
        cap_pngs = await overlays(cues, "cap")
        await browser.close()

    def burn(src, items, dst):
        inputs, chain, last = [], [], "0:v"
        for i, (png, s, e) in enumerate(items):
            inputs += ["-i", png]
            tag = f"v{i}"
            chain.append(f"[{last}][{i + 1}:v]overlay=0:0:enable='between(t,{s:.2f},{e:.2f})'[{tag}]")
            last = tag
        ff("-i", src, *inputs, "-filter_complex", ";".join(chain) + f";[{last}]format=yuv420p[out]", "-map", "[out]",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", dst)

    out.mkdir(parents=True, exist_ok=True)
    burn(clean, label_pngs, out / "punchlist-pay-clean.mp4")
    burn(out / "punchlist-pay-clean.mp4", cap_pngs, out / "punchlist-pay.mp4")
    (out / "captions.srt").write_text("\n".join(f"{i + 1}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}\n" for i, c in enumerate(cues)))
    (out / "narration.txt").write_text("\n\n".join(f"[{srt_time(t['start'])[:8]}] " + b["text"] for b, t in zip(plan, [next(x for x in timeline if x["beat"] == i + 1) for i in range(len(plan))])) + "\n")
    (out / "timeline.json").write_text(json.dumps({"facts": f, "duration": round(pos, 2), "shots": timeline, "labels": labels}, indent=1, default=str))
    print(f"{pos:.1f}s · {len(cues)} captions · {out / 'punchlist-pay.mp4'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--take", required=True)
    ap.add_argument("--out", default=str(ROOT / "docs/video"))
    asyncio.run(main(ap.parse_args()))
