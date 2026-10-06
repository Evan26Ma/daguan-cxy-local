# 10 · 测试有效性 / CI / 文档一致性 审查报告（大观园桌面版全流程审计）

- 审查者：第 10 号审查子代理（测试有效性 / CI / 文档一致性）
- 对象：`F:\AI\大观园本地`（分支 `main`，HEAD `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，`daguan-math-local` v1.0.10）
- 环境：Windows / Node v24.15.0 / npm 11.12.1 / Electron 44.4.5 / 日期 2026-10-01
- 性质：**只读诊断**。未修改、未删除、未重命名任何仓库源码或文档；未执行 `git reset`/`clean`/`stash`；未推送、未部署、未发布。
- 隔离：所有测试运行均使用临时 `DAGUAN_DATA_DIR`（`%TEMP%\dg-audit-10\*`）与 `PORT=18088`，**未读写 `%LOCALAPPDATA%\DaguanMath\data`，未读写仓库 `data/`**。
- 未安装任何新依赖。浏览器测试复用机器上已有的临时 Playwright（`C:\Users\14666\AppData\Local\Temp\dg-audit-04\pw\node_modules\playwright`，playwright 1.59.0）。
- 本文件是本次审查唯一由我写入的文件。

## 0. 方法与约束

- **委派不可用（实测）**：`subagent` / `subagent_fork` 全部失败，报 `Error: subagent depth 2 exceeds maxDepth 1`。作为 depth-1 子代理无法再下探，`test/` 下 40 个文件全部由我逐个 `read` 完成判定。这是本次审查耗时的主因，也意味着 40 条判定没有被第二双眼睛交叉验证过。
- **判定方法**：对每个测试文件读全文，检查 ①是否 `import` 产品模块 / `createRequire` 加载产品 `.cjs` / `vm.runInContext` 执行产品源码；②是否 `readFileSync` 后只做字符串匹配；③断言对象是自己构造的还是产品产生的。据此分三类：**真行为**（执行产品代码并断言其结果）、**静态断言**（只对源码/文档文本做正则）、**自证**（测试文件内自己实现一遍再断言自己）。
- **实测与静态确认分离**：本文所有带「实测」标记的结论都有可复现命令与原始输出；带「静态确认」的是读源码/配置得出；无法确证的写「未能验证 + 理由」。

---

## 1. 测试有效性矩阵（40 个文件）

`test/` 目录共 **40 个文件**：**31 个**被 `package.json` 的 `test` 脚本引用，**9 个**是未纳入 `npm test` 的手工/冒烟脚本。另有 `sync-extension/test/protocol.test.js`（在 `sync-extension/` 下，不在 `test/`）也被 test 脚本引用，作为第 32 个被引用文件列在表末。

| # | 文件 | 类型 | 覆盖什么 | 有效性 | 关键缺陷 |
|---|---|---|---|---|---|
| 1 | `test/web-sync.test.mjs` | **自证** | 无 | **无效（0 覆盖）** | 不 import 任何产品代码；`:4-9` 在测试里自己重新实现 `toLocalMastery` 再断言它；`:18-26`/`:28-43`/`:45-63` 手工构造对象再断言自己构造的结果。4 个用例 0 覆盖，且是 test 脚本的**第一个**文件。**实测：`toLocalMastery` 在 `web/*.js`、`local-server/*.mjs`、`desktop/*.{cjs,mjs}` 里 0 命中 —— 它测的是一个产品代码里根本不存在的函数** |
| 2 | `test/local-server.test.mjs` | 真行为（混合） | `sync-format.mjs` 9 个纯函数（V2→V3 迁移、`localToRemoteDocument`、`localToAndroidDocument`、`buildPullMerge`、`buildPushPlan`、`normalizeRemoteStates`、`buildReconcilePlan`×2、`applyLocalChanges`）+ `CxyonlyClient` mock fetch（token 脱敏/CSRF/Bearer，`:80`）+ revision 乐观锁 `STATE_CONFLICT`/409（`:160`） | 有效 | `:20 createStore(root)` 省略第二参数 → 绑到 `DAGUAN_DATA_DIR`（见 P1-1）。11 个用例中只有 2 个碰 store，其余 9 个是纯函数，价值实在 |
| 3 | `test/official-orphan-classifications.test.mjs` | 真行为 | `official-question-bank.mjs` 的 `applyLocalClassifications` + 数据完整性：492 条 assignment 题号存在、492 条 reviewed orphan 分类后 `id/stem/answer/source` 不变、多分类 19 条、`category_id===9900100` 37 条、`manifest.total === source_total + 159`、`shards["未分类"].count===0`、`idIndex` 键数 === total、searchIndex 去重后 === total | 有效（数据守门） | 只测数据一致性，不测官网抓取/合并逻辑本身；数值硬编码（题量变化即红，属预期） |
| 4 | `test/question-bank-updater.test.mjs` | 真行为 | `question-bank-updater.mjs`：覆写 `globalThis.fetch`（`:17`，`:53` finally 还原）模拟官网 API，验原子更新、初始 `activeId==='bundled'`、内容未变 `unchanged===true`、变更后 `revised.id !== result.id`、断网 `update()` reject 且 `activeId` 保持上一个好版本、`enabled:false` 重启后仍读回该版本 | 有效 | 只 1 个用例；`fetch` 全局覆写（若将来并发化会互相干扰）；tmpdir 清理有前缀双重校验（好） |
| 5 | `test/service-instance.test.mjs` | 真行为（进程级） | `service-handoff.mjs` 的 `classifyServiceOwner`/`stopBrowserService` + 真 spawn `local-server/server.mjs`（`:29-40`）：优雅接管、做题历史去重/删除/清空、PID+映像双匹配、锁变化不发停止请求、死 PID 恢复、健康不符/超时保留锁、竞争启动单写入者、协议不兼容、双事件窗口并发保存、退出释放锁+崩溃重启、优雅退出等待在途写入 | **有效（本仓库最有价值的三份测试之一）** | 11 个用例覆盖的是**实例锁/交接**，不是数据正确性；用 `unusedPort()` 抢空闲端口，极端情况下仍有 TOCTOU 窗口 |
| 6 | `test/visit-history.test.mjs` | 真行为 | `visit-history.mjs`：`:11` 旧进度迁移补入一次且 `time_kind==='legacy'`、clear 后不补回；`:28` `Promise.all` 30 次并发 `visit()` 按题去重（只 3 条）、merge 保留较新、remove | 有效 | 2 个用例，覆盖面窄但命中要害（并发去重） |
| 7 | `test/runtime-stop.test.mjs` | 真行为（进程级） | 真 spawn server（`:23`）：`:42` 跨域 `Origin` POST `/api/runtime/stop` → 403 且进程仍活；`:46` 同源 → 200 且 `:52` `exit.code === 0`；`:53` 断言 `.service-instance.json` 已删除 | 有效 | 1 个用例。这是 `/api/runtime/stop` 唯一的正向行为覆盖 |
| 8 | `test/visibility-browser.test.mjs` | 真行为（E2E） | 双浏览器页：后台页错过收藏 SSE → 回前台读服务端最终态；`:73` `waitUntil:"domcontentloaded"` + `:74` `waitForFunction(window.StateSync?.hydrated)`；`:83-98` monkey-patch `StateSync.refreshFromEvent` + 伪造 `document.visibilityState`；`:103-118` 后台页不提前绘制；`:120-154` 回前台两端 revision 一致；`:165-217` 真杀服务重启，验 SSE `onerror`/`onopen` 计数、断线重连后两端一致、`error_prone` 同步 | **有效（最高价值的端到端测试）** | 无 Playwright 时 **skip**（默认配置下永不运行）；`:65` 用 `DAGUAN_TEST_BROWSER`，与其它 5 个浏览器测试用的 `DAGUAN_CHROMIUM_EXECUTABLE` **不一致**（见 P2-9）；`window.StateSync` 是内部实现细节，重构即碎 |
| 9 | `test/electron-security.test.mjs` | 混合（5 真行为 + 12 静态） | 真行为：`:11` `isTrustedAppUrl`/`navigationAction`（`daguan://` 白名单、`javascript:`、`file://`）、`:22` `resolveWebAsset`（含 `/%2e%2e/` 编码穿越）、`:30` `proxyHeaders`（丢 host/origin/cookie）、`:39` `windowPreferences` deepEqual + `shouldStopService`、`:106` `downloadSaveDialogOptions`（Windows 非法字符清洗）。静态：`:47` `source.indexOf("registerSchemesAsPrivileged") < source.indexOf("app.whenReady()")`、`:56-62` 单实例锁正则、`:64-73` forge ignore 正则、`:75-92` CSP/HTML 正则、`:94-104` titlebar overlay、`:124-134`、`:136-146`、`:148-164`、`:165-169`、`:170-174`、`:175-179`、`:181-197` | 部分有效 | **名实不符**：文件名叫「安全」，17 例里 12 例是源码 grep。`:87` `assert.doesNotMatch(html, /<script\s*>(?!\s*<\/script>)[\s\S]*?<\/script>/i)` **只查内联 `<script>`，完全漏掉内联事件处理器 `onclick=`/`onerror=`**，而同文件 `:77` 又承认 `script-src 'self' 'unsafe-inline'`；`:170-174` 断言 workflow 只匹配 `v????.??.??-r*` 且 `doesNotMatch /-\s*"v\*"/` —— **把「CI 不覆盖 v1.0.x」这个缺陷锁成了预期行为**（见 P1-4/P2-4） |
| 10 | `test/desktop-updater.test.cjs` | 真行为（依赖注入） | `desktop/updater.cjs`：假 EventEmitter autoUpdater + 假 `setTimeout` 记录 timers；feed = `${UPDATE_FEED_URL}/1.0.0`、启动延迟、`checking`/`not-available` 状态序列、下载后**必须**用户显式点重启才 `installDownloadedUpdate()`、`:59` `DAGUAN_UPDATE_FEED_URL` 覆盖、`:61-64` 错误日志脱敏（不含 secret/token/example.test）、`:68-76` 非打包与非 Windows 不配置也不检查 | 有效 | 4 个用例；用假 timer 意味着真实调度时序未被覆盖 |
| 11 | `test/backup-migration.test.mjs` | 真行为 | `vm.runInNewContext(web/backup-migration.js)` 取真 `DaguanBackupMigration`：逐题/逐批注按修改时间合并、`:47` 时间戳歧义保留目标行、不迁移 `ai_draft`/`appearance`/`ai_preferences`/`shortcuts`、`:59` 接受旧 map-only 备份、`:72` 非法/无内容备份抛错 | 有效 | 3 个用例；只覆盖「导入」，不覆盖导出侧 |
| 12 | `test/desktop-package.test.mjs` | 真行为 | `forge.config.js` + `scripts/prepare-desktop-package.mjs`：`:11` 读 `web/assets/landing/local-mark.ico` 断言魔数 `[0,0,1,0]` 且 forge icon/setupIcon 一致；`:18-29` forge ignore 正则（`/data/state.json` 忽略、`/README.md` 不忽略、`/web/data/shards/questions.json` 不忽略）；`:31-65` 真 `mkdtemp` + 调 `prepareDesktopPackage(root)`，验分片改名 `shard-01.json`/`shard-02.json` 且字节不变、未被引用的 `旧题库-核心.json` → `unreferenced-01.json` | 有效 | 断言的是打包中间产物命名约定（实现细节），改名即碎；但字节不变这条断言有实际价值 |
| 13 | `test/ai-service.test.mjs` | 真行为 | `local-server/ai-service.mjs`：`:9` `validateBaseUrl` 拒绝内嵌凭据/公网 HTTP、允许 `http://127.0.0.1:1234/v1`；`:30-56` `aiFixture(t)` 起两个**真实** `http.createServer`（上游 mock SSE + 下游 `service.streamChat`）；覆盖逐字符分块 `<think>` 过滤（`:59`）、模型列表/Key 掩码/`keyHint` 含 `••••`（`:71`）、流式与非流式 `f.calls.at(-1).stream`（`:83`）、旧历史读取过滤但原文件保留 PRIVATE（`:99`）、非流式兼容误返 SSE（`:112`）、上游 401 与用户 stop 不落历史（`:120`） | 有效（质量高） | **`:17` 与 `:32` 都写 `createStore(root)`（省略第二参数）→ 设置 `DAGUAN_DATA_DIR` 时两个用例共享同一目录，`:71` 的 `raw.profiles[0].key` 读到 `:15` 用例写的 `sk-secret-key`，断言 `:80` 失败（见 P1-1，实测复现）** |
| 14 | `test/ai-ui-browser.test.mjs` | 真行为（E2E） | 4 个用例（`:25/:70/:104/:187`）：AI 配置真实交互（新增/模型/测试/Key 保留/流式/旧版共享）、单题与连续模式长回答独立滚动+拖宽不丢草稿+批注、新版阅读（导航/展开/设置/段落跳转/草稿/流式阅读位置）、`:187` Electron 实际 preload（桌面顶栏无外层空白） | 有效 | `:23 const skip=!playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';` → 默认 skip 3 个；`:187` 再加 `process.platform!=='win32'`。`:172` 截图到 `DAGUAN_AI_SCREENSHOT_DIR` |
| 15 | `test/choice-grading.test.mjs` | 真行为 | `vm.createContext({})` + `vm.runInContext(web/choice-grading.js)` 取真 `ChoiceGrading`：`:9` 可靠单选才判；`:12` 对 6 种非法题面（空 `correct_labels`、越界 C、多标签、空 options、`multiple_choice`、重复 label）断言 `rules.answer()` 返 null；`:15` `rules.patch()` 选错降级 learning + favorite + error_prone，改对保留标记与 `last_practiced_at` | 有效 | 只 2 个用例；产品文件仅 28 行，覆盖比合理 |
| 16 | `test/choice-ui-browser.test.mjs` | 真行为（E2E） | **实际 12 个用例**（`:49` 的 `for(const ui of ['new','old'])for(const mode of ['single','multi'])` 内联 4 个 + `:68` 4 + `:90` 2 + `:99` 2 + `:112` 2）：自动展开判题反馈/改选/收藏易错/重复点击不刷新 `last_practiced_at`、500 与 409 重试保留最新快速改选、预览模式只判题零 PATCH 写入、离线作答刷新后恢复并自动补同步、无可靠答案不自动判错+多选保持原行为 | **有效（质量最高的测试）** | **`:25 await page.route('**/api/state/events',r=>r.abort())` 主动掐掉 SSE**，因此 `:34` 的 `waitForLoadState('networkidle')` 才可用 —— 这是仓库内**已有的正确范式，但没有推广**到 font-scale/study-report/answer-scroll（见 P1-2）。全部用例 `assert.deepEqual(errors,[])` 收集 `pageerror`（好） |
| 17 | `test/chapter-navigation.test.mjs` | 静态（数据） | 只 `readFileSync('../web/data/categories.json')` + `'../web/data/category_questions.json'`，自己在测试里实现 `children/flattenLeaves/find`（`:8-27`），硬编码 id 断言：`:33` `leaves.slice(0,6)` = `[331,344,345,347,346,348]`、`:39` `categoryQuestions["321"].length === find(321).question_count`、`:40` `categoryQuestions["331"].length === 11`、`:46-47` 相邻顺序 | **名不符实** | **完全没有任何章节导航代码被执行**；被测的「导航」逻辑（`app-legacy.js` 5949 行 / `app-new.js` 6302 行里的目录树）零覆盖。它测的是数据文件的自洽性，却占着「导航测试」的名字 |
| 18 | `test/font-scale-browser.test.mjs` | 真行为（E2E） | spawn server（`DAGUAN_DATA_DIR: temp`、`DAGUAN_OPEN_BROWSER:'0'`、`stdio:[...,'ipc']`），轮询 `temp/.service-instance.json` 的 `owner.port` + `/api/health`；chromium 用 `DAGUAN_CHROMIUM_EXECUTABLE`；`:51 await page.waitForLoadState('networkidle')`；验字号 1.5 点目录章节、进小节、reload 后保持 | **写法缺陷（必超时）** | **实测**：`:51:14` `page.waitForLoadState: Timeout 30000ms exceeded.`。常驻 SSE `/api/state/events` 让网络永不 idle。无 Playwright 时 skip |
| 19 | `test/answer-scroll-browser.test.mjs` | 真行为（E2E） | 可选 `DAGUAN_SCROLL_ELECTRON=1` 走 `playwright._electron.launch({executablePath: out/大观园数学-win32-x64/DaguanMath.exe})`；否则 chromium `serviceWorkers:'block'`；读 `web/data/shards/线性代数.json` 的 `id===435`；断言 Space 只滚动 `#question-content`、`#show-answer-btn` 的 `getBoundingClientRect().y` 不变、反复显隐不产生外层滚动 | **写法缺陷（必超时）** | **实测**：`:14` `'test timed out after 30000ms'`（`:44` 的 `networkidle` 吃掉整个预算）。无 Playwright 时 skip |
| 20 | `test/study-activity.test.mjs` | 真行为 | `study-activity.mjs`：`:13` 本地 04:00 分日、跨月跨年与 DST（America/New_York 2026-03-08）、非法时区抛 `/时区/`、days 超范围抛 `/范围/`、days=365 出 365 条；`:26` 学习量范围去重、新题/复习互斥、浏览收藏答案不算学习；`:36` 一遍过排除旧题/提前看答案/改答案/不可靠题型；`:46` 错题独立重做才计攻克、反复切状态不刷新；`:59` 收藏来源 manual/automatic/both 且重复不重计；`:67` 连续学习允许今天未学、章节 ≥5 首答样本才判 weak；`:76` 真 fs 并发 `Promise.all([store.append(...)])` 验串行写入不丢事件、merge 幂等；`:91` 写入损坏 JSON 后 `export()` reject 且**文件内容保持 `{bad` 不被覆写**；`:96` 完整事件备份恢复首次学习、旧备份基线不覆盖已知事件 | **有效（质量高）** | 8 个用例，边界（DST、时区、损坏文件、并发）覆盖扎实。DST 用例依赖 `America/New_York` 时区数据，Node 版本变化理论上可能影响（未验证） |
| 21 | `test/study-report-browser.test.mjs` | 真行为（E2E） | **5 个用例**（`:58` 的 `for (const ui of ['new','old']) for (const mode of ['single','multi'])` 4 个 + `:77` 1 个）：首答口径（纯浏览不计、看答案再隐藏不算一遍过）、365 天热力图、跨窗口更新、离线待同步事件、`QuotaExceededError` 备份缓存、restore 幂等。`context.route('**/app-legacy.js*')` 注入改写版源码，把 `window.DaguanDesktopSwitch = setUiVersion;` 换成 `window.__studyTest={state,renderSingle,renderFeed,setView,applyMode}; window.DaguanDesktopSwitch = setUiVersion;` | **写法缺陷（5 个全超时）** | **实测**：`:58:74` ×4 与 `:77:1` 全在 `:41:14` `page.waitForLoadState: Timeout 30000ms exceeded.`（在 `goto()` 内）。`const skip = !playwright && 'Install Playwright...'` 是**字符串真值**，无 Playwright 时 5 个全 skip。用 `route` 改写产品源码属侵入式手法，产品改结构即碎 |
| 22 | `test/ui-contract.test.mjs` | **静态** | 模块顶部 13 个 `fs.readFileSync` 读入 `web/legacy.html`→html、`web/app-legacy.js`→app、`web/legacy.css`→css、`web/index.html`→newHtml、`web/ui-bootstrap.js`、`web/app-new.js`、`web/styles-new.css`、`local-server/server.mjs`→server、`scripts/build-windows-exe.mjs`、`packaging/sea-entry.cjs`、`web/data/lecture-video-mappings.json`、`web/data/lecture-video-unmatched-audit.json`、`web/data/id_index.json`；45 个用例全是 `assert.match(app,/regex/)`/`assert.doesNotMatch(css,...)`，如 `:409` 断言 server 含 `/if \(incoming\.seen != null\) entry\.seen = incoming\.seen === true/`；`:453` 额外读 `web/design-tokens.css`+`web/styles.css` | **部分有效（大量假阳性风险）** | **不执行任何产品代码**。改个变量名就红（假阴性），而行为回归只要字符串还在就仍绿（假阳性）。45 个用例的量级制造了「UI 契约已被充分测试」的错觉。价值在于能挡住「不小心删掉某段 UI 代码」，但挡不住任何逻辑错误 |
| 23 | `test/landing-entry.test.mjs` | 真行为 | `:6-7` 从 `web/app2.js` 用 `indexOf` 切片抽出 `getLandingEntry(`…`async function init()` 之间的**真实源码**，`:11-29` 在 `vm.createContext` 注入 mock `goHome/openPreviewAccess/setView/openChapterMenu/...` 并记录 `calls`；覆盖白名单解析（`?purge=1`→null、`?entry=unknown`→'home'、`?entry=https://example.com`→'home'）、有/无学习记录的 resume 分支、预览锁定拦截并保留 pending 目的地（6 个目的地循环）、公开预览仍可看章节与教程、复习/收藏/记录直达、备份入口不触发同步写入、`:92-119` 首次使用直达入口等 `hydrateStores` promise 且不被欢迎弹窗覆盖 | 有效 | 切片方式脆弱：`app2.js` 里 `async function init()` 改名或换行即导致切片失败（会以「找不到」形式报错，尚可接受） |
| 24 | `test/download-links.test.mjs` | 静态（文档） | `:15-32` 对 6 个文档/页面文件断言不含 `releases/latest/download/`、都含百度网盘 `surl=VrW0Z-ThDSM7f_xx7uCUZw` 与 `dgy1`、不含归档包 `surl=VJwUxgElbURfw7Aj4Gpy4Q`；`:34` 断言 `web/landing.html` 指向 GitHub blob main 的配置指南；`:39/:47` 只断言 `docs/release-v1.0.0.md` 与 `docs/release-v1.0.1.md` 的资产名 | **不是产品行为测试** | 它测的是**文档里的网盘链接字符串**。`:5 const RELEASE = "v1.0.0"` **定义后从未使用（死变量）**。v1.0.2–v1.0.10 的 release 说明**完全无覆盖**（而 `docs/` 下 v1.0.2/.3/.7/.8/.9/.10 都存在） |
| 25 | `test/dual-ui.test.mjs` | 真行为（少量静态） | `:6` 读 `web/ui-version.js` 在 `vm.runInNewContext` 跑，`:11` 注入 mock `window/localStorage/location`：首次默认 new、存 old 时重定向一次且保留 `entry=resume`、`/legacy.html` 不重定向、corrupt 值不重定向、appearance 迁移幂等且不动 `daguan_local_progress_v1`、`:39` `targetUrl()` 保留 path/query/hash 并加 `uiSwitch=1`；`:42-70` 对 `app2.js` 与 `app-legacy.js` **两个文件**切出真实 `setUiVersion` 源码在 vm 里跑，验 no-op/保存失败/AI 流式中断都不导航；`:73-87` 从 `scripts/build-windows-exe.mjs` 切片跑 `shouldBundle`/`packageServiceWorker`，验 8 个资产进包、`web/landing.html` 不进包 | 有效 | `:68-69` 是**纯 `app.includes(teacher)` 静态断言**（3 个教师名 + 3 个共享存储 key），混在行为测试里 |
| 26 | `test/new-ui-core.test.mjs` | **自证** | 无 | **无效（0 覆盖，本仓库最严重的测试有效性问题）** | **不 import 任何产品模块、不读任何文件、vm=0**。15 个 `describe/it` 全部是「自己定义 mock → 断言这个 mock」：`:7-18` 定义 `mockLocalStorage` 再断言自己的 setItem/getItem；`:20-31` 自己实现 `validVersions.includes(pref)`；`:35-49` 断言 `JSON.parse(JSON.stringify(x))` 等于 x；`:51-60` 断言 `JSON.parse('{favorites: [')` 抛 SyntaxError；`:64-77`、`:79-85`、`:89-104`、`:108-125` 断言自己构造的对象；**`:129-152` 在测试里定义 `debounce` 函数再测试这个自己定义的同名函数**；`:156-178` 用模板字符串拼 URL 再断言拼出来的字符串；`:181-201` 定义 `sharedKeys` 数组再断言 `includes`。`:205 console.log('新版 UI 核心功能单测完成')` |
| 27 | `test/new-ui-compat.test.mjs` | 真行为 | `:8-57 createContext(initialStorage)` 手搓 DOM 沙箱（`document.visibilityState`、`addEventListener` 收集监听、`documentElement.style.setProperty` 记录外观变量、`querySelector:()=>null`、`createElement` 假节点；`localStorage`/`sessionStorage` 用 Map），`sandbox.window = sandbox; sandbox.globalThis = sandbox; vm.createContext(sandbox)` 后 `vm.runInContext` 真跑 `web/ui-version.js` 与 `web/app-new.js`；默认 `fetch: () => Promise.reject(new Error("tests do not fetch by default"))`；`:59-64 syncElements(document)` 桩掉 10 个元素 id。48 个用例覆盖同步预览/应用/冲突、SSE 补读、草稿键迁移、外观迁移、真实目录混合节点、AI profileId 协议、SSE 跨块解析、备份导出、进度键形状、三态掌握、字号、批注导入、恢复对账、离线待同步 409 重试、跨节导航、小庆祝 | **有效（本仓库最厚的真行为覆盖）** | 1197 行/48 例，是 `app-new.js`（6302 行）的主要保障。风险：手搓 DOM 沙箱与真实浏览器语义有差距（如 `querySelector` 恒 null），浏览器侧仍需 E2E 兜底——而 E2E 默认全 skip（见 P0-2） |
| 28 | `test/new-ui-catalog.test.mjs` | 真行为 | 同一沙箱范式（vm 跑 `web/app-new.js`），12 个用例覆盖目录范围筛选、级联列、9 级路径、历史筛选 | 有效 | 依赖 `web/data/categories.json` 真实数据，数据变动即红 |
| 29 | `test/new-ui-search.test.mjs` | 真行为 | `:6-21 loadApp()` 造 sandbox（mock navigator/localStorage/sessionStorage/location/document，`fetch` 直接 reject）后 `vm.runInContext` 真跑 `web/ui-version.js` 和 `web/app-new.js`；`:23` 用真实 `App.normalizeSearchText` 断言 `\dfrac{x}{2}`≡`\frac{x}{2}`、`\left(a\leq b\right)`≡`(a <= b)`、`A×B`≡`A\cdot B`；`:31` 读 `web/data/search_index.json`+`manifest.json` 断言 `rows.length === manifest.total` 且路径/来源字段可命中；`:43` 验快捷键冲突检测 | 有效 | 3 个用例，命中数学公式归一化这个真实痛点 |
| 30 | `test/remote-gateway.test.mjs` | 真行为（真 HTTP） | `createRequire('../desktop/remote-gateway.cjs')` 取 `createRemoteGateway`/`SESSION_AGE`；`:14-19` 真起上游 http server：未登录 401、`/index.html` 302、`/__remote/login` 200、跨域 Origin 登录 403、cookie `HttpOnly; Secure; SameSite=Lax` 且过期时间误差 <10s、PATCH 无 Origin 403、`/api/ai/chat` 透传 SSE 且 content-type 变 `text/plain; charset=utf-8`；`:52` 循环断言 7 个管理/敏感路由（含 `/api/runtime/stop%2f` 编码绕过、`/service-worker.js`、`/api/state/events`）都非 200；`:56` revokeSessions 后 401；`:58` 伪造 Host 返回 421；`:61` 密码连错 5 次第 5 次 429、改密码需旧密码 | 有效 | 2 个用例但断言密度高，安全边界（编码绕过、Host 伪造、限流）都测到了。这是远程访问唯一的测试 |
| 31 | `test/cloudflare-tunnel.test.mjs` | 真行为（依赖注入） | `createRequire('../desktop/cloudflare-tunnel.cjs')` 取 `createTunnelManager`/`downloadCloudflared`；`:12-16` 假子进程 EventEmitter：named setup 三次 API 调用（POST/PUT/POST）、ingress 指向 `http://127.0.0.1:49287`、只持久化加密后的 connector token（`:36` 断言文件里没有 API token 与 connector secret）、切换 quick 只启一个替换连接器、DNS 冲突回滚 DELETE 且不留配置文件、公网登录页 200 才置 connected、ingress PUT 403 先删 tunnel、`:114` `downloadCloudflared` 校验官方 release SHA-256（错值抛 `/校验值不匹配/`） | 有效 | 6 个用例。用假子进程 + 假 HTTP，真实 cloudflared 二进制行为未覆盖（设计上合理） |

### 未纳入 `npm test` 的 9 个手工/冒烟脚本（同样不在 CI）

| # | 文件 | 类型 | 覆盖什么 | 有效性 | 关键缺陷 |
|---|---|---|---|---|---|
| 32 | `test/desktop-cdp-smoke.mjs` | 手工冒烟 | `createRequire(DAGUAN_PLAYWRIGHT_MODULE)`（未设即抛）、`connectOverCDP(DAGUAN_CDP_URL\|\|http://127.0.0.1:9222)`、找 `daguan://app/` 页、截图到 `DAGUAN_SCREENSHOT_DIR\|\|docs/desktop-stage2/screenshots` | 仅人工 | 需人工先起带 CDP 的 Electron；无断言（只截图）；无入口脚本 |
| 33 | `test/desktop-csp-smoke.mjs` | 手工冒烟 | `DAGUAN_CDP_ENDPOINT\|\|http://127.0.0.1:9224`，`await import(pathToFileURL(DAGUAN_PLAYWRIGHT_MODULE).href)`（**与其它文件加载方式不同**），收集 console/pageerror/requestfailed/`daguan://app/(index\|legacy).html` 响应头 | 仅人工 | 与 `desktop-cdp-smoke.mjs` 高度重叠，两套 CDP 变量名/端口 |
| 34 | `test/desktop-lifecycle-smoke.mjs` | 手工冒烟 | `DAGUAN_DESKTOP_EXE` + `execFileSync`，真启 exe + 临时 dataDir/profileDir | 仅人工 | **这是 `electron-main.cjs`（381 行）生命周期唯一的任何形式覆盖**，却不在 `npm test`、不在 CI（见 P1-3） |
| 35 | `test/squirrel_update_e2e.py` | 手工 E2E | 404 行 Playwright async：隔离 Squirrel QA 应用 + 本地 HTTP feed + 离线/共享态，产物在 `.build/stage4-update-qa` | 仅人工 | **更新链路唯一的自动化验证**，但需人工准备 QA 应用与 feed，且不在 CI。**未能验证**其最近一次是否真正跑通（需要安装/启动真实 Squirrel 应用） |
| 36 | `test/remote-live-smoke.mjs` | 手工冒烟 | `createRemoteGateway`+`createTunnelManager`，`DAGUAN_LAUNCHER_KIND:'desktop'`，需真网络 | 仅人工 | 依赖真实 cloudflare 账号与外网；不可在 CI 复现 |
| 37 | `test/remote-electron-smoke.mjs` | 手工冒烟 | 裸 CDP WebSocket 打 `/json`（端口取 argv 或 9228） | 仅人工 | 无断言，仅打印 |
| 38 | `test/browser-package-smoke.mjs` | 手工冒烟 | spawn `dist/DaguanMath-windows-x64.exe`（`DAGUAN_RUNTIME_ROOT`+`DAGUAN_NO_BROWSER=1`），等 `.service-instance.json` | 仅人工 | 依赖 `dist/` 里 2026-09-28 的旧产物（见 P2-6） |
| 39 | `test/migration_browser_playwright.py` | 手工 E2E | `DAGUAN_MIGRATION_TEST_URL\|\|http://127.0.0.1:8097`、`DAGUAN_CHROME_PATH\|\|C:\Program Files\Google\Chrome\Application\chrome.exe` | 仅人工 | 233 行、硬编码 Windows Chrome 路径；用 sync Playwright（与其它 async 不一致） |
| 40 | `test/browser-retirement-playwright.py` | 手工 E2E | 要求 `PORT`+`DAGUAN_DATA_DIR`，断言 `#browser-retirement` 面板与 `#app` inert | 仅人工 | 34 行，只覆盖浏览器版退役提示 |

### 附：第 32 个被 test 脚本引用、但不在 `test/` 下的文件

| 文件 | 类型 | 覆盖什么 | 有效性 | 关键缺陷 |
|---|---|---|---|---|
| `sync-extension/test/protocol.test.js` | 真行为（CJS） | `require("../protocol.js")`：`parseImportDocument` + `buildImportPlan`（`summary.changes`/`favoriteAdds`/`masteryChanges`）、`buildMobileSyncDocument` 不含 `access_token`、非法 mastery 抛 `/mastery 无效/`、Android 进度格式兼容且丢弃 `note` | 有效 | 4 个用例。**浏览器扩展本体 `bridge.js`(359)/`popup.js`(195)/`background.js`(120) 零测试引用**（见 §2.3） |

### 汇总统计

| 判定 | 文件数 | 说明 |
|---|---|---|
| 真行为（有效） | 20 | local-server / official-orphan / question-bank-updater / service-instance / visit-history / runtime-stop / visibility-browser / desktop-updater / backup-migration / desktop-package / ai-service / ai-ui-browser / choice-grading / choice-ui-browser / study-activity / study-report-browser / landing-entry / new-ui-compat / new-ui-catalog / new-ui-search / remote-gateway / cloudflare-tunnel（含混合者） |
| 混合（部分有效） | 3 | `electron-security`（5/17 行为）、`local-server`（9 纯函数+2 store）、`dual-ui`（含 2 条静态） |
| 纯静态断言 | 4 | `ui-contract`（45 例）、`chapter-navigation`、`download-links`、9 个冒烟脚本中的截图类 |
| **自证（0 覆盖）** | **2** | **`new-ui-core`（15 例）、`web-sync`（4 例）= 19 个用例零覆盖** |
| 手工/冒烟（不在 npm test） | 9 | 全部无 CI 入口 |

---

## 2. 覆盖缺口清单

### 2.1 `local-server/server.mjs`（721 行）路由 × 测试覆盖对照

统计方法：对 `test/` 与 `sync-extension/test/` 全目录 grep 每个路由字符串，统计命中**文件数**；命中数为 0 = 无任何测试引用。括号内是引用它的测试文件。

| 路由 | 用途 | 测试引用 | 判定 |
|---|---|---|---|
| `/api/health` | 健康检查 / `apiProtocol` | 19 个文件 | ✅ 覆盖充分 |
| `/api/state` | 状态读取 | 74 命中 | ✅ |
| `/api/state/questions` | 题目状态批量/单条 PATCH | 14 命中（含 `choice-ui-browser` 的 409/500 重试） | ✅ |
| `/api/state/events` | SSE 事件流 | 6 命中（`visibility-browser` 断线重连、`remote-gateway` 拒绝列表） | ⚠️ 只有 1 个正向用例，且默认 skip |
| `/api/runtime/stop` | 优雅停机 | 9 命中（`runtime-stop` 正向 1 例 + `remote-gateway` 拒绝） | ⚠️ 仅 1 个正向用例 |
| `/api/visit-history` | 访问历史 | 6 命中（`service-instance`） | ✅ |
| `/api/study-activity` | 学习活动 | 4 命中（`study-report-browser`） | ⚠️ 默认 skip |
| `/api/study-activity/export` | 导出 | 2 命中 | ⚠️ 默认 skip |
| `/api/study-activity/events` | SSE | 2 命中 | ⚠️ 默认 skip |
| `/api/catalog/refresh` | 目录刷新 | 1 命中（`remote-gateway` 的**敏感路由拒绝**列表） | ❌ **无正向测试** |
| `/api/question-bank/status` | 题库状态 | **0** | ❌ 无测试 |
| `/api/access/status` | 访问状态 | **0** | ❌ 无测试 |
| `/api/access/unlock` | 解锁 | **0** | ❌ 无测试（安全相关） |
| `/api/access/lock` | 锁定 | **0** | ❌ 无测试（安全相关） |
| `/api/study-activity/merge` | 合并 | **0** | ❌ 无测试 |
| `/api/visit-history/merge` | 合并 | **0** | ❌ 无测试 |
| `/api/state/last-study` | 上次学习位置 | **0** | ❌ 无测试（且前端 P1 缺陷正在此链路上，见报告 04） |
| `/api/state/migrate` | 状态迁移 | **0** | ❌ 无测试 |
| `/api/ai/diagram` | AI 图形 | **0** | ❌ 无测试（`ai-service.test.mjs` 直接调 `service.diagram()`，**绕过 HTTP 层**） |
| `/api/ai/runs` | AI 运行记录 | **0** | ❌ 无测试 |
| `/api/ai/conversations` | AI 会话 | **0** | ❌ 无测试 |
| `/api/integrations/cxyonly/*`（**全部 10 条**：status / login / logout / pull preview+apply / push preview+apply / reconcile preview+apply / export） | 官网同步集成 | **0** | ❌ **整块零测试**。注意 `cxyonly-client.mjs`(233) 有 mock fetch 单测（`local-server.test.mjs:80`），但**路由层与 preview/apply 编排零覆盖** |

**结论**：`server.mjs` 至少 **20 条路由**（含整个 cxyonly 集成块）在测试里**从未被正向请求过**。`npm test` 覆盖的是「状态读写 + 锁/停机」这一块，而「访问控制、题库更新入口、官网同步」三大块是空白。

关键行参考：`:22 const BUILD_VERSION = "2026.09.27-shared-service-r1";`（注意：这是**旧日历版本号**，与 `package.json` 的 `1.0.10` 不同源）、`:29 const store = createStore(ROOT, process.env.DAGUAN_DATA_DIR);`、`:90 privateApiPath`、`:354 async function route(req,res)`、`:644 http.createServer`、`:648-676` 实例锁获取循环（60 × 250ms，`SERVICE_INSTANCE_REUSED`/`HELD`/`READY`）、`:700-721` shutdown（写 `event: server-stopping`、`server.close(async()=>{ await questionBank?.stop(); await lease.release(); process.exit(0); })`，挂 SIGINT/SIGTERM/disconnect/`message{type:'shutdown'}`）。

### 2.2 `desktop/electron-main.cjs`（381 行）IPC / 生命周期 × 测试覆盖对照

**总判定（实测）**：`electron-main.cjs` **从未被 `npm test` 执行过**。唯一的「覆盖」是 `test/electron-security.test.mjs` 对它做 `readFileSync` + 正则匹配（12 个静态用例）。唯一的行为覆盖是 `test/desktop-lifecycle-smoke.mjs`——不在 `npm test`、不在 CI、需要人工提供 `DAGUAN_DESKTOP_EXE`。

| 位置 | 功能 | 覆盖形式 | 判定 |
|---|---|---|---|
| `:2` | `electron-squirrel-startup` 引入 | 静态正则（`electron-security`） | ⚠️ 仅文本 |
| `:15` | `protocol.registerSchemesAsPrivileged([{scheme:"daguan",...}])` | 静态：`:47` 断言 `indexOf` 顺序先于 `app.whenReady()` | ⚠️ 仅文本 |
| `:27` | `app.requestSingleInstanceLock()` | 静态正则（`:56-62`） | ⚠️ 仅文本 |
| `:162` | `validIpc(event)`（`sender===mainWindow.webContents && senderFrame===mainFrame && policy.isTrustedAppUrl(...)`） | `policy.mjs` 的 `isTrustedAppUrl` 有真行为单测；**`validIpc` 本身零执行** | ❌ 逻辑无测试 |
| `:185` | `app.setLoginItemSettings({ openAtLogin, path: process.execPath, ... })` | **0** | ❌ **无任何测试**。这是报告 02 的 P1-01（开机启动在升级后静默失效）所在行 |
| `:252` | `createWindow` | 仅 `desktop-lifecycle-smoke`（人工） | ⚠️ |
| `:267` | `setWindowOpenHandler` | 静态 | ⚠️ |
| `:268` | `will-navigate` | 静态 | ⚠️ |
| `:306` | `app.whenReady` | 静态（顺序断言） | ⚠️ |
| `:327` | `protocol.handle("daguan", serveAppRequest)` | `resolveWebAsset` 有真行为单测；handler 装配零执行 | ⚠️ |
| `:328` | `session.defaultSession.on("will-download")` | `downloadSaveDialogOptions` 有真行为单测 | ⚠️ 部分 |
| `:380` / `:381` | `before-quit` → `requestQuit` / `before-quit-for-update` | 仅 `desktop-lifecycle-smoke`（人工） | ⚠️ |
| `ipcMain.handle("daguan:window")` `:332`（minimize/maximize/close/print/switch） | 窗口控制 | `ai-ui-browser` 的 Windows 专属用例间接触碰 | ⚠️ |
| `ipcMain.handle("daguan:maximized")` `:343` | 最大化状态 | **实测：`web/*.js`、`web/*.html`、`desktop/preload.cjs` 里 grep `maximize-state\|maximized\|daguan:maximize` = 0 命中** | ❌ **死通道：渲染进程无法到达** |
| `ipcMain.handle("daguan:app:version")` `:344` | 版本 | 无正向测试 | ❌ |
| `ipcMain.handle("daguan:update:check")` `:345` | 检查更新 | `desktop-updater.test.cjs` 测 `updater.cjs` 逻辑，**不测 IPC 层** | ⚠️ |
| `ipcMain.handle("daguan:update:install")` `:351` | 安装更新 | 同上 | ⚠️ |
| `ipcMain.handle("daguan:startup")` `:352` / `"daguan:startup:get"` `:353` | 开机启动设置 | **0** | ❌ **无测试**（对应 P1-01 缺陷） |
| `ipcMain.handle("daguan:remote")` `:354` | 远程访问开关 | **0** | ❌ 无测试 |
| 主→渲染 `daguan:state-changed` `:176` | 状态变更推送 | `visibility-browser` 间接（SSE 路径） | ⚠️ 默认 skip |
| 主→渲染 `daguan:update-state` `:199` | 更新状态推送 | `desktop-updater.test.cjs` 验状态序列，不验 IPC 送达 | ⚠️ |
| 主→渲染 `daguan:maximize-state` `:262/:263` | 最大化状态推送 | **实测 0 命中** | ❌ **死通道：无人监听** |

`desktop/preload.cjs`（145 行）暴露的通道（invoke `daguan:window` `:91/:104`、`daguan:update:install` `:97`、`daguan:update:check` `:100`、`daguan:startup:get` `:109`、`daguan:startup` `:110`、`daguan:app:version` `:111`、`daguan:remote` `:112`；on `daguan:update-state` `:114`、`daguan:state-changed` `:140`）与主进程基本对齐，**唯一对不上的就是 `maximized`/`maximize-state` 这一对**。

### 2.3 产品模块 × 测试引用（grep 命中数，0 = 无任何测试引用）

| 模块 | 行数 | 引用数 | 判定 |
|---|---|---|---|
| `local-server/instance-lock.mjs` | 184 | **0** | ❌ **零引用**（只被 `service-instance.test.mjs` 间接通过 server 进程触碰） |
| `local-server/catalog.mjs` | 59 | **0** | ❌ 零引用 |
| `scripts/package-windows-release.mjs` | 85 | **0** | ❌ 零引用（发布打包脚本无测试） |
| `sync-extension/bridge.js` | 359 | **0** | ❌ 零引用 |
| `sync-extension/popup.js` | 195 | **0** | ❌ 零引用 |
| `web/study-report.js` | 61 | **0** | ❌ 零引用（`study-report-browser` 测的是页面行为，不是这个模块） |
| `web/landing.js` | 79 | **0** | ❌ 零引用 |
| `web/data-bank-client.js` | 58 | **0** | ❌ 零引用 |
| `web/visit-history-client.js` | 50 | **0** | ❌ 零引用 |
| `web/ai-panel-layout.js` | 87 | **0** | ❌ 零引用 |
| `web/ai-reading.js` | 107 | **0** | ❌ 零引用 |
| `web/remote-access.js` | 16 | **0** | ❌ 零引用 |
| `web/section-celebration.js` | 26 | 1 | ⚠️ |
| `desktop/preload.cjs` | 145 | 19 | ✅（但多为静态 grep） |
| `desktop/electron-main.cjs` | 381 | 静态为主 | ⚠️ 见 §2.2 |
| `scripts/build-windows-exe.mjs` | 202 | 2 | ⚠️ 只测 `shouldBundle`/`packageServiceWorker` 两个函数 |
| `scripts/prepare-desktop-package.mjs` | 33 | 1 | ✅ |
| `forge.config.js` | — | 2 | ✅ |
| `web/app-legacy.js` | 5949 | 16 | ✅（静态为主） |
| `web/app-new.js` | 6302 | — | ✅（`new-ui-compat`/`catalog`/`search` 真行为） |

### 2.4 关键路径完全无测试（汇总）

1. **桌面主进程生命周期与 IPC**：`electron-main.cjs` 381 行无执行型测试（含开机启动 `setLoginItemSettings`、`validIpc` 鉴权、单实例锁）。
2. **官网同步集成路由**：`/api/integrations/cxyonly/*` 全部 10 条路由 + preview/apply/reconcile 编排。
3. **访问控制**：`/api/access/status|unlock|lock` 三条安全相关路由。
4. **题库更新 HTTP 入口**：`/api/question-bank/status`、`/api/catalog/refresh`（只有 `question-bank-updater.mjs` 的模块级单测）。
5. **AI 历史与会话路由**：`/api/ai/runs`、`/api/ai/conversations`、`/api/ai/diagram`（HTTP 层）。
6. **发布打包链**：`scripts/package-windows-release.mjs`、Squirrel 产物组装、`RELEASES` 生成。
7. **浏览器扩展**：`bridge.js`/`popup.js`/`background.js` 三个文件共 674 行零覆盖（只有 `protocol.js` 有测试）。
8. **浏览器版退役流程**：`browser-retirement.js`(83) 只被人工 `.py` 脚本引用。

---

## 3. CI 审查结论

`.github/workflows/` 下**只有 1 个** workflow：`windows-release.yml`（4385 字节，108 行）。文件历史 4 个 commit：`af0933e release: prepare desktop v1.0.1 online update`（最新）、`965dab4 feat: add SignPath code signing pipeline and policy docs`、`3f1a811 fix: harden Windows release packaging and publish exe`、`70784cf feat: add Windows one-click release package and r7 sync flow`。

### 3.1 触发条件（静态确认）

- `on.push.tags: ["v????.??.??-r*"]` + `workflow_dispatch`（第 3-7 行）。
- `permissions: contents: write, actions: read`；job `windows-package` on `windows-latest`。
- **tag glob 实际行为（实测，基于本仓库 tag 清单）**：本仓库同时存在两套 tag。
  - 日历式 20 个：`v2026.09.07-r7`、`v2026.09.07-r8`、`v2026.09.19-r10`、`v2026.09.22-r11`…`v2026.09.22-r26`、`v2026.09.27-r27`（最新日历 tag，commit `b5e01e3`，2026-09-27 11:10:44 +0800）。
  - SemVer 11 个：`v1.0.0`…`v1.0.10`（`v1.0.3` = 2026-09-29 09:55:46 +0800，`v1.0.10` = 2026-10-01 00:10:14 +0800）。
  - ⇒ `v????.??.??-r*` **确实匹配到那 20 个日历 tag**，所以「从未触发过」的说法**不准确**；准确表述是：**它只覆盖旧日历命名（末个 `v2026.09.27-r27`，早于向 `v1.0.x` 的切换），对全部 11 个 `v1.0.x` tag 零匹配**。README `:81` 已宣布「桌面版首发使用 SemVer 版本 `v1.0.0`」，即从 v1.0.0 起的每一次发版都不触发这个流水线。
  - **未能验证**：我无法访问 GitHub 查看该 workflow 的 Actions 运行历史（需要网络与仓库权限），因此「20 个日历 tag 时期是否真的成功跑过」属未能验证。仅 `workflow_dispatch` 可以人工触发。

### 3.2 步骤与门禁

步骤顺序：checkout@v4 → setup-node@v4（node 24, cache npm）→ `npm ci` → **Build unsigned Windows executable** → **`Run tests: npm test`（第 51-52 行）** → upload-artifact@v7（`if SIGNPATH_ORGANIZATION_ID != ''`）→ signpath/github-action-submit-signing-request@v3 → Verify and adopt signed executable（`Get-AuthenticodeSignature` 必须 `Valid`）→ Assemble Windows release package（`DAGUAN_SKIP_BUILD=1 npm run package:windows:release`）→ softprops/action-gh-release@v2（`generate_release_notes: true`，files = `dist/DaguanMath-windows-x64.exe` / `.exe.sha256` / `.zip` / `.zip.sha256`）。

env 中 `RELEASE_TAG: ${{ github.ref_type == 'tag' && github.ref_name || '' }}`（第 24 行）；建包步骤里 `if ($env:RELEASE_TAG) { $env:DAGUAN_VERSION = $env:RELEASE_TAG }`，复制 `dist/大观园数学题库.exe` → `dist/DaguanMath-windows-x64.exe`，读 `dist/DaguanMath-version.txt` 写 `metadata_version` 到 `GITHUB_OUTPUT`。

### 3.3 CI 关键问题（静态确认）

1. **门禁只有一个，且排在建包之后**：`npm test` 是唯一的质量门禁，位置在「Build unsigned Windows executable」**之后**——测试红了，包已经建好，浪费构建时间（不是灾难，但顺序不合理）。
2. **无 lint、无 `npm run verify`**：题库校验（`npm run verify`）完全不在 CI 里。题库分片改动的正确性只靠人工。
3. **只产浏览器单文件版，桌面安装包无 CI**：`npm run package:windows` = `node scripts/build-windows-exe.mjs`（SEA 单文件 EXE）。workflow 全文**没有任何** `electron-forge` / `make` / `nupkg` / `RELEASES` / Squirrel 相关步骤 → 桌面版真正的安装包（`Setup.exe` + `.nupkg` + `RELEASES`）**完全没有 CI**，只能靠本机 `npm run package:desktop:windows` + 手工上传。这与报告 02 的 P1-02（发布零自动化）互相印证。
4. **CI 跑的是「绿但空心」配置（实测对照）**：workflow 不设 `DAGUAN_DATA_DIR`，`package.json` 的 devDependencies 里也没有 Playwright → 对应我实测矩阵里的第一行：`tests 265 / pass 239 / fail 0 / skipped 26`，**exit 0**。也就是说 **CI 绿灯时，26 个浏览器用例一个都没跑，且那个真实的 `DAGUAN_DATA_DIR` 隔离缺陷被隐藏**。

---

## 4. 文档一致性矛盾表

| 文档 | 行号 | 文档声称 | 代码/仓库实际 | 严重度 |
|---|---|---|---|---|
| `README.md` | `:93` | 「当前公开桌面版 v1.0.3 尚未签名…SHA-256 `5bd38b60cc08aac401cb337cd9198b7e8d4ae797cc142a997e06e2a99f7cd412`」 | `package.json.version = 1.0.10`，最新 tag `v1.0.10` | P1（落后 7 版） |
| `README.md` | `:197` | 「截至 v1.0.3，桌面安装器及应用仍未签名」 | 同上 | P1 |
| `README.md` | `:205` | 「v1.0.3 的预期结果为 `NotSigned`」 | 同上 | P1 |
| `README.md` | `:81` | 「桌面版首发使用 SemVer 版本 `v1.0.0`」 | 与 tag 实际一致（v1.0.0…v1.0.10） | — |
| `README.md` | `:169-172` | 开发命令只列 `npm ci` / `npm start` / `npm test` / `npm run verify` | **不提 Playwright，也不提 `DAGUAN_DATA_DIR`**。按此说明跑 `npm test` 得到「26 skip / 0 fail」的假绿灯；而 `AGENTS.md` 又要求设 `DAGUAN_DATA_DIR`（设了就红） | P1（文档与 AGENTS.md 互相矛盾） |
| `README.md` | `:108-109` | 浏览器包命令 | 与 `package.json` 的 `package:windows` / `package:browser:windows` 一致 | — |
| `docs/CODE_SIGNING_POLICY.md` | `:7` | 「截至桌面版 v1.0.3」 | 实际 v1.0.10 | P1 |
| `docs/CODE_SIGNING_POLICY.md` | `:11` | 「当前公开桌面版：v1.0.3 Release」+ 同一 SHA | 实际 v1.0.10 | P1 |
| `docs/CODE_SIGNING_POLICY.md` | `:36` | 「v1.0.3 的签名状态应为 `NotSigned`」 | 实际 v1.0.10 | P1 |
| `CHANGELOG.md` | 第 5 行 | 最新版本条目 `## 桌面版 v1.0.1（2026-09-28）` | **v1.0.2–v1.0.10 共 9 个版本无条目** | P1 |
| `CHANGELOG.md` | `:31` | 「题库 6183 题」 | `manifest.total = 6521` | P2 |
| `CHANGELOG.md` | `## 待发布` 段 | 仍写 SignPath 待批 | 已有 `signing-submission-v102` 等产物，且 release-v1.0.7/8/9/10 文档已存在 | P2 |
| `docs/` | — | release 说明有 v1.0.0/.1/.2/.3/.7/.8/.9/.10 | **缺 `docs/release-v1.0.{4,5,6}.md`** | P2 |
| `docs/desktop-stage0-acceptance.md` | `:7` | 题量 6342 | 6521 | P2（过期历史值） |
| `docs/desktop-stage0-report.md` | `:25` | 题量 6342 | 6521 | P2 |
| `docs/desktop-stage1-acceptance.md` | `:7` | 题量 6342 | 6521 | P2 |
| `docs/desktop-stage1-report.md` | `:26` | 题量 6342 | 6521 | P2 |
| `docs/desktop-stage2-report.md` | `:27` | 题量 6342 | 6521 | P2 |
| `docs/desktop-stage3-report.md` | `:28` | 题量 6342 | 6521 | P2 |
| `docs/UI-REDESIGN-CONTROL.md` | `:14` | 题量 6342 + 「此前 80 测试通过」 | 6521；测试文件现为 32 个被引用、265 个用例 | P2 |
| `docs/release-v1.0.7.md` | `:17` | 6521 题（41 张缺图） | ✅ 与实测一致 | — |
| `docs/release-v1.0.8.md` | `:13` | 6521 题（41 张缺图） | ✅ | — |
| `docs/干净环境安装验证.md` | L57–L79 | 13 项验收清单 | **全部是未勾选的 `- [ ]`** → 正式 `Setup.exe` 的「全新用户首次安装」零实测 | P2 |
| `AGENTS.md`（**未跟踪，不在 git**） | — | 「隔离测试应显式指定临时目录」「单元和集成测试应使用临时数据目录」 | **与仓库实际冲突**：一旦设 `DAGUAN_DATA_DIR`，`npm test` 变红（实测 `238 pass / 1 fail`，exit 1） | P1 |
| `AGENTS.md` | — | 把 `test/electron-security.test.mjs` 列为必需回归门禁 | 该文件 17 例里 12 例是源码 grep，不是行为门禁 | P2 |
| `AGENTS.md` | — | 以 `docs/release-v1.0.0.md` 为发布状态依据 | 落后 10 个版本 | P2 |
| `test/electron-security.test.mjs` | `:170-174` | 断言 workflow 只匹配 `v????.??.??-r*` 且 `doesNotMatch /-\s*"v\*"/` | **把「CI 不覆盖 v1.0.x」这个缺陷固化成预期行为**：将来有人修好 tag glob，这个测试反而会红 | P2 |

**关于「题量三处不一」的更正（实测）**：此前流传的「`tools/verify-web-data.mjs` 报 6342」**是错的**。`tools/verify-web-data.mjs:59-60` 只是拿 `manifest.total` 去比对，**没有硬编码任何数字**。我实跑 `npm run verify` 的输出是：

```
题库验证通过：6521 题，6521 个唯一题号；警告：缺少 41 张题图
```

而 `web/data/manifest.json` 为 `total: 6521`、`source_total: 6362`、`types {subjective 4669, single_choice 1848, multiple_choice 4}`、`asset_count 1242`，6 个分片计数合计 6521。所以**真实矛盾只有一处**：文档里的过期历史值 6342 / 6183 vs 实际 6521。

---

## 5. 发现清单

标注：**实测** = 本次会话跑了命令、有原始输出；**静态确认** = 读源码/配置/数据文件得出；**未能验证** = 说明理由。

### P0-1 · 19 个用例是「自证型假测试」，零覆盖却显示通过（实测 + 静态确认）

- **位置**：`test/new-ui-core.test.mjs`（205 行，15 个 `describe/it`）、`test/web-sync.test.mjs`（64 行，4 个用例）。
- **证据**：
  - `test/new-ui-core.test.mjs` 不 `import` 任何产品模块、不 `readFileSync`、`vm` 出现 0 次（实测 grep 计数：vm=0、readFile=0）。`:129-152` 在测试文件里**自己定义 `debounce` 函数**再测试这个自己定义的函数；`:7-18` 定义 `mockLocalStorage` 再断言自己的 `setItem/getItem`；`:20-31` 自己实现 `validVersions.includes(pref)`；`:156-178` 用模板字符串拼 URL 再断言拼出来的字符串。
  - `test/web-sync.test.mjs` 第 4-9 行**在测试里重新实现** `toLocalMastery`，`:11` 断言这个本地实现；`:18-26` 手工构造 `merged` 再断言它等于 `local`；`:28-43` 手工 `Object.entries(...).map(...)` 再断言自己构造的结果；`:45-63` 同样。
  - **实测（补充证据，比「自证」更严重）**：`toLocalMastery` 在 `web/*.js`、`local-server/*.mjs`、`desktop/*.cjs`、`desktop/*.mjs` 里 **0 命中** —— 这个函数**在产品代码里根本不存在**。所以 `web-sync.test.mjs` 不只是「自己实现一遍再断言自己」，它测的是一个**从未存在过的函数**；如果它想守护的是某个真实存在过的同步逻辑，那段逻辑现在已经不在了（或被改名/移除了），而没有任何测试因此变红。
  - 实测 `npm test` 中这两个文件的 19 个用例**全部 pass**。
- **机制**：断言的两端都由测试文件自己产生，被测产品代码从未进入执行路径。这类测试对代码变更是**免疫**的——产品代码怎么改都仍绿，因为根本没读它。
- **影响**：①`test/new-ui-core.test.mjs` 的文件名与 `:205 console.log('新版 UI 核心功能单测完成')` 制造「新版 UI 核心功能已单测覆盖」的假象，而新版 UI 的真实行为保障只来自 `new-ui-compat`/`catalog`/`search`；②它是 test 脚本的第一个文件，绿灯从第一行开始；③19 个用例（占 265 的 7.2%）的通过数被计入「239 pass」这个给人安全感的数字里。
- **修复建议**：**直接删除这两个文件**（它们提供的信息量为零），或按 `new-ui-compat.test.mjs` 的沙箱范式重写——真 `vm.runInContext(web/app-new.js)` 后断言产品函数。对 `test/web-sync.test.mjs` 的处理**已经明确**：`toLocalMastery` 在产品代码里 0 命中（实测），所以不存在「改成 import 真实实现」这个选项，**应当直接删除**；若怀疑它守护的同步逻辑仍以别的名字存在，删除前用 `git log --follow` 追一下这个测试文件的历史，看它当初对应的是哪个已消失的函数。

### P0-2 · `npm test` 默认「绿但空心」，CI 门禁形同虚设（实测）

- **位置**：`package.json:23`（test 脚本）、`package.json` devDependencies、`.github/workflows/windows-release.yml:51-52`。
- **证据**（实测配置矩阵，全部本次会话跑出）：

  | 配置 | tests | pass | fail | skip | exit | 场景 |
  |---|---|---|---|---|---|---|
  | 无 `DAGUAN_DATA_DIR` + 无 Playwright | 265 | 239 | 0 | **26** | **0** | **CI 用的就是这一种** |
  | 有 `DAGUAN_DATA_DIR` + 无 Playwright | 265 | 238 | 1 | **26** | 1 | `AGENTS.md` 要求的方式 |
  | 有 `DAGUAN_DATA_DIR` + 有 Playwright | 265 | 257 | 7 | 0 | 1 | 完整环境 |

- **机制**：26 个浏览器用例全部用 `const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE'` 之类的条件静默跳过，而 **Playwright 不在 `dependencies` 也不在 `devDependencies`**（devDependencies 只有 `@electron-forge/cli`、`@electron-forge/maker-squirrel`、`electron`）。`node --test` 对 skip 的默认行为是**计入 tests 但不计 fail**，所以套件报绿。
- **影响**：①CI 每次发版都在「26 个用例一个没跑」的情况下放行；②`electron-security.test.mjs` 被 `AGENTS.md` 当作必需门禁，但它 17 例里 12 例是 grep，真正有安全价值的 `visibility-browser` 反而在 skip 名单里；③26 个 skip 恰好等于浏览器用例总数，意味着**所有 E2E 覆盖在生产 CI 中等于不存在**。
- **修复建议**：①把 `playwright` 加进 `devDependencies`（或 CI 步骤里 `npx playwright install chromium`）；②在 `package.json` 的 test 脚本加 `--test-force-exit`（可选）并在 CI 里显式断言 `skipped === 0`；③更彻底的做法是让这些文件在没有 Playwright 时**直接 fail 而非 skip**（或用一个 `test:unit` / `test:e2e` 两个脚本把无浏览器环境与有浏览器环境分开，CI 跑 `test:e2e`）。

### P1-1 · `AGENTS.md` 要求的隔离方式会让 `npm test` 变红（实测，已最小化复现）

- **位置**：`local-server/store.mjs:5`；`test/ai-service.test.mjs:17` 与 `:32`；`test/local-server.test.mjs:20`。
- **证据**：
  - `local-server/store.mjs:5`：`export function createStore(rootDir, dataDirOverride = process.env.DAGUAN_DATA_DIR) {`；`:6`：`const dataDir = path.resolve(dataDirOverride || path.join(rootDir, "data"));`
  - 实测只跑 `test/ai-service.test.mjs`：(A) 不设 `DAGUAN_DATA_DIR` → `tests 8 / pass 8 / fail 0`；(B) 全新空目录 `data2` → `pass 7 / fail 1`；(C) 另一个全新空目录 `data3` → `pass 7 / fail 1`。
  - 失败原文：`test/ai-service.test.mjs:71`「无模型可保存并获取列表，旧档案默认流式，Key 留空保留」→ `AssertionError` at `test/ai-service.test.mjs:80`：`+ actual 'sk-secret-key'` / `- expected 'test-only-key'`。
- **机制**：`test/ai-service.test.mjs:15` 的用例（`:17 createStore(root)` 省略第二参数）写入 `key:"sk-secret-key"` 的档案；`:71` 的用例走 `aiFixture`，其 `:32 const store = createStore(root);` **同样省略第二参数**，于是两个「应该各自独立」的用例绑到同一个 `DAGUAN_DATA_DIR`，`:80` 的 `raw.profiles[0].key` 读到的是另一个用例写的档案。因为**同一个文件内**互相污染，换全新空目录也照样失败（排除脏数据与跨文件污染）。`test/local-server.test.mjs:20` 有同一写法。
- **影响**：①`AGENTS.md`（以及 README 若照抄）要求「测试一律用临时 `DAGUAN_DATA_DIR`」，但一旦照做，套件就是红的 → **规范不可执行**，实际结果是所有人（和 CI）都不设这个变量，于是 P0-2 的假绿灯被固化；②这个缺陷本身也说明「同文件用例隔离」没有被验证过。
- **修复建议**：二选一。①**改测试**：`createStore(root)` → `createStore(root, path.join(root, "data"))`（`test/ai-service.test.mjs:17`、`:32`，`test/local-server.test.mjs:20`），让用例真正各自独立。②**改产品**：去掉 `store.mjs:5` 的默认参数，强制调用方显式传 `dataDirOverride`，把「环境变量兜底」这一隐式行为收回到 `server.mjs:29`（它本来就显式传了 `process.env.DAGUAN_DATA_DIR`）。**推荐 ①+② 都做**：默认参数是这次污染的根因，而显式传参是唯一能防止它再次发生的方式。

### P1-2 · 浏览器测试用 `networkidle` 撞常驻 SSE，7 个用例必超时（实测）

- **位置**：`test/font-scale-browser.test.mjs:51`、`test/study-report-browser.test.mjs:41`（被 5 个用例共享的 `goto()`）、`test/answer-scroll-browser.test.mjs:44`（表现为用例级 30s 超时）。
- **证据**（实测，`npm test` 带 Playwright，原始日志 `%TEMP%\dg-audit-10\full-test-with-pw.txt`）：
  - `test/font-scale-browser.test.mjs:16` → `page.waitForLoadState: Timeout 30000ms exceeded.` at `:51:14`
  - `test/study-report-browser.test.mjs:58:74` ×4（new/single、new/multi、old/single、old/multi）→ 同一 `:41:14` 超时
  - `test/study-report-browser.test.mjs:77:1` → 同一 `:41:14` 超时
  - `test/answer-scroll-browser.test.mjs:14` → `'test timed out after 30000ms'`
- **机制**：页面加载后前端会建立常驻 SSE 连接 `/api/state/events`（`server.mjs` 的路由之一），网络**永不** idle，`waitForLoadState('networkidle')` 必然等到 30s 超时。这是**测试写法缺陷，不是产品 bug**。
- **对照（静态确认）**：`test/choice-ui-browser.test.mjs:25` 已经有正确做法——`await page.route('**/api/state/events', r => r.abort())` 主动掐掉 SSE，因此它 `:34` 的 `networkidle` 可用且 12 个用例全绿。`test/visibility-browser.test.mjs:73` 用的是 `waitUntil:"domcontentloaded"` + `:74 waitForFunction(() => window.StateSync?.hydrated && window.StateSync.available)`，也是正确做法。**这个范式已在仓库内存在，只是没推广到这三个文件。**
- **影响**：这 7 个用例是**设计上就永远不会通过**的——即使 CI 装了 Playwright，它们也会红。换句话说，安装 Playwright（P0-2 的修复）之前，必须先修这一条，否则「修好 P0-2」会立刻变成 7 个红。
- **修复建议**：①在这三个文件里加 `await page.route('**/api/state/events', r => r.abort())`（照抄 `choice-ui-browser` 的写法）；或 ②把 `waitForLoadState('networkidle')` 换成 `waitUntil:'domcontentloaded'` + 针对真实就绪条件的 `waitForFunction`（照抄 `visibility-browser`）。②更稳健，因为 abort SSE 会改变被测行为（离线语义）。建议 `study-report-browser` 用 ②（它要测离线待同步），`font-scale`/`answer-scroll` 用 ①。

### P1-3 · 桌面主进程（381 行）与官网同步集成（10 条路由）零执行型测试（静态确认 + 实测 grep）

- **位置**：`desktop/electron-main.cjs`（381 行）、`local-server/server.mjs` 的 `/api/integrations/cxyonly/*`、`local-server/instance-lock.mjs`（184 行）、`local-server/catalog.mjs`（59 行）、`sync-extension/{bridge,popup,background}.js`（674 行）。
- **证据**：①`electron-main.cjs` 在 `test/` 下只被 `test/electron-security.test.mjs` 以 `readFileSync` + 正则方式引用，**从未被执行**；唯一行为覆盖 `test/desktop-lifecycle-smoke.mjs` 不在 `npm test`、不在 CI。②实测 grep：`instance-lock` 0 命中、`catalog.mjs` 0 命中、`bridge.js` 0、`popup.js` 0、`package-windows-release.mjs` 0、`study-report.js` 0、`landing.js` 0、`data-bank-client` 0、`visit-history-client` 0、`ai-panel-layout` 0、`ai-reading` 0、`remote-access` 0。③`/api/access/status|unlock|lock`、`/api/question-bank/status`、`/api/state/last-study`、`/api/state/migrate`、`/api/ai/runs`、`/api/ai/conversations`、`/api/ai/diagram`、`/api/study-activity/merge`、`/api/visit-history/merge`、`/api/catalog/refresh`（正向）、以及 cxyonly 全部 10 条路由的测试引用数均为 **0**。
- **机制**：`test/` 的覆盖重心在「状态存储 + 实例锁 + 新版 UI 客户端逻辑」，主进程与集成路由落在盲区。IPC 层的测试需要真启动 Electron，仓库内只有 `ai-ui-browser.test.mjs:187` 那一个 Windows 专属用例做到了，其余 IPC 全靠静态 grep。
- **影响**：①报告 02 的 P1-01（开机启动 `path: process.execPath` 指向版本化目录，升级后静默失效）落在 `electron-main.cjs:185`，**测试完全无法发现**；②`/api/access/unlock|lock` 是访问控制，无测试；③整个官网同步（pull/push/reconcile 的 preview+apply）无路由级测试，只有 `cxyonly-client.mjs` 的 mock 单测和 `sync-format.mjs` 的纯函数单测——**编排层的错误（例如 preview 与 apply 用了不同的参数）不会被任何测试发现**。
- **修复建议**：①为 cxyonly 的 preview/apply/reconcile 三条编排加 mock fetch 的集成测试（沿用 `question-bank-updater.test.mjs` 覆写 `globalThis.fetch` 的手法）；②把 `test/desktop-lifecycle-smoke.mjs` 改造成可在 CI 跑的用例（用 `out/大观园数学-win32-x64/DaguanMath.exe` + 临时 dataDir，断言窗口创建、`daguan:startup:get` 返回值、`setLoginItemSettings` 调用参数）；③`instance-lock.mjs` 与 `catalog.mjs` 直接补单测（它们都是纯逻辑，成本低）。

### P1-4 · CI 不产桌面安装包 + tag glob 对 v1.0.x 零匹配（静态确认）

- **位置**：`.github/workflows/windows-release.yml:3-7`（触发）、全文（步骤）。
- **证据**：①tag glob `v????.??.??-r*` 对 11 个 `v1.0.x` tag 零匹配（对 20 个旧日历 tag 匹配，末个 `v2026.09.27-r27`）；②全文 grep `electron-forge` / `make` / `nupkg` / `RELEASES` = **0 命中**；唯一的打包命令是 `npm run package:windows` = `node scripts/build-windows-exe.mjs`（SEA 浏览器单文件版）；③`package:desktop:windows`（`electron-forge make`，产 Squirrel 安装包）**不在 workflow 里**。
- **机制**：workflow 写于日历式发版时期，`README.md:81` 宣布切换到 SemVer `v1.0.0` 之后没人更新 glob；同时桌面版改用 electron-forge 之后也没把 make 加进 workflow。
- **影响**：①桌面安装包（`Setup.exe`/`.nupkg`/`RELEASES`）完全依赖本机手工 `npm run package:desktop:windows` + 手工上传 GitHub Release —— 与报告 02 的 P1-02 一致；②`out/make/squirrel.windows/x64/` 里的产物停在 **v1.0.8**（`DaguanMathDesktop-1.0.8-full.nupkg`，2026-09-30 15:30:02），落后 `package.json` 两个版本，正是手工流程的副产物。
- **修复建议**：①把 glob 改成同时覆盖两套命名（`v[0-9]*` 或显式 `v1.*` + 保留 `v????.??.??-r*`）；②加一个 job 跑 `npm run package:desktop:windows` 并把 `dist/make/**` 的 `Setup.exe`/`.nupkg`/`RELEASES` 一起上传；③把 `npm run verify` 加进门禁。**注意**：`test/electron-security.test.mjs:170-174` 会把「glob 只匹配日历式」断言为预期，修 glob 时**必须同步改这个测试**（见 P2-4）。

### P1-5 · 文档版本落后 7 个版本（静态确认）

- **位置**：`README.md:93`、`:197`、`:205`；`docs/CODE_SIGNING_POLICY.md:7`、`:11`、`:36`；`CHANGELOG.md` 第 5 行。
- **证据**：三处文档均写「公开版 v1.0.3」+ 同一 SHA-256 `5bd38b60cc08aac401cb337cd9198b7e8d4ae797cc142a997e06e2a99f7cd412`；`package.json.version = 1.0.10`，最新 tag `v1.0.10`（2026-10-01 00:10:14 +0800）；`CHANGELOG.md` 最新版本条目停在 `## 桌面版 v1.0.1（2026-09-28）`，v1.0.2–v1.0.10 共 9 个版本无条目；`docs/` 下缺 `docs/release-v1.0.{4,5,6}.md`。
- **机制**：发版流程里没有「更新 README/CHANGELOG/签名策略」这一步（与 P1-4 的发布零自动化同源）。
- **影响**：①用户按 README 校验 SHA-256 会得出「文件被篡改」的错误结论；②`docs/CODE_SIGNING_POLICY.md` 是 SignPath 申请材料的依据文档，写着一个 7 版之前的版本号和 SHA，**如果这份材料已提交，等于提交了过期事实**；③新接手的人无法从 CHANGELOG 了解 v1.0.2–v1.0.10 改了什么（这 9 个版本恰好包含 UI 大改与桌面版从日历式切 SemVer）。
- **修复建议**：①把三处版本号与 SHA 更新到 v1.0.10（SHA 从对应 Release 资产实测）；②补 CHANGELOG 的 v1.0.2–v1.0.10 条目（可依据 `docs/release-v1.0.*.md` 与 git log 回填）；③补 `docs/release-v1.0.{4,5,6}.md` 或在 CHANGELOG 里注明缺失原因；④在 `scripts/package-windows-release.mjs` 或发版检查表里加一条「同步 README/CHANGELOG/CODE_SIGNING_POLICY 版本号」。

### P2-1 · `ui-contract.test.mjs` 45 个用例全是源码正则（静态确认）

- **位置**：`test/ui-contract.test.mjs`（465 行，45 用例，26 次 `readFileSync`）。
- **证据**：模块顶部读入 13 个文件（`web/legacy.html`、`web/app-legacy.js`、`web/legacy.css`、`web/index.html`、`web/ui-bootstrap.js`、`web/app-new.js`、`web/styles-new.css`、`local-server/server.mjs`、`scripts/build-windows-exe.mjs`、`packaging/sea-entry.cjs`、`web/data/lecture-video-mappings.json`、`web/data/lecture-video-unmatched-audit.json`、`web/data/id_index.json`），每个用例是 `assert.match(app,/regex/)` 或 `assert.doesNotMatch(css,...)`；例如 `:409` 断言 server 含 `/if \(incoming\.seen != null\) entry\.seen = incoming\.seen === true/`；`:453` 额外读 `web/design-tokens.css`+`web/styles.css`。**不执行任何产品代码。**
- **机制**：断言对象是源码文本，与运行时行为无因果关系。
- **影响**：①**假阴性**：变量重命名、格式化、换行都会红，重构成本被人为抬高；②**假阳性**：只要那段字符串还在（哪怕逻辑已改坏）就绿；③45 个用例的量级是 `npm test` 里第二多的（仅次于 `new-ui-compat` 的 48），在「265 个用例」的叙事里贡献了不成比例的虚假信心。
- **修复建议**：保留其中确实防「误删关键代码」的少数几条（例如 CSP meta 存在性、`design-tokens.css` 被引用），其余迁移到真行为测试；对样式契约改用真实 DOM 断言（`new-ui-compat` 的沙箱已具备条件）。

### P2-2 · `chapter-navigation.test.mjs` 名不符实（静态确认）

- **位置**：`test/chapter-navigation.test.mjs`（48 行，3 用例）。
- **证据**：只 `readFileSync('../web/data/categories.json')` 与 `'../web/data/category_questions.json'`，测试自己实现 `children/flattenLeaves/find`（`:8-27`）后断言硬编码 id（`:33` `leaves.slice(0,6)` = `[331,344,345,347,346,348]`、`:40` `categoryQuestions["331"].length === 11`）。**零行章节导航产品代码被执行。**
- **影响**：`app-legacy.js`(5949) 与 `app-new.js`(6302) 里的目录树/级联/路径展开逻辑零覆盖；这个文件名会让人误以为导航已被测。更严重的是报告 04 的 P1-01（`findCategoryById` 只搜顶层科目导致「继续学习」全失效）恰好就在这个盲区里——**如果这个测试真的测导航，那个 P1 缺陷本可以被发现**。
- **修复建议**：改名（如 `catalog-data-integrity.test.mjs`）以免误导；另起真行为测试，用 `new-ui-compat` 的沙箱跑 `app-new.js` 的 `findCategoryById`/`walk`，并**至少覆盖「叶子章节 id 能否解析回顶层科目」这一条**（即报告 04 P1-01 的回归测试）。

### P2-3 · `download-links.test.mjs` 是文档字符串测试，且只覆盖 2 个 release（静态确认）

- **位置**：`test/download-links.test.mjs`（54 行，4 用例）。
- **证据**：`:5 const RELEASE = "v1.0.0"` **定义后从未使用（死变量）**；`:15-32` 对 6 个文档/页面断言网盘链接字符串；`:39/:47` 只断言 `docs/release-v1.0.0.md` 与 `docs/release-v1.0.1.md` 的资产名，**v1.0.2–v1.0.10 完全无覆盖**（而 `docs/` 下 v1.0.2/.3/.7/.8/.9/.10 都存在）。
- **影响**：①它占据「下载链接测试」之名，实际测的是文档里的网盘 URL 是否被替换过；②新增的 9 个 release 说明文档里的资产名/校验和没有任何自动检查，这与 P1-5 的文档漂移同源。
- **修复建议**：①删掉死变量；②把 release 文档的检查改成「遍历 `docs/release-*.md`」而不是硬编码两个版本；③真正该测的是 `scripts/package-windows-release.mjs` 生成的 `dist/*.sha256` 与实际文件一致（该脚本目前零测试，见 §2.3）。

### P2-4 · 安全测试的 CSP 断言有漏洞，且把 CI 缺陷锁成预期（静态确认）

- **位置**：`test/electron-security.test.mjs:87`、`:170-174`。
- **证据**：①`:87` `assert.doesNotMatch(html, /<script\s*>(?!\s*<\/script>)[\s\S]*?<\/script>/i)` 只匹配内联 `<script>` 块，**完全漏掉内联事件处理器**（`onclick=`、`onerror=`、`onload=` 等）——而内联事件处理器恰恰是 CSP `unsafe-inline` 下最容易引入 XSS 的载体；同文件 `:77` 又承认 `script-src 'self' 'unsafe-inline'`，说明这个宽松策略是被知晓的。②`:170-174` 断言 workflow 只匹配 `v????.??.??-r*` 且 `doesNotMatch /-\s*"v\*"/`，即**把 P1-4 的缺陷固化为「预期行为」**。
- **影响**：①「安全测试」给出了内联脚本已被检查的印象，实际漏了最危险的一类；②将来有人修好 CI 的 tag glob，`electron-security.test.mjs` 会**变红并阻止修复**——一个测试在保护一个缺陷。
- **修复建议**：①把 `:87` 的断言扩展为同时匹配 `/on(click|error|load|mouse\w+|focus|blur)\s*=/i` 并检查 `web/*.html`；②删掉 `:170-174` 里对 glob 字面量的断言，改为断言「workflow 覆盖 `v1.0.x`」（与 P1-4 的修复同步）。

### P2-5 · 死 IPC 通道：`daguan:maximized` / `daguan:maximize-state`（实测）

- **位置**：`desktop/electron-main.cjs:343`（`ipcMain.handle("daguan:maximized")`）、`:262/:263`（`mainWindow.webContents.send("daguan:maximize-state", ...)`）。
- **证据**（实测 grep）：在 `web/*.js`、`web/*.html`、`desktop/preload.cjs` 里搜 `maximize-state|maximized|daguan:maximize` = **0 命中**。
- **机制**：`desktop/preload.cjs` 暴露的 `invoke` 列表里没有 `daguan:maximized`，监听的 `on` 列表里没有 `daguan:maximize-state`，因此渲染进程既无法调用那个 handler，也没人接收那个推送。窗口最大化状态的 UI 同步（若设计上需要）目前是断的。
- **影响**：①`ipcMain.handle("daguan:maximized")` 是不可达代码；②最大化状态变化不会通知前端，自定义标题栏在最大化/还原时可能不更新按钮图标——**未能验证**是否真的造成可见 UI 问题（需要人工操作桌面版观察标题栏按钮状态），但通道断裂是实测事实。
- **修复建议**：在 `desktop/preload.cjs` 里补 `onMaximizeState`（监听 `daguan:maximize-state`）与 `getMaximized()`（invoke `daguan:maximized`），或反过来删掉这两个死通道。

### P2-6 · 陈旧构建产物：`out/` 1461 MB、Squirrel 停在 v1.0.8、`dist/` 版本号是旧日历式（实测）

- **位置**：`out/`、`dist/`、`.build/`（均在 `.gitignore` 内）。
- **证据**（实测磁盘）：
  - `out/` 合计 **1461.0 MB**；`out/make/squirrel.windows/x64/` 内 `DaguanMathDesktop-1.0.8-full.nupkg`（405.1 MB，2026-09-30 15:30:02）+ `RELEASES` + `Setup.exe`（405.7 MB）→ **落后 `package.json` 两个版本**；`out/大观园数学-win32-x64/DaguanMath.exe` 234.7 MB，ProductVersion/FileVersion `1.0.10`、ProductName `大观园数学`、CompanyName `Evan26Ma`（2026-10-01 00:07）。
  - `dist/`：`大观园数学题库-windows-x64.zip`（295.93 MB，2026-09-07）、`大观园数学题库.exe` 与 `DaguanMath-windows-x64.exe`（351.25 MB，2026-09-28）、`DaguanMath-version.txt` = `2026.9.27.27`（**旧日历版本号**）。
  - `.build/` 约 100 个文件/目录的发布证据（`release-v1.0.7/8/9/10`、`windows-release`、`signing-submission-v102`、`sea`、`dual-ui`、大量 `*-tests.log`/`*-make.log`/`*-package.log`，以及 `make-local-v1.0.8.cjs`、`font-scale-packaged-smoke.mjs`、`study-packaged-smoke.mjs`、`verify-study-release.py`）。历史日志 `.build/ai-reading-v1.0.7-tests-final.log` 里留着一次真实失败：`test/visibility-browser.test.mjs:118` `2 !== 1` `ERR_ASSERTION`。
- **说明（不是缺陷）**：`dist/DaguanMath-version.txt` 的 `2026.9.27.27` 形式来自 `scripts/build-windows-exe.mjs:41-48 normalizeVersion(value)`（去前导 `v`、取前 4 组数字 clamp 到 65535、不足补 0），`:53 const version = normalizeVersion(process.env.DAGUAN_VERSION || PACKAGE_JSON.version || "0.0.0");`，`:79` 写出。这是 Windows 文件版本号格式的合法推导，**不是 bug**。
- **影响**：①`out/` 的 Squirrel 产物是 v1.0.8，任何人想手工验证「当前版本的安装包能否装」都会装到旧版；②`test/browser-package-smoke.mjs` 依赖 `dist/DaguanMath-windows-x64.exe`，而它是 2026-09-28 的旧产物 → 这个冒烟脚本验证的不是当前代码；③1.4 GB 陈旧产物长期占用磁盘。
- **修复建议**：①把 `out/make` 与 `dist/` 加入清理脚本（或 `npm run clean`）；②在 `package:desktop:windows` 前强制清空 `out/make`；③`browser-package-smoke.mjs` 改为先构建再冒烟，或在文档里明确它只对 `dist/` 里的既有产物有效。

### P2-7 · 文档里的题量过期值（6342 / 6183）与实际 6521 不符（实测）

- **位置**：`docs/desktop-stage0-acceptance.md:7`、`docs/desktop-stage0-report.md:25`、`docs/desktop-stage1-acceptance.md:7`、`docs/desktop-stage1-report.md:26`、`docs/desktop-stage2-report.md:27`、`docs/desktop-stage3-report.md:28`、`docs/UI-REDESIGN-CONTROL.md:14`（写 6342）、`CHANGELOG.md:31`（写 6183）。
- **证据**（实测）：`npm run verify` 输出「题库验证通过：6521 题，6521 个唯一题号；警告：缺少 41 张题图」；`web/data/manifest.json` `total: 6521`、`source_total: 6362`、`asset_count 1242`，6 个分片计数合计 6521。`tools/verify-web-data.mjs:59-60` 只拿 `manifest.total` 比对，**没有硬编码数字**。`docs/release-v1.0.7.md:17` 与 `docs/release-v1.0.8.md:13` 已正确写 6521（41 张缺图）。
- **说明**：此前流传的「`verify-web-data.mjs` 报 6342」是**误判**，已在 §4 更正。
- **影响**：阶段报告里的题量与实际差 179 题，会误导「题库规模是否稳定」的判断；`UI-REDESIGN-CONTROL.md:14` 还写「此前 80 测试通过」，而当前是 32 个被引用文件 / 265 个用例。
- **修复建议**：这些是历史阶段报告，建议**不改历史正文**，而是在 `docs/UI-REDESIGN-CONTROL.md` 顶部加一条「题量口径：6521（见 `web/data/manifest.json`）；阶段报告中出现的 6342 为当时值」的说明；`CHANGELOG.md:31` 的 6183 随 P1-5 的 CHANGELOG 回填一并修正。

### P2-8 · 干净环境安装验证 13 项全未勾选（静态确认）

- **位置**：`docs/干净环境安装验证.md` L57–L79。
- **证据**：13 项验收清单全是未勾选的 `- [ ]`。
- **影响**：正式 `Setup.exe` 的「全新用户首次安装」路径零实测；这与报告 02 的 P1-03 一致。
- **修复建议**：在 CI 或发版检查表里安排一次干净虚拟机安装验证并回填勾选；至少把「安装后能启动 + 能连上本地服务 + 题库可用」三项列为发版门槛。

### P2-9 · 浏览器可执行文件环境变量双轨（实测 grep）

- **位置**：`DAGUAN_CHROMIUM_EXECUTABLE`（`test/ai-ui-browser.test.mjs:34/:71/:106`、`test/answer-scroll-browser.test.mjs:47`、`test/choice-ui-browser.test.mjs:23`、`test/font-scale-browser.test.mjs:46`、`test/study-report-browser.test.mjs:30`）vs `DAGUAN_TEST_BROWSER`（`test/visibility-browser.test.mjs:65`、`test/desktop-cdp-smoke.mjs:77`）。
- **影响**：设了 `DAGUAN_CHROMIUM_EXECUTABLE` 时 `visibility-browser.test.mjs`（价值最高的 E2E）仍会用 Playwright 自带的浏览器；若机器上没装 Playwright 浏览器而只有系统 Chromium，这个测试会失败而其它浏览器测试能过——**排查成本高**。`test/desktop-csp-smoke.mjs:4` 又用第三个变量 `DAGUAN_CDP_ENDPOINT`（端口而非可执行文件，语义不同，可接受）。
- **修复建议**：统一为 `DAGUAN_CHROMIUM_EXECUTABLE`（`DAGUAN_TEST_BROWSER` 作为兼容别名读取），并在 README 的测试说明里列出全部相关环境变量。

### P3-1 · 9 个手工/冒烟脚本没有入口、没有文档（静态确认）

- **位置**：`test/desktop-cdp-smoke.mjs`、`test/desktop-csp-smoke.mjs`、`test/desktop-lifecycle-smoke.mjs`、`test/squirrel_update_e2e.py`、`test/remote-live-smoke.mjs`、`test/remote-electron-smoke.mjs`、`test/browser-package-smoke.mjs`、`test/migration_browser_playwright.py`、`test/browser-retirement-playwright.py`。
- **证据**：`package.json` 里没有对应 script；README `:169-172` 只列 4 条命令；CI 不引用任何一个。它们各自要求不同的环境变量（见 §1 附表），且 `desktop-cdp-smoke.mjs` 与 `desktop-csp-smoke.mjs` 功能重叠却用两套变量名和两个默认端口（9222 vs 9224）。
- **影响**：`desktop-lifecycle-smoke.mjs` 是 `electron-main.cjs` 生命周期唯一的任何形式覆盖，`squirrel_update_e2e.py` 是更新链路唯一的自动化验证——两者都因为「没有入口、没有文档」而实际上不会被跑。
- **修复建议**：加 `smoke:lifecycle` / `smoke:update` / `smoke:cdp` 等 script，并在 `docs/` 里写一份「手工冒烟脚本清单」说明每个脚本的前置条件与预期输出；合并 `desktop-cdp-smoke` 与 `desktop-csp-smoke`。

### P3-2 · `download-links.test.mjs:5` 死变量（静态确认）

- **位置**：`test/download-links.test.mjs:5` `const RELEASE = "v1.0.0";`
- **证据**：全文再未引用 `RELEASE`。
- **影响**：轻微，说明这个文件是从别的脚本复制改写而来（也从侧面说明它本来该测的是「某个版本」的链接）。
- **修复建议**：删除，或按 P2-3 改成遍历 release 文档。

### P3-3 · 缺 `docs/release-v1.0.{4,5,6}.md`（静态确认）

- **位置**：`docs/`。
- **证据**：存在 v1.0.0/.1/.2/.3/.7/.8/.9/.10，缺 .4/.5/.6。
- **影响**：这三个版本的发布内容无从查证（v1.0.4 恰好是 `daguan-build-v1.0.4` / `daguan-release-v1.0.4` 两个 checkout 目录对应的版本）。
- **修复建议**：从 git tag 的 commit message 与 CHANGELOG 回填，或在 CHANGELOG 里注明缺失。

---

## 6. 最值得先做的 3 条优化

### 第 1 条：让 `npm test` 从「绿但空心」变成可信门禁

**做什么**（顺序不能颠倒）：
1. 先修 P1-2（`test/font-scale-browser.test.mjs:51`、`test/study-report-browser.test.mjs:41`、`test/answer-scroll-browser.test.mjs:44` 的 `networkidle`），否则下一步会让套件立刻多 7 个红。
2. 把 `playwright` 加进 `devDependencies`，CI 里 `npx playwright install chromium`。
3. CI 的 `npm test` 步骤前加 `DAGUAN_DATA_DIR`（临时目录），并加一条「`skipped` 必须为 0」的断言。
4. 把 `npm test` 移到建包步骤**之前**，并补上 `npm run verify`。

**为什么先做**：这是所有其它判断的地基。当前 CI 的绿灯不代表任何东西——26 个浏览器用例从未运行，唯一的真实缺陷（P1-1）被配置掩盖。在这一条做完之前，**任何人说「测试通过了」都不可信**，包括后续修复的验收。做完之后，`npm test` 才会对 P1-1/P1-2 之外的问题真正报红。

### 第 2 条：删除或重写 19 个自证型假测试（P0-1）

**做什么**：删除 `test/new-ui-core.test.mjs`（15 例）与 `test/web-sync.test.mjs`（4 例），并从 `package.json:23` 的 test 脚本里移除。`web-sync` 这一侧**无需重写**——实测 `toLocalMastery` 在产品代码里 0 命中，它测的函数不存在；直接删除即可（若想追溯它守护过什么，`git log --follow test/web-sync.test.mjs` 看它当初对应的函数名）。

**为什么排第 2**：这是**性价比最高的一条**——删除代码、零风险、立即消除 7.2% 的虚假通过数。留着它们的危害不是「没测到」，而是「以为测到了」：`new-ui-core.test.mjs` 的文件名和 `:205` 的「新版 UI 核心功能单测完成」会让人不去补 `new-ui-compat`/`catalog` 之外的 UI 覆盖。同时它也是第 1 条的必要配套：装了 Playwright 之后，这 19 个用例仍会绿（因为它们本来就不依赖浏览器），虚假信心会被进一步放大。

### 第 3 条：修 `store.mjs:5` 的隐式默认参数，让「临时 `DAGUAN_DATA_DIR`」这个规范可执行（P1-1）

**做什么**：①`local-server/store.mjs:5` 去掉默认参数，强制显式传 `dataDirOverride`（`server.mjs:29` 本来就显式传了 `process.env.DAGUAN_DATA_DIR`，改动面很小）；②同步修 `test/ai-service.test.mjs:17`、`:32` 与 `test/local-server.test.mjs:20` 的 `createStore(root)` 调用。

**为什么排第 3**：它是**唯一一条既有产品代码价值、又能立刻消除一个红测试**的修复。①产品侧：一个「忘了传参数就静默绑到环境变量」的默认值是这次污染的根因，也是任何未来调用者的陷阱——去掉它让错误在编译/调用点暴露，而不是在测试里以「读到别人的数据」的形式出现；②流程侧：`AGENTS.md` 是唯一写明了测试隔离规范的文件，但它要求的做法当前会让套件变红，**规范因此被所有人忽略**。修好这一条，`AGENTS.md` 才从「不可执行的建议」变成真正的门禁，第 1 条里 CI 设置 `DAGUAN_DATA_DIR` 也才有意义。

**为什么不选「补 cxyonly 路由测试」或「CI 加桌面打包」**：那两条（P1-3、P1-4）的价值确实很高，但都是**新增大量工作量**，而上面三条是「先让已有的测试可信」。在门禁不可信的前提下补新测试，新测试同样可能被 skip 或不被 CI 跑到。

---

## 7. 合规确认

### 7.1 `git status` 复查（实测，报告写入前后）

```
## main...origin/main
```

- **0 个已跟踪文件被修改**。
- 未跟踪条目 **25 个**，与开工时的基线**完全一致**：`.zcodeignore`、`AGENTS.md`、`docs/SignPath申请材料草稿.md`、`docs/desktop-audit-20261001/`（**报告目录本身是未跟踪目录**）、`docs/ui-redesign/` 下 13 个文件、`docs/干净环境安装验证.md`、`web/index-new-backup.html`、`web/index-old-backup.html`、`web/ui-preview/`、`宣传视频使用介绍-临时.md`。
- 未执行 `git reset` / `git clean` / `git stash`；未推送、未部署、未发布。
- 本次唯一写入的仓库文件 = 本报告 `docs/desktop-audit-20261001/10-test-quality-docs.md`（位于原本就未跟踪的目录内）。

### 7.2 临时数据目录（实测）

- 使用 `DAGUAN_DATA_DIR=%TEMP%\dg-audit-10\{data,data2,data3}`、`PORT=18088`。
- **未读写 `%LOCALAPPDATA%\DaguanMath\data`**（当前有真实桌面版在运行）。
- **未读写仓库 `data/`**。
- 我创建的临时内容：`%TEMP%\dg-audit-10\data`、`%TEMP%\dg-audit-10\data2`、`%TEMP%\dg-audit-10\data3`、`%TEMP%\dg-audit-10\full-test-with-pw.txt`（全量测试原始日志，372 行）。

### 7.3 进程与端口清理（实测）

| 检查项 | 结果 |
|---|---|
| 端口 18088 | **无监听** |
| 端口 8080 | **无监听** |
| 我启动的 node 服务进程 | **0 个残留**（所有 `local-server/server.mjs` 子进程已随测试结束退出） |
| 我启动的 Playwright Chromium | **0 个残留**（实测筛选 `Path -like '*ms-playwright*'` = 0） |
| 机器上其它 `chrome.exe` | 26 个，全部是用户自己的 `C:\Program Files\Google\Chrome\Application\chrome.exe`，**未触碰** |
| 其它 node 进程 | 仅 PID **6496** = `F:\Tools\Node\node.exe C:\Users\14666\.dsh\profiles\desktop\node_modules\billion-context\dist\index.js start --host 127.0.0.1 --port 18787`（DSH 自身服务，非我启动，**未触碰**） |
| 其它审查子代理的进程 | 未发现、未触碰 |

### 7.4 未安装任何依赖（实测）

浏览器测试复用机器上**已有**的临时 Playwright：`DAGUAN_PLAYWRIGHT_MODULE=C:\Users\14666\AppData\Local\Temp\dg-audit-04\pw\node_modules\playwright`（playwright 1.59.0，由第 4 号子代理此前安装）；Chromium 用 `DAGUAN_CHROMIUM_EXECUTABLE=C:\Users\14666\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`。`node_modules` 未被修改。

---

## 附录 A · 本次审查的原始实测数据

### A.1 配置矩阵（全部实测）

| 配置 | tests | pass | fail | cancelled | skipped | exit |
|---|---|---|---|---|---|---|
| 无 `DAGUAN_DATA_DIR` + 无 Playwright | 265 | 239 | 0 | 0 | 26 | **0**（CI 用此配置） |
| 有 `DAGUAN_DATA_DIR` + 无 Playwright | 265 | 238 | 1 | 0 | 26 | 1 |
| 有 `DAGUAN_DATA_DIR` + 有 Playwright | 265 | 257 | 7 | 1 | 0 | 1 |

### A.2 8 个问题用例（原文）

| # | 用例 | 位置 | 报错原文 |
|---|---|---|---|
| 1 | 无模型可保存并获取列表，旧档案默认流式，Key 留空保留 | `test/ai-service.test.mjs:71` → `:80` | `AssertionError`: `+ actual 'sk-secret-key'` / `- expected 'test-only-key'` |
| 2 | 空格展开答案只滚动题目区，底部操作栏不跳出空白 | `test/answer-scroll-browser.test.mjs:14` | `'test timed out after 30000ms'` |
| 3 | （字号保持） | `test/font-scale-browser.test.mjs:16` → `:51:14` | `page.waitForLoadState: Timeout 30000ms exceeded.` |
| 4-7 | （学习报告 new/old × single/multi） | `test/study-report-browser.test.mjs:58:74` ×4 → `:41:14` | `page.waitForLoadState: Timeout 30000ms exceeded.` |
| 8 | 首页范围、详情、跨窗口更新、150%布局及离线刷新重试与备份 | `test/study-report-browser.test.mjs:77:1` → `:41:14` | `page.waitForLoadState: Timeout 30000ms exceeded.` |

原始日志：`%TEMP%\dg-audit-10\full-test-with-pw.txt`（372 行）。

### A.3 `ai-service.test.mjs` 隔离实验（实测，最小复现）

```
(A) 不设 DAGUAN_DATA_DIR        → tests 8 / pass 8 / fail 0
(B) DAGUAN_DATA_DIR=data2（全新） → tests 8 / pass 7 / fail 1
(C) DAGUAN_DATA_DIR=data3（全新） → tests 8 / pass 7 / fail 1
```

⇒ 污染发生在**文件内**，与脏数据无关。

### A.4 环境变量清单（实测 grep，供后续维护参考）

- `DAGUAN_PLAYWRIGHT_MODULE`：`test/ai-ui-browser.test.mjs:13`、`test/answer-scroll-browser.test.mjs:12`、`test/choice-ui-browser.test.mjs:12`、`test/font-scale-browser.test.mjs:14`、`test/study-report-browser.test.mjs:13`、`test/visibility-browser.test.mjs:16`、`test/desktop-cdp-smoke.mjs:7`、`test/desktop-csp-smoke.mjs:5`、`test/desktop-lifecycle-smoke.mjs:14`
- `DAGUAN_CHROMIUM_EXECUTABLE`：`test/ai-ui-browser.test.mjs:34/:71/:106`、`test/answer-scroll-browser.test.mjs:47`、`test/choice-ui-browser.test.mjs:23`、`test/font-scale-browser.test.mjs:46`、`test/study-report-browser.test.mjs:30`
- `DAGUAN_TEST_BROWSER`：`test/visibility-browser.test.mjs:65`、`test/desktop-cdp-smoke.mjs:77`
- 其它：`DAGUAN_SCROLL_ELECTRON`（`test/answer-scroll-browser.test.mjs:40`）、`DAGUAN_AI_SCREENSHOT_DIR`（`test/ai-ui-browser.test.mjs:172`）、`DAGUAN_SCREENSHOT_DIR`（`test/desktop-cdp-smoke.mjs:9`）、`DAGUAN_CDP_URL`（`test/desktop-cdp-smoke.mjs:11`）、`DAGUAN_CDP_ENDPOINT`（`test/desktop-csp-smoke.mjs:4`）、`DAGUAN_DESKTOP_EXE`（`test/desktop-lifecycle-smoke.mjs:83`）、`DAGUAN_MIGRATION_TEST_URL` / `DAGUAN_CHROME_PATH`（`test/migration_browser_playwright.py`）、`DAGUAN_RUNTIME_ROOT` / `DAGUAN_NO_BROWSER`（`test/browser-package-smoke.mjs`）、`DAGUAN_LAUNCHER_KIND`（`test/service-instance.test.mjs`、`test/remote-live-smoke.mjs`）、`DAGUAN_DATA_DIR` / `PORT` / `HOST` / `DAGUAN_OPEN_BROWSER`（多个）

---

## 附录 B · 「未能验证」清单

| 项 | 理由 |
|---|---|
| `windows-release.yml` 在 GitHub 上的真实运行历史（20 个日历 tag 时期是否成功跑过） | 需要访问 GitHub Actions 运行记录与仓库权限；本次为离线只读审查。仅能确认 `workflow_dispatch` 可人工触发、tag glob 对 v1.0.x 零匹配 |
| `test/squirrel_update_e2e.py` 最近一次是否真正跑通 | 需要安装并启动真实 Squirrel QA 应用（`.build/stage4-update-qa`）+ 本地 HTTP feed，属于会改动系统状态的操作，超出只读审查范围 |
| 死 IPC 通道（P2-5）是否造成**可见**的 UI 问题 | 需要人工操作桌面版观察最大化/还原时标题栏按钮状态；通道断裂本身是实测事实 |
| `docs/干净环境安装验证.md` 的 13 项是否在其它机器上被手工验证过 | 文档里全是未勾选状态，没有其它证据 |
| 26 个 skip 的**逐条**原因文本 | 数量与浏览器用例数完全相等（26 = 26），且已知事实已确认原因文本为 `Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE`；但我未逐条 dump skip 原因，属推断 + 已知事实 |
| `out/make` 的 v1.0.8 Squirrel 产物是否曾被用于真实发布 | 从 `.build/` 证据看 v1.0.7–v1.0.10 都发过版，但哪个产物对应哪次发布无法从磁盘状态确证 |
| ~~`web-sync.test.mjs` 想覆盖的 `toLocalMastery` 是否仍存在于产品代码~~ | **已补验**：`toLocalMastery` 在 `web/*.js`、`local-server/*.mjs`、`desktop/*.cjs`、`desktop/*.mjs` 里 0 命中，产品代码中不存在 |
| `study-activity.test.mjs` 的 DST 用例在不同 Node/ICU 版本下是否稳定 | 只在本机 Node v24.15.0 跑过 |
