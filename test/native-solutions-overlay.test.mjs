import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncOfficialQuestionBank } from "../local-server/official-question-bank.mjs";
import { createQuestionBankUpdater } from "../local-server/question-bank-updater.mjs";
import { applyNativeSolutions, emptyNativeSolutionStats, questionSignature } from "../shared/native-solutions.mjs";

const ROOTS = [223, 1, 601, 836, 2500];
const CATEGORIES = ROOTS.map(id => ({ id, name: `分类${id}`, children: [] }));

const choiceOptions = [
  { id: "opt-a", label: "A", content_md: "甲" },
  { id: "opt-b", label: "B", content_md: "乙" },
];

const OFFICIAL_QUESTIONS = [
  { id: 1, category_id: 223, category_ids: [223], content_hash: "h1", is_core: false,
    document: { question_type: "essay", stem_md: "主观题干", answer: { reference_answer_md: "官网答案" },
      explanation_md: "官网解析" } },
  { id: 2, category_id: 1, category_ids: [1], content_hash: "h2", is_core: false,
    document: { question_type: "single_choice", stem_md: "选择题干", options: choiceOptions,
      answer: { option_ids: ["opt-b"] }, explanation_md: "官网解析2" } },
  { id: 3, category_id: 601, category_ids: [601], content_hash: "h3", is_core: false,
    document: { question_type: "essay", stem_md: "旧题干", answer: { reference_answer_md: "官网答案3" } } },
  { id: 4, category_id: 223, category_ids: [223], content_hash: "h4", is_core: false,
    document: { question_type: "single_choice", stem_md: "选择题干4", options: choiceOptions,
      answer: { option_ids: ["opt-b"] }, explanation_md: "官网解析4" } },
];

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function stubOfficialFetch(questions = OFFICIAL_QUESTIONS) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const target = new URL(url);
    if (target.pathname === "/api/categories") return jsonResponse(CATEGORIES);
    const page = Number(target.searchParams.get("page") || 1);
    const perPage = Number(target.searchParams.get("per_page") || 200);
    const total = questions.length;
    return jsonResponse({ code: 0, data: {
      items: questions.slice((page - 1) * perPage, page * perPage),
      total, total_pages: Math.max(1, Math.ceil(total / perPage)), page,
    } });
  };
  return () => { globalThis.fetch = original; };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function rmTemp(dir, prefix) {
  const resolved = path.resolve(dir);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(prefix)) {
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

async function writeBundledData(dir) {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ total: 1 })),
    fs.writeFile(path.join(dir, "lecture-video-mappings.json"), JSON.stringify({ questions: {} })),
    fs.writeFile(path.join(dir, "paradiyu-linear-video.json"), JSON.stringify({ questions: {} })),
    fs.writeFile(path.join(dir, "official-orphan-classifications.json"),
      JSON.stringify({ version: 1, categories: [], assignments: {} })),
  ]);
}

async function writeMappingFiles(dir) {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, "lecture-video-mappings.json"), JSON.stringify({ questions: {} })),
    fs.writeFile(path.join(dir, "paradiyu-linear-video.json"), JSON.stringify({ questions: {} })),
  ]);
}

async function writeSolutionsFile(dir, body) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "native-solutions.json"), JSON.stringify(body, null, 2));
}

test("official sync applies reviewed native solutions without touching identity or indexes", async () => {
  const restoreFetch = stubOfficialFetch();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-native-sync-"));
  const baseDir = path.join(temp, "baseline");
  const targetDir = path.join(temp, "target");
  try {
    await writeMappingFiles(baseDir);
    await writeMappingFiles(temp);
    const baseline = await syncOfficialQuestionBank({ targetDir: baseDir });
    assert.deepEqual(baseline.native_solution_stats, emptyNativeSolutionStats());

    const baselineIndex = await readJson(path.join(baseDir, "id_index.json"));
    const baselineCategories = await readJson(path.join(baseDir, "categories.json"));
    const baselineCategoryQuestions = await readJson(path.join(baseDir, "category_questions.json"));
    const baselineSearchIndex = await readJson(path.join(baseDir, "search_index.json"));
    const baselineManifest = await readJson(path.join(baseDir, "manifest.json"));
    const baselineShard = await readJson(path.join(baseDir, "shards/高等数学.json"));
    const baselineShader = await readJson(path.join(baseDir, "shards/线性代数.json"));
    assert.equal(baselineShard.find(question => question.id === 1).answer, "官网答案");
    assert.equal(Object.hasOwn(baselineShard.find(question => question.id === 1), "native_solution"), false);

    const nativeSource = { document: "MinerU 2026", label: "L1", file: "raw/page.md", block_start: 3, block_end: 5 };
    await writeSolutionsFile(temp, { version: 1, solutions: {
      "1": { question_hash: questionSignature({ stem: "主观题干", options: [] }),
        answer: "原生答案", explanation: "原生解析",
        stem: "注入题干", options: [{ label: "X" }], type: "single_choice", category_id: 9999, id: 777,
        native_solution: { html: "<math><mi>x</mi></math>", text: "x", source: nativeSource } },
      "2": { question_hash: questionSignature({ stem: "选择题干", options: choiceOptions }), answer: "b" },
      "3": { question_hash: questionSignature({ stem: "新题干", options: [] }), explanation: "不应出现" },
      "4": { question_hash: questionSignature({ stem: "选择题干4", options: choiceOptions }), answer: "A" },
      "9999": { question_hash: "1".repeat(64), answer: "未知题号" },
    } });

    const result = await syncOfficialQuestionBank({ targetDir, overlayDir: temp });
    assert.deepEqual(result.native_solution_stats, {
      entries: 5, applied: 2, answered: 2, explanations: 1, native_solutions: 1,
      skipped: { missing: 1, hash_mismatch: 1, conflict: 1 },
    });

    const shard = await readJson(path.join(targetDir, "shards/高等数学.json"));
    const updated = shard.find(question => question.id === 1);
    assert.equal(updated.answer, "原生答案");
    assert.equal(updated.explanation, "原生解析");
    assert.deepEqual(updated.native_solution, { html: "<math><mi>x</mi></math>", text: "x", source: nativeSource });
    assert.equal(updated.stem, "主观题干");
    assert.deepEqual(updated.options, []);
    assert.equal(updated.type, "subjective");
    assert.equal(updated.category_id, 223);
    assert.deepEqual(updated.category_ids, [223]);
    const untouched3 = (await readJson(path.join(targetDir, "shards/概率统计.json")))
      .find(question => question.id === 3);
    assert.equal(untouched3.stem, "旧题干");
    assert.equal(untouched3.explanation, "");
    assert.equal(Object.hasOwn(untouched3, "native_solution"), false);
    const conflict4 = shard.find(question => question.id === 4);
    assert.equal(conflict4.answer, "B");
    assert.deepEqual(conflict4.correct_labels, ["B"]);
    assert.equal(Object.hasOwn(conflict4, "native_solution"), false);

    const expected = structuredClone(baselineShard);
    const expectedUpdated = expected.find(question => question.id === 1);
    expectedUpdated.answer = "原生答案";
    expectedUpdated.explanation = "原生解析";
    expectedUpdated.native_solution = { html: "<math><mi>x</mi></math>", text: "x", source: nativeSource };
    assert.deepEqual(shard, expected);

    const choiceShard = await readJson(path.join(targetDir, "shards/线性代数.json"));
    const choice = choiceShard.find(question => question.id === 2);
    assert.equal(choice.answer, "B");
    assert.deepEqual(choice.correct_labels, ["B"]);
    assert.deepEqual(choice.options, choiceOptions);
    assert.deepEqual(choiceShard, baselineShader);
    assert.deepEqual(await readJson(path.join(targetDir, "id_index.json")), baselineIndex);
    assert.deepEqual(await readJson(path.join(targetDir, "categories.json")), baselineCategories);
    assert.deepEqual(await readJson(path.join(targetDir, "category_questions.json")), baselineCategoryQuestions);
    assert.deepEqual(await readJson(path.join(targetDir, "search_index.json")), baselineSearchIndex);
    const manifest = await readJson(path.join(targetDir, "manifest.json"));
    assert.equal(manifest.total, baselineManifest.total);
    assert.deepEqual(manifest.shards, baselineManifest.shards);

    const repeated = await syncOfficialQuestionBank({ targetDir: path.join(temp, "repeat"),
      overlayDir: temp, currentFingerprint: result.fingerprint });
    assert.equal(repeated.unchanged, true);
    const repeatDir = path.join(temp, "repeat-full");
    const full = await syncOfficialQuestionBank({ targetDir: repeatDir, overlayDir: temp });
    assert.deepEqual(full.native_solution_stats, result.native_solution_stats);
    assert.deepEqual(await readJson(path.join(repeatDir, "shards/高等数学.json")), shard);
    assert.deepEqual(await readJson(path.join(repeatDir, "shards/线性代数.json")), choiceShard);
  } finally {
    restoreFetch();
    await rmTemp(temp, "daguan-native-sync-");
  }
});

test("malformed native solution payloads are refused and nothing is written", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-native-invalid-"));
  const dataDir = path.join(temp, "data");
  const overlayDir = path.join(temp, "overlay");
  try {
    await fs.mkdir(path.join(dataDir, "shards"), { recursive: true });
    await fs.writeFile(path.join(dataDir, "manifest.json"),
      JSON.stringify({ shards: { A: { file: "shards/A.json", count: 1 } } }));
    const question = { id: 1, stem: "题干", options: [], answer: "官网答案", explanation: "官网解析",
      type: "subjective", correct_labels: [] };
    await fs.writeFile(path.join(dataDir, "shards/A.json"), JSON.stringify([question]));
    const hash = questionSignature(question);
    const cases = [
      [{ version: 2, solutions: {} }, /不支持的本地方案版本/],
      [{ version: 1, solutions: [] }, /solutions 格式不合法/],
      [{ version: 1, solutions: { "1": { answer: "x" } } }, /question_hash/],
      [{ version: 1, solutions: { "1": { question_hash: "abc", answer: "x" } } }, /question_hash/],
      [{ version: 1, solutions: { "1": { question_hash: hash, note: "仅备注" } } }, /没有任何可应用/],
      [{ version: 1, solutions: { "1": { question_hash: hash, answer: 5 } } }, /answer 不合法/],
      [{ version: 1, solutions: { "1": { question_hash: hash, native_solution: { html: "" } } } }, /native_solution.html/],
      [{ version: 1, solutions: { "1": { question_hash: hash, native_solution: { html: "<p>x</p>", source: { block_start: "3" } } } } },
        /source.block_start/],
      [{ version: 1, solutions: { "0": { question_hash: hash, answer: "x" } } }, /题目 ID 不合法/],
    ];
    for (const [payload, pattern] of cases) {
      await writeSolutionsFile(overlayDir, payload);
      await assert.rejects(applyNativeSolutions(dataDir, overlayDir), pattern);
    }
    assert.deepEqual(await readJson(path.join(dataDir, "shards/A.json")), [question]);
  } finally {
    await rmTemp(temp, "daguan-native-invalid-");
  }
});

test("native solution overlay change forces a resync even when official content is unchanged", async () => {
  const restoreFetch = stubOfficialFetch();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-native-updater-"));
  const bundled = path.join(temp, "bundled");
  const dataDir = path.join(temp, "user-data");
  try {
    await writeBundledData(bundled);
    const updater = await createQuestionBankUpdater({ dataDir, bundledDataDir: bundled, enabled: true });
    try {
      const first = await updater.update();
      assert.equal(first.total, OFFICIAL_QUESTIONS.length);
      assert.equal(updater.status().native_solution_stats.applied, 0);
      assert.equal((await updater.update()).unchanged, true);

      await writeSolutionsFile(bundled, { version: 1, solutions: {
        "1": { question_hash: questionSignature({ stem: "主观题干", options: [] }),
          answer: "原生答案", explanation: "原生解析" },
      } });
      const revised = await updater.update();
      assert.notEqual(revised.id, first.id);
      assert.equal(revised.native_solution_stats.applied, 1);
      assert.equal(updater.status().native_solution_stats.applied, 1);
      const shard = await readJson(path.join(updater.dataRoot(), "shards/高等数学.json"));
      const question = shard.find(item => item.id === 1);
      assert.equal(question.answer, "原生答案");
      assert.equal(question.explanation, "原生解析");
      assert.equal(question.stem, "主观题干");
      assert.equal((await updater.update()).unchanged, true);
      assert.equal(updater.status().activeId, revised.id);
    } finally {
      await updater.stop();
    }
  } finally {
    restoreFetch();
    await rmTemp(temp, "daguan-native-updater-");
  }
});
