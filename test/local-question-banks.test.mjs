import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergeLocalQuestionBanks } from "../shared/local-question-banks.mjs";

// 本地题库 overlay 合并：正常合并、幂等跳过、坏数据中止，覆盖审计 P0-1 的形状缺口。

const BASE_QUESTION = { id: 1, stem: "原题", options: [], answer: "答案", explanation: "", source: "某源",
  type: "subjective", is_core: false, category_id: 601, category_ids: [601], category_path: "概率统计",
  serial: 1, correct_labels: [] };

const CHOICE_OPTIONS = [
  { id: "opt-a", label: "A", content_md: "甲" },
  { id: "opt-b", label: "B", content_md: "乙" },
];

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/** 造一个最小但完整的数据目录：一个已有题库 + 一个 overlay 位。 */
async function seedDataDir(dir) {
  await Promise.all([
    writeJson(path.join(dir, "manifest.json"), {
      version: 1, total: 1, types: { subjective: 1 },
      shards: { 概率统计: { file: "shards/概率统计.json", count: 1 } },
    }),
    writeJson(path.join(dir, "categories.json"), [
      { id: 223, name: "高等数学", parent_id: null, question_count: 0, direct_count: 0, children: [] },
      { id: 601, name: "概率统计", parent_id: null, question_count: 1, direct_count: 0, children: [] },
    ]),
    writeJson(path.join(dir, "category_questions.json"), { "601": [1] }),
    writeJson(path.join(dir, "id_index.json"), { "1": "概率统计" }),
    writeJson(path.join(dir, "search_index.json"), [
      { id: 1, source: "某源", type: "subjective", path: "概率统计", serial: 1, stem: "原题" },
    ]),
    writeJson(path.join(dir, "shards/概率统计.json"), [BASE_QUESTION]),
  ]);
}

function overlayWith(questions) {
  return {
    id: "test-overlay",
    parentCategoryId: 601,
    rootCategory: { id: 9900001, name: "测试题库" },
    chapters: [{ id: 9900002, number: 1, name: "第1章 测试", questionCount: questions.length }],
    questions,
  };
}

function overlayQuestion(extra) {
  return {
    id: 99000001, stem: "题干", options: [], answer: "解答", explanation: "解析",
    source: "测试来源 第1章 例1", type: "subjective", is_core: false,
    category_id: 9900002, category_ids: [9900002], category_path: "概率统计 / 测试题库 / 第1章 测试",
    serial: 1, correct_labels: [], ...extra,
  };
}

async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    const resolved = path.resolve(dir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(prefix)) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}

test("合并本地题库：写入分片、分类树、索引与统计，重复执行直接跳过", async () => {
  await withTempDir("daguan-local-bank-", async dir => {
    await seedDataDir(dir);
    await writeJson(path.join(dir, "local_question_banks/test.json"), overlayWith([
      overlayQuestion({ id: 99000001 }),
      overlayQuestion({ id: 99000002, type: "single_choice", options: CHOICE_OPTIONS, answer: "B", correct_labels: ["B"], serial: 2 }),
    ]));

    const result = await mergeLocalQuestionBanks(dir);
    assert.deepEqual(result, { added: 2, overlays: [{ file: "test.json", added: 2, shard: "概率统计" }] });

    const shard = await readJson(path.join(dir, "shards/概率统计.json"));
    assert.equal(shard.length, 3);
    assert.equal(shard[2].options.length, 2);

    const categories = await readJson(path.join(dir, "categories.json"));
    const root = categories.find(category => category.id === 601);
    assert.equal(root.question_count, 3);
    assert.deepEqual(root.children.map(child => child.id), [9900001]);
    assert.deepEqual(root.children[0].children.map(child => child.id), [9900002]);

    const idIndex = await readJson(path.join(dir, "id_index.json"));
    assert.equal(idIndex["99000002"], "概率统计");
    const categoryQuestions = await readJson(path.join(dir, "category_questions.json"));
    assert.deepEqual(categoryQuestions["9900002"], [99000001, 99000002]);
    assert.deepEqual(categoryQuestions["9900001"], [99000001, 99000002]);
    assert.deepEqual(categoryQuestions["601"], [1, 99000001, 99000002]);

    const searchIndex = await readJson(path.join(dir, "search_index.json"));
    assert.equal(searchIndex.length, 3);
    assert.equal(searchIndex[2].stem, "题干");

    const manifest = await readJson(path.join(dir, "manifest.json"));
    assert.equal(manifest.total, 3);
    assert.deepEqual(manifest.types, { subjective: 2, single_choice: 1 });
    assert.equal(manifest.shards["概率统计"].count, 3);

    const repeated = await mergeLocalQuestionBanks(dir);
    assert.equal(repeated.added, 0);
  });
});

test("合并本地题库：选择题缺 options / correct_labels 时中止且不改数据", async () => {
  const cases = [
    [{ type: "single_choice", correct_labels: ["B"] }, /缺少选项/],
    [{ type: "single_choice", options: CHOICE_OPTIONS, correct_labels: [] }, /缺少正确选项标记/],
    [{ type: "single_choice", options: CHOICE_OPTIONS, answer: "C", correct_labels: ["C"] }, /正确答案 C 不在选项里/],
    [{ type: "single_choice", options: CHOICE_OPTIONS, answer: "AB", correct_labels: ["A", "B"] }, /应有且仅有 1 个正确选项/],
    [{ type: "multiple_choice", options: CHOICE_OPTIONS, answer: "A", correct_labels: ["A"] }, /至少需要 2 个正确选项/],
  ];
  for (const [extra, pattern] of cases) {
    await withTempDir("daguan-local-bank-bad-", async dir => {
      await seedDataDir(dir);
      await writeJson(path.join(dir, "local_question_banks/bad.json"),
        overlayWith([overlayQuestion(extra)]));
      await assert.rejects(mergeLocalQuestionBanks(dir), pattern);
      assert.deepEqual(await readJson(path.join(dir, "shards/概率统计.json")), [BASE_QUESTION]);
      assert.deepEqual(await readJson(path.join(dir, "id_index.json")), { "1": "概率统计" });
      const manifest = await readJson(path.join(dir, "manifest.json"));
      assert.equal(manifest.total, 1);
    });
  }
});

test("合并本地题库：分类 ID 冲突与章节数量不符仍会被拦下", async () => {
  await withTempDir("daguan-local-bank-conflict-", async dir => {
    await seedDataDir(dir);
    await writeJson(path.join(dir, "local_question_banks/dup.json"), {
      ...overlayWith([overlayQuestion({})]),
      rootCategory: { id: 601, name: "占用已有分类" },
      parentCategoryId: 223,
    });
    await assert.rejects(mergeLocalQuestionBanks(dir), /分类 ID 已被占用|找不到父分类/);

    await writeJson(path.join(dir, "local_question_banks/count.json"), {
      ...overlayWith([overlayQuestion({})]),
      chapters: [{ id: 9900002, number: 1, name: "第1章 测试", questionCount: 5 }],
    });
    await assert.rejects(mergeLocalQuestionBanks(dir), /数量不匹配/);
    assert.deepEqual(await readJson(path.join(dir, "shards/概率统计.json")), [BASE_QUESTION]);
  });
});
