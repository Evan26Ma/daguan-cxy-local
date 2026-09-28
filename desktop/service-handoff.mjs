import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readServiceOwner,
  serviceOwnerProcessStatus,
  SERVICE_API_PROTOCOL,
  waitForServiceIdentity,
} from "../local-server/instance-lock.mjs";

const execFileAsync = promisify(execFile);
const STOP_WAIT_MS = 20_000;

function sameOwner(left, right) {
  return Boolean(left && right && left.pid === right.pid && left.port === right.port &&
    left.instanceId === right.instanceId && left.apiProtocol === right.apiProtocol);
}

export function healthMatchesOwner(owner, health) {
  return Boolean(owner && health?.service === "daguan-local-console" &&
    health.instanceId === owner.instanceId && Number(health.pid) === Number(owner.pid) &&
    (!owner.launcherKind || health.launcherKind === owner.launcherKind));
}

export async function windowsProcessImage(pid) {
  if (process.platform !== "win32" || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  const query = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' -ErrorAction Stop; if ($p) { [Console]::Out.Write($p.ExecutablePath) }`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], {
      windowsHide: true, timeout: 3000, maxBuffer: 4096,
    });
    return stdout.trim() || null;
  } catch { return null; }
}

export async function classifyServiceOwner(owner, health, { processImage = windowsProcessImage } = {}) {
  if (!healthMatchesOwner(owner, health)) return "unverified";
  if (owner.launcherKind === "browser") return "browser";
  if (owner.launcherKind === "desktop") return "desktop";
  if (health.launcherKind === "browser" || health.launcherKind === "desktop") return "unverified";
  const image = await processImage(owner.pid);
  const executable = image && path.win32.basename(image).toLowerCase();
  if (executable === "daguanmath-windows-x64.exe") return "browser";
  if (executable === "daguanmath.exe") return "desktop";
  return "unknown";
}

export async function stopBrowserService(owner, dataDir, {
  fetchImpl = fetch,
  readOwner = readServiceOwner,
  processStatus = serviceOwnerProcessStatus,
  timeoutMs = STOP_WAIT_MS,
} = {}) {
  if (owner.apiProtocol !== SERVICE_API_PROTOCOL) throw new Error("旧服务协议未知，无法安全交接");
  if (!sameOwner(await readOwner(dataDir), owner)) throw new Error("服务实例锁已变化，已停止交接");
  const health = await waitForServiceIdentity(owner, { timeoutMs: 3000, fetchImpl });
  if (!healthMatchesOwner(owner, health) || health.apiProtocol !== SERVICE_API_PROTOCOL) {
    throw new Error("旧服务健康检查未确认身份，无法安全交接");
  }
  if (processStatus(owner.pid) !== "alive") throw new Error("旧服务 PID 状态已变化，已停止交接");
  const origin = `http://${owner.host}:${owner.port}`;
  const response = await fetchImpl(`${origin}/api/runtime/stop`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(3000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error("旧服务未确认优雅停止请求");

  const lockPath = path.join(path.resolve(dataDir), ".service-instance.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readOwner(dataDir);
    if (current && !sameOwner(current, owner)) throw new Error("服务实例锁在交接期间被其他进程占用");
    const lockExists = await fs.access(lockPath).then(() => true, () => false);
    if (!current && !lockExists && processStatus(owner.pid) === "absent") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("旧服务未在期限内退出并释放实例锁");
}
