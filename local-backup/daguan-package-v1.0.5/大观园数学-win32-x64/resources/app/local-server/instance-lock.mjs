import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_NAME = ".service-instance.json";
const RECOVERY_NAME = ".service-instance-recovery.json";
export const SERVICE_API_PROTOCOL = 1;
const MALFORMED_LOCK_GRACE_MS = 15_000;
const OWNER_WAIT_MS = 8_000;

export function serviceOwnerProcessStatus(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return "unknown";
  try {
    process.kill(Number(pid), 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "absent";
    return error?.code === "EPERM" ? "alive" : "unknown";
  }
}

async function readOwner(lockPath) {
  try {
    const text = await fs.readFile(lockPath, "utf8");
    try { return { owner: JSON.parse(text), malformed: false, text }; }
    catch { return { owner: null, malformed: true, text }; }
  } catch (error) {
    if (error?.code === "ENOENT") return { owner: null, malformed: false, text: null };
    return { owner: null, malformed: true, text: null };
  }
}

function validOwner(owner) {
  return owner && owner.version === 1 && Number.isInteger(Number(owner.pid)) && Number(owner.pid) > 0 &&
    typeof owner.instanceId === "string" && owner.host === "127.0.0.1" &&
    Number.isInteger(Number(owner.port)) && Number(owner.port) > 0 && Number(owner.port) <= 65535;
}

async function recoveryGate(dataDir) {
  const gatePath = path.join(dataDir, RECOVERY_NAME);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(gatePath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, startedAt: Date.now() })}\n`, "utf8");
      await handle.sync();
      return async () => {
        await handle.close().catch(() => {});
        const { owner } = await readOwner(gatePath);
        if (owner?.token === token && owner?.pid === process.pid) await fs.rm(gatePath, { force: true }).catch(() => {});
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      const before = await readOwner(gatePath);
      const stat = await fs.stat(gatePath).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS ||
          (Number.isInteger(Number(before.owner?.pid)) && serviceOwnerProcessStatus(before.owner.pid) !== "absent")) return null;
      const after = await readOwner(gatePath);
      if (before.text !== after.text || before.text === null) return null;
      await fs.rm(gatePath, { force: true }).catch(() => {});
    }
  }
  return null;
}

export async function readServiceOwner(dataDir) {
  const lockPath = path.join(path.resolve(dataDir), LOCK_NAME);
  const { owner } = await readOwner(lockPath);
  return validOwner(owner) ? owner : null;
}

export async function acquireServiceInstance(dataDir, { host = "127.0.0.1", port = 8080 } = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  await fs.mkdir(resolvedDataDir, { recursive: true });
  const lockPath = path.join(resolvedDataDir, LOCK_NAME);
  const instanceId = randomUUID();
  const launcherKind = ["browser", "desktop"].includes(process.env.DAGUAN_LAUNCHER_KIND)
    ? process.env.DAGUAN_LAUNCHER_KIND : null;
  const owner = {
    version: 1,
    apiProtocol: SERVICE_API_PROTOCOL,
    pid: process.pid,
    host,
    port,
    instanceId,
    startedAt: new Date().toISOString(),
    dataDir: resolvedDataDir,
    ...(launcherKind ? { launcherKind } : {}),
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

      const snapshot = await readOwner(lockPath);
      const { owner: existing } = snapshot;
      const malformed = snapshot.malformed || (snapshot.text !== null && !validOwner(existing));
      if (validOwner(existing) && serviceOwnerProcessStatus(existing.pid) !== "absent") {
        return { acquired: false, owner: existing };
      }
      if (malformed) {
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS) {
          return { acquired: false, owner: null, recovering: true };
        }
      }

      if (snapshot.text === null) return { acquired: false, owner: null, recovering: true };
      const releaseRecovery = await recoveryGate(resolvedDataDir);
      if (!releaseRecovery) return { acquired: false, owner: null, recovering: true };
      try {
        const current = await readOwner(lockPath);
        if (current.text !== snapshot.text) return { acquired: false, owner: current.owner, recovering: true };
        if (validOwner(current.owner) && serviceOwnerProcessStatus(current.owner.pid) !== "absent") {
          return { acquired: false, owner: current.owner };
        }
        if (current.malformed || !validOwner(current.owner)) {
          const stat = await fs.stat(lockPath).catch(() => null);
          if (!stat || Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS) {
            return { acquired: false, owner: null, recovering: true };
          }
        }
        await fs.rm(lockPath, { force: true });
      } finally { await releaseRecovery(); }
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
  const health = await waitForServiceIdentity(owner, { timeoutMs, fetchImpl });
  return Boolean(health && health.apiProtocol === SERVICE_API_PROTOCOL && owner.apiProtocol === SERVICE_API_PROTOCOL);
}

export async function waitForServiceIdentity(owner, { timeoutMs = OWNER_WAIT_MS, fetchImpl = fetch } = {}) {
  if (!validOwner(owner)) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetchImpl(`http://${owner.host}:${owner.port}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(500),
      });
      const health = await response.json();
      if (response.ok && health?.service === "daguan-local-console" &&
          health.instanceId === owner.instanceId && Number(health.pid) === Number(owner.pid) &&
          (!owner.launcherKind || health.launcherKind === owner.launcherKind)) return health;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export function serviceOwnerUrl(owner) {
  if (!validOwner(owner)) return null;
  return `http://${owner.host}:${owner.port}/index.html`;
}
