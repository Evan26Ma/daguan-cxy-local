import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const NATIVE_SOLUTIONS_FILE = "native-solutions.json";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const QUESTION_ID_PATTERN = /^[1-9]\d*$/;
const CHOICE_TYPES = new Set(["single_choice", "multiple_choice"]);
const SOLUTION_SOURCE_KEYS = ["document", "label", "file", "block_start", "block_end"];

/** 题干与选项的稳定指纹；答案字段变化不影响匹配。 */
export function questionSignature(question) {
  return createHash("sha256")
    .update(JSON.stringify([String(question?.stem || ""), question?.options || []]), "utf8")
    .digest("hex");
}

export function emptyNativeSolutionStats() {
  return {
    entries: 0,
    applied: 0,
    answered: 0,
    explanations: 0,
    native_solutions: 0,
    skipped: { missing: 0, hash_mismatch: 0, conflict: 0 },
  };
}

function invalid(id, message) {
  throw new Error(`本地方案 ${id} ${message}`);
}

function validateSolutionSource(id, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    invalid(id, "的 native_solution.source 格式不合法");
  }
  const built = {};
  for (const key of SOLUTION_SOURCE_KEYS) {
    if (source[key] === undefined) continue;
    const value = source[key];
    const valid = key === "block_start" || key === "block_end" ? Number.isInteger(value) : typeof value === "string";
    if (!valid) invalid(id, `的 native_solution.source.${key} 不合法`);
    built[key] = value;
  }
  return built;
}

function validateNativeSolution(id, solution) {
  if (!solution || typeof solution !== "object" || Array.isArray(solution)) {
    invalid(id, "的 native_solution 格式不合法");
  }
  if (typeof solution.html !== "string" || !solution.html.trim()) {
    invalid(id, "的 native_solution.html 不合法");
  }
  const built = { html: solution.html };
  if (solution.text !== undefined) {
    if (typeof solution.text !== "string") invalid(id, "的 native_solution.text 不合法");
    built.text = solution.text;
  }
  if (solution.source !== undefined) built.source = validateSolutionSource(id, solution.source);
  return built;
}

function validateEntry(id, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(id, "的条目格式不合法");
  if (typeof raw.question_hash !== "string" || !HASH_PATTERN.test(raw.question_hash)) {
    invalid(id, "缺少有效的 question_hash");
  }
  // 只认识下列字段：其他键一律忽略，不会进入题库。
  const entry = { question_hash: raw.question_hash };
  let hasField = false;
  if (raw.answer !== undefined) {
    if (typeof raw.answer !== "string" || !raw.answer.trim()) invalid(id, "的 answer 不合法");
    entry.answer = raw.answer;
    hasField = true;
  }
  if (raw.explanation !== undefined) {
    if (typeof raw.explanation !== "string" || !raw.explanation.trim()) invalid(id, "的 explanation 不合法");
    entry.explanation = raw.explanation;
    hasField = true;
  }
  if (raw.native_solution !== undefined) {
    entry.native_solution = validateNativeSolution(id, raw.native_solution);
    hasField = true;
  }
  if (!hasField) invalid(id, "没有任何可应用的 answer/explanation/native_solution");
  return entry;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("本地方案文件格式不合法");
  if (payload.version !== 1) throw new Error(`不支持的本地方案版本：${payload.version}`);
  const solutions = payload.solutions;
  if (!solutions || typeof solutions !== "object" || Array.isArray(solutions)) {
    throw new Error("本地方案 solutions 格式不合法");
  }
  const entries = new Map();
  for (const [id, raw] of Object.entries(solutions)) {
    if (!QUESTION_ID_PATTERN.test(id)) invalid(id, "的题目 ID 不合法");
    entries.set(id, validateEntry(id, raw));
  }
  return entries;
}

function choiceLabels(answer, options) {
  const text = String(answer).replace(/[\s,，、;；/|]+/g, "").toUpperCase();
  if (!text) return null;
  const labels = new Set((options || []).map(option => String(option?.label ?? "").trim().toUpperCase()).filter(Boolean));
  const chars = [...text];
  if (!labels.size || chars.some(label => !labels.has(label))) return null;
  if (new Set(chars).size !== chars.length) return null;
  return chars.sort();
}

/** 选择题答案只有无歧义且与 correct_labels 完全一致时才允许替换。 */
function consistentChoiceAnswer(answer, question) {
  const parsed = choiceLabels(answer, question.options);
  const expected = [...new Set((question.correct_labels || []).map(label => String(label).trim().toUpperCase()))].sort();
  if (!parsed || !expected.length || parsed.length !== expected.length) return null;
  if (!parsed.every((label, index) => label === expected[index])) return null;
  return (question.correct_labels || []).join("");
}

/**
 * 把审阅过的本地题解叠加到题库分片上：只改 answer/explanation/native_solution，
 * 且仅针对 ID 存在、题干与选项指纹一致的题目；缺少 overlay 时返回零统计。
 */
export async function applyNativeSolutions(dataDir, overlayDir = dataDir) {
  const stats = emptyNativeSolutionStats();
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(path.join(overlayDir, NATIVE_SOLUTIONS_FILE), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return stats;
    throw error;
  }
  const entries = validatePayload(payload);
  stats.entries = entries.size;
  if (!entries.size) return stats;

  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "manifest.json"), "utf8"));
  const shards = new Map();
  const locatedById = new Map();
  for (const meta of Object.values(manifest.shards || {})) {
    if (!meta?.file) throw new Error("题库清单缺少分片文件");
    const list = JSON.parse(await fs.readFile(path.join(dataDir, meta.file), "utf8"));
    if (!Array.isArray(list)) throw new Error(`题库分片 ${meta.file} 格式不合法`);
    shards.set(meta.file, list);
    list.forEach((question, index) => {
      if (question && typeof question === "object" && question.id != null) {
        locatedById.set(String(question.id), { file: meta.file, index });
      }
    });
  }

  const changed = new Set();
  for (const [id, entry] of entries) {
    const located = locatedById.get(id);
    if (!located) { stats.skipped.missing += 1; continue; }
    const question = shards.get(located.file)[located.index];
    if (questionSignature(question) !== entry.question_hash) { stats.skipped.hash_mismatch += 1; continue; }
    if (entry.answer !== undefined) {
      const answer = CHOICE_TYPES.has(question.type) ? consistentChoiceAnswer(entry.answer, question) : entry.answer;
      if (answer == null) { stats.skipped.conflict += 1; continue; }
      question.answer = answer;
      stats.answered += 1;
    }
    if (entry.explanation !== undefined) {
      question.explanation = entry.explanation;
      stats.explanations += 1;
    }
    if (entry.native_solution !== undefined) {
      question.native_solution = entry.native_solution;
      stats.native_solutions += 1;
    }
    stats.applied += 1;
    changed.add(located.file);
  }
  for (const file of changed) {
    await fs.writeFile(path.join(dataDir, file), `${JSON.stringify(shards.get(file))}\n`);
  }
  return stats;
}
