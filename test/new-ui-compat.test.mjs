import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 在受控沙箱里加载真实的 ui-version.js 与 app-new.js，对共享键、AI 协议、备份/同步做实现级断言。
function createContext(initialStorage = {}) {
  const storage = new Map(Object.entries(initialStorage).map(([key, value]) => [key, String(value)]));
  const session = new Map();
  const documentListeners = new Map();
  const appearanceVariables = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (type, listener) => {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    documentElement: { dataset: {}, style: { setProperty: (name, value) => appearanceVariables.set(name, value) } },
    querySelector: () => null,
    createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ""; }, set textContent(v) {} }),
  };
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
    addEventListener: () => {},
    navigator: {},
    localStorage,
    sessionStorage,
    location: { pathname: "/index.html", href: "http://127.0.0.1/index.html", replace: () => {} },
    document,
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
  return { sandbox, storage, session, localStorage, sessionStorage, document, documentListeners, appearanceVariables };
}

function syncElements(document) {
  const ids = ["btn-sync-preview", "btn-sync-apply", "sync-summary", "sync-summary-note", "sync-flow-card", "sync-conflict-wrap", "sync-conflict-winner", "sync-detail", "sync-detail-content", "sync-result"];
  const elements = new Map(ids.map(id => [id, { id, hidden: false, disabled: false, dataset: {}, value: "latest", textContent: "", innerHTML: "" }]));
  document.getElementById = id => elements.get(id) || null;
  return elements;
}

test("新版官网同步先双向预览，确认后应用服务端结果", async () => {
  const { sandbox, document, localStorage } = createContext();
  const elements = syncElements(document);
  const { App, AppState, StateSync, PreviewAccess } = sandbox.window;
  PreviewAccess.privateAllowed = () => true;
  StateSync.available = true;
  StateSync.ensureFlushed = async () => {};
  StateSync.absorbLastStudy = () => {};
  const calls = [];
  sandbox.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const result = url.endsWith("/preview")
      ? { previewId: "p1", winner: "latest", summary: { remoteQuestionCount: 2, localQuestionCount: 1, conflictQuestionCount: 1 }, localChanges: [{ questionId: 1 }], remoteOperations: [{ questionId: 2 }], unknownIds: [] }
      : { state: { progress: { 1: { mastery: "mastered" } }, favorites: ["1"], picked: [], revision: 8 }, appliedLocal: 1, succeeded: 1, failed: 0, unknownIds: [], verified: true };
    return { ok: true, text: async () => JSON.stringify(result) };
  };
  sandbox.confirm = () => true;

  await App.syncReconcilePreview();
  assert.match(calls[0].url, /reconcile\/preview$/);
  assert.equal(calls[0].body.winner, "latest");
  assert.equal(elements.get("btn-sync-apply").hidden, false);
  assert.equal(elements.get("sync-conflict-wrap").hidden, false);
  assert.match(elements.get("sync-summary").textContent, /官网将更新本地 2 道题/);

  await App.syncReconcileApply();
  assert.match(calls[1].url, /reconcile\/apply$/);
  assert.equal(calls[1].body.previewId, "p1");
  assert.equal(AppState.syncReconcilePreview, null);
  assert.equal(elements.get("sync-flow-card").dataset.state, "success");
  assert.equal(StateSync.revision, 8);
  assert.match(localStorage.getItem("daguan_local_progress_v1") || "", /mastered/);
});

test("新版同步预览后状态冲突要求重新检查", async () => {
  const { sandbox, document } = createContext();
  const elements = syncElements(document);
  const { App, AppState, PreviewAccess, StateSync } = sandbox.window;
  PreviewAccess.privateAllowed = () => true;
  StateSync.available = true;
  StateSync.ensureFlushed = async () => {};
  AppState.syncReconcilePreview = { previewId: "stale", winner: "latest", summary: { localQuestionCount: 0 } };
  sandbox.fetch = async url => url.endsWith("/preview")
    ? { ok: true, text: async () => JSON.stringify({ previewId: "fresh", winner: "latest", summary: { remoteQuestionCount: 1, localQuestionCount: 0 }, localChanges: [{ questionId: 1 }], remoteOperations: [] }) }
    : { ok: false, status: 409, text: async () => JSON.stringify({ code: "STATE_CONFLICT", error: "状态已变化" }) };
  await App.syncReconcileApply();
  assert.equal(AppState.syncReconcilePreview, null);
  assert.equal(elements.get("btn-sync-apply").hidden, true);
  assert.match(elements.get("sync-summary-note").textContent, /重新检查并确认/);
  await App.syncReconcilePreview();
  assert.equal(AppState.syncReconcilePreview.previewId, "fresh");
  assert.equal(elements.get("btn-sync-apply").disabled, false);
});

test("新版在后台错过 SSE 后于重新可见时补读状态，且保留未保存批注", async () => {
  const { sandbox, document, documentListeners } = createContext();
  const { StateSync, AppState, UIRenderer } = sandbox.window;
  StateSync.hydrated = true;
  StateSync.available = true;
  StateSync.revision = 4;
  AppState.currentView = "question";
  AppState.annotationDirty = true;
  let hydrated = 0;
  let rendered = 0;
  StateSync.hydrate = async () => {
    hydrated += 1;
    StateSync.revision = 5;
    StateSync.available = true;
  };
  UIRenderer.renderQuestion = async () => { rendered += 1; };

  document.visibilityState = "hidden";
  await StateSync.refreshFromEvent();
  assert.equal(hydrated, 0, "后台页面不发起 UI 同步");
  document.visibilityState = "visible";
  for (const listener of documentListeners.get("visibilitychange") || []) listener();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(hydrated, 1, "重新可见时重新读取服务端状态");
  assert.equal(StateSync.revision, 5);
  assert.equal(rendered, 0, "未保存批注期间不重绘题目编辑器");
});

test("最近学习位置写入结束后释放 in-flight 状态，允许服务事件刷新", async () => {
  const { sandbox } = createContext();
  const { StateSync } = sandbox.window;
  StateSync.available = true;
  StateSync.hydrated = true;
  StateSync.revision = 4;
  sandbox.fetch = async () => ({ ok: true, status: 200, json: async () => ({ revision: 5 }) });
  assert.equal(await StateSync.pushLastStudy("331", "3356"), true);
  assert.equal(StateSync.revision, 5);
  assert.equal(StateSync.lastStudyInFlight, null);
});

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
  assert.deepEqual(Array.from(mixed.direct_questions, item => String(item.id)), ["8902", "8903", "8904", "8905", "8906", "8907"]);
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

test("新版完整解答先给答案并保留详细教学，提示模式仍不剧透", () => {
  const { sandbox } = createContext();
  const prompts = sandbox.window.AI_COMPOSE_PROMPTS;
  assert.match(prompts.full, /## 答案、## 简短思路、## 详细推导、## 方法与易错点/);
  assert.match(prompts.full, /先明确给出答案/);
  assert.match(prompts.full, /适用条件[\s\S]*题干[\s\S]*推导过程与结果/);
  assert.match(prompts.full, /清楚区分题干直接信息/);
  assert.match(prompts.hint, /不要直接跳到结论/);
});

test("新版预设新增简短回答与详细回答，且都要求考研视角", () => {
  const { sandbox } = createContext();
  const prompts = sandbox.window.AI_COMPOSE_PROMPTS;
  assert.match(prompts.brief, /请简短回答/);
  assert.match(prompts.brief, /不展开完整推导/);
  assert.match(prompts.brief, /考研/);
  assert.match(prompts.detailed, /## 答案、## 考研视角、## 详细推导、## 得分点与易错点/);
  assert.match(prompts.detailed, /大纲[\s\S]*了解／理解／掌握/);
  assert.match(prompts.detailed, /常考题型/);
  assert.match(prompts.full, /考研复习的角度/);
  const source = fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8");
  assert.match(source, /AI_COMPOSE_PROMPTS\.brief\)">简短回答/);
  assert.match(source, /AI_COMPOSE_PROMPTS\.detailed\)">详细回答/);
});

test("新版回答每段可点：段落追问提供四个考研向入口", () => {
  const source = fs.readFileSync(new URL("../web/ai-reading.js", import.meta.url), "utf8");
  for (const label of ["这个是怎么来的", "什么意思", "什么知识点", "你有什么想法"]) {
    assert.ok(source.includes(label), `缺少段落追问入口：${label}`);
  }
  assert.match(source, /className = 'ai-block-menu'/);
  assert.match(source, /closest\('\.ai-message\.assistant \.ai-message-bubble'\)/);
  assert.match(source, /ai-input/);
  assert.match(source, /sendAIMessage/);
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

test("做题历史随新版备份导出，旧备份仍可解析", () => {
  const { sandbox } = createContext();
  const entry = { question_id: "11", visited_at: "2026-09-29T12:00:00Z", time_kind: "visit" };
  const payload = sandbox.window.App.buildBackupPayload([entry]);
  assert.equal(payload.visit_history.length, 1);
  const parsed = sandbox.window.App.parseBackupText(JSON.stringify(payload));
  assert.equal(parsed.visitHistory[0].question_id, "11");
  const old = sandbox.window.App.parseBackupText(JSON.stringify({ progress: { 11: { seen: true } } }));
  assert.equal(old.visitHistory.length, 0);
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

test("新版按指定状态直接保存三种掌握程度，易错标记独立保存并同步", async () => {
  const { sandbox, storage, document } = createContext();
  const { App, StorageService, StateSync, PreviewAccess } = sandbox.window;
  PreviewAccess.privateAllowed = () => true;
  sandbox.CSS = { escape: value => String(value) };
  document.querySelectorAll = () => [];
  App.refreshShortcutHints = () => {};
  const queued = [];
  StateSync.queueQuestion = (qid, patch) => queued.push({ qid: String(qid), patch: { ...patch } });

  for (const mastery of ["not_started", "learning", "mastered"]) {
    App.setQuestionMastery("734", mastery);
    assert.equal(StorageService.getProgress().progress["734"].mastery, mastery, `直接选择 ${mastery} 应落盘`);
    assert.deepEqual(queued.at(-1), { qid: "734", patch: { mastery } });
  }

  await App.toggleQuestionMistake("734");
  assert.equal(StorageService.isMistake("734"), true);
  assert.equal(StorageService.getProgress().progress["734"].mastery, "mastered", "切换易错不应改动掌握状态");
  assert.deepEqual(queued.at(-1), { qid: "734", patch: { error_prone: true } });

  App.setQuestionMastery("734", "learning");
  assert.equal(StorageService.isMistake("734"), true, "设置掌握状态不应清除易错标记");
  assert.equal(StorageService.getProgress().progress["734"].mastery, "learning");
  const persisted = JSON.parse(storage.get("daguan_local_progress_v1"))["734"];
  assert.equal(persisted.mastery, "learning");
  assert.equal(persisted.error_prone, true);
});

test("单题和多题渲染都提供三态直选、独立易错按钮和当前状态", async () => {
  const { sandbox, document } = createContext();
  const { App, AppState, PreviewAccess, StateSync, StorageService, UIRenderer } = sandbox.window;
  const main = { innerHTML: "" };
  document.getElementById = id => id === "app-main" ? main : null;
  document.querySelectorAll = () => [];
  document.createElement = () => {
    let innerHTML = "";
    return {
      set innerHTML(value) { innerHTML = String(value); },
      get innerHTML() { return innerHTML; },
      set textContent(value) { innerHTML = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); },
      querySelectorAll: () => [],
    };
  };
  sandbox.CSS = { escape: value => String(value) };
  PreviewAccess.privateAllowed = () => false;
  App.refreshShortcutHints = () => {};
  UIRenderer.bindChapterPickerTriggers = () => {};
  UIRenderer.renderKaTeX = () => {};
  StateSync.pushLastStudy = () => {};

  const question = { id: 734, stem: "题干", options: [{ label: "A", content_md: "选项" }], answer: "A", explanation: "解析" };
  AppState.questions = [question];
  AppState.currentQuestionIndex = 0;
  AppState.currentCategory = { id: "test-category", name: "测试科目" };
  AppState.currentChapter = { id: "test-chapter", name: "测试章节", questions: [question] };
  AppState.chapterQuestionCount = 1;
  AppState.questionMode = "single";
  StorageService.setMastery(question.id, "learning");
  StorageService.toggleMistake(question.id);

  await UIRenderer.renderQuestion(0);
  const singleMarkup = main.innerHTML;
  assert.match(singleMarkup, /<span>单题做题<\/span>/);
  assert.match(singleMarkup, />单题做题<\/button>/);
  assert.match(singleMarkup, />连续做题<\/button>/);
  const controlsIndex = singleMarkup.indexOf("question-mastery-controls");
  assert.ok(controlsIndex > singleMarkup.indexOf("question-options"), "单题状态操作应位于题干和选项之后");
  assert.ok(controlsIndex < singleMarkup.indexOf("answer-section"), "单题状态操作应位于答案解析之前");
  assert.match(singleMarkup, /question-mastery-badge mastery-learning">学习中/);
  assert.match(singleMarkup, /question-mistake-badge[^>]*>易错/);

  const getStatusButtons = markup => (markup.match(/<button\b[^>]*>/g) || []);
  const masteryButtons = getStatusButtons(singleMarkup).filter(tag => /\bdata-mastery-choice=/.test(tag));
  assert.deepEqual(masteryButtons.map(tag => tag.match(/\bdata-mastery-choice="([^"]+)"/)?.[1]), ["not_started", "learning", "mastered"]);
  assert.match(masteryButtons[1], /aria-pressed="true"/);
  assert.match(singleMarkup, /class="mastery-btn question-mistake-toggle active"[^>]*aria-pressed="true"/);

  const queued = [];
  PreviewAccess.privateAllowed = () => true;
  StateSync.queueQuestion = (qid, patch) => queued.push({ qid: String(qid), patch: { ...patch } });
  const masteredHandler = masteryButtons[2].match(/\bonclick="([^"]+)"/)?.[1];
  assert.ok(masteredHandler, "掌握按钮应直接绑定到指定状态写入");
  assert.match(masteredHandler, /App\.setQuestionMastery\('734', 'mastered'\)/);
  App.setQuestionMastery("734", "mastered");
  assert.equal(StorageService.getProgress().progress["734"].mastery, "mastered");
  assert.equal(StorageService.isMistake("734"), true, "直选状态不应改动易错标记");
  assert.deepEqual(queued.at(-1), { qid: "734", patch: { mastery: "mastered" } });

  AppState.questionOffset = 0;
  AppState.questionRailQuery = "";
  AppState.questionRailFilter = "";
  UIRenderer.renderMultiQuestions(0);
  const multiMarkup = main.innerHTML;
  assert.match(multiMarkup, /连续做题 · 第 1–1 题/);
  assert.match(multiMarkup, />单题做题<\/button>/);
  assert.match(multiMarkup, /class="active" aria-pressed="true">连续做题<\/button>/);
  assert.match(multiMarkup, /每段 20 题/);
  assert.doesNotMatch(multiMarkup, /data-shortcut-hint=|button-shortcut|aria-keyshortcuts=/, "连续做题不展示做题快捷键");
  assert.match(multiMarkup, /question-mastery-badge mastery-mastered">已掌握/);
  assert.match(multiMarkup, /question-mistake-badge[^>]*>易错/);
  const multiButtons = getStatusButtons(multiMarkup).filter(tag => /\bdata-mastery-choice=/.test(tag));
  assert.deepEqual(multiButtons.map(tag => tag.match(/\bdata-mastery-choice="([^"]+)"/)?.[1]), ["not_started", "learning", "mastered"]);
  assert.match(multiButtons[2], /aria-pressed="true"/);
  const mistakeHandler = getStatusButtons(multiMarkup).find(tag => /\bclass="[^"]*question-mistake-toggle/.test(tag))?.match(/\bonclick="([^"]+)"/)?.[1];
  assert.ok(mistakeHandler, "多题卡易错按钮应独立绑定易错切换");
  assert.match(mistakeHandler, /App\.toggleQuestionMistake\('734'\)/);
  await App.toggleQuestionMistake("734");
  assert.equal(StorageService.isMistake("734"), false);
  assert.equal(StorageService.getProgress().progress["734"].mastery, "mastered", "多题卡易错切换不应改动掌握状态");
  assert.deepEqual(queued.at(-1), { qid: "734", patch: { error_prone: false } });
});

test("新版字号档位持久化在新版外观键，并规范化非法值", () => {
  const { sandbox, storage, appearanceVariables } = createContext();
  const { StorageService, UIRenderer } = sandbox.window;
  const defaults = StorageService.getUIAppearance();
  assert.equal(defaults.fontScale, 1);

  for (const scale of [1, 1.15, 1.3, 1.5]) {
    StorageService.saveUIAppearance({ ...defaults, fontScale: scale });
    assert.equal(StorageService.getUIAppearance().fontScale, scale);
    assert.equal(JSON.parse(storage.get("daguan_ui_appearance_new_v1")).fontScale, scale);
    UIRenderer.applySavedAppearance();
    assert.equal(appearanceVariables.get("--ui-font-scale"), String(scale));
  }

  StorageService.saveUIAppearance({ ...defaults, fontScale: 1.2 });
  assert.equal(StorageService.getUIAppearance().fontScale, 1, "不支持的字号值回到默认档位");
  assert.equal(JSON.parse(storage.get("daguan_ui_appearance_new_v1")).fontScale, 1);
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

test("标题栏 overlay 缺少桌面栏时为窗口控制按钮留出安全高度", () => {
  const { sandbox, document, appearanceVariables } = createContext();
  const { App } = sandbox.window;
  const classes = new Set();
  document.documentElement.classList = {
    toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    contains(name) { return classes.has(name); },
  };
  document.getElementById = () => null;
  sandbox.navigator.windowControlsOverlay = {
    visible: true,
    getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 1183, height: 42 }),
  };

  assert.equal(App.syncTitlebarInset(), 42);
  assert.equal(classes.has("native-titlebar-content-inset"), true);
  assert.equal(appearanceVariables.get("--native-titlebar-inset"), "42px");

  document.getElementById = id => id === "daguan-desktop-bar" ? {} : null;
  assert.equal(App.syncTitlebarInset(), 0, "桌面栏已注入时不应重复预留标题栏高度");
  assert.equal(classes.has("native-titlebar-content-inset"), false);
});

test("切换做题模式和连续做题分段导航保留题号及学习位置", async () => {
  const { sandbox, localStorage } = createContext();
  const { App, AppState, DataService, StorageService, UIRenderer } = sandbox.window;
  const entries = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
  const chapter = { id: "chapter-1", questions: entries };
  const savedPositions = [];
  AppState.currentCategory = { id: "category-1" };
  AppState.currentChapter = chapter;
  AppState.chapterQuestionCount = entries.length;
  AppState.questionMode = "single";
  AppState.questions = entries;
  AppState.currentQuestionIndex = 26;
  AppState.questionOffset = 0;
  App.ensureSavedBeforeLeavingQuestion = async () => true;
  DataService.loadQuestionRange = async (_chapter, start, count) => entries.slice(start, start + count);
  DataService.loadQuestionsForChapter = async () => entries;
  StorageService.saveLearningPosition = (...position) => savedPositions.push(position);
  UIRenderer.renderMultiRange = async (start, selectedId) => {
    AppState.questions = entries.slice(start, start + 20);
    AppState.questionOffset = start;
    AppState.currentQuestionIndex = selectedId == null ? 0 : AppState.questions.findIndex(question => question.id === selectedId);
    const selected = AppState.questions[AppState.currentQuestionIndex];
    if (selected) StorageService.saveLearningPosition(AppState.currentCategory.id, chapter.id, start + AppState.currentQuestionIndex, selected.id, "multi");
  };
  UIRenderer.renderQuestion = async index => { AppState.currentQuestionIndex = index; };

  await App.changeQuestionMode("multi");
  assert.equal(AppState.questionOffset, 20);
  assert.equal(AppState.currentQuestionIndex, 6);
  assert.equal(AppState.questions[AppState.currentQuestionIndex].id, 27);
  assert.deepEqual(savedPositions.at(-1), ["category-1", "chapter-1", 26, 27, "multi"]);
  assert.equal(localStorage.getItem("daguan_new_question_mode_v1"), "multi");

  await App.goToChapterQuestion(40);
  assert.equal(AppState.questionOffset, 40, "跳入下一段应只载入第 41–60 题所在的 20 题段");
  assert.equal(AppState.questions[AppState.currentQuestionIndex].id, 41);
  await App.changeQuestionMode("single");
  assert.equal(AppState.currentQuestionIndex, 40);
  assert.equal(AppState.questions[AppState.currentQuestionIndex].id, 41);
  assert.deepEqual(savedPositions.at(-1), ["category-1", "chapter-1", 40, 41, "single"]);
  assert.equal(localStorage.getItem("daguan_new_question_mode_v1"), "single");
});

test("连续做题忽略做题快捷键，单题做题仍可用键盘切题", () => {
  const { sandbox, documentListeners } = createContext();
  const { App, AppState } = sandbox.window;
  AppState.currentView = "question";
  AppState.questionMode = "multi";
  AppState.questions = [{ id: 1, stem: "题干" }];
  AppState.currentQuestionIndex = 0;
  AppState.shortcuts = { down: "ArrowDown", answer: " ", favorite: "f" };
  const calls = [];
  App.nextQuestion = () => calls.push("next");
  App.goToChapterQuestion = () => calls.push("jump");
  App.changeQuestionMode = () => calls.push("mode");
  App.promptJumpToQuestion = () => calls.push("prompt");
  App.toggleAnswer = () => calls.push("answer");
  App.selectOption = () => calls.push("option");
  App.toggleQuestionFavorite = () => calls.push("favorite");
  App.bindKeyboardShortcuts();
  const onKeyDown = documentListeners.get("keydown")[0];
  for (const [key, altKey] of [["j", false], ["k", false], ["m", false], ["g", false], ["1", true], ["ArrowDown", false], [" ", false], ["f", false]]) {
    let prevented = false;
    onKeyDown({ key, altKey, ctrlKey: false, metaKey: false, shiftKey: false, target: {}, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false, `${key} 在连续做题里不应被拦截`);
  }
  assert.deepEqual(calls, []);
  AppState.questionMode = "single";
  onKeyDown({ key: "ArrowDown", ctrlKey: false, metaKey: false, target: {}, preventDefault: () => {} });
  assert.deepEqual(calls, ["next"]);
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

test("上一题、下一题跨子节，跳过筛选为空的小节并保留模式", async () => {
  const { sandbox } = createContext();
  const { App, AppState, UIRenderer } = sandbox;
  const sections = [
    { id: 'a', name: 'A', questions: [{ id: 1 }, { id: 2 }] },
    { id: 'empty', questions: [{ id: 9 }] },
    { id: 'b', name: 'B', questions: [{ id: 3 }, { id: 4 }] },
  ];
  AppState.currentCategory = { id: 'subject', children: [{ id: 'chapter', children: sections }] };
  AppState.currentChapter = sections[0];
  AppState.questions = sections[0].questions;
  AppState.currentQuestionIndex = 1;
  AppState.questionMode = 'single';
  AppState.currentView = 'question';
  App.ensureSavedBeforeLeavingQuestion = async () => true;
  UIRenderer.filteredChapter = async node => ({ ...node, direct_questions: node.id === 'empty' ? [] : node.questions });
  const transitions = [];
  const rewards = [];
  sandbox.DaguanSectionCelebration = { show: (name, id) => rewards.push(id) };
  App.enterChapterQuestions = async (chapter, index, id, mode) => {
    transitions.push([chapter.id, index, mode]);
    AppState.currentChapter = chapter;
    AppState.questions = chapter.direct_questions;
    AppState.currentQuestionIndex = index;
    AppState.questionOffset = 0;
  };
  await App.nextQuestion();
  assert.deepEqual(transitions, [['b', 0, 'single']]);
  assert.deepEqual(rewards, ['a']);
  AppState.questionMode = 'multi';
  await App.previousQuestion();
  assert.deepEqual(transitions[1], ['a', 1, 'multi']);
  assert.deepEqual(rewards, ['a']);
});

test("跨节先保存，快速连按只切换一次，临时题目不跨节", async () => {
  const { sandbox } = createContext();
  const { App, AppState, UIRenderer } = sandbox;
  const a = { id: 'a', questions: [{ id: 1 }] };
  const b = { id: 'b', questions: [{ id: 2 }] };
  Object.assign(AppState, { currentCategory: { children: [a, b] }, currentChapter: a, questions: a.questions, currentQuestionIndex: 0, currentView: 'question', questionMode: 'single' });
  let entered = 0;
  UIRenderer.filteredChapter = async node => node;
  App.enterChapterQuestions = async () => { entered++; };
  App.ensureSavedBeforeLeavingQuestion = async () => false;
  await App.nextQuestion();
  assert.equal(entered, 0);
  let release;
  App.ensureSavedBeforeLeavingQuestion = () => new Promise(resolve => { release = resolve; });
  const pending = App.nextQuestion();
  await App.nextQuestion();
  release(true);
  await pending;
  assert.equal(entered, 1);
  AppState.temporaryQuestionView = true;
  await App.nextQuestion();
  assert.equal(entered, 1);
});

test("连续模式在 20 题分页内外使用全局题号，子节加载失败恢复原题", async () => {
  const { sandbox } = createContext();
  const { App, AppState, UIRenderer } = sandbox;
  const a = { id: 'a', questions: Array.from({ length: 25 }, (_, i) => ({ id: i + 1 })) };
  const b = { id: 'b', questions: [{ id: 30 }] };
  Object.assign(AppState, { currentCategory: { children: [a, b] }, currentChapter: a, questions: a.questions.slice(20), questionOffset: 20, currentQuestionIndex: 0, currentView: 'question', questionMode: 'multi' });
  const targets = [];
  App.goToChapterQuestion = async index => { targets.push(index); };
  await App.previousQuestion();
  await App.nextQuestion();
  assert.deepEqual(targets, [19, 21]);
  AppState.currentQuestionIndex = 4;
  App.ensureSavedBeforeLeavingQuestion = async () => true;
  UIRenderer.filteredChapter = async node => node;
  App.enterChapterQuestions = async chapter => { AppState.currentChapter = chapter; AppState.questions = []; AppState.currentView = 'library'; };
  let restored;
  UIRenderer.renderMultiRange = async (offset, id) => { restored = [offset, id]; };
  let celebrated = false;
  sandbox.DaguanSectionCelebration = { show: () => { celebrated = true; } };
  await App.nextQuestion();
  assert.equal(AppState.currentChapter.id, 'a');
  assert.equal(AppState.currentQuestionIndex, 4);
  assert.deepEqual(restored, [20, 25]);
  assert.equal(celebrated, false);
});

test("小庆祝不重复触发、文字安全写入并自动移除", () => {
  const source = fs.readFileSync(new URL('../web/section-celebration.js', import.meta.url), 'utf8');
  const appended = [];
  let remove;
  const sandbox = { window: {}, clearTimeout() {}, setTimeout(fn) { remove = fn; }, document: {
    querySelector: () => null,
    createElement: () => ({ style: { setProperty() {} }, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); }, remove() { this.removed = true; } }),
    body: { appendChild(node) { appended.push(node); } },
  } };
  vm.runInNewContext(source, sandbox);
  sandbox.window.DaguanSectionCelebration.show('<b>极限</b>', 321);
  sandbox.window.DaguanSectionCelebration.show('极限', 321);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].children[0].textContent, '✓ <b>极限</b>刷完啦');
  assert.equal(appended[0].children.length, 9);
  remove();
  assert.equal(appended[0].removed, true);
});

test("旧版普通和沉浸模式首尾双向跨节，特殊队列保持边界", async () => {
  const source = fs.readFileSync(new URL('../web/app-legacy.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function go(delta) {');
  const end = source.indexOf('\n  function shuffleQueue()', start);
  const rewards = [];
  const transitions = [];
  const state = { index: 1, queue: [{ id: 1 }, { id: 2 }], currentCatId: 'a', focusMode: false, specialQueue: null };
  let release;
  const sandbox = {
    state, chapterTransitioning: false,
    findCat: () => [{ name: '小节' }],
    goToAdjacentChapter: async (delta, options) => {
      transitions.push([delta, options.acrossSubject, options.atEnd]);
      if (release) await release;
      state.currentCatId = delta > 0 ? 'b' : 'a';
      state.index = delta > 0 ? 0 : state.queue.length - 1;
      return true;
    },
    recordCurrentVisit() {}, renderSingle() {}, queueLastStudyPosition() {},
    window: { scrollTo() {}, DaguanSectionCelebration: { show: (name, id) => rewards.push(id) } },
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  await sandbox.go(1);
  assert.deepEqual(transitions, [[1, true, false]]);
  assert.deepEqual(rewards, ['a']);
  state.focusMode = true;
  state.focusSnapshot = { index: 0 };
  await sandbox.go(-1);
  assert.deepEqual(transitions[1], [-1, true, true]);
  assert.equal(state.focusSnapshot.index, 1);
  assert.deepEqual(rewards, ['a']);
  state.specialQueue = 'favorites';
  await sandbox.go(1);
  assert.equal(transitions.length, 2);
  state.specialQueue = null;
  let resolve;
  release = new Promise(done => { resolve = done; });
  const pending = sandbox.go(1);
  await sandbox.go(1);
  resolve();
  await pending;
  assert.equal(transitions.length, 3);
});

test("连续模式进入子节末题时向真实渲染器传递末题 ID", async () => {
  const { sandbox } = createContext();
  const { App, AppState, UIRenderer } = sandbox;
  const chapter = { id: 'a', questions: Array.from({ length: 25 }, (_, index) => ({ id: index + 1 })) };
  AppState.currentCategory = { id: 'subject' };
  UIRenderer.filteredChapter = async node => node;
  let rendered;
  UIRenderer.renderMultiRange = async (start, id) => {
    rendered = [start, id];
    AppState.questions = chapter.questions.slice(start);
    AppState.currentQuestionIndex = 4;
  };
  App.recordVisit = () => {};
  sandbox.StateSync.pushLastStudy = async () => {};
  await App.enterChapterQuestions(chapter, 24, null, 'multi');
  assert.deepEqual(rendered, [20, 25]);
});
