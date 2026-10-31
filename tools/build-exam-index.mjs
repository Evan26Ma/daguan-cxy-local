#!/usr/bin/env node
// Rebuilds real exam question numbers (第 N 题) for every 历年真题 paper and
// writes web/data/exam_index.json.
//
// The upstream data has no question numbers. What it does have:
//   * each paper category (历年真题 / 数三 / 2021) lists its member questions;
//   * questions whose *primary* category is that paper carry `serial`, which is
//     their rank in exam order among the paper's own questions;
//   * questions shared with a sibling paper (e.g. a 数一三 question stored under
//     数一) are members without a serial in this paper;
//   * image-only papers have alt text like "2014 数三 第7题".
// Exam layout is fixed by year (choice / fill-in / solution blocks) and inside
// each block questions run 高数 → 线代 → 概率 in textbook chapter order. Shared
// questions are slotted into the gaps using those constraints plus their number
// in the sibling paper. Positions that could not be pinned down exactly are
// marked as inferred (c: 0) and can be fixed in tools/exam-number-overrides.json.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "web", "data");
const overridesFile = join(root, "tools", "exam-number-overrides.json");
const truthFile = join(root, "tools", "exam-number-truth.json");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export const EXAM_RE = /数[一二三]+/;
const FILL_SLOTS = 6;
export const WEIGHTS = { subject: 10, chapter: 0.3, hint: 1 };

export function paperLayout(year, total) {
  // Returns an array of slot kinds, index 0 = question 1.
  const C = "C", F = "F", A = "A";
  const rep = (k, n) => Array.from({ length: Math.max(0, n) }, () => k);
  if (year >= 2021) return [...rep(C, 10), ...rep(F, FILL_SLOTS), ...rep(A, total - 10 - FILL_SLOTS)];
  if (year >= 2008) return [...rep(C, 8), ...rep(F, FILL_SLOTS), ...rep(A, total - 8 - FILL_SLOTS)];
  if (year === 2007) return [...rep(C, 10), ...rep(F, FILL_SLOTS), ...rep(A, total - 10 - FILL_SLOTS)];
  return [...rep(F, FILL_SLOTS), ...rep(C, 8), ...rep(A, total - 8 - FILL_SLOTS)];
}

const LA_RE = /矩阵|行列式|向量|特征值|特征向量|二次型|秩|线性方程组|线性相关|线性无关|线性表示|正交|相似|合同|\\begin\{[pbvV]?matrix\}|\\boldsymbol\{?\\alpha|\\alpha_[1-4]|基础解系|方程组\s*\$?A/;
const PR_RE = /概率|随机|分布|期望|方差|协方差|相关系数|样本|总体|估计量|估计值|置信|检验|独立同分布|P\s*\\?\{|\\mathrm\{?[DE]\}?\s*\(|服从|E\s*\(\s*X|D\s*\(\s*X|事件/;
export function subjectOf(q, topicRoot) {
  if (topicRoot === "高等数学") return 0;
  if (topicRoot === "线性代数") return 1;
  if (topicRoot === "概率统计") return 2;
  const s = q.stem || "";
  const pr = PR_RE.test(s), la = LA_RE.test(s);
  if (pr && !/矩阵|行列式/.test(s)) return 2;
  if (la) return 1;
  if (pr) return 2;
  return 0;
}

export function fillScore(q) {
  const s = q.stem || "";
  let score = 0;
  if (/\\underline|_{3,}|＿|\\_\\_|\\qquad\s*\.?\$?\s*[。.]?\s*$/.test(s)) score += 3;
  if (/[=＝为是]\s*\$?\s*[。.]?\s*$/.test(s.trim())) score += 1;
  if (/证明|\(I+\)|（I+）|\(Ⅰ\)|（Ⅰ）|（1）|\(1\)|\n\s*\(?（?[12]）?\)?/.test(s)) score -= 3;
  if (/求|计算|讨论/.test(s)) score -= 1;
  if (s.length > 260) score -= 1;
  return score;
}

const normStem = (s) => String(s || "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\\(?:left|right|displaystyle|mathrm|operatorname|limits|,|;|!|quad|qquad)/g, "")
  .replace(/\\d?frac/g, "frac")
  .replace(/[\s{}$（）()，,。.:：；;、]/g, "")
  .toLowerCase();
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Merge `fixed` (ordered, immovable relative order) with `free` items into one
// sequence of length fixed.length + free.length, minimizing cost(item, slotIndex).
// Free items keep their relative order as given (pre-sorted by key).
function mergeSequences(fixed, free, cost) {
  const p = fixed.length, k = free.length;
  const INF = Infinity;
  const dp = Array.from({ length: p + 1 }, () => new Float64Array(k + 1).fill(INF));
  const from = Array.from({ length: p + 1 }, () => new Int8Array(k + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= p; i++) {
    for (let j = 0; j <= k; j++) {
      if (dp[i][j] === INF) continue;
      const pos = i + j;
      if (i < p) {
        const c = dp[i][j] + cost(fixed[i], pos, true, i);
        if (c < dp[i + 1][j]) { dp[i + 1][j] = c; from[i + 1][j] = 1; }
      }
      if (j < k) {
        const c = dp[i][j] + cost(free[j], pos, false, i);
        if (c < dp[i][j + 1]) { dp[i][j + 1] = c; from[i][j + 1] = 2; }
      }
    }
  }
  const seq = [];
  let i = p, j = k;
  while (i > 0 || j > 0) {
    if (from[i][j] === 1) { seq.push(fixed[--i]); } else { seq.push(free[--j]); }
  }
  return seq.reverse();
}

export async function buildExamIndex(dir = dataDir, { simulate = null, ignoreTruth = false } = {}) {
  // simulate: Map(cat -> Map(id -> hint)) treats owned questions as shared (accuracy testing)
  const manifest = await readJson(join(dir, "manifest.json"));
  const categories = await readJson(join(dir, "categories.json"));
  const catQuestions = await readJson(join(dir, "category_questions.json"));
  const questions = new Map();
  for (const meta of Object.values(manifest.shards || {})) {
    for (const q of await readJson(join(dir, meta.file))) questions.set(Number(q.id), q);
  }

  // Category tree: DFS order (textbook order), root subject, paper detection.
  const catInfo = new Map();
  let order = 0;
  const papers = [];
  (function walk(nodes, path) {
    for (const n of nodes) {
      const p = [...path, n.name];
      catInfo.set(Number(n.id), { order: order++, root: p[0], path: p });
      if (p[0] === "历年真题" && p.length === 3) {
        const m = /^(\d{4})(-new)?$/.exec(n.name);
        if (m) papers.push({ cat: Number(n.id), exam: p[1], year: Number(m[1]), variant: m[2] ? "new" : "" });
      }
      walk(n.children || [], p);
    }
  })(categories, []);
  const isPaperCat = (id) => catInfo.get(Number(id))?.root === "历年真题";
  const topicCatOf = (q) => (q.category_ids || [q.category_id]).map(Number).find((id) => catInfo.has(id) && !isPaperCat(id) && ["高等数学", "线性代数", "概率统计"].includes(catInfo.get(id).root));

  // Duplicates: topic-bank copies of a paper question (same year in source, near-identical stem).
  const paperMemberIds = new Set();
  for (const p of papers) for (const id of catQuestions[String(p.cat)] || []) paperMemberIds.add(Number(id));
  const grams = new Map();
  const gramsOf = (q) => { let g = grams.get(q.id); if (!g) { g = bigrams(normStem(q.stem)); grams.set(q.id, g); } return g; };
  const byYear = new Map();
  for (const q of questions.values()) {
    if (paperMemberIds.has(Number(q.id))) continue;
    const m = /((?:19|20)\d\d)\s*(数[一二三]+)/.exec(q.source || "");
    if (!m) continue;
    const key = m[1];
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push({ q, exams: m[2] });
  }
  const dupsOf = new Map();
  for (const id of paperMemberIds) {
    const q = questions.get(id);
    const y = /((?:19|20)\d\d)/.exec(q.source || "")?.[1];
    if (!y) continue;
    const g = gramsOf(q);
    if (g.size < 4) continue;
    for (const cand of byYear.get(y) || []) {
      if (jaccard(g, gramsOf(cand.q)) >= 0.72) {
        if (!dupsOf.has(id)) dupsOf.set(id, []);
        dupsOf.get(id).push(Number(cand.q.id));
      }
    }
  }
  const chapterKey = (q) => {
    let t = topicCatOf(q);
    if (t == null) for (const d of dupsOf.get(Number(q.id)) || []) { t = topicCatOf(questions.get(d)); if (t != null) break; }
    if (t == null) return { subject: subjectOf(q, null), chapter: null };
    const info = catInfo.get(t);
    return { subject: subjectOf(q, info.root), chapter: info.order };
  };

  // Image-only papers: numbers come straight from the alt text.
  const altNumber = (q) => {
    const m = /^!\[[^\]]*第\s*(\d+)\s*题[^\]]*\]/.exec((q.stem || "").trim());
    return m ? Number(m[1]) : null;
  };

  const overrides = existsSync(overridesFile) ? await readJson(overridesFile) : {};
  const truth = !ignoreTruth && !simulate && existsSync(truthFile) ? await readJson(truthFile) : {};
  const resolved = new Map(); // `${cat}` -> Map(id -> no)
  const results = [];
  const kindOf = (q) => (q.type === "subjective" ? "S" : "C");

  // Resolve fully-owned papers first so their numbers can hint the others.
  const ownedShare = (p) => {
    const mem = (catQuestions[String(p.cat)] || []).map(Number);
    return mem.filter((id) => Number(questions.get(id)?.category_id) === p.cat).length / Math.max(1, mem.length);
  };
  papers.sort((a, b) => ownedShare(b) - ownedShare(a));

  for (const p of papers) {
    const members = (catQuestions[String(p.cat)] || []).map((id) => questions.get(Number(id))).filter(Boolean);
    const total = members.length;
    const key = `${p.year}${p.exam}${p.variant ? "-new" : ""}`;
    let items = null;
    let method = "";

    const alts = members.map(altNumber);
    if (alts.every((n) => n != null) && new Set(alts).size === total) {
      items = members.map((q, i) => ({ id: Number(q.id), no: alts[i], c: 1 })).sort((a, b) => a.no - b.no);
      method = "image-alt";
    }

    if (!items) {
      const layout = paperLayout(p.year, total);
      const sim = simulate?.get(p.cat);
      const isOwn = (q) => Number(q.category_id) === p.cat && !sim?.has(Number(q.id));
      const own = members.filter(isOwn).sort((a, b) => a.serial - b.serial);
      const shared = members.filter((q) => !isOwn(q));
      const nChoice = members.filter((q) => kindOf(q) === "C").length;
      const layoutChoice = layout.filter((k) => k === "C").length;
      if (nChoice !== layoutChoice || layout.length !== total) {
        // Unknown layout: keep own order, append shared by kind; mark inferred.
        const seq = [...own, ...shared];
        items = seq.map((q, i) => ({ id: Number(q.id), no: i + 1, c: shared.length ? 0 : 1 }));
        method = "fallback";
      } else {
        const hint = (q) => {
          if (sim?.has(Number(q.id))) return sim.get(Number(q.id));
          const r = resolved.get(String(q.category_id));
          return r?.get(Number(q.id)) ?? null;
        };
        // Split subjective into fill (F) and solution (A) blocks.
        const ownS = own.filter((q) => kindOf(q) === "S");
        const sharedS = shared.filter((q) => kindOf(q) === "S");
        const fillFirst = layout[0] === "F";
        let ownFillCount;
        if (fillFirst) {
          const firstChoiceSerial = Math.min(...own.filter((q) => kindOf(q) === "C").map((q) => q.serial), Infinity);
          ownFillCount = ownS.filter((q) => q.serial < firstChoiceSerial).length;
        } else {
          // choose split maximizing agreement with the fill/solution detector
          let best = null;
          for (let s = Math.max(0, FILL_SLOTS - sharedS.length); s <= Math.min(FILL_SLOTS, ownS.length); s++) {
            let score = 0;
            ownS.forEach((q, i) => { const f = fillScore(q); score += i < s ? f : -f; });
            const need = FILL_SLOTS - s;
            const sharedScores = sharedS.map((q) => {
              const h = hint(q);
              const sibLayout = h != null ? paperLayout(p.year, 99)[h - 1] : null;
              return fillScore(q) + (sibLayout === "F" ? 4 : sibLayout === "A" ? -4 : 0);
            }).sort((a, b) => b - a);
            sharedScores.forEach((f, i) => { score += i < need ? f : -f; });
            if (!best || score > best.score) best = { s, score };
          }
          ownFillCount = best ? best.s : Math.min(FILL_SLOTS, ownS.length);
        }
        const ownFill = ownS.slice(0, ownFillCount);
        const ownAns = ownS.slice(ownFillCount);
        const needFill = FILL_SLOTS - ownFill.length;
        const sharedRank = sharedS.map((q) => {
          const h = hint(q);
          const sibLayout = h != null ? paperLayout(p.year, 99)[h - 1] : null;
          return { q, f: fillScore(q) + (sibLayout === "F" ? 4 : sibLayout === "A" ? -4 : 0) };
        }).sort((a, b) => b.f - a.f);
        const sharedFill = sharedRank.slice(0, needFill).map((x) => x.q);
        const sharedAns = sharedRank.slice(needFill).map((x) => x.q);

        const blocks = {
          C: { own: own.filter((q) => kindOf(q) === "C"), shared: shared.filter((q) => kindOf(q) === "C") },
          F: { own: ownFill, shared: sharedFill },
          A: { own: ownAns, shared: sharedAns },
        };
        items = [];
        for (const kind of ["C", "F", "A"]) {
          const slots = layout.map((k, i) => (k === kind ? i + 1 : 0)).filter(Boolean);
          const { own: o, shared: s } = blocks[kind];
          if (o.length + s.length !== slots.length) {
            const seq = [...o, ...s];
            seq.forEach((q, i) => items.push({ id: Number(q.id), no: slots[i] ?? (layout.length + i + 1), c: 0 }));
            method = "partial";
            continue;
          }
          const keyed = (q) => ({ q, ...chapterKey(q), hint: hint(q) });
          const fixed = o.map(keyed);
          const free = s.map(keyed).sort((a, b) =>
            a.subject - b.subject || (a.hint ?? 99) - (b.hint ?? 99) || (a.chapter ?? 1e9) - (b.chapter ?? 1e9) || a.q.id - b.q.id);
          const cost = (it, pos, isFixed, i) => {
            if (isFixed) return 0;
            // inversions against the fixed (own) sequence
            let c = 0;
            for (let f = 0; f < fixed.length; f++) {
              const x = fixed[f];
              const xBefore = f < i;
              const sub = Math.sign(x.subject - it.subject);
              if (sub !== 0) { if ((sub > 0) === xBefore) c += WEIGHTS.subject; continue; }
              if (x.chapter != null && it.chapter != null && x.chapter !== it.chapter) {
                if ((x.chapter > it.chapter) === xBefore) c += WEIGHTS.chapter;
              }
            }
            if (it.hint != null) c += Math.abs(slots[pos] - it.hint) * WEIGHTS.hint;
            return c;
          };
          const seq = mergeSequences(fixed, free, cost);
          const exact = s.length === 0;
          seq.forEach((x, i) => items.push({ id: Number(x.q.id), no: slots[i], c: exact ? 1 : 0 }));
          if (!method) method = s.length ? "merged" : "owned";
          else if (s.length) method = "merged";
        }
        items.sort((a, b) => a.no - b.no);
      }
    }

    // Hand-verified full orders: { "2021数三": [id of Q1, id of Q2, ...] }
    const verified = truth[key];
    if (Array.isArray(verified) && verified.length === items.length && verified.every((id) => items.some((x) => x.id === Number(id)))) {
      items = verified.map((id, i) => ({ id: Number(id), no: i + 1, c: 1 }));
      method = "verified";
    } else if (verified) {
      console.warn(`exam-number-truth.json: ${key} 与题库成员不一致，已忽略`);
    }

    // Manual overrides: { "2021数三": { "7": 252, ... } }
    const ov = overrides[key];
    if (ov) {
      for (const [no, id] of Object.entries(ov)) {
        const target = items.find((x) => x.id === Number(id));
        const occupant = items.find((x) => x.no === Number(no));
        if (target && occupant && target !== occupant) { occupant.no = target.no; occupant.c = 0; }
        if (target) { target.no = Number(no); target.c = 1; }
      }
      items.sort((a, b) => a.no - b.no);
    }

    resolved.set(String(p.cat), new Map(items.map((x) => [x.id, x.no])));
    results.push({ key, year: p.year, exam: p.exam, variant: p.variant, cat: p.cat, method, items });
  }

  results.sort((a, b) => b.year - a.year || a.exam.localeCompare(b.exam, "zh") || a.variant.localeCompare(b.variant));
  const dups = {};
  for (const [id, list] of dupsOf) dups[id] = list;
  return {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    note: "第N题 reconstructed by tools/build-exam-index.mjs; c=1 exact, c=0 inferred. Fix with tools/exam-number-overrides.json.",
    papers: results.map(({ key, year, exam, variant, cat, method, items }) => ({
      key, year, exam, variant, cat, method,
      items: items.map((x) => [x.no, x.id, x.c]),
    })),
    dups,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = await buildExamIndex(dataDir);
  await writeFile(join(dataDir, "exam_index.json"), JSON.stringify(index));
  const all = index.papers.flatMap((p) => p.items);
  const exact = all.filter((x) => x[2] === 1).length;
  console.log(`真题题号：${index.papers.length} 套试卷，${all.length} 题，其中 ${exact} 题精确、${all.length - exact} 题推断；${Object.keys(index.dups).length} 题找到题库副本`);
}
