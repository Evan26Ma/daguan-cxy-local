import test from "node:test";
import assert from "node:assert/strict";

function toLocalMastery(value) {
  if (value === "mastered") return "mastered";
  if (value === "not_known") return "forgot";
  if (value === "needs_practice") return "learning";
  return "not_started";
}

test("官网掌握状态映射到本地状态", () => {
  assert.equal(toLocalMastery("mastered"), "mastered");
  assert.equal(toLocalMastery("needs_practice"), "learning");
  assert.equal(toLocalMastery("not_known"), "forgot");
  assert.equal(toLocalMastery("not_started"), "not_started");
});

test("安全合并不会用官网未开始清除本地标记", () => {
  const local = { mastery: "mastered", favorite: true };
  const remote = { mastery: "not_started", favorite: false };
  const merged = {
    mastery: remote.mastery === "not_started" ? local.mastery : toLocalMastery(remote.mastery),
    favorite: remote.favorite ? true : local.favorite,
  };
  assert.deepEqual(merged, local);
});

test("本地状态能转换为官网安全同步状态", () => {
  const local = {
    "1": { mastery: "mastered", updated_at: 1720000000000 },
    "2": { mastery: "forgot", updated_at: 1720000001000 },
    "3": { mastery: "learning", updated_at: 1720000002000 },
  };
  const mapped = Object.fromEntries(
    Object.entries(local).map(([id, state]) => [id, {
      mastery: state.mastery === "mastered" ? "mastered" : state.mastery === "forgot" ? "not_known" : "needs_practice",
      favorite: false,
    }])
  );
  assert.deepEqual(mapped["1"], { mastery: "mastered", favorite: false });
  assert.deepEqual(mapped["2"], { mastery: "not_known", favorite: false });
  assert.deepEqual(mapped["3"], { mastery: "needs_practice", favorite: false });
});

test("Android 状态包只提取掌握度和收藏", () => {
  const input = {
    format: "daguan-android-progress",
    version: 2,
    states: {
      "11": { mastery: "mastered", favorite: true, note: "不上传" },
      "12": { mastery: "not_known", favorite: false, wrongCount: 8 },
    },
  };
  const output = Object.fromEntries(
    Object.entries(input.states).map(([id, state]) => [id, {
      mastery: state.mastery,
      favorite: state.favorite === true,
    }])
  );
  assert.deepEqual(output, {
    "11": { mastery: "mastered", favorite: true },
    "12": { mastery: "not_known", favorite: false },
  });
});
