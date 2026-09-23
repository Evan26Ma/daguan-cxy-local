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

    const shardName = overlay.shard || "概率统计";
    const shardMeta = manifest.shards?.[shardName];
    if (!shardMeta?.file) throw new Error(`本地题库 ${file} 指向的分片不存在：${shardName}`);
    const shardPath = path.join(dataDir, shardMeta.file);
    const shard = await readJson(shardPath);
    const rootCategory = findCategory(categories, overlay.parentCategoryId);
    if (!rootCategory) throw new Error(`本地题库 ${file} 找不到父分类 ${overlay.parentCategoryId}`);
    if (findCategory(categories, overlay.rootCategory.id)) throw new Error(`分类 ID 已被占用：${overlay.rootCategory.id}`);
    for (const chapter of overlay.chapters) {
      if (findCategory(categories, chapter.id)) throw new Error(`分类 ID 已被占用：${chapter.id}`);
    }

    const chapters = overlay.chapters.map((chapter) => localCategory(
      chapter.id,
      chapter.name,
      overlay.rootCategory.id,
      chapter.questionCount,
    ));
    const localRoot = localCategory(
      overlay.rootCategory.id,
      overlay.rootCategory.name,
      overlay.parentCategoryId,
      overlay.questions.length,
      chapters,
    );
    rootCategory.children ||= [];
    rootCategory.children.push(localRoot);
    rootCategory.question_count = Number(rootCategory.question_count || 0) + overlay.questions.length;

    const chapterIds = new Set(overlay.chapters.map((chapter) => Number(chapter.id)));
    const chapterCounts = new Map(overlay.chapters.map((chapter) => [Number(chapter.id), 0]));
    for (const question of overlay.questions) {
      const id = String(question.id);
      const categoryId = Number(question.category_id);
      if (!chapterIds.has(categoryId)) throw new Error(`题目 ${id} 指向本地题库之外的分类：${categoryId}`);
      chapterCounts.set(categoryId, chapterCounts.get(categoryId) + 1);
      if (Object.hasOwn(idIndex, id)) throw new Error(`题号已存在：${id}`);
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
      for (const targetCategoryId of [overlay.parentCategoryId, overlay.rootCategory.id, categoryId]) {
        const key = String(targetCategoryId);
        categoryQuestions[key] ||= [];
        categoryQuestions[key].push(question.id);
      }
      manifest.types[question.type] = Number(manifest.types[question.type] || 0) + 1;
    }
    for (const chapter of chapters) {
      const actualCount = chapterCounts.get(Number(chapter.id));
      if (actualCount !== Number(chapter.question_count)) {
        throw new Error(`分类 ${chapter.name} 数量不匹配：声明 ${chapter.question_count}，题目 ${actualCount}`);
      }
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
