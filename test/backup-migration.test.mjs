import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const browserGlobal = {};
vm.runInNewContext(await fs.readFile(new URL("../web/backup-migration.js", import.meta.url), "utf8"), browserGlobal);
const Migration = browserGlobal.DaguanBackupMigration;

test("legacy backup migration merges each question and annotation by modification time", () => {
  const source = Migration.parseBackup({
    format: "daguan-local-progress", version: 3,
    progress: {
      "10": { mastery: "mastered", updated_at: "2026-01-03T00:00:00Z" },
      "11": { mastery: "learning", updated_at: "2026-01-01T00:00:00Z" },
      "12": { mastery: "mastered" },
      "13": { mastery: "learning", updated_at: "2026-01-03T00:00:00Z", ai_draft: "must not migrate" },
    },
    favorites: ["10", "11", "12"],
    annotations: {
      "10": { markdown: "newer note", updated_at: "2026-01-03T00:00:00Z" },
      "11": { markdown: "older note", updated_at: "2026-01-01T00:00:00Z" },
    },
    last_study: { category_id: "4", question_id: "10", updated_at: "2026-01-03T00:00:00Z" },
    appearance: { theme: "not imported" }, ai_preferences: { apiKey: "not imported" },
  });
  const target = {
    revision: 7,
    progress: {
      "10": { mastery: "learning", updated_at: "2026-01-02T00:00:00Z" },
      "11": { mastery: "mastered", updated_at: "2026-01-02T00:00:00Z" },
      "12": { mastery: "learning" },
      "13": { mastery: "mastered", updated_at: "2026-01-02T00:00:00Z" },
    },
    favorites: [],
    annotations: {
      "10": { markdown: "old note", updated_at: "2026-01-02T00:00:00Z" },
      "11": { markdown: "newer target note", updated_at: "2026-01-02T00:00:00Z" },
    },
    last_study: { category_id: "3", question_id: "9", updated_at: "2026-01-02T00:00:00Z" },
    ai_history: { preserve: true },
  };
  const merged = Migration.merge(source, target);

  assert.equal(merged.state.progress["10"].mastery, "mastered");
  assert.equal(merged.state.progress["11"].mastery, "mastered");
  assert.equal(merged.state.progress["12"].mastery, "learning", "timestamp ambiguity keeps the target row");
  assert.equal(merged.state.progress["13"].mastery, "learning");
  assert.equal("ai_draft" in merged.state.progress["13"], false);
  assert.deepEqual(Array.from(merged.state.favorites), ["10"]);
  assert.equal(merged.state.annotations["10"].markdown, "newer note");
  assert.equal(merged.state.annotations["11"].markdown, "newer target note");
  assert.equal(merged.state.last_study.question_id, "10");
  assert.deepEqual(merged.state.ai_history, { preserve: true });
  assert.equal(merged.state.revision, 7);
  assert.equal(merged.counts.keptTargetProgress, 2);
});

test("migration accepts old map-only backups and imports absent records without carrying unrelated settings", () => {
  const source = Migration.parseBackup(JSON.stringify({
    format: "daguan-local-progress", version: 3, map: { "1": "m", "2": "f" }, favorites: ["1"],
    appearance: { theme: "old" }, shortcuts: { answer: "x" }, ai_drafts: { "1": "secret" },
  }));
  const merged = Migration.merge(source, { progress: {}, favorites: [], annotations: {}, last_study: null, ai_drafts: { keep: true } });
  assert.equal(merged.state.progress["1"].mastery, "mastered");
  assert.equal(merged.state.progress["2"].error_prone, true);
  assert.deepEqual(Array.from(merged.state.favorites), ["1"]);
  assert.deepEqual(merged.state.ai_drafts, { keep: true });
  assert.equal(merged.counts.importedProgress, 2);
});

test("invalid or content-free backups are rejected before any writes", () => {
  assert.throws(() => Migration.parseBackup("not json"));
  assert.throws(() => Migration.parseBackup({ format: "unknown", appearance: { theme: "x" } }), /没有可迁移/);
});
