import { loadNewUiModules } from './new-ui-loader.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// 回归：范围（完整 / 严选 / 真题）必须是做题队列的硬约束。
// 修复前，resumeLearning 等四个「回到某道题」入口用 ignoreFilters 跳过 filteredChapter，
// 于是「继续做题」把全库队列写回状态，后续「下一题」在全库漫游。
// 本文件既验证 filteredChapter 的实现行为，也钉死入口契约与范围持久化。
const source = fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8");

function loadNewUI(storage = new Map()) {
  const elements = new Map();
  const sandbox = {
    navigator: {},
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { protocol: "file:", search: "", pathname: "/index.html", href: "file:///index.html", replace: () => {} },
    document: {
      addEventListener: () => {},
      documentElement: { dataset: {}, style: { setProperty: () => {} } },
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: id => elements.get(id) || null,
      createElement: () => ({ dataset: {}, style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} }),
      body: { appendChild: () => {} },
    },
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    fetch: () => Promise.reject(new Error("unexpected fetch")),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  loadNewUiModules(sandbox);
  vm.runInContext(source, sandbox, { filename: "app-new.js" });
  sandbox.__elements = elements;
  sandbox.__storage = storage;
  return sandbox;
}

const questions = [
  { id: 1, source: "880 基础练习", is_core: true },
  { id: 2, source: "2022 数学一真题", is_core: false },
  { id: 3, source: "26版660数一二三第6题", is_core: false },
  { id: 4, source: "2021 数学二真题", is_core: true },
  { id: 5, source: "数一强化练习", is_core: true },
];

function scopedChapter() {
  return { id: "leaf", name: "小节", direct_questions: questions.map(q => ({ id: q.id, shard: "high" })), children: [] };
}

function setup(ui) {
  ui.AppState.filters = { sources: [], years: [], types: [], lecturers: [] };
  ui.AppState.libraryQuery = "";
  ui.DataService.loadQuestionsForChapter = async () => questions;
  ui.DataService.ensureShard = async () => new Map(questions.map(q => [q.id, q]));
}

test("范围筛选在章节队列里同时约束严选与真题", async () => {
  const ui = loadNewUI();
  setup(ui);
  ui.AppState.chapterScope = "core";
  const core = await ui.UIRenderer.filteredChapter(scopedChapter());
  assert.deepEqual(Array.from(core.direct_questions, e => String(e.id)), ["1", "4", "5"]);
  ui.AppState.chapterScope = "real";
  const real = await ui.UIRenderer.filteredChapter(scopedChapter());
  assert.deepEqual(Array.from(real.direct_questions, e => String(e.id)), ["2", "4"]);
  ui.AppState.chapterScope = "all";
  const all = await ui.UIRenderer.filteredChapter(scopedChapter());
  assert.equal(all.direct_questions.length, 5);
});

test("ignoreDetails 只忽略详细筛选，不放过范围外的题", async () => {
  const ui = loadNewUI();
  setup(ui);
  ui.AppState.chapterScope = "core";
  ui.AppState.filters = { sources: ["880 题库"], years: [], types: [], lecturers: [] };
  // 详细筛选会滤掉 4/5；回到某道题时忽略详细筛选，但严选范围仍然生效。
  const relaxed = await ui.UIRenderer.filteredChapter(scopedChapter(), false, { ignoreDetails: true });
  assert.deepEqual(Array.from(relaxed.direct_questions, e => String(e.id)), ["1", "4", "5"]);
  const strict = await ui.UIRenderer.filteredChapter(scopedChapter(), false);
  assert.deepEqual(Array.from(strict.direct_questions, e => String(e.id)), ["1"]);
});

test("源码里不再存在跳过范围过滤的 ignoreFilters 旁路", () => {
  assert.doesNotMatch(source, /ignoreFilters/, "范围过滤不能再有跳过分支");
  const enter = source.match(/static async enterChapterQuestions\([\s\S]*?\n    \}/)?.[0] || "";
  assert.ok(enter, "enterChapterQuestions 必须存在");
  assert.match(enter, /await UIRenderer\.filteredChapter\(chapter, directOnly, \{ ignoreDetails \}\)/);
  assert.match(source, /ignoreDetails 只忽略来源\/年份\/题型\/讲师与搜索词/);
});

test("四个“回到某道题”入口都经统一入口且携带范围校验", () => {
  const bodies = {
    openHistoryQuestion: source.match(/static async openHistoryQuestion\([\s\S]*?\n    \}/)?.[0] || "",
    continueDirectoryNode: source.match(/static async continueDirectoryNode\([\s\S]*?\n    \}/)?.[0] || "",
    resumeLearning: source.match(/static async resumeLearning\([\s\S]*?\n    \}/)?.[0] || "",
    openGlobalSearchResult: source.match(/static async openGlobalSearchResult\([\s\S]*?\n    \}/)?.[0] || "",
  };
  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(body, `${name} 必须存在`);
    assert.doesNotMatch(body, /ignoreFilters/, `${name} 不得跳过范围过滤`);
    assert.match(body, /enterChapterQuestions/, `${name} 必须经统一入口进入做题`);
  }
  assert.match(bodies.openHistoryQuestion, /requireTarget: true/, "历史回到指定题：范围外要明确拒绝");
  assert.match(bodies.openGlobalSearchResult, /requireTarget: true/, "搜索打开指定题：范围外要明确拒绝");
});

test("目标题被范围过滤时给出提示并保持原位，而不是静默换题", () => {
  assert.match(source, /不在当前\$\{AppState\.chapterScope === 'core' \? '严选' : '真题'\}范围，请切换题库范围/);
  assert.match(source, /requireTarget/);
});

test("题库范围跨会话保留，启动时恢复", () => {
  const storage = new Map([["daguan_new_chapter_scope_v1", "real"]]);
  const ui = loadNewUI(storage);
  assert.equal(ui.UIRenderer.readSavedScope(), "real");
  ui.UIRenderer.saveScope("core");
  assert.equal(storage.get("daguan_new_chapter_scope_v1"), "core");
  ui.UIRenderer.saveScope("bogus");
  assert.equal(storage.get("daguan_new_chapter_scope_v1"), "all");
  assert.match(source, /AppState\.chapterScope = UIRenderer\.readSavedScope\(\)/);
  assert.match(source, /UIRenderer\.saveScope\(scope\)/);
});

test("范围恢复后目录与章节显示同步刷新", () => {
  assert.match(source, /void UIRenderer\.ensureScopeQuestionIds\(AppState\.chapterScope\)/);
  assert.match(source, /scopeSummaryText\(\)/);
});
