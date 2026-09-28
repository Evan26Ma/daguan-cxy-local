import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close((error) => error ? reject(error) : resolve(port)); });
  });
}

test("browser package stop endpoint rejects cross-origin requests and shuts down gracefully", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-runtime-stop-"));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, "local-server", "server.mjs")], {
    cwd: ROOT,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DAGUAN_DATA_DIR: path.join(temp, "data"), DAGUAN_ROOT_DIR: ROOT, DAGUAN_WEB_ROOT: path.join(ROOT, "web"), DAGUAN_OPEN_BROWSER: "0" },
  });
  t.after(async () => {
    if (child.exitCode == null) child.kill();
    await fs.rm(temp, { recursive: true, force: true });
  });

  const endpoint = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { health = await fetch(`${endpoint}/api/health`); if (health.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(health?.status, 200);

  const rejected = await fetch(`${endpoint}/api/runtime/stop`, { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(rejected.status, 403);
  assert.equal(child.exitCode, null);

  const accepted = await fetch(`${endpoint}/api/runtime/stop`, { method: "POST", headers: { Origin: endpoint, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(accepted.status, 200);
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("service did not stop cleanly")), 5000);
    child.once("exit", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
  });
  assert.equal(exit.code, 0);
  assert.equal(await fs.access(path.join(temp, "data", ".service-instance.json")).then(() => true, () => false), false);
});
