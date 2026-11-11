"""Record the live Punchlist Pay demo as timestamped frames for scripts/video/assemble.py.

Runs the real story against a running app (live PayPal sandbox + Claude):
request -> negotiation -> PayPal funding -> phone check-in -> proof -> verdict -> PM decision -> ledger.

Playwright's video recorder captures at 1x CSS pixels, so this grabs device-pixel screenshots
in a loop instead: desktop 1440x810 at 4/3 scale (1920x1080 frames), phone 390x844 at 2x.
A drawn cursor (desktop) and tap ripples (phone) are injected because screenshots have no pointer.

The desktop window is headed: when the PayPal popup opens, the person recording logs in as the
sandbox property manager (once) and approves. The popup is recorded too.

    python scripts/video/record.py --out <dir>            full take
    python scripts/video/record.py --out <dir> --login    open PayPal sandbox once to sign in (kept in <dir>/../profile)
Needs: pip install playwright; a server at --base (default http://localhost:3000) with live keys.
"""

import argparse
import asyncio
import base64
import json
import math
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

# A headed window behind other windows stops rendering; screenshots and waits would stall.
NO_THROTTLE = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"]

REQUEST = "4B kitchen sink leaking under the cabinet, fix today, under $250"

CURSOR_JS = r"""
(() => {
  const phone = %s;
  const boot = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = phone ? '' : '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 2.5l14 8.2-6.1 1.7-2.9 6.1z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed', left:'0', top:'0', zIndex:2147483647, pointerEvents:'none', transform:'translate(-200px,-200px)'});
    document.documentElement.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '@keyframes __rip{from{transform:translate(-50%%,-50%%) scale(.3);opacity:.55}to{transform:translate(-50%%,-50%%) scale(1.6);opacity:0}}';
    document.documentElement.appendChild(st);
    addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 3}px)`; }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div');
      Object.assign(r.style, {position:'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: phone ? '54px' : '40px', height: phone ? '54px' : '40px',
        borderRadius:'50%%', background: phone ? 'rgba(37,99,235,.35)' : 'rgba(37,99,235,.28)', zIndex:2147483646, pointerEvents:'none', animation:'__rip .55s ease-out forwards'});
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
"""


class StopTake(Exception):
    pass


class Take:
    until = None

    def __init__(self, out: Path):
        self.out = out
        self.t0 = time.monotonic()
        self.marks: dict[str, float] = {}
        self.cams: dict[str, dict] = {}

    def now(self):
        return round(time.monotonic() - self.t0, 3)

    def mark(self, name):
        self.marks[name] = self.now()
        print(f"  {self.marks[name]:7.2f}s  {name}", flush=True)
        self.save()
        if name == self.until:
            raise StopTake(name)

    def save(self):
        (self.out / "take.json").write_text(json.dumps({"marks": self.marks, "cams": {k: {kk: vv for kk, vv in v.items() if kk != "task"} for k, v in self.cams.items()}}, indent=1))

    async def cam(self, name, page, every=0.0, width=None):
        """Capture device-pixel JPEG frames of `page` until stopped. Frame list is (t, file)."""
        d = self.out / name
        d.mkdir(parents=True, exist_ok=True)
        cdp = await page.context.new_cdp_session(page)
        info = {"dir": name, "frames": []}
        self.cams[name] = info

        async def loop():
            nonlocal cdp
            n = 0
            while not info.get("stop"):
                try:
                    opts = {"format": "jpeg", "quality": 88, "optimizeForSpeed": True}
                    if width:
                        vw, vh = page.viewport_size["width"], page.viewport_size["height"]
                        # clip is in document coordinates: follow the scroll position or scrolled frames shift.
                        vv = (await asyncio.wait_for(cdp.send("Page.getLayoutMetrics"), timeout=3))["cssVisualViewport"]
                        opts["clip"] = {"x": vv["pageX"], "y": vv["pageY"], "width": vw, "height": vh, "scale": width / vw}
                    r = await asyncio.wait_for(cdp.send("Page.captureScreenshot", opts), timeout=3)
                except Exception as e:
                    if page.is_closed():
                        break
                    # A capture that hangs (hidden tab after a popup) would silently end the recording: reconnect.
                    print(f"  [{name}] capture stalled ({type(e).__name__}); reconnecting", flush=True)
                    try:
                        await page.bring_to_front()
                        cdp = await page.context.new_cdp_session(page)
                    except Exception:
                        pass
                    await asyncio.sleep(0.1)
                    continue
                t = self.now()
                f = f"{n:06d}.jpg"
                (d / f).write_bytes(base64.b64decode(r["data"]))
                info["frames"].append([t, f])
                n += 1
                if every:
                    await asyncio.sleep(every)
                else:
                    await asyncio.sleep(0)

        info["task"] = asyncio.ensure_future(loop())
        return info

    async def stop(self, name):
        info = self.cams[name]
        info["stop"] = True
        await info["task"]
        self.save()


class Pointer:
    """Eased mouse paths so the drawn cursor glides like a person's."""

    def __init__(self, page, start=(720, 700)):
        self.page, self.pos = page, list(start)

    async def to(self, x, y, duration=0.7):
        sx, sy = self.pos
        frames = max(8, round(duration * 60))
        t0 = time.monotonic()
        for i in range(1, frames + 1):
            k = (1 - math.cos(math.pi * i / frames)) / 2
            await self.page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k)
            await asyncio.sleep(max(0, t0 + duration * i / frames - time.monotonic()))
        self.pos = [x, y]

    async def at(self, locator, click=False, duration=0.7, dx=0.5, dy=0.5):
        await locator.wait_for(state="visible", timeout=120000)
        await locator.scroll_into_view_if_needed()
        box = await locator.bounding_box()
        await self.to(box["x"] + box["width"] * dx, box["y"] + min(box["height"] * dy, 60), duration)
        if click:
            await asyncio.sleep(0.12)
            await self.page.mouse.down()
            await asyncio.sleep(0.08)
            await self.page.mouse.up()

    async def wake(self):
        await self.page.mouse.move(self.pos[0] + 1, self.pos[1])
        await self.page.mouse.move(self.pos[0], self.pos[1])


async def scroll_to(page, locator, block="center"):
    await locator.evaluate(f"e => e.scrollIntoView({{behavior: 'smooth', block: '{block}'}})")
    await asyncio.sleep(1.1)


def api(base, path):
    with urllib.request.urlopen(base + path, timeout=30) as r:
        return json.loads(r.read())


def order(base, wid):
    rows = api(base, "/api/ledger")
    rows = rows.get("rows", rows) if isinstance(rows, dict) else rows
    return next((o for o in rows if o["id"] == wid), None)


async def wait_for(pred, timeout=180, every=1.0):
    t = time.monotonic()
    while time.monotonic() - t < timeout:
        v = pred()
        if v:
            return v
        await asyncio.sleep(every)
    raise TimeoutError("condition not met")


async def take(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    base = args.base
    profile = out.parent / "profile"
    async with async_playwright() as p:
        desk_ctx = await p.chromium.launch_persistent_context(
            str(profile), headless=True, viewport={"width": 1440, "height": 810}, device_scale_factor=4 / 3, args=NO_THROTTLE)
        await desk_ctx.add_init_script(CURSOR_JS % "false")
        phone_browser = await p.chromium.launch(args=NO_THROTTLE)
        phone_ctx = await phone_browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=False)
        await phone_ctx.add_init_script(CURSOR_JS % "true")

        Take.until = args.until
        T = Take(out)
        d = desk_ctx.pages[0] if desk_ctx.pages else await desk_ctx.new_page()
        await d.goto(base + "/dashboard?fixture=0")
        await d.wait_for_load_state("networkidle")
        await asyncio.sleep(1.5)
        pd = Pointer(d)
        await T.cam("desk", d, width=1920)
        await pd.wake()

        # 1. Dashboard -> request -> structured work order
        T.mark("dash")
        await asyncio.sleep(2.5)
        await pd.at(d.get_by_text("Paid this week"), duration=0.9)
        await asyncio.sleep(1.2)
        await pd.at(d.get_by_role("button", name="New request").first, click=True, duration=0.9)
        T.mark("new_request")
        box = d.get_by_label("Work request")
        await pd.at(box, click=True)
        await box.type(REQUEST, delay=38)
        await asyncio.sleep(0.6)
        await pd.at(d.get_by_role("button", name="Create work order"), click=True)
        T.mark("create")
        invite = d.get_by_role("button", name="Invite contractor")
        await d.wait_for_function("() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Invite contractor') && !b.disabled)", polling=250, timeout=120000)
        T.mark("draft")
        await pd.at(d.get_by_text("Acceptance criteria").first, duration=0.8)
        await asyncio.sleep(3.0)

        # 2. Agents negotiate; Dispatcher creates the PayPal order
        await pd.at(invite, click=True)
        T.mark("invite")
        await d.wait_for_url("**/work-orders/**", timeout=180000)
        wid = d.url.split("/work-orders/")[1].split("?")[0]
        T.marks["work_order_id"] = wid
        T.mark("negotiation_page")
        await pd.wake()
        fund = d.get_by_text("Fund work order").first
        await fund.wait_for(timeout=120000)
        T.mark("negotiation_done")
        await asyncio.sleep(1.0)
        thread = d.get_by_text("Agreement").first
        await scroll_to(d, thread)
        await asyncio.sleep(2.5)

        # 3. PM funds with PayPal (authorize, held)
        await scroll_to(d, fund)
        frame_el = d.locator("div.paypal-buttons iframe, iframe[name*='paypal_buttons']").first
        await frame_el.wait_for(timeout=60000)
        await asyncio.sleep(1.5)
        T.mark("paypal_ready")
        async with desk_ctx.expect_page(timeout=60000) as pop_info:
            await pd.at(frame_el, click=True, dx=0.22)
        pop = await pop_info.value
        T.mark("paypal_popup")
        await T.cam("paypal", pop, width=1920)
        await pop.wait_for_load_state("domcontentloaded")
        pp = Pointer(pop, (200, 500))
        approve = pop.locator("#payment-submit-btn, button[data-id='payment-submit-btn'], button:has-text('Continue to Review Order'), button:has-text('Complete Purchase'), button:has-text('Pay Now'), button:has-text('Continue'), button:has-text('Agree & Continue')").first
        try:
            await approve.wait_for(state="visible", timeout=45000)
            await asyncio.sleep(2.0)
            T.mark("paypal_review")
            await pp.at(approve, click=True, duration=0.8)
            T.mark("paypal_approve")
        except Exception:
            oid = order(base, wid)["contract"]["paypal_order_id"]
            print(f"\n  >>> PayPal wants a sign-in. Approve here as the property manager:\n  >>> https://www.sandbox.paypal.com/checkoutnow?token={oid}\n", flush=True)
            T.mark("paypal_manual")
        await wait_for(lambda: pop.is_closed() or (order(base, wid) or {}).get("contract", {}).get("paypal_auth_id"), timeout=3600, every=0.5)
        await asyncio.sleep(1.0)
        if not pop.is_closed():
            await pop.close()
        await T.stop("paypal")
        T.mark("paypal_closed")
        await d.bring_to_front()
        await wait_for(lambda: (order(base, wid) or {}).get("contract", {}).get("paypal_auth_id"), timeout=120)
        T.mark("funded")
        await d.reload()
        await d.wait_for_load_state("networkidle")
        await pd.wake()
        await asyncio.sleep(1.0)
        await pd.at(d.get_by_text("Held").first, duration=0.8)
        T.mark("funded_view")
        await asyncio.sleep(3.0)

        # 4. Contractor phone: check in -> deposit
        m = await phone_ctx.new_page()
        await m.goto(base + "/m/mike?fixture=0")
        await m.wait_for_load_state("networkidle")
        await asyncio.sleep(1.0)
        pm = Pointer(m, (200, 700))
        await T.cam("phone", m, width=780)
        T.mark("phone_jobs")
        await asyncio.sleep(2.0)
        title = order(base, wid)["title"]
        await pm.at(m.get_by_text(title).first, click=True, duration=0.5)
        T.mark("phone_job")
        await asyncio.sleep(2.5)
        await pm.at(m.get_by_text("Use sample check-in photo"), click=True, duration=0.5)
        T.mark("checkin")
        await m.get_by_text("Submit proof").first.wait_for(timeout=120000)
        T.mark("checked_in")
        await wait_for(lambda: any(p["kind"] == "deposit" and p["status"] == "paid" for p in order(base, wid)["payouts"]), timeout=120)
        T.mark("deposit_paid")
        await asyncio.sleep(1.5)

        # 5. Proof -> Claude Verifier
        # The upload targets sit under the fixed bottom bar; centre them before tapping.
        await scroll_to(m, m.get_by_text("Submit proof").first, "start")
        await pm.at(m.get_by_role("button", name="Use sample").nth(0), click=True, duration=0.5)
        await m.get_by_alt_text("After photo preview").wait_for(timeout=15000)
        await asyncio.sleep(0.9)
        await pm.at(m.get_by_role("button", name="Use sample").nth(0), click=True, duration=0.5)
        await m.get_by_alt_text("Receipt preview").wait_for(timeout=15000)
        await asyncio.sleep(1.2)
        T.mark("proof_ready")
        await pm.at(m.get_by_role("button", name="Submit proof"), click=True, duration=0.5)
        T.mark("submit")
        await wait_for(lambda: order(base, wid).get("verdict"), timeout=180, every=0.5)
        await m.get_by_text("Verifying").first.wait_for(state="detached", timeout=60000)
        T.mark("verdict")
        await asyncio.sleep(3.0)
        v = order(base, wid)
        T.marks["verdict_value"] = v["verdict"]["verdict"]
        T.marks["status_after_verdict"] = v["status"]

        # 6. PM reviews; pays (automatically on pass, or Approve anyway on escalation)
        await d.reload()
        await d.wait_for_load_state("networkidle")
        await pd.wake()
        T.mark("review_page")
        verdict_head = d.get_by_text("Verification", exact=True).first
        await scroll_to(d, verdict_head, "start")
        T.mark("review")
        for row in await d.locator(".animate-criteriaIn").all():
            await pd.at(row, duration=0.6, dx=0.3)
            await asyncio.sleep(2.2)
        if v["status"] != "paid":
            conflict = d.get_by_text("Evidence conflict").first
            if await conflict.count():
                await scroll_to(d, conflict)
                await pd.at(conflict, duration=0.6)
                await asyncio.sleep(2.5)
            await pd.at(d.get_by_role("button", name="Approve anyway"), click=True, duration=0.8)
            T.mark("approve")
        await wait_for(lambda: order(base, wid)["status"] == "paid" and all(p["status"] == "paid" for p in order(base, wid)["payouts"]), timeout=180)
        T.mark("paid")
        await d.reload()
        await d.wait_for_load_state("networkidle")
        await pd.wake()
        await scroll_to(d, d.get_by_text("Verification", exact=True).first, "start")
        await asyncio.sleep(1.0)
        await pd.at(d.get_by_text("Paid").last, duration=0.8)
        T.mark("paid_view")
        await asyncio.sleep(4.0)

        # 7. Phone shows the money
        await m.reload()
        await m.wait_for_load_state("networkidle")
        T.mark("phone_paid")
        await d.bring_to_front()
        await asyncio.sleep(3.5)
        await T.stop("phone")

        await tail(T, d, pd, out, base, wid)
        await T.stop("desk")
        await phone_browser.close()
        await desk_ctx.close()
        print(f"\nTake saved to {out}. Work order {wid}, verdict {T.marks['verdict_value']}.")


async def tail(T, d, pd, out, base, wid, cam="desk"):
    """Wrong-door job and the ledger. Re-recordable on its own with --part tail (no PayPal needed)."""
    # 8. The wrong-door job: nothing paid
    if "/dashboard" not in d.url:
        await pd.at(d.get_by_text("Ledger").first, click=True)
        await d.wait_for_url("**/dashboard**")
        await d.wait_for_load_state("networkidle")
        await pd.wake()
    T.mark("ledger")
    await asyncio.sleep(1.5)
    await pd.at(d.get_by_role("button", name="Needs review").first, click=True)
    T.mark("filter_review")
    await asyncio.sleep(1.5)
    await pd.at(d.get_by_text("Move-out cleaning").first, click=True)  # expands proof + verdict inline
    T.mark("door_expand")
    await asyncio.sleep(3.5)
    await pd.at(d.get_by_text("Open work order").first, click=True)
    await d.wait_for_url("**/work-orders/**")
    await d.wait_for_load_state("networkidle")
    await pd.wake()
    T.mark("door_job")
    await asyncio.sleep(1.0)
    conflict = d.get_by_text("Evidence conflict").first
    await scroll_to(d, conflict)
    T.mark("door_evidence")
    await pd.at(conflict, duration=0.6)
    await asyncio.sleep(1.0)
    for row in await d.locator(".animate-criteriaIn").all():
        await pd.at(row, duration=0.6, dx=0.3)
        await asyncio.sleep(1.6)
    await asyncio.sleep(1.0)

    # 9. Ledger payoff
    await pd.at(d.get_by_text("Ledger").first, click=True)
    await d.wait_for_url("**/dashboard**")
    await d.wait_for_load_state("networkidle")
    await pd.wake()
    T.mark("ledger_final")
    await asyncio.sleep(2.0)
    await pd.at(d.get_by_text("Avg. proof").first, duration=0.8)
    await asyncio.sleep(2.0)
    await pd.at(d.get_by_text("Group by property").first, click=True)
    await asyncio.sleep(3.5)
    T.mark("end")
    (out / "order.json").write_text(json.dumps(order(base, wid), indent=1))


async def part_tail(args):
    """Append a fresh recording of steps 8-9 to an existing take as camera desk2."""
    out = Path(args.out)
    prev = json.loads((out / "take.json").read_text())
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=NO_THROTTLE)
        ctx = await browser.new_context(viewport={"width": 1440, "height": 810}, device_scale_factor=4 / 3)
        await ctx.add_init_script(CURSOR_JS % "false")
        d = await ctx.new_page()
        await d.goto(args.base + "/dashboard?fixture=0")
        await d.wait_for_load_state("networkidle")
        await asyncio.sleep(1.5)
        T = Take(out)
        T.marks, T.cams = prev["marks"], prev["cams"]
        T.t0 -= max(v for v in T.marks.values() if isinstance(v, (int, float))) + 5  # continue the take's clock
        pd = Pointer(d)
        await T.cam("desk2", d, width=1920)
        await pd.wake()
        await asyncio.sleep(0.5)
        await tail(T, d, pd, out, args.base, T.marks["work_order_id"])
        await T.stop("desk2")
        await browser.close()
    print(f"Tail re-recorded into {out} as desk2.")


async def login(args):
    profile = Path(args.out).parent / "profile"
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(profile), headless=False, viewport={"width": 1100, "height": 800})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://www.sandbox.paypal.com/signin")
        print("Sign in as the sandbox property manager, then close the window.", flush=True)
        await ctx.wait_for_event("close", timeout=0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--login", action="store_true")
    ap.add_argument("--until", help="stop the take after this mark (rehearsal)")
    ap.add_argument("--part", choices=["tail"], help="re-record only the ending (wrong-door job + ledger) into an existing take")
    a = ap.parse_args()
    try:
        asyncio.run(login(a) if a.login else part_tail(a) if a.part == "tail" else take(a))
    except StopTake as e:
        print(f"Stopped after {e}.")
