import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app = fs.readFileSync(new URL("../web/app2.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("  function getLandingEntry("), app.indexOf("  async function init()"));

function fixture({ unlocked = true, resume = false } = {}) {
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    location: { search: "" },
    state: {},
    goHome: () => calls.push("home"),
    previewPrivateAllowed: () => unlocked,
    openPreviewAccess: () => calls.push("unlock"),
    resumeSavedLearningPosition: async () => { calls.push("resume"); return resume; },
    setView: (view) => calls.push(`view:${view}`),
    applyMode: (mode) => calls.push(`mode:${mode}`),
    openChapterMenu: () => calls.push("chapters"),
    openFeaturePage: (kind) => calls.push(`feature:${kind}`),
    refreshSyncStats: () => calls.push("backup-stats"),
    openSheet: (kind) => calls.push(`sheet:${kind}`),
    openAiSettings: () => calls.push("ai-settings"),
  });
  vm.runInContext(`${source}\nthis.entry = { parse: getLandingEntry, open: openLandingEntry, pending: () => pendingLandingEntry };`, context);
  return { context, calls, entry: context.entry };
}

test("首页入口只接受白名单，无入口保持现有启动行为", () => {
  const { entry } = fixture();
  assert.equal(entry.parse("?purge=1"), null);
  assert.equal(entry.parse("?entry=retest"), "retest");
  assert.equal(entry.parse("?entry=learning-records&from=home"), "learning-records");
  assert.equal(entry.parse("?entry=unknown"), "home");
  assert.equal(entry.parse("?entry=https://example.com"), "home");
  assert.equal(entry.parse("?entry="), "home");
});

test("有学习记录时继续原题，无记录时选择章节", async () => {
  const saved = fixture({ resume: true });
  await saved.entry.open("resume");
  assert.deepEqual(saved.calls, ["home", "resume"]);
  const fresh = fixture();
  await fresh.entry.open("resume");
  assert.deepEqual(fresh.calls, ["home", "resume", "view:browse", "mode:list", "chapters"]);
});

test("明确选择章节不会自动恢复旧题", async () => {
  const { entry, calls } = fixture({ resume: true });
  await entry.open("chapters");
  assert.deepEqual(calls, ["home", "view:browse", "mode:list", "chapters"]);
});

test("预览锁定拦截个人入口，并保留解锁后的目的地", async () => {
  for (const destination of ["favorites", "retest", "mastery", "learning-records", "backup", "ai-settings"]) {
    const { entry, calls } = fixture({ unlocked: false });
    await entry.open(destination);
    assert.deepEqual(calls, ["home", "unlock"], destination);
    assert.equal(entry.pending(), destination);
  }
});

test("公开预览仍能浏览章节及阅读教程", async () => {
  const { entry, calls } = fixture({ unlocked: false });
  await entry.open("chapters");
  assert.ok(calls.includes("chapters"));
  assert.ok(!calls.includes("unlock"));
  calls.length = 0;
  await entry.open("tutorial");
  assert.deepEqual(calls, ["home", "sheet:dlg-tutorial"]);
});

test("复习、收藏、记录和工具直达原有功能页面", async () => {
  for (const kind of ["favorites", "retest", "mastery", "learning-records", "tools"]) {
    const { entry, calls } = fixture();
    await entry.open(kind);
    assert.deepEqual(calls, ["home", `feature:${kind}`]);
  }
});

test("备份和同步入口仅打开面板或说明，不触发同步写入", async () => {
  const { entry, calls } = fixture();
  await entry.open("backup");
  assert.deepEqual(calls, ["home", "backup-stats", "sheet:dlg-sync"]);
  calls.length = 0;
  await entry.open("sync-guide");
  assert.deepEqual(calls, ["home", "sheet:dlg-sync-guide"]);
});

test("首次使用的直达入口等待进度加载，且不被欢迎弹窗覆盖", async () => {
  const { context, calls } = fixture({ resume: true });
  let releaseProgress;
  const progress = new Promise((resolve) => { releaseProgress = resolve; });
  context.location.search = "?entry=resume";
  Object.assign(context, {
    checkRuntimeVersion() {}, checkGithubCatalogVersion() {}, applyUiPreferences() {}, loadUiBackground() {},
    hydratePreviewAccess: async () => {}, bindUI() {}, applyModeUI() {},
    hydrateStores: () => progress, hydrateServerState: async () => {},
    fetchJSON: async () => [], DATA: "./data", paintTree() {}, renderHome() {},
    refreshHomeSyncCard() {}, refreshPickUI() {},
    restoreLearningPosition: () => calls.push("restore-old-position"),
    localStorage: { getItem: () => null }, TUTORIAL_SEEN_KEY: "tutorial",
    toast: (value) => calls.push(value), console,
  });
  const initStart = app.indexOf("  async function init()");
  const init = app.slice(initStart, app.indexOf('  window.addEventListener("pagehide"', initStart));
  vm.runInContext(`${init}\nthis.start = init;`, context);
  await context.start();
  assert.ok(!calls.includes("resume"));
  assert.ok(!calls.includes("restore-old-position"));
  assert.ok(!calls.includes("sheet:dlg-welcome"));
  releaseProgress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes("resume"));
});
