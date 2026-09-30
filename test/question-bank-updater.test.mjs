import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQuestionBankUpdater } from "../local-server/question-bank-updater.mjs";

test("desktop question bank updates atomically and keeps the last good version offline", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-bank-test-"));
  const bundled = path.join(temp, "bundled");
  const dataDir = path.join(temp, "user-data");
  const originalFetch = globalThis.fetch;
  const categories = [223, 1, 601, 836, 2500].map(id => ({ id, name: String(id), children: [] }));
  const question = { id: 1, category_id: 223, category_ids: [223], content_hash: "first", is_core: false,
    document: { question_type: "essay", stem_md: "题目", answer: { reference_answer_md: "答案" } } };
  let online = true;
  globalThis.fetch = async url => {
    if (!online) throw new Error("offline");
    const target = new URL(url);
    const value = target.pathname === "/api/categories" ? categories :
      { code: 0, data: { items: [question], total: 1, total_pages: 1, page: 1 } };
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await fs.mkdir(bundled, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(bundled, "manifest.json"), JSON.stringify({ total: 1 })),
      fs.writeFile(path.join(bundled, "lecture-video-mappings.json"), JSON.stringify({ questions: {} })),
      fs.writeFile(path.join(bundled, "paradiyu-linear-video.json"), JSON.stringify({ questions: {} })),
      fs.writeFile(path.join(bundled, "official-orphan-classifications.json"),
        JSON.stringify({ version: 1, categories: [], assignments: {} })),
    ]);
    const updater = await createQuestionBankUpdater({ dataDir, bundledDataDir: bundled, enabled: true });
    assert.equal(updater.status().activeId, "bundled");
    const result = await updater.update();
    assert.equal(result.total, 1);
    assert.equal(updater.status().total, 1);
    const manifest = JSON.parse(await fs.readFile(path.join(updater.dataRoot(), "manifest.json"), "utf8"));
    assert.equal(manifest.total, 1);
    assert.equal((await updater.update()).unchanged, true);
    await fs.writeFile(path.join(bundled, "official-orphan-classifications.json"),
      JSON.stringify({ version: 1, categories: [], assignments: {}, description: "revised" }));
    const revised = await updater.update();
    assert.equal(revised.total, 1);
    assert.notEqual(revised.id, result.id);
    online = false;
    await assert.rejects(updater.update());
    assert.equal(updater.status().activeId, revised.id);
    await updater.stop();
    const reopened = await createQuestionBankUpdater({ dataDir, bundledDataDir: bundled, enabled: false });
    assert.equal(reopened.status().activeId, revised.id);
  } finally {
    globalThis.fetch = originalFetch;
    const resolved = path.resolve(temp);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("daguan-bank-test-")) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
});
