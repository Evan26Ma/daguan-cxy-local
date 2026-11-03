// 真题题号真值构建器（v2）——不再推断，全部来自可核验证据：
//   1. question.source 的真实题号标注（YYYY数X（N）/ YYYY数一二三（一N、二N、三N））
//   2. 图片题 alt 文本（YYYY 数X 第N题）
//   3. 手核真值表 tools/exam-number-truth.json（9 卷，覆盖一切）
//   4. 空缺号位唯一时自动补位（数一卷 source 无题号的成员）
// 图文双版拆成两卷：文字版（主卷）+ 图片版（-img 附卷），前端 findPapers 走 main/image 双轨。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'F:/AI/大观园本地';
const dataDir = path.join(ROOT, 'web/data');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const cq = readJson(path.join(dataDir, 'category_questions.json'));
const cats = readJson(path.join(dataDir, 'categories.json'));
const manifest = readJson(path.join(dataDir, 'manifest.json'));
const truth = fs.existsSync(path.join(ROOT, 'tools/exam-number-truth.json')) ? readJson(path.join(ROOT, 'tools/exam-number-truth.json')) : {};
const overrides = fs.existsSync(path.join(ROOT, 'tools/exam-number-overrides.json')) ? readJson(path.join(ROOT, 'tools/exam-number-overrides.json')) : {};

const questions = new Map();
for (const meta of Object.values(manifest.shards || {})) {
  for (const q of readJson(path.join(dataDir, meta.file))) questions.set(Number(q.id), q);
}

const papers = [];
(function walk(nodes, p) {
  for (const n of nodes) {
    const cur = [...p, n.name];
    if (cur.length === 3 && cur[0] === '历年真题') {
      const m = /^(\d{4})(-new)?$/.exec(cur[2]);
      if (m) papers.push({ exam: cur[1], year: Number(m[1]), variant: m[2] ? 'new' : '', cat: n.id });
    }
    walk(n.children || [], cur);
  }
})(cats, []);

function parseSource(src) {
  const out = {};
  const s = String(src || '');
  const re = /(\d{4})数([一二三]+)（([^）]*)）/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[2].length === 1) {
      const no = parseInt(m[3], 10);
      if (no) out['数' + m[2]] = no;
    } else {
      for (const part of m[3].split('、')) {
        const mm = /^([一二三])(\d+)$/.exec(part.trim());
        if (mm) out['数' + mm[1]] = Number(mm[2]);
      }
    }
  }
  return out;
}
const altNo = q => {
  const m = /^!\[[^\]]*第\s*(\d+)\s*题/.exec((q.stem || '').trim());
  return m ? Number(m[1]) : null;
};

// 每卷容量（按现行题型结构）：2021+ 22 题，2008–2020 23 题，更早年份用成员数。
function capacity(year, members) {
  if (year >= 2021) return 22;
  if (year >= 2008) return 23;
  return members;
}

const results = [];
const dupsOf = new Map(); // 图片版 id → 同 no 的文字版 id（同卷）
const warnings = [];

for (const p of papers) {
  const members = (cq[String(p.cat)] || []).map(id => questions.get(id)).filter(Boolean);
  const key = `${p.year}${p.exam}${p.variant ? '-new' : ''}`;
  const verified = truth[key];
  const imgMembers = members.filter(q => altNo(q) != null);
  const textMembers = members.filter(q => altNo(q) == null);

  // 手核真值覆盖：直接指定整卷顺序（沿用旧口径，数组下标+1 即题号）
  if (Array.isArray(verified) && verified.length === members.length && verified.every(id => members.some(q => q.id === Number(id)))) {
    const items = verified.map((id, i) => ({ id: Number(id), no: i + 1, c: 1 }));
    results.push({ key, year: p.year, exam: p.exam, variant: p.variant, method: 'verified', items });
    continue;
  }

  // 文字版主卷
  const items = [];
  const unresolved = [];
  for (const q of textMembers) {
    const no = parseSource(q.source)[p.exam] || null;
    if (no) items.push({ id: Number(q.id), no, c: 1 });
    else unresolved.push(q);
  }
  // 空缺号位自动补位
  if (unresolved.length) {
    const taken = new Set(items.map(i => i.no));
    const cap = capacity(p.year, textMembers.length + imgMembers.length);
    const freeSlots = [];
    for (let n = 1; n <= cap; n++) if (!taken.has(n)) freeSlots.push(n);
    if (unresolved.length === freeSlots.length && freeSlots.length > 0) {
      const sorted = [...unresolved].sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0));
      sorted.forEach((q, i) => items.push({ id: Number(q.id), no: freeSlots[i], c: 0 }));
      warnings.push(`${key}: ${unresolved.length} 题无 source 题号，按唯一空缺号位补位（c=0）：${sorted.map(q => q.id).join(',')}`);
    } else {
      warnings.push(`${key}: ${unresolved.length} 题无法定位（source 无题号且空缺数不匹配），按成员序附卷尾`);
      const sorted = [...unresolved].sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0));
      sorted.forEach(q => items.push({ id: Number(q.id), no: Math.max(0, ...items.map(i => i.no)) + 1, c: 0 }));
    }
  }
  // no 冲突检测
  const byNo = new Map();
  for (const it of items) {
    if (byNo.has(it.no)) warnings.push(`${key}: 题号冲突 no=${it.no}（${byNo.get(it.no)} vs ${it.id}）`);
    byNo.set(it.no, it.id);
  }
  items.sort((a, b) => a.no - b.no);
  results.push({ key, year: p.year, exam: p.exam, variant: p.variant, method: 'truth', items });

  // 图片版附卷（仅当与文字版并存）
  if (imgMembers.length) {
    const imgItems = imgMembers.map(q => ({ id: Number(q.id), no: altNo(q), c: 1 })).sort((a, b) => a.no - b.no);
    const imgKey = `${key}-img`;
    results.push({ key: imgKey, year: p.year, exam: p.exam, variant: p.variant ? p.variant + '-img' : 'img', method: 'image-alt', items: imgItems });
    const textByNo = new Map(items.map(i => [i.no, i.id]));
    for (const it of imgItems) if (textByNo.has(it.no)) dupsOf.set(it.id, textByNo.get(it.no));
  }

  // 人工覆盖（exam-number-overrides.json）
  const ov = overrides[key];
  if (ov) {
    for (const [noStr, idv] of Object.entries(ov)) {
      const no = Number(noStr), id = Number(idv);
      const target = items.find(x => x.id === id);
      const occupant = items.find(x => x.no === no);
      if (occupant && occupant !== target) { occupant.no = target.no; occupant.c = 0; }
      if (target) { target.no = no; target.c = 2; }
    }
    items.sort((a, b) => a.no - b.no);
  }
}

results.sort((a, b) => b.year - a.year || a.exam.localeCompare(b.exam, 'zh') || String(a.variant).localeCompare(String(b.variant)));
const dups = {};
for (const [img, text] of dupsOf) dups[text] = [...(dups[text] || []), img];

const out = {
  version: 2,
  generated: new Date().toISOString().slice(0, 10),
  note: '真题题号真值化（tools/build-exam-truth.mjs）：source 标注 + alt 锚点 + 手核真值 + 空缺补位；c=1 真值/c=0 补位。图文双版拆卷：文字版主卷 + -img 附卷；dups: 文字版id→[同no图片版id]。',
  papers: results.map(({ key, year, exam, variant, method, items }) => ({ key, year, exam, variant, method, items: items.map(x => [x.no, x.id, x.c]) })),
  dups,
};

fs.writeFileSync(path.join(dataDir, 'exam_index.json'), JSON.stringify(out));
const all = results.flatMap(p => p.items);
const c1 = all.filter(x => x[2] >= 1).length;
console.log(`真题题号：${results.length} 套卷（含 -img 附卷），${all.length} 题，真值 ${c1} / 补位 ${all.length - c1}；图片↔文字关联 ${Object.keys(dups).length} 组`);
if (warnings.length) { console.log('警告：'); warnings.forEach(w => console.log('  ' + w)); }
