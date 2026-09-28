import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mergeLocalQuestionBanks } from "../shared/local-question-banks.mjs";

const base = "https://www.cxyonly.fans";
const pageSize = 200;
const shardByRoot = new Map([
  [223, "高等数学"], [1, "线性代数"], [601, "概率统计"],
  [836, "历年真题"], [2500, "模拟哥专区"],
]);
const fileByShard = new Map([
  ...[...shardByRoot.values()].map(name => [name, `shards/${name}.json`]),
  ["未分类", "shards/未分类.json"],
]);

async function getJson(url, signal) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      if (signal?.aborted || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

async function fetchOfficial(signal) {
  const first = await getJson(`${base}/api/questions?page=1&per_page=${pageSize}`, signal);
  if (first.code !== 0 || !Array.isArray(first.data?.items)) throw new Error("官网题目接口格式不符");
  const { total, total_pages: pages } = first.data;
  const chunks = Array.from({ length: pages }, () => null);
  chunks[0] = first.data.items;
  let nextPage = 2;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (nextPage <= pages) {
      const page = nextPage++;
      const result = await getJson(`${base}/api/questions?page=${page}&per_page=${pageSize}`, signal);
      if (result.code !== 0 || result.data?.total !== total || result.data?.page !== page ||
          !Array.isArray(result.data.items)) throw new Error(`官网题目分页 ${page} 在同步时变化`);
      chunks[page - 1] = result.data.items;
    }
  }));
  const questions = chunks.flat();
  const categories = await getJson(`${base}/api/categories`, signal);
  const check = await getJson(`${base}/api/questions?page=1&per_page=${pageSize}`, signal);
  if (!Array.isArray(categories) || questions.length !== total ||
      new Set(questions.map(question => String(question.id))).size !== total ||
      check.data?.total !== total ||
      JSON.stringify(check.data?.items?.map(item => [item.id, item.content_hash])) !==
        JSON.stringify(first.data.items.map(item => [item.id, item.content_hash]))) {
    throw new Error("官网题库在同步期间变化；未写入本地题库，请重试");
  }
  return { questions, categories, total };
}

function categoryIndex(categories) {
  const byId = new Map();
  function visit(category, parent = null, rootId = category.id, prefix = "") {
    const name = String(category.name || "");
    const id = Number(category.id);
    if (!Number.isInteger(id) || byId.has(id)) throw new Error(`官网分类 ID 不合法或重复：${category.id}`);
    byId.set(id, { source: category, parent, rootId, path: prefix ? `${prefix} / ${name}` : name });
    for (const child of category.children || []) visit(child, id, rootId, byId.get(id).path);
  }
  for (const rootCategory of categories) visit(rootCategory);
  for (const rootId of shardByRoot.keys()) {
    if (!byId.has(rootId) || byId.get(rootId).parent !== null) throw new Error(`官网缺少预期根分类 ${rootId}`);
  }
  return byId;
}

function normalizeQuestion(source, categories) {
  const document = source.document || {};
  const officialType = document.question_type || source.question_type;
  if (!["fill", "essay", "subjective", "single_choice", "multiple_choice"].includes(officialType)) {
    throw new Error(`题目 ${source.id} 的类型未知：${officialType}`);
  }
  const type = ["single_choice", "multiple_choice"].includes(officialType) ? officialType : "subjective";
  const options = Array.isArray(document.options) ? document.options : (source.options || []);
  const correctIds = document.answer?.option_ids || source.answer?.option_ids || [];
  const correctLabels = options.filter(option => correctIds.includes(option.id)).map(option => option.label);
  if (type !== "subjective" && (!correctLabels.length || correctLabels.length !== correctIds.length)) {
    throw new Error(`选择题 ${source.id} 的正确选项与选项列表不匹配`);
  }
  const categoryIds = [...new Set((source.category_ids || []).map(Number))];
  for (const id of categoryIds) if (!categories.has(id)) throw new Error(`题目 ${source.id} 指向不存在的分类 ${id}`);
  if (source.category_id != null && !categories.has(Number(source.category_id))) {
    throw new Error(`题目 ${source.id} 的主分类不存在：${source.category_id}`);
  }
  const answer = type === "subjective"
    ? String(document.answer?.reference_answer_md ?? source.answer?.reference_answer_md ?? source.correct_answer ?? "")
    : (correctLabels.length ? correctLabels.join("") : String(source.correct_answer || ""));
  const question = {
    id: Number(source.id),
    stem: String(document.stem_md ?? source.stem ?? ""),
    options,
    answer,
    explanation: String(document.explanation_md ?? source.answer_explanation ?? ""),
    source: String(document.source ?? source.source ?? ""),
    type,
    is_core: source.is_core === true,
    category_id: source.category_id == null ? null : Number(source.category_id),
    category_ids: categoryIds,
    category_path: categoryIds.map(id => categories.get(id).path).join("、"),
    serial: Number.isFinite(Number(document.serial_number ?? source.serial_number))
      ? Number(document.serial_number ?? source.serial_number) : null,
    correct_labels: correctLabels,
  };
  if (!Number.isInteger(question.id) || question.id <= 0 || !question.stem || !question.answer) {
    throw new Error(`官网题目 ${source.id} 必要字段缺失`);
  }
  return JSON.parse(JSON.stringify(question).replaceAll("asset://sha256/", "assets/"));
}

async function writeJson(file, value, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function buildCatalog(snapshot) {
  const categories = categoryIndex(snapshot.categories);
  const shards = Object.fromEntries([...fileByShard.keys()].map(name => [name, []]));
  const categoryQuestions = new Map();
  const idIndex = {};
  const searchIndex = [];
  const types = {};
  const hashes = new Set();
  for (const source of snapshot.questions) {
    const question = normalizeQuestion(source, categories);
    const primary = categories.get(question.category_id) || categories.get(question.category_ids[0]);
    const shard = primary ? shardByRoot.get(primary.rootId) : "未分类";
    if (!shard) throw new Error(`题目 ${question.id} 找不到分片`);
    shards[shard].push(question);
    idIndex[question.id] = shard;
    searchIndex.push({ id: question.id, source: question.source, type: question.type,
      path: question.category_path, serial: question.serial, stem: question.stem });
    types[question.type] = (types[question.type] || 0) + 1;
    const assigned = new Set();
    for (const categoryId of question.category_ids) {
      let current = categoryId;
      while (current != null && !assigned.has(current)) {
        assigned.add(current);
        current = categories.get(current).parent;
      }
    }
    if (!assigned.size) assigned.add("orphan");
    for (const id of assigned) {
      if (!categoryQuestions.has(String(id))) categoryQuestions.set(String(id), []);
      categoryQuestions.get(String(id)).push(question.id);
    }
    for (const match of JSON.stringify(question).matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.png)?/g)) {
      hashes.add(match[1].toLowerCase());
    }
  }
  function normalizeCategory(source, parent = null) {
    const id = Number(source.id);
    return { id, name: String(source.name), parent_id: parent,
      question_count: categoryQuestions.get(String(id))?.length || 0,
      direct_count: snapshot.questions.filter(question => (question.category_ids || []).includes(id)).length,
      children: (source.children || []).map(child => normalizeCategory(child, id)) };
  }
  const catalog = snapshot.categories.map(category => normalizeCategory(category));
  catalog.push({ id: "orphan", name: "未分类", parent_id: null,
    question_count: categoryQuestions.get("orphan")?.length || 0,
    direct_count: categoryQuestions.get("orphan")?.length || 0, children: [] });
  const manifest = { version: 1, total: snapshot.total, types,
    shards: Object.fromEntries([...fileByShard].map(([name, file]) => [name, { file, count: shards[name].length }])),
    asset_count: hashes.size, asset_base: "./data/assets/", synced_at: new Date().toISOString(),
    source: `${base}/math`, source_total: snapshot.total };
  return { shards, categories: catalog, categoryQuestions: Object.fromEntries(categoryQuestions),
    idIndex, searchIndex, manifest, hashes };
}

async function downloadAssets(hashes, dataDir, fallbackAssetsDir, signal) {
  const needed = [];
  for (const hash of hashes) {
    try { await fs.access(path.join(dataDir, "assets", `${hash}.png`)); }
    catch {
      if (fallbackAssetsDir) {
        try { await fs.access(path.join(fallbackAssetsDir, `${hash}.png`)); continue; } catch {}
      }
      needed.push(hash);
    }
  }
  if (!needed.length) return 0;
  const token = process.env.DAGUAN_ASSET_TOKEN;
  if (!token) return needed.length;
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < needed.length) {
      const hash = needed[next++];
      try {
        const response = await fetch(`${base}/api/v1/question-assets/${hash}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        });
        if (!response.ok) continue;
        await fs.mkdir(path.join(dataDir, "assets"), { recursive: true });
        await fs.writeFile(path.join(dataDir, "assets", `${hash}.png`), Buffer.from(await response.arrayBuffer()));
      } catch {}
    }
  }));
  let remaining = 0;
  for (const hash of needed) {
    try { await fs.access(path.join(dataDir, "assets", `${hash}.png`)); }
    catch { remaining += 1; }
  }
  return remaining;
}

async function reconcileVideoMappings(stage, dataDir) {
  const ids = new Set(Object.keys(JSON.parse(await fs.readFile(path.join(stage, "id_index.json"), "utf8"))));
  const archiveFile = path.join(dataDir, "retired-video-mappings.json");
  const archive = await fs.readFile(archiveFile, "utf8").then(JSON.parse, () => ({ lecture: {}, paradiyu: {} }));
  for (const [name, file] of [["lecture", "lecture-video-mappings.json"], ["paradiyu", "paradiyu-linear-video.json"]]) {
    const mapping = JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8"));
    const combined = { ...(archive[name] || {}), ...mapping.questions };
    const current = {};
    const retired = {};
    for (const [id, entry] of Object.entries(combined)) {
      (ids.has(id) ? current : retired)[id] = entry;
    }
    mapping.questions = current;
    if (name === "paradiyu") mapping.questionIds = Object.keys(current);
    archive[name] = retired;
    await writeJson(path.join(stage, file), mapping, true);
  }
  await writeJson(path.join(stage, "retired-video-mappings.json"), archive, true);
}

export async function syncOfficialQuestionBank({ targetDir, overlayDir = targetDir, fallbackAssetsDir = null, signal, currentFingerprint = null }) {
  const snapshot = await fetchOfficial(signal);
  const result = buildCatalog(snapshot);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    questions: snapshot.questions.map(question => [question.id, question.content_hash, question.is_core, question.category_ids, question.category_id]),
    categories: snapshot.categories,
  })).digest("hex");
  if (fingerprint === currentFingerprint) return { unchanged: true, fingerprint, sourceTotal: snapshot.total };
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-official-sync-"));
  try {
    for (const [name, file] of fileByShard) await writeJson(path.join(stage, file), result.shards[name]);
    await Promise.all([
      writeJson(path.join(stage, "categories.json"), result.categories),
      writeJson(path.join(stage, "category_questions.json"), result.categoryQuestions),
      writeJson(path.join(stage, "id_index.json"), result.idIndex),
      writeJson(path.join(stage, "search_index.json"), result.searchIndex),
      writeJson(path.join(stage, "manifest.json"), result.manifest, true),
    ]);
    const overlay = await mergeLocalQuestionBanks(stage, overlayDir);
    const merged = JSON.parse(await fs.readFile(path.join(stage, "manifest.json"), "utf8"));
    if (merged.total !== snapshot.total + overlay.added) throw new Error(`本地题库合并异常：${merged.total}`);
    await reconcileVideoMappings(stage, overlayDir);
    if (signal?.aborted) throw signal.reason;
    await fs.mkdir(targetDir, { recursive: true });
    for (const file of [...fileByShard.values(), "categories.json", "category_questions.json", "id_index.json", "search_index.json", "manifest.json",
      "lecture-video-mappings.json", "paradiyu-linear-video.json", "retired-video-mappings.json"]) {
      const target = path.join(targetDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(stage, file), target);
    }
    const missingAssets = await downloadAssets(result.hashes, targetDir, fallbackAssetsDir, signal);
    return { fingerprint, sourceTotal: snapshot.total, total: merged.total, missingAssets };
  } finally {
    const resolvedStage = path.resolve(stage);
    if (!resolvedStage.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(resolvedStage).startsWith("daguan-official-sync-")) {
      throw new Error("同步临时目录位置异常，已保留以供检查");
    }
    await fs.rm(resolvedStage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
