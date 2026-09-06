#!/usr/bin/env node
import { readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const web = join(root, "web");
const data = join(web, "data");

const required = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "service-worker.js",
  "vendor/marked.min.js",
  "vendor/katex.min.js",
  "vendor/katex.min.css",
  "data/manifest.json",
  "data/categories.json",
  "data/category_questions.json",
  "data/id_index.json",
  "data/search_index.json",
];
for (const file of required) {
  await access(join(web, file));
}
const katexCss = await readFile(join(web, "vendor/katex.min.css"), "utf8");
for (const match of katexCss.matchAll(/url\((?:["']?)(fonts\/[^)"']+)/g)) {
  await access(join(web, "vendor", match[1]));
}

const manifest = JSON.parse(await readFile(join(data, "manifest.json"), "utf8"));
const ids = new Set();
let questionCount = 0;
const missingAssets = new Set();
for (const meta of Object.values(manifest.shards || {})) {
  const questions = JSON.parse(await readFile(join(data, meta.file), "utf8"));
  if (questions.length !== meta.count) {
    throw new Error(`${meta.file}: manifest count ${meta.count}, actual ${questions.length}`);
  }
  for (const question of questions) {
    if (ids.has(String(question.id))) throw new Error(`重复题号: ${question.id}`);
    ids.add(String(question.id));
    questionCount += 1;
    const text = JSON.stringify(question);
    for (const match of text.matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.png)?/g)) {
      const file = join(data, "assets", `${match[1]}.png`);
      if (!existsSync(file)) missingAssets.add(match[1]);
    }
  }
}
if (questionCount !== manifest.total) {
  throw new Error(`题目总量不一致: manifest=${manifest.total}, actual=${questionCount}`);
}
const html = await readFile(join(web, "index.html"), "utf8");
if (/src=["']https?:\/\//i.test(html) || /href=["']https?:\/\//i.test(html)) {
  throw new Error("index.html 仍包含外部脚本或样式");
}
for (const file of ["app.js", "styles.css", "manifest.webmanifest", "service-worker.js"]) {
  const text = await readFile(join(web, file), "utf8");
  if (/https?:\/\//i.test(text)) {
    throw new Error(`${file} 仍包含外部 URL`);
  }
}
console.log(`题库验证通过：${questionCount} 题，${ids.size} 个唯一题号`);
if (missingAssets.size) {
  console.warn(`警告：缺少 ${missingAssets.size} 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐`);
} else {
  console.log("题图验证通过");
}
