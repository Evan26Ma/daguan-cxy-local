#!/usr/bin/env node
// Keep the documented entry point while sourcing the current official catalog.
await import("./sync-official-web-data.mjs");

// 真题题号 + 全文搜索索引（web/data/exam_index.json、search_v2.json）
const { writeFile } = await import("node:fs/promises");
const { join, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const dataDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "web", "data");
const { buildExamIndex } = await import("./build-exam-index.mjs");
await writeFile(join(dataDir, "exam_index.json"), JSON.stringify(await buildExamIndex(dataDir)));
const { buildSearchIndex } = await import("./build-search-index.mjs");
await writeFile(join(dataDir, "search_v2.json"), JSON.stringify(await buildSearchIndex(dataDir)));
console.log("搜索索引已更新：exam_index.json、search_v2.json");
