import fs from "node:fs/promises";
import path from "node:path";

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value)}\n`);
}

async function writePrettyJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function findCategory(categories, id) {
  for (const category of categories) {
    if (Number(category.id) === Number(id)) return category;
    const found = findCategory(category.children || [], id);
    if (found) return found;
  }
  return null;
}

function findCategoryPath(categories, id, ancestors = []) {
  for (const category of categories) {
    const current = [...ancestors, category];
    if (Number(category.id) === Number(id)) return current;
    const found = findCategoryPath(category.children || [], id, current);
    if (found) return found;
  }
  return null;
}

function localCategory(id, name, parentId, questionCount, children = []) {
  return {
    id,
    name,
    parent_id: parentId,
    question_count: questionCount,
    direct_count: children.length ? 0 : questionCount,
    children,
  };
}

/** 选择题必须带可点选项与对得上的 correct_labels，否则前端渲染不出选项也无法判题。 */
function assertChoiceShape(question, file) {
  const type = String(question.type || "");
  if (type !== "single_choice" && type !== "multiple_choice") return;
  const labels = new Set(
    (question.options || []).map((option) => String(option?.label || "").trim().toUpperCase()).filter(Boolean),
  );
  const answers = (Array.isArray(question.correct_labels) ? question.correct_labels : [])
    .map((label) => String(label).trim().toUpperCase());
  if (!labels.size) throw new Error(`本地题库 ${file} 的选择题 ${question.id} 缺少选项`);
  if (!answers.length) throw new Error(`本地题库 ${file} 的选择题 ${question.id} 缺少正确选项标记`);
  for (const answer of answers) {
    if (!labels.has(answer)) throw new Error(`本地题库 ${file} 的选择题 ${question.id} 正确答案 ${answer} 不在选项里`);
  }
  if (type === "single_choice" && answers.length !== 1) {
    throw new Error(`本地题库 ${file} 的单选题 ${question.id} 应有且仅有 1 个正确选项`);
  }
  if (type === "multiple_choice" && answers.length < 2) {
    throw new Error(`本地题库 ${file} 的多选题 ${question.id} 至少需要 2 个正确选项`);
  }
}

/** Merge repository-local question banks into a freshly downloaded or local catalog. */
export async function mergeLocalQuestionBanks(dataDir, overlayDir = dataDir) {
  const overlayRoot = path.join(overlayDir, "local_question_banks");
  let overlayFiles;
  try {
    overlayFiles = (await fs.readdir(overlayRoot)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return { added: 0 };
    throw error;
  }
  if (!overlayFiles.length) return { added: 0 };

  const categories = await readJson(path.join(dataDir, "categories.json"));
  const categoryQuestions = await readJson(path.join(dataDir, "category_questions.json"));
  const idIndex = await readJson(path.join(dataDir, "id_index.json"));
  const searchIndex = await readJson(path.join(dataDir, "search_index.json"));
  const manifest = await readJson(path.join(dataDir, "manifest.json"));
  const applied = [];

  for (const file of overlayFiles) {
    const overlay = await readJson(path.join(overlayRoot, file));
    if (!Array.isArray(overlay.questions) || !overlay.questions.length) continue;
    const ids = overlay.questions.map((question) => String(question.id));
    const present = ids.filter((id) => Object.hasOwn(idIndex, id));
    if (present.length === ids.length) continue;
    if (present.length) throw new Error(`本地题库 ${file} 只合并了一部分（${present.length}/${ids.length}），已停止以避免重复计数`);
    for (const question of overlay.questions) assertChoiceShape(question, file);

    const shardName = overlay.shard || "概率统计";
    const shardMeta = manifest.shards?.[shardName];
    if (!shardMeta?.file) throw new Error(`本地题库 ${file} 指向的分片不存在：${shardName}`);
    const shardPath = path.join(dataDir, shardMeta.file);
    const shard = await readJson(shardPath);

    const rawPlacements = Array.isArray(overlay.placements) && overlay.placements.length
      ? overlay.placements
      : [{
        parentCategoryId: overlay.parentCategoryId,
        fallbackParentCategoryId: overlay.fallbackParentCategoryId,
        rootCategory: overlay.rootCategory,
        chapters: overlay.chapters,
      }];

    const reservedCategoryIds = new Set();
    const resolvedPlacements = [];
    const chapterInfo = new Map();
    for (const [placementIndex, placement] of rawPlacements.entries()) {
      const ancestors = findCategoryPath(categories, placement.parentCategoryId)
        || (placement.fallbackParentCategoryId == null
          ? null
          : findCategoryPath(categories, placement.fallbackParentCategoryId));
      const parentCategory = ancestors?.at(-1);
      if (!parentCategory) throw new Error(`本地题库 ${file} 找不到父分类 ${placement.parentCategoryId}`);
      const rootId = Number(placement.rootCategory?.id);
      if (!Number.isInteger(rootId) || findCategory(categories, rootId) || reservedCategoryIds.has(rootId)) {
        throw new Error(`分类 ID 已被占用：${placement.rootCategory?.id}`);
      }
      reservedCategoryIds.add(rootId);
      const placementChapters = Array.isArray(placement.chapters) ? placement.chapters : [];
      if (!placementChapters.length) throw new Error(`本地题库 ${file} 缺少章节定义`);
      for (const chapter of placementChapters) {
        const chapterId = Number(chapter.id);
        if (!Number.isInteger(chapterId) || findCategory(categories, chapterId) || reservedCategoryIds.has(chapterId)) {
          throw new Error(`分类 ID 已被占用：${chapter.id}`);
        }
        reservedCategoryIds.add(chapterId);
        chapterInfo.set(chapterId, {
          placementIndex,
          chapter,
          ancestors,
          rootId,
          count: 0,
        });
      }
      resolvedPlacements.push({
        placement,
        ancestors,
        parentCategory,
        rootId,
        uniqueIds: new Set(),
      });
    }

    const seenQuestionIds = new Set();
    const questionChapterMap = new Map();
    for (const question of overlay.questions) {
      const id = String(question.id);
      if (Object.hasOwn(idIndex, id) || seenQuestionIds.has(id)) throw new Error(`题号已存在：${id}`);
      seenQuestionIds.add(id);
      const rawChapterIds = Array.isArray(question.category_ids) && question.category_ids.length
        ? question.category_ids
        : [question.category_id];
      const targetChapterIds = [...new Set(rawChapterIds.map(Number))];
      if (question.category_id != null && !targetChapterIds.includes(Number(question.category_id))) {
        targetChapterIds.unshift(Number(question.category_id));
      }
      if (!targetChapterIds.length) throw new Error(`题目 ${id} 缺少有效分类`);
      for (const chapterId of targetChapterIds) {
        const info = chapterInfo.get(chapterId);
        if (!info) throw new Error(`题目 ${id} 指向本地题库之外的分类：${chapterId}`);
        info.count += 1;
        resolvedPlacements[info.placementIndex].uniqueIds.add(id);
      }
      questionChapterMap.set(id, targetChapterIds);
    }

    for (const info of chapterInfo.values()) {
      if (info.count !== Number(info.chapter.questionCount)) {
        throw new Error(`分类 ${info.chapter.name} 数量不匹配：声明 ${info.chapter.questionCount}，题目 ${info.count}`);
      }
    }

    const touchedAncestors = new Map();
    for (const entry of resolvedPlacements) {
      const { placement, ancestors, parentCategory, rootId, uniqueIds } = entry;
      const chapters = placement.chapters.map((chapter) => localCategory(
        chapter.id,
        chapter.name,
        rootId,
        chapter.questionCount,
      ));
      const localRoot = localCategory(
        rootId,
        placement.rootCategory.name,
        parentCategory.id,
        uniqueIds.size,
        chapters,
      );
      parentCategory.children ||= [];
      parentCategory.children.push(localRoot);
      for (const ancestor of ancestors) touchedAncestors.set(String(ancestor.id), ancestor);
    }

    for (const question of overlay.questions) {
      const id = String(question.id);
      const targetChapterIds = questionChapterMap.get(id);
      shard.push(question);
      idIndex[id] = shardName;
      searchIndex.push({
        id: question.id,
        source: question.source,
        type: question.type,
        path: question.category_path || "",
        serial: question.serial ?? null,
        stem: question.stem || "",
      });
      const targetCategories = new Set();
      for (const chapterId of targetChapterIds) {
        const info = chapterInfo.get(chapterId);
        for (const ancestor of info.ancestors) targetCategories.add(ancestor.id);
        targetCategories.add(info.rootId);
        targetCategories.add(chapterId);
      }
      for (const targetCategoryId of targetCategories) {
        const key = String(targetCategoryId);
        categoryQuestions[key] ||= [];
        categoryQuestions[key].push(question.id);
      }
      manifest.types[question.type] = Number(manifest.types[question.type] || 0) + 1;
    }
    for (const category of touchedAncestors.values()) {
      category.question_count = categoryQuestions[String(category.id)]?.length || 0;
    }
    shardMeta.count = shard.length;
    manifest.total = Number(manifest.total) + overlay.questions.length;
    await writeJson(shardPath, shard);
    applied.push({ file, added: overlay.questions.length, shard: shardName });
  }

  if (applied.length) {
    await Promise.all([
      writeJson(path.join(dataDir, "categories.json"), categories),
      writeJson(path.join(dataDir, "category_questions.json"), categoryQuestions),
      writeJson(path.join(dataDir, "id_index.json"), idIndex),
      writeJson(path.join(dataDir, "search_index.json"), searchIndex),
      writePrettyJson(path.join(dataDir, "manifest.json"), manifest),
    ]);
  }
  return { added: applied.reduce((sum, item) => sum + item.added, 0), overlays: applied };
}
