import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_NAME = ".service-instance.json";
export const SERVICE_API_PROTOCOL = 1;
const MALFORMED_LOCK_GRACE_MS = 15_000;
const OWNER_WAIT_MS = 3_000;

function processExists(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readOwner(lockPath) {
  try {
    const text = await fs.readFile(lockPath, "utf8");
    return { owner: JSON.parse(text), malformed: false };
  } catch (error) {
    if (error?.code === "ENOENT") return { owner: null, malformed: false };
    return { owner: null, malformed: true };
  }
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

      const { owner: existing, malformed } = await readOwner(lockPath);
      if (validOwner(existing) && processExists(existing.pid)) {
        return { acquired: false, owner: existing };
      }
      if (malformed) {
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs < MALFORMED_LOCK_GRACE_MS) {
          return { acquired: false, owner: null, recovering: true };
        }
      }

      // Only reclaim an owner whose PID is gone, or a malformed file left behind by a crash.
      await fs.rm(lockPath, { force: true }).catch(() => {});
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
