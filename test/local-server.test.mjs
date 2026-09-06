import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore } from "../local-server/store.mjs";
import { CxyonlyClient } from "../local-server/cxyonly-client.mjs";
import { applyLocalChanges, buildPullMerge, buildPushPlan, buildReconcilePlan, localToAndroidDocument, localToRemoteDocument, normalizeLocalState, normalizeRemoteStates } from "../local-server/sync-format.mjs";

test("V2 forgot 状态迁移为 V3 学习中加独立易错", () => {
  const state = normalizeLocalState({ version: 2, progress: { "7": { mastery: "forgot" } } });
  assert.equal(state.version, 3);
  assert.equal(state.progress["7"].mastery, "learning");
  assert.equal(state.progress["7"].error_prone, true);
  assert.deepEqual(state.annotations, {});
});

async function tempStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-console-"));
  return { root, store: createStore(root) };
}

test("本地状态可以转换为官网安全同步文档", () => {
  const document = localToRemoteDocument({
    progress: {
      "1": { mastery: "mastered", updated_at: Date.now() },
      "2": { mastery: "forgot", updated_at: Date.now() },
      "3": { mastery: "not_started" },
    },
    favorites: ["3"],
  });
  assert.deepEqual(Object.keys(document.states).sort(), ["1", "2", "3"]);
  assert.equal(document.states["2"].mastery, "not_known");
  assert.equal(document.states["3"].favorite, true);
});

test("本地状态可以导出为 Android 兼容进度包", () => {
  const document = localToAndroidDocument({
    progress: { "11": { mastery: "forgot", updated_at: Date.now() } },
    favorites: ["12"],
  });
  assert.equal(document.format, "daguan-android-progress");
  assert.equal(document.version, 2);
  assert.equal(document.states["11"].mastery, "not_known");
  assert.equal(document.states["12"].favorite, true);
  assert.deepEqual(document.events, []);
});

test("官网非空掌握状态和收藏可以安全合并到本地", () => {
  const result = buildPullMerge(
    { progress: { "1": { mastery: "learning", updated_at: 1 } }, favorites: [] },
    [
      { question_id: 1, user_state: { mastery: "mastered", updated_at: "2026-01-01T00:00:00Z" } },
      { question_id: 2, user_state: { mastery: "not_started", favorited_at: "2026-01-01T00:00:00Z" } },
    ],
    new Set(["1", "2"]),
  );
  assert.equal(result.state.progress["1"].mastery, "mastered");
  assert.deepEqual(result.state.favorites, ["2"]);
  assert.equal(result.changes.length, 2);
});

test("上传预览只包含非空掌握状态和新增收藏", () => {
  const result = buildPushPlan(
    { progress: { "1": { mastery: "mastered" }, "2": { mastery: "not_started" } }, favorites: ["2"] },
    [
      { question_id: 1, mastery: "needs_practice", favorite: false },
      { question_id: 2, mastery: "not_started", favorite: false },
    ],
    new Set(["1", "2"]),
  );
  assert.equal(result.summary.changes, 2);
  assert.deepEqual(result.operations, [
    { questionId: "1", payload: { mastery: "mastered" } },
    { questionId: "2", payload: { is_favorite: true } },
  ]);
});

test("Node 客户端可登录、读取掌握状态并调用 CSRF", async () => {
  const { root, store } = await tempStore();
  const calls = [];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/login")) return new Response(JSON.stringify({ token: "secret-token" }), { status: 200 });
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ id: 7, username: "tester", token: "should-not-leak", nested: { password: "hidden" } }), { status: 200 });
    if (url.endsWith("/api/questions/mastery-map")) return new Response(JSON.stringify({ data: { items: [
      { question_id: 1, user_state: { mastery: "mastered", favorited_at: "2026-01-01T00:00:00Z" } },
    ] } }), { status: 200 });
    if (url.endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrf_token: "csrf" }), { status: 200 });
    if (url.includes("/state") && options.method === "PATCH") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const client = new CxyonlyClient({ store, fetchImpl: mockFetch, baseUrl: "https://www.cxyonly.fans" });
  const login = await client.login({ code: "one-time-code" });
  assert.equal(login.profile.token, undefined);
  assert.equal(login.profile.nested.password, undefined);
  const loginCall = calls.find((call) => call.url.endsWith("/api/auth/login"));
  assert.deepEqual(JSON.parse(loginCall.options.body), { verification_code: "one-time-code", login_mode: "new" });
  const pull = await client.pullDocument();
  assert.equal(pull.states[0].mastery, "mastered");
  await client.patchState({ questionId: "1", payload: { mastery: "mastered" } });
  assert.ok(calls.some((call) => call.url.endsWith("/api/auth/csrf")));
  assert.ok(calls.some((call) => call.options.headers?.Authorization === "Bearer secret-token"));
  await fs.rm(root, { recursive: true, force: true });
});

test("状态格式化会去重并忽略非法题号", () => {
  const states = normalizeRemoteStates([
    { question_id: 1, mastery: "mastered" },
    { question_id: 1, mastery: "needs_practice" },
    { question_id: "bad", mastery: "mastered" },
  ]);
  assert.equal(states.length, 1);
  assert.equal(states[0].mastery, "needs_practice");
});

test("对账默认按字段更新时间决定方向，并允许取消收藏", () => {
  const result = buildReconcilePlan(
    { revision: 4, progress: { "1": { mastery: "mastered", mastery_updated_at: "2026-01-02T00:00:00Z" }, "2": { mastery: "learning", mastery_updated_at: "2026-01-01T00:00:00Z" } }, favorites: ["2"] },
    [
      { question_id: "1", mastery: "forgot", updated_at: "2026-01-01T00:00:00Z" },
      { question_id: "2", mastery: "needs_practice", favorited_at: null, updated_at: "2026-01-03T00:00:00Z" },
    ],
    new Set(["1", "2"]),
  );
  assert.equal(result.remoteOperations[0].questionId, "1");
  assert.deepEqual(result.remoteOperations[0].payload, { mastery: "mastered" });
  assert.deepEqual(result.localChanges, [{ questionId: "2", field: "favorite", value: false, remoteUpdatedAt: "2026-01-03T00:00:00Z" }]);
  const next = applyLocalChanges(result.local, result.localChanges, { remoteSeededAt: "2026-01-03T00:00:00Z" });
  assert.equal(next.favorites.includes("2"), false);
});

test("同步预览按唯一题号统计双向变化", () => {
  const result = buildReconcilePlan(
    { progress: { "1": { mastery: "learning", mastery_updated_at: "2026-01-03T00:00:00Z" }, "2": { mastery: "learning", mastery_updated_at: "2026-01-01T00:00:00Z", favorite_updated_at: "2026-01-01T00:00:00Z" } }, favorites: ["2"] },
    [
      { question_id: "1", mastery: "mastered", updated_at: "2026-01-02T00:00:00Z" },
      { question_id: "2", mastery: "not_started", favorite: false, updated_at: "2026-01-03T00:00:00Z" },
    ],
    new Set(["1", "2"]),
  );
  assert.equal(result.summary.localQuestionCount, 1);
  assert.equal(result.summary.remoteQuestionCount, 1);
  assert.equal(result.summary.conflictQuestionCount, 2);
});

test("首次修复由官网覆盖本地，并保留未知题号", () => {
  const result = buildReconcilePlan(
    { progress: { "1": { mastery: "mastered" }, "99": { mastery: "forgot" } }, favorites: ["1", "99"] },
    [{ question_id: "1", mastery: "not_started", favorite: false, updated_at: "2026-01-03T00:00:00Z" }, { question_id: "88", mastery: "mastered" }],
    new Set(["1", "2"]),
    { remoteAuthoritative: true },
  );
  assert.ok(result.localChanges.some((change) => change.questionId === "1" && change.field === "mastery" && change.value === "not_started"));
  assert.deepEqual(result.unknownIds.sort(), ["88", "99"]);
  assert.equal(result.remoteOperations.length, 0);
});

test("Node 状态写入使用 revision 防止整份旧状态覆盖", async () => {
  const { root, store } = await tempStore();
  const first = await store.writeState({ progress: { "1": { mastery: "learning" } } }, { expectedRevision: 0 });
  assert.equal(first.revision, 1);
  await assert.rejects(() => store.writeState({ progress: {} }, { expectedRevision: 0 }), (error) => error.code === "STATE_CONFLICT" && error.status === 409);
  const second = await store.writeState({ ...first, progress: { ...first.progress, "2": { mastery: "mastered" } } }, { expectedRevision: 1 });
  assert.equal(second.revision, 2);
  await fs.rm(root, { recursive: true, force: true });
});
