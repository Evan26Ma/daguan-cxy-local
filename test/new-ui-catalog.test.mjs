import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    };
    this.style = { setProperty: () => {} };
    this.hidden = false;
    this._innerHTML = "";
    this._textContent = "";
  }
  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
  set textContent(value) { this._textContent = String(value ?? ""); this._innerHTML = this._textContent; }
  get textContent() { return this._textContent; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  appendChild(child) { this.children.push(child); return child; }
  querySelectorAll() { return []; }
  click() { this.handlers.click?.({ target: this }); }
}

function loadNewUI() {
  const elements = new Map();
  const sandbox = {
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { protocol: "file:", search: "", pathname: "/index.html", href: "file:///index.html", replace: () => {} },
    document: {
      addEventListener: () => {},
      documentElement: { dataset: {} },
      createElement: tagName => new FakeElement(tagName),
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [],
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
  vm.runInContext(fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8"), sandbox, { filename: "app-new.js" });
  sandbox.__elements = elements;
  return sandbox;
}

function findElements(root, className) {
  const found = [];
  const visit = element => {
    if (String(element.className || "").split(/\s+/).includes(className)) found.push(element);
    for (const child of element.children || []) visit(child);
  };
  visit(root);
  return found;
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

test("新版目录按深度生成级联列，选中路径用节点 id 保持且改选兄弟会截断后续列", () => {
  const ui = loadNewUI();
  const subject = {
    id: "subject", name: "高等数学", question_count: 150,
    children: [{ id: "branch", name: "极限", question_count: 60, children: [{ id: "leaf", name: "极限", question_count: 11 }] }, { id: "sibling", name: "极限", question_count: 8, children: [{ id: "sibling-leaf", name: "另一条路径", question_count: 3 }] }],
  };
  const other = { id: "other", name: "线性代数", question_count: 20, children: [] };
  ui.AppState.categories = { categories: [subject, other] };
  ui.AppState.currentCategory = subject;
  ui.AppState.directoryNodeId = "leaf";
  const deep = ui.UIRenderer.catalogColumns(subject, subject.children[0].children[0]);
  assert.deepEqual(Array.from(deep, column => column.selectedId), ["subject", "branch", "leaf"]);
  assert.equal(deep[0].items.find(item => item.node.id === "subject").selected, true);
  assert.equal(deep[1].items.find(item => item.node.id === "branch").selected, true);
  assert.equal(deep[1].items.find(item => item.node.id === "sibling").selected, false);

  const siblingPath = ui.UIRenderer.pathToNode(subject, "sibling-leaf");
  assert.deepEqual(Array.from(siblingPath, node => node.id), ["subject", "sibling", "sibling-leaf"]);
  const siblingColumns = ui.UIRenderer.catalogColumns(subject, subject.children[1]);
  assert.deepEqual(Array.from(siblingColumns, column => column.selectedId), ["subject", "sibling", null]);
  assert.equal(siblingColumns.length, 3, "选择兄弟后只保留新路径下的列");

  const columnsHost = new FakeElement("div");
  const otherRootButton = new FakeElement("button");
  otherRootButton.dataset.catalogNode = "other";
  otherRootButton.dataset.catalogCategory = "other";
  columnsHost.querySelectorAll = selector => selector === "[data-catalog-node]" ? [otherRootButton] : [];
  ui.__elements.set("directory-columns", columnsHost);
  let clicked = null;
  let rendered = null;
  const selectDirectoryItem = ui.App.selectDirectoryItem;
  const renderLibrary = ui.UIRenderer.renderLibrary;
  ui.App.selectDirectoryItem = (...args) => { clicked = args; return selectDirectoryItem.apply(ui.App, args); };
  ui.UIRenderer.renderLibrary = (...args) => { rendered = args; };
  ui.UIRenderer.renderCatalogColumns(subject, subject);
  otherRootButton.click();
  ui.App.selectDirectoryItem = selectDirectoryItem;
  ui.UIRenderer.renderLibrary = renderLibrary;
  assert.match(columnsHost.innerHTML, /data-catalog-node="other" data-catalog-category="other"/);
  assert.deepEqual(Array.from(clicked), ["other", "other"], "点击其他科目根节点时使用该根节点作为目标科目");
  assert.equal(ui.AppState.currentCategory.id, "other");
  assert.equal(ui.AppState.directoryNodeId, "other");
  assert.equal(rendered[0], "other");
});

test("九层目录路径渲染后自动显示末级，完整面包屑仍可向左回看", () => {
  const ui = loadNewUI();
  let leaf = { id: "n9", name: "第九级", question_count: 1, direct_questions: [{ id: "q9" }], children: [] };
  for (let depth = 8; depth >= 1; depth -= 1) {
    leaf = { id: `n${depth}`, name: `第${depth}级`, question_count: 1, children: [leaf] };
  }
  const subject = { id: "subject", name: "高等数学", question_count: 1, children: [leaf] };
  const content = new FakeElement("main");
  const breadcrumb = new FakeElement("nav");
  breadcrumb.clientWidth = 120;
  breadcrumb.scrollWidth = 1000;
  for (const id of ["library-content", "library-breadcrumb", "library-node-title", "directory-columns", "directory-selection-state"]) {
    ui.__elements.set(id, id === "library-content" ? content : id === "library-breadcrumb" ? breadcrumb : new FakeElement());
  }
  ui.AppState.categories = { categories: [subject] };
  ui.AppState.currentCategory = subject;
  ui.AppState.directoryNodeId = "n9";
  ui.StorageService.getLearningPosition = () => null;

  ui.UIRenderer.renderDirectoryNode({ id: "n9", name: "第九级", question_count: 1, direct_questions: [{ id: "q9" }], children: [] });
  assert.equal(breadcrumb.scrollLeft, 880);
  assert.match(breadcrumb.innerHTML, /第九级/);
  assert.doesNotMatch(breadcrumb.innerHTML, /breadcrumb-more|…/);
});

test("级联目录保留混合节点直属题入口，并为零题叶子显示不可开始状态", () => {
  const ui = loadNewUI();
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
  mixed.direct_questions = Array.from({ length: mixed.direct_count }, (_, index) => ({ id: `direct-${index + 1}`, shard: "test" }));

  const subject = { id: "subject", name: "高等数学", children: [mixed] };
  const content = new FakeElement("main");
  for (const id of ["library-content", "library-breadcrumb", "library-node-title", "directory-columns", "directory-selection-state"]) {
    ui.__elements.set(id, id === "library-content" ? content : new FakeElement());
  }
  ui.AppState.categories = { categories: [subject] };
  ui.AppState.currentCategory = subject;
  ui.AppState.directoryNodeId = String(mixed.id);
  ui.AppState.chapterScope = "core";
  ui.StorageService.getLearningPosition = () => null;
  const columns = ui.UIRenderer.catalogColumns(subject, mixed);
  assert.equal(columns.at(-1).directNode.id, mixed.id);
  assert.equal(columns.at(-1).items.filter(item => item.selected).length, 0, "混合节点本身位于上一列，右侧列保留直属入口");
  ui.UIRenderer.renderDirectoryNode(mixed);
  assert.match(content.innerHTML, /class="directory-cascade"/);
  assert.match(content.innerHTML, /id="directory-columns"/);
  assert.doesNotMatch(content.innerHTML, /directory-cascade-intro/);

  const emptyNode = { id: "empty", name: "空小节", question_count: 0, children: [], direct_questions: [] };
  subject.children = [emptyNode];
  ui.AppState.directoryNodeId = "empty";
  ui.UIRenderer.renderDirectoryNode(emptyNode);
  assert.match(ui.__elements.get("directory-selection-state").innerHTML, /此章节暂无题目/);

  const source = fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../web/styles-new.css", import.meta.url), "utf8");
  assert.match(source, /static catalogColumns\(category, activeNode = null\)/);
  assert.match(source, /data-cascade-direct=/);
  assert.match(source, /static selectDirectoryItem\(categoryId, nodeId\)/);
  assert.match(source, /static startDirectDirectory\(categoryId, nodeId\)/);
  assert.doesNotMatch(source, /id="library-tree"/);
  assert.match(source, /static selectCatalogNode\(categoryId, nodeId\)/);
  assert.match(styles, /\.directory-columns[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.directory-column[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.directory-column-item\.selected/);
});

test("目录恢复本地节点路径，主动选新节点时滚动位置归零", () => {
  const ui = loadNewUI();
  const subject = {
    id: "subject", name: "高等数学", question_count: 20,
    children: [{ id: "branch", name: "函数", question_count: 11, children: [{ id: "leaf", name: "函数表达式", question_count: 11 }] }],
  };
  ui.AppState.categories = { categories: [subject] };
  ui.AppState.currentCategory = subject;
  ui.UIRenderer.readDirectoryState = () => ({
    version: 1,
    subjects: { subject: { nodeId: "leaf", pathIds: ["subject", "branch", "leaf"], scrollTop: 240, query: "", filters: { sources: [], years: [], types: [], lecturers: [] }, resultLimit: 40 } },
  });
  ui.UIRenderer.applySavedAppearance = () => {};
  ui.StorageService.getLearningPosition = () => null;
  for (const id of ["app-main", "search-input", "filter-content", "library-content", "library-breadcrumb", "library-node-title", "directory-columns", "directory-selection-state"]) {
    ui.__elements.set(id, new FakeElement(id));
  }
  const content = ui.__elements.get("library-content");

  ui.UIRenderer.renderLibrary("subject");
  assert.equal(ui.AppState.directoryNodeId, "leaf", "重新进入时恢复本地保存的章节路径");
  assert.deepEqual(Array.from(ui.AppState.directoryPathIds), ["subject", "branch", "leaf"]);
  assert.equal(ui.AppState.libraryScrollTop, 240);
  assert.equal(content.scrollTop, 240);

  ui.UIRenderer.renderLibrary("subject", { selectedNodeId: "branch", resetScroll: true });
  assert.equal(ui.AppState.directoryNodeId, "branch");
  assert.equal(ui.AppState.libraryScrollTop, 0);
  assert.equal(content.scrollTop, 0, "新章节不沿用上一个章节的滚动位置");
});
