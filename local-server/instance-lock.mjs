import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_NAME = ".service-instance.json";
const RECOVERY_LOCK_NAME = ".service-instance.recovery";
export const SERVICE_API_PROTOCOL = 1;
const MALFORMED_LOCK_GRACE_MS = 15_000;
const OWNER_WAIT_MS = 3_000;

function processStatus(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return "unknown";
  try {
    process.kill(Number(pid), 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "gone";
    if (error?.code === "EPERM") return "alive";
    return "unknown";
  }
}

function sameOwner(left, right) {
  return validOwner(left) && validOwner(right) && left.version === right.version &&
    left.apiProtocol === right.apiProtocol && left.pid === right.pid &&
    left.instanceId === right.instanceId && left.startedAt === right.startedAt &&
    left.host === right.host && left.port === right.port && left.dataDir === right.dataDir;
}

async function readOwner(lockPath) {
  let text;
  try {
    text = await fs.readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { owner: null, malformed: false, text: null };
    return { owner: null, malformed: true, text: null };
  }
  try { return { owner: JSON.parse(text), malformed: false, text }; }
  catch { return { owner: null, malformed: true, text }; }
}

async function acquireRecoveryLock(dataDir) {
  const lockPath = path.join(dataDir, RECOVERY_LOCK_NAME);
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, token })}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") return null;
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      try {
        const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
        if (current.token === token && current.pid === process.pid) await fs.rm(lockPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
  };
}

function validOwner(owner) {
  return owner && owner.version === 1 && Number.isInteger(Number(owner.pid)) &&
    typeof owner.instanceId === "string" && owner.host === "127.0.0.1" &&
    Number.isInteger(Number(owner.port));
}

export async function readServiceOwner(dataDir) {
  const lockPath = path.join(path.resolve(dataDir), LOCK_NAME);
  const { owner } = await readOwner(lockPath);
  return validOwner(owner) ? owner : null;
}

export async function isServiceOwnerProcessGone(dataDir, expectedOwner) {
  if (!validOwner(expectedOwner)) return false;
  const lockPath = path.join(path.resolve(dataDir), LOCK_NAME);
  const { owner: current } = await readOwner(lockPath);
  if (!sameOwner(current, expectedOwner) || processStatus(current.pid) !== "gone") return false;

  // Do not authorize recovery if another launcher replaced the lease during the PID check.
  const { owner: confirmed } = await readOwner(lockPath);
  return sameOwner(confirmed, expectedOwner);
}

export async function acquireServiceInstance(dataDir, { host = "127.0.0.1", port = 8080 } = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  await fs.mkdir(resolvedDataDir, { recursive: true });
  const lockPath = path.join(resolvedDataDir, LOCK_NAME);
  const instanceId = randomUUID();
  const owner = {
    version: 1,
    apiProtocol: SERVICE_API_PROTOCOL,
    pid: process.pid,
    host,
    port,
    instanceId,
    startedAt: new Date().toISOString(),
    dataDir: resolvedDataDir,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;

      const { owner: existing, malformed, text: observedText } = await readOwner(lockPath);
      if (validOwner(existing)) {
        const status = processStatus(existing.pid);
        if (status !== "gone") return { acquired: false, owner: existing };
      }
      if (observedText === null) continue;
      if (malformed) {
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS) {
          return { acquired: false, owner: null, recovering: true };
        }
      }

      // Serialize stale-lock removal: another launcher must not remove a newly-created owner.
      const recoveryLock = await acquireRecoveryLock(resolvedDataDir);
      if (!recoveryLock) return { acquired: false, owner: null, recovering: true };
      try {
        const { owner: current, malformed: currentMalformed, text: currentText } = await readOwner(lockPath);
        if (currentText === null) continue;
        if (currentText !== observedText) {
          if (validOwner(current) && processStatus(current.pid) !== "gone") {
            return { acquired: false, owner: current };
          }
          continue;
        }
        if (validOwner(current) && processStatus(current.pid) !== "gone") {
          return { acquired: false, owner: current };
        }
        if (currentMalformed) {
          const stat = await fs.stat(lockPath).catch(() => null);
          if (stat && Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS) {
            return { acquired: false, owner: null, recovering: true };
          }
        }
        const { text: finalText } = await readOwner(lockPath);
        if (finalText !== currentText) continue;
        await fs.rm(lockPath);
      } finally {
        await recoveryLock.release();
      }
      continue;
    }

    let released = false;
    return {
      acquired: true,
      owner,
      async release() {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        const { owner: current } = await readOwner(lockPath);
        if (current?.instanceId === instanceId && current?.pid === process.pid) {
          await fs.rm(lockPath, { force: true }).catch(() => {});
        }
      },
    };
  }

  const { owner: existing } = await readOwner(lockPath);
  if (validOwner(existing)) return { acquired: false, owner: existing };
  return { acquired: false, owner: null, recovering: true };
}

export async function waitForServiceOwner(owner, { timeoutMs = OWNER_WAIT_MS, fetchImpl = fetch } = {}) {
  if (!validOwner(owner)) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetchImpl(`http://${owner.host}:${owner.port}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(500),
      });
      const health = await response.json();
      if (response.ok && health?.service === "daguan-local-console" &&
          health.apiProtocol === SERVICE_API_PROTOCOL && owner.apiProtocol === SERVICE_API_PROTOCOL &&
          health.instanceId === owner.instanceId) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function serviceOwnerUrl(owner) {
  if (!validOwner(owner)) return null;
  return `http://${owner.host}:${owner.port}/index.html`;
}
