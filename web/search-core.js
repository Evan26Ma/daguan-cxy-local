/* Daguan question search core.
 * Shared by the browser app (window.DaguanSearch) and the build tools (loaded with node:vm),
 * so documents and queries are normalized by exactly the same code.
 */
(function (root) {
  "use strict";

  // ---------- text normalization ----------
  const GREEK = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", vartheta: "θ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
    tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "γ", Delta: "δ", Theta: "θ",
    Lambda: "λ", Sigma: "σ", Phi: "φ", Psi: "ψ", Omega: "ω",
  };
  const SYMBOLS = [
    [/\\(?:to|rightarrow|longrightarrow)(?![a-zA-Z])|→/g, "->"],
    [/\\(?:leqslant|leq|le)(?![a-zA-Z])|≤|⩽/g, "<="],
    [/\\(?:geqslant|geq|ge)(?![a-zA-Z])|≥|⩾/g, ">="],
    [/\\(?:neq|ne)(?![a-zA-Z])|≠/g, "!="],
    [/\\infty(?![a-zA-Z])/g, "∞"],
    [/\\(?:cdot|times)(?![a-zA-Z])|·|×/g, "*"],
    [/\\int(?![a-zA-Z])/g, "∫"],
    [/\\iint(?![a-zA-Z])/g, "∬"],
    [/\\oint(?![a-zA-Z])/g, "∮"],
    [/\\sum(?![a-zA-Z])/g, "∑"],
    [/\\partial(?![a-zA-Z])/g, "∂"],
    [/\\sqrt(?![a-zA-Z])/g, "√"],
    [/\\lt(?![a-zA-Z])/g, "<"],
    [/\\gt(?![a-zA-Z])/g, ">"],
  ];
  const DROP_CMDS = /\\(?:(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle|limits|nolimits|mathrm|mathbf|mathit|mathbb|mathcal|boldsymbol|bm|operatorname|text|textbf|rm|bf|mathop|quad|qquad|underline|overline|hspace|vspace)(?![a-zA-Z])|[,;:! ])/g;

  // \frac{a}{b} -> a/b (nested braces aware)
  function readGroup(s, i) {
    while (s[i] === " ") i++;
    if (s[i] !== "{") {
      // single token argument: \frac12 or \frac a b
      if (s[i] === "\\") {
        const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
        if (m) return { text: m[0], end: i + m[0].length };
      }
      return { text: s[i] || "", end: i + 1 };
    }
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}") { depth--; if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 }; }
    }
    return { text: s.slice(i + 1), end: s.length };
  }
  function expandFrac(s) {
    let guard = 0;
    let idx;
    while ((idx = s.search(/\\[dtc]?frac/)) !== -1 && guard++ < 200) {
      const m = /^\\[dtc]?frac/.exec(s.slice(idx));
      const a = readGroup(s, idx + m[0].length);
      const b = readGroup(s, a.end);
      const wrap = (t) => (/^[\w\\.∞]+$/.test(t.replace(/\s/g, "")) ? t : `(${t})`);
      s = s.slice(0, idx) + `${wrap(a.text)}/${wrap(b.text)}` + s.slice(b.end);
    }
    return s;
  }

  function normalize(input) {
    let s = String(input == null ? "" : input);
    s = s.normalize("NFKC");
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
    s = s.replace(/\\[hv]space\*?\{[^}]*\}/g, "");
    s = expandFrac(s);
    for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
    s = s.replace(DROP_CMDS, "");
    s = s.replace(/\\([a-zA-Z]+)/g, (m, name) => GREEK[name] || name);
    s = s.replace(/\\/g, "");
    s = s.toLowerCase();
    s = s.replace(/[\s{}$_~`'"“”‘’]/g, "");
    // unify Chinese/ASCII punctuation that people type either way
    s = s.replace(/[，,]/g, ",").replace(/[。]/g, ".").replace(/[：]/g, ":").replace(/[；]/g, ";");
    s = s.replace(/[（]/g, "(").replace(/[）]/g, ")");
    return s;
  }

  // Remove math so explanation snippets stay readable and small.
  function stripMath(input) {
    return String(input == null ? "" : input)
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/\\\[[\s\S]*?\\\]/g, " ")
      .replace(/\$[^$\n]*\$/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  }

  // ---------- query parsing ----------
  const CN_NUM = { "一": 1, "二": 2, "三": 3, "1": 1, "2": 2, "3": 3 };
  const EXAM_NAME = { 1: "数一", 2: "数二", 3: "数三" };
  const SEP = "[\\s\\-_./、,，·]*";
  const EXAM_PART = "(?:数学?|[sS])\\s*([一二三123])(?![一二三])";
  const NO_PART = `(?:${SEP}(?:第\\s*)?[(（tTqQ#]?\\s*(\\d{1,2})\\s*[)）]?\\s*题?)?`;
  const YEAR_PART = "((?:19|20)\\d{2}|\\d{2})";
  const RE_YEAR_FIRST = new RegExp(`(?<!\\d)${YEAR_PART}\\s*年?${SEP}${EXAM_PART}${NO_PART}(?!\\d)`);
  const RE_EXAM_FIRST = new RegExp(`${EXAM_PART}${SEP}${YEAR_PART}\\s*年?${NO_PART}(?!\\d)`);

  function fullYear(y) {
    const n = Number(y);
    if (y.length === 4) return n;
    return n <= 50 ? 2000 + n : 1900 + n;
  }

  function parseQuery(raw, ctx) {
    const original = String(raw || "").trim();
    let q = original.normalize("NFKC");
    const out = { raw: original, paper: null, id: null, terms: [], numberTerms: [] };
    let m = RE_YEAR_FIRST.exec(q);
    let y, e, n;
    if (m) { [, y, e, n] = m; }
    else if ((m = RE_EXAM_FIRST.exec(q))) { [, e, y, n] = m; }
    if (m) {
      const year = fullYear(y);
      if (year >= 1987 && year <= 2050) {
        out.paper = { year, exam: EXAM_NAME[CN_NUM[e]], no: n ? Number(n) : null };
        q = (q.slice(0, m.index) + " " + q.slice(m.index + m[0].length)).trim();
        if (out.paper.no == null) {
          const extra = /(?:^|\s)(?:第\s*)?(\d{1,2})\s*题(?=\s|$)/.exec(q);
          if (extra) { out.paper.no = Number(extra[1]); q = q.replace(extra[0], " ").trim(); }
        }
      }
    }
    for (const token of q.split(/\s+/).filter(Boolean)) {
      let t;
      if ((t = /^(?:#|id[:：]?)(\d+)$/i.exec(token))) { out.id = Number(t[1]); continue; }
      if (/^\d+$/.test(token)) {
        if (ctx && ctx.hasId && ctx.hasId(Number(token)) && token.length >= 2) out.idCandidate = Number(token);
        out.numberTerms.push(token);
        continue;
      }
      const lower = token.toLowerCase();
      if (ctx && ctx.aliases && /^[a-z]+$/.test(lower) && ctx.aliases[lower]) {
        out.terms.push({ raw: ctx.aliases[lower], norm: normalize(ctx.aliases[lower]), alias: token });
        continue;
      }
      const norm = normalize(token);
      if (norm) out.terms.push({ raw: token, norm });
    }
    return out;
  }

  // ---------- index ----------
  // docs: arrays [id, src, path, type, stem, t, a, x, g, catOrder, serial]
  function createIndex(data, examIndex) {
    const F = {};
    (data.fields || []).forEach((name, i) => { F[name] = i; });
    const docs = data.docs.map((d) => ({
      id: d[F.id], src: d[F.src] || "", path: d[F.path] || "", type: d[F.type] || "",
      stem: d[F.stem] || "", t: d[F.t] || "", a: d[F.a] || "", x: d[F.x] || "", g: d[F.g] || "",
      order: d[F.order] ?? 1e9, serial: d[F.serial] ?? 0,
    }));
    const byId = new Map(docs.map((d) => [Number(d.id), d]));
    const index = {
      docs, byId, aliases: data.aliases || {}, papers: new Map(), examNos: new Map(), dupOf: new Map(),
      hasId: (id) => byId.has(Number(id)),
    };
    setExamIndex(index, examIndex);
    return index;
  }

  function setExamIndex(index, examIndex, overrides) {
    index.papers = new Map();
    index.examNos = new Map();
    index.dupOf = new Map();
    if (!examIndex) return index;
    for (const p of examIndex.papers || []) {
      const items = p.items.map(([no, id, c]) => ({ no, id: Number(id), c }));
      const ov = overrides && overrides[p.key];
      if (ov) {
        for (const [noStr, idv] of Object.entries(ov)) {
          const no = Number(noStr), id = Number(idv);
          const target = items.find((x) => x.id === id);
          const occupant = items.find((x) => x.no === no);
          if (!target) continue;
          if (occupant && occupant !== target) { occupant.no = target.no; occupant.c = 0; }
          target.no = no; target.c = 2; // 2 = fixed by the user
        }
        items.sort((a, b) => a.no - b.no);
      }
      index.papers.set(p.key, { ...p, items });
    }
    const dups = examIndex.dups || {};
    for (const [orig, list] of Object.entries(dups)) for (const d of list) index.dupOf.set(Number(d), Number(orig));
    for (const p of index.papers.values()) {
      for (const it of p.items) {
        const entry = { key: p.key, year: p.year, exam: p.exam, variant: p.variant, no: it.no, c: it.c };
        const add = (id) => { if (!index.examNos.has(id)) index.examNos.set(id, []); index.examNos.get(id).push(entry); };
        add(it.id);
        for (const d of dups[String(it.id)] || []) add(Number(d));
      }
    }
    return index;
  }

  function findPapers(index, year, exam) {
    const base = index.papers.get(`${year}${exam}`) || null;
    const text = index.papers.get(`${year}${exam}-new`) || null;
    const img = index.papers.get(`${year}${exam}-img`) || null;
    // Prefer the text version for reading; keep the image version (exact numbers) alongside.
    return { main: text || base, image: text && base ? base : img };
  }

  function matchTerm(doc, term) {
    const s = term.norm;
    if (!s) return 0;
    if (doc.g.includes(s)) return 3;
    if (doc.t.includes(s)) return 2;
    if (doc.a.includes(s)) return 1.2;
    if (doc.x.includes(s)) return 1;
    return 0;
  }
  function matchNumber(doc, num) {
    return doc.g.includes(num) ? 3 : 0;
  }

  function scoreDoc(doc, parsed) {
    let score = 0, matched = 0, inExplOnly = false;
    const total = parsed.terms.length + parsed.numberTerms.length;
    for (const term of parsed.terms) {
      const w = matchTerm(doc, term);
      if (w) { matched++; score += w; if (w === 1) inExplOnly = true; }
    }
    for (const num of parsed.numberTerms) {
      const w = matchNumber(doc, num);
      if (w) { matched++; score += w; }
    }
    return { score, matched, total, inExplOnly };
  }

  const byRank = (a, b) => b.score - a.score || a.doc.order - b.doc.order || a.doc.serial - b.doc.serial || a.doc.id - b.doc.id;

  function search(index, raw) {
    const parsed = parseQuery(raw, index);
    const result = { parsed, mode: "empty", hits: [], total: 0, partial: false, paper: null, image: null, direct: null, idHit: null };
    if (!parsed.raw) return result;

    if (parsed.id != null) {
      result.idHit = index.byId.get(parsed.id) ? parsed.id : null;
    } else if (parsed.idCandidate != null) {
      result.idHit = parsed.idCandidate;
    }

    const hasTerms = parsed.terms.length + parsed.numberTerms.length > 0;

    if (parsed.paper) {
      const { year, exam, no } = parsed.paper;
      const { main, image } = findPapers(index, year, exam);
      if (main) {
        result.mode = "paper";
        result.paper = main;
        result.image = image;
        let items = main.items;
        if (hasTerms) {
          items = items.filter((it) => {
            const d = index.byId.get(it.id);
            if (!d) return false;
            const s = scoreDoc(d, parsed);
            return s.matched === s.total;
          });
        }
        result.hits = items.map((it) => ({ id: it.id, no: it.no, c: it.c, score: 0 }));
        result.total = result.hits.length;
        if (no != null) {
          const hit = main.items.find((it) => it.no === no);
          const imgHit = image ? image.items.find((it) => it.no === no) : null;
          result.direct = hit ? { key: main.key, no, id: hit.id, c: hit.c, image: imgHit ? { key: image.key, id: imgHit.id } : null } : { key: main.key, no, missing: true, max: main.items.length };
        }
        return result;
      }
      // No numbered paper for that year (e.g. 1990s questions only exist in topic banks):
      // fall back to source matching, which keeps topic-bank 真题 for that year findable.
      parsed.numberTerms.push(String(year));
      parsed.terms.push({ raw: exam, norm: normalize(exam), examYear: year });
      result.paperMissing = { year, exam, no };
    }

    if (!hasTerms && !result.paperMissing) {
      result.mode = result.idHit != null ? "id" : "empty";
      return result;
    }

    const exact = [];
    const partial = [];
    const need = parsed.terms.length + parsed.numberTerms.length;
    const minPartial = Math.max(1, Math.ceil(need / 2));
    const missingRe = result.paperMissing
      ? new RegExp(`${result.paperMissing.year}数[一二三]*${result.paperMissing.exam.slice(1)}`)
      : null;
    for (const doc of index.docs) {
      let s;
      if (result.paperMissing) {
        const year = String(result.paperMissing.year);
        const examChar = result.paperMissing.exam.slice(1);
        if (!missingRe.test(doc.g)) continue;
        const rest = { ...parsed, terms: parsed.terms.filter((t) => !t.examYear), numberTerms: parsed.numberTerms.filter((x) => x !== year) };
        s = scoreDoc(doc, rest);
        if (s.matched !== s.total) continue;
        s.score += 3;
        exact.push({ id: doc.id, doc, ...s });
        continue;
      }
      s = scoreDoc(doc, parsed);
      if (!s.matched) continue;
      if (s.matched === s.total) exact.push({ id: doc.id, doc, ...s });
      else if (s.matched >= minPartial) partial.push({ id: doc.id, doc, ...s });
    }
    let list = exact;
    if (!exact.length && partial.length) {
      list = partial.sort((a, b) => b.matched - a.matched || byRank(a, b));
      result.partial = true;
    } else {
      list.sort(byRank);
    }
    // Hide topic-bank copies whose paper original is also in the list.
    const present = new Set(list.map((h) => Number(h.id)));
    list = list.filter((h) => {
      const orig = index.dupOf.get(Number(h.id));
      return !(orig != null && present.has(orig));
    });
    result.mode = "text";
    result.hits = list.map(({ id, score, inExplOnly, matched, total }) => ({ id, score, inExplOnly, matched, total }));
    result.total = result.hits.length;
    return result;
  }

  // Short snippet around the first term found in the normalized explanation.
  function snippet(doc, terms, radius) {
    radius = radius || 34;
    for (const t of terms) {
      const s = t.norm;
      if (!s) continue;
      const i = doc.x.indexOf(s);
      if (i >= 0) {
        const start = Math.max(0, i - radius);
        const end = Math.min(doc.x.length, i + s.length + radius);
        return { text: (start ? "…" : "") + doc.x.slice(start, end) + (end < doc.x.length ? "…" : ""), term: s };
      }
    }
    return null;
  }

  const api = { normalize, stripMath, parseQuery, createIndex, setExamIndex, search, snippet, findPapers, version: 2 };
  root.DaguanSearch = api;
})(typeof self !== "undefined" ? self : globalThis);
