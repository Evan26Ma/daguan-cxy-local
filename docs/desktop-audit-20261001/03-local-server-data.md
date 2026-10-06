# 03 · 本地服务与数据持久化层 只读审查报告

- 审查对象：`F:\AI\大观园本地`（正本 checkout，分支 `main`，HEAD `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，package `daguan-math-local` v1.0.10）
- 范围：`local-server/`（server.mjs 41009B / ai-service.mjs 24007B / sync-format.mjs 20289B / official-question-bank.mjs 17225B / cxyonly-client.mjs 9280B / instance-lock.mjs 7563B / question-bank-updater.mjs 5169B / store.mjs 4237B / visit-history.mjs 4027B / study-activity.mjs 10050B / catalog.mjs 2893B）+ `desktop/electron-main.cjs` 的服务托管部分
- 环境：Node v24.15.0 / PowerShell 7 / Windows
- 实验隔离：`DAGUAN_DATA_DIR=%TEMP%\dg-audit-03`（全新临时目录），端口 18081，未读写 `%LOCALAPPDATA%\DaguanMath\data` 与仓库 `data/`
- 本报告是本次审查唯一写入的文件；未修改任何仓库源码
- 收尾确认：本次启动的 4 个服务进程（PID 45968 / 47532 / 42572 / 3816）全部已退出，端口 18081 无监听，`.service-instance.json` 已释放。仍在运行的 3 个 `local-server/server.mjs`（PID 37048/18080、47604/18086、31584/18083）不是本报告启动的进程，未触碰

---

## 0. 结论摘要

本地服务在**数据一致性设计上相当扎实**：实例锁（`wx` 独占 + 恢复闸门 + 身份二次确认）、题库原子指针切换、状态写入 revision 乐观锁、临时文件 + rename 原子落盘、优雅退出等待在途写入——这些都有真实代码和测试支撑，未发现"两个进程都认为自己是 owner"或"永久无法启动"的缺陷；路径穿越在静态服务与题库参数上实测全部被拦。

问题集中在**HTTP 入口的健壮性与本机安全边界**：

1. **一个可远程（跨站）触发的进程崩溃**（P0）。`PATCH /api/state/questions/:id` 在掌握状态非法时，在锁回调里直接回写响应，导致同一响应被写两次，`ERR_HTTP_HEADERS_SENT` 抛在 catch 回调里 → unhandled rejection → **Node 进程直接终止**。已用真实请求复现，服务端打印完整堆栈后死亡。
2. **除 `/api/runtime/stop` 外的所有写接口零 CSRF 防护**（P0）。实测 `Origin: https://evil.example` + `Content-Type: text/plain`（CORS 简单请求，无需预检）可以成功改写单题状态、**整份覆盖清空 progress**、删除浏览历史、退出官网登录。
3. **Host 头不校验**（P1）→ DNS rebinding 可让恶意域变成"同源"，进而读取全部本地数据（含 AI 会话、官网 token 状态）。
4. **`state.json` 一旦损坏被静默当成空状态**（P1）：用户看到"进度全没了"，且下一次写入会把损坏但可能可恢复的文件直接覆盖，无备份、无告警、无日志。

另外发现一个**远端可控的路径穿越写**（P1，静态确认）：`catalog.mjs` 直接用远端 manifest 里的 `shards[*].file` 拼 `path.join`，无包含性校验，恶意/被劫持的题库源可越出 stageDir 写文件。

修复优先级建议：先堵 P0-1（一行改动）与 P0-2（统一 Origin/CSRF 中间件），再补 Host 校验与损坏文件自愈。

---

## 1. 发现清单

### P0-1 · 非法 mastery 触发双写响应，未捕获异常直接杀死服务进程

**证据（代码）** `local-server/server.mjs`

```js
446:  if (pathname.startsWith("/api/state/questions/") && !pathname.endsWith("/annotation") && method === "PATCH") {
452:    const saved = await withLock(async () => {
...
464:      if (incoming.mastery != null) {
465:        if (!["not_started","learning","mastered","forgot"].includes(incoming.mastery)) return json(res, 400, { ok: false, error: "掌握状态无效" });
...
481:      return writeState({ ...current, progress, ... }, { expectedRevision: current.revision, studyAction: true });
482:    });
483:    return json(res, 200, { ok: true, revision: saved.revision, state: saved });
```

`withLock` 回调里第 465 行返回的是 `json(...)` 的返回值（`undefined`），不是状态对象 → `saved === undefined` → 第 483 行读 `saved.revision` 抛 `TypeError` → 路由被第 645 行 `.catch((error) => errorJson(res, error))` 接住 → `errorJson` 调 `json()`（:47 `res.writeHead`）对**已经响应完的** res 再写 → `ERR_HTTP_HEADERS_SENT` 抛在 catch 回调内部，成为未处理的 rejection → Node 默认行为终止进程。`server.mjs` 全程没有 `process.on("unhandledRejection")`/`uncaughtException` 兜底（grep 确认只有 SIGINT/SIGTERM/disconnect/message）。

**证据（运行时复现）** 服务以 `DAGUAN_DATA_DIR=%TEMP%\dg-audit-03 PORT=18081` 启动后：

```
$st = (Invoke-WebRequest 'http://127.0.0.1:18081/api/state').Content | ConvertFrom-Json
Invoke-WebRequest 'http://127.0.0.1:18081/api/state/questions/3' -Method PATCH `
  -ContentType 'application/json' -Body "{`"mastery`":`"bogus`",`"revision`":$($st.revision)}" -SkipHttpErrorCheck
```

客户端侧：

```
[bad-mastery] 400 {"ok":false,"error":"掌握状态无效"}
alive-after: EXITED
```

服务端 stderr（`%TEMP%\dg-audit-03\err2.log`）：

```
node:_http_server:365
    throw new ERR_HTTP_HEADERS_SENT('write');
          ^
Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client
    at ServerResponse.writeHead (node:_http_server:365:11)
    at json (file:///F:/AI/大观园本地/local-server/server.mjs:47:7)
    at errorJson (file:///F:/AI/大观园本地/local-server/server.mjs:53:3)
    at file:///F:/AI/大观园本地/local-server/server.mjs:645:36 {
  code: 'ERR_HTTP_HEADERS_SENT'
}
Node.js v24.15.0
```

**跨站盲打可行性（已实测）** 崩溃要求 `revision` 命中当前值（不命中只会 409）。revision 是小整数单调自增，暴力枚举即可；`Content-Type: text/plain` 让请求成为 CORS 简单请求，**无需预检**：

```
foreach($rev in 0,1,2,3){
  Invoke-WebRequest 'http://127.0.0.1:18081/api/state/questions/9' -Method PATCH `
    -Headers @{Origin='https://evil.example'} -ContentType 'text/plain' `
    -Body "{`"mastery`":`"bogus`",`"revision`":$rev}" -SkipHttpErrorCheck
}
```

```
rev=0 -> 409 STATE_CONFLICT
rev=1 -> 409 STATE_CONFLICT
rev=2 -> 409 STATE_CONFLICT
rev=3 -> 400 {"ok":false,"error":"掌握状态无效"}
alive: EXITED          # 服务进程已被杀死
```

**影响** 任意网页（或本机任意进程）可用几次请求让本地服务进程退出。`desktop/electron-main.cjs` 只在启动阶段等待子进程（`startServiceCandidate`），运行期没有 `child.on("exit")` 重启逻辑（grep 确认只有关闭路径的 `once("exit")`），因此崩溃后前端 API 全部失效，用户必须重启应用。崩溃时正在写入的状态由 temp+rename 保证不损坏，但内存中未落盘的进度会丢。崩溃会残留 `.service-instance.json`（实测残留 pid=47532 的死锁），下次启动靠死 PID 恢复逻辑可正常接管（实测新实例 `bb7d3ed0-...` 启动成功），所以不是永久性损坏，但是可用性问题。

**修复建议**（任选，建议 1+2 都做）

1. 最小改动：第 465 行不要直接回写响应，改为抛出带状态码的错误：
   ```js
   if (![...].includes(incoming.mastery)) { const e = new Error("掌握状态无效"); e.status = 400; throw e; }
   ```
   （`errorJson` 已支持 `error.status`，见 :51-54）
2. 加固：`errorJson` 里先判断 `res.headersSent || res.writableEnded`，已发送则只记录日志并 `res.destroy()`；给 `server.mjs` 加 `process.on("unhandledRejection", ...)` 兜底，避免单点异常终结整个服务。
3. 同类模式排查：grep `return json(res` 出现在 `withLock(` 回调内的只有第 465 行这一处（:362/:364 在 stop 处理器里，不在锁内），所以这是一处单点缺陷。

**验证方式** 复现命令 + 断言"进程仍存活且 `/api/health` 返回 200"；建议补一条回归测试：`PATCH /api/state/questions/1 {"mastery":"bogus","revision":N}` 期望 400 且服务进程不退出。

---

### P0-2 · 所有写接口无 Origin/CSRF 校验，任意网页可静默清空用户数据

**证据（代码）** `local-server/server.mjs:359-368` 只有停止服务做了来源校验：

```js
if (pathname === "/api/runtime/stop" && method === "POST") {
  const origin = req.headers.origin;
  const remote = req.socket.remoteAddress;
  if (origin !== `http://${HOST}:${PORT}` || !["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote))
    return json(res, 403, { ok: false, error: "停止服务只允许从本机应用页面发起" });
```

其余写接口（`PUT /api/state`、`PATCH /api/state/questions/:id`、`PATCH .../annotation`、`PATCH /api/state/last-study`、`POST /api/state/migrate`、`DELETE /api/visit-history*`、`POST /api/integrations/cxyonly/*`、`POST /api/ai/*`）**完全不看 Origin/Referer，也不校验 Content-Type**，且没有 OPTIONS 预检处理（`OPTIONS /api/state` 直接落到静态服务返回 404）。响应也没有 `Access-Control-Allow-Origin`，所以跨站读被浏览器挡住，但**写不受限**。

**证据（运行时）** 全部带 `Origin: https://evil.example` + `Content-Type: text/plain`：

```
[C csrf-write]    PATCH /api/state/questions/1 {"mastery":"learning","revision":0}
                  -> 200  acao=[] acac=[]
[C2 state-after]  GET /api/state -> revision 1, progress.1 = {"mastery":"learning",...}
[C3 csrf-put]     PUT /api/state {"revision":1,"progress":{},"favorites":[],"picked":[]}
                  -> 200 {"ok":true,...,"revision":2,"progress":{}...}   # progress 被清空
[C4 csrf-delete]  DELETE /api/visit-history            -> 200 {"ok":true}
[C5 csrf-logout]  POST /api/integrations/cxyonly/logout -> 200 {"ok":true}
```

**影响** 用户浏览任意网页（或点击广告/被注入的 iframe）即可被静默改写/清空本地刷题进度、收藏、批注、浏览历史，并强制退出官网登录；配合 P0-1 还能直接打死服务。属于本机应用的经典 CSRF/本地服务边界缺失。

**修复建议**

1. 抽一个统一的写请求守卫：对全部非 GET 路由校验 `Origin` 必须是 `http://127.0.0.1:${PORT}`（或 `http://localhost:${PORT}`）且 `remoteAddress` 是本机回环；缺失/不符直接 403。
2. 同时校验 `Content-Type: application/json`（拒 `text/plain`），这样跨站必须走预检，而预检一律拒绝即可。
3. 校验 `Host` 头必须是 `127.0.0.1:${PORT}` / `localhost:${PORT}`（顺带修 P1-1）。
4. 可选纵深：给写接口要求一个启动时随机生成、只注入到本机页面 `window.__DSH_BOOT__` 式引导数据的 token。

**验证方式** 上表命令全部应返回 403；同时确认本机页面（`Origin: http://127.0.0.1:18081`）写入仍 200。仓库已有 `test/runtime-stop.test.mjs` 的同类断言模式可复用。

---

### P1-1 · 不校验 Host 头，DNS rebinding 可读取全部本地数据

**证据** raw socket 请求（`Host: evil.example`）：

```
GET /api/state HTTP/1.1
Host: evil.example
Connection: close

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
...
{"format":"daguan-local-state","version":3,"revision":...
```

**影响** 攻击者控制一个域名并把 DNS 解析指向 127.0.0.1，浏览器会认为该域与本地服务"同源"，从而**读取** `/api/state`（全部学习进度/批注）、`/api/ai/conversations/...`（AI 会话内容）、`/api/integrations/cxyonly/status` 等；结合 P0-2 也能写。

**修复建议** 统一守卫里加 Host 白名单（见 P0-2 第 3 条）。**验证方式** 同一 raw socket 请求应返回 403。

---

### P1-2 · `state.json` 损坏被静默当成空状态，且随后被空状态覆盖

**证据（代码）** `local-server/store.mjs`

```js
24:  async function readJson(file, fallback) {
25:    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
26:  }
...
39:    async readState() {
40:      return normalizeLocalState(await readJson(stateFile, { format: "daguan-local-state", version: 3, progress: {}, favorites: [], picked: [], updated_at: null }));
41:    },
```

`catch` 吞掉一切错误（包括 JSON 语法错误与读取错误），无日志、无备份、无自愈。`writeState`（:58 `next.revision = current.revision + 1`）基于这个空状态继续，于是损坏文件被覆盖。仓库里 `store.writeBackup`（:71-77）只写 `cxyonly-backups/`，**`state.json` 本身没有任何备份**（grep `.bak|backup` 确认）。

**证据（运行时）** 把 `state.json` 截断成非法 JSON（保留 `revision: 7` 与 progress）后启动服务：

```
[state-on-corrupt] 200 {"format":"daguan-local-state","version":3,"revision":0,"progress":{},"annotations":{},"favorites":[],"picked":[],
                      "last_study":null,...}
backup files: (无)
```

用户视角：进度、收藏、批注全部"凭空消失"，且没有任何报错提示；一旦继续做题，磁盘上损坏但可能部分可恢复的文件被彻底覆盖。

**影响** 断电/磁盘满/被外部工具截断后，用户数据静默丢失且不可恢复（对比：`visit-history.mjs:38-54` 与 `study-activity.mjs:107` 在损坏时是**抛错**的，行为不一致，说明作者本意也不是静默）。

**修复建议**

1. `readJson` 区分 `ENOENT` 与解析失败：`ENOENT` 用 fallback，解析失败抛错并附带文件路径。
2. 读取失败时把原文件重命名为 `state.json.corrupt-<时间戳>` 保留证据，再以空状态继续，并让 `/api/health` 或状态响应带一个 `warnings` 字段提示用户。
3. `writeState` 落盘前把上一版复制到 `state.json.bak`（或 `backups/state-<日期>.json`），保留最近 N 份。

**验证方式** 单测：写入损坏 `state.json` → 期望抛出可识别错误 + 生成 `.corrupt-*` 备份，而不是返回 `revision: 0`。

---

### P1-3 · 远端 manifest 的 `shards[*].file` 未做包含性校验 → 任意路径写

**证据（代码）** `local-server/catalog.mjs`

```js
26:  const files = [...required, ...Object.values(manifest.shards).map((meta) => meta.file)];
...
30:  ... await fs.copyFile(path.join(dataDir, file), path.join(stageDir, file))   // 或类似
32:  ...
48:  for (const file of files) await fs.copyFile(path.join(stageDir, file), path.join(dataDir, file));
50:  ...
```

`file` 直接来自远端（或本地被替换的）`manifest.json`，只经过了"文件存在性"检查，没有任何 `path.relative`/`startsWith` 包含性校验；`shards[*].file = "../../../../x.js"` 即可把内容写到 `stageDir`/`dataDir` 之外，最终 copy 阶段可覆盖仓库或用户目录中的任意路径。

**影响** 题库刷新源被劫持（或本地 `web/data/manifest.json` 被写入恶意内容）即可任意文件写，属于提权链的一环。

**修复建议** 在读取 manifest 后立刻规范化并校验：

```js
const safe = path.resolve(stageDir, file);
if (!safe.startsWith(stageDir + path.sep)) throw new Error("题库清单包含非法路径");
```

同时对 `required` 常量同样处理；`manifest.shards` 的每个 `file` 建议只允许 `/^[A-Za-z0-9._-]+\.json$/`。

**验证方式** 构造带 `../../` 的 manifest 的单测，期望抛出且不产生任何 stageDir 之外的文件。

---

### P2-1 · 外部请求缺超时：上游挂起会连带卡死所有状态写入

**证据** `local-server/catalog.mjs:8-12` `fetchJson` 既无 `AbortSignal.timeout` 也无大小上限；`local-server/cxyonly-client.mjs:36-68` `request()` 同样无超时（对比 `ai-service.mjs:117-122` 的 `fetchWithTimeout` 90s，说明作者知道该模式）。`server.mjs:242-243` 的 `reconcile/preview` 里有 `while (catalogTask.status === "running")` 轮询，会随刷新任务一起永久挂起；`cxyonly-client` 的调用发生在 `withLock` 内，上游不回包时所有状态写入一起阻塞。

**修复建议** 两处统一加 `AbortSignal.timeout(15_000~30_000)` + 响应体大小上限（如 20MB）；轮询循环加总超时与 `status === "failed"` 出口。

**验证方式** 用一个永不响应的本地 mock 服务器跑 `POST /api/catalog/refresh` 与 cxyonly 拉取，断言在 N 秒内返回超时错误且 `/api/state` 写入不受影响。

---

### P2-2 · `PATCH /api/state/last-study` 传 `revision: null` 可绕过并发校验

**证据（代码）** `local-server/server.mjs`

```js
509:  const expectedRevision = req.headers["if-match"] != null ? Number(req.headers["if-match"]) : incoming.revision;
510:  if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) return json(res, 409, { ok:false, code:"REVISION_REQUIRED", ... });
511:  const saved = await withLock(async () => {
512:    const current = await store.readState();
513:    if (expectedRevision != null && current.revision !== expectedRevision) { ... throw 409 ... }
```

第 510 行用 `Number(expectedRevision)` 判空（`Number(null) === 0`，判为合法），第 513 行却用 `expectedRevision != null` 判空（`null` 时**跳过**冲突检查）→ 传 `{"revision":null}` 时校验被整体绕过。对比第 450-451 行的逐题接口写的是 `incoming.revision`（不经过 `Number()`），所以 `null` 会被 `Number.isInteger(null) === false` 挡下——两处不一致。

**证据（运行时）**

```
[null-rev-laststudy] PATCH /api/state/last-study {"revision":null,"questionId":42}
                     -> 200 {"ok":true,"revision":3,...}      # 当前 revision 为 2，未被拦
[null-rev-patch]     PATCH /api/state/questions/5 {"mastery":"mastered","revision":null}
                     -> 409 REVISION_REQUIRED                 # 逐题接口正常
[no-rev-patch]       PATCH /api/state/questions/6 {"mastery":"mastered"}
                     -> 409 REVISION_REQUIRED
[str-rev]            PATCH /api/state/questions/7 {"mastery":"learning","revision":"abc"}
                     -> 409 REVISION_REQUIRED
```

**影响** 过期页面/旧标签页可用 `revision:null` 无条件覆盖 `last_study`（低危字段），属于乐观锁漏口；若该写法被复制到其他接口则影响放大。

**修复建议** 第 510 行改为与 450-451 一致的 `Number.isInteger(expectedRevision)`（不做 `Number()` 强制转换），并把 513 行的 `expectedRevision != null` 去掉（此时必然是整数）。

**验证方式** 单测断言 `{"revision":null}` 返回 409。

---

### P2-3 · `previews` / `catalogTasks` Map 只增不减，长跑内存泄漏

**证据** `local-server/server.mjs:36-37` 定义 `previews`、`catalogTasks`；`previews` 仅在 apply 时 `delete`（:270 附近），过期条目（注释提到 30 分钟 TTL）**没有任何定时清理**，每个条目持有整份远端文档（全量进度/收藏）。`catalogTasks` 同样从不清理。`previews.set` 见 :192、:213。

**影响** 长期运行的桌面服务内存随预览次数单调增长；用户反复点"预览同步"即可积累大对象。

**修复建议** 用 `setTimeout(...).unref()` 在写入时安排过期删除，或在 `readPreview` 时顺带清理已过期条目；`catalogTasks` 保留最近 N 条即可。

**验证方式** 循环调用 `POST /api/integrations/cxyonly/pull/preview` 若干次，断言 `previews.size` 有上限（可加一个 `/api/health` 里的调试计数或用 `--expose-gc` 观察堆）。

---

### P2-4 · 语义错误返回 500（应为 400/413），且出错后不处理请求体

**证据（代码）** `local-server/server.mjs`

```js
23: const MAX_BODY = 10 * 1024 * 1024;
99:  async function body(req) {
...
     if (size > MAX_BODY) throw new Error("请求体过大");
     ...
     } catch { throw new Error("JSON 格式错误"); }
```

两个 Error 都没带 `status`，`errorJson` 默认 500（:51-54）。

**证据（运行时）**

```
PUT /api/state  body={"progress":            -> 500 {"ok":false,"code":null,"error":"JSON 格式错误"}   # 应 400
PUT /api/state  body=11MB                    -> 500 {"ok":false,"code":null,"error":"请求体过大"}     # 应 413
之后 GET /api/health                         -> 200   # 进程存活，未销毁请求流
```

**影响** 客户端无法区分"我发错了"和"服务端坏了"，会把 500 计入错误率/触发重试；超限请求的剩余数据未被 `req.destroy()`，超大 body 会继续被读取。

**修复建议** 给这两个错误加 `error.status = 400` / `413`（或 `code: "BODY_TOO_LARGE"`），并在抛错前 `req.destroy()` 或 `req.resume()` 排空。

**验证方式** 断言两个响应码分别为 400 / 413。

---

### P3-1 · `event_id = "__proto__"` 通过校验但事件被静默丢弃

**证据** `local-server/study-activity.mjs:9` `const EVENT_ID = /^[\w-]{8,100}$/`（`\w` 含下划线，`__proto__` 恰为 9 字符），随后 `data.events[e.event_id] = {...}`（:125、:144）——对 `__proto__` 是改写原型而非添加自有属性，事件丢失且不报错。

**修复建议** 正则收紧为 `/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/`，或显式拒绝 `__proto__/constructor/prototype`，并用 `Object.create(null)` 存 events。

**验证方式** 单测：提交 `event_id="__proto__"` 期望 400，且 `Object.prototype` 未被污染。

---

### P3-2 · 测试不隔离宿主环境变量 `DAGUAN_DATA_DIR`（附带真实失败证据）

**证据** `local-server/store.mjs:5` `createStore(rootDir, dataDirOverride = process.env.DAGUAN_DATA_DIR)`：只要宿主环境里有 `DAGUAN_DATA_DIR`，测试里所有 `createStore(root)` 的 `root` 都会被忽略，多个测试文件共用同一个外部目录。实测（我按任务要求设置了 `DAGUAN_DATA_DIR`）9 文件共 50 条测试时：

```
✖ test\ai-service.test.mjs:71 无模型可保存并获取列表，旧档案默认流式，Key 留空保留
  AssertionError: + actual 'sk-secret-key' - expected 'test-only-key'
  at TestContext.<anonymous> (file:///F:/AI/大观园本地/test/ai-service.test.mjs:80:10)
ℹ tests 50 / pass 49 / fail 1 / skipped 0 / duration_ms 15325
```

即前一条测试写入的档案串到了后一条测试。**清掉该环境变量后 `node --test test/ai-service.test.mjs` → tests 8 / pass 8 / fail 0**，证明失败由环境变量污染引起，而非产品缺陷。

**影响** 若开发者/CI 环境继承了指向真实数据目录的 `DAGUAN_DATA_DIR`（桌面版启动器就是用它注入 `%LOCALAPPDATA%\DaguanMath\data` 的），跑测试会直接写真实用户数据。属于测试卫生问题。

**修复建议** 测试统一显式传第二参数 `createStore(root, root)`（或 `createStore(root, path.join(root,"data"))`）；或把默认值改成"仅在非测试进程使用"（例如 `process.env.NODE_TEST_CONTEXT ? undefined : process.env.DAGUAN_DATA_DIR`）。CI 里显式 `Remove-Item Env:DAGUAN_DATA_DIR`。

**验证方式** 带 `DAGUAN_DATA_DIR` 指向临时目录跑 9 文件测试，期望 50/50 通过。

---

### P3-3 · 密钥明文落盘；`mode 0o600` 在 Windows 上是空操作

**证据** `store.mjs:28-33` `writeJson(..., mode = 0o600)` 与 `if (process.platform !== "win32") await fs.chmod(file, mode)`；`ai-service.mjs` 把 `key` 明文写入 `ai-profiles.json`；`cxyonly-client.mjs:114-124` 把官网 `token` 明文写入 `cxyonly-integration.json`。Windows 下这两个文件对当前用户及同机进程可读，且 `instance-lock.mjs:96-98` 的 `0o600` 同样无效（对锁文件无所谓，对密钥文件有所谓）。

**缓解** `ai-service.publicProfile`（:124-137）只回 `keyHint` 掩码，`cxyonly-client.redactSecrets`（:13-19）按 key 名过滤 token/password/secret/authorization/cookie，接口层不泄露。

**修复建议** 用 Electron 的 `safeStorage`（DPAPI）加密后再落盘，或至少对 Windows 设置 ACL（`icacls` 只允许当前用户）。文档里明确说明密钥以明文存于数据目录。

**验证方式** 写入一个 profile 后检查磁盘文件不含明文 key（改造后）。

---

### P3-4 · 其它低危项（静态确认，未逐一运行时复现）

- `ai-service.mjs:35-54` `validateBaseUrl` 先解析 DNS 再在请求时使用，存在解析后重绑定（TOCTOU）窗口；且允许 `https://` 指向内网地址（仅对 `http://` 强制内网判定），SSRF 面略宽。低危（需用户主动填写地址）。
- `official-question-bank.mjs:232-267` `downloadAssets` 在缺少 `DAGUAN_ASSET_TOKEN` 时**静默**跳过资源下载（只在 manifest 记 `missingAssets`），单张失败被 `catch {}` 吞掉；建议至少汇总到返回体与日志。
- `catalog.mjs:48-53` 刷新是逐文件 `fs.copyFile` 覆盖 `web/data`，**无回滚/无备份**，中途失败或断电会留下新旧混合题库（对比 `question-bank-updater.mjs:66-72` 的 staging + 原子指针切换，做法更好，建议统一到同一条路径）。
- `server.mjs:599-642` `serveStatic` 用 `res.end(await fs.readFile(file))` 整文件读入内存、无 `Content-Length`/流式；大题库分片文件会造成瞬时内存峰值。
- `server.mjs` 静态服务依赖 `decodeURIComponent` + `path.resolve` + `startsWith` 三重防护（:601-609），本次实测穿越全部被拦（见第 2 节），但这类手写校验建议改为"解析后取 `path.relative` 且不得以 `..` 开头"的写法以防后续改动退化。

---

## 2. 已跑命令与测试结果摘录

### 2.1 测试

命令（隔离目录，含 9 个必跑文件）：

```powershell
cd 'F:\AI\大观园本地'; $env:DAGUAN_DATA_DIR="$env:TEMP\dg-audit-03-tests"
node --test test/local-server.test.mjs test/service-instance.test.mjs test/backup-migration.test.mjs `
  test/question-bank-updater.test.mjs test/official-orphan-classifications.test.mjs `
  test/visit-history.test.mjs test/runtime-stop.test.mjs test/ai-service.test.mjs test/study-activity.test.mjs
```

结果：`tests 50 / suites 0 / pass 49 / fail 1 / cancelled 0 / skipped 0 / duration_ms 15325`。唯一失败是 `test/ai-service.test.mjs:71`（原因见 P3-2，由我设置的环境变量引起）；随后 `Remove-Item Env:\DAGUAN_DATA_DIR; node --test test/ai-service.test.mjs` → `tests 8 / pass 8 / fail 0`。

通过的用例覆盖：实例锁竞争/复用/死 PID 恢复/协议不兼容拒连、优雅退出等待在途写入、跨年备份合并、visit-history 去重与删除、study-activity 分日与统计口径、题库原子更新与离线保底、孤儿题分类、sync-format 合并/对账/预览统计、ai-service 流式过滤与地址策略。未跑全量 `npm test`（按任务分工由其它子代理负责）。

### 2.2 运行时探测（服务：`node local-server/server.mjs`，`DAGUAN_DATA_DIR=%TEMP%\dg-audit-03`，`PORT=18081`，`DAGUAN_OPEN_BROWSER=0`）

启动输出：`SERVICE_INSTANCE_READY http://127.0.0.1:18081/ 32c59628-f250-4043-9475-4666d57a1814`；数据目录生成 `.service-instance.json`(229B)、`study-activity.json`(92B)。

| 探测 | 结果 |
| --- | --- |
| `GET /api/health` | 200 `{"ok":true,"service":"daguan-local-console","apiProtocol":1,"instanceId":"...","pid":45968,"port":18081,...}` |
| `GET /api/state` | 200 `{"format":"daguan-local-state","version":3,"revision":0,...}` |
| `GET /../package.json` | 404 `{"error":"资源不存在"}` |
| `GET /%2e%2e/package.json` | 404 |
| `GET /..%2f..%2fpackage.json` | **403 `{"error":"禁止访问"}`** |
| `GET /%252e%252e%252fpackage.json` | 404 |
| `GET /data/../../package.json` | 404 |
| `GET /data/manifest.json?bank=../../` | 404 `{"error":"题库版本不存在"}` |
| `GET /data/manifest.json?bank=not-a-uuid` | 404 |
| `POST /api/runtime/stop`（无 Origin） | 403 `{"ok":false,"error":"停止服务只允许从本机应用页面发起"}` |
| `POST /api/runtime/stop`（`Origin: http://evil.example`） | 403 |
| `POST /api/runtime/stop`（`Origin: http://127.0.0.1:18081`） | 200 `{"ok":true}` → 进程优雅退出、`.service-instance.json` 被删除 |
| `PUT /api/state`（无 revision） | 409 `REVISION_REQUIRED` |
| `PUT /api/state`（`{"progress":`） | **500** `JSON 格式错误`（应 400） |
| `PUT /api/state`（11MB body） | **500** `请求体过大`（应 413），之后 `/api/health` 仍 200 |
| `GET /api/study-activity?days=abc` / `?days=-5` / `?days=999999999` | 400 `统计范围无效` |
| `POST /api/visit-history`（`{}` 或 `{"id":"../../evil"}`） | 400 `题目 ID 无效` |
| 跨站写（`Origin: https://evil.example` + `text/plain`） | 200（PATCH/PUT/DELETE/logout 全部成功，见 P0-2） |
| `GET /api/state` + `Host: evil.example`（raw socket） | 200 返回完整 state（见 P1-1） |
| 非法 mastery（revision 命中） | 客户端 400，**服务进程 EXITED**（见 P0-1） |
| 损坏 `state.json` 后 `GET /api/state` | 200 且返回空状态 `revision:0`（见 P1-2） |
| 崩溃后残留死锁再启动 | 正常恢复，新 instanceId `bb7d3ed0-...`（锁恢复逻辑有效） |

探测脚本注意点（供复现参考）：PowerShell 的 `-Headers @{'If-Match'='0'}` 会因 ETag 格式报 `The format of value '0' is invalid`，改用请求体里的 `revision` 字段；`GET /api/ai/conversations/../../../api/state` 会被客户端 URL 归一化成 `/api/state`，不能作为服务端穿越证据。

### 2.3 值得肯定的设计（本次实测/通读确认）

- `instance-lock.mjs`：`fs.open(lockPath,"wx",0o600)` 真独占（:96-98）；`validOwner` 严格校验 version/pid/instanceId/host/port（:33-37）；`recoveryGate` 用随机 token + before/after 文本比对 + mtime 宽限避免并发恢复（:39-66）；`release()` 校验 instanceId+pid 才删锁（:145-147）。实测"死 PID 残留锁可恢复""协议不兼容拒连""同目录竞争只有一个写入者"均符合预期。
- `question-bank-updater.mjs`：staging 目录 → `rename` → `current.json.tmp` → `rename` 原子切指针（:66-72），失败保留上一版。
- `official-question-bank.mjs`：分页一致性校验（total/page/content_hash）后才落盘（:32-59）；全流程 mkdtemp staging + 结束前校验临时目录位置（:322-328）。
- `server.mjs:699-713` 优雅退出：先广播 stopping 事件，`server.close()` 后在途写入完成才 `lease.release()` + `exit(0)`，实测有效。
- `ai-service.mjs`：`fetchWithTimeout` 90s + `redirect:"error"`、`createAnswerFilter` 跨 chunk 过滤 think 标签、并发 run 上限 2、`sanitizeSvgMarkup` 清洗 Python 生成 SVG。

---

## 3. 未能验证事项

1. **catalog.mjs 远端路径穿越（P1-3）未做真实写入复现**。理由：需要伪造一个远端题库源（或替换本地 `web/data/manifest.json`）才能触发，这会把写入落到仓库或用户目录，违反本次"只写报告"的硬约束。结论基于代码静态确认（`catalog.mjs:26/30/32/50` 无包含性校验）。
2. **同步/对账链路（sync-format.mjs 20289B）只做了测试级验证**，未逐行审读，也未构造真实官网流量；`official-question-bank.mjs` 的网络路径未在无网/弱网下压测。
3. **未验证 Electron 桌面壳在服务崩溃后的用户可见行为**：只确认 `desktop/electron-main.cjs` 运行期没有重启子进程的 `exit` 处理器（grep `serverChild` / `once("exit")`，命中项都在启动或关闭路径），未实际运行桌面版观察 UI 表现。
4. **previews/catalogTasks 泄漏（P2-3）未做堆快照量化**，只做代码路径确认（无定时清理）。
5. **未跑全量 `npm test`（31 个文件）**，按任务分工由其它子代理负责；本次只跑了指定的 9 个文件。
6. **未验证 Windows 下 `0o600` 的实际 ACL 效果**（P3-3 结论来自 Node 文档与代码中 `platform !== "win32"` 的判断，未用 `icacls` 实测）。
7. `shared/` 目录未审读。

---

## 4. 按性价比排序的优化建议

1. **修 P0-1（约 1 行 + 1 个兜底）**：`server.mjs:465` 改为抛 `status: 400` 的错误；`errorJson` 增加 `res.headersSent` 判断；`server.mjs` 加 `unhandledRejection`/`uncaughtException` 兜底日志。收益极高（消除可远程触发的进程死亡），成本极低。
2. **加统一写请求守卫（约 30 行）**：非 GET 路由统一校验 `Origin` ∈ {`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`}、`remoteAddress` 为回环、`Host` 白名单、`Content-Type` 必须为 JSON，并拒绝所有 OPTIONS 预检。一次性修掉 P0-2 与 P1-1。
3. **`state.json` 损坏自愈 + 备份（约 20 行）**：`readJson` 区分 ENOENT 与解析失败；失败时重命名为 `.corrupt-<ts>` 并告警；`writeState` 前保留上一版备份。消除"进度凭空消失且不可恢复"的信任危机。
4. **给所有出网请求加超时与体积上限**：`catalog.mjs:8-12`、`cxyonly-client.mjs:36-68` 复用 `ai-service.mjs:117-122` 的模式，并给 `reconcile/preview` 的 `while` 轮询加总超时（P2-1）。
5. **题库刷新统一走原子路径**：让 `catalog.mjs` 的刷新复用 `question-bank-updater.mjs` 的 staging + 指针切换，顺带修 P1-3 的路径校验与 P3-4 的混合题库问题。
6. **补测试**：P0-1 回归（非法 mastery 后进程存活）、P0-2/P1-1 守卫（跨站请求 403）、P1-2 损坏文件自愈、P2-2 `revision:null` 409；并让测试显式传入数据目录以摆脱 `DAGUAN_DATA_DIR` 污染（P3-2）。
7. **密钥落盘加固**：Windows 上用 `safeStorage`/DPAPI 或收紧 ACL（P3-3）；`previews`/`catalogTasks` 加过期清理（P2-3）；错误码语义修正为 400/413（P2-4）；`study-activity` 的 `event_id` 正则收紧（P3-1）。
