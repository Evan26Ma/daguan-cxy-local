# MinerU 原生答案与解析替换：暂停交接

记录日期：2026-10-05（香港时间）。本文由当前主智能体 Codex 亲自编写，未调用子智能体撰写。

## 最新用户指令与交接边界

用户原话：**“你先停一下 写个交接文档 交接文档不要用子智能体写，里面也写上不要调用zcode 换成调用子智能体，”**。

当前任务已经暂停。接手者先阅读本文；用户明确要求继续后，再恢复实施。

**后续不要调用 ZCode，改用 Codex 原生子智能体承担有界实施、题目匹配和独立复核，主智能体负责规划、回收、审查、最终抽查及验收。** 这一最新用户指令覆盖项目 `AGENTS.md`、`.codex/ZCODE_DELEGATION.md` 中要求开发任务交给 ZCode 的工作流。不要启动 ZCode 客户端、bundled headless CLI、pool、supervisor，也不要为了复用旧脚本而间接启动 ZCode。旧 ZCode 产物可以作为历史证据读取，但旧 worker 成功不等于验收通过。

本次暂停仅核对状态、补记已完成导入的台账并编写本文，没有开展新批次导入，也没有派发新任务。2026-10-05 17:42 核查时，本次已知控制器 PID 均不存在，未发现运行中的 ZCode CLI 或已知调度脚本，因此无需结束进程。旧 pool 的部分 `state.json` 仍写着 `running`，这是遗留状态，不表示后台仍在施工；不要据此自动恢复调度。

## 要完成的事情

九份 PDF 已经过 MinerU 原生 HTML 转换。用其中可靠匹配的原生答案及解析，替换大观园本地题库的答案及解析。用户最终明确选择 **只换答案和解析**。

- 保留题干、选项、题号、顺序、分类、来源和判分字段；保留收藏、学习记录及用户数据。
- 手写或 OCR 不可靠的答案与解析，使用原 PDF 的真实图片；包含全部小问、方法和跨页续解，排除相邻题目。
- 图片需要离线可读、可点击放大。不要生成替代图片，不要自行解题补写缺失数学，不要用猜测消除识别歧义。
- 同一题库仍可能有版本、数字、符号、选项顺序差异。来源题号相同仅是候选证据，须核对具体题目。
- 所有施工、脚本、缓存、备份、测试与大文件均放 F 盘。先读 `F:\AI\AGENTS.md`，设置 `TEMP`、`TMP` 为 `F:\AI\tmp`。本次交接没有在 C 盘创建临时产物。
- 测试使用 F 盘隔离数据目录和浏览器 profile，真实 `%LOCALAPPDATA%\DaguanMath\data` 不参与读取、覆盖或清理；服务实例锁不得手工删除。
- 当前成果位于源代码工作区。未进行安装、推送、打包或发布，不能声称已安装应用已更新。

## 当前已核实的结果

| 项目 | 暂停时的实际结果 |
| --- | --- |
| 题库题目总数 | 6,889 |
| 原生答案/解析 overlay 条目 | **3,220** |
| 旧 overlay 条目基数 | 1,050 |
| 本轮累计新增 overlay 条目 | 2,170 |
| 台账记录的原题图片替换 | **506** |
| 尚无 overlay 的题目 | 3,669，保留既有内容 |
| 最后一批 | 文本 batch003，56 题，已正式完成导入 |
| 保护检查 | 题目身份、选项、来源、分类、判分保持；索引字节一致；未访问真实用户数据 |

最后导入 run：`F:\AI\tmp\daguan-zcode-pool\20261005-090151-b3720b0b`。其 `state.json` 为 `complete` / `accepted_by_codex_after_tests`，`final-tests.json` 的退出码为 0。暂停时另核对了批准 proposal 中全部 **5 个输出文件**：当前生产文件与 proposal 的内容字节完全一致。

刚暂停时已执行的导入已将生产数据写到 3,220，而 `applied-redo-decisions.json` 仍记为 3,164。当前主智能体根据成功验收和实际文件完成台账补记，现二者均为 **3,220**。这次补记没有再次执行导入。

状态证据：

- `F:\AI\tmp\daguan-native-rematch-20261004\user-pause-process-receipt-20261005.json`
- `F:\AI\tmp\daguan-native-rematch-20261004\user-pause-import-reconciliation-20261005.json`
- `F:\AI\tmp\daguan-native-rematch-20261004\applied-redo-decisions-before-pause-reconcile-20261005.json`：补记前台账备份。

`3,220` 是 overlay 总条数，不代表九份 PDF 的全部题目已验收，也不是全部题干完成重写。

## 工作目录与关键文件

为缩短以下路径说明，本文定义：

| 名称 | 绝对目录与用途 |
| --- | --- |
| REPO | `F:\AI\大观园本地`，当前生产源代码工作区 |
| B | `F:\AI\tmp\daguan-native-rematch-20261004`，匹配、审查、导入与截图证据 |
| S | `F:\AI\tmp\daguan-native-rematch-20261004\source`，私有辅助实现与候选数据 |
| P | `F:\AI\tmp\daguan-zcode-pool`，历史隔离 worker 结果，只读复用 |
| OLD | `F:\AI\tmp\daguan-native-solutions-20261004`，导入前基线与历史备份 |
| HTML | `F:\AI\mineru-html-20261004`，九份 PDF 对应的 19 份 MinerU HTML，累计 2,840 页 |

原 PDF 均在 `F:\Download`：`1.函数极限连续.pdf`、`2.一元微分.pdf`、`3.1积分计算（核心题库）.pdf`、`3.2积分应用（核心题库）.pdf`、`3.3反常积分.pdf`、`4.微分方程.pdf`、`5.多元微分.pdf`、`6.二重积分.pdf`、`7.线代(1).pdf`。

当前事实来源优先级：实际生产文件及其校验 → 已应用台账 → 对应批次验收证据。旧报告、候选 proposal、worker 输出不应单独当作生产状态。

- `REPO\web\data\native-solutions.json`：实际 overlay。
- `REPO\web\data\shards\`：题库分片。
- `B\applied-redo-decisions.json`：已应用台账，当前 3,220。
- `B\final-import-decisions.json`、`B\final-import-manifest.json`：最后批次结果。
- `REPO\reports\native-rematch-proposal-20261004.json`：最后已批准并应用的完整文件内容。
- `B\verify_import.mjs`：对照基线、台账与生产数据的 6,889 题保护校验。执行前检查它读取的 final decisions 与实际批次一致。
- `OLD\before-import\`：恢复旧内容的正确基线；不能用 Git HEAD 覆盖本轮开始前已有内容。
- `REPO\shared\native-solutions.mjs`、`REPO\web\safe-render.js`、新旧 app 文件：原生内容读取和渲染实现。改前端先读 `REPO\docs\frontend-modules.md`。

暂停时分支为 `main`，落后 `origin/main` 两个提交，工作区已有大量修改及未跟踪文件。不要 reset、clean 或整体覆盖。接手先运行 `git status --short --branch` 并阅读 `PROJECT_RULES.md`；不要把所有当前改动归为本任务。

## 最后一批文本：已验收，勿重复导入

batch003 最初展示 63 个候选；主智能体逐一查看截图，保留 56 个。最终 56 张截图的 SHA 与已检查候选的对应截图完全一致，最终渲染 QA 为 689 个 MathML、3 张图片、0 个错误。

证据：`B\incremental-text-batch-qa-004`、`B\incremental-batch003-root-content-approval.json`。冻结文本快照 006 另有 28 个任务、106 条记录；它已通过历史产物复核，但尚未纳入下一轮增量配置，接手时不要重复计入旧快照。

需要保持暂缓的题号：**2212、2220、2171、2225、2440、7782、10844、7983**。原因与原图候选见 `B\extra-image-source-proposals.json`，以及 `B\incremental-import-config-next.json`、`B\text-import-config-next.json` 中的持久暂缓项。

其中 2220 的答案字符串以 `- $...$` 开头，Markdown 可能将数学负号当成列表标记。原证明 HTML 中负号存在，短答案显示异常；应核对原图或处理渲染问题，不能改写数学猜答案。其余暂缓项涉及手写 Taylor 余项、缺少解释、Hessian/小 o、偏导与弧长导数撇号、反函数定义域或已标记 OCR 歧义。

曾怀疑 2232 的答案及 2755 的近远距离反转。主智能体重新核对字面 proposal 和新渲染，确认 **2232 为 B，2755 最短为 √21/6、最长为 √21/2**，当前批次内容正确；不要把旧截图疑点当成已经确认的应用缺陷。证据在 `B\incremental-text-batch-answer-diagnostic\page-qa.json`。

## 待恢复的图片批次与新候选

**图片 batch7 尚未组装、未最终验收、未导入。** `B\curated-original-images-batch7.json` 有 82 个候选，`B\image-batch7-readable-review.json` 列出对应理由、图像与工作区。接手者先让子智能体逐题做视觉复核，再由主智能体生成并抽查最终页面，不能直接把“curated”当作最终批准。

目前已完成但仍待主智能体回收的历史批次：

| P 下的 run | 暂停时状态 | 用途 |
| --- | --- | --- |
| `20261005-085958-c7e9cda9` | 2 个 awaiting_review、1 个 failed | cohort20：上述 8 个高风险文本题的原图复核 |
| `20261005-090244-dbe31965` | 4 个 awaiting_review | cohort21：12 个受污染标题候选的原图复核 |
| `20261005-090348-b508a1a5` | 1 个 awaiting_review | cohort22：题号 273 的原图复核 |
| `20261005-051340-ac8b9a1f` | 147 个 awaiting_review、12 个 failed、198 个 queued | 历史混合 Global 批次 |
| `20261005-043859-8ef09e6a` | 77 个 awaiting_review、11 个 failed、12 个 queued | 历史原图 100 任务批次 |
| `20261005-055012-909741ab` | 66 个 awaiting_review、54 个 queued | 历史 CN 原图 120 任务批次 |

这些计数是任务状态，不是已验收题数；最新完成产物可能尚未进入旧 audit。仅保留证据和读取结果，不再恢复上述 ZCode 队列。cohort22 已有 `B\image-audit-20261005-090348-b508a1a5.json`，仍不等于生产批准。

文本最后一次完整审查汇总为 2,548 条已审、1,842 approve、685 reject、21 needs review、590 pending、69 个限定 OCR 风险。此汇总早于最新遗留 worker 完成时间，不能用来代替恢复时的新清点。冻结快照 001—006 对应证据为 `B\frozen-text-review-snapshot-NNN.json`；不要把混合原 run 和冻结子集重复计算。

## PDF 标题定位修复与候选边界

已验收辅助实现：`S\merge_preserved_pdf_anchors.py` 及其测试。它保留既有可靠标题的页码和坐标，只在前后有效锚点间补入新标题，遇到重复、顺序冲突、PDF 哈希变化或缺失时保持不确定。24 个相关测试已通过。修复的六个偏移来源对应题号 571、661、3863、4011、5623、5649，已经在图片 batch6 导入。

后续新增四个**仅供诊断**的原图窗口，已写入 `B\all-promoted-image-proposals.json`，尚不能自动批准：

| 文档与 source 指针 | 原 PDF 定位 | 关联题目 |
| --- | --- | --- |
| `7.线代(1)` / 1788 | 第 119 页，约 y=73.83，标题尾部“25版880矩阵基础填空3” | 134、228、229、580、581、598、847、906、5618 |
| `3.3反常积分` / 309 | 第 24 页，约 y=79.73，“26版660数一二三第207题” | 2161 |
| `1.函数极限连续` / 3821 | 第 331 页，约 y=81.07，“2015数三;880基础解答4” | 3954、10953 |
| `7.线代(1)` / 2259 | 第 153 页，约 y=392.48，HTML“线岱杨”与 PDF“线帒杨”字形差异 | 273 |

以上页码沿用诊断报告显示口径；裁图前核对 PyMuPDF 的 0 起始页索引。来源字段、原 PDF SHA 和区间边界已保留；窗口状态仍为需视觉确认、diagnostic only。参见 `B\literal-gap-heading-root-diagnostic.json`、`B\literal-gap-diagnostic-activation.json`。前一个题组多个候选来自同一矩阵题，可能多数匹配错误，必须逐题拒绝不符数字或条件的候选。

`S\supplemental-gap-candidates.json` 中其他较宽候选仍可能只是章节标题，例如“未给出表达式”“n阶偏导”“复杂区域”。应该检索具体子题，不能把整段章节内容当作某题解答。顶层章节指针导致的低质量匹配，是此前“理论上同题库却匹配不到”的重要原因之一。

## 已知暂缓与验收要求

- **8148**：原资料有特征值符号和对角阵错误，即使最终数字碰巧一致也不应导入。原图 SHA 的暂缓规则已持久保存；不能再次接受同一坏来源。证据 `B\image-batch5-codex-source-defect.json`。
- **11417**：题库使用 x→1、f(x+1)、分母 x²；找到的 PDF 变体为 x→2、f(x+2)、分母 1−cos x，答案和选项不同。保留旧内容，找正确变体；检索证据 `B\11417-literal-variant-search.json`。
- **6421**：旧 worker 声称看图，但缺少真实图像读取附件证据。需要子智能体重新打开实际图片核对。
- **955**：因缺少题库题干图片，曾撤销不可靠覆盖，按 `OLD\before-import\线性代数.json` 恢复。不要按 HEAD 恢复。证据 `B\q955-root-rollback-missing-bank-image.json`。
- 1977、4692、2431、7744、8365、1806、1716 等仅图片题干的候选缺少可核实题干资源时，不得凭来源标签放行。

每个批准项必须有明确题号、题库身份、来源文档/页码/指针及文件哈希，解释为什么数字、正负号、导数阶数、条件、小问及选项一致；记录全部采用图片的顺序与相邻题排除结果。图片来自真实 PDF xref 或精确裁剪，跨页续解完整。子智能体必须实际打开图片，不能只读文件名或依赖上一位 worker 的断言。

历史 `B\audit_image_reviews.py`、`B\audit_review_artifacts.py`、`S\assemble_import_incremental.mjs` 等实现依赖旧 run、formal review 和模型数据库证据。使用前阅读其约束；可以保留有价值的哈希、字面内容、范围保护检查，但应由主智能体或有界子智能体建立原生子智能体的审查记录。**不要伪造 ZCode run、数据库模型证明或成功状态来满足旧接口。**

## 用户继续后的执行顺序

1. 核对实际生产数与台账都是 3,220、保护基线仍可用，核对 Git 状态和本文件的暂停证据；不要启动遗留 ZCode 控制器。
2. 为原生子智能体创建 F 盘独立工作目录与任务文件。每个子任务限定题号和可写路径，说明共享工作区中还有其他人，不能回滚其他修改；将题库、原 PDF/HTML 和图像证据路径直接提供给它。
3. 优先复核 batch7 的 82 个候选及 cohort20—22 已有结果。将互不冲突的题号组并行分给子智能体实施，另由独立子智能体复核；主智能体回收候选及证据，保留拒绝/暂缓原因。
4. 一次只形成一个明确增量 proposal，保留当前生产快照和回滚信息；每个候选通过身份与来源审查后才可入列。缺少正确变体时扩大具体子题检索，不重复接受宽章节匹配。
5. 主智能体审查所有差异，按每章及风险抽查渲染页面，特别检查手写、跨页、导数撇号、负号、多个方法、答案与解析一致。通过后机械应用已批准内容，执行保护校验，再同步已应用台账。没有完成这一步的内容始终标为待审。
6. 完成用户目标前，核对新版、旧版、导出、离线图片放大、数学渲染及学习记录保护，输出剩余题号和原因。安装、发布或更新已安装应用要按用户后续授权处理，源码验收不能代替安装验收。

交接完成的标准：已应用内容与待审内容可明确区分，正确基线与证据可找到，接手者使用原生子智能体即可继续，不需要启动 ZCode。

## 验证证据与尚未完成的检查

最后导入的保护校验已通过，详见成功 run 的 `final-tests.json`：6,889 题、3,220 原生解析、678 条 answer 字段变更、3,669 条未匹配记录保持；题目身份/选项/来源/分类/判分保持，索引字节一致。

本轮此前执行的原生解析相关 9 个测试已通过：`test/native-solutions.test.mjs`、`test/native-solutions-overlay.test.mjs`、`test/native-legacy-solutions.test.mjs`。图片 batch6 的页面 QA 为 21 张卡片、24 张图片、离线放大通过、0 个渲染错误。

更早完整测试记录为 308 通过、2 个失败；失败涉及既有 7947 retired-v2 与讲解映射 6826/6876。题庫 verify 的 42 个缺失题干资源警告也是已有记录。它们不是本次暂停后重新跑出的结果，恢复后应结合实际工作区重新核实，不能宣称全量测试全绿。

当前没有完成对所有剩余候选的审查，也没有完成最终整库抽查与安装验证。已有 credential homes、模型数据库及日志包含敏感信息，保留在 F 盘私有目录供必要审计；交接文件、任务包和公开产物中不得粘贴 API key、token、cookie 或原始敏感日志。
