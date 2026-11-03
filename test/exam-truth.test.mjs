// 真题题号真值化回归测试（2026-11-01 修复）。
// 背景：旧 exam_index 用推断法生成题号，实测对手核卷准确率仅 0–27%，
// 「2012数三 23」曾直达 #6796（实际第4题）。现由 tools/build-exam-truth.mjs
// 从 source 标注/alt 锚点/手核真值生成，以下锚点必须永久成立。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const readJson = rel => JSON.parse(fs.readFileSync(new URL(rel, ROOT), 'utf8'));

const exam = readJson('web/data/exam_index.json');
const truth = readJson('tools/exam-number-truth.json');

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('web/search-core.js', ROOT), 'utf8'), sandbox);
const DS = sandbox.DaguanSearch;
const index = DS.createIndex(readJson('web/data/search_v2.json'), exam);

function paper(key) {
  const p = exam.papers.find(x => x.key === key);
  assert.ok(p, `缺少卷 ${key}`);
  return p;
}

test('真题题号：图文拆卷后不再有 46 题混装卷', () => {
  for (const p of exam.papers) {
    if (p.key.endsWith('-img')) continue;
    assert.ok(p.items.length <= 25, `${p.key} 仍有 ${p.items.length} 题（疑似图文混装未拆）`);
  }
});

test('真题题号：手核真值卷与 exam_index 完全一致', () => {
  for (const key of Object.keys(truth)) {
    if (key.startsWith('_')) continue;
    const p = paper(key);
    const ok = truth[key].filter((id, i) => p.items.find(it => it[1] === id)?.[0] === i + 1).length;
    assert.equal(ok, truth[key].length, `${key} 与手核真值不符`);
  }
});

test('真题题号：全卷无重复题号，图片附卷题号来自 alt 锚点', () => {
  for (const p of exam.papers) {
    const nos = p.items.map(it => it[0]);
    assert.equal(new Set(nos).size, nos.length, `${p.key} 存在重复题号`);
    for (const no of nos) assert.ok(Number.isInteger(no) && no >= 1, `${p.key} 非法题号 ${no}`);
  }
});

test('真题搜索锚点：2012数三 23 → #5307（原错误直达 #6796）', () => {
  const r = DS.search(index, '2012数三 23');
  assert.equal(r.mode, 'paper');
  assert.equal(r.paper.key, '2012数三');
  assert.equal(r.paper.items.length, 23);
  assert.equal(r.direct.id, 5307);
  assert.equal(r.direct.c, 1);
});

test('真题搜索锚点：整卷与直达（21 数三 7 / 2020数三 15 / 2013数一 23）', () => {
  assert.equal(DS.search(index, '21 数三 7').direct.id, 252);
  assert.equal(DS.search(index, '2020数三 15').direct.id, 4186);
  assert.equal(DS.search(index, '2013数一 23').direct.id, 5474);
  const p = DS.search(index, '2015数三');
  assert.equal(p.paper.items.length, 23);
});

test('真题搜索：图片版作为附卷（image）返回且题号与文字版一致', () => {
  const r = DS.search(index, '2012数三 23');
  assert.ok(r.image, '2012数三 应带图片附卷');
  assert.equal(r.image.key, '2012数三-img');
  const mainByNo = new Map(r.paper.items.map(it => [it.no, it.id]));
  for (const it of r.image.items) {
    assert.ok(mainByNo.has(it.no), `图片版第 ${it.no} 题在文字版中不存在`);
  }
});

test('真题搜索：source 真值覆盖率（c=1 占比 ≥ 95%）', () => {
  const all = exam.papers.flatMap(p => p.items);
  const c1 = all.filter(x => x[2] >= 1).length;
  assert.ok(c1 / all.length >= 0.95, `真值覆盖率仅 ${(100 * c1 / all.length).toFixed(1)}%`);
});
