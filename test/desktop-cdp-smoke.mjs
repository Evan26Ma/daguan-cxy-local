import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwright = require(process.env.DAGUAN_PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.DAGUAN_SCREENSHOT_DIR || path.join(root, "docs", "desktop-stage2", "screenshots");
await fs.mkdir(outDir, { recursive: true });
const browser = await playwright.chromium.connectOverCDP(process.env.DAGUAN_CDP_URL || "http://127.0.0.1:9222");
try {
  const contexts = browser.contexts();
  const pages = contexts.flatMap(context => context.pages());
  const page = pages.find(candidate => candidate.url().startsWith("daguan://app/"));
  if (!page) throw new Error("Could not find the Electron app page over CDP; pages=" + pages.map(p => p.url()).join(", "));
  if (!page.url().includes("index.html")) {
    await page.evaluate(() => localStorage.setItem("daguan_ui_version_v1", "new"));
    await page.goto("daguan://app/index.html?desktop=1");
  }
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.waitForSelector("#daguan-desktop-bar", { timeout: 20000 });
  await page.waitForFunction(() => window.StateSync?.available && window.StateSync.hydrated, { timeout: 30000 });
  await page.evaluate(() => App.openQuestionFromList("3356"));
  const favorite = '.question-actions [data-shortcut-hint="favorite"]';
  await page.waitForSelector(favorite, { timeout: 20000 });
  await page.waitForFunction(() => StateSync.queue.size === 0, { timeout: 20000 });
  await page.evaluate(() => StorageService.saveLearningPosition("223", "331", 0, "3356"));
  const alreadyFavorite = await page.evaluate(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).progress?.["3356"]?.favorite === true);
  if (!alreadyFavorite) await page.locator(favorite).click();
  await page.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).progress?.["3356"]?.favorite === true, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"));
  await page.screenshot({ path: path.join(outDir, "electron-new-ui.png"), fullPage: false });
  const newPageEvidence = await page.evaluate(async () => ({
    href: location.href,
    title: document.title,
    origin: location.origin,
    revision: StateSync.revision,
    favorite: document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"),
    serverFavorite: (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).progress?.["3356"]?.favorite,
  }));

  await page.locator('#daguan-desktop-bar [data-action="switch"]').click();
  await page.waitForURL(/legacy\.html/, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("#btn-toggle-favorite")?.dataset.favoriteId === "3356", { timeout: 30000 });
  await page.waitForFunction(() => window.DaguanDesktopSwitch && document.getElementById("daguan-desktop-bar"));
  const oldPageEvidence = await page.evaluate(() => ({ href: location.href, title: document.title, question: document.querySelector("#btn-toggle-favorite")?.dataset.favoriteId }));
  await page.screenshot({ path: path.join(outDir, "electron-old-ui.png"), fullPage: false });

  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "daguan_ui_version_v1" && value === "new") throw new Error("simulated save failure");
      return window.__realSetItem.call(this, key, value);
    };
  });
  await page.locator('#daguan-desktop-bar [data-action="switch"]').click();
  await page.waitForTimeout(700);
  const remainedOnOldAfterFailedSave = /legacy\.html/.test(page.url());
  await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; delete window.__realSetItem; });
  if (!remainedOnOldAfterFailedSave) throw new Error("The desktop titlebar navigated away after the legacy save-failure simulation.");

  await page.locator('#daguan-desktop-bar [data-action="switch"]').click();
  await page.waitForURL(/index\.html/, { timeout: 15000 });
  await page.waitForSelector("#daguan-desktop-bar", { timeout: 15000 });
  await page.waitForFunction(() => window.StateSync?.available && window.StateSync.hydrated, { timeout: 30000 });
  const finalState = await page.evaluate(async () => {
    const state = await fetch("./api/state", { cache: "no-store" }).then(response => response.json());
    return { revision: StateSync.revision, serverRevision: state.revision, favorite: state.progress?.["3356"]?.favorite };
  });
  if (!finalState.favorite || finalState.revision !== finalState.serverRevision) throw new Error("The shared API state did not remain consistent across both desktop pages.");
  const startupEnabled = await page.evaluate(() => window.daguanDesktop.getStartup());
  const dataDir = process.env.DAGUAN_DATA_DIR;
  if (!dataDir) throw new Error("DAGUAN_DATA_DIR must point to the isolated test data directory.");
  const owner = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  const browserProcess = await playwright.chromium.launch({ headless: true, executablePath: process.env.DAGUAN_TEST_BROWSER || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  let browserPage;
  try {
    browserPage = await browserProcess.newPage();
    await browserPage.goto("http://" + owner.host + ":" + owner.port + "/index.html?ui=new", { waitUntil: "domcontentloaded" });
    await browserPage.waitForFunction(() => window.StateSync?.available && window.StateSync.hydrated, { timeout: 30000 });
    await browserPage.evaluate(() => App.openQuestionFromList("3356"));
    await browserPage.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]'));
    await page.evaluate(() => App.openQuestionFromList("3356"));
    await page.waitForSelector(favorite, { timeout: 15000 });
    await browserPage.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"));
    await browserPage.locator('.question-actions [data-shortcut-hint="favorite"]').click();
    await browserPage.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).progress?.["3356"]?.favorite === false, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"), { timeout: 10000 });
    await browserPage.locator('.question-actions [data-shortcut-hint="favorite"]').click();
    await browserPage.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then(response => response.json())).progress?.["3356"]?.favorite === true, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.question-actions [data-shortcut-hint="favorite"]')?.classList.contains("active"), { timeout: 10000 });
  } finally { await browserProcess.close(); }
  const desktopOwnerSurvivedBrowserStartup = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8")).instanceId === owner.instanceId;
  if (!desktopOwnerSurvivedBrowserStartup) throw new Error("The browser page did not reuse the desktop-owned service instance.");
  const rootResponse = await page.goto("daguan://app/");
  await page.waitForSelector("#daguan-desktop-bar", { timeout: 15000 });
  const rootPageEvidence = await page.evaluate(() => ({ href: location.href, title: document.title, bar: Boolean(document.getElementById("daguan-desktop-bar")) }));
  if (rootResponse?.status() !== 200 || !rootPageEvidence.bar) throw new Error("The stable app root URL did not serve the desktop page successfully.");
  if (pageErrors.length) throw new Error("Renderer errors: " + pageErrors.join("; "));
  console.log(JSON.stringify({ newPageEvidence, oldPageEvidence, remainedOnOldAfterFailedSave, finalState, startupEnabled, desktopOwnerSurvivedBrowserStartup, rootPageEvidence, rootStatus: rootResponse.status(), pageErrors, screenshots: outDir }, null, 2));
} finally {
  await browser.close();
}
