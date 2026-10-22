import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mergeLocalQuestionBanks } from "../shared/local-question-banks.mjs";
import { applyNativeSolutions } from "../shared/native-solutions.mjs";

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
const localClassificationsFile = "official-orphan-classifications.json";
// 官网分类接口自 2026-10 起只返回三个学科根；历年真题、模拟卷和部分新题型
// 仍出现在题目的 category_name 里。同步时按题目自带的完整路径补回这些节点。
const requiredRoots = new Map([[836, "历年真题"], [2500, "模拟卷"]]);
const syntheticCategoryIdStart = 9910000;
// 官网题单是独立于分类树的显式题序；用固定高位 ID 生成一套只读目录。
const officialCollections = [
  { id: "linear-algebra-selected-20261018", parentRootId: 1, categoryIdBase: 7000000 },
];

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
  // 官网允许保留“答案待补充”的题（例如题干待勘误）；本地题库无法判题，跳过并记录。
  const skippedPending = questions.filter(question => question.document?.answer?.pending === true);
  const usable = questions.filter(question => question.document?.answer?.pending !== true);
  return { questions: usable, categories, total: usable.length, officialTotal: total,
    skippedPending: skippedPending.length };
}

function categoryIndex(categories) {
  const byId = indexCategories(categories);
  for (const rootId of shardByRoot.keys()) {
    if (!byId.has(rootId) || byId.get(rootId).parent !== null) throw new Error(`官网缺少预期根分类 ${rootId}`);
  }
  return byId;
}

function indexCategories(categories) {
  const byId = new Map();
  function visit(category, parent = null, rootId = category.id, prefix = "") {
    const name = String(category.name || "");
    const id = Number(category.id);
    if (!Number.isInteger(id) || byId.has(id)) throw new Error(`官网分类 ID 不合法或重复：${category.id}`);
    byId.set(id, { source: category, parent, rootId, path: prefix ? `${prefix} / ${name}` : name });
    for (const child of category.children || []) visit(child, id, rootId, byId.get(id).path);
  }
  for (const rootCategory of categories) visit(rootCategory);
  return byId;
}

function allocateCategoryId(index) {
  let id = syntheticCategoryIdStart;
  while (index.has(id)) id += 1;
  return id;
}

function registerCategory(index, category, parentId) {
  const id = Number(category.id);
  const parent = parentId == null ? null : index.get(parentId);
  if (parentId != null && !parent) throw new Error(`分类 ${category.id} 的父节点 ${parentId} 不存在`);
  index.set(id, { source: category, parent: parentId, rootId: parent ? parent.rootId : id,
    path: parent ? `${parent.path} / ${String(category.name)}` : String(category.name) });
}

function ensureCategoryPath(categories, index, pathValue, leafId, rootNames) {
  const segments = String(pathValue || "").split(" / ").filter(Boolean);
  if (!segments.length) throw new Error(`题目分类 ${leafId} 缺少可重建的完整路径`);
  let node = categories.find(category => String(category.name) === segments[0]);
  if (!node) {
    const rootId = rootNames.get(segments[0]);
    if (!rootId) throw new Error(`题目分类 ${leafId} 的根分类未知：${segments[0]}`);
    if (index.has(rootId)) return index.get(rootId).source;
    node = { id: rootId, name: segments[0], children: [] };
    categories.push(node);
    registerCategory(index, node, null);
  }
  let current = node;
  for (let position = 1; position < segments.length; position += 1) {
    const last = position === segments.length - 1;
    let child = last ? index.get(leafId)?.source : (current.children || []).find(item => String(item.name) === segments[position]);
    if (last && child) return child;
    if (!child) {
      const id = last ? leafId : allocateCategoryId(index);
      if (index.has(id)) return index.get(id).source;
      child = { id, name: segments[position], children: [] };
      current.children ||= [];
      current.children.push(child);
      registerCategory(index, child, current.id);
    }
    current = child;
  }
  return current;
}

export function completeOfficialCategories(snapshot, previousCategories = []) {
  const categories = structuredClone(snapshot.categories);
  const index = indexCategories(categories);
  const rootNames = new Map([...requiredRoots].map(([id, name]) => [name, id]));
  for (const [rootId, defaultName] of requiredRoots) {
    if (index.has(rootId)) continue;
    const previous = findCategory(previousCategories, rootId);
    const node = { id: rootId, name: String(previous?.name || defaultName), children: [] };
    categories.push(node);
    registerCategory(index, node, null);
    rootNames.set(node.name, rootId);
  }
  const referenced = new Map();
  for (const question of snapshot.questions) {
    const ids = new Set();
    if (question.category_id != null) ids.add(Number(question.category_id));
    for (const id of question.category_ids || []) ids.add(Number(id));
    for (const id of ids) {
      const entry = referenced.get(id) || { paths: new Map(), count: 0 };
      entry.count += 1;
      if (Number(question.category_id) === id) {
        const value = String(question.category_full_path || question.category_name || "").trim();
        if (value) entry.paths.set(value, (entry.paths.get(value) || 0) + 1);
      }
      referenced.set(id, entry);
    }
  }
  const droppedCategoryIds = [];
  for (const [id, entry] of referenced) {
    if (index.has(id)) continue;
    if (!entry.paths.size) { droppedCategoryIds.push(id); continue; }
    const path = [...entry.paths].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
    ensureCategoryPath(categories, index, path, id, rootNames);
  }
  const questions = snapshot.questions.map(question => {
    const categoryId = question.category_id == null ? null : Number(question.category_id);
    if (categoryId != null && !index.has(categoryId)) {
      throw new Error(`题目 ${question.id} 的主分类无法从官网路径重建：${categoryId}`);
    }
    const categoryIds = [...new Set((question.category_ids || []).map(Number))].filter(id => index.has(id));
    if (categoryId != null && !categoryIds.includes(categoryId)) categoryIds.unshift(categoryId);
    return { ...question, category_id: categoryId, category_ids: categoryIds };
  });
  return { ...snapshot, questions, categories, droppedCategoryIds };
}

function findCategory(categories, id) {
  for (const category of categories || []) {
    if (Number(category.id) === Number(id)) return category;
    const found = findCategory(category.children, id);
    if (found) return found;
  }
  return null;
}

export function applyLocalClassifications(snapshot, config) {
  if (!config) return snapshot;
  if (config.version !== 1 || !config.assignments || typeof config.assignments !== "object" ||
      !Array.isArray(config.categories)) throw new Error("本地分类映射格式不合法");
  const appliedIds = new Set();
  const questions = snapshot.questions.map(question => {
    const assignment = config.assignments[String(question.id)];
    if (question.category_id != null || (question.category_ids || []).length) {
      if (question.category_id != null && !(question.category_ids || []).length) {
        return { ...question, category_ids: [question.category_id] };
      }
      return question;
    }
    if (!assignment) return question;
    if (!Array.isArray(assignment.category_ids) || !assignment.category_ids.length ||
        assignment.category_ids.some(id => !Number.isInteger(id))) {
      throw new Error(`题目 ${question.id} 的本地分类无效`);
    }
    const ids = [...new Set(assignment.category_ids)];
    ids.forEach(id => appliedIds.add(id));
    return { ...question, category_id: ids[0], category_ids: ids };
  });
  const categories = structuredClone(snapshot.categories);
  const existing = categoryIndex(categories);
  for (const added of config.categories) {
    if (!appliedIds.has(added.id)) continue;
    if (!Number.isInteger(added.id) || !Number.isInteger(added.parent_id) ||
        !added.name || existing.has(added.id)) throw new Error(`本地分类 ID 不合法或已被官网占用：${added.id}`);
    const parent = existing.get(added.parent_id)?.source;
    if (!parent) throw new Error(`本地分类缺少父节点：${added.parent_id}`);
    parent.children ||= [];
    const category = { id: added.id, name: added.name, children: [] };
    parent.children.push(category);
    existing.set(added.id, { source: category, parent: added.parent_id });
  }
  const validIds = categoryIndex(categories);
  for (const question of questions) {
    for (const id of question.category_ids || []) {
      if (!validIds.has(Number(id))) throw new Error(`题目 ${question.id} 的本地分类不存在：${id}`);
    }
  }
  return { ...snapshot, questions, categories };
}

async function fetchCollection(definition, signal) {
  const id = encodeURIComponent(definition.id);
  const metadata = await getJson(`${base}/api/question-lists/${id}`, signal);
  if (metadata.code !== 0 || !metadata.data || metadata.data.id !== definition.id ||
      metadata.data.is_official !== true || metadata.data.status !== "published" ||
      metadata.data.definition_kind !== "explicit") {
    throw new Error(`官网题单 ${definition.id} 不可用或格式不符`);
  }
  const directory = await getJson(`${base}/api/question-lists/${id}/directory`, signal);
  if (directory.code !== 0 || !Array.isArray(directory.data?.roots)) {
    throw new Error(`官网题单 ${definition.id} 的目录格式不符`);
  }
  const items = [];
  let page = 1;
  let total = null;
  while (page <= 1000) {
    const result = await getJson(`${base}/api/question-lists/${id}/items?page=${page}&per_page=${pageSize}`, signal);
    if (result.code !== 0 || !Array.isArray(result.data?.items) ||
        !Number.isInteger(result.data?.total)) {
      throw new Error(`官网题单 ${definition.id} 的第 ${page} 页格式不符`);
    }
    total ??= result.data.total;
    if (result.data.total !== total) throw new Error(`官网题单 ${definition.id} 在同步期间变化`);
    items.push(...result.data.items);
    if (items.length >= total) break;
    if (!result.data.items.length) throw new Error(`官网题单 ${definition.id} 分页提前结束`);
    page += 1;
  }
  if (items.length !== total || metadata.data.item_count !== total || directory.data.total !== total) {
    throw new Error(`官网题单 ${definition.id} 数量不一致：${items.length}/${total}`);
  }
  const ids = items.map(item => String(item.question_id));
  if (new Set(ids).size !== ids.length) throw new Error(`官网题单 ${definition.id} 含重复题目`);
  return { definition, metadata: metadata.data, directory: directory.data, items };
}

async function fetchOfficialCollections(signal) {
  return Promise.all(officialCollections.map(definition => fetchCollection(definition, signal)));
}

function collectionQuestionMap(result) {
  const byId = new Map();
  for (const questions of Object.values(result.shards)) {
    for (const question of questions) byId.set(String(question.id), question);
  }
  return byId;
}

export function addCollectionCategories(result, collections) {
  const questionById = collectionQuestionMap(result);
  const manifestCollections = [];
  for (const collection of collections) {
    const { definition, metadata, directory, items } = collection;
    const parent = findCategory(result.categories, definition.parentRootId);
    if (!parent) throw new Error(`题单 ${metadata.id} 的父分类 ${definition.parentRootId} 不存在`);
    const collectionId = Number(definition.categoryIdBase);
    if (!Number.isInteger(collectionId) || findCategory(result.categories, collectionId)) {
      throw new Error(`题单 ${metadata.id} 的本地分类 ID 已被占用：${collectionId}`);
    }
    const rootDirectory = directory.roots[0];
    if (!rootDirectory) throw new Error(`题单 ${metadata.id} 目录为空`);
    const directoryById = new Map();
    const localByDirectory = new Map();
    function registerDirectory(node, depth, local) {
      directoryById.set(Number(node.category_id), { node, depth, local });
      for (const child of node.children || []) {
        const childId = Number(definition.categoryIdBase) + Number(child.category_id);
        if (!Number.isInteger(childId) || findCategory(result.categories, childId)) {
          throw new Error(`题单 ${metadata.id} 的分类 ID 已被占用：${childId}`);
        }
        const localChild = { id: childId, name: String(child.label), parent_id: local.id,
          question_count: 0, direct_count: 0, children: [] };
        local.children.push(localChild);
        registerDirectory(child, depth + 1, localChild);
      }
    }
    const localRoot = { id: collectionId, name: String(metadata.name), parent_id: Number(parent.id),
      question_count: 0, direct_count: 0, children: [] };
    registerDirectory(rootDirectory, 0, localRoot);
    const localNodeById = new Map([[collectionId, localRoot]]);
    for (const { local } of directoryById.values()) localNodeById.set(local.id, local);
    const position = new Map(items.map((item, index) => [String(item.question_id), index]));
    const direct = new Map([...localNodeById.keys()].map(id => [id, new Set()]));
    const ordered = items.map(item => String(item.question_id)).sort((left, right) => position.get(left) - position.get(right));
    let unmatched = 0;
    for (const item of items) {
      const question = questionById.get(String(item.question_id));
      if (!question) throw new Error(`题单 ${metadata.id} 引用了题库中不存在的题目 ${item.question_id}`);
      const candidates = [];
      for (const categoryId of question.category_ids || []) {
        const entry = directoryById.get(Number(categoryId));
        if (entry) candidates.push(entry);
      }
      candidates.sort((left, right) => right.depth - left.depth);
      const local = candidates.length ? candidates[0].local : localRoot;
      if (!candidates.length) unmatched += 1;
      direct.get(local.id).add(String(item.question_id));
    }
    function collect(local) {
      const ids = new Set(direct.get(local.id));
      for (const child of local.children) for (const id of collect(child)) ids.add(id);
      const orderedIds = [...ids].sort((left, right) => position.get(left) - position.get(right));
      result.categoryQuestions[String(local.id)] = orderedIds.map(Number);
      local.question_count = orderedIds.length;
      local.direct_count = direct.get(local.id).size;
      return orderedIds;
    }
    collect(localRoot);
    function verifyDirectory(local, directoryNode) {
      if (local.question_count !== Number(directoryNode.question_count)) {
        throw new Error(`题单 ${metadata.id} 的分类 ${directoryNode.label} 题数不一致：` +
          `${local.question_count}/${directoryNode.question_count}`);
      }
      for (const child of directoryNode.children || []) {
        verifyDirectory(localNodeById.get(Number(definition.categoryIdBase) + Number(child.category_id)), child);
      }
    }
    verifyDirectory(localRoot, rootDirectory);
    parent.children ||= [];
    parent.children.push(localRoot);
    manifestCollections.push({ id: metadata.id, name: metadata.name, question_count: items.length, unmatched });
  }
  result.manifest.collections = manifestCollections;
  return result;
}

async function readLocalClassifications(overlayDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(overlayDir, localClassificationsFile), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readLocalCategories(overlayDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(overlayDir, "categories.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readPreviousQuestionCategories(overlayDir, ids) {
  let manifest;
  let idIndex;
  try {
    [manifest, idIndex] = await Promise.all([
      fs.readFile(path.join(overlayDir, "manifest.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(overlayDir, "id_index.json"), "utf8").then(JSON.parse),
    ]);
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const shards = new Map();
  const result = new Map();
  for (const id of ids) {
    const shardName = idIndex[String(id)];
    const meta = shardName && manifest.shards?.[shardName];
    if (!meta?.file) continue;
    if (!shards.has(shardName)) {
      try {
        const questions = JSON.parse(await fs.readFile(path.join(overlayDir, meta.file), "utf8"));
        shards.set(shardName, new Map(questions.map(question => [String(question.id), question])));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        shards.set(shardName, new Map());
      }
    }
    const previous = shards.get(shardName).get(String(id));
    if (previous?.category_id != null) {
      result.set(String(id), { category_id: Number(previous.category_id),
        category_ids: (previous.category_ids || []).map(Number) });
    }
  }
  return result;
}

// 官网偶尔会把已有题目的分类清空。没有本地映射时沿用上一版题库的分类，
// 避免老题突然落进“未分类”并从章节里消失。
async function applyPreviousCategories(snapshot, overlayDir) {
  const missing = snapshot.questions.filter(question =>
    question.category_id == null && !(question.category_ids || []).length);
  if (!missing.length) return snapshot;
  const previous = await readPreviousQuestionCategories(overlayDir, missing.map(question => question.id));
  if (!previous.size) return snapshot;
  const valid = indexCategories(snapshot.categories);
  let preserved = 0;
  const questions = snapshot.questions.map(question => {
    if (question.category_id != null || (question.category_ids || []).length) return question;
    const entry = previous.get(String(question.id));
    if (!entry) return question;
    const ids = [...new Set(entry.category_ids.length ? entry.category_ids : [entry.category_id])]
      .filter(id => valid.has(Number(id)));
    let categoryId = valid.has(entry.category_id) ? entry.category_id : ids[0];
    if (categoryId == null) return question;
    if (!ids.includes(categoryId)) ids.unshift(categoryId);
    preserved += 1;
    return { ...question, category_id: categoryId, category_ids: ids };
  });
  return { ...snapshot, questions, preservedPreviousCategories: preserved };
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
  const assetFiles = new Set();
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
    for (const match of JSON.stringify(question).matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.(png|jpe?g|webp|gif))?/g)) {
      const hash = match[1].toLowerCase();
      const extension = (match[2] || "png").toLowerCase().replace(/^jpg$/, "jpeg");
      hashes.add(hash);
      assetFiles.add(`${hash}.${extension}`);
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
    idIndex, searchIndex, manifest, hashes, assetFiles };
}

async function findAsset(dataDir, fallbackAssetsDir, filename) {
  const names = filename.endsWith(".jpeg")
    ? [filename, filename.replace(/\.jpeg$/, ".jpg")]
    : filename.endsWith(".jpg")
      ? [filename, filename.replace(/\.jpg$/, ".jpeg")]
      : [filename];
  for (const name of names) {
    try { await fs.access(path.join(dataDir, "assets", name)); return true; } catch {}
    if (fallbackAssetsDir) {
      try { await fs.access(path.join(fallbackAssetsDir, name)); return true; } catch {}
    }
  }
  return false;
}

function assetName(match) {
  const extension = (match[2] || "png").toLowerCase().replace(/^jpg$/, "jpeg");
  return `${match[1].toLowerCase()}.${extension}`;
}

async function availableAssetNames(dataDir, fallbackAssetsDir) {
  const names = new Set();
  for (const root of [path.join(dataDir, "assets"), fallbackAssetsDir]) {
    if (!root) continue;
    const files = await fs.readdir(root).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files) {
      names.add(file);
      if (file.endsWith(".jpeg")) names.add(file.replace(/\.jpeg$/, ".jpg"));
      if (file.endsWith(".jpg")) names.add(file.replace(/\.jpg$/, ".jpeg"));
    }
  }
  return names;
}

async function collectAssetFiles(dataDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "manifest.json"), "utf8"));
  const files = new Set();
  for (const meta of Object.values(manifest.shards || {})) {
    const questions = JSON.parse(await fs.readFile(path.join(dataDir, meta.file), "utf8"));
    for (const question of questions) {
      for (const match of JSON.stringify(question).matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.(png|jpe?g|webp|gif))?/g)) {
        files.add(assetName(match));
      }
    }
  }
  return files;
}

// 官网从 2026-10 起给大量旧题追加“原始参考答案”扫描图；没有 ASSET_TOKEN 时
// 这些图无法离线下载，整段省略，保留前面的文字解析，避免题库出现成片破图。
export async function stripUnavailableAnswerImages(dataDir, fallbackAssetsDir) {
  const available = await availableAssetNames(dataDir, fallbackAssetsDir);
  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "manifest.json"), "utf8"));
  let stripped = 0;
  for (const meta of Object.values(manifest.shards || {})) {
    const file = path.join(dataDir, meta.file);
    const questions = JSON.parse(await fs.readFile(file, "utf8"));
    let changed = false;
    const next = questions.map(question => {
      const explanation = String(question.explanation || "");
      const marker = "### 原始参考答案";
      const index = explanation.indexOf(marker);
      if (index < 0) return question;
      const references = [...explanation.slice(index).matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.(png|jpe?g|webp|gif))?/g)]
        .map(assetName);
      if (!references.length || references.every(name => available.has(name))) return question;
      stripped += 1;
      changed = true;
      return { ...question, explanation: explanation.slice(0, index).replace(/\s+$/, "") };
    });
    if (changed) await fs.writeFile(file, `${JSON.stringify(next)}\n`);
  }
  const assetFiles = await collectAssetFiles(dataDir);
  const uniqueHashes = new Set([...assetFiles].map(name => name.replace(/\.[^.]+$/, "")));
  manifest.asset_count = uniqueHashes.size;
  manifest.stripped_answer_images = stripped;
  await writeJson(path.join(dataDir, "manifest.json"), manifest, true);
  return { assetFiles, stripped };
}

async function downloadAssets(assetFiles, dataDir, fallbackAssetsDir, signal) {
  const needed = [];
  for (const filename of assetFiles) {
    if (!(await findAsset(dataDir, fallbackAssetsDir, filename))) needed.push(filename);
  }
  if (!needed.length) return 0;
  const assetAccess = process.env.DAGUAN_ASSET_TOKEN;
  if (!assetAccess) return needed.length;
  const downloadable = needed.filter(filename => filename.endsWith(".png"));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < downloadable.length) {
      const filename = downloadable[next++];
      const hash = filename.slice(0, -".png".length);
      try {
        const response = await fetch(`${base}/api/v1/question-assets/${hash}`, {
          headers: { Authorization: `Bearer ${assetAccess}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        });
        if (!response.ok) continue;
        await fs.mkdir(path.join(dataDir, "assets"), { recursive: true });
        await fs.writeFile(path.join(dataDir, "assets", filename), Buffer.from(await response.arrayBuffer()));
      } catch {}
    }
  }));
  let remaining = 0;
  for (const filename of needed) {
    if (!(await findAsset(dataDir, fallbackAssetsDir, filename))) remaining += 1;
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
  const [officialSnapshot, collectionSnapshot] = await Promise.all([
    fetchOfficial(signal),
    fetchOfficialCollections(signal),
  ]);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    questions: officialSnapshot.questions.map(question => [question.id, question.content_hash, question.is_core, question.category_ids, question.category_id]),
    categories: officialSnapshot.categories,
    collections: collectionSnapshot.map(collection => ({
      id: collection.metadata.id,
      revision: collection.metadata.revision,
      items: collection.items.map(item => [item.question_id, item.position, item.available]),
    })),
  })).digest("hex");
  if (fingerprint === currentFingerprint) return { unchanged: true, fingerprint, sourceTotal: officialSnapshot.total,
    officialTotal: officialSnapshot.officialTotal, skippedPending: officialSnapshot.skippedPending };
  const completed = completeOfficialCategories(officialSnapshot, await readLocalCategories(overlayDir));
  const classified = applyLocalClassifications(completed, await readLocalClassifications(overlayDir));
  const snapshot = await applyPreviousCategories(classified, overlayDir);
  const result = buildCatalog(snapshot);
  addCollectionCategories(result, collectionSnapshot);
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
    const nativeSolutionStats = await applyNativeSolutions(stage, overlayDir);
    await reconcileVideoMappings(stage, overlayDir);
    const finalAssets = process.env.DAGUAN_ASSET_TOKEN
      ? { assetFiles: await collectAssetFiles(stage), stripped: 0 }
      : await stripUnavailableAnswerImages(stage, fallbackAssetsDir);
    if (signal?.aborted) throw signal.reason;
    await fs.mkdir(targetDir, { recursive: true });
    for (const file of [...fileByShard.values(), "categories.json", "category_questions.json", "id_index.json", "search_index.json", "manifest.json",
      "lecture-video-mappings.json", "paradiyu-linear-video.json", "retired-video-mappings.json"]) {
      const target = path.join(targetDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(stage, file), target);
    }
    const missingAssets = await downloadAssets(finalAssets.assetFiles, targetDir, fallbackAssetsDir, signal);
    return { fingerprint, sourceTotal: snapshot.total, officialTotal: officialSnapshot.officialTotal,
      skippedPending: officialSnapshot.skippedPending, strippedAnswerImages: finalAssets.stripped,
      preservedPreviousCategories: snapshot.preservedPreviousCategories || 0,
      total: merged.total, missingAssets, native_solution_stats: nativeSolutionStats };
  } finally {
    const resolvedStage = path.resolve(stage);
    if (!resolvedStage.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(resolvedStage).startsWith("daguan-official-sync-")) {
      throw new Error("同步临时目录位置异常，已保留以供检查");
    }
    await fs.rm(resolvedStage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
