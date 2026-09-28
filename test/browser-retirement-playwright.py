"""Run through with_server.py and an isolated DAGUAN_DATA_DIR."""

import json
import os

from playwright.sync_api import sync_playwright


port = int(os.environ["PORT"])
assert os.environ.get("DAGUAN_DATA_DIR"), "DAGUAN_DATA_DIR must be an isolated test directory"
origin = f"http://127.0.0.1:{port}"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(accept_downloads=True)
    for route in ("index.html?browserPackage=1", "legacy.html?browserPackage=1"):
        page.goto(f"{origin}/{route}", wait_until="domcontentloaded")
        panel = page.locator("#browser-retirement")
        panel.wait_for(timeout=20_000)
        assert panel.get_by_role("heading", name="浏览器版已停止维护").is_visible()
        assert page.locator("#app").evaluate("element => element.inert")
        link = panel.get_by_role("link", name="下载 Windows 桌面版")
        assert "/releases/download/v1.0.2/DaguanMathDesktop-Setup.exe" in link.get_attribute("href")
        page.wait_for_function("document.querySelector('#browser-retirement-status').dataset.state", timeout=25_000)
        with page.expect_download() as download_info:
            panel.get_by_role("button", name="下载本机记录备份").click(timeout=5000)
        download = download_info.value
        assert download.suggested_filename.endswith(".json")
        data = json.loads(download.path().read_text(encoding="utf-8"))
        assert data.get("format") == "daguan-local-progress"
    browser.close()

print("browser retirement page: new and legacy UI blocked, download and backup available")
