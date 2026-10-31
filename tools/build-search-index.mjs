#!/usr/bin/env node
// Builds web/data/search_v2.json: full-text, normalized search documents for every
// question (stem, options, answer, explanation, source, chapter path, tags), plus
// pinyin shortcuts for chapter / knowledge-point / method names.
// Uses web/search-core.js so documents are normalized exactly like queries.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "web", "data");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export async function loadSearchCore() {
  const ctx = {};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(await readFile(join(root, "web", "search-core.js"), "utf8"), ctx);
  return ctx.DaguanSearch;
}

// Keep display stems reasonably small without cutting a formula in half.
function displayStem(stem, limit = 700) {
  const s = String(stem || "");
  if (s.length <= limit) return s;
  const paras = s.split(/\n{2,}|\n(?=\s*[（(]?[ⅠⅡⅢIVX1-9][)）.])/);
  let out = "";
  for (const p of paras) {
    if (out && out.length + p.length > limit) break;
    out += (out ? "\n\n" : "") + p;
  }
  const dollars = (out.match(/(?<!\\)\$/g) || []).length;
  if (dollars % 2 !== 0 || !out) return s.slice(0, limit * 2);
  return out + " …";
}

const aliasCache = join(root, "tools", "pinyin-aliases.json");

async function pinyinAliases(names) {
  let pinyin;
  try {
    ({ pinyin } = await import("pinyin-pro"));
  } catch {
    // No pinyin-pro installed: reuse the aliases generated last time.
    if (existsSync(aliasCache)) return readJson(aliasCache);
    console.warn("未安装 pinyin-pro，跳过拼音别名（npm i --no-save pinyin-pro 后重跑可启用）");
    return {};
  }
  const aliases = {};
  for (const name of names) {
    const clean = name.replace(/[（）()\s·、/]/g, "");
    if (!/^[一-龥]{2,10}$/.test(clean)) continue;
    const full = pinyin(clean, { toneType: "none", type: "array" }).join("").toLowerCase();
    const initials = pinyin(clean, { pattern: "first", toneType: "none", type: "array" }).join("").toLowerCase();
    if (!aliases[full]) aliases[full] = clean;
    if (initials.length >= 2 && !aliases[initials]) aliases[initials] = clean;
  }
  await writeFile(aliasCache, `${JSON.stringify(aliases, null, 1)}\n`);
  return aliases;
}

export async function buildSearchIndex(dir = dataDir) {
  const S = await loadSearchCore();
  const manifest = await readJson(join(dir, "manifest.json"));
  const categories = await readJson(join(dir, "categories.json"));
  const ann = existsSync(join(dir, "annotations.json")) ? await readJson(join(dir, "annotations.json")) : { annotations: {} };

  const catOrder = new Map();
  const names = [];
  let order = 0;
  (function walk(nodes, depth) {
    // most-used names first so aliases resolve to the common meaning
    for (const n of nodes) {
      catOrder.set(Number(n.id), order++);
      if (depth > 0 && n.question_count >= 5 && !/^\d{4}/.test(n.name)) names.push([n.name, n.question_count]);
      walk(n.children || [], depth + 1);
    }
  })(categories, 0);
  names.sort((a, b) => b[1] - a[1]);
  const tagNames = [...(ann.kps || []), ...(ann.methods || []), ...names.map((x) => x[0])];

  const docs = [];
  for (const meta of Object.values(manifest.shards || {})) {
    for (const q of await readJson(join(dir, meta.file))) {
      const A = ann.annotations?.[String(q.id)] || {};
      const options = (q.options || []).map((o) => (typeof o === "string" ? o : `${o.label || ""} ${o.text || o.content || ""}`)).join(" ");
      const tags = [
        q.source, q.category_path, A.exam, A.year, A.src, A.format, A.type, A.difficulty,
        ...(A.kps || []), ...(A.methods || []),
      ].filter((x) => x != null && x !== "").join(" | ");
      docs.push([
        Number(q.id),
        q.source || "",
        q.category_path || "",
        q.type || "",
        displayStem(q.stem),
        S.normalize(`${q.stem || ""} ${options}`),
        S.normalize(q.answer || ""),
        S.normalize(S.stripMath(q.explanation || "")),
        S.normalize(tags),
        catOrder.get(Number(q.category_id)) ?? 1e6,
        Number(q.serial) || 0,
      ]);
    }
  }
  docs.sort((a, b) => a[0] - b[0]);
  return {
    version: 2,
    generated: new Date().toISOString().slice(0, 10),
    fields: ["id", "src", "path", "type", "stem", "t", "a", "x", "g", "order", "serial"],
    aliases: await pinyinAliases(tagNames),
    docs,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = await buildSearchIndex();
  const text = JSON.stringify(index);
  await writeFile(join(dataDir, "search_v2.json"), text);
  console.log(`搜索索引：${index.docs.length} 题，${Object.keys(index.aliases).length} 个拼音别名，${(text.length / 1e6).toFixed(1)} MB`);
}
