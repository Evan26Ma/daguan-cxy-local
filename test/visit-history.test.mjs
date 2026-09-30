import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVisitHistory } from "../local-server/visit-history.mjs";

test("历史从可识别的旧进度补入一次，清空后不再补回", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-visit-test-"));
  try {
    const history = createVisitHistory(dir, async () => ({ progress: {
      11: { seen: true, updated_at: "2026-01-02T00:00:00Z" },
      12: { mastery: "not_started", updated_at: "2026-01-03T00:00:00Z" },
      13: { mastery: "learning", updated_at: "2026-01-04T00:00:00Z" },
    } }));
    assert.deepEqual((await history.list()).map(row => row.question_id), ["13", "11"]);
    assert.equal((await history.list())[0].time_kind, "legacy");
    await history.clear();
    assert.deepEqual(await history.list(), []);
    assert.deepEqual(await createVisitHistory(dir, async () => { throw new Error("must not remigrate"); }).list(), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("并发访问按题去重，删除和备份合并保留较新记录", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-visit-test-"));
  try {
    const history = createVisitHistory(dir, async () => ({ progress: {} }));
    await Promise.all(Array.from({ length: 30 }, (_, index) => history.visit({ question_id: String(index % 3 + 1), category_id: 223, chapter_id: 601 })));
    assert.equal((await history.list()).length, 3);
    await history.merge([{ question_id: "1", visited_at: "2020-01-01T00:00:00Z", time_kind: "legacy" }, { question_id: "4", visited_at: "2024-01-01T00:00:00Z", time_kind: "visit" }]);
    assert.equal((await history.list()).find(row => row.question_id === "1").time_kind, "visit");
    assert.equal((await history.list()).length, 4);
    await history.remove("2");
    assert.equal((await history.list()).some(row => row.question_id === "2"), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
