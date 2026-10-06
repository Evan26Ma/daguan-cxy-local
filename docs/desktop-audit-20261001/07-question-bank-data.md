# 07 · 题库数据 / 分片清单 / 数据加工工具 只读审计

- 审计对象：`F:\AI\大观园本地`（正本 checkout，分支 `main`，HEAD `126266d`，package `daguan-math-local` v1.0.10）
- 审计性质：**只读**。未修改/删除/移动任何仓库源码或数据文件；未执行 `git reset/clean/stash`；未推送部署；未运行会写数据的 `npm run sync:data`。
- 临时分析脚本：`C:\Users\14666\AppData\Local\Temp\dg-audit-07\`（`stats.mjs`、`drill.mjs`、`drill2.mjs`、`drill3.mjs`），均不落仓库。
- 审计时间：2026-10-01

---

## 0. 结论摘要

**一句话：主库（manifest 声明的 6 分片 / 6521 题）结构完整、字段齐全、题号唯一、索引自洽，`npm run verify` 通过；真正的问题集中在「verify 覆盖不到的地方」——1 个孤立分片、25 道绕过校验的空选项选择题、41 张缺失题图，以及 4 个硬编码指向另一棵陈旧 checkout 的 Python 加工工具。**

关键统计数字（全部实测）：

| 指标 | 数值 |
|---|---|
| manifest 声明分片数 / 磁盘实际 `.json` 分片数 | 6 / **7**（多 1 个孤立分片） |
| manifest.total | 6521（与 6 分片实际题数之和一致） |
| 含孤立分片全库题数 | 6529 |
| 重复题号 | **0 组**（6529 题号全唯一） |
| 字段缺失（id/stem/options/answer/explanation/type/category_id） | **全 0** |
| 空 explanation / 空 answer | 0 / 0 |
| 选择题总数 | 1852（single_choice 1848 + multiple_choice 4） |
| **选项数为 0 的选择题** | **25**（全在 `概率统计`，全为 single_choice） |
| 答案标签与 `correct_labels` 不一致 | 0 |
| 答案标签超出选项范围 | 0 |
| LaTeX `$` / `$$` 未闭合 | **0 / 0** |
| 题目引用的题图 hash | 1242 |
| **引用但磁盘缺失的题图** | **41 个 hash / 43 处引用 / 42 道题** |
| 磁盘题图 png | 1297 个 / 264.22 MiB |
| **磁盘存在但无任何题引用** | **96 个 / 21.15 MiB** |
| 分类树节点 / category_questions 键 | 1085 / 1077 |
| `categories.json` 的 `question_count` 与 `category_questions` 不一致节点 | **0** |
| 题号不在分类树中 | **8**（全部来自孤立分片） |
| `orphan`（未分类）分类题数 | **0**（官网 492 个孤儿已全部归类） |
| annotations 条目 / 陈旧题号 / 无标注题 | 6183 / **363** / **701** |
| 分片总体积 / 最大分片 | 7.41 MiB / `高等数学.json` 3.61 MiB |
| 首屏整包拉取的大文件 | `search_index.json` **2.25 MiB** |

**P0/P1 一览：**

- **P0-1 25 道选择题选项为空、无法作答**（`web/data/shards/概率统计.json`，根因 `web/data/local_question_banks/mzlj-probability.json` + `shared/local-question-banks.mjs` 校验缺口）——用户能看到题干和答案，但**渲染不出任何可点选项**，其中 2 题还是多选答案却标成单选。
- **P1-1 孤立分片 `高等数学-核心.json`**（8 题）游离于 manifest / id_index / search_index / category_questions 之外，其分类根「高等数学-核心」不是真实顶层分类——8 题在应用内不可见、不可搜索，且 `verify` 永远查不出来。
- **P1-2 41 张题图缺失**，42 道题显示破图；`verify` 只 `warn` 不 fail，所以会长期存在。
- **P1-3 4 个 Python 加工工具硬编码 `F:/ai/daguan-cxy-local/web/data`**（陈旧树，6342 题 vs 正本 6521 题），现在运行会静默读写错误的那棵树。

---

## 1. 发现清单

### P0-1 · 25 道选择题选项为空，用户无法作答

**严重度：** P0
**位置：** `web/data/shards/概率统计.json`（题号 99000003–99000159 中 25 题）；根因文件 `web/data/local_question_banks/mzlj-probability.json`

**证据：**

选择题选项数量分布（全库 1852 题实测）：

```
{ 0: 25, 4: 1827 }
```

这 25 题全部满足：`type === "single_choice"`、`options.length === 0`、无 `correct_labels`、`answer` 是人类可读散文而非标签串。实测 `answer` 样本：

```
99000003  answer: "选 C。"
99000017  answer: "选 B、F。"            ← 多选答案，题型却是 single_choice
99000020  answer: "选 C、F、G、H。"       ← 多选答案，题型却是 single_choice
某题      answer: "选 A（$0<p\le\dfrac{1}{2}$）。"
```

选项文本被内嵌在 `stem` 里（形如 `A. ... B. ...`），而不是放进结构化的 `options` 数组。

**前端渲染后果（已核对源码）：** `web/app2.js:2694`

```js
const options = Array.isArray(q.options) && q.options.length ? document.createElement("div") : null;
```

`options` 为空数组 → 判定为 `null` → **整个选项容器不渲染**（`app2.js:2803` 只在 `options` 非空时挂载）。`web/app2.js:2952` 的 `const labels = (q.correct_labels || []).map(...)` 同样得到空数组，答对判定失效；`web/app2.js:5579` 的 `els.qOptions.children[i]`（键盘 1-4 / A-D 快捷键）也没有任何子元素。

**影响：** 概率统计分片内 25 道题（占全库 0.38%）用户看得到题干与答案，但**点不了任何选项、无法通过选选项作答或自评**；其中 `99000017`、`99000020` 答案是双选/四选，即便前端能渲染也会因 `single_choice` 判错。

**根因（不是同步工具改坏的）：** `web/data/local_question_banks/mzlj-probability.json` 本身就是坏数据——该文件 159 题 **options 全部为空**，`type` 分布 `{subjective: 134, single_choice: 25}`，`correct_labels` 非空 0 题，31 题 `answer` 以「选」开头；文件元信息 `parentCategoryId: 601`、`rootCategory: {id: 9900001, name: "没咋了概率论讲义题库"}`、6 个 chapters（id 9900002–9900007）、`metadata.source = "概率救命课（答案版）"`、`mappedTimestamps: 155`、`unmappedQuestionIds: ["rescue-ch4-ex4","rescue-ch4-ex22","rescue-ch4-ex23","rescue-ch4-ex24"]`。分片只是**忠实复制**了本地题库的错误。

而合并路径上存在**校验不对称**：

- 官网题走严格校验 —— `local-server/official-question-bank.mjs:140-142`：
  ```js
  if (type !== "subjective" && (!correctLabels.length || correctLabels.length !== correctIds.length)) {
    throw new Error(`选择题 ${source.id} 的正确选项与选项列表不匹配`);
  }
  ```
- 本地 overlay 合并时**只查题号重复，完全不校验题型/选项/答案形状** —— `shared/local-question-banks.mjs:94-116`，直接 `shard.push(question)`（`:100`）。

于是这 25 题绕过了官网题同款的校验闸门进入正式分片。

**复现：**
```powershell
cd "F:\AI\大观园本地"
node -e "const q=JSON.parse(require('fs').readFileSync('web/data/shards/概率统计.json','utf8')).filter(x=>x.type!=='subjective'&&(!x.options||!x.options.length));console.log(q.length);console.log(q.map(x=>[x.id,x.answer]).slice(0,5))"
```
输出 `25` 及上述答案样本。

**修复建议：**
1. 治本：在 `shared/local-question-banks.mjs` 合并循环内加与 `official-question-bank.mjs:140-142` 同款的形状校验（选择题必须有 `options`，且 `correct_labels` 长度与内容对得上），不合规直接抛错中止同步 —— 与既有的「部分合并即抛错」风格一致。
2. 治数据：修正 `mzlj-probability.json`，把这 25 题的选项从 stem 拆到 `options` 数组、补 `correct_labels`，并把 `99000017`/`99000020` 的 `type` 改为 `multiple_choice`；在修好之前，考虑把无法解析的题降级为 `subjective` 以免前端渲染成不可答的选择题。
3. 治工具：让 `tools/verify-web-data.mjs` 把「选择题 options 为空」作为 fail（现在完全不检查，见 P2-1）。

**验证方式：** 重跑上面的 `node -e` 应得 `0`；`npm run verify` 应新增该断言并通过。

---

### P1-1 · 孤立分片 `高等数学-核心.json`：8 题完全游离于索引体系之外

**严重度：** P1
**位置：** `web/data/shards/高等数学-核心.json`（4084 bytes / 8 题）

**证据：**

manifest 只声明 6 个分片，磁盘上有 7 个 `.json`：

```
manifest 声明: 历年真题 未分类 概率统计 模拟哥专区 线性代数 高等数学
磁盘实际  : 历年真题 未分类 概率统计 模拟哥专区 线性代数 高等数学-核心 高等数学
```

`高等数学-核心.json` 的 8 个题号 `7137, 7138, 7140, 7141, 7142, 7143, 7157, 7199`：

- 与正式库题号 **0 冲突**（不是重复数据）；
- **不在 `id_index.json`**（实测「库有索引无」= 8，恰好就是这 8 题）；
- **不在 `search_index.json`**（6521 条 vs 全库 6529 题）；
- **不在 `category_questions.json`**（该文件 1077 键、36103 条引用，全库 6521 题全覆盖，不含这 8 题）；
- `category_id` 不在分类树中：`7157 -> 964`，`7137/7138/7140/7141/7142/7143 -> 961`，`7199 -> 976`，它们的 `category_path` 根是「**高等数学-核心**」，而 `categories.json` 的真实顶层只有 `223 高等数学`、`1 线性代数`、`601 概率统计`、`836 历年真题`、`2500 模拟卷`、`orphan 未分类` 六个。

**为什么 `verify` 查不出来：** `tools/verify-web-data.mjs:43` 是 `for (const meta of Object.values(manifest.shards || {}))` —— **只遍历 manifest 声明的分片**，磁盘上多出来的分片永远不会被读到。

**为什么不会被自动清理：** `local-server/official-question-bank.mjs:9-16` 的 `shardByRoot` / `fileByShard` 只覆盖 6 个分片名，同步流程既不会覆盖也不会删除这个文件。

**为什么不是偶发：** 陈旧 checkout `F:\ai\daguan-cxy-local\web\data\shards\` 里**同样存在** `高等数学-核心.json`（两树的 shards 文件名列表完全一致）→ 这是长期遗留物，已跨多次同步存活。

**影响：** 8 道题在应用内不可见、不可搜索、无法通过分类进入；`id_index`/`search_index`/`category_questions` 与磁盘实际内容存在永久性 8 题缺口；一旦有人误按「磁盘即真相」重建索引，会引入一批分类树里不存在的幽灵分类。

**复现：**
```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('web/data/manifest.json','utf8'));const disk=fs.readdirSync('web/data/shards').filter(f=>f.endsWith('.json'));console.log('declared',Object.values(m.shards).map(s=>s.file.split('/').pop()).sort());console.log('disk',disk.sort())"
```

**修复建议：** 二选一，不要保持现状。
- **删除**（推荐）：该分片 8 题与正式库无冲突但也无引用，且分类根不合法；删除前先确认这 8 题在官网题库中是否已有正式归属，若有则直接删文件。
- **纳管**：若这 8 题有独立价值，则把「高等数学-核心」注册进 `categories.json` 顶层、在 `manifest.shards` 里声明、并让它走正常索引构建。

同时把 `tools/verify-web-data.mjs` 改为**扫描 `shards/` 目录**并与 `manifest.shards` 双向对账（现在只单向，见 P2-1）。

**验证方式：** 修复后 `declared` 与 `disk` 两个列表应完全相同。

---

### P1-2 · 41 张题图缺失，42 道题显示破图

**严重度：** P1
**位置：** `web/data/assets/` 与各分片的 `assets/<sha256>` 引用

**证据：** `npm run verify` 输出：

```
题库验证通过：6521 题，6521 个唯一题号
警告：缺少 41 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐
```

实测 41 个缺失 hash、43 处引用、**42 道不同题**（`11229@模拟哥专区` 引用 2 个缺失图；`d10c2dad…` 与 `11fd9746…` 各被 2 道题共用）。分片分布：

| 分片 | 受影响题数 | 题号 |
|---|---|---|
| 高等数学 | 26 | 1643, 1716, 1806, 1807, 1817, 1818, 1819, 1977, 2392, 2411, 2416, 2431, 2434, 2954, 2966, 3000, 4692, 7298, 7706, 7740, 7741, 7744, 10662, 10671, 10825, 11319 |
| 历年真题 | 11 | 940, 1735, 4685, 6091, 7743, 7918, 8340, 8365, 10670, 10904, 10940 |
| 模拟哥专区 | 3 | 11229（2 张）, 11244, 11564 |
| 线性代数 | 2 | 954, 955 |

缺失 hash 样本：`0720b78ea277cad5b08185a878d14efcfc52e9ec66f6a2defab8c8fcb1955595`、`f9b0e0d5e8cbacaeb5adf2dd4b8399c65ee7e3c5a678780fb0b6454e19f14704`、`f8f941ce978ef6a64bf3fd76a60dab42e82becc1c26ebc805fbed0325fe5ca3e`、`590e57c23de2482c6c3d81e6db8e7898615a9dd4055778e64628fd8dfc76e5fa`、`6b7ac97deed31143ed1644e7190e46045e93633ad92110de602b424cfe429f02`。

引用形式为 markdown 图片，实测样本（`高等数学.json` 内）：

```
![抛物线分割区域示意图](assets/0b56a8ce…)
```

**影响：** 42 道题（含 26 道高等数学核心题）在应用里显示破图。这些题多为依赖图形的几何/积分题，缺图即失去可解性。

**为什么长期存在：** `tools/verify-web-data.mjs:82-86` 对缺失题图**只 `console.warn`，不 `throw`、不设退出码**；`downloadAssets`（`local-server/official-question-bank.mjs:232-267`）需要 `DAGUAN_ASSET_TOKEN`，没有 token 时直接返回缺失数而不失败 → 同步被判定为「成功」。

**复现：**
```powershell
cd "F:\AI\大观园本地"
node tools/verify-web-data.mjs
```

**修复建议：**
1. 在 CI/发布脚本里把「缺图数 > 0」升级为失败（`verify-web-data.mjs` 加 `--strict` 或环境变量开关），避免缺图悄悄发布。
2. 用 `DAGUAN_ASSET_TOKEN` 跑一次 `npm run sync:data` 补齐这 41 张（这是设计好的补图路径）。
3. 若官网已下架这些图，给前端加缺图占位（`onerror` 回退），至少不让用户看到破图。

**验证方式：** 重跑 `node tools/verify-web-data.mjs` 应不再出现「缺少 41 张题图」警告。

---

### P1-3 · 4 个 Python 加工工具硬编码指向另一棵陈旧 checkout

**严重度：** P1（高误操作风险）
**位置：** `tools/annotate_questions.py:6-7`、`tools/merge_agent_tags.py:5,10`、`tools/prep_chunks.py:5-6`、`tools/merge_luna_tags.py:6,7`

**证据：** 这 4 个脚本都硬编码了 `F:/ai/daguan-cxy-local/web/data`（注意是小写 `ai`，且是**另一个** checkout 目录名），而不是当前正本 `F:\AI\大观园本地`。

实测该路径**真实存在**，且是一棵**过时快照**：

| 项 | 正本 `F:\AI\大观园本地` | 硬编码的 `F:\ai\daguan-cxy-local` |
|---|---|---|
| `manifest.total` | **6521** | **6342** |
| `manifest.synced_at` | 2026-09-30T00:50:01.853Z | 2026-09-21T08:54:18.761Z |
| shards 文件名列表 | 含 `高等数学-核心.json` | 同样含（7 个，列表一致） |
| `annotations.json` | 1727026 bytes，sha256 前 16 位 `00a5131480041448` | **完全相同** |

`tools/merge_luna_tags.py:6` 还额外硬编码了临时目录 `LUNA = r"C:/Users/14666/AppData/Local/Temp/luna-bank/answers/linear-algebra-7/chapters"`（临时目录随时会被清理，不可复现）。

**影响：** 现在任何人跑 `python tools/merge_agent_tags.py` / `annotate_questions.py` / `prep_chunks.py` / `merge_luna_tags.py`，都会**静默读写另一棵 6342 题的旧树**——既不报错，也不提示，结果对当前正本完全无效；更糟的是若把这些脚本当作「重新生成标注」的工具，会把基于旧题集的产物写回旧树而让人误以为正本已更新。`annotations.json` 两树相同只是巧合（该文件在 2026-09-21 后未再生成），不能当作安全依据。

**复现：**
```powershell
cd "F:\AI\大观园本地"
Select-String -Path tools\*.py -Pattern "daguan-cxy-local"
node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('F:/ai/daguan-cxy-local/web/data/manifest.json','utf8')).total)"
```

**修复建议：** 把硬编码根路径改为「命令行参数 + 环境变量 + 默认当前仓库」三级回退，例如：

```python
BASE = os.environ.get("DAGUAN_WEB_DATA") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data")
```

并在脚本启动时打印解析出的绝对路径，避免再次静默指向错树。`merge_luna_tags.py` 的 `LUNA` 同理改成参数。

**验证方式：** 修复后 `Select-String -Path tools\*.py -Pattern "daguan-cxy-local"` 应无输出；脚本启动日志打印的路径应为 `F:\AI\大观园本地\web\data`。

---

### P2-1 · `tools/verify-web-data.mjs` 覆盖不足，是多个问题长期存活的根因

**严重度：** P2
**位置：** `tools/verify-web-data.mjs`（86 行）

**证据：** 该脚本只做 7 件事：必需文件存在（`:11-33`，14 个）、katex 字体存在（`:34-37`）、**遍历 `manifest.shards`** 校验 count 与题号唯一（`:43-58`）、总数一致（`:59-61`）、3 个 html 无外部资源（`:62-72`）、10 个 js/css 无外部 URL（`:73-80`）、缺图 warn（`:82-86`）。

它**完全不校验**：

- 孤立分片（`:43` 只遍历 manifest → 见 P1-1）
- `id_index.json` / `search_index.json` / `categories.json` / `category_questions.json` / `annotations.json` 与实际题库的一致性
- 选择题的 `options` / `correct_labels` 形状（→ 见 P0-1）
- LaTeX 定界符闭合
- 空分片（如 `未分类.json`）
- `manifest.asset_count` 的语义

**影响：** P0-1 与 P1-1 都能长期通过 `npm run verify`，因为校验范围恰好绕开了它们。这是「测试绿灯但数据有洞」的典型结构性缺口。

**修复建议：** 增加 4 类断言（按性价比排序）：
1. **磁盘 `shards/` 目录 ↔ `manifest.shards` 双向对账**（一条命令即可消灭 P1-1 类问题）。
2. **选择题形状校验**：`type !== "subjective"` 时必须有非空 `options`，且 `correct_labels` 非空、长度与 `answer` 语义一致（消灭 P0-1 类问题）。
3. **索引一致性**：`id_index`/`search_index` 的键集合 == 分片题号集合；`categories.json` 每个节点 `question_count` == `category_questions[节点 id]` 长度；`category_questions` 引用的题号必须存在。
4. **缺图 fail**（可用 `--strict` 开关，见 P1-2）。

**验证方式：** 新增断言后，把 P1-1 的孤立分片放回目录、把 P0-1 的坏数据放回分片，`npm run verify` 应报错。

---

### P2-2 · 跨分片逐字重复题（专题分片与历年真题重叠）

**严重度：** P2
**位置：** `web/data/shards/高等数学.json`、`web/data/shards/线性代数.json` ↔ `web/data/shards/历年真题.json`

**证据：** 按「题干归一化后完全相同」得 6 组 15 题；但按「**stem + options 联合完全相同**」严格口径只有 **2 组 4 题**，且都是跨分片：

- `4217@高等数学`（`source=2006数二`, `serial=3041`, `category=高等数学/极限/…/已知高阶`）↔ `10876@历年真题`（`source=2006数二（15）`, `serial=5691`, `category=历年真题/数二/2006`）——**题干逐字相同**，`answer` / `explanation` 措辞不同。
- `736@线性代数`（`source=2021数二三`, `serial=557`）↔ `8473@历年真题`（`source=2021数二三（二22、三21）`, `serial=4953`）——**题干逐字相同**，`answer` / `explanation` 不同。

另有「去标点后题干相同」的 4 题：`3961@高等数学` ↔ `3960@历年真题`、`723@线性代数` ↔ `721@历年真题`。

规模信号：**非真题分片中 `source` 形如「年份+数X」的题有 930 题** → 专题分片与历年真题分片存在系统性重叠。

**假阳性说明（避免误判）：** `8708/8731/8754` 三题题干都是通用的「下列命题中正确的是（ ）。」，`8718/8743/8744/8752` 四题都是「下列结论中正确的是（ ）。」，但**选项各不相同** → 不是重复题。`1239/1241` 同为「下列反常积分中,发散的是()」但选项不同 → 不是重复题。

**影响：** 同一道题在「专题练习」和「历年真题」两个入口各出现一次，题号不同（`4217` vs `10876`）导致掌握状态、收藏、错题本**各记一份**——用户在专题里做对了，去真题里仍显示未做。这不是数据损坏，但会造成学习统计失真；且该重叠**未在任何文档中说明**，看起来是设计使然而非有意为之。

**复现：**
```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('web/data/manifest.json','utf8'));const by={};for(const[n,s]of Object.entries(m.shards))for(const q of JSON.parse(fs.readFileSync('web/data/'+s.file,'utf8'))){const k=(q.stem||'').replace(/\s+/g,'')+'|'+JSON.stringify((q.options||[]).map(o=>o.content_md));if(by[k])console.log('DUP',by[k][0],by[k][1],'<->',q.id,n);else by[k]=[q.id,n]}"
```

**修复建议：** 先决策再动手——
- 若重叠是**有意**的：在 `manifest.json` 或文档中显式标注「专题分片与真题分片存在重叠题」，并考虑让掌握状态按「题干指纹」而非题号聚合，避免重复统计。
- 若重叠是**无意**的：建立题号别名映射（`4217 ↔ 10876`），在专题分片里改为引用真题题号，或直接在专题分片剔除这 2 组。

**验证方式：** 上面的脚本输出为空（无 DUP 行）即为修复。

---

### P2-3 · `shared/local-question-banks.mjs` 合并中途崩溃会留下不一致数据

**严重度：** P2
**位置：** `shared/local-question-banks.mjs:94-137`

**证据：** 合并循环内 per-question 写入分片文件 —— `:100` `shard.push(question)`，随后 `:125` `writeJson(shardPath, shard)` **在循环内执行**；而 `categories` / `category_questions` / `id_index` / `search_index` / `manifest` 的写入在循环**之后**的 `Promise.all`（`:129-137`）。若进程在循环中崩溃（或 `:117-122` 的章节数量对账 `throw`），磁盘上会留下「**分片已写入新题、索引尚未更新**」的状态。

该模块已有部分保护：`:57-61` 检测「只合并了一部分」并抛 `本地题库 ${file} 只合并了一部分（${present.length}/${ids.length}），已停止以避免重复计数`；`:99` 校验题号不得已存在；`:70,72` 校验 overlay 分类 ID 未被占用；`:97` 校验每题 `category_id` 属于 overlay 的 chapters。但这些都是**基于索引状态的前置校验**，无法修复「分片已落盘而索引未落盘」的半截状态。

**影响：** 崩溃后重跑，`present.length === ids.length` 会因分片已有全部题号而**跳过合并**（`:57`），但 `id_index` 等索引永远缺这批题 → 题目在分片里存在却搜不到、分类里进不去，且重跑不会自愈。

**修复建议：** 改为「先写临时目录、全部文件写完后原子替换」（`question-bank-updater.mjs:65-72` 已有可复用的原子 rename 模式），或至少把分片写入也移到 `Promise.all` 里与其他索引一起提交。

**验证方式：** 在 `:100` 后注入 `throw`，检查目标目录是否仍为合并前的完整状态。

---

### P2-4 · `npm run sync:data` 直接逐文件写 `web/data`，非原子、无备份

**严重度：** P2
**位置：** `tools/sync-official-web-data.mjs`（557 bytes）→ `local-server/official-question-bank.mjs:314-319`

**证据：** `syncOfficialQuestionBank` 在临时目录 `daguan-official-sync-*` 内构建完成后，**逐文件 `fs.copyFile` 到 `targetDir`**（`:314-319`，顺序：分片 → categories → category_questions → id_index → search_index → manifest 最后）。而桌面自动更新路径是**原子的**：`question-bank-updater.mjs` 走 `stage-<uuid>` → `fs.rename(stage, versionsDir/id)` 原子目录改名，pointer 用 `current.json.tmp-<id>` + rename 原子写（`:65-72`），并有 `validVersion` 校验（`:19-29`，校验 `manifest.total` 与所有 `REQUIRED_FILES`/分片存在）与 `bundledFingerprint`（`:36-49`）。

`tools/sync-web-data.mjs`（149 bytes）只是 `await import("./sync-official-web-data.mjs")` 的转发壳。

**影响：** 开发机跑 `npm run sync:data` 时若中途失败/断电，`web/data` 会处于新旧混合状态（例如分片已是新的、`manifest.json` 还是旧的），而 manifest 是最后写的、恰好是应用启动读的第一个文件——不一致组合可能让应用加载失败。桌面版用户不受影响（走原子路径）。

**修复建议：** 让 `sync-official-web-data.mjs` 复用 `question-bank-updater.mjs` 的原子提交，或写入前先备份 `web/data` 到 `web/data.bak-<timestamp>`。

**验证方式：** 中断一次同步，检查 `web/data` 是否仍为同步前的自洽状态。

---

### P2-5 · 本地 overlay 题引用的图片永远不会被同步下载

**严重度：** P2（当前未触发）
**位置：** `local-server/official-question-bank.mjs:289-320`

**证据：** `syncOfficialQuestionBank` 先调 `buildCatalog(snapshot)` 拿到 `result.hashes`（**在合并本地题库之前**），随后才 `mergeLocalQuestionBanks(stage, overlayDir)`（`:308`），最后 `downloadAssets(result.hashes, ...)`（`:320`）。`buildCatalog` 的 `asset_count` 来自 `hashes.size`（`:226`），该集合只由官网题构建。

**影响：** 若将来本地题库 overlay 里出现 `assets/<sha256>` 引用，这些图**永远不会被下载**，会直接表现为 P1-2 那样的缺图，且因为不在 `result.hashes` 里，连「缺少 N 张题图」的警告都不会出现。当前 `mzlj-probability.json` 未引用任何图片，所以尚未触发（这也是为什么它没在本次审计中表现为缺图）。

**修复建议：** 把 `buildCatalog` 的调用移到 `mergeLocalQuestionBanks` 之后，或合并后重新扫描分片收集 hash 集合再下载。

**验证方式：** 在 overlay 里加一道引用图片的题，跑同步，检查图是否落盘。

---

### P2-6 · `annotations.json` 存在 363 个陈旧题号，另有 701 题完全无标注

**严重度：** P2
**位置：** `web/data/annotations.json`

**证据：** 顶层键 `["version","generated","note","kps","methods","annotations","facets","luna_matched"]`；`annotations` 条目 **6183**，但全库只有 6521 题（且 6183 里有 **363 个题号在当前题库中不存在**）→ 真正被标注的题 = 5820，**701 题无任何标注**。`facets` 有 9 个维度（快捷入口/题源/章节/知识点/题型/解题方法/考试类别/题目形式/难度），`luna_matched = 660`。

**影响：** 363 个死条目永久占用体积且会让「标注覆盖率」统计虚高；701 题无标注意味着按知识点/方法筛选时这些题会落空。因为标注文件是**只增不减**地累积（加工工具直接覆写、无 prune），死条目会随每次题库更新持续增长。

**复现：**
```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('web/data/manifest.json','utf8'));const ids=new Set();for(const s of Object.values(m.shards))for(const q of JSON.parse(fs.readFileSync('web/data/'+s.file,'utf8')))ids.add(String(q.id));const a=JSON.parse(fs.readFileSync('web/data/annotations.json','utf8'));const k=Object.keys(a.annotations);console.log('条目',k.length,'陈旧',k.filter(i=>!ids.has(i)).length,'无标注',[...ids].filter(i=>!k.includes(i)).length)"
```

**修复建议：** 在标注加工流程末尾加一步 prune（剔除不在当前题库中的题号）并输出覆盖率报告；对 701 无标注题安排补标或明确标注为「无标注」。

**验证方式：** 上面的脚本「陈旧」应输出 `0`。

---

### P2-7 · `tools/merge_luna_tags.py` 用 0.55 阈值的模糊匹配挂标注，且会为不存在的题号创建条目

**严重度：** P2
**位置：** `tools/merge_luna_tags.py:6,7` 及匹配逻辑

**证据：** 该脚本用 `difflib.SequenceMatcher(...).ratio() >= 0.55` 对 **90 字符归一化前缀**做模糊匹配。0.55 是很低的相似度门槛（90 字符里只要有 ~50 字符相同就算命中），存在把标注挂到**错误题目**上的风险。此外 `ann.setdefault(str(best), {})` 会**为不存在的题号创建新条目**——这正是 P2-6 里 363 个陈旧条目的可能来源之一。写入直接覆写 `annotations.json`，**无备份**；重跑时 `luna_id` 的赋值可能改判（非幂等）。

对比：`tools/merge_agent_tags.py` 用 `kps` 的 `sorted(set(...))`（幂等）与 `difficulty` 的 `DIFF={"easy":"基础","medium":"中等","hard":"较难"}` 覆写（幂等），幂等性更好，但它对未匹配的 qid **静默 `continue` 不报告**，同样直接覆写无备份。

**影响：** 标注可能错挂到相近题干的别的题上，且错误不可见（无日志、无覆盖率报告）；重复运行可能得到不同结果，破坏可重复性。

**修复建议：** 提高阈值并加二次确认（题干长度接近 + 选项数一致），对低于高置信阈值的匹配输出人工复核清单而不是静默写入；禁止 `setdefault` 创建新题号；写入前自动备份 `annotations.json`。

**验证方式：** 连跑两次，`annotations.json` 的 sha256 应相同（幂等）；对匹配结果人工抽查若干条。

---

### P3-1 · `未分类.json` 是 3 字节空分片

**严重度：** P3
**位置：** `web/data/shards/未分类.json`（3 bytes，内容 `[]`，0 题）

**证据：** manifest 声明该分片 `count: 0`，与实际一致（所以 verify 通过）。它由 `local-server/official-question-bank.mjs:13-16` 的 `fileByShard` 映射 `未分类→shards/未分类.json` 定义。同时 `categories.json` 的 `orphan 未分类` 节点 `question_count` 与 `category_questions["orphan"]` 均为 **0**，且 `official-orphan-classifications.json` 的 492 条 assignments 已把官网孤儿全部归类（description：仅整理 2026-09-30 核实仍在官网且官网未分类的 492 个题号；官网后来提供的分类优先）。

**影响：** 无功能影响，只是一个恒空文件与一个恒空分类。属于正常的「兜底槽位」，但会在体积/清单统计里制造噪音。

**修复建议：** 保留（作为兜底是合理的），或在文档中说明其为预留槽位，避免后来者误判为数据丢失。

---

### P3-2 · `manifest.asset_count` 语义歧义（1242 是引用数，不是文件数）

**严重度：** P3
**位置：** `web/data/manifest.json` 的 `asset_count: 1242`；计算处 `local-server/official-question-bank.mjs:226`

**证据：** `buildCatalog` 里 `asset_count: hashes.size`（`:226`），而 `hashes` 只收集**官网题引用到的** hash → `asset_count` = 1242。但磁盘 `web/data/assets/` 实际有 **1297** 个 png。差值 = 96 个无引用文件 − 41 个缺失图 + 重叠 = 实际 1242 引用 / 1297 文件。

**影响：** 字段名 `asset_count` 容易被理解为「资源总数」，实际是「被引用的资源数」。任何按此字段做资源完整性判断的代码都会误判（把 1297 个磁盘文件判成「多出 96 个」，或把 41 个缺失判成「已齐全」）。

**修复建议：** 重命名为 `referenced_asset_count`，或同时输出 `asset_file_count` 与 `missing_asset_count` 两个字段。

---

### P3-3 · 96 个无引用题图占 21.15 MiB，同步只增不删

**严重度：** P3
**位置：** `web/data/assets/`（1297 个 png / 264.22 MiB；最大单图 1674.3 KiB，平均 208.6 KiB）

**证据：** 磁盘 1297 个 png 中有 **96 个未被任何题目引用**，合计 **21.15 MiB**。同步流程 `downloadAssets`（`local-server/official-question-bank.mjs:232-267`）只下载不删除，**没有 prune 步骤**。

**影响：** 安装包体积无谓增大 21.15 MiB；题库资源目录随每次同步单调增长（官网删题后其图永不清理）。注意 assets 总量已达 264.22 MiB，是分片数据（7.41 MiB）的 **35 倍**，是安装包体积的主要来源。

**修复建议：** 在同步流程末尾加一步「删除未被任何分片引用的 png」（先扫全部分片收集 hash 集合再对目录做差集），或在打包阶段剔除无引用资源。

**验证方式：** prune 后磁盘 png 数应从 1297 降到 1242 − 41（缺图）= 1201。

---

### P3-4 · `tools/prep_chunks.py` 变量遮蔽 + `tools/merge_agent_tags.py` 静默跳过

**严重度：** P3
**位置：** `tools/prep_chunks.py:5-6` 附近；`tools/merge_agent_tags.py:5,10`

**证据：**
- `tools/prep_chunks.py` 有 `subj = collections = {}` —— 把导入的 `collections` 模块名**重绑定为 dict**。当前该脚本后续未再用 `collections` 模块，所以**当前无害**，但一旦有人在该行之后使用 `collections.OrderedDict` 等就会炸。`CHUNK = 55`。
- `tools/merge_agent_tags.py` 对未匹配的 qid **静默 `continue` 不报告**（无日志、无计数），直接覆写 `annotations.json` 无备份。

**影响：** 埋雷式可维护性问题 + 加工结果不可审计（不知道有多少题被跳过）。

**修复建议：** 重命名局部变量（`collections → collections_map`）；`merge_agent_tags.py` 统计并打印未匹配数量，写入前备份。

---

### P3-5 · `scripts/render_math_diagram.py` 的 `ast.Pow` 未设指数上限

**严重度：** P3（低危 DoS 面）
**位置：** `scripts/render_math_diagram.py` 的 `safe_expression`

**证据：** 该脚本从 stdin 读 JSON spec、向 stdout 输出 SVG，**不写文件**（可安全运行），依赖 **matplotlib（本机 3.11.1 已装）**。已有较严的白名单：禁 `__` / `import` / `lambda` / `;` / `[]` / `{}`，限制 AST 节点类型，表达式 ≤ 160 字符，x 范围宽 ≤ 40，`samples` 限 80..1000，`|y| < 1e5` 否则记 NaN。但白名单**允许 `ast.Pow`**，且对指数大小无上限 —— `2**999999` 这类表达式会先构造超大整数再被 `|y|<1e5` 过滤，中间计算开销不受控。

**影响：** 若该脚本被 AI 服务以用户可控表达式调用，存在构造超长计算的资源消耗面。`|y|<1e5` 的过滤发生在**计算之后**，不能作为防护。

**修复建议：** 对 `Pow` 的指数做静态范围检查（如要求 `|指数| ≤ 100`）或对 `BinOp` 结果设上限并在计算前拒绝。

**验证方式：** 构造 `{"expression":"2**9999999", ...}` 输入，观察是否在返回前出现明显延迟。

---

## 2. 数据质量统计表

### 2.1 分片级

| 分片 | 字节 | 题数 | manifest.count 一致 | 问题 |
|---|---|---|---|---|
| `高等数学.json` | 3,787,634 | 3082 | ✅ | 缺图 26 题；与真题重复 2 组（4217/3961） |
| `历年真题.json` | 1,895,046 | 1776 | ✅ | 缺图 11 题；与专题重复 4 题 |
| `线性代数.json` | 910,284 | 803 | ✅ | 缺图 2 题；与真题重复 2 题（736/723） |
| `模拟哥专区.json` | 818,225 | 544 | ✅ | 缺图 3 题（11229 含 2 张） |
| `概率统计.json` | 358,952 | 316 | ✅ | **25 题空选项（P0-1）**；含本地 overlay 题 |
| `未分类.json` | 3 | 0 | ✅ | 空分片（P3-1） |
| **`高等数学-核心.json`** | 4,084 | 8 | ⚠️ **不在 manifest** | **孤立分片（P1-1）**：不在 id_index/search_index/category_questions，分类根非法 |
| 合计（声明 6 分片） | 7,770,144 | 6521 | ✅ | manifest.total = 6521 ✅ |
| 合计（含孤立分片） | 7,774,228 | 6529 | — | 8 题游离 |

### 2.2 全库校验项

| 校验项 | 结果 |
|---|---|
| 题号唯一性 | ✅ 6529/6529 唯一，0 重复 |
| 字段缺失（id/stem/options/answer/explanation/type/category_id） | ✅ 全 0 |
| 空 answer / 空 explanation | ✅ 0 / 0 |
| `correct_labels` 与 `answer` 不一致 | ✅ 0 |
| 答案标签超出选项范围 | ✅ 0 |
| 同题内选项文本重复 | ✅ 0 |
| `$` 未闭合 / `$$` 未闭合 | ✅ 0 / 0 |
| `\(` 未配对 / `\[` 未配对 | ✅ 0（早期报的 7/44 处为 `\begin{cases}` 的 `\\` 行分隔导致的假阳性） |
| **选择题 options 为空** | ❌ **25 题** |
| **题型错标（多选答案标 single_choice）** | ❌ **2 题**（99000017、99000020） |
| **题图缺失** | ❌ **41 hash / 42 题** |
| `category_id` 不在分类树 | ❌ **8 题**（孤立分片） |
| `categories.question_count` ↔ `category_questions` | ✅ 不一致节点 0 |
| `category_questions` 未知分类键 / 引用不存在题号 | ✅ 0 / 0 |
| `orphan` 未分类题数 | ✅ 0（492 个官网孤儿已全部归类） |
| `annotations` 陈旧题号 | ❌ **363** |
| 无标注题 | ⚠️ **701** |

### 2.3 体积与加载

| 文件/目录 | 体积 | 加载时机 |
|---|---|---|
| `web/data/assets/` | **264.22 MiB**（1297 png） | 按需（`app2.js:4379`） |
| `search_index.json` | **2.25 MiB** | **启动即整包拉取**（`app2.js:3068`） |
| `annotations.json` | 1.69 MiB | 启动后 XHR（`app2.js:1988-1994`，`?v=5` 回退） |
| `shards/` 合计 | 7.41 MiB | **按需懒加载**（`app2.js:1810-1817` + `prefetchCategory` `:1843-1857`） |
| `lecture-video-mappings.json` | 443.9 KiB | 按需（`app2.js:2014`） |
| `category_questions.json` | 188.3 KiB | 启动即拉（`ensureIndexes` `app2.js:1831-1841`） |
| `id_index.json` | 142.5 KiB | 启动即拉（同上） |
| `categories.json` | 110.2 KiB | 启动 |
| `official-orphan-classifications.json` | 66.9 KiB | — |
| `retired-video-mappings.json` | 47.4 KiB | — |
| `paradiyu-linear-video.json` | 15.1 KiB | 按需（`app2.js:2003`） |
| `manifest.json` | 857 B | 启动第一个 |
| `local_question_banks/` | 239.7 KiB | 同步期使用 |

**首屏整包拉取量** ≈ `manifest` + `categories` + `category_questions` + `id_index` + `search_index` ≈ **2.6 MiB**，其中 `search_index.json` 独占 2.25 MiB。该文件 **46.2%（1.04 MiB）是 `stem` 字段**，而 stem 在分片里已有完整副本 → 可观的冗余。

`fetchJSON` 使用 `cache: "force-cache"`（`app2.js:1133`），所以首屏之后有缓存；但首次访问/缓存失效时代价明显。

---

## 3. 已跑命令与输出摘录

### 3.1 `npm run verify`（→ `node tools/verify-web-data.mjs`）

```powershell
cd "F:\AI\大观园本地"
npm run verify
```

输出：

```
题库验证通过：6521 题，6521 个唯一题号
警告：缺少 41 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐
```

（退出码 0 —— 缺图只是 warn，不失败。）

### 3.2 数据相关测试

```powershell
cd "F:\AI\大观园本地"
node --test test/web-sync.test.mjs test/official-orphan-classifications.test.mjs test/question-bank-updater.test.mjs
```

输出（节选）：

```
✔ all 492 reviewed official orphans receive stable local categories without changing their content (7.4779ms)
✔ official categories take priority and future unclassified questions stay unclassified (5.4806ms)
✔ generated catalog indexes every reviewed question without duplicating its ID (79.4739ms)
✔ desktop question bank updates atomically and keeps the last good version offline (3233.8134ms)
✔ 官网掌握状态映射到本地状态 (0.9052ms)
✔ 安全合并不会用官网未开始清除本地标记 (0.805ms)
✔ 本地状态能转换为官网安全同步状态 (0.2193ms)
✔ Android 状态包只提取掌握度和收藏 (0.2356ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ duration_ms 3444.5869
```

### 3.3 git 状态（审计前确认）

```powershell
cd "F:\AI\大观园本地"
git status --short --branch
```

```
## main...origin/main
```

HEAD = `126266d`，工作树**无已跟踪文件被修改**，25 个未跟踪文件（含 `AGENTS.md`、`docs/ui-redesign/*`、`web/ui-preview/`、`web/index-{new,old}-backup.html` 等）。**本次审计未新增/修改/删除任何已跟踪文件**（唯一新增文件即本报告）。

### 3.4 分片对账

```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('web/data/manifest.json','utf8'));const disk=fs.readdirSync('web/data/shards').filter(f=>f.endsWith('.json'));console.log('declared',Object.values(m.shards).map(s=>s.file.split('/').pop()).sort());console.log('disk',disk.sort())"
```

```
declared [ '历年真题.json', '未分类.json', '概率统计.json', '模拟哥专区.json', '线性代数.json', '高等数学.json' ]
disk     [ '历年真题.json', '未分类.json', '概率统计.json', '模拟哥专区.json', '线性代数.json', '高等数学-核心.json', '高等数学.json' ]
```

### 3.5 空选项选择题

```powershell
cd "F:\AI\大观园本地"
node -e "const q=JSON.parse(require('fs').readFileSync('web/data/shards/概率统计.json','utf8')).filter(x=>x.type!=='subjective'&&(!x.options||!x.options.length));console.log('count',q.length);console.log(q.map(x=>x.id+': '+x.answer).slice(0,8).join('\n'))"
```

```
count 25
99000003: 选 C。
99000004: 选 D。
...
99000017: 选 B、F。
...
99000020: 选 C、F、G、H。
```

### 3.6 缺图清单

```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const D='web/data/';const m=JSON.parse(fs.readFileSync(D+'manifest.json','utf8'));const disk=new Set(fs.readdirSync(D+'assets').filter(f=>f.endsWith('.png')).map(f=>f.replace('.png','')));const refs=new Map();for(const[n,meta]of Object.entries(m.shards))for(const q of JSON.parse(fs.readFileSync(D+meta.file,'utf8')))for(const mm of JSON.stringify(q).matchAll(/(?:assets\/|question-assets\/)([0-9a-fA-F]{64})(?:\.png)?/g)){if(!refs.has(mm[1]))refs.set(mm[1],[]);refs.get(mm[1]).push(q.id+'@'+n)}console.log('引用hash',refs.size,'缺失',[...refs.keys()].filter(h=>!disk.has(h)).length,'磁盘png',disk.size,'无引用',[...disk].filter(h=>!refs.has(h)).length)"
```

```
引用hash 1242 缺失 41 磁盘png 1297 无引用 96
```

### 3.7 索引一致性

```powershell
cd "F:\AI\大观园本地"
node -e "const fs=require('fs');const D='web/data/';const cq=JSON.parse(fs.readFileSync(D+'category_questions.json','utf8'));const cat=JSON.parse(fs.readFileSync(D+'categories.json','utf8'));const m=JSON.parse(fs.readFileSync(D+'manifest.json','utf8'));const ids=new Set();for(const s of Object.values(m.shards))for(const q of JSON.parse(fs.readFileSync(D+s.file,'utf8')))ids.add(String(q.id));const idIdx=JSON.parse(fs.readFileSync(D+'id_index.json','utf8'));const si=JSON.parse(fs.readFileSync(D+'search_index.json','utf8'));console.log('题库',ids.size,'id_index',Object.keys(idIdx).length,'search_index',si.length);console.log('category_questions 键',Object.keys(cq).length,'引用总数',Object.values(cq).reduce((a,b)=>a+b.length,0),'orphan',(cq.orphan||[]).length)"
```

```
题库 6521 id_index 6521 search_index 6521
category_questions 键 1077 引用总数 36103 orphan 0
```

### 3.8 陈旧 checkout 确认

```powershell
cd "F:\AI\大观园本地"
Test-Path "F:\ai\daguan-cxy-local\web\data"          # → True
node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('F:/ai/daguan-cxy-local/web/data/manifest.json','utf8')).total)"   # → 6342
```

### 3.9 Python 工具环境

```powershell
python -c "import ast,sys;print(sys.version)"
```

- Python **3.12.8**
- 5 个脚本 `ast.parse` 语法检查**全部 OK**
- 已装：openpyxl、python-pptx、PIL、numpy、pandas、lxml、requests、yaml、**matplotlib 3.11.1**
- **缺失：python-docx**（`docx`）—— 当前 5 个脚本均未 import，无影响

---

## 4. 未能验证事项

| 事项 | 未验证原因 |
|---|---|
| 41 张缺失题图能否补齐 | 需要 `DAGUAN_ASSET_TOKEN` 才能跑 `downloadAssets`；本次审计**禁止写数据**，故未运行 `npm run sync:data`。无法判断是官网已下架还是本地从未下载成功。 |
| 官网题库当前真实状态（题数、分类、`content_hash`） | 需要联网访问 `https://www.cxyonly.fans/math` 并带鉴权；本次只读本地快照，`manifest.source_total = 6362`（vs 本地 6521，差 159 = 本地 overlay 题数）未经远端核实。 |
| `fetchOfficial` 的分页一致性保护在真实网络抖动下是否有效 | 需要构造官网同步期数据变化的场景（`official-question-bank.mjs:32-59` 抛 `官网题库在同步期间变化；未写入本地题库，请重试`）；只读约束下无法触发。 |
| 应用内实际渲染效果（25 道空选项题、42 道缺图题） | 未启动服务（避免触碰真实 `%LOCALAPPDATA%\DaguanMath\data`）。结论基于源码静态分析（`app2.js:2694`、`:2803`、`:2952`、`:5579`），**未做端到端 UI 验证**。 |
| 掌握状态/收藏在重复题（4217↔10876、736↔8473）上是否真的各记一份 | 需要跑应用并操作 UI；只读约束下未验证。按题号索引的设计推断是各记一份，但**未实测**。 |
| `merge_luna_tags.py` 模糊匹配是否已产生错挂标注 | 需要跑脚本（会写 `annotations.json`，且会写向错误的旧树）；禁止写数据。363 个陈旧题号与 0.55 阈值只是**风险信号**，不是错挂的直接证据。 |
| `sync-official-web-data.mjs` 中断后的实际不一致形态 | 需要中断一次同步并观察 `web/data`；禁止写数据。 |
| 桌面自动更新（`question-bank-updater.mjs`）在真实 Squirrel 安装上的行为 | 测试 `desktop question bank updates atomically and keeps the last good version offline` 已通过，但未在真实安装包上端到端验证。 |
| 96 个无引用图片是否为「官网已删题」遗留 | 需要对比历史快照；本次只有一棵当前树 + 一棵 2026-09-21 旧树，无法判断删除时间点。 |

---

## 5. 优化建议（按性价比排序）

1. **给 `verify-web-data.mjs` 加「磁盘分片 ↔ manifest 双向对账」与「选择题 options 非空」两条断言。**
   性价比最高：各约 10 行代码，一次性让 P1-1 与 P0-1 这两类「绿灯下的数据洞」永久无法复现。当前 verify 只遍历 manifest（`:43`），是本报告里多个问题的共同根因。

2. **修掉 25 道空选项选择题（先治数据，再补合并期校验）。**
   这是唯一直接影响用户作答的缺陷。短期手工修 `mzlj-probability.json`（拆选项、补 `correct_labels`、把 `99000017`/`99000020` 改成 `multiple_choice`），长期在 `shared/local-question-banks.mjs` 合并循环里加与 `official-question-bank.mjs:140-142` 同款的形状校验，堵住 overlay 绕过校验的缺口。

3. **把 `tools/*.py` 的硬编码路径改成「参数 / 环境变量 / 仓库相对路径」三级回退，并启动时打印解析结果。**
   4 个脚本现在全部静默指向 6342 题的陈旧树 `F:/ai/daguan-cxy-local`，是当前最容易被误触发的「静默错树」风险；改动小、收益立竿见影。

4. **补齐 41 张缺图，并把「缺图数 > 0」在发布流程中升级为失败。**
   用 `DAGUAN_ASSET_TOKEN` 跑一次同步即可；配套把 `verify-web-data.mjs:82-86` 的 warn 加 `--strict` 开关，避免下次再悄悄发布缺图版本。

5. **`search_index.json` 瘦身 + 首屏加载优化。**
   该文件 2.25 MiB 启动即整包拉取（`app2.js:3068`），其中 1.04 MiB（46.2%）是 `stem` 字段，而 stem 在按需加载的分片里已有完整副本。方案：`search_index` 只保留 `{id, 标题片段}` 或改存分片名+偏移，把完整题干留给分片；或改为首次搜索时才懒加载。可省约 1 MiB 首屏流量。

6. **同步流程加 prune：删无引用题图 + 清 annotations 陈旧题号。**
   一次性回收 21.15 MiB 无引用图片（占 assets 的 8%）并清掉 363 个死标注条目，同时阻止两者继续单调增长。

7. **统一「写 `web/data`」的提交方式为原子提交。**
   让 `sync-official-web-data.mjs` 复用 `question-bank-updater.mjs:65-72` 的原子 rename 模式；顺手修 `shared/local-question-banks.mjs` 里「分片先落盘、索引后落盘」（`:100`/`:125` vs `:129-137`）的顺序问题，消除半截数据状态。

8. **决策重复题的处理方式并写进文档。**
   `4217↔10876`、`736↔8473` 逐字相同，另有 930 道 source 形如「年份+数X」的题暗示专题分片与真题分片系统性重叠。要么显式记录这是设计，要么建立题号别名让掌握状态按题干指纹聚合。

9. **低优先级清理：** `未分类.json` 空分片（P3-1）保留但注明为预留槽位；`manifest.asset_count` 改名或补充 `asset_file_count`/`missing_asset_count`（P3-2）；`prep_chunks.py` 的 `collections` 变量遮蔽改名（P3-4）；`render_math_diagram.py` 给 `ast.Pow` 加指数上限（P3-5）。

---

*本报告由只读审计生成，未对仓库源码或题库数据做任何修改。*
