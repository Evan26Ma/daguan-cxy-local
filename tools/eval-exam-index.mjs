#!/usr/bin/env node
// Accuracy check for build-exam-index: in papers whose numbers are known exactly,
// pretend some questions are shared (noisy hint = true number ± up to 2) and
// measure how often the merge puts them back in the right slot.
import { buildExamIndex, WEIGHTS } from "./build-exam-index.mjs";
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const base = await buildExamIndex();
const exactPapers = base.papers.filter((p) => p.method === "owned");
async function run(shareRate, noise, trials = 6) {
  let total = 0, right = 0, paperOk = 0, papers = 0;
  for (let t = 0; t < trials; t++) {
    const simulate = new Map();
    const truth = new Map();
    for (const p of exactPapers) {
      const m = new Map();
      for (const [no, id] of p.items) {
        if (rnd() < shareRate) {
          const n = noise < 0 ? null : no + Math.round((rnd() * 2 - 1) * noise);
          m.set(id, n);
        }
        truth.set(`${p.cat}:${id}`, no);
      }
      simulate.set(p.cat, m);
    }
    const out = await buildExamIndex(undefined, { simulate });
    for (const p of out.papers.filter((x) => simulate.has(x.cat))) {
      let ok = true;
      for (const [no, id] of p.items) {
        total++;
        if (truth.get(`${p.cat}:${id}`) === no) right++; else ok = false;
      }
      papers++; if (ok) paperOk++;
    }
  }
  return `share ${shareRate} noise ±${noise < 0 ? "none" : noise}: ${(100 * right / total).toFixed(1)}% questions correct, ${(100 * paperOk / papers).toFixed(0)}% papers fully correct`;
}
const configs = process.argv.includes("--sweep")
  ? [{ subject: 10, chapter: 1, hint: 0.6 }, { subject: 10, chapter: 0.3, hint: 1 }, { subject: 10, chapter: 2, hint: 0.3 }, { subject: 10, chapter: 0, hint: 1 }, { subject: 10, chapter: 1, hint: 1.5 }]
  : [{ ...WEIGHTS }];
for (const w of configs) {
  Object.assign(WEIGHTS, w);
  console.log(JSON.stringify(w));
  for (const [r, n] of [[0.25, 0], [0.25, 1], [0.25, 2], [0.4, 2], [0.25, -1]]) console.log("  ", await run(r, n));
}

// Real-paper check against hand-verified orders.
import { readFile } from "node:fs/promises";
const truth = JSON.parse(await readFile(new URL("./exam-number-truth.json", import.meta.url), "utf8"));
for (const w of configs) {
  Object.assign(WEIGHTS, w);
  const out = await buildExamIndex(undefined, { ignoreTruth: true });
  const parts = [];
  for (const [key, ids] of Object.entries(truth)) {
    if (key.startsWith("_")) continue;
    const p = out.papers.find((x) => x.key === key);
    const ok = ids.filter((id, i) => p.items.find((it) => it[1] === id)?.[0] === i + 1).length;
    parts.push(`${key} ${ok}/${ids.length}`);
  }
  console.log("real papers", JSON.stringify(w), parts.join(", "));
}
