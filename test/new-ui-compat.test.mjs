import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 在受控沙箱里加载真实的 ui-version.js 与 app-new.js，对共享键、AI 协议、备份/同步做实现级断言。
function createContext(initialStorage = {}) {
  const storage = new Map(Object.entries(initialStorage).map(([key, value]) => [key, String(value)]));
  const session = new Map();
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  };
  const sessionStorage = {
    getItem: key => (session.has(key) ? session.get(key) : null),
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: key => session.delete(key),
  };
  const sandbox = {
    navigator: {},
    localStorage,
    sessionStorage,
    location: { pathname: "/index.html", href: "http://127.0.0.1/index.html", replace: () => {} },
    document: { addEventListener: () => {}, documentElement: { dataset: {} }, createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ""; }, set textContent(v) {} }) },
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    fetch: () => Promise.reject(new Error("tests do not fetch by default")),
  };
  // 浏览器里 window 就是全局对象：裸标识符（如 DaguanVersions）经全局解析
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const root = new URL("../web/", import.meta.url);
  vm.runInContext(fs.readFileSync(new URL("ui-version.js", root), "utf8"), sandbox, { filename: "ui-version.js" });
  vm.runInContext(fs.readFileSync(new URL("app-new.js", root), "utf8"), sandbox, { filename: "app-new.js" });
  return { sandbox, storage, session, localStorage, sessionStorage };
}

test("AI 草稿写入共享键 daguan_ai_draft_v1:<qid>", () => {
  const { sandbox, storage } = createContext();
  const Storage = sandbox.window.StorageService;
  Storage.saveAIDraft(3356, "切换后恢复的草稿");
  assert.equal(storage.get("daguan_ai_draft_v1:3356"), "切换后恢复的草稿");
  assert.equal(Storage.getAIDraft("3356"), "切换后恢复的草稿");
  Storage.saveAIDraft(3356, "");
  assert.equal(storage.has("daguan_ai_draft_v1:3356"), false);
});

test("旧版新版草稿键迁移：只填空白目标键且可重复执行", () => {
  const { sandbox, localStorage } = createContext();
  const Storage = sandbox.window.StorageService;
  localStorage.setItem("daguan_ai_draft_42", "旧键草稿");
  assert.equal(Storage.migrateLegacyKeys() >= 1, true);
  assert.equal(localStorage.getItem("daguan_ai_draft_v1:42"), "旧键草稿");
  // 幂等：再次执行不报错、不重复
  Storage.migrateLegacyKeys();
  assert.equal(localStorage.getItem("daguan_ai_draft_v1:42"), "旧键草稿");
  // 目标键已有内容时不覆盖
  localStorage.setItem("daguan_ai_draft_43", "旧内容");
  localStorage.setItem("daguan_ai_draft_v1:43", "新内容");
  Storage.migrateLegacyKeys();
  assert.equal(localStorage.getItem("daguan_ai_draft_v1:43"), "新内容");
});

test("旧新版外观偏好先于 bootstrap 迁入新版 key，重复迁移幂等", () => {
  const { sandbox, localStorage } = createContext({ daguan_ui_appearance_new: JSON.stringify({ theme: "official-dark", brand: "#123456" }) });
  const Storage = sandbox.window.StorageService;
  assert.equal(sandbox.window.DaguanVersions.appearanceKey, "daguan_ui_appearance_new_v1");
  assert.equal(Storage.getUIAppearance().theme, "orange-night");
  assert.equal(Storage.getUIAppearance().brand, "#123456");
  Storage.migrateLegacyKeys();
  assert.equal(Storage.getUIAppearance().theme, "orange-night");
  // 幂等
  Storage.migrateLegacyKeys();
  assert.equal(Storage.getUIAppearance().theme, "orange-night");
  // 已有新偏好时不覆盖
  localStorage.setItem("daguan_ui_appearance_new_v1", JSON.stringify({ theme: "eye-care" }));
  Storage.migrateLegacyKeys();
  assert.equal(Storage.getUIAppearance().theme, "eye-care");
});

test("外观初始化区分新装、既有空键和旧 light 偏好，旧版 key 不被改写", () => {
  const fresh = createContext();
  assert.equal(JSON.parse(fresh.storage.get("daguan_ui_appearance_new_v1")).theme, "path-red");
  assert.equal(fresh.storage.get("daguan_ui_appearance_new_initialized_v1"), "fresh-install");
  const existing = createContext({
    daguan_ui_appearance_new_v1: "{}",
    daguan_ui_appearance_old_v1: JSON.stringify({ theme: "blue" }),
  });
  assert.equal(JSON.parse(existing.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
  assert.equal(existing.storage.get("daguan_ui_appearance_old_v1"), JSON.stringify({ theme: "blue" }));
  existing.sandbox.window.DaguanVersions.migrate(existing.localStorage);
  assert.equal(JSON.parse(existing.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
  const light = createContext({ daguan_ui_appearance_new_v1: JSON.stringify({ theme: "light", reduceMotion: true }) });
  assert.equal(JSON.parse(light.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
  assert.equal(JSON.parse(light.storage.get("daguan_ui_appearance_new_v1")).reduceMotion, true);
});

test("有旧版外观或学习痕迹的设备升级为橙白，且新旧外观键彼此独立", () => {
  const legacy = createContext({ daguan_ui_preferences_v1: JSON.stringify({ theme: "eye-care" }) });
  assert.deepEqual(JSON.parse(legacy.storage.get("daguan_ui_appearance_old_v1")), { theme: "eye-care" });
  assert.equal(JSON.parse(legacy.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
  const learned = createContext({ daguan_local_progress_v1: JSON.stringify({ 12: { mastery: "mastered" } }) });
  assert.equal(JSON.parse(learned.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
  learned.sandbox.window.DaguanVersions.migrate(learned.localStorage);
  assert.equal(JSON.parse(learned.storage.get("daguan_ui_appearance_new_v1")).theme, "orange-white");
});

test("真实目录的混合节点区分 6 道直属题和 4 个子章，空节点无直属题", () => {
  const { sandbox } = createContext();
  const categories = JSON.parse(fs.readFileSync(new URL("../web/data/categories.json", import.meta.url), "utf8"));
  const mappings = JSON.parse(fs.readFileSync(new URL("../web/data/category_questions.json", import.meta.url), "utf8"));
  const find = (nodes, id) => {
    for (const node of nodes) {
      if (String(node.id) === String(id)) return node;
      const nested = find(node.children || [], id);
      if (nested) return nested;
    }
    return null;
  };
  sandbox.window.AppState.categories = { categories };
  sandbox.window.AppState.catQuestions = mappings;
  sandbox.window.AppState.idIndex = {};
  sandbox.window.DataService.populateQuestions(categories);
  const mixed = find(categories, 1146);
  assert.equal(mixed.questions.length, 14);
  assert.equal(mixed.direct_questions.length, 6);
  assert.equal(mixed.children.length, 4);
  assert.deepEqual(Array.from(mixed.direct_questions, item => String(item.id)), ["8902", "8904", "8903", "8906", "8905", "8907"]);
  const empty = find(categories, 389);
  assert.equal(empty.direct_questions.length, 0);
  assert.equal(empty.question_count, 0);
});

test("AI 偏好只存 profileId，不再要求浏览器端 API Key", () => {
  const { sandbox } = createContext();
  const Storage = sandbox.window.StorageService;
  const prefs = Storage.getAIPreferences();
  assert.deepEqual({ ...prefs }, {});
  assert.equal("apiKey" in prefs, false);
  Storage.saveAIPreference("profileId", "profile-1");
  assert.equal(Storage.getAIPreferences().profileId, "profile-1");
  Storage.saveAIPreference("profileId", "profile-2");
  assert.equal(Storage.getAIPreferences().profileId, "profile-2");
});

test("AI 请求体对齐本地中控台协议：profileId + question + prompt，无浏览器凭据", async () => {
  const { sandbox } = createContext();
  const { AIService, AppState, StorageService } = sandbox.window;
  let captured = null;
  sandbox.fetch = async (url, options) => {
    if (String(url).endsWith("/api/ai/chat")) {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return { ok: true, headers: { get: () => "run-1" }, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    }
    throw new Error("unexpected fetch: " + url);
  };
  StorageService.saveAIPreference("profileId", "profile-1");
  AppState.aiProfileId = "profile-1";
  await AIService.chatStream({ question: { id: 9, stem: "设 A 为 m×n 矩阵" }, prompt: "完整解答", includePrivate: false, images: [] });
  assert.match(captured.url, /\/api\/ai\/chat$/);
  assert.equal(captured.body.profileId, "profile-1");
  assert.equal(captured.body.question.id, 9);
  assert.equal(captured.body.prompt, "完整解答");
  for (const forbidden of ["apiKey", "baseUrl", "model", "messages"]) {
    assert.equal(forbidden in captured.body, false, forbidden);
  }
  AIService.selectProfile("");
  await assert.rejects(
    () => AIService.chatStream({ question: { id: 9 }, prompt: "x" }),
    /请先在设置中选择或配置 AI 服务/,
  );
});

test("SSE 跨块解析：事件行被块边界切断时仍能完整解析", () => {
  const { sandbox } = createContext();
  const { AIService } = sandbox.window;
  const first = AIService.parseSseChunk("", 'data: {"type":"started","runId":"r1"}\n\ndata: {"type":"del');
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, "started");
  assert.equal(first.events[0].runId, "r1");
  assert.equal(first.rest, 'data: {"type":"del');
  const second = AIService.parseSseChunk(first.rest, 'ta","content":"你"}\n\ndata: {"type":"error","error":"boom"}\n\n');
  assert.equal(second.events.length, 2);
  assert.equal(second.events[0].type, "delta");
  assert.equal(second.events[0].content, "你");
  assert.equal(second.events[1].type, "error");
  assert.equal(second.events[1].error, "boom");
});

test("AI 题目载荷包含题面与本地状态字段", () => {
  const { sandbox } = createContext();
  const { AIService, AppState, StorageService } = sandbox.window;
  StorageService.toggleFavorite(7);
  const payload = AIService.questionPayload({ id: 7, stem: "题干", options: [{ label: "A", content_md: "选项" }], answer: "A" });
  assert.equal(payload.id, 7);
  assert.equal(payload.stem, "题干");
  assert.deepEqual(payload.options, [{ label: "A", content_md: "选项" }]);
  assert.equal(payload.favorite, true);
  assert.equal(payload.mastery, "not_started");
  assert.equal(Array.isArray(payload.images === undefined ? [] : payload.images), true);
});

test("备份文件为旧版兼容格式且不包含 AI 密钥", () => {
  const { sandbox } = createContext();
  const { App, StorageService } = sandbox.window;
  StorageService.toggleMastered(11);
  StorageService.saveAnnotation(11, "含公式 $x^2$ 的批注");
  const payload = App.buildBackupPayload();
  const text = JSON.stringify(payload);
  assert.equal(payload.format, "daguan-local-progress");
  assert.equal(payload.version, 3);
  assert.ok(payload.map["11"]);
  assert.ok(payload.progress["11"]);
  assert.deepEqual(Array.from(payload.favorites), []);
  assert.equal(text.includes("apiKey"), false);
  assert.equal(text.includes("ai_preferences"), false);
  // 阻断项 3 修复：导出批注为旧版 {markdown, updated_at, history} 形状
  const annotation = payload.annotations["11"];
  assert.equal(typeof annotation.markdown, "string");
  assert.ok(annotation.markdown.includes("$x^2$"));
  assert.equal(annotation.content, undefined);
  assert.equal(typeof annotation.updated_at, "string");
  assert.ok(Array.isArray(annotation.history));
});

test("进度键写旧版同形纯映射，收藏独立键；两版离线即可共享", () => {
  const { sandbox, storage } = createContext();
  const { StorageService } = sandbox.window;
  StorageService.toggleFavorite(3356);
  const raw = JSON.parse(storage.get("daguan_local_progress_v1"));
  assert.equal(raw.progress, undefined, "进度键顶层不得出现 progress 包装");
  assert.equal(raw.favorites, undefined, "进度键顶层不得出现 favorites 包装");
  assert.ok(raw["3356"], "题号必须是顶层键（旧版 loadProgress 直接可读）");
  const favs = JSON.parse(storage.get("daguan_local_favorites_v1"));
  assert.deepEqual(Array.from(favs), ["3356"], "收藏必须写入旧版独立键");
});

test("旧用户纯映射数据直接兼容，包装形状自动升级且不丢", () => {
  const { sandbox, storage } = createContext();
  const { StorageService } = sandbox.window;
  // 旧用户现存数据：纯映射 + 独立收藏键
  storage.set("daguan_local_progress_v1", JSON.stringify({ "3356": { mastery: "mastered", error_prone: false, seen: true, updated_at: "t1" } }));
  storage.set("daguan_local_favorites_v1", JSON.stringify(["3356"]));
  const view = StorageService.getProgress();
  assert.equal(view.progress["3356"].mastery, "mastered");
  assert.deepEqual(Array.from(view.favorites), ["3356"]);
  // 本会话旧版新版写过的包装形状：读取时自动拆包升级
  storage.set("daguan_local_progress_v1", JSON.stringify({ progress: { "3357": { mastery: "learning", updated_at: "t2" } }, favorites: ["3357"] }));
  storage.delete("daguan_local_favorites_v1");
  const upgraded = StorageService.getProgress();
  assert.ok(upgraded.progress["3357"]);
  assert.deepEqual(Array.from(upgraded.favorites), ["3357"]);
  const healed = JSON.parse(storage.get("daguan_local_progress_v1"));
  assert.equal(healed.progress, undefined, "升级后进度键必须已是纯映射");
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), ["3357"]);
});

test("旧版只在独立收藏键记录的收藏：新版识别且掌握/易错切换不丢", () => {
  const { sandbox, storage } = createContext();
  const { StorageService } = sandbox.window;
  // 旧版（以及服务端返回的）收藏可能只落在独立数组键里，进度条目内没有 favorite 字段
  storage.set("daguan_local_progress_v1", JSON.stringify({ "3356": { mastery: "learning", seen: true, updated_at: "t1" } }));
  storage.set("daguan_local_favorites_v1", JSON.stringify(["3356"]));
  assert.equal(StorageService.isFavorite(3356), true, "独立收藏键里的收藏必须被识别为已收藏");
  StorageService.toggleMastered(3356);
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), ["3356"], "掌握切换不得删掉旧版收藏");
  assert.equal(StorageService.isFavorite(3356), true);
  StorageService.toggleMistake(3356);
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), ["3356"], "易错切换不得删掉旧版收藏");
  // 点击收藏 = 取消收藏：独立键与条目字段同步为未收藏
  StorageService.toggleFavorite(3356);
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), []);
  assert.equal(StorageService.getProgress().progress["3356"].favorite, false);
  assert.equal(StorageService.isFavorite(3356), false);
  // 再点一次 = 收藏：旧版数组键与条目字段同时可见
  StorageService.toggleFavorite(3356);
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), ["3356"]);
  assert.equal(StorageService.getProgress().progress["3356"].favorite, true);
});

test("进度条目内的 favorite=false 优先于数组残留，读取即为未收藏", () => {
  const { sandbox, storage } = createContext();
  const { StorageService } = sandbox.window;
  storage.set("daguan_local_progress_v1", JSON.stringify({ "3356": { mastery: "learning", favorite: false, updated_at: "t1" } }));
  storage.set("daguan_local_favorites_v1", JSON.stringify(["3356"]));
  assert.equal(StorageService.isFavorite(3356), false, "显式 favorite=false 以条目字段为准");
  StorageService.toggleMastered(3356);
  assert.deepEqual(Array.from(JSON.parse(storage.get("daguan_local_favorites_v1"))), [], "写入时清理与条目冲突的数组残留");
});

test("批注导入兼容 content 视图形状并统一为 markdown 落盘", () => {
  const { sandbox } = createContext();
  const { StorageService } = sandbox.window;
  const normalized = StorageService.normalizeAnnotationsForStorage({
    3357: { content: "旧版新键产物", lastModified: "2026-09-27T00:00:00.000Z", history: [{ content: "历史", timestamp: "t" }] },
    3358: { markdown: "标准形状", updated_at: "u", history: [] },
  });
  assert.equal(normalized["3357"].markdown, "旧版新键产物");
  assert.equal(normalized["3357"].updated_at, "2026-09-27T00:00:00.000Z");
  assert.equal(normalized["3357"].history[0].markdown, "历史");
  assert.equal(normalized["3358"].markdown, "标准形状");
  assert.equal(normalized["3357"].content, undefined);
});

test("恢复对账以本地为准整份 PUT，保留服务端 last_study 并携带 revision", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService } = sandbox.window;
  StorageService.toggleFavorite(3357);
  StorageService.saveAnnotation(3357, "恢复的批注");
  const calls = [];
  sandbox.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/api/state") && (!options.method || options.method === "GET")) {
      calls.push(["GET", null]);
      return { ok: true, json: async () => ({ revision: 5, progress: { old: { mastery: "not_started" } }, favorites: ["old"], annotations: { old: { markdown: "旧" } }, picked: [], last_study: { category_id: "9", question_id: "1" } }) };
    }
    if (target.endsWith("/api/state") && options.method === "PUT") {
      calls.push(["PUT", JSON.parse(options.body), options.headers["If-Match"]]);
      return { ok: true, status: 200, json: async () => ({ ok: true, revision: 6 }) };
    }
    throw new Error("unexpected fetch: " + target);
  };
  StateSync.available = true;
  StateSync.hydrated = true;
  const ok = await StateSync.reconcileLocalToServer();
  assert.equal(ok, true);
  const put = calls.filter(c => c[0] === "PUT").pop();
  assert.equal(put[2], "5", "整份写入必须携带 If-Match revision");
  assert.equal(put[1].revision, 5);
  assert.ok(put[1].progress["3357"], "以本地恢复结果为准");
  assert.deepEqual(Array.from(put[1].favorites), ["3357"]);
  assert.equal(put[1].annotations["3357"].markdown, "恢复的批注");
  assert.deepEqual(put[1].last_study, { category_id: "9", question_id: "1" }, "恢复不改变最近学习位置");
  assert.equal(StateSync.revision, 6);
  // 失败返回 false（409 重读后仍失败 / 非 2xx）
  sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal(await StateSync.reconcileLocalToServer(), false);
});

test("恢复待对账期间 hydrate 不用旧服务端覆盖本地，恢复成功后清除标记", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService } = sandbox.window;
  StateSync.markRestorePending();
  let putCount = 0;
  sandbox.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/api/state") && options.method === "PUT") {
      putCount += 1;
      if (putCount === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true, revision: 9 }) };
    }
    if (target.endsWith("/api/state")) {
      return { ok: true, json: async () => ({ revision: 5, progress: {}, favorites: ["stale"], annotations: { stale: { markdown: "旧" } }, picked: [], last_study: null }) };
    }
    throw new Error("unexpected fetch: " + target);
  };
  // 第一次 hydrate：对账失败 → 不得覆盖本地，标记保留
  StorageService.toggleFavorite(3357);
  await StateSync.hydrate();
  assert.equal(StateSync.available, false);
  assert.equal(StateSync.hasRestorePending(), true);
  assert.deepEqual(Array.from(StorageService.getProgress().favorites), ["3357"]);
  // 第二次 hydrate：对账成功 → 标记清除
  await StateSync.hydrate();
  assert.equal(StateSync.hasRestorePending(), false);
  assert.equal(StateSync.available, true);
});

test("恢复备份兼容三种旧格式，非法文件抛错", () => {
  const { sandbox } = createContext();
  const { App } = sandbox.window;
  const full = App.parseBackupText(JSON.stringify({ format: "daguan-local-progress", progress: { 5: { mastery: "mastered" } }, favorites: ["5"], annotations: { 5: { markdown: "a", updated_at: "t", history: [] } } }));
  assert.equal(full.kind, "full");
  assert.equal(full.progress["5"].mastery, "mastered");
  assert.equal(full.aiPreferences, null);

  const map = App.parseBackupText(JSON.stringify({ format: "daguan-local-progress", version: 3, map: { 6: "f", 7: "l" }, favorites: [6] }));
  assert.equal(map.kind, "map");
  assert.equal(map.map["6"], "error_prone");
  assert.equal(map.map["7"], "learning");
  assert.deepEqual(Array.from(map.favorites), ["6"]);

  const states = App.parseBackupText(JSON.stringify({ states: { 8: { mastery: "mastered", favorite: true } } }));
  assert.equal(states.kind, "map");
  assert.equal(states.map["8"], "mastered");
  assert.deepEqual(Array.from(states.favorites), ["8"]);

  const legacyNew = App.parseBackupText(JSON.stringify({ app: "daguan-local", backup_version: 1, progress: { 9: { mastery: "learning" } }, ai_preferences: { apiKey: "sk-secret" } }));
  assert.equal(legacyNew.kind, "full");
  assert.equal(legacyNew.aiPreferences, null);

  assert.throws(() => App.parseBackupText("{not json"), /JSON/);
  assert.throws(() => App.parseBackupText(JSON.stringify({ hello: "world" })), /缺少进度数据/);
});

test("官网同步文档与旧版 buildSyncDocument 同构", () => {
  const { sandbox } = createContext();
  const { App, StorageService } = sandbox.window;
  StorageService.toggleMastered(21);
  // 学习中（learning）按旧版契约映射为 needs_practice；纯易错未掌握不上传（与旧版一致）
  const raw = StorageService.getProgress();
  raw.progress["22"] = { mastery: "learning", error_prone: true, updated_at: new Date().toISOString() };
  StorageService.saveProgress(raw);
  StorageService.toggleFavorite(23);
  const doc = App.buildSyncDocument();
  assert.equal(doc.format, "daguan-local-progress");
  assert.equal(doc.version, 3);
  assert.equal(doc.states["21"].mastery, "mastered");
  assert.equal(doc.states["22"].mastery, "needs_practice");
  assert.equal(doc.states["22"].favorite, false);
  assert.equal(doc.states["23"].favorite, true);
  assert.equal("99" in doc.states, false); // 无记录的题不出现
  assert.ok(doc.exported_at);
});

test("学习位置记录真实题号，供服务端 last-study 与跨版本恢复", () => {
  const { sandbox } = createContext();
  const { StorageService } = sandbox.window;
  StorageService.saveLearningPosition(31, 32, 4, 3356);
  const position = StorageService.getLearningPosition();
  assert.equal(position.categoryId, 31);
  assert.equal(position.chapterId, 32);
  assert.equal(position.questionIndex, 4);
  assert.equal(position.questionId, "3356");
  // 跨版本恢复时 questionIndex 可为空，按题号定位
  StorageService.saveLearningPosition(31, 31, null, 88);
  assert.equal(StorageService.getLearningPosition().questionIndex, null);
});

test("学习位置保留当前阅读模式；新版模式默认为单题并记住显式选择", () => {
  const { sandbox, localStorage } = createContext();
  const { App, StorageService } = sandbox.window;
  assert.equal(App.preferredQuestionMode(), "single");
  localStorage.setItem("daguan_new_question_mode_v1", "multi");
  assert.equal(App.preferredQuestionMode(), "multi");
  StorageService.saveLearningPosition(31, 32, 20, 3356, "multi");
  assert.equal(StorageService.getLearningPosition().mode, "multi");
  assert.equal(JSON.parse(sandbox.sessionStorage.getItem("daguan_learning_position_v2")).mode, "multi");
});

test("三态掌握循环保留旧版 learning/mastered 语义", () => {
  const { sandbox, storage } = createContext({
    daguan_local_progress_v1: JSON.stringify({ "3356": { mastery: "learning", error_prone: true } }),
    daguan_local_favorites_v1: JSON.stringify(["3356"]),
  });
  const { StorageService } = sandbox.window;
  assert.equal(StorageService.cycleMastery(3356), "mastered");
  assert.equal(StorageService.getProgress().progress["3356"].mastery, "mastered");
  assert.equal(StorageService.isMistake(3356), true);
  assert.deepEqual(JSON.parse(storage.get("daguan_local_favorites_v1")), ["3356"]);
  assert.equal(StorageService.cycleMastery(3356), "not_started");
  assert.equal(StorageService.getProgress().progress["3356"].mastery, "not_started");
});

test("多题深段只取目标 20 题对应的分片", async () => {
  const { sandbox } = createContext();
  const { DataService } = sandbox.window;
  const fetched = [];
  DataService.shardCache = new Map();
  DataService.ensureShard = async name => {
    fetched.push(name);
    DataService.shardCache.set(name, new Map(Array.from({ length: 10 }, (_, offset) => [offset + 41, { id: offset + 41 }])));
  };
  const chapter = { direct_questions: Array.from({ length: 50 }, (_, index) => ({ id: index + 1, shard: index < 20 ? "first" : index < 40 ? "middle" : "last" })) };
  const questions = await DataService.loadQuestionRange(chapter, 40, 20);
  assert.deepEqual(Array.from(questions, question => question.id), Array.from({ length: 10 }, (_, index) => index + 41));
  assert.deepEqual(fetched, ["last"]);
});

// ---------------------------------------------------------------------------
// 普通离线编辑（批注/收藏）的待同步与安全对账。
// 对应验收阻断：离线批注在恢复在线刷新后被 hydrate 的服务端旧值整体覆盖。
// ---------------------------------------------------------------------------
function remoteState(overrides = {}) {
  return { revision: 5, progress: {}, favorites: [], annotations: {}, picked: [], last_study: null, ...overrides };
}

function okState(state) {
  return { ok: true, status: 200, json: async () => state };
}

// 新版真实写入路径：先落本机存储，再记入待同步日志
// （与 App.autoSaveAnnotation / App.toggleFavorite 内部步骤一致）
function writeAnnotationOffline(sandbox, qid, markdown) {
  const { StorageService, DaguanPendingSync } = sandbox.window;
  StorageService.saveAnnotation(qid, markdown);
  DaguanPendingSync.queueAnnotation(qid, markdown, StorageService.readAnnotationsStorage()[String(qid)].updated_at);
}

function toggleFavoriteOffline(sandbox, qid, on) {
  const { StorageService, StateSync } = sandbox.window;
  if (StorageService.isFavorite(qid) !== on) StorageService.toggleFavorite(qid);
  StateSync.queueQuestion(qid, { favorite: on });
}

test("离线批注与收藏记入待同步日志：恢复在线 hydrate 保留本地并逐题补写", async () => {
  const { sandbox, localStorage } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  // 离线：本机写入 + 待同步留痕
  StateSync.available = false;
  StateSync.hydrated = true;
  const markdown = "Codex独立离线批注-20260927";
  writeAnnotationOffline(sandbox, 3356, markdown);
  toggleFavoriteOffline(sandbox, 3356, true);
  const journal = JSON.parse(localStorage.getItem("daguan_pending_sync_v1"));
  assert.equal(journal.annotations["3356"].markdown, markdown);
  assert.equal(journal.questions["3356"].patch.favorite, true);

  // 恢复在线刷新：服务端仍是旧数据
  const writes = [];
  sandbox.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/annotation")) {
      writes.push(["annotation", JSON.parse(options.body).markdown, options.headers["If-Match"]]);
      return okState({ ok: true, revision: 6 });
    }
    if (target.includes("/api/state/questions/")) {
      writes.push(["question", JSON.parse(options.body), options.headers["If-Match"]]);
      return okState({ ok: true, revision: 7 });
    }
    if (target.endsWith("/api/state")) {
      return okState(remoteState({
        progress: { 9001: { mastery: "mastered", updated_at: "2026-09-01T00:00:00.000Z" } },
        favorites: ["old"],
        annotations: { 3356: { markdown: "过时的服务端批注", updated_at: "2026-09-01T00:00:00.000Z" }, old: { markdown: "旧" } },
      }));
    }
    throw new Error("unexpected fetch: " + target);
  };
  await StateSync.hydrate();
  StateSync.cancelRetry();
  assert.equal(StateSync.available, true, "恢复在线后应重新可用");
  // 本地离线编辑没有被服务端旧值覆盖
  assert.equal(StorageService.getAnnotation(3356).content, markdown);
  assert.equal(StorageService.isFavorite(3356), true);
  // 服务端其它无关改动没有被整份旧本地状态覆盖（只走逐题接口）
  assert.equal(StorageService.isMastered(9001), true);
  assert.equal(StorageService.getAnnotation("old").content, "旧");
  // 待同步编辑已补写到服务端，且成功后才清除待同步状态
  assert.deepEqual(writes, [
    ["annotation", markdown, "5"],
    ["question", { favorite: true, revision: 6, updated_at: writes[1][1].updated_at }, "6"],
  ]);
  assert.equal(DaguanPendingSync.hasAny(), false);
  assert.equal(localStorage.getItem("daguan_pending_sync_v1"), null);
});

test("离线清空批注同样受保护：刷新后不复活，并补写空内容到服务端", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  StorageService.saveAnnotation(3356, "服务端已有批注");
  StateSync.available = false;
  StateSync.hydrated = true;
  writeAnnotationOffline(sandbox, 3356, "");
  assert.equal(DaguanPendingSync.read().annotations["3356"].markdown, "");
  const pushed = [];
  sandbox.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/annotation")) {
      pushed.push(JSON.parse(options.body).markdown);
      return okState({ ok: true, revision: 6 });
    }
    if (target.endsWith("/api/state")) {
      return okState(remoteState({ annotations: { 3356: { markdown: "服务端已有批注", updated_at: "2026-09-01T00:00:00.000Z" } } }));
    }
    throw new Error("unexpected fetch: " + target);
  };
  await StateSync.hydrate();
  StateSync.cancelRetry();
  assert.equal(StorageService.getAnnotation(3356).content, "", "清空后的本地编辑不能被服务端旧值复活");
  assert.deepEqual(pushed, [""], "清空同样要补写到服务端");
  assert.equal("3356" in DaguanPendingSync.read().annotations, false);
});

test("待同步补写遇到 revision 409 自动重读重试；500 保留待重试，恢复后一致", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  StateSync.available = true;
  StateSync.hydrated = true;
  StateSync.revision = 3;
  writeAnnotationOffline(sandbox, 3356, "409 期间的离线批注");
  const attempts = [];
  sandbox.fetch = async (url, options = {}) => {
    attempts.push(options.headers["If-Match"]);
    if (attempts.length === 1) return { ok: false, status: 409, json: async () => ({ error: "STATE_CONFLICT", current: { revision: 9 } }) };
    return okState({ ok: true, revision: 10 });
  };
  assert.equal(await StateSync.flushPending(), true);
  StateSync.cancelRetry();
  assert.deepEqual(attempts, ["3", "9"], "409 后按服务端新 revision 重试");
  assert.equal(StateSync.revision, 10);
  assert.equal(DaguanPendingSync.hasAny(), false);

  // 服务端 500：保留本地编辑与待重试状态，不误报成功
  writeAnnotationOffline(sandbox, 3357, "500 期间的离线批注");
  sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal(await StateSync.flushPending(), false);
  StateSync.cancelRetry();
  assert.equal(StorageService.getAnnotation(3357).content, "500 期间的离线批注");
  assert.equal(DaguanPendingSync.read().annotations["3357"].markdown, "500 期间的离线批注");

  // 服务恢复后重试成功，待同步状态清空
  sandbox.fetch = async () => okState({ ok: true, revision: 11 });
  assert.equal(await StateSync.retryPending(), true);
  StateSync.cancelRetry();
  assert.equal(DaguanPendingSync.hasAny(), false);
  assert.equal(StateSync.revision, 11);
});

test("离线 hydrate 失败不丢本地编辑与待同步状态，且不发起任何写入", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  StateSync.available = false;
  StateSync.hydrated = false;
  writeAnnotationOffline(sandbox, 3356, "纯离线批注");
  toggleFavoriteOffline(sandbox, 3363, true);
  const writes = [];
  sandbox.fetch = async (url, options = {}) => {
    if (options.method && options.method !== "GET") { writes.push(options.method); throw new Error("离线时不应发起写入"); }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  await StateSync.hydrate();
  StateSync.cancelRetry();
  assert.equal(StateSync.available, false);
  assert.deepEqual(writes, [], "离线时不得尝试写服务端");
  assert.equal(StorageService.getAnnotation(3356).content, "纯离线批注");
  assert.equal(StorageService.isFavorite(3363), true);
  assert.equal(DaguanPendingSync.hasAny(), true, "待同步状态必须保留到下次在线");
});

test("补写成功但期间又有新编辑时，待同步状态不被误清（按内容指纹）", async () => {
  const { sandbox } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  StateSync.available = true;
  StateSync.hydrated = true;
  StateSync.revision = 3;
  writeAnnotationOffline(sandbox, 3356, "第一版");
  sandbox.fetch = async () => {
    // 服务端确认“第一版”的同时，用户在界面上又改了内容并走真实写入路径
    writeAnnotationOffline(sandbox, 3356, "第二版");
    return okState({ ok: true, revision: 4 });
  };
  await StateSync.flushPending();
  StateSync.cancelRetry();
  assert.equal(StorageService.getAnnotation(3356).content, "第二版");
  assert.equal(DaguanPendingSync.read().annotations["3356"].markdown, "第二版", "新编辑必须继续挂着待同步");
});

test("待同步日志与旧版共用同一键，旧版写入的收藏也能被新版对账", () => {
  const { sandbox, localStorage } = createContext();
  const { StateSync, StorageService, DaguanPendingSync } = sandbox.window;
  // 旧版（app-legacy.js）离线收藏：写本机进度 + 同一份待同步日志
  StorageService.toggleFavorite(3357);
  DaguanPendingSync.queueQuestion(3357, { favorite: true });
  const journal = JSON.parse(localStorage.getItem("daguan_pending_sync_v1"));
  assert.equal(journal.questions["3357"].patch.favorite, true);
  // 新版 hydrate 拿到过时的收藏数组时，不能被它覆盖掉这条待同步编辑
  const merged = StateSync.mergeFavorites(["old"], StorageService.getProgress(), { 3357: { favorite: true }, old: {} });
  assert.deepEqual(Array.from(merged), ["old", "3357"]);
});
