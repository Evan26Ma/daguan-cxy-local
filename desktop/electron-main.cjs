const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, net, protocol, shell, session, ipcMain, autoUpdater } = require("electron");
if (require("electron-squirrel-startup")) app.quit();
const fs = require("node:fs/promises");
const netNode = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createDesktopUpdater } = require("./updater.cjs");


app.setAppUserModelId("com.squirrel.DaguanMathDesktop.DaguanMath");

protocol.registerSchemesAsPrivileged([{ scheme: "daguan", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, allowServiceWorkers: true } }]);
const APP_PATH = app.getAppPath();
if (process.env.DAGUAN_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.DAGUAN_USER_DATA_DIR));
const WEB_ROOT = path.join(APP_PATH, "web");
const SERVER_SCRIPT = path.join(APP_PATH, "local-server", "server.mjs");
const PRELOAD = path.join(__dirname, "preload.cjs");
const MIMES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };
let policy, lock, owner, serverChild = null, mainWindow = null, tray = null, updater = null;
let ownsService = false, quitting = false, quitPromise = null, startupEnabled = false;
let revisionPollTimer = null, lastServiceRevision = null;
let updateMenuReady = false;

function dataDirectory() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
  return path.resolve(process.env.DAGUAN_DATA_DIR || path.join(base, "DaguanMath", "data"));
}
function serviceEndpoint() { return "http://" + owner.host + ":" + owner.port; }
async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = netNode.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close((error) => error ? reject(error) : resolve(port)); });
  });
}
async function connectOrStartService() {
  const dataDir = dataDirectory();
  lock = await import(pathToFileURL(path.join(APP_PATH, "local-server", "instance-lock.mjs")).href);
  const existing = await lock.readServiceOwner(dataDir);
  if (existing) {
    if (await lock.waitForServiceOwner(existing)) { owner = existing; ownsService = false; return; }
    throw new Error("发现服务实例 PID " + existing.pid + "、端口 " + existing.port + "，但健康检查失败。为保护学习数据，桌面版不会再启动第二个写入进程。请检查该 PID 和端口；确认没有服务后，检查并清理 " + path.join(dataDir, ".service-instance.json") + "。切勿在服务进程仍运行时删除锁。");
  }
  const port = await freeLoopbackPort();
  serverChild = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: APP_PATH, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(port), DAGUAN_DATA_DIR: dataDir, DAGUAN_ROOT_DIR: APP_PATH, DAGUAN_WEB_ROOT: WEB_ROOT, DAGUAN_OPEN_BROWSER: "0" }),
  });
  let childOutput = "";
  serverChild.stdout.on("data", (chunk) => { childOutput = (childOutput + chunk).slice(-4000); });
  serverChild.stderr.on("data", (chunk) => { childOutput = (childOutput + chunk).slice(-4000); });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && serverChild.exitCode === null) {
    const candidate = await lock.readServiceOwner(dataDir);
    if (candidate && await lock.waitForServiceOwner(candidate, { timeoutMs: 350 })) { owner = candidate; ownsService = candidate.pid === serverChild.pid; return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const candidate = await lock.readServiceOwner(dataDir);
  if (candidate && await lock.waitForServiceOwner(candidate)) { owner = candidate; ownsService = candidate.pid === serverChild.pid; return; }
  throw new Error("本地服务启动失败。" + (childOutput || "没有收到服务就绪信号。"));
}
async function serveAppRequest(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "daguan:" || requestUrl.hostname !== "app") return new Response("Forbidden", { status: 403 });
  if (requestUrl.pathname.indexOf("/api/") === 0) {
    if (!owner) return new Response("Service unavailable", { status: 503 });
    const target = serviceEndpoint() + requestUrl.pathname + requestUrl.search;
    const init = { method: request.method, headers: policy.proxyHeaders(request.headers), redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = Buffer.from(await request.arrayBuffer());
    try { return await net.fetch(target, init); }
    catch { return new Response(JSON.stringify({ ok: false, error: "本地服务暂时不可用" }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
  }
  let target = policy.resolveWebAsset(WEB_ROOT, requestUrl.pathname);
  if (!target) return new Response("Forbidden", { status: 403 });
  try {
    const stat = await fs.stat(target); if (stat.isDirectory()) target = path.join(target, "index.html");
    const ext = path.extname(target).toLowerCase();
    const noCache = ext === ".html" || path.basename(target) === "service-worker.js";
    const headers = { "Content-Type": MIMES[ext] || "application/octet-stream", "Cache-Control": noCache ? "no-cache" : "public, max-age=3600" };
    if (ext === ".html") headers["Content-Security-Policy"] = policy.APP_CONTENT_SECURITY_POLICY;
    return new Response(await fs.readFile(target), { status: 200, headers });
  } catch { return new Response("Not found", { status: 404 }); }
}
async function switchUi(ui) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.webContents.isLoadingMainFrame()) await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  const target = ui === "old" ? "old" : "new";
  try {
    const currentPageIsLegacy = mainWindow.webContents.getURL().indexOf("legacy.html") >= 0;
    const method = currentPageIsLegacy ? "window.DaguanDesktopSwitch" : "window.App&&window.App.setUiVersion.bind(window.App)";
    return await mainWindow.webContents.executeJavaScript("(async()=>{const switcher=" + method + ";if(typeof switcher!==\"function\")return false;await switcher(" + JSON.stringify(target) + ");return true})()", true);
  } catch { return false; }
}
function validIpc(event) { return mainWindow && event.sender === mainWindow.webContents && policy.isTrustedAppUrl(event.sender.getURL()); }
async function pollServiceRevision() {
  if (quitting || !owner) return;
  try {
    const response = await fetch(serviceEndpoint() + "/api/state", { cache: "no-store", signal: AbortSignal.timeout(1800) });
    if (response.ok) {
      const state = await response.json();
      const revision = Number(state.revision) || 0;
      if (lastServiceRevision !== null && revision > lastServiceRevision && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("daguan:state-changed", revision);
      }
      lastServiceRevision = revision;
    }
  } catch {}
  if (!quitting) revisionPollTimer = setTimeout(pollServiceRevision, 900);
}
function setStartup(enabled) {
  startupEnabled = Boolean(enabled);
  app.setLoginItemSettings({ openAtLogin: startupEnabled, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  buildTrayMenu();
}
async function appendUpdaterLog(entry) {
  try {
    const directory = path.join(dataDirectory(), "logs");
    await fs.mkdir(directory, { recursive: true });
    await fs.appendFile(path.join(directory, "desktop-updater.log"), `${new Date().toISOString()} ${entry}\n`, "utf8");
  } catch {}
}
function sendUpdaterState(state) {
  if (state === "downloaded") updateMenuReady = true;
  else updateMenuReady = Boolean(updater?.getState().updateDownloaded);
  buildTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("daguan:update-state", state);
}
async function stopOwnedServiceForRestart() {
  if (!ownsService || !serverChild || serverChild.exitCode !== null) return true;
  const child = serverChild;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; child.off("exit", onExit); resolve(result); };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    try { child.send({ type: "shutdown" }, (error) => { if (error) finish(false); }); }
    catch { finish(false); }
  });
}
async function installDownloadedUpdate() {
  if (!updater?.getState().updateDownloaded || quitting) return false;
  quitting = true;
  if (revisionPollTimer) clearTimeout(revisionPollTimer);
  if (tray) { tray.destroy(); tray = null; }
  const stopped = await stopOwnedServiceForRestart();
  if (!stopped) {
    quitting = false;
    makeTray();
    void pollServiceRevision();
    dialog.showErrorBox("共享服务仍在运行", "更新暂未安装。桌面版未能确认共享服务已安全退出；请稍后重试。浏览器窗口可继续使用现有服务。");
    return false;
  }
  updater.stop();
  autoUpdater.quitAndInstall();
  return true;
}
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示大观园", click: () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); else { mainWindow.show(); mainWindow.focus(); } } },
    { label: "新版学习区", click: () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); void switchUi("new"); mainWindow.show(); } },
    { label: "旧版学习区", click: () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); void switchUi("old"); mainWindow.show(); } },
    { type: "separator" }, { label: "检查更新…", click: () => { void updater?.checkNow(); } },
    ...(updateMenuReady ? [{ label: "重启并安装已下载更新", click: () => { void updater?.installDownloadedUpdate(); } }] : []),
    { type: "separator" }, { label: "开机启动", type: "checkbox", checked: startupEnabled, click: (item) => setStartup(item.checked) },
    { type: "separator" }, { label: "退出大观园…", click: () => requestQuit() },
  ]));
}
function makeTray() {
  let icon = nativeImage.createFromPath(path.join(WEB_ROOT, "assets", "landing", "local-mark.png"));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(WEB_ROOT, "assets", "math-mark.svg"));
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon); tray.setToolTip("大观园数学学习桌面版");
  tray.on("double-click", () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
  buildTrayMenu();
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 620, show: false,
    icon: path.join(WEB_ROOT, "assets", "landing", "local-mark.png"),
    backgroundColor: "#f6f7f9", autoHideMenuBar: true,
    titleBarStyle: "hidden",
    ...(process.platform !== "darwin" ? { titleBarOverlay: { color: "#ffffff", symbolColor: "#3d4650", height: 42 } } : {}),
    webPreferences: policy.windowPreferences(PRELOAD),
  });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("maximize", () => mainWindow && mainWindow.webContents.send("daguan:maximize-state"));
  mainWindow.on("unmaximize", () => mainWindow && mainWindow.webContents.send("daguan:maximize-state"));
  mainWindow.on("close", (event) => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (policy.navigationAction(url) === "external") void shell.openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (event, url) => { const action = policy.navigationAction(url); if (action === "allow") return; event.preventDefault(); if (action === "external") void shell.openExternal(url); });
  mainWindow.loadURL("daguan://app/index.html?desktop=1"); return mainWindow;
}
async function requestQuit() {
  if (quitPromise) return quitPromise;
  quitPromise = (async () => {
    const detail = ownsService ? "本次桌面版启动了共享服务。退出后，浏览器中打开的学习页会暂时断开；重新打开任一学习页会自动恢复服务。请先完成页面提示的保存操作。" : "当前浏览器服务由其他窗口启动，会继续运行。请先完成页面提示的保存操作。";
    const result = await dialog.showMessageBox(mainWindow, { type: "warning", buttons: ["取消", "退出大观园"], defaultId: 0, cancelId: 0, title: "退出大观园", message: "确定退出吗？", detail });
    if (result.response !== 1) { quitPromise = null; return false; }
    quitting = true; if (tray) { tray.destroy(); tray = null; }
    if (policy.shouldStopService({ owned: ownsService, confirmed: true }) && serverChild && serverChild.exitCode === null) {
      const child = serverChild;
      const stopped = await new Promise((resolve) => {
        const onExit = () => resolve(true);
        child.once("exit", onExit);
        try {
          child.send({ type: "shutdown" }, (error) => {
            if (!error) return;
            child.off("exit", onExit);
            resolve(false);
          });
        } catch { child.off("exit", onExit); resolve(false); }
      });
      if (!stopped) {
        quitting = false; quitPromise = null; makeTray();
        void pollServiceRevision();
        dialog.showErrorBox("共享服务仍在运行", "桌面版未能确认共享服务已安全退出。为避免留下无法管理的服务，窗口仍保持打开；请重试退出。");
        return false;
      }
    }
    updater?.stop();
    app.quit(); return true;
  })();
  return quitPromise;
}

app.whenReady().then(async () => {
  policy = await import(pathToFileURL(path.join(__dirname, "policy.mjs")).href);
  app.setAppUserModelId("com.squirrel.DaguanMathDesktop.DaguanMath");
  startupEnabled = app.getLoginItemSettings().openAtLogin;
  try { await connectOrStartService(); }
  catch (error) { await dialog.showMessageBox({ type: "error", title: "本地服务启动失败", message: error.message, buttons: ["退出"] }); app.quit(); return; }
  protocol.handle("daguan", serveAppRequest);
  session.defaultSession.on("will-download", (event, item, webContents) => {
    if (!mainWindow || webContents !== mainWindow.webContents) { event.preventDefault(); item.cancel(); return; }
    item.setSaveDialogOptions(policy.downloadSaveDialogOptions(app.getPath("downloads"), item.getFilename()));
  });
  ipcMain.handle("daguan:window", (event, action) => {
    if (!validIpc(event)) return false;
    if (action === "minimize") mainWindow.minimize();
    else if (action === "maximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === "close") mainWindow.hide();
    else if (action === "quit") return requestQuit();
    else if (action === "print") mainWindow.webContents.print({ silent: false, printBackground: true });
    else if (action === "switch") return switchUi(mainWindow.webContents.getURL().indexOf("legacy.html") >= 0 ? "new" : "old");
    else return false;
    return true;
  });
  ipcMain.handle("daguan:maximized", (event) => validIpc(event) && mainWindow.isMaximized());
  ipcMain.handle("daguan:app:version", (event) => validIpc(event) ? app.getVersion() : false);
  ipcMain.handle("daguan:update:check", async (event) => {
    if (!validIpc(event) || !updater) return false;
    if (updater.getState().updateDownloaded) return updater.getState();
    await updater.checkNow();
    return updater.getState();
  });
  ipcMain.handle("daguan:update:install", (event) => validIpc(event) && updater ? updater.installDownloadedUpdate() : false);
  ipcMain.handle("daguan:startup", (event, enabled) => { if (!validIpc(event)) return false; setStartup(enabled); return startupEnabled; });
  ipcMain.handle("daguan:startup:get", (event) => validIpc(event) && startupEnabled);
  makeTray(); createWindow();
  updater = createDesktopUpdater({
    app, autoUpdater,
    log: appendUpdaterLog, onState: sendUpdaterState,
  });
  updater.start({ installUpdate: installDownloadedUpdate });
  void pollServiceRevision();
  app.on("activate", () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
}).catch((error) => { console.error(error); app.quit(); });

app.on("before-quit", (event) => { if (!quitting) { event.preventDefault(); void requestQuit(); } else if (revisionPollTimer) clearTimeout(revisionPollTimer); });
app.on("before-quit-for-update", () => { quitting = true; updater?.stop(); if (revisionPollTimer) clearTimeout(revisionPollTimer); });
