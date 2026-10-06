# 00 · 主理人交叉验证记录（大观园桌面版全流程审计）

- 验证者：主理人（本会话），非子代理
- 对象：`F:\AI\大观园本地`（分支 `main`，HEAD `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，`daguan-math-local` v1.0.10）
- 环境：Windows / Node v24.15.0 / npm 11.12.1 / 日期 2026-10-01
- 隔离：所有探针用临时 `DAGUAN_DATA_DIR`（`%TEMP%\dg-main-check\*`），未读写 `%LOCALAPPDATA%\DaguanMath\data` 与仓库 `data/`；未修改任何仓库源码
- 探针脚本：`%TEMP%\dg-main-check\probe{2,3,5,6,7,9}.mjs`（内容见本文各节）
- 本文件是本次审计唯一由主理人写入的文件

---

## 1. 确证：P0 服务进程可被远程触发崩溃

**主张来源**：子代理 03（`03-local-server-data.md` P0-1）

**代码路径**（已逐行核对，行号准确）：

```
local-server/server.mjs:446    if (pathname.startsWith("/api/state/questions/") && !pathname.endsWith("/annotation") && method === "PATCH") {
local-server/server.mjs:452      const saved = await withLock(async () => {
local-server/server.mjs:465        if (!["not_started","learning","mastered","forgot"].includes(incoming.mastery)) return json(res, 400, { ok: false, error: "掌握状态无效" });
local-server/server.mjs:483      return json(res, 200, { ok: true, revision: saved.revision, state: saved });
local-server/server.mjs:645    route(req, res).catch((error) => errorJson(res, error));
```

`withLock` 回调在 :465 提前 `return json(...)`（返回 `undefined`），使 `saved === undefined`；:483 读 `saved.revision` 抛 `TypeError`；:645 的 `.catch` 调 `errorJson` → `json` → `res.writeHead`（`server.mjs:47`）对已发送的响应二次写头 → `ERR_HTTP_HEADERS_SENT` 抛在 catch 回调**内部** → 未处理 rejection → Node 终止进程。`server.mjs` 全文件无 `unhandledRejection`/`uncaughtException` 兜底（grep 仅得 SIGINT/SIGTERM/disconnect/message）。

**主理人独立复现**（探针 `probe7.mjs`：spawn 服务 → 等 `SERVICE_INSTANCE_READY` → `PATCH /api/state/questions/1` body `{"revision":0,"mastery":"bogus_value"}` → 等 2.5s → 查进程与 `/api/health`）：

```
READY
PATCH_STATUS 400 BODY {"ok":false,"error":"掌握状态无效"}
PROCESS {"exited":true,"code":1,"signal":null}
HEALTH_AFTER_ERROR fetch failed
STDERR_TAIL "    at json (file:///F:/AI/.../local-server/server.mjs:47:7)
    at errorJson (file:///F:/AI/.../local-server/server.mjs:53:3)
    at file:///F:/AI/.../local-server/server.mjs:645:36 {
  code: 'ERR_HTTP_HEADERS_SENT'
}
Node.js v24.15.0"
```

**结论：确证。** 客户端只看到 400，服务进程以 exit code 1 死亡，`/api/health` 不再可达。`desktop/electron-main.cjs` 运行期无子进程退出重启逻辑，用户只能重启应用。

**唯一性核对**：`grep` 全文件后确认，`withLock` 回调内提前 `return json(res, ...)` 的**仅 :465 一处**；:452 / :491 / :511 / :526 / :294 的其余 `withLock` 回调均正确 `return writeState(...)`。故这是孤例缺陷，非系统性模式。

**可达性**：`PATCH` 属非简单方法，浏览器普通跨站请求会被预检挡住（见第 2 节）；但 `POST /api/state/questions/:id` 不匹配该分支。实际远程可达路径是 DNS rebinding（同源后无预检）或本机任意进程；另需猜中当前 `revision`（初始为 0，枚举 0..N 成本极低）。

---

## 2. 修正：CSRF 可达范围——简单请求可达，PUT/PATCH/DELETE 普通跨站不可达

**主张来源**：主理人自查（M2）+ 子代理 03（P0-2）。03 报告措辞为"跨站可清空进度"，此处据实测**收窄**。

**主理人实测 A（简单请求可达）**：探针 `probe3.mjs`，`Origin: http://evil.example` + `Content-Type: text/plain;charset=UTF-8`（CORS 简单请求，**不触发预检**）POST `/api/visit-history`：

```
CSRF_visit_history -> 200 {"ok":true,"entry":{"question_id":"999999","category_id":null,"chapter_id":"injected","visited_at":"2020-01-01T00:00:00.000Z","time_kind":"visit"}}
READ_visit_history -> 200 （读回，污染已落盘）
```

**主理人实测 B（预检被挡）**：探针 `probe9.mjs`，对三个写端点发 `OPTIONS` 并带 `Origin: https://evil.example` + `Access-Control-Request-Method`：

```
PREFLIGHT PATCH /api/state/questions/1 -> 404 ACAO=null ACAM=null
PREFLIGHT PUT /api/state -> 404 ACAO=null ACAM=null
PREFLIGHT DELETE /api/visit-history -> 404 ACAO=null ACAM=null
DIRECT_DELETE -> 200 ACAO=null body={"ok":true}
```

服务端**不处理 OPTIONS**、不返回任何 `Access-Control-Allow-*`，故浏览器预检失败，真实请求不会发出。`DIRECT_DELETE` 的 200 是 Node `fetch` 直发（无 CORS 概念）的结果，只证明"服务端不校验 Origin"，**不能**证明浏览器跨站可达。

**修正后的准确结论**：

| 攻击面 | 可达性 | 证据 |
|---|---|---|
| `POST` + `text/plain`/`form-urlencoded` 简单请求（写 visit-history、study-activity 等） | **任意网页可直接触发** | probe3：200 + 落盘 |
| `PUT`/`PATCH`/`DELETE` 普通跨站 | **不可达**（预检 404 无 CORS 头） | probe9 |
| 上述全部（含读 `/api/state`） | **DNS rebinding 后可达** | probe3：`Host: evil.example` → `GET /api/state` 200 返回完整状态 |
| 本机任意进程 | 可达（无 Origin/Host 校验） | probe3 |

**旁证**：`local-server/server.mjs:359-368` 的 `/api/runtime/stop` 是全服务**唯一**做了 Origin + 回环校验的端点，实测伪造 Origin 返回 403，证明该防护写法有效、只是没推广到其他路由。

**未泄露项**：`local-server/ai-service.mjs:124-137` 的 `publicProfile()` 只回传 `keyHint`（前 3 后 3 字符），**不泄露完整 API key**；因此 DNS rebinding 的危害是"完整读写学习数据 + 消耗 AI 配额 + 操作用户官网账号（cxyonly 拉取/推送）"，不是"直接偷 key"。

---

## 3. 确证并收窄：shutdown / 退出无超时兜底

**主张来源**：主理人自查（M1）

**代码**：

```
local-server/server.mjs:699-713   const shutdown = async () => { ... server.close(async () => { await questionBank?.stop(); await lease.release(); process.exit(0); }); /* Do not force-close active requests here */ };
desktop/electron-main.cjs:271-304 requestQuit()：child.send({type:"shutdown"}) 后只 child.once("exit")，无任何超时
desktop/electron-main.cjs:201-212 stopOwnedServiceForRestart()：同样无超时
```

**实测（探针 `probe2.mjs`，raw socket 发半开请求：声明 `Content-Length: 2000` 但不发完 body）**：

```
RESULT_C {"exited":false,"note":"12s 内未退出"}
AFTER_SOCKET_CLOSED {"code":0,"signal":null,"ms":12034}
```

**实测（探针 `probe5.mjs`，保持一条 SSE 长连接后发 shutdown）**：

```
SSE_STATUS 200
SHUTDOWN_SENT
RESULT {"exited":true,"code":0,"signal":null,"ms":820}
```

**实测（`probe.mjs` 场景 A/B）**：无连接 25ms 退出；空闲 keep-alive 连接 20ms 退出。

**结论：确证但收窄。** 阻塞条件是"存在**未完成**的在途请求"（半开 TCP、进行中的写入/流式响应）；SSE 与空闲 keep-alive **不**阻塞，因为 `server.mjs:702-705` 会主动向所有 `stateEventClients` 写 `event: server-stopping` 并 `response.end()`，再 `stateEventClients.clear()`。

**真实影响**：一旦某个请求永不完成（客户端崩溃但 socket 未 RST、半开连接），服务不退出 → `requestQuit()` 的 Promise 永不 resolve → 托盘已销毁、对话框已关闭，进程残留。定 **P2**（触发条件罕见但后果是"无法通过 UI 退出/无法安装更新"）。同类问题也存在于 `installDownloadedUpdate()` 路径。

**建议**：`shutdown()` 在 `server.close()` 后加一个 `setTimeout(() => process.exit(0), N).unref()` 兜底；`requestQuit()` 给 `child.once("exit")` 配 `Promise.race` 超时。

---

## 4. 独立验证：题库数据问题

**主张来源**：子代理 07（`07-question-bank-data.md`）

**主理人独立复算**（探针 `probe6.mjs`，只读解析 `web/data/manifest.json` 与 `web/data/shards/*.json`）：

```
MANIFEST_KEYS ["version","total","types","shards","asset_count","asset_base","synced_at","source","source_total"]
SHARDS_FIELD {"高等数学":{"file":"shards/高等数学.json","count":3082},"线性代数":{"file":"shards/线性代数.json","count":803},"概率统计":{"file":"shards/概率统计.json","count":316},"历年真题":{"file":"shards/历年真题.json","count":1776},"模拟哥专区":{"file":"shards/模拟哥专区.json","count":544},"未分类":{"file":"shards/未分类.json","count":0}}
DISK_SHARDS ["历年真题.json","未分类.json","概率统计.json","模拟哥专区.json","线性代数.json","高等数学-核心.json","高等数学.json"]
TOTAL_IN_DISK_SHARDS 6529
TYPES {"subjective":4677,"single_choice":1848,"multiple_choice":4}
EMPTY_OPTIONS_COUNT 25
EMPTY ["概率统计.json",99000003,"single_choice"] ... （共 25 条，题号 99000003 起，全部在 概率统计.json，全部 single_choice）
```

**确证**：
- manifest 声明 **6** 个分片，磁盘有 **7** 个 `.json` → 多出 `高等数学-核心.json`（孤立分片，不在 manifest / 索引中）。
- 含孤立分片共 **6529** 题（manifest 声明 6521，差 8，与孤立分片的 8 题吻合）。
- **25 道选择题 `options` 为空**，全部集中在 `概率统计.json`，题号形如 `990000xx`，类型均为 `single_choice`。

**主理人另跑基线**：`npm run verify` → `题库验证通过：6521 题，6521 个唯一题号` + `警告：缺少 41 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐`。印证 07 的判断：`verify-web-data.mjs` 的校验范围（只遍历 manifest）恰好绕开了上述两类问题。

---

## 5. 推翻的假设（避免误报写入报告）

| 曾怀疑 | 实测结果 | 依据 |
|---|---|---|
| SSE 长连接会阻塞服务 shutdown | **不阻塞**，820ms 正常退出 | probe5；`server.mjs:702-705` 主动 end 所有 SSE 客户端 |
| 空闲 keep-alive 连接会阻塞 shutdown | **不阻塞**，20ms 退出 | probe 场景 B |
| 桌面版点"停止本地服务"会 403（因代理剥离 Origin，见 `desktop/policy.mjs:47-54` 的 `proxyHeaders` 剔除 `origin`/`host`/`cookie`） | **不成立**：该按钮仅在 `?browserPackage=1` 时渲染（`web/app-new.js:3178`），桌面版加载的是 `daguan://app/index.html?desktop=1`，按钮根本不存在 | 代码核对 |
| 托盘图标取空导致 `new Tray()` 抛异常 → 启动即退（M3） | **风险不成立**：`web/assets/landing/local-mark.png` 与 `web/assets/math-mark.svg` 均存在，`icon.isEmpty()` 为 false | glob 确认 |
| `web/ui-bootstrap.js` 每次加载都注销 Service Worker | **不成立**：注销只在 `?purge=1` 分支内（`ui-bootstrap.js:2-10`） | 代码核对 |
| `service-worker` 在 `daguan://` 下无法注册 | **不成立**：`electron-main.cjs:15` 的 `registerSchemesAsPrivileged` 已含 `allowServiceWorkers: true` | 代码核对 |

**说明**：`probe9.mjs` 结束时出现的 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` 与 `[exit code: 1]` 是探针脚本 `child.kill()` 后立即 `process.exit(0)` 在 Windows/Node 24 上的 libuv 噪音，与被测服务无关，不计入发现。

---

## 6. 其他已核对的代码事实（供汇总引用）

- `desktop/policy.mjs`：`APP_ORIGIN="daguan://app"`；CSP 含 `script-src 'self' 'unsafe-inline'`、`style-src 'self' 'unsafe-inline'`、`object-src 'none'`、`frame-ancestors 'none'`；`windowPreferences()` = `{nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true}`；`navigationAction()` 对任意 http/https 返回 `"external"`（**无域名白名单**，配合 `electron-main.cjs:267-268` 的 `shell.openExternal`）；`resolveWebAsset()` 用 `target.startsWith(\`${root}${path.sep}\`)` 做目录边界检查；`proxyHeaders()` 剔除 `host/origin/connection/content-length/transfer-encoding/cookie`。
- `desktop/electron-main.cjs`：`validIpc()`（:162）校验 sender、`senderFrame===mainFrame`、`policy.isTrustedAppUrl(event.sender.getURL())`；所有 `ipcMain.handle`（:332-369）均先过 `validIpc`，action 走白名单；:133 只代理 `/api/` 与 `/data/` 前缀；:264 关闭窗口只是 `hide()`（进程留托盘）；:328 `will-download` 只允许 `mainWindow`；`app.setLoginItemSettings({path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()]})`；**无 `uncaughtException`/`unhandledRejection` 处理**；:370 `makeTray(); createWindow();` 位于 `app.whenReady().then()` 内且无 try/catch（异常会落到 :378 的 `.catch` → `console.error` + `app.quit()`）。
- `desktop/preload.cjs`：`contextBridge.exposeInMainWorld("daguanDesktop", ...)` 仅 4 个方法（`getStartup`/`setStartup`/`getAppVersion`/`remoteAccess`），全部走 IPC 且主进程侧有 `validIpc` 校验，暴露面很小。
- `desktop/updater.cjs`：`UPDATE_FEED_URL = "https://update.electronjs.org/Evan26Ma/daguan-cxy-local/win32-x64"`，`UPDATE_INTERVAL_MS = 6*60*60*1000`，`STARTUP_DELAY_MS = 15*1000`；`available()` 要求 `platform==="win32" && app.isPackaged`（开发态不更新）；无下载哈希/签名校验。
- `desktop/remote-gateway.cjs`（170 行，已通读）：scrypt 密码哈希 + `crypto.timingSafeEqual`；HMAC-SHA256 签名会话 cookie（`HttpOnly; Secure; SameSite=Lax`，30 天）；登录限流（每 IP 5 次退避 + 全局 20 次封 15 分钟）；`sameOrigin()` 要求 `https:` 且 host 等于 `publicHost`；`normalizePath()` 拦 `\0`、`..`、`//`；`BLOCKED` 含 `/api/runtime/stop`、`/api/catalog/refresh`；转发时剥离 `cookie`/`cf-connecting-ip`/`x-forwarded-*` 等；非 GET/HEAD/OPTIONS 强制 `sameOrigin`；quick 模式禁 SSE、禁 `service-worker.js`；`stop()` 用 `closeAllConnections()`。**未发现明显漏洞**（对比 `server.mjs` 的 shutdown 正是缺这一步）。
- `local-server/instance-lock.mjs`（184 行）：`fs.open(lockPath,"wx",0o600)` 独占；`MALFORMED_LOCK_GRACE_MS=15000`、`OWNER_WAIT_MS=8000`；`recoveryGate()` 用独立 `.service-instance-recovery.json` + `randomUUID` token；release 校验 `instanceId`+`pid`；`validOwner()` 要求 `host==="127.0.0.1"`。**已知弱点**：`serviceOwnerProcessStatus()` 用 `process.kill(pid,0)`，Windows PID 复用会误判为 alive。
- `local-server/store.mjs`：`:24-26` `readJson` 的 `catch` 吞掉一切返回 fallback；`:39-40` `readState()` 在 `state.json` 损坏时返回空状态（revision 0）；`:48-60` `writeState` 先 `readState()` 取 `current.revision` 再 `next.revision = current.revision + 1` 并覆盖写 → **损坏文件被下一次写入永久覆盖，无备份、无日志、无告警**。对比 `visit-history.mjs:38-54` 与 `study-activity.mjs:107` 的同类损坏是抛错的，行为不一致。
- `local-server/catalog.mjs`：`:26` `Object.values(manifest.shards).map((meta) => meta.file)` 来自**远端** manifest；`:30` `path.join(stageDir, file)`、`:50` `path.join(dataDir, file)` 均无包含性校验 → 恶意/被劫持的题库源（`SOURCE = "https://hsad.xyz/daguan-math"`）可越出目录写文件。`:8-12` `fetchJson` 无超时。
- `local-server/visit-history.mjs`：写盘 `${file}.tmp-${pid}-${Date.now()}` + `fs.rename`（原子，0o600）；`normalizeEntry()` 只接受 `/^\d+$/` 的 question_id。
- `local-server/server.mjs:424-437`：`GET /api/state/events` SSE，`stateEventClients.add(res)` + 15s keep-alive interval + `res.on("close", cleanup)`。

---

## 7. 实测：PID 复用导致实例锁卡死（定性修正为「有意取舍」而非缺陷）

**主张来源**：子代理 03 静态分析指出 `local-server/instance-lock.mjs:11-20` 的 `serviceOwnerProcessStatus()` 用 `process.kill(pid, 0)`，Windows PID 复用会误判为 alive，锁无法自动恢复。

**代码路径**（`local-server/instance-lock.mjs`）：

```
:11-20   serviceOwnerProcessStatus(pid)：process.kill(pid,0) 成功 → "alive"；ESRCH → "absent"；EPERM → "alive"
:106-108 if (validOwner(existing) && serviceOwnerProcessStatus(existing.pid) !== "absent") return { acquired: false, owner: existing };
```

`:106` 在 PID「alive」时**直接返回未获取到锁**，根本不进入 :117 起的 `recoveryGate()` 恢复分支 —— 即陈旧锁永远不会被自动清理。

**主理人实测**（探针 `probe10.mjs`）：临时数据目录 `%TEMP%\dg-main-check\data-lock`，写入伪造锁 `{version:1, apiProtocol:1, pid:15188(= explorer.exe 的真实 PID), host:"127.0.0.1", port:18099, instanceId:"00000000-…", launcherKind:"desktop"}`，端口 18099 **无任何服务**，然后 `PORT=18099` 启动 `local-server/server.mjs`：

```
REUSED_PID 15188 ALIVE true
STALE_LOCK_WRITTEN true claimed pid is explorer, no service on 18099
RESULT {"exited":true,"code":1,"ms":8235}
OUTPUT_TAIL "Error: 服务实例 PID 15188（端口 18099，实例 00000000-0000-4000-8000-000000000000）持有数据目录 …\data-lock，但健康检查未确认服务。可能是旧服务仍在退出，也可能是 Windows 重用了 PID。请先检查该 PID 的命令行和该端口；仅在确认没有 Daguan 服务进程使用此目录后，删除 …\data-lock\.service-instance.json 并重试。切勿在服务进程仍运行时删除锁，以免两个进程同时写入。"
  code: 'SERVICE_INSTANCE_HELD'
LOCK_STILL_THERE true
RECOVERY_GATE_LEFT false
```

**结论：行为确证，但定性下调。** 8.2 秒后服务以 exit code 1 退出、锁文件保留、恢复闸门已正确清理。关键区别在于：

1. 这不是静默失败 —— 错误信息**明确点名了「Windows 重用了 PID」**这一场景，说明开发者已知该风险，是有意选择「宁可启动失败，也不冒险让两个进程同时写数据目录」。
2. 错误信息给出了可执行的处置步骤（查 PID 命令行 → 查端口 → 确认后删锁），并警告了误删后果。

因此本项按 **P2（可用性/可诊断性）** 记录，修复建议是「让 `serviceOwnerProcessStatus` 在 PID 存活但 `/api/health` 不匹配时返回一个第三态（如 `"stale"`），由 `acquireServiceInstance` 走一次带 recoveryGate 的自动清理」，而不是「存在漏洞」。对比同类产品，它的失败模式是**安全优先**的。

---

## 8. 确证：跨站可写入 AI 档案并自动置为 active（08 号报告 P0-2 的独立验证）

**主张来源**：子代理 08（`08-ai-integration.md` AI-02，P0）

**主理人独立复现**（探针 `probe11.mjs`：临时数据目录 `%TEMP%\dg-main-check\data-ai`，`PORT=18101`，**未设** `DAGUAN_PREVIEW_MODE`）：

```
READY true
CSRF_AI_PROFILE 200 {"ok":true,"profile":{"id":"f8c0b90b-…","name":"pwn","baseUrl":"https://attacker.example/v1","model":"m","streaming":true,"active":true,"keyHint":"sk-••••pwn",…}}
PROFILES_AFTER 200 {"ok":true,"profiles":[{"id":"f8c0b90b-…","name":"pwn","baseUrl":"https://attacker.example/v1","active":true,…}]}
SSRF_LINKLOCAL 200 {"ok":true,"profile":{"name":"ssrf","baseUrl":"http://169.254.169.254/latest/meta-data","active":false,…}}
LOOPBACK 200 {"ok":true,"profile":{"name":"lo","baseUrl":"http://127.0.0.1:9/v1","active":false,…}}
ON_DISK .service-instance.json,ai-history,ai-profiles.json,cxyonly-backups,study-activity.json
```

请求 A 的头是 `Origin: https://evil.example` + `Content-Type: text/plain;charset=UTF-8`（CORS 简单请求，不触发预检）。

**结论：确证，且比原报告更直接。** 关键增量事实：**在档案列表为空时，新写入的档案自动获得 `active: true`** —— 攻击者不需要任何后续操作，一次跨站 POST 就能让恶意 `baseUrl` 立即成为生效端点。完整攻击链为：

1. 用户在用浏览器打开任意网站（无需任何交互，简单请求不触发预检）；
2. 该网站静默 `POST /api/ai/profiles`，`baseUrl` 指向攻击者服务器；
3. 用户回到大观园提问 → 题干、选项、用户作答、标准答案、官方解析全部 POST 到攻击者端点（`local-server/server.mjs:553` 的 `POST /api/ai/chat` → `ai.streamChat`）。

**边界说明**（避免夸大）：若用户**已经**配置过 AI 档案，跨站 POST 新建的档案 `active` 为 false（实测 SSRF/LOOPBACK 两条均为 `"active":false`），此时普通跨站只能新增档案、不能切换生效端点；`PATCH`/`DELETE /api/ai/profiles/:id` 是非简单方法，被预检挡住（见第 2 节）。但 **DNS rebinding 后全部可达**，且 `DELETE`+`POST` 组合仍能替换生效档案。

**附带确证**：`validateBaseUrl` 放行 `http://169.254.169.254/latest/meta-data`（链路本地元数据地址）与 `http://127.0.0.1:9/v1`（环回），与 AI-02 组合即为跨站 SSRF 入口。**未**实际发起元数据请求。

**旁证**：探针结束时同样出现 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` + `[exit code: 1]`，与 `probe9.mjs` 一致，系 `child.kill()` 后立即 `process.exit(0)` 的 libuv 噪音，与被测服务无关。

---

## 9. 独立确证：`findCategoryById` 只搜顶层科目（P1-M）

04 号审查报告（`04-frontend-ui.md`）指出新版「继续学习」链路对服务端记录的位置全部失效，主理人对根因做了独立代码核对。

`web/app-new.js:1653-1657` 全文：

```js
static findCategoryById(id) {
    if (!AppState.categories) return null;
    // 内联 onclick 传字符串 id，统一 Number 宽松比较
    return AppState.categories.categories.find(c => String(c.id) === String(id) || Number(c.id) === Number(id));
}
```

只调 `AppState.categories.categories.find(...)` —— **只遍历顶层科目数组，不下钻 `children`**。

同一文件里相邻的两个查找函数都有递归：`findChapterById`（`web/app-new.js:1659-1671`）用内部 `traverse` 递归 `node.children`；`pathToNode`（`web/app-new.js:1673-1684`）用内部 `visit` 递归。**即"只搜顶层"是 `findCategoryById` 独有的偏差，不是全文件的统一约定。**

旧版对照：`web/app-legacy.js:1481-1489` 的 `findCat` 是全树搜索，所以旧版读服务端 `category_id`（叶子章节 id）时能命中，新版不能。

**结论：确证，非误报。** 04 报告给出的对照组行为（`categoryId=223` 顶层 → 首页卡片正常 + `resumeLearning()` 落到 `qid 3358`；`categoryId=331` 嵌套 depth 3 → 卡片消失 + 假警告 + 停在 home）与上述代码路径一致。
