import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyLocalClassifications } from "../local-server/official-question-bank.mjs";

const data = name => JSON.parse(readFileSync(new URL(`../web/data/${name}`, import.meta.url), "utf8"));
const config = data("official-orphan-classifications.json");
const index = data("id_index.json");
const shards = new Map();
const original = Object.keys(config.assignments).map(id => {
  const name = index[id];
  if (!shards.has(name)) shards.set(name, data(`shards/${name}.json`));
  const question = shards.get(name).find(item => String(item.id) === id);
  assert.ok(question, `题目 ${id} 在当前题库中缺失`);
  return { ...question, category_id: null, category_ids: [], category_path: "" };
});
const categories = data("categories.json").filter(category => category.id !== "orphan");
categories.find(category => category.id === 2500).children =
  categories.find(category => category.id === 2500).children.filter(category => category.id !== 9900100);

test("all 492 reviewed official orphans receive stable local categories without changing their content", () => {
  const snapshot = { questions: original, categories, total: original.length };
  const result = applyLocalClassifications(snapshot, config);
  assert.equal(Object.keys(config.assignments).length, 492);
  assert.equal(result.questions.length, 492);
  assert.equal(new Set(result.questions.map(question => question.id)).size, 492);
  assert.equal(result.questions.filter(question => question.category_id == null).length, 0);
  assert.equal(result.questions.filter(question => question.category_ids.length > 1).length, 19);
  assert.deepEqual(result.questions.map(question => [question.id, question.stem, question.answer, question.source]),
    original.map(question => [question.id, question.stem, question.answer, question.source]));
  assert.equal(result.categories.find(category => category.id === 2500).children.some(category =>
    category.id === 9900100 && category.name === "Euclid 2027八月模考"), true);
  assert.equal(result.questions.filter(question => question.category_id === 9900100).length, 37);
  assert.equal(original.every(question => question.category_id == null), true);
});

test("official categories take priority and future unclassified questions stay unclassified", () => {
  const official = { ...original[0], category_id: 601, category_ids: [601] };
  const primaryOnly = { ...original[1], category_id: 223, category_ids: [] };
  const future = { ...original[0], id: 999999 };
  const result = applyLocalClassifications({ questions: [official, primaryOnly, future], categories, total: 3 }, config);
  assert.deepEqual(result.questions[0].category_ids, [601]);
  assert.deepEqual(result.questions[1].category_ids, [223]);
  assert.equal(result.questions[2].category_id, null);
  assert.deepEqual(result.questions[2].category_ids, []);
  assert.equal(result.categories.find(category => category.id === 2500).children.some(category => category.id === 9900100), false);
});

test("generated catalog indexes every reviewed question without duplicating its ID", () => {
  const manifest = data("manifest.json");
  const idIndex = data("id_index.json");
  const categoryQuestions = data("category_questions.json");
  const searchIndex = data("search_index.json");
  const cache = new Map();
  assert.equal(manifest.total, manifest.source_total + 159);
  assert.equal(manifest.shards["未分类"].count, 0);
  assert.equal(categoryQuestions.orphan?.length || 0, 0);
  assert.equal(Object.keys(idIndex).length, manifest.total);
  assert.equal(new Set(searchIndex.map(question => question.id)).size, manifest.total);
  for (const id of Object.keys(config.assignments)) {
    const shardName = idIndex[id];
    assert.ok(shardName && shardName !== "未分类", `题目 ${id} 未进入分片`);
    if (!cache.has(shardName)) cache.set(shardName, data(`shards/${shardName}.json`));
    const question = cache.get(shardName).find(item => String(item.id) === id);
    assert.ok(question, `题目 ${id} 在分片中缺失`);
    assert.ok(question.category_ids.length > 0, `题目 ${id} 没有分类`);
    for (const categoryId of question.category_ids) {
      assert.ok(categoryQuestions[categoryId]?.includes(Number(id)), `题目 ${id} 未进入分类 ${categoryId}`);
    }
  }
});
