import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadNewUI() {
  const sandbox = {
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { protocol: "file:", search: "", pathname: "/index.html", href: "file:///index.html", replace: () => {} },
    document: { addEventListener: () => {}, documentElement: { dataset: {} }, createElement: () => ({ set innerHTML(value) {}, set textContent(value) {} }) },
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
  vm.runInContext(fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8"), sandbox, { filename: "app-new.js" });
  return sandbox;
}

test("新版章节范围沿用严选和真题匹配，并与详细筛选同时生效", () => {
  const ui = loadNewUI();
  const state = ui.AppState;
  const match = ui.UIRenderer.chapterScopeMatch;
  state.chapterScope = "all";
  state.filters = { sources: [], years: [], types: [], lecturers: [] };
  state.libraryQuery = "";
  assert.equal(match({ id: 1, source: "基础练习", is_core: false }), true);

  state.chapterScope = "core";
  assert.equal(match({ id: 1, source: "基础练习", is_core: true }), true);
  assert.equal(match({ id: 2, source: "基础练习", is_core: false }), false);

  state.chapterScope = "real";
  assert.equal(match({ id: 3, source: "2022 数学一真题", year: 2022 }), true);
  assert.equal(match({ id: 4, source: "普通练习", year: "", category: "高数" }), false);
  state.filters.years = ["2022"];
  assert.equal(match({ id: 5, source: "2021 数学一真题", year: 2021 }), false);
  assert.equal(match({ id: 6, source: "2022 数学一真题", year: 2022 }), true);
});

test("混合节点练习只取直属映射，题目顺序按目录映射保持", async () => {
  const ui = loadNewUI();
  ui.AppState.chapterScope = "all";
  ui.AppState.filters = { sources: [], years: [], types: [], lecturers: [] };
  ui.AppState.libraryQuery = "";
  const questions = [
    { id: 11, source: "普通练习" },
    { id: 12, source: "2022 数学二真题" },
  ];
  let loadCalls = 0;
  ui.DataService.loadQuestionsForChapter = async () => { loadCalls += 1; return questions; };
  const mixed = {
    id: "1146",
    direct_questions: [{ id: 11, shard: "a" }, { id: 12, shard: "b" }],
    questions: [{ id: 11, shard: "a" }, { id: 12, shard: "b" }, { id: 13, shard: "c" }],
    children: [{ id: 1147 }],
  };
  const queue = await ui.UIRenderer.filteredChapter(mixed, true);
  assert.deepEqual(Array.from(queue.direct_questions, entry => String(entry.id)), ["11", "12"]);
  assert.equal(loadCalls, 0, "完整范围不应为了构造队列而提前读取整个章节分片");
  assert.deepEqual(Array.from(mixed.children, child => child.id), [1147]);
});

test("新版目录保留全部一级科目和混合直属题入口，不再重复铺开子章", () => {
  const categories = JSON.parse(fs.readFileSync(new URL("../web/data/categories.json", import.meta.url), "utf8"));
  const roots = Array.isArray(categories) ? categories : categories.categories;
  const flatten = node => [node, ...(node.children || []).flatMap(flatten)];
  const allNodes = roots.flatMap(flatten);
  const mixed = allNodes.find(node => String(node.id) === "1146");
  const empty = allNodes.find(node => String(node.id) === "389");
  assert.equal(roots.some(node => String(node.id) === "orphan"), true);
  assert.equal(mixed.direct_count, 6);
  assert.equal(mixed.children.length, 4);
  assert.equal(empty.question_count, 0);

  const source = fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../web/styles-new.css", import.meta.url), "utf8");
  assert.match(source, /\(AppState\.categories\?\.categories \|\| \[\]\)\.forEach\(subject/);
  assert.match(source, /start-direct-directory/);
  assert.match(source, /data-open-chapter-picker/);
  assert.match(source, /ArrowDown.*ArrowUp.*Home.*End/s);
  assert.doesNotMatch(source, /class="directory-children"/);
  assert.match(styles, /width: 280px/);
  assert.match(styles, /chapter-picker-column:last-child \{ display: flex; \}/);
});
