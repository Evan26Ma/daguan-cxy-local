# -*- coding: utf-8 -*-
"""大观园题库全量标注管线：按 luna 筛选维度为每题生成标注数据。
输出 web/data/annotations.json（旁挂文件，不改原始题库分片）。"""
import json, glob, re, collections, io

BASE = r"F:/ai/daguan-cxy-local/web/data"
OUT = r"F:/ai/daguan-cxy-local/web/data/annotations.json"

TYPE_MAP = {"single_choice": "选择题", "multiple_choice": "多选题", "subjective": "解答题"}

# 知识点词典：(知识点名, [关键词...])  关键词在 分类路径+来源+题干前240字 中匹配
KP_DICT = [
    ("数列极限", ["数列极限", "数列", "lim"]), ("函数极限", ["函数极限", "极限存在"]),
    ("洛必达法则", ["洛必达"]), ("等价无穷小", ["等价无穷小", "无穷小"]),
    ("泰勒展开", ["泰勒", "麦克劳林", "皮亚诺"]), ("连续与间断点", ["间断点", "连续性", "可去间断", "跳跃间断"]),
    ("渐近线", ["渐近线"]), ("导数定义", ["导数定义", "按定义", "可导"]),
    ("微分中值定理", ["中值定理", "罗尔", "拉格朗日中值", "柯西中值"]), ("单调性与极值", ["极值", "单调"]),
    ("凹凸性与拐点", ["拐点", "凹凸", "凹的"]), ("不等式证明", ["不等式", "证明不等"]),
    ("方程的根", ["实根", "根的个数", "零点"]), ("不定积分", ["不定积分", "原函数"]),
    ("定积分计算", ["定积分", "积分值"]), ("变限积分", ["变限", "变上限", "积分上限"]),
    ("反常积分", ["反常积分", "广义积分", "瑕积分"]), ("积分不等式", ["积分不等式"]),
    ("面积与旋转体", ["旋转体", "面积", "弧长", "体积"]), ("定积分定义", ["定积分定义", "和式"]),
    ("偏导数", ["偏导"]), ("全微分", ["全微分"]), ("多元极值", ["极值点", "条件极值", "拉格朗日乘数"]),
    ("隐函数求导", ["隐函数"]), ("方向导数与梯度", ["方向导数", "梯度"]), ("二重积分", ["二重积分"]),
    ("交换积分次序", ["交换积分次序", "积分次序"]), ("极坐标积分", ["极坐标"]),
    ("一阶微分方程", ["一阶", "可分离变量", "齐次方程", "一阶线性"]), ("二阶常系数方程", ["二阶", "特征方程", "常系数"]),
    ("差分方程", ["差分"]), ("正项级数", ["正项级数", "比较判别", "比值判别"]), ("交错级数", ["交错级数", "莱布尼茨"]),
    ("幂级数", ["幂级数", "收敛半径", "收敛域"]), ("傅里叶级数", ["傅里叶"]), ("数项级数", ["级数的和", "条件收敛", "绝对收敛"]),
    ("行列式", ["行列式"]), ("矩阵运算", ["矩阵", "伴随", "转置"]), ("逆矩阵", ["可逆", "逆矩阵"]),
    ("矩阵的秩", ["秩"]), ("初等变换", ["初等变换", "初等行变换"]), ("分块矩阵", ["分块"]),
    ("线性方程组", ["线性方程组", "方程组的解", "通解", "基础解系"]), ("线性相关性", ["线性相关", "线性无关"]),
    ("极大无关组", ["极大线性无关", "极大无关"]), ("特征值与特征向量", ["特征值", "特征向量"]),
    ("相似对角化", ["相似", "对角化"]), ("二次型", ["二次型"]), ("正定性", ["正定"]),
    ("向量空间", ["基", "过渡矩阵", "坐标"]),
    ("古典概型", ["古典概型", "排列组合", "任意取出", "随机地取"]), ("几何概型", ["几何概型"]),
    ("条件概率", ["条件概率", "在…条件下", "已知…则"]), ("全概率与贝叶斯", ["全概率", "贝叶斯"]),
    ("事件独立性", ["独立", "相互独立"]), ("分布函数", ["分布函数", "分布律"]),
    ("概率密度", ["概率密度", "密度函数"]), ("常见分布", ["正态分布", "泊松分布", "二项分布", "均匀分布", "指数分布", "超几何"]),
    ("随机变量函数的分布", ["函数的分布", "Y="]), ("期望与方差", ["期望", "方差", "E(", "D("]),
    ("协方差与相关", ["协方差", "相关系数"]), ("大数定律", ["大数定律", "切比雪夫", "辛钦"]),
    ("中心极限定理", ["中心极限"]), ("矩估计", ["矩估计"]), ("最大似然估计", ["最大似然", "似然函数"]),
    ("无偏性", ["无偏"]), ("假设检验", ["假设检验", "显著性"]),
]
# 解题方法词典：(方法名, [关键词...])  在 答案+解析 文本中匹配
METHOD_DICT = [
    ("洛必达法则", ["洛必达"]), ("等价无穷小替换", ["等价无穷小"]), ("泰勒展开", ["泰勒", "麦克劳林"]),
    ("夹逼准则", ["夹逼", "两边夹"]), ("定义法", ["按定义", "用定义", "定义可知"]),
    ("换元法", ["换元", "令 u", "令t", "令 t", "令x", "令 x"]), ("分部积分", ["分部积分"]),
    ("凑微分", ["凑微分"]), ("有理化", ["有理化", "分子有理"]), ("递推法", ["递推"]),
    ("数学归纳法", ["归纳法"]), ("极坐标法", ["极坐标"]), ("对称性", ["对称性", "轮换对称"]),
    ("待定系数法", ["待定系数"]), ("特征方程法", ["特征方程", "特征根"]), ("常数变易法", ["常数变易"]),
    ("初等变换法", ["初等行变换", "初等变换"]), ("克莱姆法则", ["克莱姆", "克拉默"]), ("正交变换法", ["正交变换", "正交矩阵"]),
    ("配方法", ["配方"]), ("构造辅助函数", ["构造", "辅助函数", "设 F", "作函数"]), ("中值定理法", ["罗尔定理", "拉格朗日中值", "柯西中值", "积分中值"]),
    ("单调有界原理", ["单调有界"]), ("反证法", ["反证", "假设不成立"]), ("分类讨论", ["当…时", "分情况", "讨论"]),
]


def build_kp_texts(q):
    path = str(q.get("category_path") or "")
    src = str(q.get("source") or "")
    stem = re.sub(r"\s+", "", str(q.get("stem") or ""))[:240]
    return path + " " + src + " " + stem


def main():
    ann = {}
    kp_counter = collections.Counter()
    method_counter = collections.Counter()
    for f in glob.glob(BASE + "/shards/*.json"):
        d = json.load(open(f, encoding="utf-8"))
        qs = d if isinstance(d, list) else d.get("questions", [])
        for q in qs:
            qid = str(q.get("id"))
            source = str(q.get("source") or "")
            path = str(q.get("category_path") or "")
            parts = [p.strip() for p in path.split("/")] if path else []
            qtype = TYPE_MAP.get(q.get("type"), "解答题")
            # 题目形式：选择题类按题型；主观题里含填空样式判为填空题
            stem = str(q.get("stem") or "")
            if q.get("type") in ("single_choice", "multiple_choice"):
                fmt = qtype
            elif re.search(r"_{2,}|\\underline|\\hspace|填空", stem[:200]):
                fmt = "填空题"
            else:
                fmt = "解答题"
            exam = None
            for pat, name in ((r"数学一|数一", "数一"), (r"数学二|数二", "数二"), (r"数学三|数三", "数三")):
                if re.search(pat, source):
                    exam = name
                    break
            y = re.search(r"(19|20)\d{2}", source)
            year = int(y.group(0)) if y else None
            if "880" in source:
                src = "880题"
            elif "660" in source:
                src = "660题"
            elif "模拟" in source or "模拟" in path:
                src = "模拟卷"
            elif "真题" in path or (exam and re.search(r"(19|20)\d{2}", source)):
                src = "真题"
            else:
                src = "讲义习题"
            # 知识点
            kp_text = build_kp_texts(q)
            kps = [name for name, kws in KP_DICT if any(k in kp_text for k in kws)]
            # 解题方法：扫答案+解析
            sol_text = re.sub(r"\s+", "", str(q.get("answer") or "") + str(q.get("explanation") or ""))[:800]
            methods = [name for name, kws in METHOD_DICT if any(k.replace(" ", "") in sol_text for k in kws)]
            # 难度（启发式估计）
            score = 0
            if src == "真题":
                score += 1
            if fmt in ("解答题", "多选题"):
                score += 1
            if len(stem) > 160:
                score += 1
            if len(str(q.get("explanation") or "")) > 400:
                score += 1
            if len(methods) >= 2:
                score += 1
            difficulty = "基础" if score <= 1 else ("中等" if score <= 3 else "较难")
            ann[qid] = {
                "exam": exam, "year": year, "src": src, "type": qtype, "format": fmt,
                "chapter": parts[0] if parts else None,
                "section": " / ".join(parts[1:3]) if len(parts) > 1 else None,
                "kps": kps, "methods": methods, "difficulty": difficulty,
            }
            kp_counter.update(kps)
            method_counter.update(methods)
    out = {
        "version": 1,
        "generated": "2026-09-19",
        "note": "启发式标注：题源/类别/年份/题型来自字段解析；知识点/解题方法来自关键词词典；难度为估计值",
        "kps": [k for k, _ in kp_counter.most_common()],
        "methods": [k for k, _ in method_counter.most_common()],
        "annotations": ann,
    }
    with io.open(OUT, "w", encoding="utf-8") as w:
        json.dump(out, w, ensure_ascii=False, separators=(",", ":"))
    print("annotated:", len(ann), "| kps:", len(kp_counter), "| methods:", len(method_counter))
    print("difficulty:", collections.Counter(v["difficulty"] for v in ann.values()))
    print("src:", collections.Counter(v["src"] for v in ann.values()))


if __name__ == "__main__":
    main()
