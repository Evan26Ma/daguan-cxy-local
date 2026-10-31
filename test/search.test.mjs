import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ctx = {};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read("../web/search-core.js"), ctx);
const S = ctx.DaguanSearch;

const searchData = JSON.parse(read("../web/data/search_v2.json"));
const examData = JSON.parse(read("../web/data/exam_index.json"));
const index = S.createIndex(searchData, examData);
const ids = (r) => r.hits.map((h) => Number(h.id));

test("真题题号写法都能解析", () => {
  const cases = {
    "21 数三 7": [2021, "数三", 7],
    "2021数三(7)": [2021, "数三", 7],
    "2021数三（7）": [2021, "数三", 7],
    "2021年数学三第7题": [2021, "数三", 7],
    "数三 2021 第7题": [2021, "数三", 7],
    "数三21-7": [2021, "数三", 7],
    "2021 数三 T7": [2021, "数三", 7],
    "2020数三": [2020, "数三", null],
    "98数一": [1998, "数一", null],
  };
  for (const [q, [year, exam, no]] of Object.entries(cases)) {
    const p = S.parseQuery(q, index).paper;
    assert.ok(p, q);
    assert.equal(p.year, year, q);
    assert.equal(p.exam, exam, q);
    assert.equal(p.no, no, q);
  }
});

test("2020数三 按题号顺序列出整卷", () => {
  const r = S.search(index, "2020数三");
  assert.equal(r.mode, "paper");
  assert.equal(r.total, 23);
  assert.deepEqual(r.hits.map((h) => h.no), Array.from({ length: 23 }, (_, i) => i + 1));
  assert.deepEqual(ids(S.search(index, "2020 数三")), ids(r));
  assert.deepEqual(ids(S.search(index, "数三 2020")), ids(r));
});

test("21 数三 7 直达 2021 数三第 7 题（已核对）", () => {
  const r = S.search(index, "21 数三 7");
  assert.equal(r.direct.no, 7);
  assert.equal(r.direct.id, 252);
  assert.equal(r.direct.c, 1);
  assert.equal(S.search(index, "2021数三(7)").direct.id, 252);
  const miss = S.search(index, "2021数三 30");
  assert.equal(miss.direct.missing, true);
});

test("14 数三 2 直达原卷第 2 题", () => {
  // main 题库已把原卷图片版与文字版并为同一分类，不再有独立的 -new 试卷。
  const r = S.search(index, "14 数三 2");
  assert.equal(r.direct.no, 2);
  assert.equal(r.direct.id, 1644);
});

test("多个关键词不分顺序、按 AND 匹配", () => {
  const a = S.search(index, "特征值 相似");
  const b = S.search(index, "相似 特征值");
  assert.ok(a.total > 50);
  assert.equal(a.total, b.total);
  assert.equal(S.search(index, "二重积分 极坐标").total > 20, true);
});

test("解析也参与搜索", () => {
  assert.ok(S.search(index, "洛必达").total > 100);
});

test("LaTeX 写法归一化", () => {
  assert.equal(S.normalize("\\lim_{x\\to0}\\frac{\\sin x}{x}"), S.normalize("lim x->0 sinx/x"));
  assert.equal(S.normalize("e^{x}"), S.normalize("e^x"));
  assert.equal(S.search(index, "e^x").total, S.search(index, "e^{x}").total);
  assert.ok(S.search(index, "lim x->0 sinx/x").total >= 1);
});

test("拼音别名", () => {
  assert.equal(S.search(index, "jixian").total, S.search(index, "极限").total);
});

test("纯数字不再按题干子串误匹配；#号直达题目", () => {
  const r = S.search(index, "#252");
  assert.equal(r.mode, "id");
  assert.equal(r.idHit, 252);
  assert.ok(S.search(index, "562").total < 5);
});

test("没有整卷的年份回退到题源匹配", () => {
  const r = S.search(index, "1999数一 极限");
  assert.ok(r.paperMissing);
  assert.ok(r.total >= 1);
});

test("用户修正题号后立即生效", () => {
  const local = S.createIndex(searchData, examData);
  S.setExamIndex(local, examData, { "2020数三": { 1: 4392 } });
  const r = S.search(local, "2020数三 1");
  assert.equal(r.direct.id, 4392);
  assert.equal(r.direct.c, 2);
  assert.equal(r.hits.length, 23);
});

test("每套真题题号 1..N 连续且不重复", () => {
  for (const p of examData.papers) {
    const nos = p.items.map((x) => x[0]).sort((a, b) => a - b);
    assert.deepEqual(nos, Array.from({ length: nos.length }, (_, i) => i + 1), p.key);
  }
});
