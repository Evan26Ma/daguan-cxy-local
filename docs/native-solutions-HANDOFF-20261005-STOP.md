# 原生题解交接：用户叫停时的状态

> 用户最新指令：**「别做了，写个交接文档」**。施工已停止。本文不是继续执行、导入、发布或启动子代理的授权。下一位只有在用户重新要求继续后，才执行下面的接手步骤。
>
> **生产题库零导入。54 条提案仍在私有目录；没有生成父级内容批准文件，也没有运行 apply。**

## 1. 先读这些，避免误接

- 原始任务与历史交接：`docs/native-solutions-HANDOFF-20261005.md`。
- 本文是原交接之后的续接增量；冲突时以本文描述的停止状态及对应实际文件为准。
- 项目：`F:/AI/大观园本地`，本轮已知分支 `main`，HEAD `3d407d593e29a0637fcf658416257e90e85eef9d`，大量既有脏改动。
- 私有根目录，以下称 **R**：`F:/AI/tmp/daguan-native-pi-resume-20261005`。
- 历史私有目录：`F:/AI/tmp/daguan-native-rematch-20261004`。
- 当前内容契约：`shared/native-solutions.mjs`。
- 全局和项目规则：`F:/AI/AGENTS.md`、项目 `AGENTS.md`、`PROJECT_RULES.md`、`docs/frontend-modules.md`。

**接手先核对当前 Git 状态和文件哈希，不要清理、reset 或覆盖既有改动。** 本轮没有安装、打包、推送或发布。

## 2. 任务目标与硬边界

从九份 MinerU PDF 转换资料，可靠替换题库的答案与解析，保留原 PDF 手写图，并在新旧界面离线查看原图。

- 保留题干、选项、题号和顺序、分类、来源、判分、收藏与学习记录。
- 字面题目身份、全套小问与解法、续页顺序和邻题边界必须成立；编号相同或数学等价不足以批准。
- 原图直接用来源图。不得自解题、猜 OCR、补造数学或制造替代题解图。
- **当前用户要求最高思考，不可降档**。新审查使用 native `kaoyangogogo/cn:deepseek-v4.1-flash:max`。
- 历史已完整的 high 证据诚实保留 high，不能改标签冒充 max；新复核继续 max。
- 仅 native 子代理。旧 ZCode/pool 目录只作为静态历史证据，不能启动其控制器、CLI 或旧任务。
- `TEMP=TMP=F:/AI/tmp`；脚本、profile、缓存和快照均留 F 盘。Python JSON 显式 UTF-8。
- 不访问真实 `%LOCALAPPDATA%/DaguanMath/data`，不手动删除服务锁。
- 子代理完成、双审一致、dry verify 或浏览器 QA **均不等于父级导入批准**。

## 3. 生产与提案状态

| 项目 | 当前状态 |
|---|---|
| 题库问题数 | 6,889 |
| 生产 overlays | 3,220，仍为接手基线 |
| 本轮生产导入 | **0** |
| batch7 复核覆盖 | 82 first + 82 independent，覆盖/来源审计无遗漏 |
| batch7 私有提案 | 54 新 ID / 54 图片替换；投影 overlays 3,274 |
| batch7 原图数 | 75 张所选解析图 |
| batch7 暂缓 | 28 条；含 19 条历史声明绑定不完整，不能补造 |
| 父级逐图查看 | 6/54 已记录部分检查，48 条来源图尚未查看 |
| 父级最终批准 | **不存在** |
| text006 | 52 候选/18 包/129 张来源图，当前 native 双审尚未完成 |
| special cohorts | 21 候选/7 包/46 张来源图，当前 native 双审尚未完成 |

私有提案：

```text
R/flash-wave/native-image-proposal.json
R/flash-wave/proposal-evidence.json
R/flash-wave/proposal-ledger.json
```

当前提案 SHA-256：

```text
061d1219698629e69abb2833d47b51d735cd0d4b1fbeb91e2b41d04c04d434b6
```

最后一次实际字节比较确认 production overlay 与全部 shards 仍等于 `R/before/` 快照；后续只改了私有 QA/检查记录。接手仍应重验。

**不要创建 `R/flash-wave/parent-content-approval.json` 来绕过尚未完成的验收。** `apply-native-pi-proposal.mjs` 本轮仅修改/语法审查，未执行。

## 4. 已完成的工具与安全闸门

### 4.1 真实 native 收据与机械组装

```text
R/native-review-evidence.mjs             nativeEvidence()
R/collect-batch7-native-reviews.mjs
R/native-merge-bindings.mjs              assertNativeMergeBinding()
R/assemble-native-batch7-v2.mjs
R/native-compact-review.mjs              expandCompact()
R/native-image-proposal.mjs              parseReview()/validateReview()/buildProposal()
R/verify-native-pi-import.mjs            默认 dry；--production 仅导入后
```

- 检查实际 receipt、输出、provider/model、thinking、session、图片附件 read、最终 stop、包与图片哈希。
- compact 报告支持精确六键 named checks 和旧六位数组，缺失/多余/类型异常均 fail closed。
- 机械展开必须标明复制引用字段，保留原生 checks/verdict/图片选择，不补造历史声明。
- 重新展开原始报告，与 regrouped 决策逐项比较；要求独立角色与选择图集合一致。
- Collector 有意限定明确的批准 receipt key 与 latest successful run；独立审查留下两项 P2（不是遍历所有 continuation/所有未知 key），没有取消父级闸门。

证据入口：

```text
R/max-wave/batch7-complete-review-evidence.json
R/max-wave/full-native-evidence-audit.json
R/max-wave/manifest-v2.json
R/max-wave/batch7-integration-recheck.json
```

**旧 `assemble-native-pi-proposal.mjs` 和旧 `max-native-wave.js` 是历史路径，不作为当前生产组装入口。**

### 4.2 写入事务

```text
R/native-file-transaction.mjs             runFileTransaction()
R/native-file-transaction.test.mjs
R/apply-native-pi-proposal.mjs
```

已实现/故障注入验证：独占 `wx` 临时文件、文件 fsync/close、原子 rename、rollback temp+rename、回滚失败继续其他文件、二次 divergence 检查保留第三方修改、验证之后记 ledger、失败 receipt 异常不掩盖主错误、外来 temp 不删除。

唯一 ledger 目标：

```text
F:/AI/tmp/daguan-native-rematch-20261004/applied-redo-decisions.json
```

保留 P2：没有父目录 fsync/跨文件断电 ACID 保证；没有单独 preflight-abort receipt。不得宣传整批断电原子性。

## 5. 本轮 UI 修复与验收

### 5.1 旧版离线原图放大：已修复

生产代码改动位于：

```text
web/app-legacy.js
web/legacy.css
web/legacy.html
web/app-new.js
web/index.html
web/service-worker.js
```

测试：

```text
test/native-legacy-solutions.test.mjs
test/ui-contract.test.mjs
```

旧版新增 `prepareNativeImageZoom()` / `openNativeImageZoom()`：

- 单题解析与动态列表卡片给原图键盘可达属性。
- 事件委托支持点击、Enter、Space。
- dialog 用 `currentSrc || src`，按自然尺寸显示、可滚动，Escape/关闭返回源图焦点。
- dialog 局部 keydown `stopPropagation`，不 `preventDefault`，隔离后台学习快捷键。
- 打印不显示 zoom dialog；主题使用现有 CSS tokens。

旧版真实导航回归走可见 **章节选择器 → 分支/叶节点 → 加载小节 → 单题按钮 → 实际前后题按钮（需要时）→ 显示答案 → 离线放大**；不注入 queue。旧 sidebar `#search` 实际已隐藏，不能强制填它冒充真实用户路径。

### 5.2 新版图片弹窗键盘隔离：已修复

父级红回归实际复现：图片 dialog 打开时按 `/`，后台 `AppState.currentView` 从 home 变成 global-search。

修复：`App.openImageZoom()` 的 dialog 局部 keydown `stopPropagation`，保留浏览器原生 Escape/Tab/按钮默认动作；已打开时不重复 `showModal()`。

焦点恢复本轮实际测试已通过浏览器原生行为，没有另加未必要的 workaround。

最终引用版本：

```text
legacy.css?v=96
app-legacy.js?v=116
app-new.js?v=147
service-worker.js?v=157
CACHE = daguan-shell-v157
```

接手如改任何脚本/样式，继续同步页面引用、SW 清单和缓存版本。

### 5.3 浏览器 QA 的真实范围

`R/qa-native-pi-proposal.mjs` 只在隔离静态 server + F 盘 persistent profile 中运行，屏蔽外网和 service worker，模拟 API，不接真实 service/userdata。

最终实际跑通：

- 54 条提案、75 张解析原图，新旧界面每张图都能离线打开。
- src、自然宽高、实际显示宽度一致；新界面导出/旧界面打印保留图集合与 caption。
- 每图验证 ArrowLeft/Right/Up/Down，不改变后台 index；新版另验证 `/` 不打开后台搜索。
- Escape 与焦点返回，每题首图 Enter/Space + 关闭按钮。
- 新版键盘测试背景是 `App.openLibraryQuestion()` 实际 DataService 加载的 single/question 视图。
- 每条候选的新 UI 内容仍用 renderer fixture，旧 UI 的逐条内容仍用测试 hook 注入 queue；只有另一个 legacy 导航用例是无 queue 注入的真实章节路径。**不能说 54 条都走了真实导航。**
- 页面 JS errors 为 0。

最终 QA 文件：

```text
R/flash-wave/render-qa/page-qa.json
R/max-wave/proposal-browser-qa-clean-sse.log
R/max-wave/proposal-browser-qa-question-view.log
R/max-wave/new-zoom-global-search-red.log
R/max-wave/new-zoom-global-search-green.log
```

### 5.4 最后发现并修复的夹具遮挡

父级看截图时发现 legacy 的“本地服务连接中断”浮条遮挡手写解析。问题来自 QA 人为 abort EventSource，不是来源图被裁坏。

私有 QA 夹具已改为健康、只读的 `text/event-stream` mock；离线恢复后等待 `#local-service-status` 隐藏再继续。没有修改生产告警，也没有以 CSS 隐藏告警冒充通过。

最后重跑 `proposal-browser-qa-clean-sse.log` 返回 0，重新生成截图。父级已重新查看 `legacy-q6742.png`，确认遮挡消失；其余查看范围见第 6 节。

旧截图/QA 已保留：

```text
R/parent-inspection/render-qa-before-fixture-sse/
```

**最后 QA 重跑改变了 QA 与截图哈希。** 早期 `inspection-index.json` 和 `current-gate-checkpoint.json` 中缓存的 QA 引用可能已经过时，不得照抄作为最终批准。直接重算最新 `render-qa/page-qa.json` 和实际截图哈希。

## 6. 父级内容查看：只做了部分，没有批准

已建立：

```text
R/parent-inspection/inspection-index.json
R/parent-inspection/packet-01.json ... packet-18.json
R/parent-inspection/source-contact-index.json
R/parent-inspection/q<ID>-source-contact.png
R/parent-inspection/partial-parent-inspection.json
```

54 张 contact sheet 是带标签的**检查拼图**，将原有 bank stem、PDF stem 和所选解析图顺序排列，保留来源与哈希。它们不是题解替换图片，不能导入题库。

`partial-parent-inspection.json` 是当前部分查看记录的权威入口，绑定最新 QA 哈希和实际看过的 source/screenshot。已看来源 contact：

| ID | 父级观察与状态 |
|---|---|
| 6728 | 矩阵、Ω、四选项同序，①②③三法及 D 可见；部分视觉检查记录，未最终导入批准 |
| 6742 | 两问同序，定义证明、n项公式和原图拓展都保留；最新 clean legacy 截图已重新查看 |
| 6761 | 题库写 `x→∞`，PDF 写 `x→+∞`；**严格字面差异暂缓**，不以数学解释自动放行 |
| 6766 | 矩阵与两问相符，两张解析按380→381页连续；题库显式 `E为3阶单位矩阵`，PDF题图没有该句；**严格字面差异暂缓** |
| 6802 | 分段阈值、复合函数、x=e相符，两法完整，最新两UI截图已看 |
| 6812 | 矩阵、β及两问同序，参数讨论/通解完整，最新两UI截图已看 |

最新 clean 两 UI 截图都已查看：6766、6802、6812；6742 只重新查看了 clean legacy。6728、6761 和6742此前的 new截图有记录，但第一轮 legacy存在夹具告警遮挡，不能冒充最新 clean 查看。

**其余48条来源图未做父级逐图查看。6条也没有形成可执行 import approval。**

28 条原组装暂缓保持原样，且6761/6766是父级新增待核点，尚未从54提案中机械移除。重新组装/筛除它们会改变整份提案及 QA 哈希，必须重新验证，不能只删批准 ID。

重要原有拒收：6752 来源印答错误；6858 图片选择分歧；7135 选项文字不同；10716 添加正数条件；11104 一般 n 阶特化3阶；11347只取部分小问；11373/11381填空改选择。完整理由看 `proposal-evidence.json`。

## 7. 测试结果：区分绿验证和未完成全量

| 验证 | 结果/证据 |
|---|---|
| native/UI 针对性测试 | **55通过、0失败、0跳过**；`R/max-wave/ui-native-contract-tests-v5.log` |
| 私有 compact/proposal/transaction/merge | **51通过**；最后 `R/max-wave/private-tests-parent-inspection.log` |
| `npm run verify` | 通过；`R/max-wave/verify-after-new-zoom.log` |
| 当前提案 dry verify | 通过；最后 `R/max-wave/dry-verify-parent-inspection.log` |
| 最终 clean browser QA | 54题/75图/双UI/0 JS errors，通过；`proposal-browser-qa-clean-sse.log` |
| 全量 `npm test` | **不通过/未完成合格运行**；240秒 tool timeout，日志显示224已结算、213pass/11fail，见下文 |

全量日志：`R/max-wave/full-tests-after-zoom.log`。

- 一条确定的历史失败：`test/explanations-v2.test.mjs:59`，`#7947 不在题库 id_index 里`。
- 十条 file-level `test failed`：service-instance、source-taxonomy、study-activity、study-journal-browser、study-journal、study-report-browser、ui-contract、visibility-browser、visit-history、web-sync。
- 不能把这十条直接当作本轮回归，也不能说是已确认的环境问题；当时未进一步查因。
- 早期另一个 SW 注册版本不同步的 baseline失败已由本轮同步版本修复，针对性 ui-contract 是绿的。
- 接手若需跑全量，先确认上次 timeout 没有留下进程，不盲目并发重跑。不得以55针对性通过代替全量通过。

## 8. Native 审查与运行时信息

最近两轮 native Flash/max 静态复审都已 settled，没有正在等待的本轮子代理。

| Workflow | Child | 输出 |
|---|---|---|
| `63b22678-0a26-4b28-9774-01fd8c77d09d` | `e7368cef-fd68-45ff-94ab-92df14d2ad57` | `R/max-wave/legacy-zoom-qa-recheck.json` |
| `744b525f-9aa7-425e-ae0e-00ae596fdd35` | `a70718c0-f76c-48ae-b1a1-f46d13fc9b30` | `R/max-wave/new-zoom-keyboard-p2-recheck.json` |

最近 verdict 都为 `notes`，没有 P0/P1。最后新增 ArrowUp/Down + real new question view QA 是父级执行的后续补测，**没有另起独立审查来冒充第三轮 native 结论**。

剩余范围外 P2：新版 `#shortcut-help-dialog` 没有图片 dialog 那样的局部键盘隔离，`/` 仍可能触发后台全局搜索。本轮没有扩改帮助弹窗。

任务 mission：`ec9bf3eb-3570-4d48-8ac9-7806b2680ab8`；mission 路径绑定 cwd 必须是 `R/flash-wave`，不能擅自换为R。

Native runtime 收据目录：

```text
F:/C盘清理迁移/Temp/pi-subagents-user-14666/async-subagent-runs/<runId>/
```

历史运行时 blocker仍未彻底查因：`0xC0000409` native runner启动崩溃（run `18e5dfe4-1f7a-489f-977d-f85ef2eab60c`）；后续 max wave可完成不意味着根因已修。更多历史截断/receipt错误见原交接和 `R/max-wave/`。

模型配置本轮曾只为 Flash 增加 `input: ["text","image"]`，位于 `F:/AI/pi-agent/agent/models.json`，备份 `R/models-before-flash-vision.json`。实际图片附件探针通过；不表示手写 OCR 可以放心自动转录。不要公开完整配置或凭据。

## 9. 改动与恢复位置

本轮源码脏改增量包括旧版缩放、新版图片dialog隔离、asset/SW版本、对应浏览器/静态契约测试。上述文件原本就有用户改动，Git HEAD diff不是本轮净diff。

恢复证据：

```text
R/before/                                  题库/ledger初始快照
R/max-wave/pre-legacy-fix-status.txt
R/max-wave/pre-legacy-fix.patch               UI修复前脏差异
R/max-wave/pre-legacy-fix-files/
R/max-wave/pre-new-zoom-p2-status.txt
R/max-wave/pre-new-zoom-p2-app-new.js
```

原stash/checkpoint `53c3e4e8e17cc032e8350bfa0dc4f577bcbf0074` 是历史记录；依赖前重新验证存在，不能直接apply覆盖。

还有许多私有工具、包和收据；本轮未提交Git、未发布，临时图片/profile不能随业务发布。已停止时不会删除这些证据。

## 10. 用户重新授权继续后的顺序

1. **核对现状**：Git分支/HEAD/脏文件、production快照差异、提案/QA/来源哈希、是否有遗留测试进程。若实际文件变化，先重建证据绑定。
2. **补父级内容检查**：以 `partial-parent-inspection.json` 续接，查看余48条与缺失clean截图；6761/6766按字面闸门核查，不用自行求解放行。完成标准是每个批准ID的bank/source/解析顺序/边界/两UI已逐项记录。
3. **调整提案**：任何筛除/新review/图选择变化都用当前机械组装器重建；保留原生观察，不补造19条历史声明。重新dry verify与完整QA。
4. **处理剩余验证**：补查全量测试超时和失败；源图无bbox的来源边界覆盖仍有限，不能把脚本skipped当作已验；明确记录事务P2限制。
5. **最终批准闸门**：只对父级实际确认的精确proposal生成hash-bound approval，绑定最新proposal/evidence/QA、IDs和实际查看记录。部分inspection/report不是approval。
6. **有批准才apply**：父级单写者执行当前apply，再production verifier、protected/index检查、native/full测试和`npm run verify`，确认ledger `changes[]`/`image_replacements[]`才算落地。`decisions[]`不能证明应用。
7. **其余cohorts**：text006和special需当前native/max双审与QA，不能用历史approve数量直接导入。

停止时todo：#1/#5/#6/#8/#9/#10 completed；#2 in_progress但用户叫停、未完成；#3/#4 pending；#7 runtime根因pending。不要把叫停任务标成完成。

---

**收工结论：缩放代码修复与针对性验证完成；内容验收仅部分完成；生产仍3,220 overlays、零新增导入。下一位先取得用户继续授权，不从任何完成通知推导导入许可。**
