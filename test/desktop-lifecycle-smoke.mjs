import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const playwright = require(process.env.DAGUAN_PLAYWRIGHT_MODULE || "playwright");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-desktop-lifecycle-"));
const dataDir = path.join(tempRoot, "data");
const profileDir = path.join(tempRoot, "profile");
await fs.mkdir(dataDir, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check().catch(() => null);
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise(resolve => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("exit", resolve);
    });
  } else child.kill("SIGTERM");
}
function visibleWindowsForPid(pid) {
  if (process.platform !== "win32") return null;
  const ps = `Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;
public class DaguanWinCheck{[DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr x);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);public delegate bool EnumWindowsProc(IntPtr h,IntPtr x);}
'@; $script:items=[System.Collections.Generic.List[object]]::new(); [void][DaguanWinCheck]::EnumWindows({param($h,$x)[uint32]$p=0;[void][DaguanWinCheck]::GetWindowThreadProcessId($h,[ref]$p);if($p -eq ${pid}){$b=[Text.StringBuilder]::new(512);[void][DaguanWinCheck]::GetWindowText($h,$b,512);$script:items.Add([pscustomobject]@{visible=[DaguanWinCheck]::IsWindowVisible($h);title=$b.ToString()})};return $true},[IntPtr]::Zero); ConvertTo-Json -InputObject @($script:items.ToArray()) -Compress`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 10_000 }).trim();
  return output ? JSON.parse(output) : [];
}
function sendNativeCloseForPid(pid) {
  if (process.platform !== "win32") return false;
  const ps = `Add-Type @'
using System;using System.Runtime.InteropServices;
public class DaguanNativeClose{[DllImport("user32.dll")]public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr x);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);public delegate bool EnumWindowsProc(IntPtr h,IntPtr x);}
'@; $script:closed=$false; [void][DaguanNativeClose]::EnumWindows({param($h,$x)[uint32]$p=0;[void][DaguanNativeClose]::GetWindowThreadProcessId($h,[ref]$p);if($p -eq ${pid} -and [DaguanNativeClose]::IsWindowVisible($h)){$script:closed=[DaguanNativeClose]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)};return $true},[IntPtr]::Zero); [Console]::WriteLine($script:closed)`;
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 10_000 }).trim() === "True";
}

const servicePort = await freePort();
const cdpPort = await freePort();
let desktopPid = null;
const service = spawn(process.execPath, [path.join(root, "local-server", "server.mjs")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(servicePort), DAGUAN_DATA_DIR: dataDir, DAGUAN_OPEN_BROWSER: "0" },
});
let desktop;
let browser;
try {
  await waitFor(async () => {
    const owner = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
    const health = await fetch(`http://127.0.0.1:${servicePort}/api/health`).then(response => response.json());
    return owner.pid === service.pid && health.instanceId === owner.instanceId ? owner : null;
  }, "browser-owned local service");

  const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  desktop = spawn(electron, [".", `--remote-debugging-port=${cdpPort}`], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, DAGUAN_DATA_DIR: dataDir, DAGUAN_USER_DATA_DIR: profileDir },
  });
  desktopPid = desktop.pid;
  const cdp = `http://127.0.0.1:${cdpPort}`;
  await waitFor(async () => (await fetch(`${cdp}/json/version`).then(response => response.ok)) ? true : null, "Electron CDP endpoint");
  browser = await playwright.chromium.connectOverCDP(cdp);
  const page = await waitFor(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith("daguan://app/")), "desktop stable app source");
  const rootResponse = await page.goto("daguan://app/");
  await page.waitForSelector("#daguan-desktop-bar");
  const rootEvidence = await page.evaluate(() => ({ href: location.href, title: document.title, barVisible: Boolean(document.querySelector("#daguan-desktop-bar")) }));
  assert.equal(rootResponse?.status(), 200, "daguan://app/ should serve the app root successfully");
  const windowsBeforeHide = visibleWindowsForPid(desktop.pid);

  const ownerBeforeHide = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  assert.equal(ownerBeforeHide.pid, service.pid, "desktop should attach to the browser-owned service PID");
  assert.equal(await fetch(`http://127.0.0.1:${servicePort}/api/health`).then(r => r.ok), true);
  assert.equal(sendNativeCloseForPid(desktop.pid), true, "native WM_CLOSE should reach the Electron window");
  await delay(500);
  const hiddenVisibility = await page.evaluate(() => document.visibilityState);
  const pageTargetStillAttached = !page.isClosed();
  const windowsAfterHide = visibleWindowsForPid(desktop.pid);
  const nativeWindowHidden = Array.isArray(windowsBeforeHide) && windowsBeforeHide.some(item => item.visible) && Array.isArray(windowsAfterHide) && !windowsAfterHide.some(item => item.visible);
  const stillAliveAfterHide = desktop.exitCode === null;
  const ownerAfterHide = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  const serviceHealthyAfterHide = await fetch(`http://127.0.0.1:${servicePort}/api/health`).then(r => r.ok);
  assert.equal(stillAliveAfterHide, true, "closing the window should leave the tray app process running");
  assert.equal(pageTargetStillAttached, true, "the renderer should remain alive while its BrowserWindow is hidden to the tray");
  assert.equal(nativeWindowHidden, true, "the BrowserWindow should be hidden while the tray process and renderer remain alive");
  assert.equal(ownerAfterHide.instanceId, ownerBeforeHide.instanceId);
  assert.equal(serviceHealthyAfterHide, true, "tray hiding should not stop the shared service");

  await browser.close();
  browser = null;
  await killTree(desktop);
  desktop = null;
  const preservedOwner = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  const serviceSurvivedDesktopExit = preservedOwner.instanceId === ownerBeforeHide.instanceId && await fetch(`http://127.0.0.1:${servicePort}/api/health`).then(r => r.ok);
  assert.equal(serviceSurvivedDesktopExit, true, "the browser-owned service must survive desktop process exit");
  console.log(JSON.stringify({
    launchOrder: "browser service -> Electron desktop",
    dataDir,
    browserServicePid: service.pid,
    desktopPid,
    ownerPid: ownerBeforeHide.pid,
    instanceId: ownerBeforeHide.instanceId,
    rootStatus: rootResponse.status(),
    rootEvidence,
    afterWindowClose: { documentVisibility: hiddenVisibility, rendererTargetStillAttached: pageTargetStillAttached, desktopProcessAlive: stillAliveAfterHide, nativeWindowHidden, windowsBeforeHide, windowsAfterHide, serviceHealthy: serviceHealthyAfterHide, ownerPid: ownerAfterHide.pid },
    afterDesktopExit: { browserOwnedServiceStillHealthy: serviceSurvivedDesktopExit, ownerPid: preservedOwner.pid, instanceId: preservedOwner.instanceId },
    isolatedDirectory: tempRoot,
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  await killTree(desktop);
  if (service && service.exitCode === null) {
    await new Promise(resolve => {
      service.once("exit", resolve);
      try { service.send({ type: "shutdown" }, error => { if (error) { service.kill("SIGTERM"); resolve(); } }); }
      catch { service.kill("SIGTERM"); resolve(); }
    });
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
