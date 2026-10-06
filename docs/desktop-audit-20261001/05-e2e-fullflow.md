# 大观园数学 桌面版 — 端到端全流程实测报告

- 审计日期：2026-10-01
- 工作目录：`F:\AI\大观园本地`（正本 checkout，分支 `main`，HEAD `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，版本 **1.0.10**）
- 运行环境：Windows，Node **v24.15.0**，npm **11.12.1**，Electron **v24.21.0**（内嵌 Chrome/152.0.7977.130、Electron/44.4.5）
- 隔离措施：所有服务/桌面进程均在 `DAGUAN_DATA_DIR=%TEMP%\dg-e2e-20261001\...` 下运行，端口 **18083–18087**。**全程未读写真实 `%LOCALAPPDATA%\DaguanMath\data`**（该目录的 `state.json` mtime 为 2026-10-01 10:47、锁文件 mtime 为 09:00，均早于本次实测开始时间 12:40）。
- 只读约束：未修改/删除/移动/重命名任何仓库源码；未执行 `git reset/clean/stash`；未推送部署。仓库 `git status` 最终为 0 个已跟踪文件被改。
- 本报告是本次任务唯一写入的仓库文件。

---

## 0) 结论摘要

### 0.1 全流程总览

| 步骤 | 内容 | 命令/方式 | 结果 | 关键证据 |
|---|---|---|---|---|
| A | 环境与静态基线 | `git status --short --branch`、`node -v`、`npm -v`、`npm run verify` | ✅ 通过 | 分支 `main...origin/main`，0 已跟踪改动；verify exit 0、1051 ms、"题库验证通过：6521 题，6521 个唯一题号" |
| B | 完整测试套件 | `npm test`（31 文件清单）、非清单脚本单独试跑 | ❌ **失败 1 例**（P1-02） | 设 `DAGUAN_DATA_DIR` 时 265 例 / pass 238 / fail 1 / skip 26 / exit 1；不设时 265 / pass 239 / fail 0 / exit 0 |
| C | 服务端全流程 | `node local-server/server.mjs` + 6 个探测脚本 | ❌ **P0 崩溃** | 非法 mastery 值使进程 `ERR_HTTP_HEADERS_SENT` 崩溃退出码 1；其余端点、穿越防护、锁、优雅停止全部通过 |
| D | 桌面版全流程 | `electron.exe . --remote-debugging-port=19222` + CDP + Win32 窗口枚举 | ✅ 通过 | 窗口创建、页面 `readyState:complete`、控制台仅 2 条正常日志、0 页面错误、托盘存在、优雅退出后 0 进程 0 端口 0 残留锁 |
| E | 数据生命周期 | 写入→重启→持久化、实例锁、死锁恢复、导出 | ⚠️ 基本通过（1 项 P1） | 重启后 revision 6 数据完整；死 PID 锁自动回收；`source=android` 导出 500 `Invalid time value`（P1-01） |
| F | 桌面版/浏览器版共用数据目录冲突 | 静态分析 + 两个临时目录 + 真实 `service-handoff.mjs` | ✅ 通过 | browser 持有者被桌面版 133 ms 优雅接管；desktop 持有者被识别为"不接管"；同目录第二个启动器 `SERVICE_INSTANCE_REUSED` 后退出 |
| G | 退出与资源 | PID/端口/锁/僵尸进程对比 | ✅ 通过 | 我的全部 PID 均已退出，18083/18085/18086/18087 监听数 0，electron 进程数 0 |

### 0.2 统计

- `npm test`（**设** `DAGUAN_DATA_DIR`，符合 AGENTS.md 的隔离要求）：`tests 265 / suites 9 / pass 238 / fail 1 / cancelled 0 / skipped 26 / todo 0 / duration 17196.74 ms`，退出码 **1**。
- `npm test`（**不设** `DAGUAN_DATA_DIR`）：`tests 265 / suites 9 / pass 239 / fail 0 / skipped 26 / duration 17621.57 ms`，退出码 **0**，墙钟 19245 ms。
- `npm run verify`：退出码 **0**，1051 ms，"题库验证通过：6521 题，6521 个唯一题号"；伴随警告"缺少 41 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐"。
- 26 例 skip 的原因全部为 `# Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE`（本机未安装 Playwright）。

### 0.3 一句话结论

服务端的**安全与一致性设计（实例锁、优雅停止、路径穿越防护、桌面/浏览器数据目录交接）实测都站得住**，桌面版本身跑得很干净；但 `local-server/server.mjs:465` 有一个**一行代码就能打死整个本地服务的 P0 崩溃**，另有一个**会让安卓迁移导出必然失败的 P1 时间戳类型 bug**。测试套件在 AGENTS.md 指定的隔离方式下会红——原因是测试自己没做隔离。

---

## 1) Bug 清单

### P0-01 ｜ 非法 mastery 值导致本地服务进程崩溃（远程可触发）

- **严重度**：P0
- **标题**：`PATCH /api/state/questions/:id` 收到非法 `mastery` 时，`return` 只返回了 `withLock` 回调，处理器继续执行并对已响应的 socket 再次写头 → `ERR_HTTP_HEADERS_SENT` → **进程崩溃退出**
- **位置**：`local-server/server.mjs:465`（该 `return` 位于 `:452` 开始的 `withLock(async () => {...})` 回调内）

  ```js
  if (incoming.mastery != null) {
    if (!["not_started","learning","mastered","forgot"].includes(incoming.mastery)) return json(res, 400, { ok:false, error:"掌握状态无效" });
  ```

- **证据**（服务端 stderr 原文）：

  ```
  node:_http_server:365
      throw new ERR_HTTP_HEADERS_SENT('write');
            ^
  Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client
      at ServerResponse.writeHead (node:_http_server:365:11)
      at json (file:///F:/AI/%E5%A4%A7%E8%A7%82%E5%9B%AD%E6%9C%AC%E5%9C%B0/local-server/server.mjs:47:7)
      at errorJson (file:///F:/AI/%E5%A4%A7%E8%A7%82%E5%9B%AD%E6%9C%AC%E5%9C%B0/local-server/server.mjs:53:3)
      at file:///F:/AI/%E5%A4%A7%E8%A7%82%E5%9B%AD%E6%9C%AC%E5%9C%B0/local-server/server.mjs:645:36 {
    code: 'ERR_HTTP_HEADERS_SENT'
  }
  ```

  进程退出码 **1**。用 `probe5.mjs` 逐条请求 + 每条后做存活探测，二分定位到唯一触发点：

  | 请求 | 响应 | 服务存活 |
  |---|---|---|
  | `PUT /api/state` body 非法 JSON | 500 | 存活 |
  | `PUT /api/state` body 空 | 409 | 存活 |
  | `PUT /api/state` body `null` | 500 | 存活 |
  | `PUT /api/state` body 数组 | 409 | 存活 |
  | `PATCH /api/state/questions/abc` | 400 | 存活 |
  | **`PATCH /api/state/questions/1` body `{"revision":0,"mastery":"bogus"}`** | **400** | **DEAD** |

- **复现步骤**：
  1. `$env:PORT="18083"; $env:DAGUAN_DATA_DIR="$env:TEMP\dg-e2e-20261001\data"; $env:DAGUAN_OPEN_BROWSER="0"; node local-server/server.mjs`
  2. 发一条请求：`PATCH http://127.0.0.1:18083/api/state/questions/1`，`Content-Type: application/json`，body `{"revision":0,"mastery":"bogus"}`
  3. 观察服务端进程立刻以退出码 1 结束，stderr 打印上面的 `ERR_HTTP_HEADERS_SENT` 堆栈。
- **影响**：
  - 任何能访问本机 `127.0.0.1:8080`（或当前端口）的页面/脚本都能一击打死本地服务。由于 `GET /api/runtime` 等端点无需鉴权、页面 JS 也在同源，一个前端 bug 或一次手抖的 `mastery` 拼写就会让服务下线。
  - 服务崩溃后 **`.service-instance.json` 锁文件残留**（进程被 Node 的未捕获异常终止，`shutdown()` 未执行），后续启动要走死-owner 回收路径。
  - 桌面版此时会失去后端（`serveAppRequest` 对 `/api/`、`/data/` 返回 503 `本地服务暂时不可用`）。
- **修复建议**（最小改动）：让校验失败真正终止处理器。把校验提到 `withLock` **之前**，或改成抛错由外层统一处理：

  ```js
  // 方案 A：前置校验（推荐）
  if (incoming.mastery != null && !["not_started","learning","mastered","forgot"].includes(incoming.mastery)) {
    return json(res, 400, { ok: false, error: "掌握状态无效" });
  }
  // 方案 B：在回调内用 throw，由 route() 的 catch 统一转成响应
  if (...) throw Object.assign(new Error("掌握状态无效"), { status: 400 });
  ```

  另建议在 `route()` 的 `catch` 中加一个 `res.headersSent` 守卫：`if (res.headersSent) { res.destroy(); return; }`，避免任何同类问题再次升级为进程崩溃。

---

### P1-01 ｜ 安卓迁移导出必然 500：`updated_at` 是 ISO 字符串却被当数字解析

- **严重度**：P1
- **标题**：`sync-format.mjs` 用 `new Date(Number(state.updated_at)).toISOString()` 处理时间戳，但 `store.mjs` 写入的是 **ISO 字符串**，`Number()` 得到 `NaN` → `toISOString()` 抛 `Invalid time value`
- **位置**：
  - `local-server/store.mjs:59` → `next.updated_at = new Date().toISOString();`（写入 **字符串**）
  - `local-server/sync-format.mjs:162` → `updated_at: state.updated_at ? new Date(Number(state.updated_at)).toISOString() : nowIso()`
  - `local-server/sync-format.mjs:198` → `updatedAt: state.updated_at ? new Date(Number(state.updated_at)).toISOString() : null`
  - 调用方 `local-server/sync-format.mjs:178` `export function localToAndroidDocument(localState)`
- **证据**：

  ```
  GET /api/integrations/cxyonly/export?source=android
  → 500 {"ok":false,"code":null,"error":"Invalid time value"}
  ```

  类型验证：`state.json` 的 `updated_at` 为 ISO 字符串（`typeof === "string"`，形如 `2026-10-01T04:39:19.102Z`），而 `Number("2026-10-01T04:39:19.102Z")` → `NaN`，`new Date(NaN).toISOString()` → `RangeError: Invalid time value`。
- **复现步骤**：
  1. 启动服务并写入任意进度（使 `state.json` 带上真实的 `updated_at`）。
  2. `GET http://127.0.0.1:18083/api/integrations/cxyonly/export?source=android`
  3. 得到 500 `Invalid time value`。
- **影响**：**安卓端迁移/同步导出功能对任何真实数据都不可用**。只要 `state.json` 里有真实的 `updated_at`（正常使用必然如此），`source=android` 就必定失败；`localToAndroidDocument` 的本地进度文档生成路径同样受影响。测试没抓到，是因为夹具喂的是数字时间戳，绕过了这条真实数据路径。
- **修复建议**：改为按字符串解析并保留数字兼容：

  ```js
  function toIso(value) {
    if (!value) return null;
    const n = Number(value);
    const d = Number.isFinite(n) ? new Date(n) : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  ```

  并补一个"夹具使用 ISO 字符串 `updated_at`"的回归测试。

---

### P1-02 ｜ 按 AGENTS.md 隔离运行 `npm test` 会失败：测试未隔离，串了同一个数据目录

- **严重度**：P1
- **标题**：`test/ai-service.test.mjs` 调用 `createStore(root)` 时省略第二个参数，`store.mjs:5` 的默认参数把它绑定到 `process.env.DAGUAN_DATA_DIR`，导致同一文件内的用例互相污染
- **位置**：
  - `local-server/store.mjs:5` → `export function createStore(rootDir, dataDirOverride = process.env.DAGUAN_DATA_DIR)`
  - `test/ai-service.test.mjs:17` 与 `:32` → `createStore(root)`（**未传第二个参数**）
  - 失败断言 `test/ai-service.test.mjs:80`；同源隐患见 `test/local-server.test.mjs:20` `return { root, store: createStore(root) };`
- **证据**（同一文件单独跑，排除并发干扰）：

  ```
  A) 设 DAGUAN_DATA_DIR=<全新临时目录>：  ℹ tests 8  ℹ pass 7  ℹ fail 1   exit=1
       actual: 'sk-secret-key'   expected: 'test-only-key'
  B) 不设 DAGUAN_DATA_DIR：              ℹ tests 8  ℹ pass 8  ℹ fail 0   exit=0
  ```

  全量：设变量时 `pass 238 / fail 1 / exit 1`；不设时 `pass 239 / fail 0 / exit 0`。
  失败用例名：`无模型可保存并获取列表，旧档案默认流式，Key 留空保留`
  断言原文：
  ```
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'sk-secret-key'
  - 'test-only-key'
      at TestContext.<anonymous> (file:///F:/AI/%E5%A4%A7%E8%A7%82%E5%9B%AD%E6%9C%AC%E5%9C%B0/test/ai-service.test.mjs:80:10)
  ```
- **复现步骤**：
  1. `$env:DAGUAN_DATA_DIR="$env:TEMP\some-fresh-dir"`
  2. `node --test test/ai-service.test.mjs` → 1 例失败
  3. `Remove-Item Env:\DAGUAN_DATA_DIR; node --test test/ai-service.test.mjs` → 全绿
- **影响**：AGENTS.md 明确要求"测试与手动验证一律用临时 `DAGUAN_DATA_DIR`"，而**照做就会让 `npm test` 变红**。反过来，不设变量时测试会把状态写进仓库 `data/`，与"测试不碰真实数据"的意图相悖。测试并非声称的那样彼此隔离——用例 1 写入 `sk-secret-key`，用例 2 从同一个共享目录读出它。
- **修复建议**：给所有 `createStore` 调用显式传入各自的临时目录（或改默认参数为 `dataDirOverride ?? path.join(rootDir, "data")` 并让测试不依赖环境变量）：

  ```js
  const store = createStore(root, path.join(root, "data"));
  ```

  `test/local-server.test.mjs:20` 同一处一并修。修完请分别在"设/不设 `DAGUAN_DATA_DIR`"两种情况下各跑一次全量，确保 265 例两处都全绿。

---

### P2-01 ｜ 非法请求体返回 500 而非 400

- **严重度**：P2
- **证据**：
  - `PUT /api/state` body 为非法 JSON → `500 {"ok":false,"code":null,"error":"JSON 格式错误"}`（期望 400）
  - `PUT /api/state` body 为 `null` → `500 {"error":"Cannot read properties of null (reading 'revision')"}`（内部 TypeError 直接外泄）
  - `POST /api/visit-history` body 为非法 JSON → `500 "JSON 格式错误"`
  - 超大请求体（11 MB）→ `500 {"error":"请求体过大"}`（期望 413）
- **影响**：客户端无法区分"请求写错了"和"服务端炸了"；错误信息把内部堆栈语义暴露给调用方；同时这条 500 路径正是 P0-01 崩溃的放大器（`errorJson` 在已响应后再次写头）。
- **修复建议**：为 `body()` 的解析失败与超限定义明确的 `status`（400 / 413），在 `route()` 顶层 catch 里按 `error.status || 500` 输出，并加 `res.headersSent` 守卫。

---

### P2-02 ｜ `export?source=` 未知取值静默降级

- **严重度**：P2
- **证据**：`GET /api/integrations/cxyonly/export?source=bogus` → **200**，返回本地状态（`server.mjs:585-591` 的 `else` 分支）。
- **影响**：拼错的参数不会报错，用户可能拿到并非所期望来源的数据（例如以为导出了 remote，实际是 local）。数据本身无害，但语义静默。
- **修复建议**：对 `source` 做白名单校验，未知值返回 400。

---

### P2-03 ｜ 端口冲突时抛出原始 `EADDRINUSE` 堆栈

- **严重度**：P2
- **证据**（两个**不同**数据目录、同一端口 18085 时）：

  ```
  Error: listen EADDRINUSE: address already in use 127.0.0.1:18085
      at Server.setupListenHandle [as _listen2] (node:net:2008:16)
      at listenInCluster (node:net:2065:12)
      at node:net:2274:7
      at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
    code: 'EADDRINUSE', errno: -4091, syscall: 'listen',
  ```
  退出码 1。**该路径下实例锁被正确释放**（验证第二个数据目录中无 `.service-instance.json`），所以不会留下脏锁。
- **影响**：当"开发态浏览器版（数据目录 = 仓库 `data/`）"与"已安装版（数据目录 = `%LOCALAPPDATA%\DaguanMath\data`）"恰好抢同一端口时，用户看到的是一段英文堆栈而非"端口被占用，请关闭占用程序"。
- **修复建议**：在 `server.listen` 的 `error` 分支识别 `EADDRINUSE`，输出中文提示并建议改用其它端口；`server.mjs:683-689` 已有 `once("error", onError)` 挂点，直接在其中分流即可。

---

### P3-01 ｜ `//package.json` 被解析为默认页返回 200

- **严重度**：P3
- **证据**：`GET //package.json` → **200**，返回 landing 页 HTML（而非 404）。
- **影响**：无害（并未泄露文件，只是双斜杠被规范化为根路径后落到默认页），但会让"探测不存在的文件应得 404"的直觉失效。
- **修复建议**：在路由前把 `//` 归一化为 `/`，或在静态资源命中前拒绝含重复斜杠的路径。

---

### P3-02 ｜ 桌面版身份识别依赖 `powershell.exe` 子进程（受限环境下会退化）

- **严重度**：P3（环境相关，非产品缺陷）
- **位置**：`desktop/service-handoff.mjs:26-35` `windowsProcessImage()` 用 `execFile("powershell.exe", ...)` 并**捕获 stdout**（`promisify(execFile)` 默认 `stdio: 'pipe'`）。
- **说明**：只有当锁文件与 `/api/health` **都**缺少 `launcherKind`（即历史遗留锁）时才会走到这一步。在禁止管道 stdio 的沙箱环境中该调用会 `EPERM`，被 `catch` 吞掉返回 `null`，`classifyServiceOwner` 退化为 `"unknown"`，于是 `electron-main.cjs:117` 抛"来源无法确认，桌面版不会停止该进程"——表现为桌面版拒绝接管，需要用户手工处理。
- **影响**：仅影响从旧版本升级、锁文件无 `launcherKind` 的场景；本次实测的正常路径（`launcherKind: "browser"`）**未触发**，接管耗时 133 ms。
- **修复建议**：可改用 `tasklist`/`Get-CimInstance` 的 `-File` 输出方式或直接以 `launcherKind` + 实例 ID 为准；至少把该退化路径的错误提示写成可操作的中文指引。

---

## 2) 完整命令与输出摘录

### A. 环境与静态基线

```powershell
cd 'F:\AI\大观园本地'
git status --short --branch
```
```
## main...origin/main
```
（0 个已跟踪文件被修改；26 个未跟踪项，含本审计目录 `docs/desktop-audit-20261001/`）

```powershell
node -v ; npm -v ; node_modules\electron\dist\electron.exe --version
```
```
v24.15.0
11.12.1
v24.21.0
```

```powershell
npm run verify
```
```
题库验证通过：6521 题，6521 个唯一题号
缺少 41 张题图；运行 npm run sync:data 并提供 DAGUAN_ASSET_TOKEN 后补齐
exit=0   耗时 1051 ms
```

### B. 完整测试套件

```powershell
$env:DAGUAN_DATA_DIR="$env:TEMP\dg-e2e-20261001\data"; npm test
```
```
ℹ tests 265   ℹ suites 9   ℹ pass 238   ℹ fail 1   ℹ skipped 26   ℹ duration_ms 17196.7419
✖ 无模型可保存并获取列表，旧档案默认流式，Key 留空保留 (115.4381ms)
exit=1
```

```powershell
Remove-Item Env:\DAGUAN_DATA_DIR; npm test
```
```
ℹ tests 265   ℹ suites 9   ℹ pass 239   ℹ fail 0   ℹ skipped 26   ℹ duration_ms 17621.5731
exit=0   （墙钟 19245 ms）
```

```powershell
node --test test/ai-service.test.mjs          # 设 DAGUAN_DATA_DIR
```
```
ℹ tests 8   ℹ pass 7   ℹ fail 1     exit=1
actual: 'sk-secret-key'   expected: 'test-only-key'
```

非 npm test 清单内脚本的实测结论：

| 脚本 | 实测结果 |
|---|---|
| `test/remote-live-smoke.mjs` | ✅ **跑通**：`Quick Tunnel: login, both UIs, learning write, annotation, second session state, AI listing, download, and management block verified; host: learning-cats-coordinates-vision.trycloudflare.com`（需外网，已连通 Cloudflare） |
| `test/desktop-csp-smoke.mjs` | ❌ `Error: Set DAGUAN_PLAYWRIGHT_MODULE to the installed Playwright package entry.`（第 6 行） |
| `test/desktop-cdp-smoke.mjs` | ❌ `Error: Cannot find module 'playwright'` |
| `test/desktop-lifecycle-smoke.mjs` | ❌ 第 14 行 `require("playwright")`；另需 Windows GUI + user32 P/Invoke |
| `test/remote-electron-smoke.mjs` | ❌ 需 Electron + Playwright |
| `test/browser-package-smoke.mjs` | ❌ 依赖 Playwright |
| `test/migration_browser_playwright.py` | ❌ 依赖 Playwright |
| `test/browser-retirement-playwright.py` | ❌ 第 5 行 `from playwright.sync_api import sync_playwright`；另需 `PORT` + 隔离 `DAGUAN_DATA_DIR` |
| `test/squirrel_update_e2e.py` | ⏭ **主动跳过**：需要 Playwright async，且会从本地 feed 真实安装 Squirrel 0.9.0 并升级到 0.9.1（`ROOT/.build/stage4-update-qa`），属真实安装/更新操作 |

未进 `npm test` 的根因：这些脚本要么依赖未安装的 Playwright（本机 `node_modules/playwright`、`playwright-core` 均不存在，`DAGUAN_PLAYWRIGHT_MODULE` 未设），要么执行真实安装/更新，不适合放进默认套件。`desktop-lifecycle-smoke.mjs` 覆盖的窗口隐藏/关闭语义，本次已用 CDP + Win32 枚举手工等价复现。

### C. 服务端全流程（端口 18083，临时数据目录）

启动：

```powershell
$env:PORT="18083"; $env:DAGUAN_DATA_DIR="$env:TEMP\dg-e2e-20261001\data"
$env:DAGUAN_OPEN_BROWSER="0"; $env:DAGUAN_LAUNCHER_KIND="browser"
node local-server/server.mjs
```
```
SERVICE_INSTANCE_READY http://127.0.0.1:18083/ b8a8fadd-56dc-4e4e-9483-8180b938fdf1
```
首次启动只创建 `.service-instance.json` 与 `study-activity.json`（`state.json` 为惰性写入，首次写入时才落盘）。

端点探测结果：

| 端点 | 状态码 | 备注 |
|---|---|---|
| `/api/health` | 200 | `service:"daguan-local-console"`, `apiProtocol:1`, `launcherKind`, `pid`, `port` |
| `/api/question-bank/status` | 200 | `{"enabled":false,"activeId":"bundled",...}` |
| `/api/access/status` | 200 | `previewMode:false, unlocked:true` |
| `/api/runtime` | 200 | `appVersion: 2026.09.27-shared-service-r1`，catalog total 6521 |
| `/` | 200 | landing.html，16567 B |
| `/index.html` | 200 | 7855 B |
| `/legacy.html` | 200 | 54875 B |
| `/app-new.js` | 200 | 358409 B |
| `/app-legacy.js` | 200 | 270230 B |
| `/ui-bootstrap.js` | 200 | — |
| `/data/manifest.json` | 200 | 761 B |
| `/service-worker.js` | 200 | — |
| `/style.css` | **404** | **非 bug**：仓库中本就不存在该文件（实际样式为 `styles.css`/`styles-new.css`），全仓库无任何引用 |
| 不存在的页面/JS/资源 | 404 | `{"error":"资源不存在"}` |
| `/api/state` | 200 | 首次 revision 0 |
| `/api/visit-history`、`/api/study-activity`、`/api/ai/profiles`、`/api/integrations/cxyonly/status` | 200 | — |
| `/api/runtime/stop`（无 Origin 或 Origin 错误） | **403** | 防跨站停止，防护有效 |
| `/daguan-math/`、`/daguan-math/api/health` | 200 | 子路径部署可用 |

路径穿越尝试（**防护全部有效**）：

| 请求 | 结果 |
|---|---|
| `/../package.json` | 404 |
| `/..%2f..%2fpackage.json` | **403** |
| `/%2e%2e%2fpackage.json` | **403** |
| `/data/..%2f..%2fpackage.json` | **403** |
| `/..%5cpackage.json` | **403** |
| `/C:/Windows/win.ini` | 404 |
| UNC 形式 | 404 |
| 含 NUL 字节 | 404 |

非法输入：

```
PUT /api/state  非法 JSON        → 500 {"ok":false,"code":null,"error":"JSON 格式错误"}
PUT /api/state  空 body          → 409 REVISION_REQUIRED
PUT /api/state  body=null        → 500 {"error":"Cannot read properties of null (reading 'revision')"}
PUT /api/state  body=数组        → 409
POST /api/visit-history 非法JSON → 500 "JSON 格式错误"
PATCH /api/state/questions/abc   → 400 "题目 ID 无效"
PATCH /api/state/questions/1 mastery="bogus" → 400 "掌握状态无效"  ← 随后进程崩溃（P0-01）
11 MB 请求体                     → 500 {"error":"请求体过大"}
```

题库清单（`/data/manifest.json`）：version 1，total **6521**，types `{subjective 4669, single_choice 1848, multiple_choice 4}`，shards `{高等数学 3082, 线性代数 803, 概率统计 316, 历年真题 1776, 模拟哥专区 544, 未分类 0}`，`asset_count 1242`，`asset_base ./data/assets/`，`source_total 6362`。

单题 PATCH 全流程：q1 mastered → rev1；q2 forgot → rev2（落盘为 `learning` + `error_prone:true`）；q3 favorite → rev3；过期 revision → 409 `STATE_CONFLICT`；批注 PATCH → rev6。

### D. 桌面版全流程（CDP + Win32 窗口枚举）

```powershell
$env:PORT="18083"; $env:DAGUAN_DATA_DIR="$d\data"; $env:DAGUAN_USER_DATA_DIR="$d\desktop-profile"
$env:DAGUAN_OPEN_BROWSER="0"
node_modules\electron\dist\electron.exe . --remote-debugging-port=19222
```
```
DevTools listening on ws://127.0.0.1:19222/...
```
`/json/version` → `大观园数学/1.0.10 Chrome/152.0.7977.130 Electron/44.4.5`
`/json/list` → 单页 `title:"学习空间 · 本地大观园"`，`url:"daguan://app/index.html?desktop=1"`

CDP 页面健康（4 秒 Runtime+Network 采集）：

```
readyState: "complete"      desktopBar: true        bodyChildren: 21
hasDaguanDesktop: true      stateSyncAvailable: true  stateSyncHydrated: true
appObject: "function"       stateRevision: 6 == serverRevision: 6
serverProgressKeys: ["1","2","3","99"]   serverAnnotations: ["1"]   serverFavorites: ["3"]
health: launcherKind "desktop", pid 47440, port 18083
console: 2 条，均为正常日志（"大观园新版 - 初始化"、"初始化完成"）
pageErrors: 0        failedRequests: 0
```

窗口与托盘（`Get-Process` + `EnumWindows`）：主窗口 PID 42912，标题 `学习空间 · 本地大观园`，handle 2623936，可见；`Electron_NotifyIconHostWindow` 存在 → **托盘图标已创建**。

关闭到托盘为**有意设计**（`electron-main.cjs:264`）：向主窗口发 `WM_CLOSE`(0x0010) 后应用不退出（5 个进程仍在、端口仍监听），随后主窗口枚举为 `visible:false`。

优雅退出：CDP 点击 `#daguan-desktop-bar [data-action="quit"]` → 原生对话框（class `#32770`，标题 `退出大观园`，可见）→ `SendKeys` 发送 `{TAB}{ENTER}` 选择"退出大观园"：

```
electron 进程数: 0
端口 18083 监听数: 0
锁文件存在: False      恢复文件存在: False
退出后数据完整: state.json 1355 B, revision 6, progressKeys [1,2,3,99]
              + study-activity.json, visit-history.json, ai-history/, cxyonly-backups/, question-bank/
```

**服务交接验证**：桌面版启动后，我先前用浏览器方式启动的服务进程（PID 45720）退出，锁文件切换为 `pid:47440, launcherKind:"desktop"`，端口保持 18083；桌面版 UI 随即读到我在浏览器服务里写入的 revision 6 数据 —— 端到端数据共享成立。

### E. 数据生命周期

```
优雅停止（POST /api/runtime/stop + 正确 Origin）→ 200 {"ok":true}
  随后：端口监听 0、PID 消失、锁文件删除、无恢复文件
重启后读取：revision 6，progressKeys [1,2,3,99]，批注 "## 笔记\n第一行"，收藏 ["3"]
实例锁：同目录起第二个实例 → SERVICE_INSTANCE_REUSED http://127.0.0.1:18083/index.html
  第二个进程退出，端口监听仍为 1，锁持有者仍为第一个 PID
死锁恢复（P0 崩溃后）：重启日志重新打印 SERVICE_INSTANCE_READY，instanceId 与 PID 均更新
  （47100 → 45936），死 PID 被自动回收，无需手工删锁
导出：source=local  → 200，Content-Disposition: attachment; filename=daguan-local-2026-10-01.json
      source=backup → 200，body 为字面量 null（从未写入过进度文档）
      source=android→ 500 {"ok":false,"code":null,"error":"Invalid time value"}   ← P1-01
      source=bogus  → 200（静默降级为本地状态）                                    ← P2-02
```

### F. 桌面版 / 浏览器版共用数据目录冲突

**静态分析结论**：两条启动路径都指向同一个目录，共用是设计意图，不是缺陷。

- 桌面版：`desktop/electron-main.cjs:37-38`
  `const base = process.env.LOCALAPPDATA || ...; return path.resolve(process.env.DAGUAN_DATA_DIR || path.join(base, "DaguanMath", "data"));`
- 浏览器单文件版：`packaging/sea-entry.cjs:23-24` `path.join(process.env.LOCALAPPDATA || os.homedir(), "DaguanMath")`，`:142` `const dataDir = path.join(root, "data")`，`:157` `process.env.DAGUAN_DATA_DIR = dataDir;`
- 命令行启动脚本：`scripts/start-windows.ps1:9` `$DataDir = Join-Path $env:LOCALAPPDATA "DaguanMath\data"`

即：**桌面版、浏览器单文件版、命令行启动脚本三者默认都读写 `%LOCALAPPDATA%\DaguanMath\data`**，靠 `.service-instance.json` 保证"同目录仅一个写入者"。

**实测模拟**（两个临时目录，全程未碰真实目录），直接调用真实的 `desktop/service-handoff.mjs`：

```
=== STEP 1: browser 启动器持有共享目录（端口 18086）===
owner: {pid:39096, port:18086, launcherKind:"browser", dataDir:"...\\fC\\DaguanMath\\data"}
=== STEP 2: 桌面版识别持有者 ===
classifyServiceOwner -> browser
=== STEP 3: 桌面版执行交接（stopBrowserService）===
handoff completed in 133 ms
browser 子进程退出: true  code: 0
锁文件仍在: false        端口仍监听: false
=== STEP 4: 反向——desktop 持有者不应被停掉 ===
classifyServiceOwner -> desktop   => 桌面版挂接（ownsService=false），不调用 stopBrowserService
desktop 启动器仍存活: true
health: {launcherKind:"desktop", pid:45136, port:18086}
=== STEP 5: 同目录第二个 desktop 启动器（端口 18087）===
2nd launcher exitCode: 0
日志: SERVICE_INSTANCE_REUSED http://127.0.0.1:18086/index.html
端口 18087 监听: false        锁持有者 PID 未变: true
```

**结论**：冲突场景处理正确且优雅——
- 浏览器版正在跑时打开桌面版：桌面版**优雅接管**（走 `/api/runtime/stop`，133 ms 完成，旧进程退出码 0，锁与端口干净移交），且**沿用同一端口**，浏览器已打开的页面刷新后即可继续用同一份数据。
- 桌面版正在跑时启动浏览器版：`packaging/sea-entry.cjs:143-147` 的 `findSharedService` 先做健康校验，命中存活持有者就**只打开对方 URL 然后自身退出**，不抢占、不双写。
- 同目录再起一个启动器：`SERVICE_INSTANCE_REUSED` 后退让，端口与锁均不变更。
- 真正会报错的是**不同数据目录 + 同端口**（P2-03），此时抛原始 `EADDRINUSE`，但实例锁被正确释放，不留脏锁。

### G. 退出与资源

```
我的全部 PID（22240/39588/39096/45136/42912/45720/47100/45936）：none alive
electron 进程数：0
端口监听：18083 → 0    18085 → 0    18086 → 0    18087 → 0
（18084 由另一子代理的进程 42928 持有，父进程 dg-audit-06\flow.mjs，未触碰）
仓库：tracked modified 0，untracked 26（含本审计目录），branch ## main...origin/main
真实 %LOCALAPPDATA%\DaguanMath\data：未被本次实测写入（state.json mtime 10:47、锁 mtime 09:00，均早于 12:40 开始的实测）
```

---

## 3) 未覆盖或未验证的环节及原因

| 环节 | 状态 | 原因 |
|---|---|---|
| `npm run desktop:start`（electron-forge start） | 未使用 | 为精确控制环境变量与 CDP 端口，直接用 `node_modules\electron\dist\electron.exe .` 启动同一主进程（`desktop/electron-main.cjs`）。forge 仅是同一二进制的外层包装，未验证的是 forge 的启动器本身，而非应用逻辑 |
| `npm run package:desktop:windows` / `package:browser:windows` 打包产物实测 | **未验证** | 打包耗时且会写入 `.build/`、`dist/` 产物目录；本次为只读诊断，未产出构建物 |
| Squirrel 真实安装/升级（`test/squirrel_update_e2e.py`） | **未验证（主动跳过）** | 该脚本会真实安装 Squirrel 0.9.0 并从本地 feed 升级到 0.9.1，属真实安装/更新操作，且依赖 Playwright。更新链路另有专项审计（`docs/desktop-audit-20261001/02-updater-packaging.md`） |
| 桌面版自动更新（检查/下载/重启安装） | **未验证** | 需要真实 GitHub Release feed 与已安装的 Squirrel 版本；本次为源码目录直启，`updater` 未处于可用状态 |
| `daguan:` 协议的 CSP 头断言（`test/desktop-csp-smoke.mjs`） | **未验证** | 需要 Playwright 且 `DAGUAN_PLAYWRIGHT_MODULE` 未配置；本机无 Playwright。已改用 CDP 采集 console/pageerror/requestfailed（0 错误），但**未断言 CSP 响应头** |
| cxyonly 官网集成（登录、pull/push/reconcile 的 preview/apply） | **未验证** | 需要真实的大观园官网账号与 token；本次仅验证了无需鉴权的 `status` 与 `export` 端点，其中 `source=android` 暴露出 P1-01 |
| AI 对话/AI 历史真实调用 | **未验证** | 需要真实模型 API Key；本次只验证了 `/api/ai/profiles` 可读与配置读写（后者正是 P1-02 的现场） |
| 前端交互细节（刷题、批注 UI、小屏布局、打印） | **部分未验证** | 无 Playwright，无法做交互断言；本次通过 CDP 确认页面加载完成、`daguanDesktop` 桥接可用、状态同步已 hydrate、0 页面错误，但未逐项走查 UI 行为 |
| 外网访问（Quick Tunnel / cloudflared） | 部分验证 | `test/remote-live-smoke.mjs` 跑通并验证了登录、双 UI、学习写入、批注、第二会话状态、AI 列表、下载与管理块；桌面版内的 Tunnel 管理 UI 未逐项点击 |
| `npm ci` 是否需要 | 未执行 | 依赖已就绪（`node_modules` 与 electron 完整），未重装以避免破坏现有环境 |
| 多显示器/DPI、深浅色主题、无障碍 | **未验证** | 超出本次全流程范围 |

---

## 4) 优化建议（按性价比排序）

1. **修 P0-01（`server.mjs:465` 的非终止 `return`）＋ 在 `route()` 的 catch 中加 `res.headersSent` 守卫。**
   改动约 3 行，收益是把"任意一次参数拼错就打死本地服务"降级为一条 400 响应。这是本次唯一能让整个应用下线的缺陷，优先级远高于其它项。

2. **修 P1-01（`sync-format.mjs:162`、`:198` 的时间戳解析）。**
   加一个同时兼容 ISO 字符串与数字毫秒的 `toIso()`，即可让安卓迁移导出从"必然 500"恢复为可用。请同时补一个"夹具使用 ISO 字符串 `updated_at`"的回归测试——否则这个 bug 会再次从测试缝隙里溜过去。

3. **修 P1-02（测试隔离：`test/ai-service.test.mjs:17,32`、`test/local-server.test.mjs:20` 显式传数据目录）。**
   否则 AGENTS.md 的隔离要求与 `npm test` 直接冲突：照文档做就红、不照做就污染仓库 `data/`。修完请在"设/不设 `DAGUAN_DATA_DIR`"两种条件下各跑一次全量确认 265 例全绿。

4. **统一错误语义（P2-01、P2-02）**：为 `body()` 解析失败/超限、未知 `source` 定义明确的 400/413，并保证错误响应只在 `res.headersSent === false` 时发送。这一条同时也是 P0-01 的纵深防御。

5. **为 `EADDRINUSE` 加中文提示（P2-03）**：在 `server.mjs:683-689` 已有的 `error` 挂点里分流，把英文堆栈换成"端口被占用，请关闭占用程序或改用其它端口"。仅在用户同时开开发态与已安装版时才会遇到，但体验落差很大。

6. **补齐端到端自动化**：把 Playwright（或至少 `DAGUAN_PLAYWRIGHT_MODULE`）纳入开发依赖，让 26 例 skip 与 `desktop-cdp-smoke`/`desktop-csp-smoke`/`desktop-lifecycle-smoke` 真正跑起来。当前"桌面版全流程"完全依赖人工 CDP + Win32 枚举，回归成本高、易漏。若不便引入 Playwright，至少把本次的 CDP 探测脚本（页面健康 + 优雅退出）固化成可重复运行的 `test/` 脚本。

7. **让桌面版具备服务自愈能力**：P0-01 暴露了一个更普遍的风险——本地服务进程一旦死亡，桌面版只会返回 503（`electron-main.cjs:130-139`），没有看门狗重启。建议为服务子进程加 `exit` 监听，在非用户退出场景下自动重连/重启，并给 UI 一个"本地服务已重启"的提示。

8. **`//package.json` 归一化（P3-01）**：低优先，顺手在路由前把重复斜杠折叠即可。

---

### 附：本次使用的探测脚本（均写在 `%TEMP%\dg-e2e-20261001\`，未进入仓库）

| 脚本 | 用途 |
|---|---|
| `probe.mjs` | 全端点 + 路径穿越批量探测 |
| `probe2.mjs` | 各类非法请求体（P0 崩溃的触发序列） |
| `probe3.mjs` | 超大请求体（经 Node fetch） |
| `probe4.mjs` | 500 后提前销毁 socket |
| `probe5.mjs` | 逐条请求 + 存活探测，二分定位崩溃触发点 |
| `lifecycle.mjs` / `lifecycle2.mjs` | 状态写入、revision、visit-history、export、批注 |
| `cdp-check.mjs` | 桌面版页面健康采集（Runtime + Network） |
| `click-quit.mjs` | 点击标题栏"退出"按钮，触发原生确认对话框 |
| `f-handoff.mjs` | 共用数据目录冲突模拟（调用真实 `desktop/service-handoff.mjs`） |
