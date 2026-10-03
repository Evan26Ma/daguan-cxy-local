import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import forgeConfig from "../forge.config.js";
import { prepareDesktopPackage } from "../scripts/prepare-desktop-package.mjs";

test('shared sanitizer and extracted modules are bundled and match offline shell references', async () => {
  const web = new URL('../web/', import.meta.url);
  const sw = await fs.readFile(new URL('service-worker.js', web), 'utf8');
  const newer = await fs.readFile(new URL('index.html', web), 'utf8');
  const legacy = await fs.readFile(new URL('legacy.html', web), 'utf8');
  for (const file of ['safe-render.js', 'new-data.js', 'new-state.js', 'new-ai.js', 'vendor/purify.min.js', 'vendor/DOMPurify-LICENSE']) {
    assert.ok((await fs.stat(new URL(file, web))).size > 0);
    assert.ok(!forgeConfig.packagerConfig.ignore.some(pattern => pattern.test('/web/' + file)), file);
    if (file.endsWith('LICENSE')) continue;
    const ref = [...newer.matchAll(/src="([^"]+)"/g)].map(match => match[1]).find(value => value.split('?')[0] === './' + file);
    assert.ok(ref, file);
    assert.ok(sw.includes(JSON.stringify(ref)), ref);
    if (!file.startsWith('new-')) assert.ok(legacy.includes(ref));
  }
  for (const html of [newer, legacy]) {
    for (const [, ref] of html.matchAll(/src="(\.\/app-(?:new|legacy)\.js[^\"]*)"/g)) assert.ok(sw.includes(JSON.stringify(ref)), ref);
  }
  const installed = await fs.readFile(new URL('../node_modules/dompurify/dist/purify.min.js', import.meta.url));
  assert.deepEqual(await fs.readFile(new URL('vendor/purify.min.js', web)), installed);
});

test('learning journal scripts and styles are shipped in the desktop and offline shell', async () => {
  const html = await fs.readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const sw = await fs.readFile(new URL('../web/service-worker.js', import.meta.url), 'utf8');
  for (const file of ['study-journal.js', 'study-journal.css', 'study-activity-client.js']) {
    assert.ok((await fs.stat(new URL('../web/' + file, import.meta.url))).size > 0);
    assert.ok(!forgeConfig.packagerConfig.ignore.some(pattern => pattern.test('/web/' + file)));
    const ref = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).find(s => s.split('?')[0] === './' + file);
    assert.ok(ref, file); assert.ok(sw.includes(JSON.stringify(ref)), ref);
  }
});

test("Windows executable and installer both use the bundled Daguan logo", async () => {
  const icon = new URL("../web/assets/landing/local-mark.ico", import.meta.url);
  assert.equal(forgeConfig.packagerConfig.icon, fileURLToPath(icon));
  assert.equal(forgeConfig.makers[0].config.setupIcon, forgeConfig.packagerConfig.icon);
  const bytes = await fs.readFile(icon);
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0]);
});

test("desktop package excludes local records while retaining the bundled question bank", () => {
  const ignored = (name) => forgeConfig.packagerConfig.ignore.some((pattern) => pattern.test(name));
  assert.equal(ignored("/data/state.json"), true);
  assert.equal(ignored("/data/ai-profiles.json"), true);
  assert.equal(ignored("/design/draft.html"), true);
  assert.equal(ignored("/AGENTS.md"), true);
  assert.equal(ignored("/draft.md"), true);
  assert.equal(ignored("/.zcodeignore"), true);
  assert.equal(ignored("/_shot/preview.png"), true);
  assert.equal(ignored("/work/visualizations/preview.html"), true);
  assert.equal(ignored("/web/data/lecture-video-mappings.json.bak-title-20261001"), true);
  assert.equal(ignored("/README.md"), false);
  assert.equal(ignored("/web/data/manifest.json"), false);
  assert.equal(ignored("/web/data/shards/questions.json"), false);
});

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
