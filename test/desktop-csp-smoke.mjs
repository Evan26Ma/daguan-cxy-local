import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const endpoint = process.env.DAGUAN_CDP_ENDPOINT || "http://127.0.0.1:9224";
const playwrightPath = process.env.DAGUAN_PLAYWRIGHT_MODULE;
if (!playwrightPath) throw new Error("Set DAGUAN_PLAYWRIGHT_MODULE to the installed Playwright package entry.");
const playwright = await import(pathToFileURL(playwrightPath).href);
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, "Playwright package does not expose chromium.");
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith("daguan://app/"));
  assert.ok(page, `No daguan://app page is open on ${endpoint}`);
  const consoleMessages = [];
  const pageErrors = [];
  const htmlHeaders = [];
  const failedRequests = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (/^daguan:\/\/app\/(?:index|legacy)\.html/.test(response.url())) htmlHeaders.push(response.headers());
  });

  await page.evaluate(() => localStorage.setItem("daguan_ui_version_v1", "new"));
  await page.goto("daguan://app/index.html?desktop=1&ui=new");
  try { await page.waitForFunction(() => Boolean(window.App && window.katex)); }
  catch (error) {
    console.log(JSON.stringify({ url: page.url(), diagnostics: await page.evaluate(() => ({ title: document.title, version: document.documentElement.dataset.appVersion, app: typeof window.App, katex: typeof window.katex, bootstrap: typeof window.DaguanVersions })), consoleMessages, pageErrors, failedRequests }, null, 2));
    throw error;
  }
  const newUi = await page.evaluate(() => ({
    version: document.documentElement.dataset.appVersion,
    katex: window.katex.version,
    formulaRendered: window.katex.renderToString("x^2+1").includes('class="katex"'),
    health: typeof window.App.openGlobalSearch === "function",
  }));
  assert.equal(newUi.version, "new");
  assert.equal(newUi.formulaRendered, true);
  assert.equal(newUi.health, true);
  await page.locator("#btn-global-search").click();
  await page.waitForSelector(".global-search-page");
  await page.locator(".brand[data-app-action='show-home']").click();
  await page.waitForFunction(() => !document.querySelector(".global-search-page"));
  const aiProfilesStatus = await page.evaluate(() => fetch("./api/ai/profiles", { cache: "no-store" }).then((response) => response.status));
  assert.equal(aiProfilesStatus, 200);
  await page.waitForFunction(() => window.StateSync?.available && window.StateSync.hydrated, { timeout: 30000 });
  await page.evaluate(() => window.App.openQuestionFromList("3356"));
  await page.evaluate(() => window.StorageService.saveLearningPosition("223", "331", 0, "3356"));
  const newFavorite = '.question-actions [data-shortcut-hint="favorite"]';
  await page.waitForSelector(newFavorite);
  if (!(await page.locator(newFavorite).evaluate((button) => button.classList.contains("active")))) await page.locator(newFavorite).click();
  await page.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then((response) => response.json())).progress?.["3356"]?.favorite === true, { timeout: 10000 });
  const newPolicy = htmlHeaders.at(-1)?.["content-security-policy"] || "";
  assert.match(newPolicy, /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(newPolicy, /unsafe-eval/);

  await page.locator("#daguan-desktop-bar [data-action='switch']").click();
  await page.waitForFunction(() => document.documentElement.dataset.appVersion === "old" && Boolean(window.katex));
  const oldUi = await page.evaluate(() => ({ version: document.documentElement.dataset.appVersion, katex: window.katex.version }));
  assert.equal(oldUi.version, "old");
  await page.waitForFunction(() => document.querySelector("#btn-toggle-favorite")?.dataset.favoriteId === "3356");
  const oldFavorite = page.locator("#btn-toggle-favorite");
  await oldFavorite.click();
  await page.waitForFunction(async () => (await fetch("./api/state", { cache: "no-store" }).then((response) => response.json())).progress?.["3356"]?.favorite === false, { timeout: 10000 });
  const oldPolicy = htmlHeaders.at(-1)?.["content-security-policy"] || "";
  assert.match(oldPolicy, /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(oldPolicy, /unsafe-eval/);

  await page.locator("#daguan-desktop-bar [data-action='switch']").click();
  await page.waitForFunction(() => document.documentElement.dataset.appVersion === "new" && Boolean(window.App));
  assert.deepEqual(pageErrors, []);
  assert.equal(consoleMessages.some((message) => /Electron Security Warning|Insecure Content-Security-Policy|Refused to execute.*CSP/.test(message)), false, consoleMessages.join("\n"));
  console.log(JSON.stringify({ endpoint, newUi, oldUi, aiProfilesStatus, securityWarnings: consoleMessages.filter((message) => /Security Warning|Content-Security-Policy/i.test(message)), consoleErrors: consoleMessages.filter((message) => message.startsWith("error:")), pageErrors, failedRequests }, null, 2));
} finally {
  await browser.close();
}
