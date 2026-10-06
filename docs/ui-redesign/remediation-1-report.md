# 整改关 1 报告：功能兼容和数据可靠性

> 本文记录 DeepSeek 完成的上一轮复验，当时的 §8.1 离线数据丢失结论属于历史状态。随后 worker `hub-3-muj70yf3` 在修复期间因模型工具参数无效 JSON 中止；Codex 保留其有效修改、补齐旧版待同步批注重放并独立复验。当前关结论和最新证据见 [第三次独立验收](./remediation-1-acceptance-3.md)。

- 实施：ZCode / GLM-5.3-Flash（2026-09-27，本轮之前的实施与首轮自测）
- **独立复验与本文更新：DeepSeek V4 Flash（复验轮，全部数字为本轮真实执行所得）**
- 依据：`docs/ui-redesign/REMEDIATION-CONTROL.md`（仅关 1）、`docs/UI-REDESIGN-SPEC.md`、`docs/ui-redesign/remediation-1-acceptance.md`（Codex 不通过结论）、`docs/ui-redesign/remediation-1-feedback-to-codex.md`（F1/F2/F3 事实依据）
- 基线：分支 `codex/merge-dual-ui`，HEAD `d96566bfdee83c1ab6dd64115ee62ce4e10d88e7`（复验轮再次核对：`git rev-parse --short HEAD` = `d96566b`，`git status --porcelain` 31 项，与快照清单一致）
- 复验轮未 push、未部署、未替换发布包、未提交、未使用 stash，未触碰真实凭据 / 真实 `data/` / 真实官网同步；全部浏览器复验在隔离 `DAGUAN_DATA_DIR` + 注入代理下进行。

## 0. 复验结论（本轮）

- Codex 上一轮的三项阻断均已修复并通过本轮独立验证：**阻断 1** 存储形状/独立收藏键（F1）、**阻断 2** 恢复后刷新被服务端覆盖（待对账 + 回滚）、**阻断 3** 备份导出批注字段形状。
- `remediation-1-feedback-to-codex.md` 记录的 F1/F2/F3 三项缺陷，本轮逐项在真实浏览器复验通过（F3 见 §6.4 `sup-f3`）。
- 本轮共执行 8 个 Playwright 脚本 **56 项检查，0 失败，0 未捕获 JS 错误**；7 个 HTTP 错误全部是脚本故意注入的边界：2×500 批注保存、1×401 错误预览密钥（`qa-r2`）、2×500 + 1×409 恢复对账（`sup-backup` T5/T7）、1×500 离线 `/api/state`（`sup-offline-recover`）。
- `npm test` **115/115**、`npm run verify` 6342 题 / 6342 唯一题号（缺 21 张历史题图）、`node --check` 通过。
- 本轮新发现 1 项遗留行为（非 F1/F2/F3 范围，需 Codex 判定是否属关 1）：离线期间写入的本地批注/收藏，在服务恢复后的 `hydrate()` 中会被服务端版本整体覆盖且不补写（§8.1）。

## 1. 现场保全（先于一切修改）

`.build/ui-redesign/remediation-1/backup/`：

| 文件 | 说明 |
|---|---|
| `remediation1-worktree-snapshot.tar.gz` | **31 个文件**（9 个已修改 + 22 个未跟踪源码/文档），SHA-256 `1c8bbaba879d31f3d06a030952d2e8471379af4f2c603d99c1f42daa92561357` |
| `RESTORE.md` | 校验与还原方法（`sha256sum -c` 后 `tar -xzf` 覆盖，不触碰 git 索引/HEAD） |
| `git-state.txt` / `status-porcelain.txt` / `untracked-files.txt` | 分支、HEAD、逐项状态 |
| `worktree-vs-head.diff`（1685 行）/ `index-vs-head.diff`（空） | 快照时点全部改动对照 |
| `stash-list-before.txt` | stash 列表（空；全程未使用 stash） |

排除项：凭据、个人学习数据（`data/`）、`.build/` 产物。

复验轮独立核对：`(Get-FileHash … -Algorithm SHA256)` = `1c8bbaba879d31f3d06a030952d2e8471379af4f2c603d99c1f42daa92561357`（与 Codex 记录一致），`tar -tzf` 条目数 = 31，文件 234137 字节。此后复验轮只新增 `.build/ui-redesign/remediation-1/verify-r2/` 下的脚本与结果，未改动任何被保全文件（`git status --porcelain` 中 `.build` 相关条目为 0）。

## 2. P0-1 数据与切换 —— 修改清单与结果

全部业务改动集中在 `web/app-new.js`（新版前端），旧版 `app-legacy.js`/`legacy.html`/`legacy.css` 未做业务修改（实测快照里的旧版差异系更早会话遗留，原样保留）。

### 2.1 存储键与存储形状对齐（控制 P0.1；含阻断 1）

| 项 | 修改前 | 修改后 | 复验证据 |
|---|---|---|---|
| 进度键形状 | `daguan_local_progress_v1` 被改写成 `{progress:{…},favorites:[…]}` 包装形状，旧版读不到 | 写**旧版同形纯映射** `{题号: 条目}` + **独立收藏数组键** `daguan_local_favorites_v1`；读到包装形状时自动拆包升级并立即回写旧版形状 | `web/app-new.js:178-224` `PROGRESS_KEY_SHARED`/`FAVORITES_KEY_SHARED`/`readProgressStorage()`/`writeProgressStorage()`；单测 `test/new-ui-compat.test.mjs:180,192`；浏览器 `qa-r2.py` A10 断言已是纯映射形状 |
| 收藏判定（F1） | `entry.favorite === true` 才算收藏，数组里的收藏被判为未收藏 | `StorageService.isFavorite()`（`app-new.js:289-295`）布尔优先、缺省回退 `data.favorites` 数组；`_write()`（`:255-266`）用 `favoriteOn = typeof entry.favorite === 'boolean' ? entry.favorite : favSet.has(key)`，不再把「字段缺失」当 false 删除数组项；笔记/复习列表与题目导出改用 `StorageService.isFavorite()` | 单测 `new-ui-compat.test.mjs:212,235`；浏览器 `sup-round.py` R1（`isFavorite=True`、阵列 `['3356','3363']`、掌握切换后仍在）；`qa-r2.py` C2 |
| AI 草稿 | `daguan_ai_draft_<qid>`（自造键） | `DaguanVersions.draftKey(qid)` = `daguan_ai_draft_v1:<qid>`（与旧版共享） | 单测 `new-ui-compat.test.mjs:45`；浏览器 `sup-round.py` R2/R4、`qa-r2.py` A3 |
| 外观 | `daguan_ui_appearance_new`（自造键） | `DaguanVersions.appearanceKey` = `daguan_ui_appearance_new_v1`（`web/ui-version.js:5`） | 单测 `new-ui-compat.test.mjs:71`；浏览器 `qa-r2.py` C1/C2、`sup-round.py` R2/R3 |
| AI 偏好 | `{apiKey, baseUrl, model}`（浏览器端凭据） | `{profileId}`（与旧版共享 `daguan_ai_preferences_v1`，密钥只在本地服务端档案） | 单测 `new-ui-compat.test.mjs:88,100`；浏览器 `qa-r2.py` A2 |
| 迁移 | 无 | `StorageService.migrateLegacyKeys()`（`app-new.js:482-507`）：旧草稿键→共享键、旧外观键→共享键，**只填空白目标键、不覆盖、可重复执行** | 单测 `new-ui-compat.test.mjs:55`（幂等/不覆盖两分支） |

### 2.2 共享学习数据与服务端协议（控制 P0.2；含阻断 2）

新增 `StateSync` 服务（协议逐字段对照 `app-legacy.js` 与 `local-server/server.mjs` 真实处理器）：

- 初始化水合 `hydrate()`（`app-new.js:648-685`）：`GET /api/state` → progress（按 `updated_at` 新者胜合并）、favorites、annotations、picked、`last_study`、revision；
- 逐题写入 `flush()`（`:754-795`）：`PATCH /api/state/questions/:id`，携带 `If-Match: revision` + body `revision` + `updated_at`；**409 时读取 `conflict.current.revision`、合并服务端进度（保留本机未写入编辑）、重排队列**，失败 900ms 后重试；
- 批注 `flushAnnotation()`（`:797-816`）：本地 `markdown` 落盘；`PATCH /api/state/questions/:id/annotation`（If-Match + revision）；`409 && attempt===0 && conflict.current` → 更新 revision 后重试一次；其余失败 `throw new Error('批注保存失败（HTTP ${status}）')`；
- 学习位置 `pushLastStudy()`（`:820-852`）：`PATCH /api/state/last-study`（真实章节 id + 真实题号 + mode + revision + If-Match；409 重读重试一次）；失败置 `lastStudyPending` 待重试；
- 选题（picked）：水合自服务端并在备份/恢复中保留；
- 未新增任何服务端端点或第二套进度；E2E 实测隔离 `state.json` 中出现与旧版完全同构的 progress/favorites/annotations/last_study。

**备份恢复（阻断 2、阻断 3 的修复，本轮逐项验证）**：

- `buildBackupPayload()`（`:2818-2840`）导出 **v3 旧版同构格式**，批注字段为 `{markdown, updated_at, history}`（**阻断 3**：原为 `{content,lastModified,history}`），不含 `ai_preferences`/任何密钥；
- `parseBackupText()`（`:2861-2899`）兼容 full 形状与 `map`/`states` 旧形状；`不是有效的备份 JSON` / `无法识别的备份格式（缺少进度数据）` / `备份内容为空` 三类错误；
- `restoreBackup()`（`:2901-2983`）：解析失败即 `恢复失败：…（当前数据未改动）`；确认后先取 4 键快照 `{progress,favorites,annotations,picked,saved_at}`，写入失败即 `rollback()` 并报 `…（已回滚，当前数据未变）`；成功后 `StateSync.markRestorePending()` → `reconcileLocalToServer()`（整份 `PUT /api/state`，409 重读重试一次，保留服务端 `last_study`），成功报 `恢复完成（本地与服务端已同步）`，失败报 `恢复完成：本地数据已更新；本地服务端暂未同步…` 并保留待对账标记；
- `hydrate()`（`:648-685`）在 `hasRestorePending()` 且对账失败时 **`available=false; hydrated=true; return`**，绝不用旧服务端 favorites/annotations 覆盖刚恢复的本地数据（**阻断 2** 根因消除）。

跨版本位置解析：`resolveChapterForQuestion()` 把旧版 `last_study`（category_id 可为任意层级）解析为「顶层科目 + 叶子章节 + 题号」，供 `uiSwitch=1` 到达时恢复同一道题（`restoreFromServerPosition`）与首页「继续学习」（`absorbLastStudy`，仅当远端比本机新时落盘）。

### 2.3 保存先行与失败留页（控制 P0.3 / P0.4；含 F2、F3）

- `ensureSavedBeforeLeavingQuestion()`（`:3352-3365`）：切题前保存 AI 草稿 → `flushAnnotationNow()` → `StateSync.ensureFlushed()`；任何失败 `toast('未切换题目：…')` 并留在当前题；
- `navigate()`（`:2454-2477`）：离开做题页 `flushAnnotationNow()`、离开笔记页 `saveMemoNow()`，随后 `ensureFlushed()`；失败 `toast('内容尚未保存：…')` 并留在当前页；成功后再处理 AI 生成中确认；
- **F2**：`ensureFlushed()`（`:855-880`）不再「超时即放行」：有 in-flight 时 `Promise.race([…, 5000ms])`，超时且 `available && PreviewAccess.privateAllowed(false)` → `throw new Error('最近学习位置仍在保存，请稍后重试')`；`lastStudyPending` 重试失败 → `throw new Error('最近学习位置未能保存，请重试')`；队列未清空 → `throw new Error('学习记录仍在保存，请稍后重试')`；`available === false`（离线）仍按设计放行；
- 版本切换 `setUiVersion()`（`:3308-3335`，`#btn-switch-legacy` → `switchToLegacy()`）：`AppState.aiBusy` 时先 `confirm('切换界面会结束当前 AI 生成。是否保存进度并切换？')`，拒绝则原地继续；确认后保存草稿/批注/备忘 → `stopAIStream()`（`DELETE /api/ai/runs/:id`）→ 写共享选择键 → `DaguanVersions.targetUrl(…,'old',true)`；失败 `toast('未切换界面：…')` 留在新版；
- 笔记页：`selectNote()`（`:2602-2614`）在 `AppState.memoDirty` 时先 `saveMemoNow()`，失败 `toast('备忘尚未保存：…')` 并留在当前选中项；
- **F3**：`renderNotes()` 末尾调用 `App.bindMemoEditor()`（`:1957`；原为跨类笔误 `this.bindMemoEditor()` → 每次渲染抛 `TypeError`、`memoDirty` 跟踪失效）；方法定义在 `class App`（`:2616`）。

## 3. P0-2 AI 接回现有服务 —— 修改清单与结果

`AIService` 全部重写（`web/app-new.js`）：

- 请求体：`{profileId, question: aiQuestionPayload(q), prompt, includePrivate, images}`，与 `/api/ai/chat` 现有协议一致；**不再发送 `{messages, apiKey, baseUrl, model}`**；
- 档案：`GET /api/ai/profiles` 加载；优先 `daguan_ai_preferences_v1.profileId` → active 档案 → 第一个；设置页提供现有档案的选择、新增/编辑、连接测试、删除，**密钥只提交到本地中控台，不写入浏览器存储**；
- SSE：**跨块缓冲解析**（`parseSseChunk`），处理 `started`（记录 runId）/`delta`（120ms 节流渲染）/`done`/`error` 四类事件；`X-Daguan-Run-Id` 响应头兜底；
- 停止：`AbortController` 中断 + `DELETE /api/ai/runs/:runId`；停止后已生成部分保留展示；
- 错误：`error` 事件与 HTTP 失败在消息区显示并可重试（重试内容回填草稿）；
- 按题隔离：切题/切版本时中止旧流；聊天历史取自 `GET /api/ai/conversations/{profileId}/{questionId}`；
- 提示词：保留「完整解答」完整结构提示词 +「给我提示」「易错点」两个紧凑提示；数学教学 system 约束由后端固定指令承担；
- 视觉档案（`capabilities.vision === 'passed'`）自动附带题目图片。

验证：单测断言请求体字段（含「无 apiKey/baseUrl/model/messages」）与跨块解析；浏览器 A2（流式渲染 + 请求体捕获）、A5（error 事件展示）、B1（手机端流式）、`sup-ai.py` A0-A2（慢速流 24s）与 B1/B2（生成中切版本）。

## 4. P0-3 工具完整可用 —— 修改清单与结果

`UIRenderer.renderTools` 与对应 `App` 方法重写，全部为真实流程：

| 工具 | 实现 | 复验证据 |
|---|---|---|
| 智能组卷 | 范围 + 数量（5–50）→ 从本地题库真实抽取 → 预览题号清单 → 「开始作答」进入真实做题队列 | `qa-r2.py` A7（20 题） |
| 导出题目 | 范围（收藏/易错/已掌握/当前章节队列）+ 含答案/解析 → 公式预渲染 → 打印预览弹窗 + 主页面「下载 HTML 文件」真实文件 | `qa-r2.py` A8（弹窗 1 题 + 下载文件） |
| 进度备份 | 旧版同构 v3 格式，不含 `ai_preferences` 与任何 API Key | `qa-r2.py` A9；`sup-backup.py` T1 等（本地文件断言） |
| 恢复备份 | 兼容 full / `map` / `states` / 旧键三种来源，非法文件不改动数据（详见 §2.2） | `qa-r2.py` A9；`sup-backup.py` T1–T8（12 项） |
| 官网同步 | 真实入口全链路：`status`（登录态判断 + 配置入口）→ `pull/preview` → `pull/apply` → `push/preview`（`buildSyncDocument()` 与旧版同构）→ `push/apply`；预览锁定时被服务端 403 拦截 | `qa-r2.py` A10（模拟服务全链路） |

预览权限边界：`PreviewAccess` 启动水合 `/api/access/status`；锁定时个人功能一律先解锁；`index.html` 增加横幅 + `#dlg-preview-access` 解锁对话框。复验 `qa-r2.py` C1/C2。

## 5. 其他修改

- 资源版本 v104 → **v105**：`index.html`（3 处）、`service-worker.js`（CACHE + 2 处 SHELL）、`app-new.js`（SW 注册）；index 头部主题初始化改用 `DaguanVersions.appearanceKey`；
- `styles-new.css` 末尾增补：toast、预览横幅/对话框、工具面板控件、AI 档案行、AI 面板层叠修复；
- 导出弹窗数学公式在主页面预渲染（本地 KaTeX），弹窗仅带样式。

## 6. 测试体系与复验执行结果

### 6.1 测试体系

- `test/new-ui-compat.test.mjs` 由 **11 例增至 18 例**，新增 7 例正是本轮修复的回归保护：`:180` 进度键写旧版纯映射 + 收藏独立键、`:192` 包装形状自动升级不丢、`:212` 数组式收藏被识别且掌握/易错切换不丢（F1）、`:235` `favorite=false` 优先于数组残留（F1）、`:245` 批注 `content` 形状统一为 `markdown` 落盘（阻断 3）、`:259` 恢复对账以本地为准整份 PUT 且保留服务端 `last_study`（阻断 2）、`:294` 待对账期间 hydrate 不用旧服务端覆盖本地（阻断 2）；
- `npm test` 脚本包含 10 个测试文件（含 `test/new-ui-core.test.mjs`、`test/new-ui-compat.test.mjs`）；
- 修复两个过期测试文件（上一阶段遗留，与产品代码无关）：`test/ui-contract.test.mjs`（双版本架构下旧版契约迁移到 `legacy.html/legacy.css/app-legacy.js`；SW 版本 v105；新增「新版入口承载新版前端」契约）、`test/new-ui-core.test.mjs`（两处断言 bug）。

### 6.2 本轮真实执行结果

| 检查 | 命令/脚本 | 本轮实测结果 |
|---|---|---|
| 单元/契约测试 | `npm test` | **tests 115 / pass 115 / fail 0**（suites 9，duration 654.999ms，exit 0） |
| 题库校验 | `npm run verify` | 题库验证通过：**6342 题，6342 个唯一题号**；警告缺 21 张历史题图（未补，历史已知） |
| 语法检查 | `node --check web/app-new.js` / `web/app-legacy.js` | 均 exit 0 |
| 真实点击 15 项 | `verify-r2/qa-r2.py`（原 `qa/remediation-qa.py` 的隔离端口重跑） | **15/15 通过**，0 未捕获 JS 错误，3 个故意触发的 HTTP 错误 |
| 备份/恢复矩阵 | `verify-r2/sup-backup.py` | **12/12 通过**，0 JS 错误，3 个故意注入的服务端错误（2×500 + 1×409） |
| 批注/学习记录失败路径 | `verify-r2/sup-fail.py` | **10/10 通过**，0 JS 错误，0 HTTP 错误 |
| 延迟 AI 流与生成中切换 | `verify-r2/sup-ai.py` | **5/5 通过** |
| 跨版本/离线往返 | `verify-r2/sup-round.py` | **7/7 通过** |
| 离线恢复行为记录 | `verify-r2/sup-offline-recover.py` | **2/2 通过**（1 个故意 500） |
| F1/F3 定向复验 | `verify-r2/sup-f3.py` | **3/3 通过** |
| 旧版批注编辑器填充时序探针 | `verify-r2/probe-legacy.py` | **2/2 通过** |

合计 **56 项检查、0 失败、0 未捕获 JS 错误**；结果 JSON 与截图见 §7。

### 6.3 复验矩阵要点（逐项事实）

- **A1–A11 / B1 / C1 / C2（`qa-r2.py`）**：A1 进入章节做题（第 1 题/共 11 题）；A2 AI 请求体 `profileId+question+prompt` 且 SSE 流式；A3 切旧版同题 `#3356` + AI 草稿 + 批注共享；A4 切回新版同题 + 旧版掌握状态共享；A5 AI `error` 事件保留可重试；A6 服务端 500 阻断切题（留在当前题、批注保留）、A6b 恢复后切题成功且补写；A7 组卷 20 题进入作答；A8 导出弹窗 1 题 + 下载 `daguan-export-2026-09-27.html`；A9 备份 v3 无密钥 + 坏文件恢复不改数据；A10 官网同步全链路（模拟）；A11 刷新 0 未捕获错误；B1 390×844 无横向溢出；C1 预览锁定横幅 + 收藏触发解锁对话框；C2 正确密钥解锁后收藏可用。
- **T0–T8（`sup-backup.py`）**：T1 合法 full 备份恢复（服务端随即 `已同步`、待对账标记清除、代理日志 `[[GET,/api/state],[PUT,/api/state]]`）；**T2 刷新不丢**（恢复前服务端 favorites 是陈旧 `['8888']`，恢复后刷新仍为 `['3357']` —— 阻断 2 现场）；T3 三类非法文件（语法非法 / 结构非法 / 内容为空）均 `恢复失败：…（当前数据未改动）` 且 5 个 localStorage 键快照逐字节不变；T4 旧版 `states`/`map` 形状导入（mastery/favorite/error_prone 映射正确、收藏取并集）；T5 服务端 PUT 500 → 恢复完成但报 `暂未同步` + 保留待对账标记，**T5b 待对账期间刷新不被服务端旧值覆盖**，T6 服务恢复后刷新自动补对账并清除标记；T7 PUT 409 → 序列 `[[GET],[PUT 409],[GET 重读],[PUT 200]]` 后 `已同步`；T8 写失败回滚 → `恢复失败：…（已回滚，当前数据未变）` 且五键快照不变。
- **F0–F4b（`sup-fail.py`）**：F1a/F1b 批注 409（真实版本前移 + 注入）均 `409→200` 重试成功、状态「已自动保存」、服务端 markdown 写入；F2 批注 500 → 状态「保存失败，请重试」、`AppState.annotationDirty=true`、本地保留、点「下一题」被阻断（题号不变、toast `未切换题目：批注保存失败（HTTP 500）`），F2b 清规则后切题成功并补写；F3a/F3b 学习位置 409 `409→200` 重试成功、服务端 `last_study` 与当前题一致；F4 学习位置 500 → `lastStudyPending` 留存、点笔记页被阻断（toast `内容尚未保存：最近学习位置未能保存，请重试`），F4b 恢复后放行。
- **A0–B2（`sup-ai.py`，代理 60×400ms ≈24s 慢流）**：A1 生成中离开被拒（留在做题页、`aiBusy` 仍 true、`#ai-messages` 字符数持续增长 92→147、toast `已留在当前页，AI 生成继续`）；A2 确认后离开（`view=notes`、`aiBusy=false`、runId 置空、代理收到 `DELETE /api/ai/runs/*`、客户端 `/api/ai/chat` 以 `net::ERR_ABORTED` 中止）；B1 生成中切版本被拒（URL 不变、`aiBusy` 仍 true）；B2 确认后切到 `legacy.html?uiSwitch=1` 且旧版 AI 输入框恢复草稿「切换版本前的未发送草稿」。
- **R0–R6（`sup-round.py`）**：**R1 = F1 核心场景**（把收藏只写进 `daguan_local_favorites_v1` 数组、删掉进度条目里的 `favorite` 字段后重渲染）→ `StorageService.isFavorite('3356')=True`、按钮 `active`、点击「已掌握」后 mastery 由 `learning` 变 `mastered` 且阵列仍含 `3356`（`['3356','3363']`）；R2 新版→旧版：同题 `3356`、批注、未发送草稿全部可见，草稿位于共享键 `daguan_ai_draft_v1:3356`，旧私有键 `daguan_ai_draft_3356` 为 `null`，外观键 `daguan_ui_appearance_old_v1`；R3 旧版→新版：`#btn-toggle-favorite` 双态翻转（`pressed false→true`，本地阵列 `['3363','3356']`、服务端 `['3356','3363']`；再点回 `false`，阵列与服务端均为 `['3363']`），切回新版后 `isFavorite` 与按钮态一致、外观键 `daguan_ui_appearance_new_v1`；R4 离线（`/api/state` 全方法 500，`StateSync.available=false`）切版本不被阻塞，旧版同题/收藏/批注/草稿完整；R5 离线切回新版同题/批注/收藏保持；R6 服务恢复后刷新：`available=true`、收藏数组 `['3363']`（服务端为准）。
- **F3-0..F3-2（`sup-f3.py`）**：选中「学习备忘」后 `#memo-textarea` 渲染 1 个；输入后 `AppState.memoDirty=True`（证明 `renderNotes()` 已完成 `App.bindMemoEditor()` 绑定 —— 修复前该处抛 `TypeError`，监听器挂不上、dirty 永远为 false）；点击另一条笔记触发 `selectNote` 守卫后 `memoDirty=False` 且 `daguan_local_notes_v1` 已保存输入内容；「保存备忘」按钮路径状态文案 `已保存`、内容更新；全程 0 未捕获错误。
- **probe-legacy P1/P2**：旧版 `#question-note-editor` 在批注抽屉关闭时元素存在但 `value` 为空（16×0.5s 采样全程为空），点击 `#btn-single-note` 后即为共享批注 `往返批注-R2` —— 说明**跨版本批注共享正常，早先脚本中的「批注为空」是复验脚本的读取时序问题**，不是产品缺陷；`qa-r2.py` A3 之所以直接断言成功，是因为它先点击了 `#btn-single-ai`（同一渲染流程会同时填充两个编辑器）。

## 7. 证据与截图（`.build/ui-redesign/remediation-1/`）

- 复验脚本与结果：`verify-r2/`（`r2lib.py`、`qa-r2.py`、`sup-backup.py`、`sup-fail.py`、`sup-ai.py`、`sup-round.py`、`sup-offline-recover.py`、`sup-f3.py`、`probe-legacy.py`、`proxy-r2.mjs`、`rules.json`、`proxy-r2.log.jsonl`）；结果 JSON 分别在 `verify-r2/screenshots/`（`qa-r2-results.json`、`sup-backup.json`、`sup-fail.json`、`sup-ai.json`、`sup-round.json`、`sup-offline-recover.json`、`sup-f3.json`、`probe-legacy.json`）。
- 复验截图：`r2-backup-legal/illegal/pending/409/rollback.png`、`r2-annotation-409/500.png`、`r2-laststudy-409/500.png`、`r2-ai-reject/confirm/switch-version.png`、`r2-fav-array-only.png`、`r2-old-shared.png`、`r2-offline-legacy.png`、`r2-offline-recover.png`、`r2-f3-memo.png`、`r2-probe-legacy.png`。
- 首轮（实施者）证据保持原样未改：`screenshots/remediation-results.json`（15 项）、`screenshots/remediation-results2.json`、`files/`（`daguan-export-2026-09-27.html`、`daguan-progress-2026-09-27.json`、`bad-backup.json`）、`backup/`、`qa/`、`baseline/`、`independent/`（含 `results-f23.json`）。
- 隔离环境（复验轮）：主实例 `http://127.0.0.1:18120`（`DAGUAN_DATA_DIR=.build/ui-redesign/remediation-1/verify-r2/data-main`、`DAGUAN_DEFAULT_PAGE=/index.html`）；预览实例 `http://127.0.0.1:18121`（`verify-r2/data-preview`、`DAGUAN_PREVIEW_KEY=verify-r2-key`）；注入代理 `http://127.0.0.1:18122`（`verify-r2/proxy-r2.mjs`，规则文件每次请求重读，可动态注入 500/409/延迟）。旧隔离实例 18095/18096/18098/18099 已核实用途后**未复用**，真实 `data/` 未触碰。
- 复验脚本相对原脚本的适配（原文件未改）：`qa-r2.py` 由 `qa/remediation-qa.py` 复制后改端口/数据目录/预览密钥，并把 A10 断言的进度键读取从已废弃的 `{progress:{…}}` 包装形状改为纯映射 `["3356"].mastery`。

## 8. 已知问题与未解决项（如实）

1. **（本轮新发现，属旧有行为，非 F1/F2/F3 范围）离线期间的本地批注/收藏在服务恢复后的水合中会被服务端版本覆盖，且不会补写到服务端。** 依据：`app-new.js:3677-3697 autoSaveAnnotation()` 只在 `StateSync.available && PreviewAccess.privateAllowed(false)` 时才 `flushAnnotation(…)`，离线时仅写本地并显示「已自动保存」（`annotationDirty=false`，无待重试队列）；恢复在线后 `hydrate()`（`:668-672`）直接 `favorites = remote.favorites`、并用 `remote.annotations` **整体替换**本地批注键。实测 `sup-offline-recover.py`：离线写入 `离线批注-R7`（本地可见、状态「已自动保存」）→ 服务恢复并刷新后本地与服务端均为服务端旧值`往返批注-R2`，离线内容丢失。备份恢复路径有 `markRestorePending()` 保护，本项属于「普通离线编辑」路径，需 Codex 判定是否列入关 1 范围。
2. **备份恢复后的服务端追赶已实现整份对账**（原「依赖后续逐题写入」的说法已不成立，本轮 T1/T5/T5b/T6/T7 已验证）；残余限制是：对账失败时状态文案为「暂未同步」并保留待对账标记，需保持前端可重试（本次未见自动重试定时器，靠下次刷新/水合触发）。
3. **旧版批注编辑器在抽屉关闭时不填充**（现象与结论见 §6.3 末条）：跨版本共享本身正常，但自动化断言必须先打开批注或 AI 抽屉，文档化以免后续复验误判。
4. ~~手机端 AI 输入框文字截断~~（视觉问题，留待关 2）；做题页头部操作按钮布局粗糙处同属关 2。
5. `web/index-new-backup.html`、`web/index-old-backup.html`、`web/ui-preview/` 为更早会话遗留文件，本轮未动（未纳入生产缓存引用）。

## 9. 未验证项（本轮同样未验证）

1. **真实第三方 AI 调用**：无 API 凭据，AI 全部用注入代理的模拟 SSE 验证（协议、流式、慢流阻断、停止、错误、按题历史）；真实模型端到端未测。
2. **真实官网同步**：同步端点用注入/路由模拟验证；对 `cxyonly.fans` 的真实读写在隔离与授权约束下未执行。
3. **Windows exe 构建**：仅保证 SW 变换逻辑与单测通过，未构建发布包（遵守不替换发布包）。
4. **离线缓存端到端**：未重复 SW 离线加载回归（本轮仅升版本号并保持 SHELL 结构）。
5. **1280×800 / 1024×768 / 360×800 尺寸**：控制文档归入关 3 最终回归，本轮仅 1440×900 与 390×844。
6. **深色/护眼/自定义主题**：新版外观 UI 未在本关展开（视觉关范围），主题初始化已改挂共享外观键。
7. `app2.js/styles.css` 兼容前端（离线壳保留、无入口引用）未做功能回归，仅契约测试覆盖其独有特性仍在。

整改关 1 待 Codex 复验。
