# 01 · Electron 桌面版安全与主进程审查

- 审查对象：大观园数学 Windows 桌面版（package name `daguan-math-local`，产品名「大观园数学」）
- 正本 checkout：`F:\AI\大观园本地`，分支 `main`，HEAD `126266d`，版本 v1.0.10
- Electron 版本：`44.4.5`（`node_modules/electron/package.json`）
- 审查方式：**只读**代码审查 + 本机可复现实验（临时数据目录 + 临时 Electron 探针），未修改任何仓库源码
- 报告日期：2026-10-01
- 审查范围：`desktop/electron-main.cjs`、`desktop/preload.cjs`、`desktop/policy.mjs`、`desktop/service-handoff.mjs`、`desktop/remote-gateway.cjs`、`desktop/cloudflare-tunnel.cjs`、`desktop/updater.cjs`、`local-server/server.mjs`（仅与桌面版握手/反代相关的部分）、`test/electron-security.test.mjs`、`test/desktop-csp-smoke.mjs`

---

## 0. 结论摘要

**整体判断：Electron 侧的渲染进程隔离做得相当扎实，真正的风险不在窗口配置，而在「本地 HTTP 服务」和「生命周期收尾」两处。**

渲染进程侧（`webPreferences` / preload / 导航控制 / 协议处理器）经本机实测确认与设计一致，没有发现越权通道：`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true` 全部生效，渲染进程里 `require`/`process`/`module` 均为 `undefined`，preload 只暴露 4 个窄接口且被 `Object.freeze`，没有通用 `send/invoke`、没有 fs/path/shell 能力。路径穿越、外链白名单、下载拦截都有对应实现与静态测试。

但有三个必须处理的问题：

1. **P1（本次最严重）**：本地服务是「未鉴权、不校验 Origin/Host」的 HTTP 写入入口，且请求体解析完全不看 `Content-Type`。任何用户在用浏览器访问的**任意网站**，都能通过一个 `text/plain` 的跨源简单请求，静默改写/污染本地学习数据，甚至把官网同步的 token 登出。**已在本机实测复现（`POST /api/state/migrate` → 200，revision 0→1 落盘）。** 桌面版的服务端口是随机端口，但浏览器版固定 `127.0.0.1:8080`，且盲发请求不需要读到响应，端口扫描即可命中。
2. **P2**：主进程**没有** `session.defaultSession.setPermissionRequestHandler`。本机 A/B 实测证明 Electron 44 的默认行为是**全部放行**：无 handler 时 `getUserMedia({audio:true})` 返回 `RESOLVED`，装上拒绝 handler 后返回 `REJECTED:NotAllowedError`。
3. **P2**：退出流程 `requestQuit()` 等待子服务进程退出**没有超时**，一旦子进程不响应 `shutdown` IPC，应用会永久卡在退出对话框上（`quitPromise` 也不会重置，重试按钮无效）。

CSP 的实际情况比测试期望更弱一点：`script-src` 含 `'unsafe-inline'`，本机实测确认它能拦住 `eval`（无 `'unsafe-eval'`），但**拦不住内联事件处理器**——把带 `onerror` 的原始 HTML 经 `marked.parse` 插入 `innerHTML` 后处理器确实执行了。这属于「CSP 对 HTML 注入无效」的纵深防御缺口（详见 F-03）。

没有任何 P0（阻断级）问题。

### P0/P1 清单速览

| 编号 | 严重度 | 标题 | 位置 |
| --- | --- | --- | --- |
| — | P0 | 无 | — |
| F-01 | **P1** | 本地 HTTP API 未鉴权且不校验 Origin/Host → 任意网站可 CSRF 篡改本地学习数据 | `local-server/server.mjs:99-109`、`:355-368`、`:524-531` |
| F-02 | P2 | 未设置权限请求处理器，Electron 默认放行全部权限（摄像头/麦克风/定位） | `desktop/electron-main.cjs`（全文无 `setPermissionRequestHandler`） |
| F-03 | P2 | CSP `script-src 'unsafe-inline'` 无法阻止内联事件处理器注入 | `desktop/policy.mjs:5-18`、`desktop/electron-main.cjs:148` |
| F-04 | P2 | `requestQuit()` 等待子进程退出无超时 → 退出永久挂起 | `desktop/electron-main.cjs:280-299` |
| F-05 | P2 | `stopStartupChild()` 超时后不强杀 → 服务进程泄漏/孤儿进程 | `desktop/electron-main.cjs:48-55`、`:96-99` |
| F-06 | P2 | 主进程无 `uncaughtException` / `unhandledRejection` 兜底 | `desktop/electron-main.cjs`（全文无） |

---

## 1. 发现清单

### F-01 · P1 · 本地 HTTP API 未鉴权且不校验 Origin/Host，任意网站可跨源写入本地数据

**证据 1 — 请求体解析不校验 Content-Type（CSRF 可行的根因）**

`local-server/server.mjs:99-109`：

```js
async function body(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) { ... }
    chunks.push(chunk);
  }
  ...
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
```

只看累计字节数（`MAX_BODY = 10 * 1024 * 1024`，`local-server/server.mjs:23`），**完全不看 `Content-Type`**。因此 `Content-Type: text/plain` 的请求体照样被当成 JSON 解析 —— 而 `text/plain` 属于 CORS 安全列表类型，浏览器**不会**为它发预检请求，于是跨源简单请求可以直通。

**证据 2 — 全服务只有一个端点做 Origin 校验**

`local-server/server.mjs:359-368`（唯一做了校验的端点，可作为对照组）：

```js
if (pathname === "/api/runtime/stop" && method === "POST") {
    const remote = String(req.socket.remoteAddress || "");
    if (req.headers.origin !== `http://${HOST}:${PORT}` || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
      return json(res, 403, { ok: false, error: "停止服务只允许从本机应用页面发起" });
    }
    ...
}
```

除此之外**没有任何端点校验 `Origin`、`Host` 或 token**。变更类路由（行号来自 `local-server/server.mjs`）：

| 行号 | 路由 | 是否校验来源 |
| --- | --- | --- |
| :382 | `POST /api/access/unlock` | 有 PREVIEW_KEY + `safeEqualText`（仅预览模式） |
| :394 | `POST /api/access/lock` | 无 |
| :403 | `POST /api/catalog/refresh` | 无 |
| :411 / :415 | `POST /api/study-activity/events`、`/merge` | 无 |
| :420-423 | `POST/DELETE /api/visit-history*` | 无 |
| :439 | `PUT /api/state` | 有 revision/If-Match |
| :446 | `PATCH /api/state/questions/<id>` | 有 revision |
| :485 | `PATCH /api/state/questions/<id>/annotation` | 有 revision |
| :507 | `PATCH /api/state/last-study` | 有 revision |
| **:524-531** | **`POST /api/state/migrate`** | **无任何校验、无 revision 要求** |
| :534-555 | `/api/ai/*` | 无（AI 侧另有 URL 范围校验） |
| **:570** | **`POST /api/integrations/cxyonly/logout`** | **无** |

**证据 3 — 服务端完全不设置任何 CORS/安全响应头**

`local-server/server.mjs:46-49`：

```js
function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
```

从不设置 `Access-Control-Allow-Origin`。这**不影响**攻击：`fetch(..., {mode:'no-cors'})` 或表单提交照样把请求发出去，攻击者不需要读到响应（盲写）。

**证据 4 — 本机实测复现（原文摘录见第 2 节命令 R1-R12）**

以临时数据目录启动服务后：

```
B2  POST /api/state/migrate   Origin: https://evil.example   Content-Type: text/plain;charset=UTF-8
    body: {"document":{"format":"daguan-local-state","version":3,"progress":{}}}
    → 200 {"ok":true,"state":{...,"revision":1,...}}

C3  POST /api/integrations/cxyonly/logout   Origin: https://evil.example   Content-Type: text/plain
    → 200 {"ok":true}

C4  GET  /api/state  → revision=1        # 确认 B2 的写入已落盘
```

同时对照：

```
A5  POST /api/runtime/stop   Origin: https://evil.example
    → 403 {"ok":false,"error":"停止服务只允许从本机应用页面发起"}     # 证明实验方法有效，不是环境问题
```

**证据 5 — 写入逻辑允许污染**

`local-server/server.mjs:524-531`：

```js
if (pathname === "/api/state/migrate" && method === "POST") {
    const incoming = localStateShape(await body(req));
    const saved = await withLock(async () => {
      const current = await store.readState();
      const merged = { ...current, ...incoming, revision: current.revision,
        progress: { ...(current.progress || {}), ...(incoming.progress || {}) },
        favorites: [...new Set([...(current.favorites || []), ...(incoming.favorites || [])])],
        picked: [...new Set([...(current.picked || []), ...(incoming.picked || [])])],
        updated_at: nowIso() };
      return writeState(merged, { expectedRevision: current.revision, studyImport: true });
    });
    return json(res, 200, { ok: true, state: saved });
}
```

`{ ...current, ...incoming }` 让攻击者可以覆盖任意顶层字段；`progress` 是合并（可注入任意题目的掌握度/错题标记），`updated_at` 被重置。**没有任何 revision/If-Match 前置条件**，因此攻击者不需要先读到当前状态。

**影响**

- **数据完整性**：任意网站在用户浏览时静默篡改学习进度、掌握度、错题标记、批注、学习位置；可注入垃圾数据使统计/复习计划失真。
- **拒绝服务**：`POST /api/integrations/cxyonly/logout` 可清掉官网同步凭据；`POST /api/catalog/refresh` 可触发题库刷新任务。
- **触发条件**：本地服务正在运行（桌面版运行时必然运行；浏览器版固定 `127.0.0.1:8080`）。桌面版端口随机，但盲发请求无需读响应，端口扫描即可命中。
- **未升级为 P0 的理由**：攻击者无法读取响应（无 CORS 头），因此只能盲写，不能窃取数据；`/api/runtime/stop` 有校验，无法借此停掉服务。

**复现步骤**

1. 用临时数据目录启动服务：`$env:DAGUAN_DATA_DIR="$env:TEMP\dg-audit-01"; $env:PORT='18080'; $env:DAGUAN_OPEN_BROWSER='0'; node local-server/server.mjs`
2. 任选一个用户会在浏览器里打开的页面（或在浏览器控制台执行），对 `http://127.0.0.1:18080/api/state/migrate` 发 `mode:'no-cors'`、`Content-Type: text/plain`、body 为迁移文档 JSON 的 POST。
3. 观察 `GET /api/state` 的 `revision` 自增，且注入的 `progress` 项出现。

**修复建议（按代价从低到高）**

1. **最小改动**：在 `route()` 开头加一道统一闸门 —— 对所有非 GET/HEAD 请求要求 `Origin` 必须存在且等于 `http://127.0.0.1:${PORT}`（缺失即拒绝），并校验 `Host` 必须是 `127.0.0.1:${PORT}` 或 `localhost:${PORT}`。桌面版反代时 `policy.proxyHeaders()` 会**剔除 `origin`**（`desktop/policy.mjs` 的 `proxyHeaders` 剔除列表含 `origin`），所以必须**同时**改反代：让 `desktop/electron-main.cjs:136` 在转发时补上 `Origin: http://127.0.0.1:${port}`，否则桌面版自身会被自己的闸门挡掉。
2. **更稳的做法**：给服务加一个启动时随机生成的 token（写入 `.service-instance.json`，桌面版反代时带上，浏览器版由服务注入页面 meta 后由前端 JS 带上 `X-Daguan-Token`）。token 校验能一次性解决 CSRF、DNS rebinding 和「其他本机进程伪装」三类问题。
3. **补 Content-Type 校验**：`body()` 只在 `Content-Type` 为 `application/json` 时解析，否则 415。这一条单独就能挡掉绝大多数跨源简单请求，但**不能替代** Origin/token 校验（表单提交仍可发 `application/x-www-form-urlencoded`）。

**验证方式**

- 增加 `test/local-server-csrf.test.mjs`：临时数据目录启动服务，用 `fetch` 发带伪造 `Origin` 的 `POST /api/state/migrate`（`Content-Type: text/plain`），断言返回 403；再发带正确 `Origin` 的同样请求，断言 200。当前 `test/local-server.test.mjs` 没有覆盖这一路径。

---

### F-02 · P2 · 未设置权限请求处理器，Electron 默认放行全部权限

**证据 1 — 主进程全文没有权限处理器**

`desktop/electron-main.cjs` 中不存在 `setPermissionRequestHandler` / `setPermissionCheckHandler` / `setDevicePermissionHandler`（全文 grep 无匹配）。`session` 只被用于 `will-download`（`desktop/electron-main.cjs:328`）。

**证据 2 — 本机 A/B 实测（同一探针，只切换是否安装拒绝 handler）**

用真实的 `desktop/policy.mjs` 的 `windowPreferences(PRELOAD)` 与真实 `desktop/preload.cjs` 起窗口，加载 `daguan://app/index.html`：

无 handler（= 应用的实际状态）：

```json
"geolocation": "granted", "notifications": "granted", "camera": "granted", "mic": "granted",
"getUserMedia": "RESOLVED",
"notificationRequest": "granted"
```

装上 `setPermissionRequestHandler((wc, p, cb) => cb(false))` 作为对照组：

```json
"getUserMedia": "REJECTED:NotAllowedError",
"notificationRequest": "denied"
```

结论：**差异完全由缺失的 handler 造成，Electron 44 的默认行为是放行**。（`navigator.permissions.query()` 在两组里都返回 `"granted"`，是 Electron 的已知不一致，所以判据用的是 `getUserMedia` 与 `Notification.requestPermission()` 的实际结果。）

**影响**

- 任何在渲染进程里取得脚本执行能力的内容（见 F-03），可以在**零提示**的情况下打开摄像头、麦克风、读取定位。
- 当前 `connect-src 'self'` 与 `img-src 'self' data: blob:` 显著限制了外传通道（无法直接 `fetch` 到外部域名，也无法用 `<img>` 带数据出去），所以这条暂时是**纵深防御**缺口而不是直接的泄露通道。一旦 CSP 被放松（或未来加入 `connect-src` 白名单），它会立刻升级为高危。

**修复建议**

在 `desktop/electron-main.cjs` 的 `app.whenReady()` 里，`protocol.handle` 附近加：

```js
session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
  callback(false);                       // 本应用不需要任何浏览器权限
});
session.defaultSession.setPermissionCheckHandler(() => false);
```

（若将来确实要用通知，再单独放行 `notifications`。）

**验证方式**

- 把这个探针固化成一个可跑的测试（临时 Electron + `executeJavaScript`），断言 `getUserMedia` 被拒绝。当前 `test/electron-security.test.mjs` 是纯静态断言，测不到这个行为。
- 探针脚本位置见第 2 节命令 E1。

---

### F-03 · P2 · CSP 的 `script-src 'unsafe-inline'` 无法阻止内联事件处理器注入

**证据 1 — CSP 实际内容**

`desktop/policy.mjs:5-18`：

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:;
manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

`'unsafe-eval'` 不存在（好）。但 `script-src` 含 `'unsafe-inline'`。注意：CSP 只在响应 `Content-Type` 的扩展名为 `.html` 时附加（`desktop/electron-main.cjs:148`）。

**证据 2 — `'unsafe-inline'` 是当前架构的硬依赖**

`web/app-new.js` / `web/app-legacy.js` 里 `onclick=` / `onchange=` / `oninput=` 共出现 **75 处**，其中大量是通过 `innerHTML` 模板字符串生成的（例如 `web/app-new.js:1554` `onclick="App.resumeLearning()"`、`web/app-new.js:1635` `onclick="App.showLibrary('${cat.id}')"`、`web/app-new.js:1730` `onclick="App.toggleFilterDrawer()"`）。`web/index.html:35` 也有一处静态内联处理器。所以不能简单删掉 `'unsafe-inline'`。

**证据 3 — 本机实测：注入的内联事件处理器确实执行**

用真实的 `policy.APP_CONTENT_SECURITY_POLICY` 作为响应头，加载真实 `web/vendor/marked.min.js`（v12.0.2），然后：

```
rendered = marked.parse('text\n\n<img src="x" onerror="window.__pwn=1">')
→ "<p>text</p>\n<img src=\"x\" onerror=\"window.__pwn=1\">"      # 原始 HTML 原样透传
host.innerHTML = rendered
await 500ms
→ onerrorFired: true                                            # 内联处理器执行了
```

同一探针里 `eval("window.__evalOk=1")` → `BLOCKED:EvalError`（确认 `'unsafe-eval'` 确实缺失），`inlineHandlerFired: true`（`web/index.html:35` 那种内联 `onclick` 生效）。另外 `<script>` 经 `innerHTML` 插入不会执行（这是 HTML 规范行为，不是 CSP 的功劳）。

**证据 4 — 这个通道在本应用里是活的**

`web/app-new.js` 把 `renderMarkdown()` 的输出直接塞进 `innerHTML`，而且喂给它的是**题库内容与 AI 输出**：

- `web/app-new.js:2423` `question.stem`、`:2443` 选项、`:2456` 答案、`:2461` 解析
- `web/app-new.js:2652` / `:5983` / `:5995` AI 回复
- `web/app-new.js:2910` 批注内容
- `web/app-new.js:4852-4857` 组卷导出的题干/选项/答案/解析

`renderMarkdown`（`web/app-new.js:1413-1467`）走 `marked.parse(src, { breaks: true })` 后 `div.innerHTML = html`，**没有任何 sanitize 步骤**。

**影响**

- CSP 在本应用里**不能**作为 XSS 的缓解措施。任何能影响题库内容（题库可通过 `POST /api/catalog/refresh` 与 `DAGUAN_AUTO_UPDATE_BANK=1` 在线更新）或 AI 输出（用户可配置任意 LLM endpoint）的路径，一旦注入原始 HTML，就能在 `daguan://app` 源里执行脚本。
- 执行后能做什么：读/写全部本地学习数据（同源 `fetch` 到 `/api/*` 不受限）、结合 F-02 静默开摄像头/麦克风。**不能**直接外传（`connect-src 'self'` 挡住），也不能拿到 Node 能力（sandbox + contextIsolation 生效，preload 只有 4 个窄接口）。
- **未完整验证**：我没有逐条确认题库/AI 输出能否被外部输入实际污染（这属于前端与题库更新链路的审查范围，另有子代理负责）。本节只确认了「CSP 挡不住这类注入」这一 Electron 侧事实。

**修复建议**

1. **首选**：`renderMarkdown` 输出经白名单 sanitize（例如引入 DOMPurify，或对 `marked` 输出做标签/属性白名单过滤，只保留 `p/br/strong/em/code/pre/ul/ol/li/span/img[src^=data:]/table/...`）。
2. **配套**：把 75 处内联 `onclick` 改为 `data-action` + 事件委托（`web/ui-bootstrap.js` 已经有 `[data-app-action]` 委托模式可复用），然后从 `script-src` 去掉 `'unsafe-inline'`。
3. **顺带**：把 CSP 也挂到非 `.html` 文档类型上（见 F-09）。

**验证方式**

- 把探针（第 2 节 E3）扩展成断言：注入 `<img onerror>` 后 `window.__pwn` 必须为 `undefined`。当前 `test/desktop-csp-smoke.mjs` 只断言响应头里「有 `'unsafe-inline'`」和「无 `'unsafe-eval'`」，**不测任何实际注入**。

---

### F-04 · P2 · `requestQuit()` 等待子服务进程退出没有超时 → 退出永久挂起

**证据**

`desktop/electron-main.cjs:280-299`：

```js
if (policy.shouldStopService({ owned: ownsService, confirmed: true }) && serverChild && serverChild.exitCode === null) {
  const child = serverChild;
  const stopped = await new Promise((resolve) => {
    const onExit = () => resolve(true);
    child.once("exit", onExit);
    try {
      child.send({ type: "shutdown" }, (error) => {
        if (!error) return;
        child.off("exit", onExit);
        resolve(false);
      });
    } catch { child.off("exit", onExit); resolve(false); }
  });
  ...
}
```

`new Promise` 只有 `exit` 事件和 `send` 回调两个出口。若子进程收到 `shutdown` 后卡住（例如正在写大文件、被调试器挂起、死锁），`exit` 永远不来，`send` 回调也已成功（返回 `undefined` error，走 `return` 不 resolve），**这个 Promise 永不 settle**。

同时 `desktop/electron-main.cjs:272` 的 `if (quitPromise) return quitPromise;` 会让后续退出请求直接返回同一个 pending Promise，**"请重试退出"的提示是无效的**（`:296` 的文案承诺了可以重试）。

对比：同文件 `stopStartupChild()`（`:48-55`）就正确用了 `Promise.race` + 5 秒超时。

**影响**

- 用户点「退出大观园」后，如果服务进程不响应，托盘已销毁、窗口关闭被拦、`quitting` 被置回 `false`，应用进入**无法通过 UI 退出的僵死状态**，只能任务管理器强杀。
- 强杀后 `serverChild` 未被回收，服务进程成为孤儿（与 F-05 同一后果）。

**复现步骤（需构造）**

1. 启动桌面版（临时数据目录），确认 `ownsService === true`。
2. 在服务进程上挂起（例如用 Sysinternals `pssuspend` 或调试器 attach 后暂停），使其无法处理 `process.on("message")`。
3. 点托盘「退出」→ 对话框确认 → 观察进程不退出、无任何超时提示。
   （本机未执行此复现，理由见第 3 节「未能验证事项」——需要挂起真实服务进程，会干扰同机其他子代理的测试环境。）

**修复建议**

给退出等待加上与 `stopStartupChild` 一致的超时兜底：

```js
const stopped = await Promise.race([
  new Promise((resolve) => { const onExit = () => resolve(true); child.once("exit", onExit);
    try { child.send({ type: "shutdown" }, (e) => { if (e) { child.off("exit", onExit); resolve(false); } }); }
    catch { child.off("exit", onExit); resolve(false); } }),
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 8000)),
]);
if (stopped !== true) { try { child.kill(); } catch {} }   // 超时后强杀，避免孤儿
```

并在超时路径上重置 `quitPromise = null`，让重试真正可用。

**验证方式**

- 单测：把退出等待抽成纯函数（注入一个永不 emit `exit` 的假 child），断言 8 秒内 resolve 为超时并调用 `kill()`。当前没有任何测试覆盖 `requestQuit()`。

---

### F-05 · P2 · `stopStartupChild()` 超时后不强杀 → 服务进程泄漏

**证据**

`desktop/electron-main.cjs:48-55`：

```js
async function stopStartupChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.send({ type: "shutdown" }); } catch {}
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}
```

超时后**直接返回**，既不 `kill()` 也不报告。调用点 `:96-99`：

```js
} catch (error) {
    await stopStartupChild(child);
    throw error;
}
```

`:79-82` 的竞争路径还显式把「子进程未退出」当成错误抛出：

```js
if (candidate.pid !== child.pid) {
    await stopStartupChild(child);
    if (child.exitCode === null && child.signalCode === null) throw new Error("竞争启动的服务进程未退出");
```

**影响**

- 启动失败/竞争失败时，`serverChild` 不会被赋值为该 child（`:76` 只在成功路径赋值），因此该进程**永远不会被 `requestQuit()` 收尾**——它会作为孤儿服务进程继续持有数据目录的实例锁。
- 孤儿进程的 `launcherKind` 是 `desktop`，下次启动会被 `connectOrStartService()` 当作 desktop 服务**复用**（`:114-116`），于是用户得到的是一个「自己启动过但应用不承认拥有」的服务：退出应用时不会停它，它会一直驻留。
- 更糟的组合：如果孤儿进程持有的端口/锁状态不完整，下次启动会走到 `:117` 的 `服务实例 ... 的来源无法确认` 分支并**拒绝启动**。

**修复建议**

超时后强制回收：

```js
await Promise.race([...]);
if (child.exitCode === null && child.signalCode === null) {
  try { child.kill("SIGKILL"); } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
```

并在抛错前把该 child 的 PID 记入日志，便于用户排查。

**验证方式**

- 单测：注入一个忽略 `shutdown` 消息的假 child，断言 `stopStartupChild` 返回后 `child.killed === true`。

---

### F-06 · P2 · 主进程没有 `uncaughtException` / `unhandledRejection` 兜底

**证据**

`desktop/electron-main.cjs` 全文没有 `process.on("uncaughtException")`、`process.on("unhandledRejection")`、`app.on("render-process-gone")`、`app.on("child-process-gone")`、`app.on("web-contents-created")`。

已知的裸调用点：

- `desktop/electron-main.cjs:380`：`app.on("before-quit", (event) => { ... void requestQuit(); ... })` —— `void` 丢弃了 Promise，`requestQuit()` 内部任何 rejection 都会变成未处理拒绝。
- `desktop/electron-main.cjs:376`：`void pollServiceRevision();` —— 该函数内部有 `try/catch`，风险较低。
- `desktop/electron-main.cjs:325`：`void remoteTunnel.startNamed().catch(...)` —— 已处理。

在 Node 的默认 `--unhandled-rejections=throw` 语义下，主进程的未处理拒绝会直接终止进程，且**没有日志**（只有 `:378` 的顶层 `.catch` 会 `console.error`，而它只覆盖 `whenReady` 那一条链）。

**影响**

- 主进程因任何未预料的异步错误静默退出时，用户看到的是应用突然消失；已经启动的服务子进程成为孤儿（与 F-05 叠加）。
- 崩溃现场无日志，无法事后定位。

**修复建议**

在 `desktop/electron-main.cjs` 顶部加：

```js
process.on("uncaughtException", (error) => { console.error("[desktop] uncaughtException", error); });
process.on("unhandledRejection", (reason) => { console.error("[desktop] unhandledRejection", reason); });
```

并把日志接到已有的 `appendUpdaterLog`（`desktop/electron-main.cjs:188-194`，写 `dataDirectory()/logs/desktop-updater.log`）或新开一个 `desktop-main.log`。同时给 `:380` 的 `void requestQuit()` 补 `.catch()`。

**验证方式**

- 单测/静态断言：断言主进程文件包含 `uncaughtException` 与 `unhandledRejection` 监听。当前 `test/electron-security.test.mjs` 未覆盖。

---

### F-07 · P3 · `POST /api/state/migrate` 没有 revision 前置条件，可覆盖并发写入

**证据**

`local-server/server.mjs:524-531`（完整代码见 F-01 证据 5）：该端点是所有状态写入口里**唯一**不要求 `revision` / `If-Match` 的（对照 `:439` `PUT /api/state`、`:446`/`:485`/`:507` 都要求）。它读当前状态后直接 `writeState(merged, { expectedRevision: current.revision })`。

**影响**

- 在 F-01 修复后，这条仍然是**跨客户端并发**的隐患：桌面版与浏览器版（或两个标签页）共用同一数据目录时，migrate 的合并会静默覆盖另一个客户端在读取与写入之间提交的变更（丢失更新）。
- 单独的危害低于 F-01，因为需要已通过来源校验的客户端。

**修复建议**

要求 migrate 也携带 `revision`（或 `If-Match`），不匹配返回 409 `STATE_CONFLICT` 让前端走「重新计算合并」路径（前端已有该分支，见 `web/app-new.js:3336` 的冲突提示文案）。

---

### F-08 · P3 · `freeLoopbackPort()` 存在 TOCTOU 端口竞争

**证据**

`desktop/electron-main.cjs:41-47`：

```js
async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = netNode.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close((error) => error ? reject(error) : resolve(port)); });
  });
}
```

先探测空闲端口并**关闭**，再由 `startServiceCandidate()` 把端口通过 `PORT` 环境变量交给子进程去 `listen`（`desktop/electron-main.cjs:60`）。两步之间有窗口期。

**影响**

- 极端情况下端口被其他进程抢占 → 子进程启动失败 → 走 F-05 的失败路径。属于可用性问题，非安全问题（服务只绑 `127.0.0.1`）。
- 已有缓解：`startServiceCandidate()` 会用 25 秒轮询确认「实例锁里的 PID 就是自己启动的 child」（`:75`），失败即报错，不会静默接错服务。

**修复建议**

让子进程把「已绑定端口」通过 IPC 回报，或在 `EADDRINUSE` 时由父进程重试（换端口重试一次）。优先级低。

---

### F-09 · P3 · CSP 只挂在 `.html` 文档上，其他可执行文档类型无 CSP

**证据**

`desktop/electron-main.cjs:145-149`：

```js
const ext = path.extname(target).toLowerCase();
const noCache = ext === ".html" || path.basename(target) === "service-worker.js";
const headers = { "Content-Type": MIMES[ext] || "application/octet-stream", "Cache-Control": noCache ? "no-cache" : "public, max-age=3600" };
if (ext === ".html") headers["Content-Security-Policy"] = policy.APP_CONTENT_SECURITY_POLICY;
```

**影响**

- 直接导航到 `daguan://app/xxx.svg` 时，SVG 会作为文档渲染在 `daguan://app` 源里，而**没有 CSP 头**（`.svg` 命中 `MIMES` 的 `image/svg+xml`，`ext !== ".html"`）。SVG 文档内的 `<script>` 会执行。
- 当前 `web/` 下没有攻击者可控的 SVG，所以是纵深防御缺口，不是活漏洞。同理 `.xhtml`、`.htm` 也不在 `MIMES` 里（会以 `application/octet-stream` 返回，反而不渲染）。
- 另注：`/api/` 与 `/data/` 是反代到本地服务的（`:133`），这些响应的 CSP 由服务决定（服务不设 CSP），但它们只返回 JSON 与题库静态资源。

**修复建议**

把 CSP 头挂到所有「浏览器会当文档渲染」的类型上：`.html`、`.htm`、`.xhtml`、`.svg`；或者干脆对所有响应都加上（对 JSON/JS 无副作用）。

---

### F-10 · P3 · 缺少渲染进程/子进程异常与无响应处理

**证据**

`desktop/electron-main.cjs:252-270` 的 `createWindow()` 只注册了 `ready-to-show`、`maximize`、`unmaximize`、`close`、`closed`。没有：

- `wc.on("render-process-gone")` —— 渲染进程崩溃后 `mainWindow` 变成一张死页面，`closed` 不会触发（窗口还在），用户无法通过托盘「打开」恢复（`mainWindow` 非 null，走 `show()` 显示的还是死页面）。
- `wc.on("unresponsive")` —— 无任何提示。
- `app.on("child-process-gone")` —— 子进程异常退出无感知。

**影响**

- 渲染进程崩溃后应用**不可自愈**，只能强杀重启。属可用性问题。

**修复建议**

```js
wc.on("render-process-gone", (event, details) => { console.error("[desktop] render-process-gone", details); if (!quitting) { mainWindow?.destroy(); mainWindow = null; createWindow(); } });
wc.on("unresponsive", () => { /* 可选：提示用户 */ });
```

---

### F-11 · P3 · 未处理 Windows 关机/注销（`session-end` / `query-session-end`）→ 子服务可能成孤儿（未验证）

**证据**

`desktop/electron-main.cjs:380-381` 只处理了 `before-quit` 与 `before-quit-for-update`。没有 `app.on("session-end")`、`app.on("query-session-end")`、`app.on("will-quit")`。

`requestQuit()` 是一个**带模态对话框的异步流程**（`:275` `dialog.showMessageBox`）。Windows 关机/注销时 `before-quit` 会触发，`event.preventDefault()` 会拦下关机（`desktop/electron-main.cjs:380`），而对话框在关机流程中未必能正常交互。

**影响**

- 关机/注销场景下应用可能被系统强杀，`serverChild` 未收到 `shutdown` → 孤儿服务进程（Windows 会杀掉与父进程同属一个控制台/作业组的进程，但 Electron `spawn` 不创建 Job Object，所以子进程通常存活）。

**状态：未验证。** 理由见第 3 节——需要真实触发 Windows 注销/关机流程，会打断当前会话。

**修复建议**

加一个不做对话框的快速路径：

```js
app.on("session-end", () => { quitting = true; try { serverChild?.send({ type: "shutdown" }); } catch {} });
```

---

### F-12 · P3 · 服务来源分类依赖 `powershell.exe`，超时会导致启动失败

**证据**

`desktop/service-handoff.mjs:42-46` + `windowsProcessImage()`：

```js
const image = await processImage(owner.pid);
const executable = image && path.win32.basename(image).toLowerCase();
if (executable === "daguanmath-windows-x64.exe") return "browser";
if (executable === "daguanmath.exe") return "desktop";
return "unknown";
```

`processImage` 默认实现用 `execFileAsync("powershell.exe", ["-NoProfile","-NonInteractive","-Command", ...])`，`timeout: 3000`。

**影响**

- 在 PowerShell 被组策略禁用/移除，或 `Get-CimInstance` 被 WMI 限制，或机器繁忙导致 3 秒超时的环境里，`classifyServiceOwner` 会返回 `"unknown"`（或抛错），`desktop/electron-main.cjs:117` 随即抛 `服务实例 ... 的来源无法确认，桌面版不会停止该进程`，**应用直接启动失败**。
- 注意 `:40` 的短路：`if (owner.launcherKind === "desktop") return "desktop";` 让最常见的路径不依赖 PowerShell；`:41` 的 `health.launcherKind` 分支也短路。所以只有「实例锁缺 `launcherKind` 且健康检查也不给」的旧版本残留场景才会走到 PowerShell。风险面比看起来小。

**修复建议**

把「无法确认来源」从**阻断启动**降级为**提示 + 只读复用**（既然进程存活且健康检查通过、协议一致，可以先复用，只是退出时不接管它）。或者用不需要外部进程的方式取映像名（`NtQueryInformationProcess` / `process.hrtime` 无关；Node 侧无原生 API，可考虑用 `wmic` 的替代或缓存上次结果）。

---

### F-13 · P3 · `test/electron-security.test.mjs` 是纯静态断言，关键行为零覆盖

**证据**

`test/electron-security.test.mjs`（197 行）全部是 `fs.readFileSync` + `assert.match` / `assert.doesNotMatch` 的源码文本断言（见第 2 节命令 T1 的运行结果：20 passed）。

**未覆盖的真实行为（本报告对应发现）**

| 未覆盖项 | 对应发现 |
| --- | --- |
| `validIpc()` 的实际行为（sender / senderFrame / URL 三条件） | — |
| `daguan:remote` 的 action 白名单与 `input` 校验 | — |
| 本地服务的 Origin / Host 校验 | **F-01** |
| `session.defaultSession` 的权限处理器 | **F-02** |
| CSP 对实际注入的拦截效果 | **F-03** |
| `requestQuit()` / `stopStartupChild()` 的超时与强杀 | **F-04**、**F-05** |
| `uncaughtException` / `unhandledRejection` | **F-06** |
| `window-all-closed` / `render-process-gone` | **F-10** |
| preload 暴露面的实际对象形状（`Object.keys(window.daguanDesktop)`） | — |
| `DAGUAN_USER_DATA_DIR` 覆写 `app.setPath("userData")` 的效果 | — |
| `test/desktop-csp-smoke.mjs` 本机无法运行（缺 Playwright） | — |

**另一个具体缺口**：`test/electron-security.test.mjs` 断言 `web/index.html` / `web/legacy.html` 内**不得有内联 `<script>` 块**，这给人「CSP 的 `'unsafe-inline'` 没被用上」的错觉——但内联**事件处理器**（`onclick=`）大量存在于 `web/app-new.js` 生成的 HTML 里，静态断言完全看不到（见 F-03）。

**修复建议**

1. 把本报告用的三个 Electron 探针（第 2 节 E1/E2/E3）固化成 `test/electron-runtime.test.mjs`，用临时目录 + `executeJavaScript` 断言 `require === undefined`、权限被拒、注入不执行。
2. 给 `test/electron-security.test.mjs` 加一条「每个 `ipcMain.handle` 回调体内都必须出现 `validIpc(event)`」的结构化断言（现在只能靠人眼，`daguan:maximized` / `daguan:app:version` 等用的是 `validIpc(event) && ...` 简写形式，正则要兼容）。

---

### F-14 · P3 · cloudflared 子进程继承完整 `process.env`

**证据**

`desktop/cloudflare-tunnel.cjs:76`：

```js
env = { ...process.env, HOME: privateHome, USERPROFILE: privateHome, ...(token ? { TUNNEL_TOKEN: token } : {}) };
```

**影响**

- 第三方二进制（cloudflared）会拿到用户环境里的全部变量，包括 `DAGUAN_*`、以及其他应用可能放在环境里的凭据。cloudflared 是 Cloudflare 官方签名发布的二进制（`desktop/cloudflare-tunnel.cjs:27-43` 有 sha256 + 域名白名单校验，供应链控制到位），所以实际风险低。
- 隧道令牌只经环境变量传递，没有落到命令行（好）；但环境变量对同用户的其他进程可读（Windows 上需要 `PROCESS_VM_READ` 权限，普通进程默认拿不到）。

**修复建议**

改成白名单构造 env：只保留 `PATH`、`SystemRoot`、`TEMP`、`TMP`、`HOME`、`USERPROFILE`、`TUNNEL_TOKEN`。

---

### 已确认做对的地方（对照组，避免后续改动破坏）

这些经代码审查 + 本机实测确认，建议在测试里固化为回归断言：

1. **窗口隔离**（实测）：`desktop/policy.mjs` 的 `windowPreferences()` 返回 `{ preload, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true }`，在真实 Electron 44.4.5 窗口里，渲染进程 `typeof require/process/module/globalThis.process` 全部为 `"undefined"`。
2. **preload 暴露面最小**（实测）：`window.daguanDesktop` 只有 `getAppVersion`、`getStartup`、`remoteAccess`、`setStartup` 四个方法，`Object.isFrozen` 为 `true`，`window.ipcRenderer` 为 `undefined`。没有通用 `send`/`invoke`，没有 fs/path/shell 能力。
3. **IPC 通道白名单**（代码审查）：7 个 `ipcMain.handle`（`daguan:window`、`daguan:maximized`、`daguan:app:version`、`daguan:update:check`、`daguan:update:install`、`daguan:startup`、`daguan:startup:get`、`daguan:remote`）**每一个**都调用了 `validIpc(event)`；`validIpc`（`desktop/electron-main.cjs:162`）同时校验 `event.sender === mainWindow.webContents`、`event.senderFrame === mainWindow.webContents.mainFrame`（挡住 iframe）、以及 `policy.isTrustedAppUrl(event.sender.getURL())`。参数都有显式白名单或类型收敛（`daguan:window` 的 action 白名单 `else return false`；`daguan:remote` 的 action 白名单 `else return {error:'未知操作'}`；preload 侧 `String(action)`、`Boolean(e)`）。
4. **导航与来源控制**（代码审查）：`setWindowOpenHandler` 对一切 URL 返回 `{action:"deny"}`（`desktop/electron-main.cjs:267`），只在 `navigationAction(url) === "external"` 时才 `shell.openExternal`；`will-navigate`（`:268`）同理。`policy.navigationAction` 只放行 `daguan://app`（且无 username/password），只把 `http(s)` 无凭据 URL 判为 external，**`file://` 与未知协议一律 `deny`**（不打开也不导航）。
5. **路径穿越防护**（代码审查 + 已有测试）：`policy.resolveWebAsset` 先 `decodeURIComponent` 再 `path.resolve` 再要求 `target.startsWith(root + path.sep)`；`test/electron-security.test.mjs` 已覆盖 `/../../data/private.json` 与 `/%2e%2e/%2e%2e/private.json` 两种编码。反代路径 `/api/`、`/data/` 拼到固定的 `serviceEndpoint()`（loopback）上，且 `requestUrl.protocol !== "daguan:" || hostname !== "app"` 时直接 403（`desktop/electron-main.cjs:132`）。
6. **反代请求头收敛**（代码审查）：`policy.proxyHeaders` 剔除 `host, origin, connection, content-length, transfer-encoding, cookie`。
7. **下载拦截**（代码审查 + 已有测试）：`session.defaultSession.on("will-download")` 对非主窗口来源的下载直接 `event.preventDefault(); item.cancel()`；主窗口下载走 `setSaveDialogOptions`，文件名经 `path.basename` + 非法字符替换（`policy.downloadSaveDialogOptions`）。测试还断言 handler 内**不含** `showSaveDialog`（防止静默下载）。
8. **单实例**（代码审查）：`app.requestSingleInstanceLock()` 在 `whenReady` 之前调用，`second-instance` 只做 show/focus；`whenReady` 里还有 `if (!hasSingleInstanceLock) return;` 双保险。
9. **CSP 无 `unsafe-eval`**（实测）：`eval` 被 `EvalError` 挡住。
10. **远程网关的 CSRF 防护**（代码审查）：`desktop/remote-gateway.cjs:125-146` 的 `handle()` 对非 GET/HEAD/OPTIONS 请求要求 `sameOrigin(req)`（`Origin` 必须存在、必须是 `https:`、host 必须等于 `publicHost`），且 `host !== publicHost` 时返回 421；cookie 会话用 `crypto.timingSafeEqual` 比较。**同一份代码在本地服务里恰恰是缺的**（见 F-01），可以直接把这套 `sameOrigin` 逻辑移植过去。
11. **隧道二进制供应链校验**（代码审查）：`desktop/cloudflare-tunnel.cjs:27-43` 要求下载 URL 匹配 `^https://github\.com/cloudflare/cloudflared/releases/download/`、`asset.digest` 匹配 `^sha256:[a-f0-9]{64}$`、实际 sha256 一致、长度 > 1MB，且用 `flag:'wx'` 写临时文件后 rename。
12. **`/api/runtime/stop` 的来源校验**（实测）：伪造 Origin 时返回 403（见 F-01 证据 4 的 A5）。

---

## 2. 已跑命令与结果原文摘录

### T1 · 官方相关测试（本机实跑）

```
cd 'F:\AI\大观园本地'; node --test test/electron-security.test.mjs test/desktop-package.test.mjs
```

```
# tests 20
# pass 20
# fail 0
# duration_ms 361.35
[exit code: 0]
```

（含 `test/desktop-package.test.mjs` 的 3 个用例：Windows 可执行与安装包 logo、desktop 包排除本地记录、ASCII 规范化 shard 路径。）

### R1-R12 · 本地服务跨源探测（临时数据目录，非真实用户目录）

启动：

```
$dir = "$env:TEMP\dg-audit-01"; $env:DAGUAN_DATA_DIR=$dir; $env:PORT='18080';
$env:DAGUAN_OPEN_BROWSER='0'; $env:DAGUAN_LAUNCHER_KIND='browser'; $env:DAGUAN_DEFAULT_PAGE='/index.html'
Start-Process node 'local-server/server.mjs' -WorkingDirectory 'F:\AI\大观园本地'
```

stdout：

```
SERVICE_INSTANCE_READY http://127.0.0.1:18080/ 3903bdda-6e25-43c7-8227-f815f240751e
```

探测（`Invoke-WebRequest -SkipHttpErrorCheck`）原文摘录：

```
A1  GET  /api/health                      无 Origin
    → 200   {"ok":true,"service":"daguan-local-console","apiProtocol":1,"instanceId":"...","launcherKind":"browser","pid":37048,"port":18080,...}
    → Access-Control-Allow-Origin 头：空

A2  GET  /api/state                       Origin: https://evil.example
    → 200   返回完整 state JSON（ACAO 仍为空）

A3  GET  /api/state                       Host: attacker.example
    → 200   正常返回（服务端不校验 Host）

A4  OPTIONS /api/state                    Origin + Access-Control-Request-Method: POST
    → 404   {"error":"资源不存在"}

A5  POST /api/runtime/stop                Origin: https://evil.example
    → 403   {"ok":false,"error":"停止服务只允许从本机应用页面发起"}

B1  POST /api/visit-history               Origin: evil, Content-Type: text/plain
    → 400   {"error":"题目 ID 无效"}

B2  POST /api/state/migrate               Origin: https://evil.example
                                          Content-Type: text/plain;charset=UTF-8
                                          body: {"document":{"format":"daguan-local-state","version":3,"progress":{}}}
    → 200   {"ok":true,"state":{...,"revision":1,...}}          ★ 跨源写入成功

B4  POST /api/ai/profiles                 Origin: evil, text/plain
    → 500   {"error":"无法确认 HTTP 地址的网络范围；公网地址请使用 HTTPS"}

C3  POST /api/integrations/cxyonly/logout Origin: https://evil.example, text/plain, body 空
    → 200   {"ok":true}                                          ★ 跨源登出成功

C4  GET  /api/state
    → revision=1                                                 ★ 确认 B2 已落盘
```

收尾：`Stop-Process -Id 37048 -Force` → `PID 37048 EXITED`，`Get-NetTCPConnection -LocalPort 18080` 无监听，无残留 `electron` 进程。

> 说明：收尾时另发现一个 `node local-server/server.mjs`（PID 47604，端口 18086，启动时间 12:36:06）**不是本次审查启动的**（本机并行的其他子代理的测试进程），已按「不动他人进程」原则保留，未终止。

### E1 · Electron 运行时探针（真实 `policy.windowPreferences` + 真实 `preload.cjs`）

探针：`%TEMP%\dg-audit-electron-01\main.cjs`（只读引用仓库文件，不改动仓库）

```
& 'F:\AI\大观园本地\node_modules\electron\dist\electron.exe' "$env:TEMP\dg-audit-electron-01\main.cjs"
```

无权限 handler（= 应用实际状态）：

```json
{
  "prefs": { "preload": "F:\\AI\\大观园本地\\desktop\\preload.cjs", "nodeIntegration": false,
             "contextIsolation": true, "sandbox": true, "webSecurity": true },
  "result": {
    "require": "undefined", "process": "undefined", "module": "undefined", "globalThis_process": "undefined",
    "daguanDesktop": "object",
    "daguanDesktopKeys": ["getAppVersion", "getStartup", "remoteAccess", "setStartup"],
    "daguanDesktopFrozen": true,
    "ipcRendererExposed": "undefined",
    "desktopBar": true,
    "desktopBarButtons": ["switch", "print", "updates", "quit"],
    "geolocation": "granted", "notifications": "granted", "camera": "granted", "mic": "granted",
    "getUserMedia": "RESOLVED",
    "notificationRequest": "granted"
  }
}
```

对照（`DG_PROBE_DENY=1`，装上 `cb(false)` handler）：

```json
"getUserMedia": "REJECTED:NotAllowedError",
"notificationRequest": "denied"
```

### E3 · CSP + marked 注入探针（真实 `policy.APP_CONTENT_SECURITY_POLICY` + 真实 `web/vendor/marked.min.js`）

探针：`%TEMP%\dg-audit-electron-01\main2.cjs`、`main3.cjs`

main2（CSP 基础行为）：

```json
{
  "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; ... frame-ancestors 'none'",
  "result": {
    "evalResult": "BLOCKED:EvalError",
    "injectedScriptRan": false,
    "inlineHandlerFired": true
  }
}
```

main3（真实 marked v12.0.2）：

```json
{
  "markedLoaded": "object",
  "rendered": "<p>text</p>\n<img src=\"x\" onerror=\"window.__pwn=1\">",
  "onerrorFired": true,
  "scriptPassthrough": "<script>window.__x=1</script>"
}
```

### 其他静态确认

```
Get-Content web\vendor\marked.min.js -TotalCount 3
→ /** \n * marked v12.0.2 - a markdown parser \n * Copyright (c) 2011-2024, Christopher Jeffrey. (MIT Licensed)

(Select-String -Path web\app-new.js,web\app-legacy.js -Pattern 'onclick=|onchange=|oninput=' -AllMatches | Measure-Object).Count
→ 75

node -e "console.log(require('./node_modules/electron/package.json').version)"
→ 44.4.5
```

---

## 3. 未能验证的事项

| 事项 | 理由 |
| --- | --- |
| **F-04 的实际挂起复现** | 需要挂起（suspend）真实的本地服务进程再点退出。同机有并行的其他审查子代理正在跑测试并使用本地服务，挂起进程会污染它们的测试环境。已用代码路径分析 + 与 `stopStartupChild()` 的对照给出结论，未做破坏性复现。 |
| **F-11 Windows 关机/注销时的孤儿进程** | 需要真实触发注销/关机，会中断当前会话。仅做了代码路径分析（缺少 `session-end` 处理）。 |
| **`test/desktop-csp-smoke.mjs` 未运行** | 该测试需要 `DAGUAN_CDP_ENDPOINT` 指向一个已开启 `daguan://app/` 的 Electron 实例，且需要 `DAGUAN_PLAYWRIGHT_MODULE` 环境变量。本机未安装 Playwright（`node_modules` 中无该模块），无法运行。这也意味着「CSP 响应头在生产构建里确实生效」这一点目前**只由源码推断**（`desktop/electron-main.cjs:148`），不过我用探针 E3 以真实的 `policy.APP_CONTENT_SECURITY_POLICY` 值直接验证了该策略串的实际效果。 |
| **F-03 的完整利用链（题库/AI 输出能否被外部输入污染）** | 属于前端渲染与题库更新链路的审查范围。本报告只确认了「CSP 无法阻止这类注入」以及「`renderMarkdown` 输出直插 `innerHTML` 且无 sanitize」两个 Electron/前端交界处的事实。 |
| **真实用户数据目录的行为** | 严格遵守约束，全程未读写 `%LOCALAPPDATA%\DaguanMath\data`。`dataDirectory()`（`desktop/electron-main.cjs:36-39`）会永远解析到该目录（除非显式设 `DAGUAN_DATA_DIR`）这一点是**代码审查结论**，未实机运行桌面版验证。附带观察：审查期间该目录下存在 `launcherKind:"desktop"`、`pid:6196`、`port:5502` 的实例锁，说明用户当前有一个真实的桌面版实例在运行（未触碰）。 |
| **`DAGUAN_USER_DATA_DIR` 覆写 `app.setPath("userData")` 的实际效果** | 未实机运行。代码在 `desktop/electron-main.cjs:17`，`whenReady` 之前执行，语法与时机正确；`userData` 存放 `remote-auth.json`（远程访问密码哈希）与 `remote-tunnel.json`，是敏感路径，值得补一条测试。 |
| **生产打包产物的实际 `webPreferences`** | 未解包 `electron-forge make` 产物比对。审查基于源码 + 直接加载真实 `policy.mjs`/`preload.cjs` 的运行时探针。 |

---

## 4. 架构级优化建议（按性价比排序）

### ① 给本地服务加统一的「来源 + 身份」闸门（最高性价比）

这是本次唯一 P1 的根因，也是改动最集中、收益最大的一处。

- 在 `local-server/server.mjs` 的 `route()` 开头加一道统一校验：非 GET/HEAD 请求必须带 `Origin` 且等于 `http://127.0.0.1:${PORT}`；`Host` 必须是 `127.0.0.1:${PORT}` 或 `localhost:${PORT}`。
- **必须同步改反代**：`desktop/electron-main.cjs:136` 用的 `policy.proxyHeaders()` 会剔除 `origin`，所以要么在转发时补回 `Origin: http://127.0.0.1:${port}`，要么让反代带上一个启动时随机生成的 `X-Daguan-Token`（推荐后者，能一次性解决 CSRF、DNS rebinding 和本机进程伪装）。
- 顺手把 `desktop/remote-gateway.cjs:62-67` 已经写好、已经过测试的 `sameOrigin()` 逻辑直接移植过来，减少新代码风险。
- 顺带补 `Content-Type: application/json` 校验（单独一层，不能替代 Origin/token）。

### ② 把「退出/启动失败」的进程收尾做成有超时、有强杀、有日志的统一收口

F-04 + F-05 + F-06 是同一个病：**子进程生命周期没有兜底**。建议抽一个 `desktop/process-lifecycle.mjs`：

- `stopChild(child, { timeoutMs = 8000 })`：`shutdown` IPC → 超时 → `kill()` → 再超时 → 记日志；`requestQuit()` 与 `stopStartupChild()` 共用。
- 所有 `spawn` 出来的 child 都登记到一个 `Set`，`before-quit` 里统一收尾，避免「失败路径的 child 没被记录」这个漏洞。
- 主进程顶部加 `uncaughtException` / `unhandledRejection` → 写 `dataDirectory()/logs/desktop-main.log`。

### ③ 让渲染层不再依赖 `'unsafe-inline'`，并给 markdown 输出加白名单

这是唯一能把 F-03 从「纵深防御缺口」变成「真正被缓解」的路径：

- `renderMarkdown` 输出过白名单（DOMPurify 或自建标签/属性白名单）。
- 75 处内联 `onclick` 迁移到 `data-action` + 事件委托（`web/ui-bootstrap.js` 已有 `[data-app-action]` 委托模式，可直接扩展）。
- 之后从 `policy.APP_CONTENT_SECURITY_POLICY` 移除 `script-src`/`style-src` 的 `'unsafe-inline'`，并把 CSP 挂到所有文档型扩展名上（F-09）。

### ④ 补权限处理器（一次性、两行代码）

```js
session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
session.defaultSession.setPermissionCheckHandler(() => false);
```

本应用不需要任何浏览器权限，直接全拒即可。

### ⑤ 把「运行时行为」纳入测试，而不只是源码文本断言

F-13 是这份报告里所有 P2/P3 能长期存活的土壤。建议：

- `test/electron-runtime.test.mjs`：用临时数据目录 + 临时 Electron 探针，断言 `require === undefined`、`window.daguanDesktop` 只有 4 个 key 且 frozen、`getUserMedia` 被拒、注入的内联 handler 不执行。本报告 E1/E2/E3 三个探针已经可以直接改造复用。
- `test/local-server-csrf.test.mjs`：断言伪造 Origin 的写请求返回 403。
- `test/electron-security.test.mjs` 加结构化断言：每个 `ipcMain.handle` 回调体必须出现 `validIpc(event)`；CSP 断言从「含 `'unsafe-inline'`」改为「不含 `'unsafe-inline'`」（在 ③ 完成后）。

### ⑥ 降低「服务来源无法确认 → 启动失败」的可用性风险

`desktop/electron-main.cjs:117` 目前是**硬失败**。建议降级为「提示 + 只读复用 + 退出时不接管」，避免 PowerShell/WMI 不可用的机器上应用完全打不开（F-12）。

---

## 附录 · 审查产物与临时文件位置

- 报告：`F:\AI\大观园本地\docs\desktop-audit-20261001\01-electron-security.md`（本文件）
- Electron 探针脚本（临时目录，非仓库）：`%TEMP%\dg-audit-electron-01\main.cjs`、`main2.cjs`、`main3.cjs`
- 跨源探测用的临时数据目录：`%TEMP%\dg-audit-01`（内含本次探测写入的 `state.json` 等，与真实用户数据无关；残留一个指向已退出 PID 的 `.service-instance.json`，无害）
- **本次审查启动的进程均已退出**：`node local-server/server.mjs`（PID 37048）已 `Stop-Process -Force` 并确认端口 18080 无监听；探针 Electron 进程由脚本自身 `app.quit()` 结束，复查 `Get-Process electron` 为空。
