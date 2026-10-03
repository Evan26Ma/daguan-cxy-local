import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { acquireServiceInstance, isServiceOwnerProcessGone } from "../local-server/instance-lock.mjs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyServiceOwner, stopBrowserService } from "../desktop/service-handoff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const running = new Set();
const tempDirs = new Set();

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function tempDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-service-instance-"));
  tempDirs.add(dir);
  return dir;
}

function startServer(dataDir, port, launcher) {
  let output = "";
  const child = spawn(process.execPath, [path.join(ROOT, "local-server", "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DAGUAN_DATA_DIR: dataDir,
      DAGUAN_LAUNCHER_KIND: launcher,
      DAGUAN_OPEN_BROWSER: "0",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.outputText = () => output;
  child.once("close", () => running.delete(child));
  running.add(child);
  return child;
}

async function waitReady(child, port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`服务进程提前退出（${child.exitCode}）：${child.outputText()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) });
      const health = await response.json();
      if (response.ok && health.service === "daguan-local-console") return health;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`服务未在期限内启动：${child.outputText()}`);
}

async function waitClosed(child, timeoutMs = 5000) {
  if (child.exitCode != null) return { code: child.exitCode, output: child.outputText() };
  const closed = once(child, "close");
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`服务退出超时：${child.outputText()}`)), timeoutMs));
  const [code] = await Promise.race([closed, timeout]);
  return { code, output: child.outputText() };
}

async function stop(child, signal = null) {
  if (child.exitCode != null) return;
  if (signal) child.kill(signal);
  else child.send({ type: "shutdown" });
  await waitClosed(child);
}

async function jsonRequest(port, pathname, { method = "GET", revision, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(revision == null ? {} : { "If-Match": String(revision) }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: response.status, value: await response.json() };
}

async function createEventReader(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/state/events`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  return {
    async next() {
      while (true) {
        const boundary = pending.indexOf("\n\n");
        if (boundary >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (event && data) return { event, data: JSON.parse(data) };
          continue;
        }
        const { done, value } = await reader.read();
        if (done) return null;
        pending += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      }
    },
    close() { return reader.cancel(); },
  };
}

test.afterEach(async () => {
  for (const child of [...running]) await stop(child).catch(() => {});
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
  tempDirs.clear();
});

for (const [first, second] of [["browser", "desktop"], ["desktop", "browser"]]) {
  test(`${first} 首先启动时，${second} 启动连接同一数据服务`, async () => {
    const dataDir = await tempDataDir();
    const firstPort = await unusedPort();
    const secondPort = await unusedPort();
    const owner = startServer(dataDir, firstPort, first);
    const health = await waitReady(owner, firstPort);
    assert.equal(health.apiProtocol, 1);
    const client = startServer(dataDir, secondPort, second);
    const result = await waitClosed(client);

    assert.equal(result.code, 0, result.output);
    assert.match(result.output, new RegExp(`SERVICE_INSTANCE_REUSED http://127\\.0\\.0\\.1:${firstPort}/index\\.html`));
    const reused = await fetch(`http://127.0.0.1:${firstPort}/api/health`).then((response) => response.json());
    assert.equal(reused.instanceId, health.instanceId);
    assert.notEqual(firstPort, secondPort);
  });
}

test("桌面版优雅接管浏览器服务，原端口和学习记录保持可用", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const browser = startServer(dataDir, port, "browser");
  const browserHealth = await waitReady(browser, port);
  const oldOwner = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  assert.equal(oldOwner.launcherKind, "browser");
  assert.equal(browserHealth.launcherKind, "browser");
  assert.equal(await classifyServiceOwner(oldOwner, browserHealth), "browser");
  const saved = await jsonRequest(port, "/api/state/questions/31006", {
    method: "PATCH", revision: 0, body: { mastery: "learning", favorite: true },
  });
  assert.equal(saved.status, 200);

  await stopBrowserService(oldOwner, dataDir);
  assert.equal((await waitClosed(browser)).code, 0);
  assert.equal(await fs.access(path.join(dataDir, ".service-instance.json")).then(() => true, () => false), false);
  const desktop = startServer(dataDir, port, "desktop");
  const desktopHealth = await waitReady(desktop, port);
  assert.equal(desktopHealth.launcherKind, "desktop");
  assert.notEqual(desktopHealth.instanceId, browserHealth.instanceId);
  assert.equal((await jsonRequest(port, "/api/state")).value.progress["31006"].favorite, true);
});

test("共享服务的做题历史接口按题去重并支持删除与清空", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const child = startServer(dataDir, port, "desktop");
  await waitReady(child, port);
  const visits = await Promise.all(Array.from({ length: 12 }, (_, index) => jsonRequest(port, "/api/visit-history", {
    method: "POST", body: { question_id: String(index % 3 + 1), category_id: "223", chapter_id: "601", visited_at: new Date(Date.now() + index).toISOString() },
  })));
  assert.ok(visits.every(result => result.status === 200));
  assert.equal((await jsonRequest(port, "/api/visit-history")).value.entries.length, 3);
  assert.equal((await jsonRequest(port, "/api/visit-history/2", { method: "DELETE" })).status, 200);
  assert.equal((await jsonRequest(port, "/api/visit-history")).value.entries.length, 2);
  assert.equal((await jsonRequest(port, "/api/visit-history", { method: "DELETE" })).status, 200);
  assert.equal((await jsonRequest(port, "/api/visit-history")).value.entries.length, 0);
  await stop(child);
});

test("旧浏览器进程只有身份与 Windows 映像都匹配时才可识别", async () => {
  const owner = { pid: 123, port: 8080, instanceId: "legacy", apiProtocol: 1 };
  const health = { service: "daguan-local-console", pid: 123, instanceId: "legacy", apiProtocol: 1 };
  assert.equal(await classifyServiceOwner(owner, health, { processImage: async () => "C:\\Apps\\DaguanMath-windows-x64.exe" }), "browser");
  assert.equal(await classifyServiceOwner(owner, health, { processImage: async () => "C:\\Apps\\DaguanMath.exe" }), "desktop");
  assert.equal(await classifyServiceOwner(owner, { ...health, instanceId: "different" }, { processImage: async () => "C:\\Apps\\DaguanMath-windows-x64.exe" }), "unverified");
  assert.equal(await classifyServiceOwner(owner, health, { processImage: async () => null }), "unknown");
});

test("交接前实例锁发生变化时不会向旧端口发送停止请求", async () => {
  const owner = { pid: process.pid, port: 8080, instanceId: "before", apiProtocol: 1 };
  let requests = 0;
  await assert.rejects(stopBrowserService(owner, "C:\\unused", {
    readOwner: async () => ({ ...owner, instanceId: "after" }),
    fetchImpl: async () => { requests += 1; throw new Error("unexpected request"); },
  }), /实例锁已变化/);
  assert.equal(requests, 0);
});

test("死 PID 旧锁经确认后恢复，桌面服务沿用旧端口", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const deadPid = 2147483647;
  const oldLock = { version: 1, apiProtocol: 1, pid: deadPid, host: "127.0.0.1", port,
    instanceId: "dead-owner", startedAt: new Date().toISOString(), dataDir };
  await fs.writeFile(path.join(dataDir, ".service-instance.json"), `${JSON.stringify(oldLock)}\n`);
  const desktop = startServer(dataDir, port, "desktop");
  const health = await waitReady(desktop, port);
  assert.equal(health.launcherKind, "desktop");
  const current = JSON.parse(await fs.readFile(path.join(dataDir, ".service-instance.json"), "utf8"));
  assert.equal(current.pid, desktop.pid);
  assert.notEqual(current.instanceId, oldLock.instanceId);
});

test("健康身份不符与停止超时都保留旧锁", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const browser = startServer(dataDir, port, "browser");
  await waitReady(browser, port);
  const lockPath = path.join(dataDir, ".service-instance.json");
  const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
  let stopRequests = 0;
  await assert.rejects(stopBrowserService(owner, dataDir, {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/runtime/stop")) stopRequests += 1;
      return { ok: true, json: async () => ({ service: "other", pid: owner.pid, instanceId: owner.instanceId }) };
    },
  }), /健康检查未确认身份/);
  assert.equal(stopRequests, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), owner);
  await assert.rejects(stopBrowserService(owner, dataDir, {
    timeoutMs: 150,
    processStatus: () => "alive",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/runtime/stop")) {
        stopRequests += 1;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return fetch(url, options);
    },
  }), /期限内退出/);
  assert.equal(stopRequests, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), owner);
});

test("同目录竞争启动只允许一个写入者，其他启动方发现并复用服务", async () => {
  const dataDir = await tempDataDir();
  const ports = await Promise.all(Array.from({ length: 6 }, () => unusedPort()));
  const children = ports.map((port, index) => startServer(dataDir, port, index % 2 ? "desktop" : "browser"));
  const ready = await Promise.all(children.map(async (child, index) => {
    try { return { child, index, health: await waitReady(child, ports[index], 10000) }; }
    catch { return null; }
  }));
  const owners = ready.filter(Boolean);
  assert.equal(owners.length, 1, children.map((child) => child.outputText()).join("\n---\n"));
  const owner = owners[0];
  for (const child of children.filter((candidate) => candidate !== owner.child)) {
    const result = await waitClosed(child, 10000);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /SERVICE_INSTANCE_REUSED/);
  }
  const state = await jsonRequest(ports[owner.index], "/api/state");
  assert.equal(state.status, 200);
});

test("不兼容的服务协议不会静默连接或抢占数据目录", async () => {
  const dataDir = await tempDataDir();
  const ownerPort = await unusedPort();
  const owner = startServer(dataDir, ownerPort, "browser");
  await waitReady(owner, ownerPort);
  const lockPath = path.join(dataDir, ".service-instance.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.apiProtocol = 99;
  await fs.writeFile(lockPath, `${JSON.stringify(lock)}\n`, "utf8");

  const client = startServer(dataDir, await unusedPort(), "desktop");
  const result = await waitClosed(client);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /健康检查未确认服务/);
  assert.match(result.output, /切勿在服务进程仍运行时删除锁/);
  assert.equal((await fetch(`http://127.0.0.1:${ownerPort}/api/health`).then((response) => response.json())).apiProtocol, 1);
});

test("两个事件窗口收到状态变更，并发保存不会互相覆盖", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const server = startServer(dataDir, port, "browser");
  await waitReady(server, port);
  const windowA = await createEventReader(port);
  const windowB = await createEventReader(port);
  assert.equal((await windowA.next()).data.initial, true);
  assert.equal((await windowB.next()).data.initial, true);

  const first = await jsonRequest(port, "/api/state/questions/31001", {
    method: "PATCH", revision: 0, body: { mastery: "mastered", seen: true },
  });
  assert.equal(first.status, 200);
  assert.equal((await windowA.next()).data.revision, 1);
  assert.equal((await windowB.next()).data.revision, 1);

  const concurrent = await Promise.all([
    jsonRequest(port, "/api/state/questions/31002", { method: "PATCH", revision: 1, body: { favorite: true } }),
    jsonRequest(port, "/api/state/questions/31003", { method: "PATCH", revision: 1, body: { error_prone: true } }),
  ]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);
  const conflict = concurrent.find((item) => item.status === 409).value;
  const retryId = concurrent[0].status === 409 ? "31002" : "31003";
  const retryPatch = retryId === "31002" ? { favorite: true } : { error_prone: true };
  const retry = await jsonRequest(port, `/api/state/questions/${retryId}`, {
    method: "PATCH", revision: conflict.current.revision, body: retryPatch,
  });
  assert.equal(retry.status, 200);
  assert.equal((await windowA.next()).data.revision, 2);
  assert.equal((await windowB.next()).data.revision, 2);
  assert.equal((await windowA.next()).data.revision, 3);
  assert.equal((await windowB.next()).data.revision, 3);

  const final = await jsonRequest(port, "/api/state");
  assert.equal(final.value.progress["31001"].mastery, "mastered");
  assert.equal(final.value.progress["31002"].favorite, true);
  assert.equal(final.value.progress["31003"].error_prone, true);
  assert.equal(final.value.revision, 3);
  await Promise.all([windowA.close(), windowB.close()]);
});

test("stale owner is recoverable only for a definitively missing PID and unchanged lock", async () => {
  const dataDir = await tempDataDir();
  const lockPath = path.join(dataDir, ".service-instance.json");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  await once(child, "spawn");
  const staleOwner = {
    version: 1,
    apiProtocol: 1,
    pid: child.pid,
    host: "127.0.0.1",
    port: 8188,
    instanceId: "stale-owner-test",
    startedAt: new Date().toISOString(),
    dataDir,
  };
  await fs.writeFile(lockPath, `${JSON.stringify(staleOwner)}\n`, "utf8");
  child.kill();
  await once(child, "exit");

  assert.equal(await isServiceOwnerProcessGone(dataDir, staleOwner), true);
  const recovered = await acquireServiceInstance(dataDir, { port: 8189 });
  assert.equal(recovered.acquired, true);
  assert.equal(JSON.parse(await fs.readFile(lockPath, "utf8")).pid, process.pid);
  await recovered.release();

  const liveOwner = { ...staleOwner, pid: process.pid, instanceId: "live-owner-test" };
  await fs.writeFile(lockPath, `${JSON.stringify(liveOwner)}\n`, "utf8");
  assert.equal(await isServiceOwnerProcessGone(dataDir, liveOwner), false);
  const refused = await acquireServiceInstance(dataDir, { port: 8190 });
  assert.equal(refused.acquired, false);
  assert.equal(refused.owner.instanceId, liveOwner.instanceId);
  assert.equal(JSON.parse(await fs.readFile(lockPath, "utf8")).instanceId, liveOwner.instanceId);

  const replacedOwner = { ...liveOwner, instanceId: "replacement-owner-test" };
  await fs.writeFile(lockPath, `${JSON.stringify(replacedOwner)}\n`, "utf8");
  assert.equal(await isServiceOwnerProcessGone(dataDir, liveOwner), false);
});

test("concurrent launchers serialize recovery of one stale owner without deleting the winner", async () => {
  const dataDir = await tempDataDir();
  const lockPath = path.join(dataDir, ".service-instance.json");
  const staleProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  await once(staleProcess, "spawn");
  const staleOwner = {
    version: 1,
    apiProtocol: 1,
    pid: staleProcess.pid,
    host: "127.0.0.1",
    port: 8188,
    instanceId: "concurrent-stale-owner-test",
    startedAt: new Date().toISOString(),
    dataDir,
  };
  await fs.writeFile(lockPath, `${JSON.stringify(staleOwner)}\n`, "utf8");
  staleProcess.kill();
  await once(staleProcess, "exit");

  const launchers = await Promise.all(["browser", "desktop", "browser"].map(async (kind) => {
    const child = startServer(dataDir, await unusedPort(), kind);
    await once(child, "spawn");
    return child;
  }));
  const launcherPids = new Set(launchers.map((child) => child.pid));
  const deadline = Date.now() + 10_000;
  let currentOwner;
  while (Date.now() < deadline) {
    try {
      currentOwner = JSON.parse(await fs.readFile(lockPath, "utf8"));
    } catch (error) {
      // Recovery removes the stale lease before exclusively creating its successor.
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      currentOwner = null;
    }
    if (launcherPids.has(currentOwner.pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(currentOwner && launcherPids.has(currentOwner.pid), "one new launcher must atomically claim the stale lease");
  const winner = launchers.find((child) => child.pid === currentOwner.pid);
  const health = await waitReady(winner, currentOwner.port);
  assert.equal(health.instanceId, currentOwner.instanceId);

  const losers = launchers.filter((child) => child !== winner);
  const loserResults = await Promise.all(losers.map((child) => waitClosed(child, 8000)));
  for (const result of loserResults) {
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /SERVICE_INSTANCE_REUSED/);
  }
  const finalOwner = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(finalOwner.pid, winner.pid);
  assert.equal(finalOwner.instanceId, health.instanceId);
  assert.equal((await fetch(`http://127.0.0.1:${finalOwner.port}/api/health`).then((response) => response.json())).instanceId, health.instanceId);
  await stop(winner);
});

test("服务退出释放实例锁；进程崩溃后重启恢复同一份记录", async () => {
  const dataDir = await tempDataDir();
  const lockPath = path.join(dataDir, ".service-instance.json");
  const firstPort = await unusedPort();
  const first = startServer(dataDir, firstPort, "browser");
  await waitReady(first, firstPort);
  const saved = await jsonRequest(firstPort, "/api/state/questions/31004", {
    method: "PATCH", revision: 0, body: { mastery: "learning", favorite: true, seen: true },
  });
  assert.equal(saved.status, 200);
  await stop(first);
  if (await fs.access(lockPath).then(() => true, () => false)) {
    assert.fail(`service did not release its lease: ${await fs.readFile(lockPath, "utf8")}\n${first.outputText()}`);
  }

  const secondPort = await unusedPort();
  const second = startServer(dataDir, secondPort, "desktop");
  await waitReady(second, secondPort);
  assert.equal((await jsonRequest(secondPort, "/api/state")).value.progress["31004"].mastery, "learning");
  await stop(second, "SIGKILL");
  assert.ok(await fs.readFile(lockPath, "utf8"), "crashed process leaves a stale lease to recover");

  const recoveryPort = await unusedPort();
  const recovered = startServer(dataDir, recoveryPort, "browser");
  await waitReady(recovered, recoveryPort);
  const final = await jsonRequest(recoveryPort, "/api/state");
  assert.equal(final.value.progress["31004"].favorite, true);
  const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(owner.pid, recovered.pid);
  assert.equal(owner.port, recoveryPort);
});

test("优雅退出等待正在上传的状态写入完成后才释放数据目录", async () => {
  const dataDir = await tempDataDir();
  const port = await unusedPort();
  const server = startServer(dataDir, port, "browser");
  await waitReady(server, port);
  const note = "并发退出写入验收".repeat(30_000);
  const payload = JSON.stringify({
    revision: 0,
    progress: { "31005": { mastery: "mastered", seen: true } },
    favorites: ["31005"],
    annotations: { "31005": { markdown: note, updated_at: new Date().toISOString() } },
  });
  let uploadStarted;
  const started = new Promise((resolve) => { uploadStarted = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload.slice(0, 128)));
      uploadStarted();
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(payload.slice(128)));
        controller.close();
      }, 250);
    },
  });
  const request = fetch(`http://127.0.0.1:${port}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": "0" },
    body: stream,
    duplex: "half",
  });
  await started;
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.send({ type: "shutdown" });
  const response = await request;
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(result?.ok);
  const closed = await waitClosed(server);
  assert.equal(closed.code, 0, closed.output);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(saved.progress["31005"].mastery, "mastered");
  assert.equal(saved.annotations["31005"].markdown, note);
  assert.equal(await fs.access(path.join(dataDir, ".service-instance.json")).then(() => true, () => false), false);
});
