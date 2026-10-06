# 大观园数学 · 桌面版全流程审计汇总

- 对象：`F:\AI\大观园本地`（分支 `main`，HEAD `126266d`，`daguan-math-local` v1.0.10）
- 日期：2026-10-01　环境：Windows / Node v24.15.0 / Electron 44.4.5
- 方法：10 个并行审查域 + 主理人独立复现（`00-master-verification.md`）
- 性质：**只读诊断**。未修改任何仓库源码，未推送、未部署、未发布。全部实测使用临时 `DAGUAN_DATA_DIR`，未读写真实 `%LOCALAPPDATA%\DaguanMath\data`。

---

## 0. 一句话结论

**渲染侧（Electron 主进程/preload/CSP）和核心数据层（实例锁、原子写、远程网关）做得比预期扎实——这两块没有 P0；产品侧问题集中在「本地 HTTP 服务的信任边界」、「子进程生命周期收尾」、「官网同步链路的时间戳处理」三处，共 4 条 P0。另有一条同等严重的工程 P0：`npm test` 的绿灯是假的——19 个用例自己测自己，全部 26 个 E2E 在 CI 里从未运行过。**

桌面版的技术底子不差：`sandbox`/`contextIsolation` 全开、`nodeIntegration:false`、preload 只暴露 4 个冻结方法、7 个 IPC handler 全部校验 sender+frame+URL、路径穿越防护到位、`remote-gateway.cjs` 有完整的 scrypt + HMAC 会话 + 登录限流 + 同源校验、`instance-lock.mjs` 用独占创建 + 恢复闸门防双写。

但 **本地服务默认信任"任何能访问 127.0.0.1 的请求"**，而浏览器里的任意网页恰好能满足这个条件（简单请求不触发 CORS 预检）；再加上**子进程退出没有超时兜底**，导致"退出"和"装更新"两条关键路径都可能永久挂起。

---

## 1. P0（建议立即修）

### P0-1 · 单次畸形请求即可打崩本地服务进程

| | |
|---|---|
| 位置 | `local-server/server.mjs:465`（`withLock` 回调内提前 `return json(res, 400, …)`） |
| 复现 | `PATCH /api/state/questions/1`，body `{"revision":0,"mastery":"bogus_value"}` |
| 实测 | 客户端收到 `400 {"ok":false,"error":"掌握状态无效"}`，**2.5 秒后服务进程 exit code 1**，stderr 尾部 `ERR_HTTP_HEADERS_SENT`，随后 `/api/health` 不可达 |
| 机制 | `:465` 提前返回 `undefined` → `:483` 读 `saved.revision` 抛错 → `:645` 的 `.catch` 里再调 `errorJson` 二次写头 → 异常抛在 catch 回调内 → 无 `unhandledRejection` 兜底 → 进程终止 |
| 影响 | 所有已打开的页面/窗口立即失效；桌面版运行期无子进程退出重启逻辑，用户只能手动重启应用 |
| 修复 | ① `:465` 改为 `throw Object.assign(new Error("掌握状态无效"), { status: 400 })`；② `errorJson` 开头加 `if (res.headersSent) return;`；③ 进程顶部加 `unhandledRejection`/`uncaughtException` 兜底并写日志 |

### P0-2 · 任意网页可把 AI 请求劫持到攻击者服务器（跨站写 AI 档案）

| | |
|---|---|
| 位置 | `local-server/server.mjs:534` `POST /api/ai/profiles` → `ai.upsert(await body(req))`，无任何 Origin/Host/Content-Type 校验 |
| 复现 | `Origin: https://evil.example` + `Content-Type: text/plain;charset=UTF-8`（CORS 简单请求，**不触发预检**）→ **HTTP 200**，档案写入成功，且 `"active": true` |
| 实测输出 | `{"ok":true,"profile":{"name":"pwn","baseUrl":"https://attacker.example/v1","active":true,"keyHint":"sk-••••pwn"}}` |
| 完整攻击链 | 用户在用浏览器打开任意网站 → 该网站静默 POST 写入恶意 `baseUrl`（空档案列表时自动 `active:true`，无需后续操作）→ 用户回到大观园提问 → 题干、选项、作答、标准答案、官方解析全部发往攻击者端点 |
| 加重项 | `validateBaseUrl` 实测放行 `http://169.254.169.254/latest/meta-data`（链路本地）与 `http://127.0.0.1:9/v1`（环回）→ 同一入口可作跨站 SSRF |
| 修复 | `/api/` 下所有非 GET 请求统一守卫：校验 `Origin` 属于本机应用页 + 校验 `Host` + **强制 `Content-Type: application/json`**（简单请求无法自定义头，天然挡住 CSRF）。注意：`desktop/policy.mjs` 的 `proxyHeaders()` 会剔除 `origin`，**必须同步改反代**（补 Origin 或改用启动时随机 token + 自定义头 `X-Daguan-Token`）。`desktop/remote-gateway.cjs:62-67` 的 `sameOrigin()` 可直接移植。 |

### P0-3 · 新界面 AI 回答未做 HTML 清洗（stored XSS）

| | |
|---|---|
| 位置 | `web/app-new.js:2652`（历史消息重放）、`:5983`（本轮回答结束）直接 `innerHTML = renderMarkdown(...)` |
| 对照证据 | `web/app-legacy.js:4712` 与 `web/app2.js:4390` **都定义了 `sanitizeAiHtml` 并已套用**（`:4739/:4750/:5053` 与 `:4417/:4428/:4727`）；而 `app-new.js` 全文件检索 `sanitize|DOMPurify|purify` **0 命中** |
| 机制 | `renderMarkdown`（`web/app-new.js:1413-1483`）把 `marked.parse()` 的输出直接写进 `innerHTML`；实测 `marked`（`web/vendor/marked.min.js` v12.0.2）**原样放行** `<img src=x onerror=…>`、`<script>`、`javascript:` 链接 |
| 影响 | 恶意内容随 `ai-history/*.json` **持久化**，每次打开 AI 面板都重放；桌面版 CSP 含 `'unsafe-inline'` 挡不住 `onerror`，浏览器版**完全没有 CSP**；XSS 在受信 origin 内可调用 preload 暴露的白名单 IPC |
| 修复 | 把 `sanitizeAiHtml` 抽成共享模块，在 `renderMarkdown` 返回前统一套用（改动最小、收益最大）；随后把 75 处内联 `onclick` 迁到 `data-action` 事件委托，再从 CSP 移除 `'unsafe-inline'` |

### P0-4 · 官网同步链路的三处时间戳 bug：上传 100% 不可用 + 静默反向覆盖

| | |
|---|---|
| 位置 | `local-server/sync-format.mjs:162`、`:198`（`new Date(Number(state.updated_at)).toISOString()`）与 `:438`（`Number(cur.updated_at)`） |
| 病根 | `server.mjs:463/477` 写入的 `progress[id].updated_at` 是 `nowIso()` 的 **ISO 字符串**，而这三处按**数字毫秒**解析 → `Number("2026-10-01T…")` = `NaN`。同文件内并存三套时间戳处理，其中 `sync-format.mjs:48-53` 的 `timestamp()` 才是唯一正确的那个 |
| 实测 1 | `GET /api/integrations/cxyonly/export?source=android` → **500** `{"ok":false,"code":null,"error":"Invalid time value"}`（同一份数据 `source=local` 返回 200） |
| 实测 2 | `buildPushPlan`（`sync-format.mjs:466` → `localToRemoteDocument`）**同样抛错**（函数级实测 `THROW RangeError: Invalid time value`），它被 `server.mjs:211`（push/preview）与 `server.mjs:222`（push/apply）调用 → **只要本机存在一条 ISO 格式的 `updated_at`（这是主路径默认格式），官网上传功能对真实用户就 100% 不可用** |
| 实测 3 | `sync-format.mjs:438` 的 `Number(cur.updated_at)` → `NaN` → `canUpdateMastery` **恒为真** → pull/apply 会用**官网的旧状态静默覆盖本机的新编辑**（实测：remote 2026-09-01 vs local 2026-09-29，本地为 ISO 时被改成 learning；本地为数字时正确不覆盖）→ **静默数据丢失** |
| 为什么测试没发现 | `test/web-sync.test.mjs:30-32` 的夹具只用数字时间戳 `1720000000000`，而这个格式在生产中根本不存在 |
| 修复 | 三处统一改用 `sync-format.mjs:48-53` 已有的 `timestamp()`（或抄 `web/app-new.js:1334-1341`、`web/backup-migration.js:8-13`）；同时把 `test/web-sync.test.mjs:30-32` 的夹具换成 ISO，变成真正的回归护栏（3 行源码 + 3 行测试） |

### P0-5 · 测试门禁是假的：19 个用例自己测自己，全部 E2E 在 CI 里从未运行

| | |
|---|---|
| 位置 | `test/new-ui-core.test.mjs`（15 例）、`test/web-sync.test.mjs`（4 例）、`package.json` 的 `npm test`、`.github/workflows/windows-release.yml:51-52` |
| 事实 1 | 这两个文件**不 import 任何产品模块、不读任何文件**（`vm` 调用 0 次）：`test/new-ui-core.test.mjs:129-152` **在测试里自己定义 `debounce` 再测这个自己定义的函数**、`:7-18` 定义 `mockLocalStorage` 再断言自己；`test/web-sync.test.mjs:4-9` 自己实现 `toLocalMastery` 再断言它——而 `toLocalMastery` 在 `web/*.js`、`local-server/*.mjs`、`desktop/*.{cjs,mjs}` 里 **0 命中**，即它测的函数在产品代码里**根本不存在**。合计 19 例 = 265 例的 **7.2%**，全部计入"239 pass" |
| 事实 2 | Playwright **不在 `dependencies` 也不在 `devDependencies`**（devDeps 只有 `@electron-forge/cli`、`@electron-forge/maker-squirrel`、`electron`）→ 26 个浏览器用例（= 全部 E2E）在 CI 里**一个都没跑**；`node --test` 把 skip 计入 tests 但不计 fail，所以报绿 |
| 事实 3 | CI 唯一跑测试的那一步（`.github/workflows/windows-release.yml:51-52`）**排在建包步骤之后**，且不设 `DAGUAN_DATA_DIR`、无 lint、无 `npm run verify` |
| 实测矩阵 | ① 无 `DAGUAN_DATA_DIR` + 无 Playwright → `265 / pass 239 / fail 0 /` **26 skip** / **exit 0** ← **CI 用的就是这一种**；② 有 `DAGUAN_DATA_DIR` + 无 Playwright → `238 pass / 1 fail` / exit 1；③ 有 + 有 Playwright → `257 pass / 7 fail / 1 cancelled / 0 skip` / exit 1 |
| 影响 | **"测试通过"四个字在本项目当前不可信，包括后续任何修复的验收**。且 `AGENTS.md` 要求的隔离方式反而让套件变红（P1-L），于是所有人（含 CI）都用假绿灯的配置 → 缺陷被固化 |
| 修复顺序（不可颠倒） | ① 先修 P2-19 的 `networkidle`，否则装完 Playwright 立刻多 7 个红；② 删掉上述两个假测试文件（零风险）；③ `local-server/store.mjs:5` 去掉默认参数（P1-L）；④ `playwright` 进 devDeps + CI 装 chromium；⑤ CI 设 `DAGUAN_DATA_DIR` 并断言 `skipped === 0`；⑥ `npm test` 移到建包之前并补 `npm run verify` |

---

## 2. P1

### 数据与隐私

- **P1-A · 学习数据可被跨站污染 / 被 DNS rebinding 完整读写。** 除 `/api/runtime/stop`（`server.mjs:359-368`，实测伪造 Origin 返回 403，防护有效）外，**所有 API 都没有 Origin/Host 校验**。实测：`POST /api/visit-history` 用 `text/plain` + 伪造 Origin → 200 且污染落盘；`Host: evil.example` GET `/api/state` → 200 返回完整状态。修正后的准确边界见 §4。
- **P1-B · `state.json` 损坏被静默当成空状态，并会在下一次写入时永久覆盖。** `local-server/store.mjs:24-26` 的 `catch { return fallback; }` 吞掉一切；`:39-40` 损坏时返回 `revision:0` 空状态；`:48-60` 的 `writeState` 基于这个空状态自增并覆盖写。**无备份、无日志、无告警**。对比 `visit-history.mjs:38-54`、`study-activity.mjs:107` 的同类损坏是抛错的——行为不一致。修复：区分 ENOENT 与解析失败，失败时把原文件重命名为 `.corrupt-<ts>` 并告警，写入前保留上一版备份。
- **P1-C · 题库源 manifest 可路径穿越写文件。** `local-server/catalog.mjs:26` 的 `files` 直接来自**远端** manifest 的 `shards[*].file`，`:30`/`:50` 的 `path.join(stageDir, file)` 与 `path.join(dataDir, file)` 都没有包含性校验。恶意或被劫持的题库源（`SOURCE = "https://hsad.xyz/daguan-math"`）可越出目录写文件。
- **P1-D · 凭据明文落盘，Windows 上权限收紧完全失效。** `store.mjs:28-34`、`:19-21` 的 `mode`/`chmod` 仅在非 win32 生效；实测 `ai-profiles.json` 含明文 `"key"`，`cxyonly-integration.json` 的 token 同样明文。**Key 不外泄**（只回传 `keyHint`、不进日志、`/export` 不含 token、无遥测）——问题只在静态存储。

### 功能与可用性

- **P1-E · 开机启动项指向版本化目录，Squirrel 升级后静默失效。** `desktop/electron-main.cjs:183-187` 把登录项写成 `process.execPath`，即 `%LOCALAPPDATA%\DaguanMathDesktop\app-<version>\DaguanMath.exe`；而 Electron 官方文档明确要求 Squirrel 应用指向上一级 stub（`node_modules/electron/electron.d.ts:1781-1784`）。升级后旧 `app-<version>` 目录被 `--squirrel-obsolete` 删除 → 开机不再自启且无提示；`:310` 启动时只读不重写，托盘勾选状态静默变回未勾选。**本机旁证**：`HKCU\…\Run` 中 Discord 的条目正是 `…\Update.exe --processStart Discord.exe`（stub 用法），可直接对照。修复：`path` 改为 stub 路径，或启动时无条件重写一次。
- **P1-F · 退出 / 装更新可能永久挂起。** `local-server/server.mjs:699-713` 的 `shutdown()` 用 `server.close(callback)`，注释明写"不强制关闭活动请求"；`desktop/electron-main.cjs:271-304` 的 `requestQuit()` 与 `:201-212` 的 `stopOwnedServiceForRestart()` 在 `child.send({type:"shutdown"})` 后**只等 `exit`，没有任何超时**。实测：一条**半开请求**（声明 `Content-Length` 但不发完 body）就让服务 12 秒不退出，关闭 socket 后立即退出；而空闲 keep-alive 与 SSE 长连接**不阻塞**（SSE 会被 `server.mjs:702-705` 主动 end）。修复：`shutdown()` 加 `setTimeout(() => process.exit(0), N).unref()` 兜底；`requestQuit()` 用 `Promise.race` 加超时。
- **P1-G · 桌面 Squirrel 发布链路无自动化，CI tag 过滤器永远不命中。** 唯一工作流 `.github/workflows/windows-release.yml` 的 tag 过滤是 `v????.??.??-r*`，而实际 tag 是 `v1.0.x`；该流水线只构建已停维护的浏览器单文件版，全文检索 `electron-forge`/`make`/`nupkg`/`RELEASES` **0 命中**。桌面版发布 100% 靠本地手工 `make` + 手工上传，`RELEASES`/`nupkg` 一旦不配套，**所有客户端的自动更新会静默失败**且无任何自动化能拦住。（正向结论：v1.0.10 的 `RELEASES` 声明 SHA1 与实际 nupkg 实测一致，链路本身是通的。）
- **P1-H · 正式安装器从未在干净 Windows 环境实测。** `docs/干净环境安装验证.md:55-79` 的验收清单**逐条为未勾选的 `- [ ]`**；阶段 3/4 只验证过不同 Squirrel 身份 `DaguanMathStage3QA`/`Stage4QA`，`docs/desktop-stage3-report.md:47-50` 自认不能替代。P1-E 的登录项 bug、卸载残留、中文用户名等只能在干净环境暴露的问题全部未验证。
- **P1-I · `cxyonly-client` 全链路无超时。** `cxyonly-client.mjs:36-68/70-82/84-128` 的 fetch 均无 `AbortSignal`；实测上游挂起 12 秒仍在 pending；`fetchStates()` 最多 200 页串行无超时；`applyPush` 三并发 × 无上限操作 × 3 次重试。
- **P1-J · 题库数据：25 道选择题选项为空 + 孤立分片。** 25 道题（`web/data/shards/概率统计.json`，题号 `99000003` 起，全部 `single_choice`）`options` 为空 → 选项容器不渲染、答对判定与键盘快捷键失效；根因是 `shared/local-question-banks.mjs:94-116` 合并 overlay 时不校验题型/选项形状，而 `official-question-bank.mjs:140-142` 对官网题强校验（校验不对称）。另有孤立分片 `web/data/shards/高等数学-核心.json`（8 题）不在 manifest/索引中，而 `tools/verify-web-data.mjs:43` 只遍历 manifest 故查不出。**两者都被打包进安装包**。
- **P1-K · 安卓迁移导出对任何真实数据都必然失败（500）。** `local-server/sync-format.mjs:162` 与 `:198` 用 `new Date(Number(state.updated_at)).toISOString()` 解析单题时间戳，而 `server.mjs:477` 写入 `progress[id].updated_at` 用的是 `nowIso()`（**ISO 字符串**，见 `server.mjs:463` `const at = incoming.updated_at || nowIso()`）→ `Number("2026-10-01T…")` 为 `NaN` → `toISOString()` 抛 `RangeError: Invalid time value`。实测 `GET /api/integrations/cxyonly/export?source=android` → **500**。测试夹具喂的是数字毫秒时间戳，所以单测全绿也漏掉。修复：解析函数兼容 ISO 字符串与数字两种输入，并补 ISO 夹具回归。
- **P1-L · 测试用例之间通过环境变量互相污染，照 AGENTS.md 的隔离方式跑 `npm test` 必红。** `test/ai-service.test.mjs:17,32`（及 `test/local-server.test.mjs:20`）调用 `createStore(root)` 时省略第二个参数，`local-server/store.mjs:5` 的默认参数 `dataDirOverride = process.env.DAGUAN_DATA_DIR` 于是把它绑到宿主环境变量上 → 同一文件内的用例共享同一个数据目录。实测：设 `DAGUAN_DATA_DIR` 跑该文件 8 例 7 过 1 挂（`actual 'sk-secret-key' vs expected 'test-only-key'`），不设则 8/8 全过。**后果**：`npm test` 设了隔离变量时 `fail 1 / exit 1`，不设时 `pass 239 / fail 0`——即"正确做法"反而红。修复：测试显式传数据目录，或让默认参数不读环境变量。
- **P1-M · 新版「继续学习」对服务端记录的位置全部失效（且会自我投毒）。** 病根 `web/app-new.js:1653-1657` 的 `findCategoryById` **只搜顶层科目**，而服务端 `category_id` 的既有契约是**叶子章节 id**（旧版 `web/app-legacy.js:2565`/`:3971-3974` 写入、`web/app-legacy.js:1481-1489` 的 `findCat` 全树搜索读取——所以旧版是对的）。三个失效点：`web/app-new.js:1544`（首页「继续学习」卡片消失）、`web/app-new.js:1534`（`lastPositionTrail()` 返 null → `web/app-new.js:1708` 弹出**假的**「上次学习的题目已不在当前题库」）、`web/app-new.js:4639-4643`（`resumeLearning()` **静默 return**）。**会自我投毒，不需要旧版参与**：`web/app-new.js:2286` 的 `pushLastStudy(AppState.currentChapter.id, …)` 把**章节 id** 写进服务端；`web/app-new.js:1362` 的 `resolveChapterForQuestion` 匹配到嵌套节点时把**嵌套节点自己**当 `top`；`web/app-new.js:1167` `absorbLastStudy` 与 `web/app-new.js:3625` `openResolvedPosition` 遂把嵌套 id 存成本地 `categoryId`——实测正常刷题后走一次 `?uiSwitch=1`（真实用户路径，`web/ui-version.js:55` 生成），本地位置即从 `{"categoryId":223,"chapterId":1111}` 变成 `{"categoryId":1111,"chapterId":1111}`，下次开机「继续学习」就没了。对照组（同一份位置只改形状）：`categoryId=223`（顶层）→ 首页正确显示「继续学习 · 上次学习：第 3 题」且 `resumeLearning()` 落到 `qid 3358`；`categoryId=331`（嵌套 depth 3）→ 卡片消失 + 假警告 + 停在 home。修复：① `walk` 携带循环的顶层 `top`；② `findCategoryById` 加全树兜底并返回命中节点的顶层祖先；③ `pushLastStudy` 的 `category_id` 统一写顶层科目 id。
- **P1-N · 外部状态同步会清空当前窗口的判题痕迹。** 机制：`web/app-new.js:1102` 的 `refreshFromEvent` → `renderQuestion`，而 `renderQuestion` 在 `web/app-new.js:2190` 用 `main.innerHTML = …` 整块重建 DOM，**完全不回填 `AppState.answers`**（判题渲染逻辑只存在于 `web/app-new.js:5680-5698` 的点击处理器里）。实测：窗口 A 在 `qid 8786`（单选，答案 D）真实判对（`selected:1, correct:1, feedback:"回答正确", answerVisible:true`），窗口 B 执行一次 `PATCH ./api/state/last-study`（rev 73→74）后，A 采样 14×600ms **只有一种状态**：`0/0/0/无标记/无反馈/答案收起`；触发栈确认为 `renderQuestion ← refreshFromEvent (web/app-new.js:1102)`。影响：多窗口同步、旧版界面、官网写入这些**产品明确支持**的场景下，用户刚判对的题视觉上变回「未作答」，答案解析被自动收起（进度已正确落盘，但体验像白答了）。**重要修正**：单窗口内的判题与**改答案**（先错后对）是**正常**的（8.25s/4.8s 采样全程稳定、无重渲染），早前记录的「首次点正确项即清空」**不是** bug。
- **P1-O · 旧版 UI 的配置迁移会静默清空批注与「继续学习」位置。** `server.mjs:524-531` 的 `POST /api/state/migrate` 先用 `localStateShape()` 把缺失字段补成默认值，再用 `{...current, ...incoming}` 合并 → **默认值反过来覆盖了 `current` 里的真实数据**。实测：先写入批注与 `last_study`，再发一个最小 migrate 体 → **`annotations` 变 `{}`（「我的批注」消失）、`last_study` 变 `null`**。真实触发路径是 `web/app-legacy.js:3821-3825`（旧版 UI 的配置向导），它只发 4 个字段，所以**每次走旧版迁移都会清掉 last_study**；同时还会清空 `remote_seeded_at`（→ 下次 reconcile 被判为 firstRepair，`server.mjs:249-253` 令 remoteAuthoritative，官网反向覆盖本机）与 `pending_remote_operations`（失败待重传队列直接丢弃）。修复：合并前剔除 `undefined`/缺失键，或按字段白名单合并。
- **P1-P · 官网客户端全链路无超时，且远端交互持有本地全局写锁。** `cxyonly-client.mjs:49/73/94/106` 的 fetch **全部没有 `AbortSignal`**（全文件零命中），而同仓库的 `cloudflare-tunnel.cjs:10/28/33`、`web/app-new.js:1209`、`service-handoff.mjs:67` 都带了超时。放大效应：`server.mjs:294` 把整个远端交互包在 `withLock` 里，而 `withLock` 同时串行化 `PUT /api/state` 与全部单题 `PATCH` → **官网那边一挂起，本地所有写入就永久阻塞，且没有任何超时能解开**。另有 `fetchStates()` 最多 200 页串行、`cxyonly-client.mjs:147-149` 吞掉错误后仍按分页退化处理。修复：所有 fetch 加 `AbortSignal.timeout`，并把远端交互移出 `withLock`（第三方服务不应持有本地写锁）。
- **P1-Q · 桌面主进程与大量服务端路由零执行型测试。** `desktop/electron-main.cjs`（381 行）**从未被 `npm test` 执行过**，唯一"覆盖"是 `test/electron-security.test.mjs` 的 `readFileSync`+正则；唯一的行为覆盖 `test/desktop-lifecycle-smoke.mjs` 既不在 `npm test` 也不在 CI。`local-server/server.mjs` 至少 **20 条路由零正向测试**：`/api/access/status|unlock|lock`、`/api/question-bank/status`、`/api/state/last-study`、`/api/state/migrate`、`/api/ai/{diagram,runs,conversations}`、`/api/study-activity/merge`、`/api/visit-history/merge`、`/api/catalog/refresh`，以及 **`/api/integrations/cxyonly/*` 全部 10 条**（preview/apply/reconcile 编排层完全无路由级测试，只有 `cxyonly-client.mjs` 的 mock 单测 + `sync-format.mjs` 的纯函数单测）。零引用模块：`instance-lock.mjs`(184 行)、`catalog.mjs`(59)、`scripts/package-windows-release.mjs`(85)、`sync-extension/bridge.mjs`(359)、`sync-extension/popup.mjs`(195)、`web/{study-report,landing,data-bank-client,visit-history-client,ai-panel-layout,ai-reading,remote-access}.js` 全部 0 引用。**直接后果**：P1-E（开机启动项指向版本化目录，`desktop/electron-main.cjs:185`）与 P1-M（`findCategoryById` 只搜顶层）都正好落在测试盲区里，测试完全无法发现——这也是 P0-5 的另一个侧面。

---

## 3. P2 / P3 速览

| 编号 | 摘要 |
|---|---|
| P2-1 | `makeTray`/`createWindow` 无 try/catch；主进程无 `uncaughtException`/`unhandledRejection` 兜底 |
| P2-2 | 权限请求默认**全部放行**（无 `setPermissionRequestHandler` 时 `getUserMedia({audio:true})` 实测 RESOLVED；装上 `cb(false)` 即 REJECTED） |
| P2-3 | Windows PID 复用会让实例锁永久卡死，只能人工删锁（**实测确证，但属安全优先的有意取舍**：错误信息明确点名 PID 复用并给出处置步骤，见 `00-master-verification.md` §7） |
| P2-4 | 更新检查无看门狗，`checking` 悬挂会让更新器永久停摆；更新前不停止"非本进程拥有"的服务 → 旧版本目录锁定文件残留 |
| P2-5 | `npm test` 的绿色有水份：实测 **26 例 skip**，原因全部是 `# Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE`，而 Playwright **不在任何依赖里**（退出码仍为 0） |
| P2-6 | `test/electron-security.test.mjs` 是 197 行纯静态文本断言，**零行为覆盖**；其"不得有内联 `<script>`"断言会造成 `'unsafe-inline'` 没被用上的错觉（实际内联事件处理器 75 处） |
| P2-7 | AI `streamChat` 的 90s 是**总超时非空闲超时**，长回答被腰斩且不落历史；上下文按轮重复整题，token 近似二次增长；题目内容发往第三方 AI 全程无告知无开关 |
| P2-8 | `catalog.mjs:8-12`、`cxyonly-client.mjs` 无超时；畸形 JSON 返回 500（应 400）、11MB body 返回 500（应 413）；`study-activity.mjs:9` 正则放过 `__proto__`；`server.mjs:510` 与 `:513` 判空不一致 |
| P2-9 | 非法 JSON / `null` body / 超限请求体一律返回 **500**（应为 400/413），并把内部 TypeError 文本外泄（`Cannot read properties of null (reading 'revision')`） |
| P2-10 | `GET /api/integrations/cxyonly/export?source=bogus` → 200 静默降级为本地状态导出，无白名单校验 |
| P2-11 | 不同数据目录 + 同一端口 → 抛出原始 `EADDRINUSE` 英文堆栈（该路径的实例锁被正确释放，不留脏锁） |
| P2-12 | `desktop/service-handoff.mjs:26-35` 的 `windowsProcessImage()` 用 `execFile("powershell.exe")` 捕获 stdout，在禁止管道 stdio 的环境会 EPERM → 身份分类退化为 `unknown` → 桌面版拒绝接管（仅影响无 `launcherKind` 的遗留锁） |
| P2-13 | 折叠侧边栏只用 `transform: translateX(-105%)`（`web/styles-new.css:2254-2255`），元素仍可见、仍可聚焦，无 `inert`/`aria-hidden`/`visibility:hidden` → 900×600 下按 Tab **5 次**落到屏幕外按钮（`left=-282`），WCAG 2.4.3/2.4.7/1.3.2 违规 |
| P2-14 | 首屏预取约 **4.4MB**：`/data/search_index.json` **2307KB**（首屏不需要）、`/assets/landing/local-mark.png` **1161KB 且被加载两次**、`lecture-video-mappings.json` 444KB（FCP 356ms、readyMs 233ms） |
| P2-15 | 题库分片按**科目**切（`高等数学.json` 3,787,634 B），进一个只有 1 道直属题的「幂级数」章节仍要拉 **3699KB** |
| P2-16 | `renderQuestion` 单次 **49.7–78.7ms**（帧预算 16.7ms）；多题模式 11 张卡产生 **9263 个 DOM 节点**、耗时 914ms——这也是 P1-N 的结构性根因 |
| P2-17 | `?ui=new` 显式覆盖失效：`web/ui-version.js:202` 在 `<head>` 同步执行且只看存储偏好、忽略 `?ui`，早于 `web/ui-bootstrap.js:16` → 存储偏好为 `old` 时 `/index.html?ui=new` 仍跳旧版（生产无引用，但 10 处测试与 `test/desktop-csp-smoke.mjs:26` 依赖它） |
| P2-18 | 新版单题（沉浸）态点「切旧版」后落在旧版 focus 模式，`header.topbar` 为 `display:none`，`#btn-switch-new` 尺寸 0×0 不可点 → 旧版内没有界面切换入口（可先退出沉浸，非死锁）。根因：模式键 `daguan_local_mode_v1` 跨版本传递 |
| P2-19 | 6 个浏览器测试用例失败（真实 `exit=1`），根因全是 `waitForLoadState('networkidle')` 撞上常驻 SSE `/api/state/events` 使网络永不 idle → 30s 超时。**测试写法缺陷，非产品 bug**；`package.json` 的 `npm test` 含这两个文件，**装好 Playwright 后 `npm test` 会变红** |
| P2-20 | 远程网关的 `BLOCKED` 名单被 `/daguan-math` 前缀绕过：`remote-gateway.cjs:8/28-32/143-144` 用**未剥壳**路径匹配，而上游 `server.mjs:357-358` 才剥前缀。实测 `/service-worker.js`→404 但 `/daguan-math/service-worker.js`→200 透传；`/api/runtime/stop`→403 但 `/daguan-math/api/runtime/stop`→200 透传。**当前不可利用**（上游 `server.mjs:359-363` 要求 `Origin=http://127.0.0.1:PORT`，网关 `remote-gateway.cjs:142` 要求 `Origin=https://<publicHost>`，不可能同时满足），属**纵深防御已完全失效**——一旦上游新增管理端点即变可利用 |
| P2-21 | 网关全局失败计数可被用来 DoS：`remote-gateway.cjs:77` 在校验前就计数、`:87` 累计 20 次错密码即封锁**所有**远程用户 15 分钟；`attempts` Map 无 TTL 清理 |
| P2-22 | `previews` Map（`server.mjs:36`）只在成功 apply 时删除，被放弃的预览永久驻留（每条含全量远端文档，数 MB 级） |
| P2-23 | `store.mjs:71-77` 的 `writeBackup` 无保留策略；每轮对账至少新增 4 份全量快照（`server.mjs:247-248`、`:303-304`、`:221`） |
| P2-24 | `applyPull`（`server.mjs:200`）直接 `writeState`，既不取 `withLock` 也不传 `expectedRevision` → 与并发的 `PATCH` 互相覆盖、丢更新 |
| P2-25 | 官网 token **明文**落盘（`store.mjs:28-34` 的 `mode 0600` 在 Windows 无效），而隧道 token 走 `safeStorage`（`electron-main.cjs:320-322`）→ 同类凭据策略不一致（缓解项：`redactSecrets`、login 只回传 profile、token 不回浏览器，这几点是对的） |
| P3 | `asar: false`（283MB 明文目录）；打包携带未被引用的题库分片且 `asset_count` 与实际不符；仓库内 `out\make` 是 1.0.8 陈旧产物；文档大面积滞后（README 仍写"公开版 v1.0.3"，CHANGELOG 停在 v1.0.1）；4 个 Python 工具硬编码 `F:/ai/daguan-cxy-local/web/data`（陈旧树 6342 题 vs 正本 6521 题）；41 张题图缺失（`verify` 只 warn 不 fail）；跨分片逐字重复题 2 组；`GET //package.json` 被双斜杠归一化为默认页并返回 200 landing（无害）；`#show-answer-btn` 的 `aria-expanded` 只在判题路径（`web/app-new.js:5697-5698`）被设为 `"true"` 且永不复位；题目页 `h1Count: 0`、`#preview-access-key` 无 label、`dialog#dlg-preview-access` 缺 `aria-modal`；`web/index-new-backup.html` 实测 **HTTP 200 可达**但加载 v90 旧资源（缺 17 个 `defer` 脚本、`window.ChoiceGrading` 为 `undefined`），且 `asar:false` 会随安装包明文发布；旧版 5 处 `window.__f*` 调试全局（`web/app-legacy.js:2111` 泄露响应体前 120 字符）、`web/app-legacy.js:2092` innerHTML 未转义、`legacy.html` 6 个 class 无 CSS 定义、Service Worker 预缓存 430KB 死资产（`web/service-worker.js:20-21` 的 `styles.css`/`app2.js`）、7 处死元素引用（`#setup-feedback` 疑似改名漏改）、`desktop/electron-main.cjs:159` 托盘 `switchUi` 静默返回 false |
| P2-26 | `test/ui-contract.test.mjs` 45 例**全是源码正则**（465 行、26 次 `readFileSync`、读 13 个文件）：改变量名就红（假阴性），行为回归只要字符串还在就绿（假阳性）。用例量全仓第二多，制造"UI 契约已充分测试"的错觉 |
| P2-27 | `test/chapter-navigation.test.mjs` 名不符实：只 `readFileSync` 两个 data json，自己实现 `children`/`flattenLeaves`/`find` 后断言硬编码 id（`:33` leaves = `[331,344,345,347,346,348]`、`:40` `categoryQuestions["331"].length === 11`）→ **零行导航代码被执行**，P1-M 本可在这里被拦住。建议改名 `catalog-data-integrity.test.mjs` 并另补真导航测试 |
| P2-28 | `test/download-links.test.mjs` 是文档字符串测试：`:5 const RELEASE = "v1.0.0"` **死变量**；只断言 `docs/release-v1.0.0.md` 与 `.1.md` 的资产名，**v1.0.2–v1.0.10 完全无覆盖** |
| P2-29 | `test/electron-security.test.mjs:87` 的 CSP 断言 `doesNotMatch(html, /<script\s*>(?!\s*<\/script>)[\s\S]*?<\/script>/i)` **只查内联 `<script>`，完全漏掉内联事件处理器 `onclick=`/`onerror=`**，而同文件 `:77` 又承认 `script-src 'self' 'unsafe-inline'` |
| P2-30 | 死 IPC 通道（实测 grep）：`web/*.js`、`web/*.html`、`desktop/preload.cjs` 里搜 `maximize-state\|maximized\|daguan:maximize` = **0 命中** → `desktop/electron-main.cjs:343` `ipcMain.handle("daguan:maximized")` 渲染进程不可达；`:262/:263` 的 `daguan:maximize-state` 无人监听（是否造成可见 UI 问题**未能验证**，需人工操作桌面版看标题栏按钮） |
| P2-31 | 陈旧产物：`out/` 合计 **1461.0 MB**（`out/make/squirrel.windows/x64/DaguanMathDesktop-1.0.8-full.nupkg` 405.1MB，2026-09-30 15:30:02 → **Squirrel 产物停在 v1.0.8，落后 `package.json` 两个版本**）；`dist/` 的 `DaguanMath-windows-x64.exe` 351.25MB(09-28) 与 `DaguanMath-version.txt`=`2026.9.27.27`（旧日历号，`scripts/build-windows-exe.mjs:41-48 normalizeVersion` 合法推导，不是 bug）→ `test/browser-package-smoke.mjs` 冒烟的是旧产物。另 `.build/` 约 100 个发布证据，含一次真实失败日志 `ai-reading-v1.0.7-tests-final.log`（`test/visibility-browser.test.mjs:118 2 !== 1 ERR_ASSERTION`） |
| P2-32 | 环境变量双轨（实测）：`DAGUAN_CHROMIUM_EXECUTABLE`（ai-ui-browser:34/71/106、answer-scroll:47、choice-ui:23、font-scale:46、study-report:30）vs `DAGUAN_TEST_BROWSER`（visibility-browser:65、desktop-cdp-smoke:77）→ 设了前者时**价值最高的 `test/visibility-browser.test.mjs` 仍用 Playwright 自带浏览器**，机器上只有系统 Chromium 时它会失败而其它浏览器测试能过 |
| P2-33 | 9 个手工/冒烟脚本（`desktop-cdp-smoke` 106 行 / `desktop-csp-smoke` 78 / `desktop-lifecycle-smoke` 155 / `squirrel_update_e2e.py` 404 / `remote-live-smoke` 71 / `remote-electron-smoke` 68 / `browser-package-smoke` 58 / `migration_browser_playwright.py` 233 / `browser-retirement-playwright.py` 34）**无 script 入口、无文档、不在 CI**；其中 `test/desktop-lifecycle-smoke.mjs` 是 `desktop/electron-main.cjs` 生命周期**唯一任何形式的覆盖**，`test/squirrel_update_e2e.py` 是更新链路**唯一自动化验证** |

---

## 4. 重要的验证修正（避免误报）

主理人对多条主张做了独立复现，其中若干**收窄或推翻**了初判：

| 初判 | 实测结论 |
|---|---|
| 跨站可清空进度 / 可 PATCH 单题 | **收窄**：`PUT`/`PATCH`/`DELETE` 属非简单方法，浏览器跨站会触发预检，而服务端不处理 `OPTIONS`（实测 404、无任何 `Access-Control-Allow-*`）→ **普通跨站不可达**；`POST` + `text/plain` 简单请求**可达**；DNS rebinding 后**全部可达** |
| SSE 长连接会阻塞服务退出 | **推翻**：实测 820ms 正常退出，`server.mjs:702-705` 会主动 end 所有 SSE 客户端 |
| 空闲 keep-alive 连接会阻塞退出 | **推翻**：实测 20ms 退出；阻塞条件是**未完成的在途请求**（半开 TCP） |
| 桌面版"停止本地服务"按钮会 403 | **推翻**：该按钮仅在 `?browserPackage=1` 时渲染（`web/app-new.js:3178`），桌面版根本看不到 |
| 托盘图标为空导致启动即退 | **推翻**：两个候选图标文件均存在，`icon.isEmpty()` 为 false |
| `ui-bootstrap.js` 每次加载都注销 Service Worker | **推翻**：注销只在 `?purge=1` 分支内 |
| `daguan://` 下无法注册 Service Worker | **推翻**：`electron-main.cjs:15` 已含 `allowServiceWorkers: true` |
| PID 复用导致锁卡死是"缺陷" | **定性下调为 P2 取舍**：行为确证（实测 `SERVICE_INSTANCE_HELD`、锁保留、恢复闸门已清理），但错误信息主动点名"Windows 重用了 PID"并给出可执行的处置步骤，是安全优先的有意设计 |
| `windows-release.yml` 的 `v????.??.??-r*` "从未触发" | **更正**：它**确实匹配到 20 个旧日历 tag**（`v2026.09.07-r7` … `v2026.09.27-r27`，末个 commit `b5e01e3`，2026-09-27 11:10:44 +0800）；准确说法是**只覆盖旧日历命名，对全部 11 个 `v1.0.x` tag 零匹配**（`README.md:81` 已宣布切 SemVer）。那 20 个 tag 时期是否真在 GitHub 上跑成功，因无仓库权限**未能验证**。**联动注意**：`test/electron-security.test.mjs:170-174` 把"CI 只匹配 `v????.??.??-r*`"锁成了预期行为，**修 glob 前必须同步改它**，否则修复会被测试拦住 |
| `tools/verify-web-data.mjs` 硬编码 6342 题 | **推翻**：该文件 `:59-60` 只拿 `manifest.total` 比对，**没有硬编码数字**。实跑 `npm run verify` = 「题库验证通过：6521 题，6521 个唯一题号；警告：缺少 41 张题图」。`web/data/manifest.json` `total: 6521` / `source_total: 6362` / `asset_count: 1242`。**6342 是文档里的过期历史值**（`docs/desktop-stage0-acceptance.md:7`、`stage0-report.md:25`、`stage1-acceptance.md:7`、`stage1-report.md:26`、`stage2-report.md:27`、`stage3-report.md:28`、`docs/ui-redesign/REMEDIATION-CONTROL.md:14`；`CHANGELOG.md:31` 写 6183），而 `docs/release-v1.0.7.md:17` 与 `release-v1.0.8.md:13` 已正确写 6521 |
| 「首次点正确项即清空判题」 | **推翻**：单窗口内的判题与改答案（先错后对）实测全程稳定、无重渲染；只有**外部状态同步**（P1-N）才清痕迹 |

---

## 5. 优化建议（按性价比排序）

### 第一批：三条改动最小、收益最大

1. **修 P0-1 的进程崩溃**（约 3 行）：`:465` 改抛 `status:400` 错误 + `errorJson` 加 `headersSent` 判断 + 顶部 `unhandledRejection` 兜底。
2. **抽共享 `sanitizeAiHtml`，在 `renderMarkdown` 返回前套用**（消 P0-3；旧界面已有现成实现可直接搬运）。
3. **给 `/api/` 写操作加统一守卫**（消 P0-2、P1-A）：非 GET 必须满足 `Origin` 为本机应用页 + `Host` 白名单 + `Content-Type: application/json`。**切记同步改 `desktop/policy.mjs` 的反代**（`proxyHeaders()` 剔除了 `origin`），否则桌面版会被自己挡住。

### 第二批：进程收尾统一收口（P1-F + P2-1 + P2-4）

写一个 `stopChild(child, {timeoutMs})`：shutdown IPC → 超时 → `kill()` → 记录日志；`requestQuit()`、`stopOwnedServiceForRestart()`、`stopStartupChild()` 共用。所有 spawn 的 child 登记进一个 Set 统一收尾；主进程顶部加 `uncaughtException`/`unhandledRejection` 写 `dataDirectory()/logs/`。**这三条其实是同一个病。**

### 第三批：数据安全与发布可靠性

- `state.json` 损坏自愈（重命名 `.corrupt-<ts>` + 告警 + 写入前留备份）。
- `catalog.mjs` 加路径包含性校验（`path.resolve(target).startsWith(path.resolve(root) + path.sep)`）。
- `validateBaseUrl` 排除 `169.254/16`、`0.0.0.0/8`、`100.64/10`；给 `cxyonly-client` 所有 fetch 加 `AbortSignal.timeout`。
- 登录项改用 Squirrel stub 路径（P1-E）。
- CI 加 `desktop-release` job，**断言 `RELEASES` 内的 SHA1/字节数等于本地 nupkg 实测值**后才允许上传（这是防"客户端静默不更新"事故的核心断言）。
- 给 `tools/verify-web-data.mjs` 加两条断言：磁盘 shards ↔ manifest 双向对账、选择题 `options` 非空（各约 10 行，直接堵住 P1-J）。

### 第四批：测试真实性与文档

- 把 `test/electron-security.test.mjs` 的静态断言升级为行为测试（`validIpc`、权限处理器、CSP 实际注入效果、退出超时、Origin/Host 校验）；新增 `test/local-server-csrf.test.mjs`。
- 把 Playwright 加进 devDependencies 或把 7 处 `skip` 改成显式失败，别让 `npm test` 的绿色误导。
- 同步 README / CHANGELOG / CODE_SIGNING_POLICY 的版本号与状态；执行 `docs/干净环境安装验证.md` 并把 `- [ ]` 勾上。

### 第五批：界面正确性与工程卫生（来自 04 / 06 报告）

- **修 P1-M「继续学习」链路**（改动集中在 `web/app-new.js` 的 `findCategoryById` / `walk` / `pushLastStudy` 三处，回归面小、可单测完全覆盖）。这是入口级功能完全不可用 + 一条事实错误的警告文案，且**会自我投毒**（走过一次 `?uiSwitch=1` 就中招），优先级应高于多数 P2。
- **修 P1-N 状态回填**：在 `renderQuestion` 末尾补约 25 行把 `AppState.answers` 回填进新 DOM，或与 `web/app-new.js:5680-5698` 共用同一套渲染逻辑。
- **先修测试写法**：全项目把 `waitForLoadState('networkidle')` 换成 `waitForFunction(() => window.AppState && Array.isArray(window.AppState.questions))`。浏览器测试立刻 19/26 → 26/26，**且不做这个，上面两项修复就没有自动化保护**。
- 收敛界面选择为唯一权威（修 P2-17：`web/ui-version.js:202` 与 `web/ui-bootstrap.js:16` 之间存在三处重复跳转）；切换界面或模式前重置 `daguan_local_mode_v1`（修 P2-18，1 行）。
- 清理可安全删除的遗留物：`web/index-old-backup.html`、`web/index-new-backup.html`、`web/ui-preview/`（生产零引用）；`web/app2.js`、`web/styles.css` 删除前需先同步改 6 处强耦合（`test/dual-ui.test.mjs:42,81`、`test/ui-contract.test.mjs:226,228,455`、`test/landing-entry.test.mjs:6`、`tools/verify-web-data.mjs:18-19,73`）。
- 首屏瘦身：`search_index.json` 改为按需加载、`local-mark.png` 去重（合计省约 4.4MB）；题库分片改按章节切或支持范围请求。

### 第六批：同步链路与远程访问（来自 09 报告）

- **修 P0-4 的三处时间戳**（3 行源码 + 3 行测试）：一处修复同时恢复安卓导出、官网 push、pull 的并发保护。这是**当前唯一一条让整个官网同步功能对真实用户完全不可用的缺陷**，性价比最高。
- **修 P1-O 的 migrate 字段清空**：这是唯一已实测的**静默数据丢失**（旧版迁移向导每次都会清掉批注与学习位置），合并前剔除缺失键即可。
- **给 `cxyonly-client` 全链路加超时，并把远端交互移出 `withLock`**（架构级：第三方服务不应持有本地写锁）。
- 网关 `BLOCKED` 匹配改用剥壳后的路径（P2-20，恢复纵深防御）；失败计数改为按 IP 且加 TTL 清理（P2-21）。

### 第七批：让 `npm test` 从「绿但空心」变成可信门禁（来自 10 报告）

1. **先修 P2-19 的 `networkidle`** —— 顺序不可颠倒：先装 Playwright 会立刻多 7 个红。
2. **删掉两个自证型假测试文件（P0-5）** —— `test/new-ui-core.test.mjs`、`test/web-sync.test.mjs`。删代码、零风险、立即消除 7.2% 的虚假通过数。**危害不是「没测到」而是「以为测到了」**；装了 Playwright 之后它们仍会绿，虚假信心会被放大。
3. **修 `local-server/store.mjs:5` 的隐式默认参数（P1-L）** —— 唯一一条既有产品代码价值、又能立刻消除一个红测试的修复；修好后 `AGENTS.md` 才从「不可执行的建议」变成真门禁，CI 设 `DAGUAN_DATA_DIR` 才有意义。
4. **`playwright` 进 devDependencies + CI 装 chromium + CI 断言 `skipped === 0`**，并把 `npm test` 移到建包之前、补上 `npm run verify`。
5. **把 `test/chapter-navigation.test.mjs` 改名为 `catalog-data-integrity.test.mjs`，另补真导航测试**（至少覆盖「叶子章节 id 能否解析回顶层科目」——正是 P1-M 的回归护栏）；把 `test/electron-security.test.mjs` 的静态断言升级为行为测试。

（**不选**「补 cxyonly 路由测试」或「CI 加桌面打包」：价值确实高，但都是新增大量工作量；在门禁不可信的前提下补新测试，新测试同样可能被 skip 或不被 CI 跑到。）

---

## 6. 交付物清单

| 文件 | 内容 |
|---|---|
| `00-master-verification.md` | 主理人交叉验证记录：P0 复现、CSRF 边界修正、shutdown 收窄、题库独立复算、PID 复用实测、**推翻的假设表** |
| `01-electron-security.md` | Electron 主进程 / preload / IPC / CSP / 权限（无 P0；F-01~F-13） |
| `02-updater-packaging.md` | 自动更新 / Squirrel 打包 / 安装 / 卸载（P1×3、P2×6、P3×7） |
| `03-local-server-data.md` | 本地服务 / 持久化 / 实例锁（P0×2、P1×3 及 P2/P3） |
| `07-question-bank-data.md` | 题库数据质量（P0×1、P1×3） |
| `08-ai-integration.md` | AI 问答与外部集成（P0×2、P1×4、P2×4、P3×4） |
| `05-e2e-fullflow.md` | 端到端全流程实测（A 环境基线 / B 测试套件 / C 服务端 / D 桌面版 / E 数据生命周期 / F 桌面-浏览器数据目录冲突 / G 资源清理；独立复现 P0-1，新增 P1-K、P1-L、P2-9~P2-12） |
| `04-frontend-ui.md` | 新版界面 UI/UX（P1×2：继续学习失效、外部同步清空判题痕迹；P2×4；P3×6；非浏览器 UI 测试 145/145 通过） |
| `06-legacy-ui-compat.md` | 旧界面与兼容层（**无 P0/P1**，最严重为 P2×3；P3×7；含新旧数据 12 键双向兼容实测与「可安全删除的遗留文件」清单） |
| `09-sync-remote.md` | 同步扩展 / 远程访问 / 官网集成（638 行；P0×1：时间戳三处 bug 致官网上传 100% 不可用 + 静默反向覆盖；P1×3、P2×6、P3×4） |
| `10-test-quality-docs.md` | 测试有效性 / CI / 文档一致性（553 行 / 88KB；**P0×2**：19 个自证型假测试、`npm test` 假绿灯门禁；P1×5；P2×9；P3×3；含完整 40 文件有效性矩阵、`server.mjs` 20 条零覆盖路由对照表、`electron-main.cjs` IPC/生命周期对照表、文档矛盾表、附录 B「未能验证」8 项） |

---

## 7. 验证方法与边界

- **测试基线（三档口径都要看，别只看绿色）**：① 不设 `DAGUAN_DATA_DIR` + 无 Playwright → `tests 265 / suites 9 / pass 239 / fail 0 / skipped 26`（**exit 0 ← CI 用的就是这一档**）；② **设了** `DAGUAN_DATA_DIR`（AGENTS.md 要求的隔离方式）+ 无 Playwright → `pass 238 / fail 1`（exit 1，唯一失败即 P1-L 的用例互相污染）；③ 设了 + 装上 Playwright → `pass 257 / fail 7 / cancelled 1 / skipped 0`（exit 1）。26 例 skip 全部因为缺 Playwright（它不在任何依赖里），**26 = 浏览器用例总数，即全部 E2E 在 CI 里一个都没跑**。**"npm test 全绿"只在不做隔离、且不装 Playwright 时成立。**
- **隔离**：所有实测使用临时 `DAGUAN_DATA_DIR`（`%TEMP%\dg-main-check\*`、`%TEMP%\dg-audit-*`），未读写真实 `%LOCALAPPDATA%\DaguanMath\data`，未做任何真实付费或写入第三方的调用。
- **只读**：全程未修改仓库源码；`git status` 结束时仍为 `## main...origin/main`，仅新增未跟踪的 `docs/desktop-audit-20261001/`。
- **未能验证**：真实浏览器 DOM 级 XSS（本机无 Playwright/jsdom）；`169.254.169.254` 的实际元数据请求（仅验证策略放行）；真实 `cxyonly` 契约（未登录）；Windows 关机/注销时的孤儿进程；正式安装器在干净 Windows 环境的安装验收。
- **噪音说明**：探针脚本结束时的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` + `[exit code: 1]` 是 `child.kill()` 后立即 `process.exit(0)` 在 Windows/Node 24 上的 libuv 噪音，与被测服务无关，不计入发现。
