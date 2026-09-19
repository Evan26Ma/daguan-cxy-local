# -*- coding: utf-8 -*-
"""把 luna 线代题库（Evan26Ma/liner-algebra-kaoyan-daguan）的 classification 标注
按题目匹配合并进本地 annotations.json，并生成 luna 式分面计数表。"""
import json, glob, re, io, difflib, collections

LUNA = r"C:/Users/14666/AppData/Local/Temp/luna-bank/answers/linear-algebra-7/chapters"
DATA = r"F:/ai/daguan-cxy-local/web/data"

def norm(s):
    return re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]", "", str(s or ""))

def year_exam(s):
    y = re.search(r"(19|20)\d{2}", str(s or ""))
    ex = "数一" if re.search(r"数学一|数一", str(s)) else "数二" if re.search(r"数学二|数二", str(s)) else "数三" if re.search(r"数学三|数三", str(s)) else None
    return (int(y.group(0)) if y else None), ex

DIFF = {"easy": "基础", "medium": "中等", "hard": "较难"}

# 1) 读 luna
luna = []
for f in sorted(glob.glob(LUNA + "/ch*.json")):
    d = json.load(open(f, encoding="utf-8"))
    ch = d.get("title") or ""
    for q in d.get("questions", []):
        c = q.get("classification") or {}
        if not c:
            continue
        luna.append({
            "id": q["id"], "chapter": ch,
            "qmd": norm(q.get("question_markdown", ""))[:150],
            "csource": c.get("source", ""), "ltype": c.get("type", ""),
            "kps": c.get("knowledge_points", []) or [],
            "diff": DIFF.get(c.get("difficulty"), None),
            "method": c.get("method", ""),
        })
        L = luna[-1]
        L["year"], L["exam"] = year_exam(c.get("source", ""))
print("luna questions with classification:", len(luna))

# 2) 读本地题库
local = []
for f in glob.glob(DATA + "/shards/*.json"):
    d = json.load(open(f, encoding="utf-8"))
    qs = d if isinstance(d, list) else d.get("questions", [])
    for q in qs:
        local.append(q)
print("local questions:", len(local))

# 3) 建索引：本地题按 (year, exam) 桶 + 线代桶
by_ye = collections.defaultdict(list)
lalg = []
for q in local:
    src = str(q.get("source") or "")
    y, ex = year_exam(src)
    stem = norm(q.get("stem"))[:150]
    item = (q["id"], stem, src)
    if y:
        by_ye[(y, ex)].append(item)
    if "线性代数" in str(q.get("category_path") or ""):
        lalg.append(item)

ann_path = DATA + "/annotations.json"
A = json.load(open(ann_path, encoding="utf-8"))
ann = A["annotations"]

# 4) 匹配
matched, unmatched = 0, 0
for L in luna:
    cands = []
    if L["year"]:
        cands += by_ye.get((L["year"], L["exam"]), [])
        for e2 in ("数一", "数二", "数三"):
            if e2 != L["exam"]:
                cands += by_ye.get((L["year"], e2), [])
    cands += lalg
    best, best_r = None, 0.0
    seen = set()
    for qid, stem, src in cands:
        if qid in seen:
            continue
        seen.add(qid)
        if not stem:
            continue
        r = difflib.SequenceMatcher(None, L["qmd"][:90], stem[:90]).ratio()
        if r > best_r:
            best, best_r = qid, r
    if best and best_r >= 0.55:
        a = ann.setdefault(str(best), {})
        a["luna_type"] = L["ltype"]
        a["kps"] = sorted(set((a.get("kps") or []) + L["kps"])) or L["kps"]
        if L["diff"]:
            a["difficulty"] = L["diff"]
        a["luna_id"] = L["id"]
        a["luna_chapter"] = L["chapter"]
        matched += 1
    else:
        unmatched += 1
print("matched:", matched, "unmatched:", unmatched)

# 5) 分面计数（全库）
facets = []
def facet(name, keyfn):
    c = collections.Counter()
    for v in ann.values():
        for o in keyfn(v):
            if o:
                c[o] += 1
    facets.append({"dim": name, "options": [{"name": k, "count": n} for k, n in c.most_common()]})

facet("快捷入口", lambda v: [v.get("src")] if v.get("src") in ("真题", "880题", "660题") else [])
facet("题源", lambda v: [v.get("src")])
facet("章节", lambda v: [v.get("chapter")] if v.get("chapter") else [])
facet("知识点", lambda v: v.get("kps") or [])
facet("题型", lambda v: [v.get("luna_type")] if v.get("luna_type") else ([v.get("type")] if v.get("type") else []))
facet("解题方法", lambda v: v.get("methods") or [])
facet("考试类别", lambda v: ["数学一"] if v.get("exam") == "数一" else ["数学二"] if v.get("exam") == "数二" else ["数学三"] if v.get("exam") == "数三" else [])
facet("题目形式", lambda v: [v.get("format")] if v.get("format") else [])
facet("难度", lambda v: [v.get("difficulty")] if v.get("difficulty") else [])
A["facets"] = facets
A["luna_matched"] = matched

json.dump(A, io.open(ann_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("facets written")
for f in facets:
    print(f["dim"], "->", [(o["name"], o["count"]) for o in f["options"][:6]])
