#!/usr/bin/env python3
"""把 prob 题库（概率救命课 + 概率统计百宝书）转换成大观园本地题库 overlay。

用法（路径都从命令行给，脚本不硬编码仓库位置；所有路径必须落在 --root 之内）：

    python tools/import-prob-question-bank.py --root F:/AI/tmp/prob-merge-20261010 \
        --questions prob-questions.json \
        --out-overlay baobaoshu-overlay.json \
        --out-fixed mzlj-choices-fixed.json \
        --rescue-overlay <仓库 web/data/local_question_banks/mzlj-probability.json 的副本>

源数据（probability-reader 的 generated/questions.json）是「阅读器」取向：题干内嵌选项、
答案是散文式文本。本工具按大观园官方题目形状归一化：

1. 选择题：按 A.／B、／（C） 标记把选项切进 `options`（跳过 $…$ 数学与反引号代码，
   不把 P(A) 这类写法误判成标记）；answer 改成字母、补 correct_labels；题型按结构判定
   （源 questionType 有漏标，calculation 实际是单选题的情况按结构改判）。
2. 答案括号附注（如 `B（$-2+\\sqrt{10}$）`）移到解析末尾的 `**答案**：…` 行；救命课条目
   插在「视频讲解」链接之前，链接原样保留。
3. 选项尾部的 OCR 遗留（`［图:…］`、\\bullet 阵列、纯 \\dots 噪声）挪回题干末尾，正文不改写。
4. 源文本除上述位移外逐字保留，可用字符多重集回环校验核对。

产出 overlay 通过 `shared/local-question-banks.mjs` 的校验（选择题必须有 options 与
correct_labels），合并时由 `mergeLocalQuestionBanks` 写入分片与索引。
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

# overlay 的分类与题号分配（概率统计分片；与 web/data 现有本地题库段不冲突）
ROOT_CATEGORY_ID = 9900400
ROOT_CATEGORY_NAME = "你的葫芦概率统计百宝书题库"
CHAPTER_BASE_ID = 9900401
QUESTION_BASE_ID = 99004001

BOUNDARY = set(" \n\t。．.：:，,；;）)$")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def find_markers(text):
    """找形如 A. / B、/ （C） 的选项标记，跳过 $...$ 数学与反引号代码。"""
    markers = []
    inline_math = False
    display_math = False
    inline_code = False
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("$$", i):
            display_math = not display_math
            i += 2
            continue
        c = text[i]
        if c == "`" and (i == 0 or text[i - 1] != "\\"):
            inline_code = not inline_code
            i += 1
            continue
        if inline_code:
            i += 1
            continue
        if c == "$" and (i == 0 or text[i - 1] != "\\"):
            if not display_math:
                inline_math = not inline_math
            i += 1
            continue
        if inline_math or display_math:
            i += 1
            continue
        prev = text[i - 1] if i > 0 else ""
        if i == 0 or prev in BOUNDARY:
            m = re.match(r"[（(]([A-H])[）)]", text[i:])
            if m:
                markers.append((i, m.group(1), i + m.end()))
                i += m.end()
                continue
            m = re.match(r"([A-H])\s*[.、．)）]", text[i:])
            if m:
                markers.append((i, m.group(1), i + m.end()))
                i += m.end()
                continue
        i += 1
    return markers


def detect_chain(text):
    """从标记序列里挑最长且严格 A 开头的连续链。"""
    markers = find_markers(text)
    best = None
    for idx, marker in enumerate(markers):
        if marker[1] != "A":
            continue
        chain = [marker]
        j = idx
        expected = "B"
        while expected <= "H":
            nxt = next((k for k in range(j + 1, len(markers)) if markers[k][1] == expected), None)
            if nxt is None:
                break
            chain.append(markers[nxt])
            j = nxt
            expected = chr(ord(expected) + 1)
        if len(chain) >= 3 and (best is None or len(chain) > len(best)):
            best = chain
    return best


def parse_leading_labels(answer_text):
    """取答案开头的选项字母串：'选 C（…）'→['C']，'选 B、F。'→['B','F']，'D（…）'→['D']。"""
    text = str(answer_text or "").strip()
    text = re.sub(r"^选\s*", "", text)
    head = re.split(r"[（(。．\n]", text, maxsplit=1)[0]
    letters = re.findall(r"[A-H]", head)
    # 开头必须整体由字母与分隔符构成，防止「不好意思」这类文本被误读
    if not letters or re.sub(r"[A-H、,，\s.．]", "", head):
        return []
    return letters


def is_artifact(paragraph):
    """判断段落是否为 OCR 遗留物（图片占位、纯符号阵列），而不是选项正文。"""
    p = paragraph.strip()
    if not p:
        return False
    if "［图" in p:
        return True
    if p.startswith("$$") and not CJK_RE.search(p) and "=" not in p and ("\\bullet" in p or "\\dots" in p):
        return True
    return False


def pop_trailing_artifacts(content):
    """把选项结尾的 OCR 遗留段落摘出来，返回 (剩余内容, 遗留段落列表)。"""
    parts = content.split("\n\n")
    artifacts = []
    while len(parts) > 1 and is_artifact(parts[-1]):
        artifacts.insert(0, parts.pop())
    if not "".join(parts).strip():
        return content, []
    return "\n\n".join(parts).strip(), artifacts


def split_choice(question_markdown, answer_markdown):
    """返回 (ok, stem, options, letters, artifacts, why)。失败时 ok=False。"""
    chain = detect_chain(question_markdown)
    if not chain:
        return False, None, None, None, None, "未找到 A 开头的连续选项链"
    letters = parse_leading_labels(answer_markdown)
    if not letters:
        return False, None, None, None, None, "答案里读不出选项字母"
    labels = [c[1] for c in chain]
    if any(letter not in labels for letter in letters):
        return False, None, None, None, None, f"答案字母 {letters} 不在选项 {labels} 内"
    if len(letters) != len(set(letters)):
        return False, None, None, None, None, f"答案字母重复：{letters}"

    start = chain[0][0]
    stem = question_markdown[:start].strip()
    options = []
    for pos, (begin, label, content_start) in enumerate(chain):
        end = chain[pos + 1][0] if pos + 1 < len(chain) else len(question_markdown)
        content = question_markdown[content_start:end].strip()
        if not content:
            return False, None, None, None, None, f"选项 {label} 内容为空"
        options.append(content)
    for pos, content in enumerate(options):
        if find_markers(content):
            return False, None, None, None, None, f"选项 {chain[pos][1]} 内容里还有选项标记"
    if not stem:
        return False, None, None, None, None, "题干为空"
    options[-1], artifacts = pop_trailing_artifacts(options[-1])
    return True, stem, options, letters, artifacts, "OK"


def build_options(pairs):
    return [{"id": f"opt-{label.lower()}", "label": label, "content_md": content}
            for label, content in pairs]


def answer_tail_note(answer_markdown):
    """答案字母后面的括号说明；纯标点视为无。"""
    text = str(answer_markdown or "").strip()
    text = re.sub(r"^选\s*", "", text)
    consumed = re.match(r"^[A-H、,，\s.．]*", text).group(0)
    tail = text[len(consumed):].strip().rstrip("。.．;；,，").strip()
    if not tail or not re.search(r"[\w\u4e00-\u9fff$\\]", tail):
        return ""
    return tail


def insert_answer_note(explanation, note):
    """把答案说明插到解释正文末尾、视频讲解链接之前；重跑时先去掉旧行，保证幂等。"""
    base = re.sub(r"\n\n\*\*答案\*\*：[^\n]*", "", explanation)
    marker = "\n\n视频讲解："
    idx = base.rfind(marker)
    note_text = f"\n\n**答案**：{note}"
    if idx >= 0:
        return base[:idx] + note_text + base[idx:]
    return base + note_text


def split_four_block_options(markdown):
    """特例：选项是四个 $$ 块、只有首块残留「\\text { A. }」标记的题（救命课例 6）。"""
    blocks = re.findall(r"\$\$(.*?)\$\$", markdown, re.S)
    if len(blocks) != 4:
        return None
    stem = markdown[:markdown.index("$$")].strip()
    options = []
    for block in blocks:
        body = re.sub(r"^\\text\s*\{\s*[A-H][.、．]?\s*\}\s*", "", block.strip()).strip()
        options.append(f"$$\n{body}\n$$")
    return stem, options


def build_baobaoshu_overlay(questions, server_ref, imported_at=""):
    bao = [q for q in questions if q["collection"] == "baobaoshu"]
    chapters = []
    seen_ch = {}
    for q in bao:
        ch = q["chapter"]
        if ch not in seen_ch:
            seen_ch[ch] = {"id": CHAPTER_BASE_ID + len(seen_ch), "number": ch,
                           "name": f"第{ch}章 {q['chapterTitle']}", "questionCount": 0}
            chapters.append(seen_ch[ch])
        seen_ch[ch]["questionCount"] += 1

    overlay_questions = []
    stats = {"single_choice": 0, "multiple_choice": 0, "subjective": 0}
    report = []
    moved_artifacts = []
    overrides = []
    for index, q in enumerate(bao):
        qid = QUESTION_BASE_ID + index
        ch = q["chapter"]
        cat = seen_ch[ch]["id"]
        answer_md = q["answerMarkdown"]
        stem = q["questionMarkdown"]
        note = ""
        ok, s, opts, letters, artifacts, why = split_choice(stem, answer_md)
        if ok:
            labels = [c[1] for c in detect_chain(q["questionMarkdown"])]
            stem = s
            options = build_options(list(zip(labels, opts)))
            correct_labels = letters
            vtype = "single_choice" if len(letters) == 1 else "multiple_choice"
            answer = "".join(letters)
            note = answer_tail_note(answer_md)
            if artifacts:
                stem = stem + "\n\n" + "\n\n".join(artifacts)
                moved_artifacts.append(q["id"])
            if q["questionType"] != "choice":
                overrides.append({"id": q["id"], "source_type": q["questionType"], "actual": vtype})
            report.append(f"[{q['id']}] {vtype} {answer} options={labels}")
        else:
            options, correct_labels, vtype, answer = [], [], "subjective", answer_md
            report.append(f"[{q['id']}] subjective ({why})")
        stats[vtype] += 1
        explanation = q["ideaMarkdown"]
        if note:
            explanation = f"{explanation}\n\n**答案**：{note}"
        overlay_questions.append({
            "id": qid,
            "stem": stem,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "source": f"你的葫芦概率统计百宝书 第{ch}章 {q['label']}",
            "type": vtype,
            "is_core": False,
            "category_id": cat,
            "category_ids": [cat],
            "category_path": f"概率统计 / {ROOT_CATEGORY_NAME} / 第{ch}章 {q['chapterTitle']}",
            "serial": q["number"],
            "correct_labels": correct_labels,
        })
    overlay = {
        "id": "mzlj-baobaoshu",
        "parentCategoryId": 601,
        "rootCategory": {"id": ROOT_CATEGORY_ID, "name": ROOT_CATEGORY_NAME},
        "chapters": chapters,
        "questions": overlay_questions,
        "metadata": {
            "source": "概率统计百宝书（2027 考研，作者：你的葫芦）习题答案与思路",
            "origin": "https://prob.kaoyangogogo.fun",
            **({"imported_at": imported_at} if imported_at else {}),
            "server_ref": server_ref,
            "type_counts": stats,
            "artifacts_moved": moved_artifacts,
            "type_overrides": overrides,
        },
    }
    return overlay, report


def build_rescue_fixes(questions, rescue_overlay):
    rescue_by_key = {}
    for q in questions:
        if q["collection"] == "rescue":
            rescue_by_key[(q["chapter"], q["number"])] = q
    fixed = {}
    report = []
    for old in rescue_overlay["questions"]:
        if old["type"] not in ("single_choice", "multiple_choice"):
            continue
        m = re.search(r"第(\d+)章\s*例\s*(\d+)", old["source"])
        if not m:
            continue
        srv_q = rescue_by_key.get((int(m.group(1)), int(m.group(2))))
        if not srv_q:
            continue
        special = split_four_block_options(srv_q["questionMarkdown"]) if srv_q["id"] == "rescue-ch5-ex6" else None
        if special:
            stem, opts = special
            letters = parse_leading_labels(srv_q["answerMarkdown"])
            labels = ["A", "B", "C", "D"]
            artifacts = []
            why = "特例：四块 $$ 选项，仅首块残留 A 标记"
        else:
            ok, stem, opts, letters, artifacts, why = split_choice(srv_q["questionMarkdown"], srv_q["answerMarkdown"])
            labels = [c[1] for c in detect_chain(srv_q["questionMarkdown"])] if ok else []
        if not stem or not opts or not letters:
            report.append(f"[{srv_q['id']}] 保留原样：{why}")
            continue
        vtype = "single_choice" if len(letters) == 1 else "multiple_choice"
        new = dict(old)
        new["stem"] = stem + (("\n\n" + "\n\n".join(artifacts)) if artifacts else "")
        new["options"] = build_options(list(zip(labels, opts)))
        new["answer"] = "".join(letters)
        new["correct_labels"] = letters
        new["type"] = vtype
        tail = answer_tail_note(srv_q["answerMarkdown"])
        if tail:
            new["explanation"] = insert_answer_note(old["explanation"] or "", tail)
        fixed[str(old["id"])] = new
        report.append(f"[{srv_q['id']}] {vtype} {new['answer']} options={labels}")
    return fixed, report


def confine(value, root):
    """规范化路径、拒绝 .. 穿越，并把读写限制在 --root 目录之内。"""
    root_path = Path(root).resolve()
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root_path / candidate
    target = candidate.resolve()
    if root_path != target and root_path not in target.parents:
        raise SystemExit(f"路径超出允许目录 {root_path}：{value}")
    return target


def main():
    parser = argparse.ArgumentParser(description="prob 题库 → 大观园本地题库 overlay")
    parser.add_argument("--root", default=os.getcwd(),
                        help="允许读写的根目录；所有输入输出路径都必须位于其中（默认当前目录）")
    parser.add_argument("--questions", required=True, help="源 questions.json（prob 站点生成数据）")
    parser.add_argument("--out-overlay", required=True, help="百宝书 overlay 输出路径")
    parser.add_argument("--out-fixed", required=True, help="救命课选择题修复输出路径")
    parser.add_argument("--rescue-overlay", required=True,
                        help="仓库现有救命课 overlay（web/data/local_question_banks/mzlj-probability.json）")
    parser.add_argument("--server-ref", default="", help="记录到 metadata 的源版本标识")
    parser.add_argument("--imported-at", default="", help="记录到 metadata 的导入日期（YYYY-MM-DD）")
    parser.add_argument("--report", action="store_true", help="把逐题结论打到 stderr")
    args = parser.parse_args()

    questions_path = confine(args.questions, args.root)
    rescue_path = confine(args.rescue_overlay, args.root)
    overlay_path = confine(args.out_overlay, args.root)
    fixed_path = confine(args.out_fixed, args.root)
    for label, path in (("--questions", questions_path), ("--rescue-overlay", rescue_path)):
        if not path.is_file():
            raise SystemExit(f"{label} 文件不存在：{path}")

    questions = json.loads(questions_path.read_text(encoding="utf-8"))["questions"]
    rescue_overlay = json.loads(rescue_path.read_text(encoding="utf-8"))

    overlay, report_a = build_baobaoshu_overlay(questions, args.server_ref, args.imported_at)
    fixed, report_b = build_rescue_fixes(questions, rescue_overlay)

    overlay_path.write_text(json.dumps(overlay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fixed_path.write_text(json.dumps(fixed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"百宝书 {len(overlay['questions'])} 题：{overlay['metadata']['type_counts']}", file=sys.stderr)
    print(f"救命课选择题修复 {len(fixed)} 题", file=sys.stderr)
    if args.report:
        for line in report_a + report_b:
            print(line, file=sys.stderr)


if __name__ == "__main__":
    main()
