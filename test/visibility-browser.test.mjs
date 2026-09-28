import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let playwright = null;
try {
  const require = createRequire(import.meta.url);
  playwright = require(process.env.DAGUAN_PLAYWRIGHT_MODULE || "playwright");
} catch {}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test("双浏览器页：后台错过收藏 SSE 后，回到前台读取并显示最终服务端状态", { skip: !playwright && "Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE" }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-visibility-pages-"));
  const port = await unusedPort();
  let service = spawn(process.execPath, [path.join(ROOT, "local-server", "server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DAGUAN_DATA_DIR: dataDir, DAGUAN_OPEN_BROWSER: "0" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let serverOutput = "";
  service.stdout.setEncoding("utf8").on("data", chunk => { serverOutput += chunk; });
  service.stderr.setEncoding("utf8").on("data", chunk => { serverOutput += chunk; });
  let browser;
  let context;
  let serviceClosed = false;
  t.after(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (!serviceClosed && service.exitCode == null) {
      service.send({ type: "shutdown" });
      await Promise.race([once(service, "close"), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    if (service.exitCode == null) service.kill("SIGKILL");
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const deadline = Date.now() + 10_000;
  let health;
  while (Date.now() < deadline) {
    if (service.exitCode != null) throw new Error(`server exited early: ${serverOutput}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(health?.apiProtocol, 1, serverOutput);

  const executablePath = process.env.DAGUAN_TEST_BROWSER;
  browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const browserErrors = [];
  for (const page of [pageA, pageB]) page.on("pageerror", error => browserErrors.push(error.message));
  const url = `http://127.0.0.1:${port}/index.html?ui=new`;
  await Promise.all([pageA.goto(url, { waitUntil: "domcontentloaded" }), pageB.goto(url, { waitUntil: "domcontentloaded" })]);
  await Promise.all([pageA, pageB].map(page => page.waitForFunction(() => window.StateSync?.hydrated && window.StateSync.available, { timeout: 30_000 })));
  await Promise.all([pageA, pageB].map(page => page.waitForSelector(".home-content")));
  await Promise.all([pageA, pageB].map(page => page.evaluate(() => App.openQuestionFromList("3356"))));
  const favoriteSelector = '.question-actions [data-shortcut-hint="favorite"]';
  await Promise.all([pageA, pageB].map(page => page.waitForSelector(favoriteSelector)));
  await Promise.all([pageA, pageB].map(page => page.waitForFunction(() => StateSync.queue.size === 0 && !StateSync.lastStudyInFlight)));
  await pageB.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).revision === StateSync.revision);
  assert.equal(await pageB.locator(favoriteSelector).evaluate(button => button.classList.contains("active")), false);

  await pageB.evaluate(() => {
    const sync = StateSync;
    const refresh = sync.refreshFromEvent.bind(sync);
    sync.__hiddenRefreshCount = 0;
    sync.__visibleRefreshCount = 0;
    sync.refreshFromEvent = async function () {
      if (document.visibilityState === "hidden") this.__hiddenRefreshCount += 1;
      else this.__visibleRefreshCount += 1;
      return refresh();
    };
  });
  const setVisibility = state => pageB.evaluate(nextState => {
    window.__testVisibilityState = nextState;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: window.__testVisibilityState });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await setVisibility("hidden");
  await pageB.waitForFunction(() => document.visibilityState === "hidden");
  const revisionBefore = await pageB.evaluate(() => StateSync.revision);

  await pageA.locator(favoriteSelector).click();
  await pageA.waitForFunction(async () => {
    const response = await fetch("./api/state", { cache: "no-store" });
    const state = await response.json();
    return state.progress?.["3356"]?.favorite === true;
  });
  await pageB.waitForFunction(() => StateSync.__hiddenRefreshCount > 0);
  console.log("visibility-hidden-evidence", JSON.stringify({
    revisionBefore,
    revisionWhileHidden: await pageB.evaluate(() => StateSync.revision),
    hiddenRefreshCount: await pageB.evaluate(() => StateSync.__hiddenRefreshCount),
    serviceRevision: await fetch(`http://127.0.0.1:${port}/api/state`, { cache: "no-store" }).then(response => response.json()).then(state => state.revision),
  }));
  assert.equal(await pageB.locator(favoriteSelector).evaluate(button => button.classList.contains("active")), false,
    "后台页面不提前绘制未读取的服务端值");
  assert.equal(await pageB.evaluate(() => StateSync.revision), revisionBefore);

  await setVisibility("visible");
  await pageB.waitForFunction(() => document.visibilityState === "visible");
  await pageB.waitForFunction(() => StateSync.__visibleRefreshCount > 0);
  await pageB.waitForTimeout(1000);
  console.log("visibility-visible-diagnostics", JSON.stringify(await pageB.evaluate(() => ({
    revision: StateSync.revision,
    available: StateSync.available,
    view: AppState.currentView,
    favorite: StorageService.isFavorite("3356"),
    buttonActive: document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"),
    queue: StateSync.queue.size,
    lastStudyInFlight: StateSync.lastStudyInFlight,
    annotationDirty: AppState.annotationDirty,
  }))));
  await pageB.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"), { timeout: 5000 });
  await pageA.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"));
  await pageB.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).revision === StateSync.revision);
  const serviceState = await fetch(`http://127.0.0.1:${port}/api/state`, { cache: "no-store" }).then(response => response.json());
  const final = {
    serverFavorite: serviceState.progress["3356"].favorite,
    pageAActive: await pageA.locator(favoriteSelector).evaluate(button => button.classList.contains("active")),
    pageBActive: await pageB.locator(favoriteSelector).evaluate(button => button.classList.contains("active")),
    pageARevision: await pageA.evaluate(() => StateSync.revision),
    pageBRevision: await pageB.evaluate(() => StateSync.revision),
    browserErrors,
  };
  console.log("visibility-refresh-evidence", JSON.stringify({ revisionBefore, serviceRevision: serviceState.revision, final }));
  assert.deepEqual(final, {
    serverFavorite: true,
    pageAActive: true,
    pageBActive: true,
    pageARevision: serviceState.revision,
    pageBRevision: serviceState.revision,
    browserErrors: [],
  });

  await pageB.evaluate(() => {
    const source = StateSync.eventSource;
    window.__sseOpenCount = 0;
    window.__sseErrorCount = 0;
    const onopen = source.onopen;
    const onerror = source.onerror;
    source.onopen = event => { window.__sseOpenCount += 1; return onopen.call(source, event); };
    source.onerror = event => { window.__sseErrorCount += 1; return onerror.call(source, event); };
  });
  const oldServiceClosed = once(service, "close");
  service.send({ type: "shutdown" });
  await oldServiceClosed;
  serviceClosed = true;
  service = spawn(process.execPath, [path.join(ROOT, "local-server", "server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DAGUAN_DATA_DIR: dataDir, DAGUAN_OPEN_BROWSER: "0" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  service.stdout.setEncoding("utf8").on("data", chunk => { serverOutput += chunk; });
  service.stderr.setEncoding("utf8").on("data", chunk => { serverOutput += chunk; });
  serviceClosed = false;
  const restartDeadline = Date.now() + 10_000;
  while (Date.now() < restartDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await pageB.waitForFunction(() => window.__sseErrorCount > 0, undefined, { timeout: 8000 });
  const beforeReconnect = await fetch(`http://127.0.0.1:${port}/api/state`, { cache: "no-store" }).then(response => response.json());
  const changedResponse = await fetch(`http://127.0.0.1:${port}/api/state/questions/3356`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match": String(beforeReconnect.revision) },
    body: JSON.stringify({ error_prone: true }),
  });
  const changedState = await changedResponse.json();
  assert.equal(changedResponse.status, 200, JSON.stringify(changedState));
  await pageB.waitForFunction(revision => window.__sseOpenCount > 0 && StateSync.revision >= revision, changedState.revision, { timeout: 20_000 });
  await pageB.waitForFunction(() => document.querySelector('[data-shortcut-hint="error"]')?.classList.contains("active"));
  await pageA.waitForFunction(() => document.querySelector('[data-shortcut-hint="error"]')?.classList.contains("active"));
  const reconnectState = await fetch(`http://127.0.0.1:${port}/api/state`, { cache: "no-store" }).then(response => response.json());
  const reconnectEvidence = {
    disconnects: await pageB.evaluate(() => window.__sseErrorCount),
    reconnects: await pageB.evaluate(() => window.__sseOpenCount),
    serviceRevision: reconnectState.revision,
    pageARevision: await pageA.evaluate(() => StateSync.revision),
    pageBRevision: await pageB.evaluate(() => StateSync.revision),
    serverErrorProne: reconnectState.progress["3356"].error_prone,
    pageAErrorActive: await pageA.locator('[data-shortcut-hint="error"]').evaluate(button => button.classList.contains("active")),
    pageBErrorActive: await pageB.locator('[data-shortcut-hint="error"]').evaluate(button => button.classList.contains("active")),
  };
  console.log("visibility-reconnect-evidence", JSON.stringify({ changedRevision: changedState.revision, reconnectEvidence }));
  assert.ok(reconnectEvidence.disconnects > 0);
  assert.ok(reconnectEvidence.reconnects > 0);
  assert.equal(reconnectEvidence.serviceRevision, changedState.revision);
  assert.equal(reconnectEvidence.pageARevision, changedState.revision);
  assert.equal(reconnectEvidence.pageBRevision, changedState.revision);
  assert.equal(reconnectEvidence.serverErrorProne, true);
  assert.equal(reconnectEvidence.pageAErrorActive, true);
  assert.equal(reconnectEvidence.pageBErrorActive, true);

  await context.close();
  context = null;
  const closePromise = once(service, "close");
  service.send({ type: "shutdown" });
  await closePromise;
  serviceClosed = true;
});
