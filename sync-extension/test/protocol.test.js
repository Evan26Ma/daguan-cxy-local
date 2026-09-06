"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const protocol = require("../protocol.js");

test("解析本地进度并生成安全写入计划", () => {
  const document = protocol.parseImportDocument({
    format: "daguan-local-progress",
    version: 1,
    states: {
      "1": { mastery: "mastered", favorite: true },
      "2": { mastery: "not_known", favorite: false },
      "3": { mastery: "not_started", favorite: true },
    },
  });
  const plan = protocol.buildImportPlan(document, [
    { id: 1, user_state: { mastery: "not_started", favorited_at: null } },
    { id: 2, user_state: { mastery: "mastered", favorited_at: null } },
    { id: 3, user_state: { mastery: "not_started", favorited_at: null } },
  ]);
  assert.equal(plan.summary.changes, 3);
  assert.equal(plan.summary.favoriteAdds, 2);
  assert.equal(plan.summary.masteryChanges.mastered, 1);
  assert.equal(plan.summary.masteryChanges.not_known, 1);
});

test("官网状态导出不包含身份信息", () => {
  const output = protocol.buildMobileSyncDocument([
    {
      id: 8,
      user_state: {
        mastery: "mastered",
        favorited_at: "2026-01-01T00:00:00Z",
        access_token: "should-not-export",
      },
    },
  ], "https://www.cxyonly.fans");
  const text = JSON.stringify(output);
  assert.equal(output.format, "daguan-browser-sync");
  assert.equal(text.includes("access_token"), false);
  assert.equal(text.includes("should-not-export"), false);
});

test("拒绝非法状态", () => {
  assert.throws(() => protocol.parseImportDocument({ states: { "1": { mastery: "bad" } } }), /mastery 无效/);
});

test("兼容 Android 进度格式并忽略非同步字段", () => {
  const document = protocol.parseImportDocument({
    format: "daguan-android-progress",
    version: 2,
    states: {
      "11": { mastery: "mastered", favorite: true, note: "不上传" },
      "12": { mastery: "not_known", favorite: false, wrongCount: 8 },
    },
  });
  assert.deepEqual(document.items, [
    { questionId: 11, hasMastery: true, mastery: "mastered", hasFavorite: true, favorite: true, updatedAt: null },
    { questionId: 12, hasMastery: true, mastery: "not_known", hasFavorite: true, favorite: false, updatedAt: null },
  ]);
  assert.equal(JSON.stringify(document).includes("不上传"), false);
});
