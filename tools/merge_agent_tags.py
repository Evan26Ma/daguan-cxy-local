# -*- coding: utf-8 -*-
"""把子代理标注结果（out/c*.json）合并进 annotations.json，并重建分面计数。"""
import json, glob, io, collections

DATA = r"F:/ai/daguan-cxy-local/web/data"

A = json.load(io.open(DATA + "/annotations.json", encoding="utf-8"))
ann = A["annotations"]

outs = sorted(glob.glob(r"F:/ai/daguan-cxy-local/tools/tagger-out/out/c*.json"))
print("output files:", len(outs))
merged = 0
diff_counter = collections.Counter()
for f in outs:
    d = json.load(io.open(f, encoding="utf-8"))
    for qid, tag in d.items():
        if qid not in ann:
            continue
        a = ann[qid]
        if tag.get("luna_type"):
            a["luna_type"] = tag["luna_type"].strip()
        if tag.get("kps"):
            a["kps"] = sorted(set((a.get("kps") or []) + tag["kps"]))
        if tag.get("difficulty") in ("easy", "medium", "hard"):
            DIFF = {"easy": "基础", "medium": "中等", "hard": "较难"}
            a["difficulty"] = DIFF[tag["difficulty"]]
        merged += 1
print("merged tags:", merged)
diff_counter.update(v.get("difficulty") for v in ann.values())
print("difficulty now:", dict(diff_counter))

# 重建分面
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

json.dump(A, io.open(DATA + "/annotations.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("facets rebuilt")
for f in facets:
    print(f["dim"], "->", len(f["options"]), "options; top:", [(o["name"], o["count"]) for o in f["options"][:4]])
