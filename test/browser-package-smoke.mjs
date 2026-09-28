import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-browser-package-"));
const exe = path.join(root, "dist", "DaguanMath-windows-x64.exe");
const child = spawn(exe, [], {
  cwd: root,
  env: { ...process.env, DAGUAN_RUNTIME_ROOT: tempRoot, DAGUAN_NO_BROWSER: "1" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let output = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
try {
  const lockPath = path.join(tempRoot, "data", ".service-instance.json");
  const deadline = Date.now() + 30_000;
  let owner, health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`browser package exited: ${output}`);
    try {
      owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      const response = await fetch(`http://127.0.0.1:${owner.port}/api/health`, { signal: AbortSignal.timeout(500) });
      health = await response.json();
      if (response.ok && health.instanceId === owner.instanceId) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(owner?.pid, child.pid, output);
  assert.equal(owner?.launcherKind, "browser");
  assert.equal(health?.launcherKind, "browser");
  const html = await fetch(`http://127.0.0.1:${owner.port}/index.html`).then(response => response.text());
  const legacy = await fetch(`http://127.0.0.1:${owner.port}/legacy.html`).then(response => response.text());
  assert.match(html, /browser-retirement\.js/);
  assert.match(legacy, /browser-retirement\.js/);
  const migrationScript = await fetch(`http://127.0.0.1:${owner.port}/browser-retirement.js`).then(response => response.text());
  assert.match(migrationScript, /releases\/download\/v1\.0\.2\/DaguanMathDesktop-Setup\.exe/);
  const origin = `http://127.0.0.1:${owner.port}`;
  const stopped = await fetch(`${origin}/api/runtime/stop`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(stopped.status, 200);
  await Promise.race([once(child, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("browser package did not exit")), 10_000))]);
  assert.equal(await fs.access(lockPath).then(() => true, () => false), false);
  console.log(JSON.stringify({ browserPid: child.pid, port: owner.port, kind: health.launcherKind, retirementPages: 2 }));
} finally {
  if (child.exitCode === null) child.kill();
  const resolved = path.resolve(tempRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("daguan-browser-package-")) {
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
}
