import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mergeLocalQuestionBanks } from "../shared/local-question-banks.mjs";
import { applyOfficialCategoryOrders, readOfficialMockOrders } from "./official-question-bank.mjs";

const SOURCE = "https://hsad.xyz/daguan-math";
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

// Manifest file names come from the network; resolve them against a fixed root
// and reject every spelling Windows would trim or reinterpret as a path escape.
export function catalogTarget(baseDir, value) {
  if (typeof value !== "string" || !value || value.length > 240) throw new Error("官网题库文件名无效");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:*?"<>|\x00-\x1f]/.test(part)
    || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part))) {
    throw new Error(`官网题库文件名无效：${value}`);
  }
  if (path.extname(value).toLowerCase() !== ".json") throw new Error(`官网题库只同步 JSON 文件：${value}`);
  const target = path.resolve(baseDir, ...parts);
  const relative = path.relative(baseDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`官网题库文件名越界：${value}`);
  return target;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function questionIdsFromShard(value) {
  return Array.isArray(value) ? value.map((item) => String(item?.id ?? item?.question_id ?? "")).filter(Boolean) : [];
}

export async function refreshCatalog(rootDir, progress = () => {}) {
  const dataDir = path.join(rootDir, "web", "data");
  const stageDir = path.join(dataDir, `.staging-${process.pid}-${randomUUID()}`);
  await fs.mkdir(stageDir, { recursive: true });
  try {
    const manifest = await fetchJson(`${SOURCE}/data/manifest.json`);
    if (!manifest || !manifest.shards || !Number.isFinite(Number(manifest.total))) throw new Error("官网题库 manifest 无效");
    const required = ["categories.json", "category_questions.json", "id_index.json", "search_index.json"];
    const shardFiles = Object.values(manifest.shards).map((meta) => {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("官网题库 manifest 分片无效");
      catalogTarget(stageDir, meta.file);
      return meta.file;
    });
    const files = [...required, ...shardFiles];
    for (const file of files) catalogTarget(stageDir, file);
    const seen = new Set();
    let completed = 0;
    for (const file of files) {
      const target = catalogTarget(stageDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const value = await fetchJson(`${SOURCE}/data/${file}`);
      if (file.startsWith("shards/")) {
        for (const id of questionIdsFromShard(value)) {
          if (seen.has(id)) throw new Error(`题库题号重复：${id}`);
          seen.add(id);
        }
      }
      await fs.writeFile(target, JSON.stringify(value));
      completed += 1;
      progress({ completed, total: files.length, file });
    }
    if (seen.size !== Number(manifest.total)) throw new Error(`题库数量校验失败：manifest ${manifest.total}，分片 ${seen.size}`);
    manifest.asset_base = "./data/assets/";
    manifest.synced_at = new Date().toISOString();
    await fs.writeFile(path.join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await mergeLocalQuestionBanks(stageDir, dataDir);
    const mockOrders = await readOfficialMockOrders(dataDir);
    if (mockOrders) {
      const [stageCategories, stageCategoryQuestions] = await Promise.all([
        fs.readFile(path.join(stageDir, "categories.json"), "utf8").then(JSON.parse),
        fs.readFile(path.join(stageDir, "category_questions.json"), "utf8").then(JSON.parse),
      ]);
      applyOfficialCategoryOrders(stageCategoryQuestions, mockOrders, stageCategories);
      await fs.writeFile(path.join(stageDir, "category_questions.json"), JSON.stringify(stageCategoryQuestions));
    }
    for (const file of [...files, "manifest.json"]) {
      const from = catalogTarget(stageDir, file);
      const to = catalogTarget(dataDir, file);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
    const mergedManifest = await fs.readFile(path.join(dataDir, "manifest.json"), "utf8").then(JSON.parse);
    return { ok: true, total: mergedManifest.total, files: files.length + 1, version: manifest.version || manifest.synced_at };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}
