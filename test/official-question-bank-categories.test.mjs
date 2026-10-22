import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addCollectionCategories,
  completeOfficialCategories,
  stripUnavailableAnswerImages,
} from "../local-server/official-question-bank.mjs";

function flatten(categories) {
  const result = new Map();
  function visit(category, parent = null, prefix = "") {
    const current = prefix ? `${prefix} / ${category.name}` : category.name;
    result.set(Number(category.id), { category, parent, path: current });
    for (const child of category.children || []) visit(child, Number(category.id), current);
  }
  for (const category of categories) visit(category);
  return result;
}

test("hidden official roots and category paths are rebuilt without inventing shard roots", () => {
  const snapshot = {
    total: 3,
    categories: [
      { id: 223, name: "高等数学", children: [] },
      { id: 1, name: "线性代数", children: [] },
      { id: 601, name: "概率统计", children: [] },
    ],
    questions: [
      { id: 1, category_id: 2482, category_ids: [2482, 2483],
        category_name: "历年真题 / 数一 / 2007" },
      { id: 2, category_id: 2677, category_ids: [2677],
        category_name: "模拟卷 / 数一 / 线代王六套 / 线代王六套一" },
      { id: 3, category_id: null, category_ids: [], category_name: null },
    ],
  };
  const previous = [{ id: 836, name: "历年真题" }, { id: 2500, name: "模拟卷" }];
  const result = completeOfficialCategories(snapshot, previous);
  const categories = flatten(result.categories);
  assert.equal(categories.has(836), true);
  assert.equal(categories.has(2500), true);
  assert.equal(categories.get(2482).path, "历年真题 / 数一 / 2007");
  assert.equal(categories.get(2677).path, "模拟卷 / 数一 / 线代王六套 / 线代王六套一");
  assert.deepEqual(result.questions[0].category_ids, [2482]);
  assert.deepEqual(result.questions[1].category_ids, [2677]);
  assert.equal(result.questions[2].category_id, null);
  assert.deepEqual(result.droppedCategoryIds, [2483]);
  assert.equal(new Set(categories.keys()).size, categories.size, "分类 ID 必须唯一");
});

test("original answer scans are removed only when their files are unavailable", async t => {
  const dir = await fs.mkdtemp(path.join("F:/AI/tmp", "daguan-answer-assets-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const assets = path.join(dir, "fallback");
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(assets, `${"a".repeat(64)}.png`), "image");
  await fs.mkdir(path.join(dir, "shards"), { recursive: true });
  const questions = [
    { id: 1, explanation: "文字解析\n\n### 原始参考答案（源文件顺序）\n\n![参考答案](assets/" + "a".repeat(64) + ")" },
    { id: 2, explanation: "文字解析\n\n### 原始参考答案（源文件顺序）\n\n![参考答案](assets/" + "b".repeat(64) + ")" },
    { id: 3, explanation: "没有附图的解析" },
  ];
  await fs.writeFile(path.join(dir, "shards", "fixture.json"), JSON.stringify(questions));
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({
    total: 3, asset_count: 2,
    shards: { fixture: { file: "shards/fixture.json", count: 3 } },
  }));
  const result = await stripUnavailableAnswerImages(dir, assets);
  const stored = JSON.parse(await fs.readFile(path.join(dir, "shards", "fixture.json"), "utf8"));
  assert.equal(result.stripped, 1);
  assert.match(stored[0].explanation, /原始参考答案/);
  assert.equal(stored[1].explanation, "文字解析");
  assert.equal(stored[2].explanation, "没有附图的解析");
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.asset_count, 1);
  assert.equal(manifest.stripped_answer_images, 1);
});

test("official list becomes a read-only directory under linear algebra with original order", () => {
  const result = {
    categories: [{ id: 1, name: "线性代数", parent_id: null, question_count: 2, direct_count: 0, children: [] }],
    categoryQuestions: {},
    shards: { 线性代数: [{ id: 101, category_ids: [9] }, { id: 102, category_ids: [10] }] },
    manifest: {},
  };
  const collection = {
    definition: { id: "linear-algebra-selected-20261018", parentRootId: 1, categoryIdBase: 7000000 },
    metadata: { id: "linear-algebra-selected-20261018", name: "线代严选题", revision: 2 },
    directory: { total: 2, roots: [{ id: "1", label: "线性代数", category_id: 1, question_count: 2,
      children: [
        { id: "9", label: "行列式", category_id: 9, question_count: 1, children: [] },
        { id: "10", label: "矩阵", category_id: 10, question_count: 1, children: [] },
      ] }] },
    items: [{ question_id: 102, position: 1 }, { question_id: 101, position: 2 }],
  };
  addCollectionCategories(result, [collection]);
  const root = result.categories[0].children.find(category => category.id === 7000000);
  assert.equal(root.name, "线代严选题");
  assert.equal(root.question_count, 2);
  assert.deepEqual(result.categoryQuestions["7000000"], [102, 101]);
  assert.deepEqual(result.categoryQuestions["7000010"], [102]);
  assert.deepEqual(result.categoryQuestions["7000009"], [101]);
  assert.equal(result.categories[0].question_count, 2, "题单不得改变原学科题数");
  assert.deepEqual(result.manifest.collections, [
    { id: "linear-algebra-selected-20261018", name: "线代严选题", question_count: 2, unmatched: 0 },
  ]);
});
