"""Install isolated Squirrel 0.9.0, update to 0.9.1 from a local feed, then test offline/shared state."""
import asyncio
import hashlib
import http.server
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / ".build" / "stage4-update-qa"
DATA_DIR = ROOT / ".build" / "stage4-update-qa-data-rerun17" / "data"
QA_NAME = "DaguanMathStage4QA"
LOCALAPPDATA = Path(os.environ["LOCALAPPDATA"])
INSTALL_ROOT = LOCALAPPDATA / QA_NAME
SETUP = ARTIFACTS / "0.9.0" / f"{QA_NAME}-Setup.exe"
APP_EXE_NAME = "DaguanMath.exe"
CHROME = os.environ.get("DAGUAN_CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
CDP_PORT = int(os.environ.get("DAGUAN_STAGE4_CDP_PORT", "9449"))
FEED_VERSION = {"value": "0.9.0"}


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class FeedHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        version = FEED_VERSION["value"]
        directory = ARTIFACTS / version
        name = "RELEASES" if self.path.rstrip("/").endswith("/RELEASES") else Path(self.path.split("?", 1)[0]).name
        if name == "favicon.ico":
            self.send_error(404)
            return
        file_path = directory / name
        try:
            payload = file_path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format, *_args):
        pass


def process_image_paths():
    root = str(INSTALL_ROOT).replace("'", "''")
    command = (
        "$root='" + root + "'; "
        "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and "
        "$_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | "
        "Select-Object -ExpandProperty ExecutablePath"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]


def process_details():
    root = str(INSTALL_ROOT).replace("'", "''")
    command = (
        "$root='" + root + "'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and "
        "$_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | "
        "Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    if not result.stdout.strip():
        return []
    value = json.loads(result.stdout)
    return value if isinstance(value, list) else [value]


def pid_is_running(pid):
    result = subprocess.run(["powershell", "-NoProfile", "-Command", f"if (Get-Process -Id {int(pid)} -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}"], timeout=10)
    return result.returncode == 0


def foreground_qa_window(pid):
    command = (
        "Add-Type -Namespace DaguanQa -Name WindowFocus -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] "
        "public static extern bool SetForegroundWindow(System.IntPtr hWnd); [System.Runtime.InteropServices.DllImport(\"user32.dll\")] "
        "public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);'; "
        f"$p=Get-Process -Id {int(pid)} -ErrorAction Stop; $p.Refresh(); $h=$p.MainWindowHandle; "
        "if($h -eq [IntPtr]::Zero){throw 'QA window handle missing'}; [DaguanQa.WindowFocus]::ShowWindowAsync($h,9) | Out-Null; "
        "[DaguanQa.WindowFocus]::SetForegroundWindow($h) | Out-Null"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", command], check=True, timeout=15)


def clear_own_squirrel_residue():
    """Remove only a completed uninstall's residue for this unique QA identity."""
    if not INSTALL_ROOT.exists():
        return
    resolved_root = INSTALL_ROOT.resolve()
    expected_root = (LOCALAPPDATA / QA_NAME).resolve()
    if resolved_root != expected_root or INSTALL_ROOT.name != QA_NAME:
        raise RuntimeError(f"Unexpected QA install path; refusing cleanup: {INSTALL_ROOT}")
    if process_image_paths():
        raise RuntimeError(f"QA app is still running under {INSTALL_ROOT}")
    if not (INSTALL_ROOT / ".dead").exists() or not (INSTALL_ROOT / "Update.exe").is_file():
        raise RuntimeError(f"Existing QA path is not a verified completed Squirrel uninstall: {INSTALL_ROOT}")
    shutil.rmtree(INSTALL_ROOT)


def stop_qa_application():
    """After asking the isolated server to drain writes, stop only processes inside the unique QA install root."""
    owner_file = DATA_DIR / ".service-instance.json"
    try:
        owner = json.loads(owner_file.read_text(encoding="utf-8"))
        endpoint = f"http://127.0.0.1:{owner['port']}"
        request = subprocess.run([
            "curl.exe", "-sS", "-X", "POST", "-H", f"Origin: {endpoint}",
            "-H", "Content-Type: application/json", "--data", "{}", f"{endpoint}/api/runtime/stop",
        ], capture_output=True, text=True, timeout=10)
        # Setup's Squirrel first-run helper can exit before binding its service port.
        # The remainder of this function then stops only this test's unique QA install.
    except FileNotFoundError:
        pass
    paths = process_image_paths()
    if paths:
        root = str(INSTALL_ROOT).replace("'", "''")
        command = (
            "$root='" + root + "'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and "
            "$_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", command], check=True, timeout=20)
    if owner_file.exists():
        try:
            owner = json.loads(owner_file.read_text(encoding="utf-8"))
            if not pid_is_running(owner.get("pid", -1)):
                owner_file.unlink()
        except (OSError, ValueError, TypeError):
            pass


async def wait_for_health(endpoint, timeout=40):
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(endpoint + "/api/health", timeout=1) as response:
                if response.status == 200:
                    return json.loads(response.read())
        except Exception:
            await asyncio.sleep(0.2)
    raise TimeoutError(f"service did not respond at {endpoint}")


async def connect_electron(playwright, timeout=45):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            browser = await playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
            pages = [page for context in browser.contexts for page in context.pages]
            page = next((candidate for candidate in pages if candidate.url.startswith("daguan://app/")), None)
            if page:
                return browser, page
            await browser.close()
        except Exception as error:
            last_error = error
        await asyncio.sleep(0.25)
    raise TimeoutError(f"Electron CDP did not become available: {last_error}")


async def wait_js(page, expression, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if await page.evaluate(expression):
            return
        await asyncio.sleep(0.15)
    raise TimeoutError(f"condition did not become true: {expression}")


async def persist_favorite_via_state_api(page, favorite):
    return await page.evaluate("""async (favorite) => {
        const current = await (await fetch('./api/state', { cache: 'no-store' })).json();
        const response = await fetch('./api/state/questions/3356', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': String(current.revision) },
            body: JSON.stringify({ favorite, revision: current.revision })
        });
        if (!response.ok) throw new Error(`state write failed: ${response.status} ${await response.text()}`);
        return response.json();
    }""", favorite)


async def main():
    if not SETUP.is_file():
        raise FileNotFoundError(f"Build QA packages first: {SETUP}")
    clear_own_squirrel_residue()
    if DATA_DIR.exists():
        raise RuntimeError(f"Refusing to overwrite existing isolated test data: {DATA_DIR}")
    DATA_DIR.mkdir(parents=True)
    (DATA_DIR.parent / ".daguan-stage4-update-qa-rerun17").write_text("isolated test data only", encoding="utf-8")
    feed_port = free_port()
    feed = http.server.ThreadingHTTPServer(("127.0.0.1", feed_port), FeedHandler)
    feed_thread = threading.Thread(target=feed.serve_forever, daemon=True)
    feed_thread.start()
    env = {
        **os.environ,
        "DAGUAN_DATA_DIR": str(DATA_DIR),
        "DAGUAN_UPDATE_FEED_URL": f"http://127.0.0.1:{feed_port}/win32-x64/0.9.0",
    }
    setup_result = subprocess.run([str(SETUP)], env=env, timeout=150, check=False)
    if setup_result.returncode:
        raise RuntimeError(f"Isolated QA Setup exited with {setup_result.returncode}")
    app_exe_090 = INSTALL_ROOT / "app-0.9.0" / APP_EXE_NAME
    if not app_exe_090.is_file():
        raise FileNotFoundError(f"Squirrel 0.9.0 app was not installed at {app_exe_090}")

    # Close the Setup-launched first-run instance cleanly, then relaunch with a CDP port.
    try:
        import urllib.request
        owner_file = DATA_DIR / ".service-instance.json"
        deadline = time.time() + 40
        while time.time() < deadline and not owner_file.exists():
            await asyncio.sleep(0.2)
        if owner_file.exists():
            owner = json.loads(owner_file.read_text(encoding="utf-8"))
            endpoint = f"http://127.0.0.1:{owner['port']}"
            request = urllib.request.Request(endpoint + "/api/runtime/stop", data=b"{}", method="POST", headers={"Origin": endpoint, "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=5) as response:
                assert response.status == 200
    except Exception as error:
        raise RuntimeError(f"Could not drain the setup-launched QA service: {error}")
    paths = process_image_paths()
    if paths:
        stop_qa_application()

    app_process = subprocess.Popen([str(app_exe_090), f"--remote-debugging-port={CDP_PORT}"], env=env, cwd=INSTALL_ROOT)
    result = {
        "testVersions": ["0.9.0", "0.9.1"], "feed": env["DAGUAN_UPDATE_FEED_URL"],
        "dataDir": str(DATA_DIR), "squirrelIdentity": QA_NAME,
        "releases090": (ARTIFACTS / "0.9.0" / "RELEASES").read_text(encoding="utf-8-sig").strip(),
        "releases091": (ARTIFACTS / "0.9.1" / "RELEASES").read_text(encoding="utf-8-sig").strip(),
    }
    try:
        async with async_playwright() as playwright:
            electron, page = await connect_electron(playwright)
            await wait_js(page, "window.StateSync?.available && window.StateSync.hydrated", 30)
            initial_version = await page.evaluate("window.daguanDesktop.getAppVersion()")
            assert initial_version == "0.9.0", initial_version
            await page.evaluate("App.openQuestionFromList('3356')")
            favorite = page.locator('.question-actions [data-shortcut-hint="favorite"]')
            await favorite.wait_for(timeout=20000)
            if not await favorite.evaluate("element => element.classList.contains('active')"):
                await favorite.click()
            await wait_js(page, "JSON.parse(localStorage.getItem('daguan_local_favorites_v1') || '[]').includes('3356')")
            await persist_favorite_via_state_api(page, True)
            await wait_js(page, "async () => (await (await fetch('./api/state')).json()).favorites.includes('3356')", 15)
            result["preUpdateFavorite"] = await page.evaluate("async () => { const state = await (await fetch('./api/state')).json(); return state.favorites.includes('3356'); }")
            assert result["preUpdateFavorite"] is True

            FEED_VERSION["value"] = "0.9.1"
            update_button = page.locator('#daguan-desktop-bar [data-action="updates"]')
            await update_button.click()
            await wait_js(page, "document.querySelector('#daguan-desktop-bar [data-action=updates]')?.textContent === '重启并安装更新'", 240)
            owner = json.loads((DATA_DIR / ".service-instance.json").read_text(encoding="utf-8"))
            result["readyBeforeRestart"] = {
                "appPid": app_process.pid, "processStillRunning": app_process.poll() is None,
                "appVersion": await page.evaluate("window.daguanDesktop.getAppVersion()"),
                "servicePid": owner["pid"], "serviceLockPresent": (DATA_DIR / ".service-instance.json").exists(),
                "favorite": await page.evaluate("async () => { const s = await (await fetch('./api/state')).json(); return s.favorites.includes('3356'); }")
            }
            assert result["readyBeforeRestart"]["processStillRunning"]
            assert result["readyBeforeRestart"]["appVersion"] == "0.9.0"
            assert result["readyBeforeRestart"]["serviceLockPresent"]
            screenshot_dir = ARTIFACTS / "evidence"
            screenshot_dir.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(screenshot_dir / "update-ready-0.9.1.png"), full_page=False)
            async def accept_restart(dialog):
                await dialog.accept()
            page.once("dialog", accept_restart)
            await update_button.click()
            await electron.close()

            # Squirrel relaunches the updated app without the temporary CDP argument.
            # Capture that real update-start PID first, then relaunch the same installed
            # version with CDP for post-update UI and cross-window assertions.
            deadline = time.time() + 60
            updated_processes = []
            while time.time() < deadline:
                updated_processes = [item for item in process_details() if "app-0.9.1" in item["ExecutablePath"].lower() and Path(item["ExecutablePath"]).name.lower() == APP_EXE_NAME.lower()]
                if updated_processes and (DATA_DIR / ".service-instance.json").exists():
                    break
                await asyncio.sleep(0.25)
            assert updated_processes, "Squirrel did not start the updated 0.9.1 executable after confirmation"
            result["squirrelRestartProcess"] = updated_processes
            stop_qa_application()
            app_exe_091 = INSTALL_ROOT / "app-0.9.1" / APP_EXE_NAME
            app_process = subprocess.Popen([str(app_exe_091), f"--remote-debugging-port={CDP_PORT}"], env=env, cwd=INSTALL_ROOT)
            electron, page = await connect_electron(playwright, timeout=60)
            await wait_js(page, "window.StateSync?.available && window.StateSync.hydrated", 30)
            updated_version = await page.evaluate("window.daguanDesktop.getAppVersion()")
            assert updated_version == "0.9.1", updated_version
            updated_owner = json.loads((DATA_DIR / ".service-instance.json").read_text(encoding="utf-8"))
            await page.evaluate("App.openQuestionFromList('3356')")
            await page.locator('.question-actions [data-shortcut-hint="favorite"]').wait_for(timeout=15000)
            await wait_js(page, "async () => (await (await fetch('./api/state')).json()).favorites.includes('3356')", 20)
            result["updatedVersion"] = updated_version
            live_apps = [item for item in process_details() if Path(item["ExecutablePath"]).name.lower() == APP_EXE_NAME.lower()]
            result["updatedAppProcesses"] = live_apps
            assert any("app-0.9.1" in item["ExecutablePath"].lower() for item in live_apps), live_apps
            result["updatedServicePid"] = updated_owner.get("pid")
            result["serviceLockAfterRestart"] = True
            result["favoritePreserved"] = True
            await page.screenshot(path=str(screenshot_dir / "updated-0.9.1.png"), full_page=False)
            update_button = page.locator('#daguan-desktop-bar [data-action="updates"]')

            owner = json.loads((DATA_DIR / ".service-instance.json").read_text(encoding="utf-8"))
            service_url = f"http://127.0.0.1:{owner['port']}"
            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True)
            browser_page = await browser.new_page()
            browser_errors = []
            browser_page.on("pageerror", lambda error: browser_errors.append(str(error)))
            await browser_page.goto(service_url + "/index.html?ui=new", wait_until="domcontentloaded")
            await wait_js(browser_page, "window.StateSync?.available && window.StateSync.hydrated", 30)
            await browser_page.evaluate("App.openQuestionFromList('3356')")
            await page.evaluate("window.__receivedStateEvents = []; window.addEventListener('daguan:state-changed', e => window.__receivedStateEvents.push(e.detail?.revision || 0));")
            browser_favorite = browser_page.locator('.question-actions [data-shortcut-hint="favorite"]')
            await browser_favorite.wait_for(timeout=15000)
            assert await browser_favorite.evaluate("element => element.classList.contains('active')")
            await persist_favorite_via_state_api(browser_page, False)
            await wait_js(browser_page, "async () => !(await (await fetch('./api/state')).json()).favorites.includes('3356')")
            foreground_qa_window(app_process.pid)
            result["afterRemoteFavoriteClear"] = await page.evaluate("({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision})")
            try:
                await page.locator('.question-actions [data-shortcut-hint="favorite"]').wait_for(timeout=5000)
                await wait_js(page, "!document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]').classList.contains('active')", 15)
            except TimeoutError:
                result["crossWindowFailure"] = await page.evaluate("async () => ({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision, view: AppState.currentView, favoriteActive: document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]')?.classList.contains('active'), apiState: await (await fetch('./api/state')).json(), eventSourceState: StateSync.eventSource?.readyState})")
                await page.screenshot(path=str(ARTIFACTS / "evidence" / "cross-window-stale.png"), full_page=False)
                (ARTIFACTS / "cross-window-debug.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                await page.evaluate("StateSync.refreshFromEvent()")
                await asyncio.sleep(2)
                result["afterExplicitRefresh"] = await page.evaluate("({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision, favoriteActive: document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]')?.classList.contains('active')})")
                raise
            await persist_favorite_via_state_api(browser_page, True)
            await wait_js(browser_page, "async () => (await (await fetch('./api/state')).json()).favorites.includes('3356')")
            foreground_qa_window(app_process.pid)
            result["afterRemoteFavoriteSet"] = await page.evaluate("({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision})")
            try:
                await page.locator('.question-actions [data-shortcut-hint="favorite"]').wait_for(timeout=5000)
                await wait_js(page, "document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]').classList.contains('active')", 15)
            except TimeoutError:
                result["crossWindowSetFailure"] = await page.evaluate("async () => ({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision, view: AppState.currentView, favoriteActive: document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]')?.classList.contains('active'), apiState: await (await fetch('./api/state')).json(), eventSourceState: StateSync.eventSource?.readyState})")
                await page.screenshot(path=str(ARTIFACTS / "evidence" / "cross-window-stale.png"), full_page=False)
                (ARTIFACTS / "cross-window-debug.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                await page.evaluate("StateSync.refreshFromEvent()")
                await asyncio.sleep(2)
                result["afterExplicitRefresh"] = await page.evaluate("({visibility: document.visibilityState, received: window.__receivedStateEvents, revision: StateSync.revision, favoriteActive: document.querySelector('.question-actions [data-shortcut-hint=\"favorite\"]')?.classList.contains('active')})")
                raise
            assert not browser_errors, browser_errors
            result["crossWindowFavoriteSync"] = True
            await browser.close()

            feed.shutdown()
            feed.server_close()
            await page.evaluate("window.__updateStates = []; window.addEventListener('daguan:update-state', e => window.__updateStates.push(e.detail?.state));")
            await update_button.click()
            await wait_js(page, "window.__updateStates.includes('error')", 30)
            health_api = await playwright.request.new_context()
            try:
                assert (await health_api.get(service_url + "/api/health")).ok
            finally:
                await health_api.dispose()
            result["offlineUpdatesGraceful"] = True
            await page.screenshot(path=str(screenshot_dir / "offline-update-check.png"), full_page=False)
            result["screenshots"] = str(screenshot_dir)
            (ARTIFACTS / "e2e-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            await electron.close()
    finally:
        feed.shutdown()
        feed.server_close()
        stop_qa_application()
        uninstall = INSTALL_ROOT / "Update.exe"
        if uninstall.is_file():
            completed = subprocess.run([str(uninstall), "--uninstall"], env=env, timeout=60, check=False)
            if completed.returncode:
                raise RuntimeError(f"QA Squirrel uninstall exited with {completed.returncode}")
        assert (DATA_DIR.parent / ".daguan-stage4-update-qa-rerun17").exists(), "QA sentinel data must survive uninstall"
    print(json.dumps(result, ensure_ascii=False, indent=2))


asyncio.run(main())
