const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, net, protocol, shell, session, ipcMain, autoUpdater, safeStorage } = require("electron");
if (require("electron-squirrel-startup")) app.quit();
const fs = require("node:fs/promises");
const netNode = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createDesktopUpdater } = require("./updater.cjs");
const { createRemoteGateway } = require("./remote-gateway.cjs");
const { createTunnelManager } = require("./cloudflare-tunnel.cjs");


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
let remoteGateway = null, remoteTunnel = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

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
async function stopStartupChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.send({ type: "shutdown" }); } catch {}
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}
async function startServiceCandidate(dataDir, port) {
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: APP_PATH, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(port),
      DAGUAN_DATA_DIR: dataDir, DAGUAN_ROOT_DIR: APP_PATH, DAGUAN_WEB_ROOT: WEB_ROOT,
      DAGUAN_OPEN_BROWSER: "0", DAGUAN_LAUNCHER_KIND: "desktop", DAGUAN_AUTO_UPDATE_BANK: "1",
    }),
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
  try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const candidate = await lock.readServiceOwner(dataDir);
      if (candidate) {
        const health = await lock.waitForServiceIdentity(candidate, { timeoutMs: 350 });
        if (health) {
          if (candidate.pid === child.pid && health.apiProtocol === lock.SERVICE_API_PROTOCOL) {
            serverChild = child;
            return { owner: candidate, own: true };
          }
          if (candidate.pid !== child.pid) {
            await stopStartupChild(child);
            if (child.exitCode === null && child.signalCode === null) throw new Error("竞争启动的服务进程未退出");
            return { owner: candidate, health, own: false };
          }
          throw new Error("新服务协议不兼容");
        }
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const candidate = await lock.readServiceOwner(dataDir);
    if (candidate && candidate.pid !== child.pid) {
      const health = await lock.waitForServiceIdentity(candidate);
      if (health) return { owner: candidate, health, own: false };
    }
    throw new Error("本地服务启动失败。" + (output || "没有收到服务就绪信号。"));
  } catch (error) {
    await stopStartupChild(child);
    throw error;
  }
}
async function connectOrStartService() {
  const dataDir = dataDirectory();
  lock = await import(pathToFileURL(path.join(APP_PATH, "local-server", "instance-lock.mjs")).href);
  const handoff = await import(pathToFileURL(path.join(APP_PATH, "desktop", "service-handoff.mjs")).href);
  let preferredPort = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await lock.readServiceOwner(dataDir);
    if (existing) {
      const status = lock.serviceOwnerProcessStatus(existing.pid);
      if (status !== "absent") {
        const health = await lock.waitForServiceIdentity(existing);
        if (!health) throw new Error(`服务实例 PID ${existing.pid}、端口 ${existing.port} 健康检查失败；进程状态为${status === "alive" ? "存活" : "不明"}。桌面版无法确认安全交接，请检查该进程；服务运行时切勿删除实例锁。`);
        const kind = await handoff.classifyServiceOwner(existing, health);
        if (kind === "desktop" && health.apiProtocol === lock.SERVICE_API_PROTOCOL && existing.apiProtocol === lock.SERVICE_API_PROTOCOL) {
          owner = existing; ownsService = false; return;
        }
        if (kind !== "browser") throw new Error(`服务实例 PID ${existing.pid}、端口 ${existing.port} 的来源无法确认，桌面版不会停止该进程。`);
        await handoff.stopBrowserService(existing, dataDir);
      }
      preferredPort = existing.port;
    }
    const result = await startServiceCandidate(dataDir, preferredPort || await freeLoopbackPort());
    if (result.own) { owner = result.owner; ownsService = true; return; }
    // Another launcher won the instance lock while this desktop window started.
    // Reinspect it instead of attaching to a browser service that should hand off.
    preferredPort = result.owner.port;
  }
  throw new Error("浏览器服务持续抢占同一数据目录，桌面版未能安全完成交接。请先退出浏览器版启动器。" );
}
async function serveAppRequest(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== "daguan:" || requestUrl.hostname !== "app") return new Response("Forbidden", { status: 403 });
  if (requestUrl.pathname.indexOf("/api/") === 0 || requestUrl.pathname.indexOf("/data/") === 0) {
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
function validIpc(event) { return mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && policy.isTrustedAppUrl(event.sender.getURL()); }
async function remoteStatus() {
  const result = { ...remoteTunnel.status(), passwordSet: remoteGateway.hasPassword(), serviceOnline: false };
  try { result.serviceOnline = (await fetch(serviceEndpoint() + '/api/health', { signal: AbortSignal.timeout(1200) })).ok; } catch {}
  return result;
}
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
  await remoteTunnel?.stop();
  await remoteGateway?.stop();
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
    await remoteTunnel?.stop();
    await remoteGateway?.stop();
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
  if (!hasSingleInstanceLock) return;
  policy = await import(pathToFileURL(path.join(__dirname, "policy.mjs")).href);
  app.setAppUserModelId("com.squirrel.DaguanMathDesktop.DaguanMath");
  startupEnabled = app.getLoginItemSettings().openAtLogin;
  try { await connectOrStartService(); }
  catch (error) { await dialog.showMessageBox({ type: "error", title: "本地服务启动失败", message: error.message, buttons: ["退出"] }); app.quit(); return; }
  try {
    const userData = app.getPath('userData');
    let savedPort = 0;
    try { const saved = JSON.parse(await fs.readFile(path.join(userData, 'remote-tunnel.json'), 'utf8')); if (saved.version === 1 && Number.isInteger(saved.port) && saved.port > 0 && saved.port < 65536) savedPort = saved.port; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    remoteGateway = createRemoteGateway({ authFile: path.join(userData, 'remote-auth.json'), upstream: serviceEndpoint, port: savedPort, getMode: () => remoteTunnel?.status().mode || 'off' });
    await remoteGateway.init();
    remoteTunnel = createTunnelManager({ userData, gateway: remoteGateway,
      encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，无法保存 Tunnel 令牌'); return safeStorage.encryptString(value); },
      decrypt: bytes => safeStorage.decryptString(bytes),
    });
    await remoteTunnel.init();
    if (remoteTunnel.namedEnabled()) void remoteTunnel.startNamed().catch(error => console.error('固定地址启动失败：', error.message));
  } catch (error) { console.error('外网访问初始化失败：', error.message); }
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
  ipcMain.handle('daguan:remote', async (event, action, input) => {
    if (!validIpc(event) || !remoteGateway || !remoteTunnel) return { error: '仅可在本机桌面版管理外网访问' };
    try {
      if (action === 'status') return remoteStatus();
      if (action === 'password') await remoteGateway.setPassword(input?.password, input?.oldPassword);
      else if (action === 'revoke') await remoteGateway.revokeSessions();
      else if (action === 'quick:start') await remoteTunnel.startQuick();
      else if (action === 'stop') await remoteTunnel.stop();
      else if (action === 'named:setup') await remoteTunnel.setupNamed(input || {});
      else if (action === 'named:disable') await remoteTunnel.disableNamed();
      else if (action === 'named:enable') await remoteTunnel.enableNamed();
      else if (action === 'download') await remoteTunnel.download();
      else return { error: '未知操作' };
      return remoteStatus();
    } catch (error) { return { ...(await remoteStatus()), operationError: error.message }; }
  });
  makeTray(); createWindow();
  updater = createDesktopUpdater({
    app, autoUpdater,
    log: appendUpdaterLog, onState: sendUpdaterState,
  });
  updater.start({ installUpdate: installDownloadedUpdate });
  void pollServiceRevision();
  app.on("activate", () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
}).catch((error) => { console.error(error); app.quit(); });

app.on("before-quit", (event) => { if (!hasSingleInstanceLock) return; if (!quitting) { event.preventDefault(); void requestQuit(); } else if (revisionPollTimer) clearTimeout(revisionPollTimer); });
app.on("before-quit-for-update", () => { quitting = true; updater?.stop(); if (revisionPollTimer) clearTimeout(revisionPollTimer); });
