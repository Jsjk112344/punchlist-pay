"""Screenshot all fixture demo states at 1440x900 / 390x844.

Requires a running Next.js development server at http://localhost:3000 and
`pip install playwright` + a compatible Chromium browser (set CHROMIUM_PATH).
This script is not part of the browser app or its runtime dependencies.
"""
from pathlib import Path
import os
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs" / "assets"
DEST.mkdir(parents=True, exist_ok=True)
ORIGIN = os.getenv("PUNCHLIST_BASE", "http://localhost:3000")


def snap(page, name):
    page.screenshot(path=str(DEST / name), full_page=False, animations="disabled")
    print("Saved", name)


with sync_playwright() as p:
    kwargs = {"headless": True}
    if os.getenv("CHROMIUM_PATH"):
        kwargs["executable_path"] = os.getenv("CHROMIUM_PATH")
    browser = p.chromium.launch(**kwargs)
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    desktop = context.new_page()
    desktop.goto(f"{ORIGIN}/?fixture=1", wait_until="domcontentloaded")
    snap(desktop, "desktop-switcher.png")
    desktop.goto(f"{ORIGIN}/dashboard?fixture=1", wait_until="domcontentloaded")
    desktop.get_by_text("Reset demo").click()
    desktop.wait_for_timeout(700)
    snap(desktop, "desktop-dashboard.png")
    desktop.get_by_role("button", name="New request").click()
    desktop.get_by_role("textbox", name="Work request").fill("4B kitchen sink leaking under the cabinet, fix today, under $250")
    desktop.get_by_role("button", name="Create work order").click()
    desktop.get_by_role("button", name="Invite contractor").wait_for(state="visible")
    desktop.wait_for_timeout(1300)
    snap(desktop, "desktop-new-request.png")
    desktop.get_by_role("button", name="Invite contractor").click()
    desktop.wait_for_url("**/work-orders/**")
    desktop.wait_for_timeout(2200)
    snap(desktop, "desktop-negotiation.png")

    # Same context shares localStorage with desktop despite the phone viewport.
    phone = context.new_page()
    phone.set_viewport_size({"width": 390, "height": 844})
    phone.goto(f"{ORIGIN}/m/mike?fixture=1", wait_until="domcontentloaded")
    phone.wait_for_timeout(500)
    snap(phone, "mobile-jobs.png")
    phone.get_by_text("Kitchen sink leak").first.click()
    snap(phone, "mobile-job-funded.png")
    phone.get_by_role("button", name="Check in").click()
    phone.wait_for_timeout(1600)
    created_url = desktop.url
    desktop.goto(f"{ORIGIN}/dashboard?fixture=1", wait_until="domcontentloaded")
    desktop.wait_for_timeout(350)
    snap(desktop, "desktop-checkin-ledger.png")
    desktop.goto(created_url, wait_until="domcontentloaded")
    snap(phone, "mobile-job-in-progress.png")
    phone.get_by_role("button", name="Use sample").first.click()
    phone.get_by_role("button", name="Use sample").first.click()
    snap(phone, "mobile-proof-upload.png")
    phone.get_by_role("button", name="Submit proof").click()
    phone.wait_for_timeout(400)
    snap(phone, "mobile-verifying.png")
    phone.get_by_text("Sent to your PayPal").wait_for(state="visible")
    snap(phone, "mobile-paid.png")
    desktop.reload(wait_until="domcontentloaded")
    desktop.wait_for_timeout(500)
    snap(desktop, "desktop-verdict.png")
    desktop.goto(f"{ORIGIN}/work-orders/wo-1041?fixture=1", wait_until="domcontentloaded")
    snap(desktop, "desktop-review.png")
    phone.goto(f"{ORIGIN}/m/sara?job=wo-1041&fixture=1", wait_until="domcontentloaded")
    snap(phone, "mobile-review.png")
    desktop.get_by_role("button", name="Request redo").click()
    desktop.wait_for_timeout(300)
    snap(desktop, "desktop-redo.png")
    browser.close()
