import test from "node:test";
import forgeConfig from "../forge.config.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_CONTENT_SECURITY_POLICY, downloadSaveDialogOptions, isTrustedAppUrl, navigationAction, proxyHeaders, resolveWebAsset, shouldStopService, windowPreferences } from "../desktop/policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("desktop navigation allows only the stable app origin and sends ordinary web links externally", () => {
  assert.equal(isTrustedAppUrl("daguan://app/index.html"), true);
  assert.equal(isTrustedAppUrl("daguan://evil/index.html"), false);
  assert.equal(isTrustedAppUrl("daguan://app.evil/index.html"), false);
  assert.equal(isTrustedAppUrl("javascript:alert(1)"), false);
  assert.equal(navigationAction("daguan://app/index.html"), "allow");
  assert.equal(navigationAction("https://example.org/"), "external");
  assert.equal(navigationAction("file:///C:/secret.txt"), "deny");
  assert.equal(navigationAction("javascript:alert(1)"), "deny");
});

test("web asset resolution rejects traversal and remains inside web root", () => {
  const web = path.join(ROOT, "web");
  assert.equal(resolveWebAsset(web, "/index.html"), path.join(web, "index.html"));
  assert.equal(resolveWebAsset(web, "/"), path.join(web, "index.html"));
  assert.equal(resolveWebAsset(web, "/../../data/private.json"), null);
  assert.equal(resolveWebAsset(web, "/%2e%2e/%2e%2e/private.json"), null);
});

test("API proxy drops authority, origin, and cookie headers while preserving request content type", () => {
  const headers = proxyHeaders(new Headers({ host: "attacker", origin: "https://attacker.invalid", cookie: "sid=secret", "content-type": "application/json", accept: "text/event-stream" }));
  assert.equal(headers.has("host"), false);
  assert.equal(headers.has("origin"), false);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("accept"), "text/event-stream");
});

test("renderer is sandboxed and only an owned service is stopped after explicit confirmation", () => {
  const preferences = windowPreferences("/tmp/preload.cjs");
  assert.deepEqual(preferences, { preload: "/tmp/preload.cjs", nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
  assert.equal(shouldStopService({ owned: true, confirmed: true }), true);
  assert.equal(shouldStopService({ owned: false, confirmed: true }), false);
  assert.equal(shouldStopService({ owned: true, confirmed: false }), false);
});

test("Electron entry registers the stable scheme before readiness and keeps browser source addresses out of the UI", () => {
  const source = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  assert.ok(source.indexOf("registerSchemesAsPrivileged") < source.indexOf("app.whenReady()"));
  assert.match(source, /loadURL\("daguan:\/\/app\/index\.html/);
  assert.match(source, /windowPreferences\(PRELOAD\)/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /will-navigate/);
});

test("Windows app packaging excludes Android sources and archived UI prototypes", () => {
  const patterns = forgeConfig.packagerConfig.ignore;
  const excluded = (relative) => patterns.some((pattern) => pattern.test(path.join(ROOT, relative)));
  assert.equal(excluded(path.join("android", "app", "src", "MainActivity.kt")), true);
  assert.equal(excluded(path.join("docs", "ui-redesign", "notes.md")), true);
  assert.equal(excluded(path.join("web", "index-new-backup.html")), true);
  assert.equal(excluded(path.join("web", "ui-preview", "index.html")), true);
  assert.equal(excluded(path.join("web", "index.html")), false);
  assert.equal(excluded(path.join("local-server", "server.mjs")), false);
});

test("desktop HTML uses a restrictive CSP without eval while supporting existing inline handlers", () => {
  assert.match(APP_CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(APP_CONTENT_SECURITY_POLICY, /script-src 'self' 'unsafe-inline'/);
  assert.match(APP_CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(APP_CONTENT_SECURITY_POLICY, /base-uri 'self'/);
  assert.doesNotMatch(APP_CONTENT_SECURITY_POLICY, /unsafe-eval/);

  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  assert.match(main, /if \(ext === "\.html"\) headers\["Content-Security-Policy"\] = policy\.APP_CONTENT_SECURITY_POLICY/);
  for (const page of ["index.html", "legacy.html"]) {
    const html = fs.readFileSync(path.join(ROOT, "web", page), "utf8");
    assert.match(html, /ui-bootstrap\.js/);
    assert.doesNotMatch(html, /<script\s*>(?!\s*<\/script>)[\s\S]*?<\/script>/i);
  }
  const bootstrap = fs.readFileSync(path.join(ROOT, "web", "ui-bootstrap.js"), "utf8");
  assert.match(bootstrap, /data-app-action/);
  assert.match(bootstrap, /DaguanVersions\.selected/);
});

test("desktop brand bar uses the native titlebar overlay without duplicate window controls", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.cjs"), "utf8");
  assert.match(main, /titleBarStyle:\s*"hidden"/);
  assert.match(main, /titleBarOverlay:\s*\{\s*color:\s*"#ffffff",\s*symbolColor:\s*"#3d4650",\s*height:\s*42\s*\}/);
  assert.match(preload, /env\(titlebar-area-width, 100%\)/);
  assert.match(preload, /data-action="switch"/);
  assert.match(preload, /data-action="print"/);
  assert.match(preload, /data-action="quit"/);
  assert.doesNotMatch(preload, /data-action="(?:minimize|maximize|close)"/);
});

test("downloads configure Electron's single default save dialog in Downloads with a safe suggested filename", () => {
  const options = downloadSaveDialogOptions("C:\\Users\\student\\Downloads", "daguan-progress-2026-09-28.json");
  assert.deepEqual(options, {
    title: "另存为",
    buttonLabel: "保存",
    defaultPath: "C:\\Users\\student\\Downloads\\daguan-progress-2026-09-28.json",
  });
  assert.equal(downloadSaveDialogOptions("C:\\Downloads", "C:\\other\\bad:name.html").defaultPath, "C:\\Downloads\\bad_name.html");

  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  const start = main.indexOf('session.defaultSession.on("will-download"');
  const end = main.indexOf('ipcMain.handle("daguan:window"', start);
  const handler = main.slice(start, end);
  assert.match(handler, /item\.setSaveDialogOptions\(policy\.downloadSaveDialogOptions\(app\.getPath\("downloads"\), item\.getFilename\(\)\)\)/);
  assert.doesNotMatch(handler, /showSaveDialog|async\s*\(/);
  assert.match(handler, /event\.preventDefault\(\); item\.cancel\(\)/);
});

test("desktop version controls use the existing save-first page switchers instead of navigating directly", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  const legacy = fs.readFileSync(path.join(ROOT, "web", "app-legacy.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.cjs"), "utf8");
  assert.match(main, /window\.App&&window\.App\.setUiVersion/);
  assert.match(main, /window\.DaguanDesktopSwitch/);
  assert.match(legacy, /window\.DaguanDesktopSwitch = setUiVersion/);
  assert.match(preload, /invoke\("daguan:window", "switch"\)/);
  assert.match(legacy, /if \(noteSaveError\) throw noteSaveError/);
  assert.match(legacy, /catch \(error\) \{\s*toast\(`未切换界面/);
});

test("desktop mirrors shared service revisions into both page runtimes", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.cjs"), "utf8");
  const newer = fs.readFileSync(path.join(ROOT, "web", "app-new.js"), "utf8");
  const older = fs.readFileSync(path.join(ROOT, "web", "app-legacy.js"), "utf8");
  assert.match(main, /async function pollServiceRevision\(\)/);
  assert.match(main, /webContents\.send\("daguan:state-changed", revision\)/);
  assert.match(preload, /new CustomEvent\("daguan:state-changed"/);
  assert.match(newer, /StateSync\.refreshFromEvent\(\)/);
  assert.match(older, /refreshStateFromServerEvent\(\)/);
});

test("desktop and browser installers keep program roots separate from shared learning data", () => {
  assert.equal(forgeConfig.makers[0].config.name, "DaguanMathDesktop");
  assert.equal(forgeConfig.makers[0].config.setupExe, "DaguanMathDesktop-Setup.exe");
  const browserInstall = fs.readFileSync(path.join(ROOT, "packaging", "windows", "install.ps1"), "utf8");
  const browserUninstall = fs.readFileSync(path.join(ROOT, "packaging", "windows", "uninstall.ps1"), "utf8");
  assert.match(browserInstall, /Join-Path \$env:LOCALAPPDATA "DaguanMathBrowser"/);
  assert.match(browserInstall, /Join-Path \$env:LOCALAPPDATA "DaguanMath\\data"/);
  assert.match(browserUninstall, /Join-Path \$env:LOCALAPPDATA "DaguanMathBrowser"/);
  assert.match(browserUninstall, /Join-Path \$env:LOCALAPPDATA "DaguanMath\\data"/);
  assert.match(browserUninstall, /@\("DaguanMathBrowser", "DaguanMath"\)/, "legacy browser installations remain explicitly removable");
  assert.doesNotMatch(browserUninstall, /Remove-Item[^\r\n]*\$dataDir/);
});
test("Squirrel shell identity is stable across app startup and preference changes", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  assert.equal((main.match(/app\.setAppUserModelId\("com\.squirrel\.DaguanMathDesktop\.DaguanMath"\);/g) || []).length, 2);
  assert.doesNotMatch(main, /com\.daguan\.math-local/);
});
test("Squirrel firstrun enters the app while install/update/uninstall hooks exit promptly", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  assert.match(main, /require\("electron-squirrel-startup"\)/);
  assert.doesNotMatch(main, /squirrel-\([^\n]*firstrun/);
});

test("desktop updates use the x64 GitHub feed and require an explicit restart click", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "electron-main.cjs"), "utf8");
  const updater = fs.readFileSync(path.join(ROOT, "desktop", "updater.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.cjs"), "utf8");
  assert.match(updater, /update\.electronjs\.org\/Evan26Ma\/daguan-cxy-local\/win32-x64/);
  assert.match(updater, /schedule\(STARTUP_DELAY_MS\)/);
  assert.match(updater, /schedule\(UPDATE_INTERVAL_MS\)/);
  assert.match(updater, /DAGUAN_UPDATE_FEED_URL/);
  assert.match(updater, /update-downloaded/);
  assert.match(preload, /"重启并安装更新"/);
  assert.match(preload, /window\.confirm\([\s\S]*其他浏览器窗口的学习页/);
  assert.match(preload, /invoke\("daguan:update:install"\)/);
  assert.match(main, /app\.on\("before-quit-for-update"/);
  assert.match(main, /desktop-updater\.log/);
  assert.match(main, /ipcMain\.handle\("daguan:update:install"/);
  assert.doesNotMatch(main, /fetch\(.*analytics|telemetry/i);
});
