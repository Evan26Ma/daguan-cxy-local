import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareDesktopPackage } from "../scripts/prepare-desktop-package.mjs";

test("desktop packaging ASCII-normalizes shard paths without changing shard contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-desktop-package-"));
  try {
    const data = path.join(root, "web", "data");
    const shards = path.join(data, "shards");
    await fs.mkdir(shards, { recursive: true });
    const originals = {
      "线性代数": { file: "shards/线性代数.json", count: 2 },
      "概率统计": { file: "shards/概率统计.json", count: 1 },
    };
    const contents = new Map();
    for (const shard of Object.values(originals)) {
      const bytes = Buffer.from(JSON.stringify({ questions: [shard.count] }));
      contents.set(path.basename(shard.file), bytes);
      await fs.writeFile(path.join(shards, path.basename(shard.file)), bytes);
    }
    const unreferencedBytes = Buffer.from(JSON.stringify({ archived: true }));
    await fs.writeFile(path.join(shards, "旧题库-核心.json"), unreferencedBytes);
    await fs.writeFile(path.join(data, "manifest.json"), JSON.stringify({ shards: originals }));

    await prepareDesktopPackage(root);

    const manifest = JSON.parse(await fs.readFile(path.join(data, "manifest.json"), "utf8"));
    assert.deepEqual(Object.values(manifest.shards).map(({ file }) => file), [
      "shards/shard-01.json",
      "shards/shard-02.json",
    ]);
    for (const [index, originalBytes] of [...contents.values()].entries()) {
      assert.deepEqual(await fs.readFile(path.join(shards, `shard-${String(index + 1).padStart(2, "0")}.json`)), originalBytes);
    }
    assert.deepEqual(await fs.readFile(path.join(data, "shards", "unreferenced-01.json")), unreferencedBytes);
    assert.deepEqual((await fs.readdir(shards)).sort(), ["shard-01.json", "shard-02.json", "unreferenced-01.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
