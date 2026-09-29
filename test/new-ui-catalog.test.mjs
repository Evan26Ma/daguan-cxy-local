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
  }
  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
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

test("新版目录树把章节选择和展开分开，并保留完整的选中路径", () => {
  const ui = loadNewUI();
  const subject = {
    id: "subject", name: "高等数学", question_count: 150,
    children: [{ id: "branch", name: "函数", question_count: 60, children: [{ id: "leaf", name: "函数表达式", question_count: 11 }] }],
  };
  ui.AppState.categories = { categories: [subject] };
  ui.AppState.currentCategory = subject;
  ui.AppState.directoryNodeId = "leaf";
  ui.AppState.catalogExpandedIds = ["subject", "branch"];
  const tree = new FakeElement("nav");
  ui.__elements.set("library-tree", tree);
  ui.UIRenderer.saveDirectoryState = () => {};
  let rendered = null;
  ui.UIRenderer.renderLibrary = (categoryId, options) => { rendered = [categoryId, options]; };

  ui.UIRenderer.renderLibraryTree(subject);
  const labels = findElements(tree, "catalog-node-label");
  const toggles = findElements(tree, "catalog-toggle");
  const sidebar = new FakeElement();
  const overlay = new FakeElement();
  sidebar.classList.add("open");
  overlay.classList.add("open");
  ui.__elements.set("library-sidebar", sidebar);
  ui.__elements.set("library-toc-overlay", overlay);
  const selectedLeaf = labels.find(button => button.getAttribute("aria-current") === "page");
  assert.equal(selectedLeaf.getAttribute("aria-label"), "函数表达式，全范围总题数 11");
  assert.deepEqual(Array.from(toggles, button => button.getAttribute("aria-expanded")), ["true", "true"]);

  toggles[1].click();
  assert.equal(ui.AppState.currentCategory.id, "subject", "折叠章节不切换科目");
  assert.equal(ui.AppState.directoryNodeId, "leaf", "折叠章节不改选中节点");
  assert.equal(sidebar.classList.contains("open"), true, "折叠箭头不关闭手机目录抽屉");
  assert.equal(findElements(tree, "catalog-toggle")[1].getAttribute("aria-expanded"), "false");
  findElements(tree, "catalog-toggle")[1].click();
  findElements(tree, "catalog-node-label").find(button => button.getAttribute("aria-current") === "page").click();
  assert.deepEqual(Array.from(ui.AppState.catalogExpandedIds), ["subject", "branch"]);
  assert.equal(rendered[0], "subject");
  assert.equal(rendered[1].selectedNodeId, "leaf");
  assert.equal(rendered[1].resetScroll, true);
  assert.equal(sidebar.classList.contains("open"), false, "选中节点后关闭手机目录抽屉");
  assert.equal(overlay.classList.contains("open"), false);

  sidebar.classList.add("open");
  overlay.classList.add("open");
  ui.App.openDirectoryNode("branch");
  assert.equal(ui.AppState.directoryNodeId, "branch");
  assert.deepEqual(Array.from(ui.AppState.catalogExpandedIds), ["subject"]);
  assert.equal(rendered[1].selectedNodeId, "branch");
  assert.equal(rendered[1].resetScroll, true);
  assert.equal(sidebar.classList.contains("open"), false);
  assert.equal(overlay.classList.contains("open"), false);
});

test("目录概览列出直属子章，混合节点直属题单独练习且数量口径明确", () => {
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
  const tree = new FakeElement("nav");
  for (const id of ["library-content", "library-breadcrumb", "library-node-title", "library-up", "library-tree"]) {
    ui.__elements.set(id, id === "library-content" ? content : id === "library-tree" ? tree : new FakeElement());
  }
  ui.AppState.categories = { categories: [subject] };
  ui.AppState.currentCategory = subject;
  ui.AppState.directoryNodeId = String(mixed.id);
  ui.AppState.catalogExpandedIds = ["subject"];
  ui.AppState.chapterScope = "core";
  ui.StorageService.getLearningPosition = () => null;
  ui.UIRenderer.renderDirectoryNode(mixed);
  assert.match(content.innerHTML, /class="directory-children"/);
  assert.match(content.innerHTML, /data-directory-child=/);
  assert.match(content.innerHTML, /本级直属题/);
  assert.match(content.innerHTML, /全范围总题数/);
  assert.match(content.innerHTML, /当前练习按“严选”/);
  assert.doesNotMatch(content.innerHTML, /选择小节/);

  const source = fs.readFileSync(new URL("../web/app-new.js", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../web/styles-new.css", import.meta.url), "utf8");
  assert.match(source, /roots\.forEach\(subject => renderNode\(subject, list, 0, subject\.id\)\)/);
  assert.match(source, /start-direct-directory/);
  assert.match(source, /data-open-chapter-picker/);
  assert.match(source, /ArrowDown.*ArrowUp.*Home.*End/s);
  assert.doesNotMatch(source, /id="choose-directory"/);
  assert.match(source, /static selectCatalogNode\(categoryId, nodeId\)/);
  assert.match(source, /static toggleCatalogNode\(nodeId\)/);
  assert.match(styles, /width: 280px/);
  assert.match(styles, /\.catalog-node-label\.selected/);
  assert.match(styles, /\.catalog-toggle\[aria-expanded="true"\]/);
  assert.match(styles, /chapter-picker-column:last-child \{ display: flex; \}/);
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
    subjects: { subject: { nodeId: "leaf", scrollTop: 240, query: "", filters: { sources: [], years: [], types: [], lecturers: [] }, resultLimit: 40 } },
  });
  ui.UIRenderer.applySavedAppearance = () => {};
  ui.StorageService.getLearningPosition = () => null;
  for (const id of ["app-main", "search-input", "filter-content", "library-content", "library-breadcrumb", "library-node-title", "library-up", "library-tree"]) {
    ui.__elements.set(id, new FakeElement(id));
  }
  const content = ui.__elements.get("library-content");

  ui.UIRenderer.renderLibrary("subject");
  assert.equal(ui.AppState.directoryNodeId, "leaf", "重新进入时恢复本地保存的章节路径");
  assert.equal(ui.AppState.libraryScrollTop, 240);
  assert.equal(content.scrollTop, 240);

  ui.UIRenderer.renderLibrary("subject", { selectedNodeId: "branch", resetScroll: true });
  assert.equal(ui.AppState.directoryNodeId, "branch");
  assert.equal(ui.AppState.libraryScrollTop, 0);
  assert.equal(content.scrollTop, 0, "新章节不沿用上一个章节的滚动位置");
});
