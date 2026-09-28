import asyncio
import json
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("DAGUAN_MIGRATION_TEST_URL", "http://127.0.0.1:8097")
CHROME = os.environ.get("DAGUAN_CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


async def verify_browser_package_stop(browser, temp):
    """Use a second isolated service so the stop-button test cannot stop the parent QA service."""
    port = free_port()
    data_dir = temp / "stop-service-data"
    environment = {
        **os.environ,
        "PORT": str(port),
        "DAGUAN_DATA_DIR": str(data_dir),
        "DAGUAN_ROOT_DIR": str(ROOT),
        "DAGUAN_WEB_ROOT": str(ROOT / "web"),
        "DAGUAN_OPEN_BROWSER": "0",
        "DAGUAN_BROWSER_PACKAGE": "1",
    }
    process = subprocess.Popen(
        [shutil.which("node") or "node", str(ROOT / "local-server" / "server.mjs")],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    endpoint = f"http://127.0.0.1:{port}"
    page = await browser.new_page()
    try:
        for _ in range(100):
            try:
                await page.goto(endpoint + "/api/health", wait_until="domcontentloaded", timeout=1000)
                break
            except Exception:
                if process.poll() is not None:
                    raise RuntimeError(f"isolated service exited early with {process.returncode}")
                await asyncio.sleep(0.05)
        else:
            raise TimeoutError("isolated service did not start")
        await page.goto(endpoint + "/index.html?ui=new&browserPackage=1", wait_until="domcontentloaded")
        await page.wait_for_function("window.App && window.StateSync && window.StateSync.hydrated", timeout=30000)
        await page.evaluate("App.navigate('tools')")
        stop_button = page.locator("#btn-stop-local-service")
        assert await stop_button.is_visible()
        await page.evaluate("window.confirm = () => true")
        await stop_button.click()
        for _ in range(100):
            if process.poll() is not None:
                break
            await asyncio.sleep(0.05)
        assert process.poll() == 0, f"service did not exit cleanly: {process.poll()}"
        assert not (data_dir / ".service-instance.json").exists(), "service lock was not released"
        return {"serviceExitCode": process.returncode, "lockReleased": True}
    finally:
        await page.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


async def main():
    source = {
        "format": "daguan-local-progress",
        "version": 3,
        "progress": {
            "3356": {"mastery": "mastered", "favorite": True, "favorite_updated_at": "2026-01-03T00:00:00Z", "updated_at": "2026-01-03T00:00:00Z"},
            "3357": {"mastery": "learning", "updated_at": "2026-01-01T00:00:00Z"},
        },
        "favorites": ["3356"],
        "annotations": {"3356": {"markdown": "source note", "updated_at": "2026-01-03T00:00:00Z"}},
        "last_study": {"category_id": "1", "question_id": "3356", "updated_at": "2026-01-03T00:00:00Z"},
        "appearance": {"theme": "must not migrate"},
        "ai_drafts": {"3356": "must not migrate"},
    }

    with tempfile.TemporaryDirectory(prefix="daguan-migration-browser-") as temporary:
        temp = Path(temporary)
        source_file = temp / "legacy-source.json"
        backup_file = temp / "target-before-merge.json"
        source_file.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")

        async with async_playwright() as playwright:
            api = await playwright.request.new_context(base_url=BASE)
            state = await (await api.get("/api/state")).json()
            state["progress"] = {
                "3356": {"mastery": "learning", "favorite": False, "favorite_updated_at": "2026-01-02T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"},
                "3357": {"mastery": "mastered", "updated_at": "2026-01-02T00:00:00Z"},
            }
            state["favorites"] = []
            state["annotations"] = {"3356": {"markdown": "target note", "updated_at": "2026-01-02T00:00:00Z"}}
            state["last_study"] = {"category_id": "2", "question_id": "3357", "updated_at": "2026-01-02T00:00:00Z"}
            state["picked"] = ["777"]
            write = await api.put("/api/state", headers={"If-Match": str(state["revision"])}, data=state)
            assert write.ok, await write.text()
            seeded_revision = (await write.json())["revision"]

            browser = await playwright.chromium.launch(executable_path=CHROME, headless=True)
            context = await browser.new_context(accept_downloads=True)
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            # The page keeps an EventSource connection open, so networkidle never occurs.
            await page.goto(BASE + "/index.html?ui=new&browserPackage=1", wait_until="domcontentloaded")
            await page.wait_for_function("window.App && window.StateSync && window.StateSync.hydrated", timeout=30000)
            await page.evaluate("App.navigate('tools')")

            # Exercise the browser-package stop control without stopping the shared QA service.
            # Cancellation must not send the runtime stop request or disable the control.
            stop_button = page.locator("#btn-stop-local-service")
            assert await stop_button.is_visible(), "browser package tools must expose the stop control"
            await page.evaluate("""() => {
                window.__runtimeStopRequests = 0;
                window.confirm = () => false;
                const originalFetch = window.fetch.bind(window);
                window.fetch = (...args) => {
                    if (String(args[0]).includes('/api/runtime/stop')) window.__runtimeStopRequests++;
                    return originalFetch(...args);
                };
            }""")
            await stop_button.click()
            assert await page.evaluate("window.__runtimeStopRequests") == 0
            assert await stop_button.is_enabled()

            migration_input = page.locator("#migration-input")
            await migration_input.set_input_files(str(source_file))
            await page.locator("#migration-preview").get_by_text("将迁入进度").wait_for()
            assert await page.locator("#migration-confirmation").is_visible()
            before_cancel = await (await api.get("/api/state")).json()
            assert before_cancel["revision"] == seeded_revision, "preview wrote to the server"
            assert before_cancel["progress"]["3356"]["mastery"] == "learning"
            await page.locator("#btn-migration-cancel").click()
            assert "已取消合并预览" in await page.locator("#migration-preview").inner_text()
            assert await page.locator("#migration-confirmation").is_hidden()
            after_cancel = await (await api.get("/api/state")).json()
            assert after_cancel["revision"] == seeded_revision, "cancel wrote to the server"

            await migration_input.set_input_files(str(source_file))
            await page.locator("#migration-preview").get_by_text("将迁入进度").wait_for()
            assert await page.locator("#btn-migration-apply").is_disabled(), "merge must wait for a saved backup"
            async with page.expect_download() as first_download:
                await page.locator("#btn-migration-backup").click()
            download = await first_download.value
            await download.save_as(str(backup_file))
            backup = json.loads(backup_file.read_text(encoding="utf-8"))
            assert backup["progress"]["3356"]["mastery"] == "learning"
            assert backup["progress"]["3357"]["mastery"] == "mastered"
            assert backup["annotations"]["3356"]["markdown"] == "target note"
            assert backup["last_study"]["question_id"] == "3357"
            assert backup["picked"] == ["777"]
            assert backup["revision"] == seeded_revision
            await page.locator("#migration-backup-saved").check()
            assert await page.locator("#btn-migration-apply").is_enabled()

            changed = await (await api.get("/api/state")).json()
            changed["progress"]["3357"]["seen"] = True
            write = await api.put("/api/state", headers={"If-Match": str(changed["revision"])}, data=changed)
            assert write.ok, await write.text()
            stale_revision = (await write.json())["revision"]
            await page.locator("#btn-migration-apply").click()
            await page.locator("#migration-preview").get_by_text("发生了变化").wait_for()
            after_stale = await (await api.get("/api/state")).json()
            assert after_stale["revision"] == stale_revision, "stale preview wrote to the server"
            assert after_stale["progress"]["3356"]["mastery"] == "learning"
            assert await page.locator("#migration-backup-saved").is_disabled()
            assert await page.locator("#btn-migration-apply").is_disabled()

            async with page.expect_download() as refreshed_download:
                await page.locator("#btn-migration-backup").click()
            refreshed_path = await (await refreshed_download.value).path()
            refreshed_backup = json.loads(Path(refreshed_path).read_text(encoding="utf-8"))
            assert refreshed_backup["revision"] == stale_revision
            assert refreshed_backup["progress"]["3357"]["seen"] is True
            await page.locator("#migration-backup-saved").check()
            await page.locator("#btn-migration-apply").click()
            await page.locator("#migration-preview").get_by_text("合并完成").wait_for()

            merged = await (await api.get("/api/state")).json()
            assert merged["progress"]["3356"]["mastery"] == "mastered"
            assert merged["progress"]["3357"]["mastery"] == "mastered"
            assert merged["progress"]["3357"]["seen"] is True
            assert "3356" in merged["favorites"]
            assert merged["annotations"]["3356"]["markdown"] == "source note"
            assert merged["last_study"]["question_id"] == "3356"
            assert merged["picked"] == ["777"]
            assert "appearance" not in merged and "ai_drafts" not in merged
            assert not errors, errors
            actual_stop = await verify_browser_package_stop(browser, temp)

            artifact_dir = Path(__file__).resolve().parent.parent / ".build" / "stage3-migration-test"
            artifact_dir.mkdir(parents=True, exist_ok=True)
            screenshot = artifact_dir / "migration-merged.png"
            await page.screenshot(path=str(screenshot), full_page=True)
            print(json.dumps({
                "seedRevision": seeded_revision,
                "staleRevision": stale_revision,
                "finalRevision": merged["revision"],
                "progress3356": merged["progress"]["3356"]["mastery"],
                "progress3357": merged["progress"]["3357"]["mastery"],
                "favorite3356": "3356" in merged["favorites"],
                "annotation3356": merged["annotations"]["3356"]["markdown"],
                "lastStudy": merged["last_study"]["question_id"],
                "cancelPreservedRevision": after_cancel["revision"],
                "browserPackageStopControl": "visible; cancel preserved service",
                "browserPackageStopConfirmed": actual_stop,
                "browserErrors": errors,
                "screenshot": str(screenshot),
            }, ensure_ascii=False))
            await browser.close()
            await api.dispose()


asyncio.run(main())
