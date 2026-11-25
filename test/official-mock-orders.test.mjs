import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyOfficialCategoryOrders,
  syncOfficialQuestionBank,
} from "../local-server/official-question-bank.mjs";
import { createQuestionBankUpdater } from "../local-server/question-bank-updater.mjs";

const data = (name) => JSON.parse(readFileSync(new URL(`../web/data/${name}`, import.meta.url), "utf8"));

test("applyOfficialCategoryOrders 按配置重排模拟卷及父分类，并保留未配置题目与等价映射", () => {
  const categoryQuestions = {
    2528: [2288, 11197, 11215, 99999],
    2525: [3377, 11162, 11189],
    9910009: [2288, 3377, 11162, 11189, 11197, 11215, 99999],
    331: [10, 20, 30],
  };
  const categories = [
    {
      id: 2500,
      name: "模拟卷",
      children: [
        {
          id: 9910009,
          name: "张八",
          children: [
            { id: 2528, name: "27张八卷四", children: [] },
            { id: 2525, name: "27张八卷三", children: [] },
          ],
        },
      ],
    },
    { id: 331, name: "极限", children: [] },
  ];
  const config = {
    version: 1,
    equivalents: { 11184: 11162 },
    orders: {
      2528: [11215, 11197, 2288],
      2525: [3377, 11189, 11184],
    },
  };
  applyOfficialCategoryOrders(categoryQuestions, config, categories);
  assert.deepEqual(categoryQuestions[2528], [11215, 11197, 2288, 99999]);
  assert.deepEqual(categoryQuestions[2525], [3377, 11189, 11162]);
  assert.deepEqual(categoryQuestions[9910009], [3377, 11189, 11162, 11215, 11197, 2288, 99999]);
  assert.deepEqual(categoryQuestions[331], [10, 20, 30]);
});

test("applyOfficialCategoryOrders 拒绝不合法的配置格式", () => {
  assert.throws(() => applyOfficialCategoryOrders({ 1: [1, 2] }, { version: 2, orders: {} }), /配置格式不合法/);
  assert.throws(() => applyOfficialCategoryOrders({ 1: [1, 2] }, { version: 1, orders: [] }), /配置格式不合法/);
});

test("syncOfficialQuestionBank 与 questionBankUpdater 保留 official-mock-orders.json 的模拟卷题序", async (t) => {
  const tempRoot = process.platform === "win32" ? "F:/AI/tmp" : os.tmpdir();
  const temp = await fs.mkdtemp(path.join(tempRoot, "daguan-mock-order-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const bundled = path.join(temp, "bundled");
  const dataDir = path.join(temp, "user-data");
  await fs.mkdir(bundled, { recursive: true });

  const choiceOptions = [
    { id: "opt-a", label: "A", content_md: "甲" },
    { id: "opt-b", label: "B", content_md: "乙" },
  ];
  const categories = [
    { id: 223, name: "高等数学", children: [] },
    { id: 1, name: "线性代数", children: [] },
    { id: 601, name: "概率统计", children: [] },
    { id: 836, name: "历年真题", children: [] },
    {
      id: 2500,
      name: "模拟卷",
      children: [
        {
          id: 9910008,
          name: "数三",
          children: [
            {
              id: 9910009,
              name: "张八",
              children: [{ id: 2528, name: "27张八卷四", children: [] }],
            },
          ],
        },
      ],
    },
  ];
  const questions = [
    {
      id: 2288,
      category_id: 2528,
      category_ids: [2528],
      content_hash: "h1",
      is_core: false,
      document: { question_type: "fill", stem_md: "填空题", answer: { reference_answer_md: "2" } },
    },
    {
      id: 11215,
      category_id: 2528,
      category_ids: [2528],
      content_hash: "h2",
      is_core: false,
      document: {
        question_type: "single_choice",
        stem_md: "选择题",
        options: choiceOptions,
        answer: { option_ids: ["opt-b"] },
      },
    },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = new URL(url);
    if (target.pathname === "/api/categories") {
      return new Response(JSON.stringify(categories), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.pathname === "/api/question-lists/linear-algebra-selected-20261018") {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          id: "linear-algebra-selected-20261018",
          name: "线代严选题",
          revision: 1,
          item_count: 0,
          is_official: true,
          status: "published",
          definition_kind: "explicit",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.pathname.endsWith("/directory")) {
      return new Response(JSON.stringify({
        code: 0,
        data: { total: 0, roots: [{ id: "1", label: "线性代数", category_id: 1, question_count: 0, children: [] }] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.pathname.endsWith("/items")) {
      return new Response(JSON.stringify({ code: 0, data: { items: [], total: 0, page: 1, per_page: 200 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: 0, data: { items: questions, total: 2, total_pages: 1, page: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await Promise.all([
    fs.writeFile(path.join(bundled, "manifest.json"), JSON.stringify({ total: 1 })),
    fs.writeFile(path.join(bundled, "lecture-video-mappings.json"), JSON.stringify({ questions: {} })),
    fs.writeFile(path.join(bundled, "paradiyu-linear-video.json"), JSON.stringify({ questions: {} })),
    fs.writeFile(path.join(bundled, "official-mock-orders.json"), JSON.stringify({ version: 1, orders: { 2528: [11215, 2288] } })),
  ]);

  const syncedDir = path.join(temp, "synced");
  await fs.mkdir(syncedDir, { recursive: true });
  await syncOfficialQuestionBank({ targetDir: syncedDir, overlayDir: bundled });
  const syncedOrder = JSON.parse(await fs.readFile(path.join(syncedDir, "category_questions.json"), "utf8"));
  assert.deepEqual(syncedOrder["2528"], [11215, 2288]);

  const updater = await createQuestionBankUpdater({ dataDir, bundledDataDir: bundled, enabled: true });
  const first = await updater.update();
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(updater.dataRoot(), "category_questions.json"), "utf8"))["2528"],
    [11215, 2288],
  );
  await fs.writeFile(path.join(bundled, "official-mock-orders.json"), JSON.stringify({ version: 1, orders: { 2528: [2288, 11215] } }));
  const second = await updater.update();
  assert.notEqual(second.id, first.id);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(updater.dataRoot(), "category_questions.json"), "utf8"))["2528"],
    [2288, 11215],
  );
  await updater.stop();
});

test("本地 web/data 的 27张八 等模拟卷题序与 official-mock-orders.json 一致", () => {
  const config = data("official-mock-orders.json");
  const categoryQuestions = data("category_questions.json");
  const idIndex = data("id_index.json");
  const simShard = new Map(data("shards/模拟哥专区.json").map((q) => [q.id, q]));
  const highShard = new Map(data("shards/高等数学.json").map((q) => [q.id, q]));
  const getQ = (id) => simShard.get(id) || highShard.get(id);

  assert.equal(categoryQuestions["2526"][0], 11215);
  assert.equal(categoryQuestions["2526"][11], 2288);
  assert.equal(categoryQuestions["2527"][0], 11215);
  assert.equal(categoryQuestions["2527"][11], 2288);
  assert.equal(categoryQuestions["2528"][0], 11215);
  assert.equal(categoryQuestions["2528"][11], 2288);

  const zhang8Ids = [
    2516, 2520, 2523, 2526, 2529, 2532, 2535, 2545,
    2517, 2521, 2524, 2527, 2530, 2533, 2536, 2546,
    2519, 2522, 2525, 2528, 2531, 2534, 2544, 2547,
  ];
  for (const cid of zhang8Ids) {
    const ids = categoryQuestions[String(cid)];
    assert.equal(ids.length, 22, `27张八分类 ${cid} 应为 22 题`);
    for (let i = 0; i < 10; i += 1) {
      const q = getQ(ids[i]) || data(`shards/${idIndex[String(ids[i])]}.json`).find((x) => x.id === ids[i]);
      assert.equal(q?.type, "single_choice", `分类 ${cid} 第 ${i + 1} 题应为选择题`);
    }
    for (let i = 10; i < 22; i += 1) {
      const q = getQ(ids[i]) || data(`shards/${idIndex[String(ids[i])]}.json`).find((x) => x.id === ids[i]);
      assert.equal(q?.type, "subjective", `分类 ${cid} 第 ${i + 1} 题应为填空或解答题`);
    }
    const expected = config.orders[String(cid)].map((id) =>
      id === 11184 && !ids.includes(11184) ? config.equivalents["11184"] : id,
    );
    assert.deepEqual(ids, expected, `分类 ${cid} 应与官网顺序完全一致`);
  }
});
