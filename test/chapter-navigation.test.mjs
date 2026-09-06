import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const categories = JSON.parse(fs.readFileSync(new URL("../web/data/categories.json", import.meta.url), "utf8"));
const categoryQuestions = JSON.parse(fs.readFileSync(new URL("../web/data/category_questions.json", import.meta.url), "utf8"));

function children(node) {
  return Array.isArray(node?.children) ? node.children : [];
}

function flattenLeaves(nodes, output = []) {
  for (const node of nodes) {
    if (children(node).length) flattenLeaves(children(node), output);
    else output.push(node);
  }
  return output;
}

function find(id, nodes = categories) {
  for (const node of nodes) {
    if (String(node.id) === String(id)) return node;
    const hit = find(id, children(node));
    if (hit) return hit;
  }
  return null;
}

test("章节索引把极限按叶子展开并保留深层顺序", () => {
  const limit = find(321);
  const leaves = flattenLeaves([limit]);
  assert.equal(leaves[0].id, 331);
  assert.deepEqual(leaves.slice(0, 6).map((node) => node.id), [331, 344, 345, 347, 346, 348]);
  assert.ok(leaves.some((node) => children(node).length === 0));
});

test("父级题目映射不会被当作可加载叶子，求函数表达式只有11题", () => {
  assert.ok(children(find(321)).length > 0);
  assert.equal((categoryQuestions["321"] || []).length, 897);
  assert.equal((categoryQuestions["331"] || []).length, 11);
});

test("相邻小节在同一练习根内遍历，末级顺序可到达单调", () => {
  const leaves = flattenLeaves([find(321)]);
  const ids = leaves.map((node) => String(node.id));
  assert.equal(ids.indexOf("344"), ids.indexOf("331") + 1);
  assert.equal(ids.indexOf("348"), ids.indexOf("346") + 1);
});
