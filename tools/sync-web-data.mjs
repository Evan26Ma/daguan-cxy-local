#!/usr/bin/env node
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, "web");
const dataDir = join(webDir, "data");
const vendorDir = join(webDir, "vendor");
const source = "https://hsad.xyz/daguan-math";
const assetSource = "https://cxyonly.fans/api/v1/question-assets";
const skipAssets = process.argv.includes("--skip-assets");
const assetToken = process.env.DAGUAN_ASSET_TOKEN || "";

async function fetchBytes(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url) {
  return JSON.parse((await fetchBytes(url)).toString("utf8"));
}

async function save(url, file, options = {}) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await fetchBytes(url, options));
}

function assetHashes(text) {
  return new Set(
    [...text.matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.png)?/g)].map(
      (match) => match[1]
    )
  );
}

async function downloadAssets(hashes) {
  if (skipAssets) {
    console.log(`跳过题图下载，共 ${hashes.size} 个资源`);
    return;
  }
  const headers = assetToken ? { Authorization: `Bearer ${assetToken}` } : {};
  const queue = [...hashes];
  let completed = 0;
  let failed = 0;
  async function worker() {
    while (queue.length) {
      const hash = queue.shift();
      const target = join(dataDir, "assets", `${hash}.png`);
      if (existsSync(target)) {
        completed += 1;
        continue;
      }
      try {
        await save(`${assetSource}/${hash}`, target, { headers });
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error(`题图下载失败 ${hash}: ${error.message}`);
      }
      if ((completed + failed) % 25 === 0) {
        console.log(`题图 ${completed + failed}/${hashes.size}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed) {
    throw new Error(`有 ${failed} 张题图下载失败；如果官网返回 401，请设置 DAGUAN_ASSET_TOKEN 后重试`);
  }
}

await mkdir(vendorDir, { recursive: true });
await save("https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js", join(vendorDir, "marked.min.js"));
await save("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js", join(vendorDir, "katex.min.js"));
const katexCssPath = join(vendorDir, "katex.min.css");
await save("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css", katexCssPath);
const katexFonts = [
  ...new Set(
    [...(await readFile(katexCssPath, "utf8")).matchAll(/url\((?:["']?)(fonts\/[^)"']+)/g)].map(
      (match) => match[1]
    )
  ),
];
await Promise.all(
  katexFonts.map((font) => save(`https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/${font}`, join(vendorDir, font)))
);

const manifest = await fetchJson(`${source}/data/manifest.json`);
const hashes = new Set();
for (const name of ["categories.json", "category_questions.json", "id_index.json", "search_index.json"]) {
  await save(`${source}/data/${name}`, join(dataDir, name));
}
for (const meta of Object.values(manifest.shards)) {
  const url = `${source}/data/${meta.file}`;
  const target = join(dataDir, meta.file);
  await save(url, target);
  for (const hash of assetHashes((await readFile(target)).toString("utf8"))) hashes.add(hash);
}
delete manifest.asset_base_remote;
manifest.asset_base = "./data/assets/";
manifest.synced_at = new Date().toISOString();
await writeFile(join(dataDir, "manifest.json"), JSON.stringify(manifest, null, 2));
await downloadAssets(hashes);

console.log(`题库同步完成：${manifest.total} 题，${hashes.size} 张题图`);
