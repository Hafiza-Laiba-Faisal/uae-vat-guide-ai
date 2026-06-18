"""
Download UAE VAT Law PDF from uaelegislation.gov.ae using Playwright.
Bypasses Cloudflare by using a real browser.
"""
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Run: .venv-linux/bin/pip install playwright && .venv-linux/bin/python -m playwright install chromium")
    sys.exit(1)

DOWNLOAD_URL = "https://uaelegislation.gov.ae/en/legislations/1227/download"
OUTPUT = Path(__file__).parent / "downloads" / "01-vat-law-decree-8-2017.pdf"
OUTPUT.parent.mkdir(exist_ok=True)

print(f"Downloading: {DOWNLOAD_URL}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        accept_downloads=True,
    )
    page = context.new_page()

    # Intercept the response to capture PDF bytes
    pdf_data = None

    def handle_response(response):
        global pdf_data
        ct = response.headers.get("content-type", "")
        if "pdf" in ct or response.url.endswith(".pdf"):
            print(f"  Intercepted PDF: {response.url} ({ct})")
            try:
                pdf_data = response.body()
            except Exception as e:
                print(f"  Body error: {e}")

    page.on("response", handle_response)

    try:
        # Navigate — this may trigger a file download or inline PDF
        with page.expect_download(timeout=20000) as dl_info:
            page.goto(DOWNLOAD_URL, timeout=20000, wait_until="commit")
        download = dl_info.value
        download.save_as(str(OUTPUT))
        print(f"✅ Saved via download: {OUTPUT.name} ({OUTPUT.stat().st_size // 1024} KB)")
    except Exception as e:
        print(f"  Download event not triggered ({e}), checking intercepted data...")
        if pdf_data and pdf_data[:4] == b"%PDF":
            OUTPUT.write_bytes(pdf_data)
            print(f"✅ Saved via intercept: {OUTPUT.name} ({len(pdf_data) // 1024} KB)")
        else:
            # Last resort: try direct request with browser cookies
            print("  Trying direct request with browser cookies...")
            page.goto("https://uaelegislation.gov.ae/en/legislations/1227", timeout=20000)
            page.wait_for_timeout(3000)
            response = page.request.get(DOWNLOAD_URL)
            if response.ok and response.body()[:4] == b"%PDF":
                OUTPUT.write_bytes(response.body())
                print(f"✅ Saved via page request: {OUTPUT.name} ({len(response.body()) // 1024} KB)")
            else:
                print(f"❌ Failed. Status: {response.status}, Content: {response.headers.get('content-type')}")

    browser.close()
