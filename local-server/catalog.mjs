import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mergeLocalQuestionBanks } from "../shared/local-question-banks.mjs";

const DEFAULT_SOURCE = "https://hsad.xyz/daguan-math";
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

// 镜像站没有可用性承诺，抓取失败属于常态；每次请求单独限时并留少量重试预算，
// 避免一次掉线把整轮刷新判死。
export const CATALOG_FETCH = Object.freeze({ timeoutMs: 10000, attempts: 3, retryDelayMs: 600 });

export function catalogSource() {
  return process.env.DAGUAN_CATALOG_SOURCE || DEFAULT_SOURCE;
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 网络故障、超时、5xx 和限流属于可重试；4xx 是文件名或清单本身有问题，重试没有意义。
function retryable(error) {
  const status = Number(error?.status) || 0;
  return !status || status === 408 || status === 429 || status >= 500;
}

function describeFetchError(error, url, timeoutMs) {
  if (error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError") {
    const budget = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} 秒` : `${timeoutMs} 毫秒`;
    return new Error(`连接官网题库超时（${budget}）：${url}`);
  }
  const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
  return new Error(`连接官网题库失败（${reason}）：${url}`);
}

async function fetchJsonOnce(url, timeoutMs) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw describeFetchError(error, url, timeoutMs);
  }
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}: ${url}`);
    error.status = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`官网题库返回的内容不是有效 JSON：${url}`);
  }
}

export async function fetchJson(url, retry = CATALOG_FETCH) {
  const attempts = Math.max(1, Math.min(10, Number(retry?.attempts) || CATALOG_FETCH.attempts));
  const timeoutMs = Math.max(1, Number(retry?.timeoutMs) || CATALOG_FETCH.timeoutMs);
  const retryDelayMs = Math.max(0, Number(retry?.retryDelayMs ?? CATALOG_FETCH.retryDelayMs));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(retryDelayMs * (attempt - 1));
    try {
      return await fetchJsonOnce(url, timeoutMs);
    } catch (error) {
      if (!retryable(error)) throw error;
      lastError = error;
    }
  }
  // 带上尝试次数：镜像连续 5xx 是镜像的问题，单次 404 是清单文件名的问题，
  // 两者的处理方向完全不同，报错里要能分开看。
  lastError.message = `${lastError.message}（已尝试 ${attempts} 次）`;
  throw lastError;
}

function questionIdsFromShard(value) {
  return Array.isArray(value) ? value.map((item) => String(item?.id ?? item?.question_id ?? "")).filter(Boolean) : [];
}

export async function refreshCatalog(rootDir, progress = () => {}, retry = CATALOG_FETCH) {
  const source = catalogSource();
  const dataDir = path.join(rootDir, "web", "data");
  const stageDir = path.join(dataDir, `.staging-${process.pid}-${randomUUID()}`);
  await fs.mkdir(stageDir, { recursive: true });
  try {
    const manifest = await fetchJson(`${source}/data/manifest.json`, retry);
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
      const value = await fetchJson(`${source}/data/${file}`, retry);
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
