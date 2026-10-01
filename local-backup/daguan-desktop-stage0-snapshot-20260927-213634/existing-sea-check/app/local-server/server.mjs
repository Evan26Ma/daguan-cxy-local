import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createStore } from "./store.mjs";
import { CxyonlyClient } from "./cxyonly-client.mjs";
import { refreshCatalog } from "./catalog.mjs";
import { applyLocalChanges, buildPullMerge, buildReconcilePlan, localToAndroidDocument, normalizeLocalState, nowIso, remoteStatesDocument } from "./sync-format.mjs";
import { createAiService } from "./ai-service.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = path.join(ROOT, "web");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const BUILD_VERSION = "2026.09.07-r7";
const MAX_BODY = 10 * 1024 * 1024;

const store = createStore(ROOT, process.env.DAGUAN_DATA_DIR);
const client = new CxyonlyClient({
  store,
  baseUrl: process.env.DAGUAN_BASE_URL || "https://www.cxyonly.fans",
});
const previews = new Map();
const catalogTasks = new Map();
let knownIdsPromise;
let syncLock = Promise.resolve();
const ai = createAiService({ store });

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function errorJson(res, error, status = 500) {
  const code = error?.code === "AUTH_EXPIRED" ? 401 : Number(error?.status) || status;
  json(res, code, { ok: false, code: error?.code || null, error: String(error?.message || error), current: error?.current || undefined });
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("JSON 格式错误"); }
}

async function knownIds() {
  if (!knownIdsPromise) {
    knownIdsPromise = fs.readFile(path.join(WEB_ROOT, "data", "id_index.json"), "utf8")
      .then((text) => new Set(Object.keys(JSON.parse(text)).map(String)))
      .catch(() => null);
  }
  return knownIdsPromise;
}

async function withLock(task) {
  const previous = syncLock;
  let release;
  syncLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await task(); } finally { release(); }
}

function localStateShape(value) {
  return normalizeLocalState(value);
}

async function catalogInfo() {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(WEB_ROOT, "data", "manifest.json"), "utf8"));
    return { version: manifest.version || manifest.generated_at || manifest.updated_at || null, total: Number(manifest.total || manifest.question_count || 0) || null };
  } catch { return { version: null, total: null }; }
}

function startCatalogRefresh() {
  const taskId = randomUUID();
  const task = { taskId, status: "running", progress: { completed: 0, total: 0 }, startedAt: nowIso(), error: null };
  catalogTasks.set(taskId, task);
  refreshCatalog(ROOT, (progress) => { task.progress = progress; })
    .then((result) => { Object.assign(task, { status: "completed", result, finishedAt: nowIso() }); knownIdsPromise = null; })
    .catch((error) => { Object.assign(task, { status: "failed", error: error.message, finishedAt: nowIso() }); });
  return task;
}

async function saveRemoteProgress(states, extra = {}) {
  await store.writeProgress({
    format: "daguan-cxyonly-progress",
    version: 1,
    exported_at: nowIso(),
    states: remoteStatesDocument(states).question_states.states,
    ...extra,
  });
}

async function pullPreview() {
  const local = await store.readState();
  const remote = await client.pullDocument();
  const merged = buildPullMerge(local, remote.states, await knownIds());
  const previewId = randomUUID();
  previews.set(previewId, { type: "pull", createdAt: Date.now(), remote, merged });
  return { previewId, summary: { entries: remote.states.length, changes: merged.changes.length, unknown: merged.unknownIds.length, unknownIds: merged.unknownIds }, document: remote.document };
}

async function applyPull(previewId, auto = false) {
  const preview = previews.get(previewId);
  if (!preview || Date.now() - preview.createdAt > 30 * 60 * 1000) throw new Error("读取预览已过期，请重新读取");
  const result = preview.merged;
  await store.writeState(localStateShape(result.state));
  await saveRemoteProgress(preview.remote.states, { last_pull_at: nowIso() });
  const integration = await store.readIntegration();
  if (integration) await store.writeIntegration({ ...integration, last_pull_at: nowIso(), updated_at: nowIso() });
  await store.appendHistory({ action: "pull", applied: result.changes.length, unknown: result.unknownIds.length, automatic: auto });
  previews.delete(previewId);
  return { applied: result.changes.length, unknown: result.unknownIds.length, unknownIds: result.unknownIds };
}

async function pushPreview() {
  const local = await store.readState();
  const plan = await client.pushPreview(local, await knownIds());
  const previewId = randomUUID();
  previews.set(previewId, { type: "push", createdAt: Date.now(), plan });
  return { previewId, summary: plan.summary };
}

async function applyPush(previewId) {
  const preview = previews.get(previewId);
  if (!preview || preview.type !== "push" || Date.now() - preview.createdAt > 30 * 60 * 1000) throw new Error("上传预览已过期，请重新预览");
  const current = await client.pullDocument();
  await store.writeBackup("daguan-site-progress", current.document);
  const plan = await client.pushPreview(await store.readState(), await knownIds());
  let succeeded = 0;
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < plan.operations.length) {
      const operation = plan.operations[cursor++];
      try { await client.patchState(operation); succeeded += 1; }
      catch (error) { failures.push({ question_id: operation.questionId, error: error.message }); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const integration = await store.readIntegration();
  if (integration) await store.writeIntegration({ ...integration, last_push_at: nowIso(), updated_at: nowIso() });
  await store.appendHistory({ action: "push", succeeded, failed: failures.length, failures: failures.slice(0, 20) });
  previews.delete(previewId);
  return { succeeded, failed: failures.length, failures: failures.slice(0, 20), summary: plan.summary };
}

async function reconcilePreview(options = {}) {
  const catalogTask = startCatalogRefresh();
  while (catalogTask.status === "running") await new Promise((resolve) => setTimeout(resolve, 120));
  if (catalogTask.status === "failed") throw new Error(`题库更新失败：${catalogTask.error}`);
  const local = await store.readState();
  const remote = await client.fetchRemoteSnapshot();
  await store.writeBackup("local-state-before-reconcile-preview", local);
  await store.writeBackup("cxyonly-before-reconcile-preview", remote.document);
  const firstRepair = !local.remote_seeded_at;
  const requestedWinner = ["latest", "remote", "local"].includes(options.winner) ? options.winner : "latest";
  const winner = firstRepair ? "remote" : requestedWinner;
  const plan = buildReconcilePlan(local, remote.states, await knownIds(), {
    remoteAuthoritative: firstRepair || winner === "remote",
    ...(winner !== "latest" && !firstRepair ? { forceWinner: winner } : {}),
  });
  const previewId = randomUUID();
  const createdAt = Date.now();
  const expiresAt = new Date(createdAt + 30 * 60 * 1000).toISOString();
  const value = {
    type: "reconcile",
    createdAt,
    expiresAt,
    revision: local.revision,
    remote,
    plan,
    firstRepair,
    winner,
    catalog: { ...(await catalogInfo()), refreshed: catalogTask.result },
  };
  previews.set(previewId, value);
  return {
    ok: true,
    previewId,
    expiresAt,
    revision: local.revision,
    firstRepair,
    winner,
    summary: plan.summary,
    localChanges: plan.localChanges,
    remoteOperations: plan.remoteOperations,
    conflicts: plan.conflicts,
    unknownIds: plan.unknownIds,
    remoteActivity: remote.activity,
    remoteLastStudy: remote.lastStudy,
    activityImpact: { remoteActivityDays: remote.activity && typeof remote.activity === "object" ? Object.keys(remote.activity).length : null, possibleTodayWrites: plan.remoteOperations.length },
    catalog: value.catalog,
    backup: { willBackupLocal: true, willBackupRemote: true },
  };
}

async function applyReconcile(previewId, bodyValue = {}) {
  const preview = previews.get(previewId);
  if (!preview || preview.type !== "reconcile" || Date.now() > Date.parse(preview.expiresAt)) throw new Error("同步预览已过期，请重新检查");
  return withLock(async () => {
    const current = await store.readState();
    if (current.revision !== preview.revision) {
      const error = new Error("本地状态在预览后发生变化，请重新检查差异");
      error.code = "STATE_CONFLICT";
      error.status = 409;
      error.current = current;
      throw error;
    }
    await store.writeBackup("local-state-before-reconcile", current);
    await store.writeBackup("cxyonly-before-reconcile", preview.remote.document);
    const requestedWinner = ["latest", "remote", "local"].includes(bodyValue.winner) ? bodyValue.winner : preview.winner;
    if (!preview.firstRepair && requestedWinner !== preview.winner) {
      const error = new Error("同步策略已改变，请重新检查同步内容");
      error.code = "PREVIEW_STRATEGY_CHANGED";
      error.status = 409;
      throw error;
    }
    const plan = preview.plan;
    let next = applyLocalChanges(current, plan.localChanges, {
      remoteActivity: preview.remote.activity,
      remoteLastStudy: preview.remote.lastStudy,
      remoteSeededAt: current.remote_seeded_at || nowIso(),
    });
    const failed = [];
    let succeeded = 0;
    let saved = await store.writeState(next, { expectedRevision: current.revision });
    for (const operation of plan.remoteOperations) {
      try { await client.patchState(operation); succeeded += 1; }
      catch (error) { failed.push({ question_id: operation.questionId, error: error.message, payload: operation.payload }); }
    }
    const localStudyAt = Date.parse(current.last_study?.updated_at || current.last_study?.updatedAt || "") || 0;
    const remoteStudyAt = Date.parse(preview.remote.lastStudy?.updated_at || preview.remote.lastStudy?.updatedAt || "") || 0;
    if (current.last_study && localStudyAt > remoteStudyAt) {
      try { await client.saveLastStudy(current.last_study); }
      catch (error) { failed.push({ scope: "last_study", error: error.message }); }
    }
    next = { ...saved, pending_unknown_states: Object.fromEntries(plan.unknownIds.map((id) => [id, { source: "reconcile", updated_at: nowIso() }])) };
    if (failed.length || plan.unknownIds.length || saved.pending_remote_operations?.length) {
      if (failed.length) next.pending_remote_operations = failed;
      else delete next.pending_remote_operations;
      saved = await store.writeState(next, { expectedRevision: saved.revision });
    } else {
      delete next.pending_remote_operations;
    }
    let verified = null;
    try {
      verified = await client.fetchRemoteSnapshot();
      await saveRemoteProgress(verified.states, { last_reconcile_at: nowIso(), activity: verified.activity, last_study: verified.lastStudy });
    } catch (error) {
      failed.push({ scope: "verification", error: error.message });
    }
    const integration = await store.readIntegration();
    if (integration) await store.writeIntegration({ ...integration, last_reconcile_at: nowIso(), updated_at: nowIso() });
    await store.appendHistory({ action: "reconcile", first_repair: preview.firstRepair, local_applied: plan.localChanges.length, remote_succeeded: succeeded, remote_failed: failed.length, unknown: plan.unknownIds.length, failures: failed.slice(0, 20) });
    previews.delete(previewId);
    return { ok: failed.length === 0, state: saved, appliedLocal: plan.localChanges.length, succeeded, failed: failed.length, failures: failed.slice(0, 20), unknownIds: plan.unknownIds, verified: Boolean(verified) };
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  const subpath = "/daguan-math";
  const pathname = url.pathname === subpath ? "/" : url.pathname.startsWith(`${subpath}/`) ? url.pathname.slice(subpath.length) : url.pathname;
  if (pathname === "/api/health" && method === "GET") return json(res, 200, { ok: true, service: "daguan-local-console", time: nowIso() });
  if (pathname === "/api/runtime" && method === "GET") {
    const state = await store.readState();
    const profiles = await ai.profiles();
    return json(res, 200, { ok: true, appVersion: BUILD_VERSION, stateRevision: state.revision, catalog: await catalogInfo(), ai: { configured: profiles.length > 0, profiles: profiles.length }, python: { optional: true, configured: process.env.DAGUAN_PYTHON !== "disabled" }, time: nowIso() });
  }
  if (pathname === "/api/catalog/refresh" && method === "POST") return json(res, 202, startCatalogRefresh());
  if (pathname.startsWith("/api/catalog/refresh/") && method === "GET") {
    const task = catalogTasks.get(pathname.slice("/api/catalog/refresh/".length));
    return task ? json(res, 200, task) : json(res, 404, { ok: false, error: "题库刷新任务不存在" });
  }
  if (pathname === "/api/state" && method === "GET") return json(res, 200, await store.readState());
  if (pathname === "/api/state" && method === "PUT") {
    const incoming = await body(req);
    const expectedRevision = req.headers["if-match"] != null ? Number(req.headers["if-match"]) : Number(incoming.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 409, { ok: false, code: "REVISION_REQUIRED", error: "整份状态写入必须携带 revision；请改用逐题接口" });
    const saved = await store.writeState(localStateShape(incoming), { expectedRevision });
    return json(res, 200, { ok: true, state: saved, revision: saved.revision });
  }
  if (pathname.startsWith("/api/state/questions/") && !pathname.endsWith("/annotation") && method === "PATCH") {
    const questionId = pathname.slice("/api/state/questions/".length);
    if (!/^\d+$/.test(questionId)) return json(res, 400, { ok: false, error: "题目 ID 无效" });
    const incoming = await body(req);
    const expectedRevision = req.headers["if-match"] != null ? Number(req.headers["if-match"]) : incoming.revision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 409, { ok: false, code: "REVISION_REQUIRED", error: "逐题状态写入必须携带 revision" });
    const saved = await withLock(async () => {
      const current = await store.readState();
      if (expectedRevision != null && current.revision !== expectedRevision) {
        const error = new Error("本地状态版本已变化，请重新合并");
        error.code = "STATE_CONFLICT";
        error.status = 409;
        error.current = current;
        throw error;
      }
      const progress = { ...(current.progress || {}) };
      const entry = { ...(progress[questionId] || {}) };
      const at = incoming.updated_at || nowIso();
      if (incoming.mastery != null) {
        if (!["not_started", "learning", "mastered", "forgot"].includes(incoming.mastery)) return json(res, 400, { ok: false, error: "掌握状态无效" });
        entry.mastery = incoming.mastery === "forgot" ? "learning" : incoming.mastery;
        if (incoming.mastery === "forgot") entry.error_prone = true;
        entry.mastery_updated_at = at;
        entry.seen = incoming.seen !== false;
      }
      if (incoming.error_prone != null) { entry.error_prone = incoming.error_prone === true; entry.error_prone_updated_at = at; }
      if (incoming.favorite != null || incoming.is_favorite != null) { entry.favorite = incoming.favorite ?? incoming.is_favorite === true; entry.favorite_updated_at = at; }
      entry.updated_at = at;
      progress[questionId] = entry;
      const favorites = new Set(current.favorites || []);
      if (entry.favorite) favorites.add(questionId); else favorites.delete(questionId);
      return store.writeState({ ...current, progress, favorites: [...favorites].sort((a, b) => Number(a) - Number(b)) }, { expectedRevision: current.revision });
    });
    return json(res, 200, { ok: true, revision: saved.revision, state: saved });
  }
  if (pathname.startsWith("/api/state/questions/") && pathname.endsWith("/annotation") && method === "PATCH") {
    const questionId = pathname.slice("/api/state/questions/".length, -"/annotation".length);
    if (!/^\d+$/.test(questionId)) return json(res, 400, { ok: false, error: "题目 ID 无效" });
    const incoming = await body(req);
    const expectedRevision = req.headers["if-match"] != null ? Number(req.headers["if-match"]) : Number(incoming.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 409, { ok: false, code: "REVISION_REQUIRED", error: "批注写入必须携带 revision" });
    const saved = await withLock(async () => {
      const current = await store.readState();
      if (current.revision !== expectedRevision) {
        const error = new Error("本地状态版本已变化，请重新合并");
        error.code = "STATE_CONFLICT"; error.status = 409; error.current = current; throw error;
      }
      const annotations = { ...(current.annotations || {}) };
      const previous = annotations[questionId] && typeof annotations[questionId] === "object" ? annotations[questionId] : { history: [] };
      const markdown = String(incoming.markdown || "").slice(0, 100_000);
      const history = Array.isArray(previous.history) ? previous.history.slice(-9) : [];
      if (previous.markdown !== markdown) history.push({ markdown: previous.markdown || "", updated_at: previous.updated_at || nowIso() });
      annotations[questionId] = { markdown, updated_at: incoming.updated_at || nowIso(), history };
      return store.writeState({ ...current, annotations }, { expectedRevision: current.revision });
    });
    return json(res, 200, { ok: true, revision: saved.revision, state: saved });
  }
  if (pathname === "/api/state/last-study" && method === "PATCH") {
    const incoming = await body(req);
    const expectedRevision = req.headers["if-match"] != null ? Number(req.headers["if-match"]) : incoming.revision;
    if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) return json(res, 409, { ok: false, code: "REVISION_REQUIRED", error: "最近学习位置写入必须携带 revision" });
    const saved = await withLock(async () => {
      const current = await store.readState();
      if (expectedRevision != null && current.revision !== expectedRevision) {
        const error = new Error("本地状态版本已变化，请重新合并");
        error.code = "STATE_CONFLICT";
        error.status = 409;
        error.current = current;
        throw error;
      }
      return store.writeState({ ...current, last_study: { ...incoming, revision: undefined }, updated_at: nowIso() }, { expectedRevision: current.revision });
    });
    return json(res, 200, { ok: true, revision: saved.revision, state: saved });
  }
  if (pathname === "/api/state/migrate" && method === "POST") {
    const incoming = localStateShape(await body(req));
    const current = await store.readState();
    const merged = { ...current, ...incoming, revision: current.revision, progress: { ...(current.progress || {}), ...(incoming.progress || {}) }, favorites: [...new Set([...(current.favorites || []), ...(incoming.favorites || [])])], picked: [...new Set([...(current.picked || []), ...(incoming.picked || [])])], updated_at: nowIso() };
    const saved = await store.writeState(merged, { expectedRevision: current.revision });
    return json(res, 200, { ok: true, state: saved });
  }
  if (pathname === "/api/ai/profiles" && method === "GET") return json(res, 200, { ok: true, profiles: await ai.profiles() });
  if (pathname === "/api/ai/profiles" && method === "POST") return json(res, 200, { ok: true, profile: await ai.upsert(await body(req)) });
  if (pathname.startsWith("/api/ai/profiles/") && pathname.endsWith("/models") && method === "GET") {
    const id = pathname.slice("/api/ai/profiles/".length, -"/models".length);
    return json(res, 200, { ok: true, ...(await ai.models(id)) });
  }
  if (pathname.startsWith("/api/ai/profiles/") && pathname.endsWith("/test") && method === "POST") {
    const id = pathname.slice("/api/ai/profiles/".length, -"/test".length);
    const incoming = await body(req);
    return json(res, 200, await ai.test(id, incoming.kind === "vision" ? "vision" : "text"));
  }
  if (pathname.startsWith("/api/ai/profiles/") && method === "PATCH") {
    const id = pathname.slice("/api/ai/profiles/".length);
    return json(res, 200, { ok: true, profile: await ai.upsert({ ...(await body(req)), id }) });
  }
  if (pathname.startsWith("/api/ai/profiles/") && method === "DELETE") {
    const id = pathname.slice("/api/ai/profiles/".length);
    const incoming = await body(req);
    return json(res, 200, await ai.remove(id, incoming.clearHistory === true));
  }
  if (pathname === "/api/ai/chat" && method === "POST") return ai.streamChat(req, res, await body(req));
  if (pathname === "/api/ai/diagram" && method === "POST") return json(res, 200, { ok: true, ...(await ai.diagram(await body(req))) });
  if (pathname.startsWith("/api/ai/runs/") && method === "DELETE") return json(res, 200, { ok: ai.stop(pathname.slice("/api/ai/runs/".length)) });
  if (pathname.startsWith("/api/ai/conversations/") && method === "GET") {
    const parts = pathname.slice("/api/ai/conversations/".length).split("/");
    return json(res, 200, { ok: true, ...(await ai.conversation(parts[0], parts[1])) });
  }
  if (pathname.startsWith("/api/ai/conversations/") && method === "DELETE") {
    const parts = pathname.slice("/api/ai/conversations/".length).split("/");
    return json(res, 200, await ai.clearConversation(parts[0], parts[1]));
  }
  if (pathname === "/api/integrations/cxyonly/status" && method === "GET") {
    const status = await client.status();
    const local = await store.readState();
    return json(res, 200, { ...status, needsFirstSync: !local.remote_seeded_at });
  }
  if (pathname === "/api/integrations/cxyonly/login" && method === "POST") return json(res, 200, { ok: true, ...(await client.login(await body(req))) });
  if (pathname === "/api/integrations/cxyonly/logout" && method === "POST") { await store.clearIntegration(); return json(res, 200, { ok: true }); }
  if (pathname === "/api/integrations/cxyonly/pull/preview" && method === "POST") return json(res, 200, await pullPreview());
  if (pathname === "/api/integrations/cxyonly/pull/apply" && method === "POST") return json(res, 200, await applyPull((await body(req)).previewId));
  if (pathname === "/api/integrations/cxyonly/push/preview" && method === "POST") return json(res, 200, await pushPreview());
  if (pathname === "/api/integrations/cxyonly/push/apply" && method === "POST") return json(res, 200, await applyPush((await body(req)).previewId));
  if (pathname === "/api/integrations/cxyonly/reconcile/preview" && method === "POST") {
    const incoming = await body(req);
    return json(res, 200, await reconcilePreview(incoming));
  }
  if (pathname === "/api/integrations/cxyonly/reconcile/apply" && method === "POST") {
    const incoming = await body(req);
    return json(res, 200, await applyReconcile(incoming.previewId, incoming));
  }
  if (pathname === "/api/integrations/cxyonly/export" && method === "GET") {
    const source = url.searchParams.get("source") || "local";
    const value = source === "remote"
      ? (await client.pullDocument()).document
      : source === "backup"
        ? await store.readProgress()
        : source === "android"
          ? localToAndroidDocument(await store.readState())
          : await store.readState();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename=daguan-${source}-${new Date().toISOString().slice(0, 10)}.json`, "Cache-Control": "no-store" });
    return res.end(JSON.stringify(value, null, 2));
  }
  return serveStatic(pathname, res);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
async function serveStatic(requestPath, res) {
  let relative;
  try { relative = decodeURIComponent(requestPath); } catch { return json(res, 400, { error: "路径错误" }); }
  if (relative === "/" || relative === "") relative = "/index.html";
  const target = path.resolve(WEB_ROOT, `.${relative}`);
  if (!target.startsWith(`${WEB_ROOT}${path.sep}`)) return json(res, 403, { error: "禁止访问" });
  try {
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, "index.html") : target;
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
    return res.end(await fs.readFile(file));
  } catch {
    return json(res, 404, { error: "资源不存在" });
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => errorJson(res, error));
});

await store.readState();
server.listen(PORT, HOST, () => console.log(`大观园本地中控台：http://${HOST}:${PORT}`));

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
