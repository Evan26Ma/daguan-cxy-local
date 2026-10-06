# 09 · 同步扩展 / 远程访问 / 官网集成 审查报告

- 审查对象：`F:\AI\大观园本地`（分支 `main`，HEAD `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，`daguan-math-local` v1.0.10）
- 审查日期：2026-10-01
- 审查性质：**只读诊断**。未修改、未删除、未重命名任何仓库源码；未执行 `git reset`/`clean`/`stash`；未推送、未部署、未发布。唯一写入产物是本报告。
- 环境：Windows，Node v24.15.0，npm 11.12.1
- 隔离：所有实测服务使用 `DAGUAN_DATA_DIR=%TEMP%\dg-audit-09\data` + `PORT=18087`；**全程未读写真实 `%LOCALAPPDATA%\DaguanMath\data`**，未触碰真实桌面版进程（pid 6196 / port 5502 自始至终未被访问或停止）。
- 未登录任何真实官网账号，未向 `hsad.xyz` / `cxyonly.fans` 生产接口发起任何请求（相关链路只做静态分析与本地假上游拦截）。

## 证据分级说明（本次审计硬要求）

| 标记 | 含义 |
| --- | --- |
| **实测复现** | 在本机真实执行了命令并观察到原始输出，报告内给出命令与输出 |
| **静态确认** | 逐行读完相关源码后得出的确定性结论，未执行运行时验证；给出精确位置与推导链 |
| **未能验证** | 受权限/环境/合规约束无法验证，写明理由与所需条件 |

---

## 1. 审查范围与已读文件清单

| 文件 | 行数 | 已读范围 |
| --- | --- | --- |
| `local-server/sync-format.mjs` | 499 | 全文（重点 `:36-215`、`:420-499`） |
| `local-server/cxyonly-client.mjs` | 233 | 全文 |
| `local-server/store.mjs` | 89 | 全文 |
| `local-server/server.mjs` | 721 | `:1-360`、`:361-660`、`:583-642` |
| `local-server/official-question-bank.mjs` | — | 全文关键词扫描（`sync|updated_at|Date|mastery`，12 处命中，均与同步状态无关） |
| `desktop/remote-gateway.cjs` | 170 | 全文 |
| `desktop/cloudflare-tunnel.cjs` | 177 | `:1-45` 全文精读 + 全文关键词扫描 |
| `desktop/service-handoff.mjs` | 82 | 全文 |
| `desktop/electron-main.cjs` | — | `safeStorage` / `createTunnelManager` 相关行（`:1`、`:10`、`:316-322`） |
| `sync-extension/protocol.js` | 295 | 全文 |
| `sync-extension/background.js` | 120 | 全文 |
| `sync-extension/bridge.js` | 359 | 全文 |
| `sync-extension/manifest.json` | 18 | 全文 |
| `sync-extension/test/protocol.test.js` | — | 全文（通过） |
| `web/app-new.js` | 6302 | `:1330-1345`（`timestampOf`）、`:1208` 调用点 |
| `web/app-legacy.js` | 5949 | `:3795-3834`（迁移向导） |
| `web/app2.js` | 5685 | `:3502-3524` |
| `web/backup-migration.js` | 136 | `:8-14` + 全文关键词扫描 |
| `test/web-sync.test.mjs` | — | 全文（`updated_at` 相关行） |
| `test/backup-migration.test.mjs` | 75 | `:1-40` |
| `web/*.html` | — | 脚本引用扫描 |

### 已跑的定向测试（非全量 `npm test`）

```
$env:DAGUAN_DATA_DIR="$env:TEMP\dg-audit-09\data"; $env:PORT='18088'
node --test test/web-sync.test.mjs test/sync-extension/test/protocol.test.js \
  test/remote-gateway.test.mjs test/cloudflare-tunnel.test.mjs test/backup-migration.test.mjs
```

结果：`tests 15 / pass 15 / fail 0 / duration_ms 836.4125`。**注意：这 15 项全绿恰恰说明现有测试覆盖不到本报告 P0-01 与 P1-02**（见 §2 P3-07）。

### 端点清单核对（`local-server/server.mjs`）

任务描述里列出的 `/api/integrations/cxyonly/import` **不存在**。实际存在 12 个：`status:564`、`login:569`、`logout:570`、`pull/preview:571`、`pull/apply:572`、`push/preview:573`、`push/apply:574`、`reconcile/preview:575`、`reconcile/apply:579`、`export:583`。旧记录导入实际走 `POST /api/state/migrate`（`:524`）。

---

## 2. 发现清单

### P0-01 · 时间戳格式假设不一致导致同步链路整体抛错（`Invalid time value`）—— 实测复现

**位置**
- `local-server/sync-format.mjs:162` — `localToRemoteDocument()`
  ```js
  updated_at: new Date(Number(state.updated_at)).toISOString()
  ```
- `local-server/sync-format.mjs:198` — `localToAndroidDocument()`
  ```js
  updated_at: new Date(Number(state.updated_at)).toISOString()
  ```

**机制**

`state.updated_at` 在真实数据里**永远是 ISO 字符串**，共三处来源：
- `local-server/store.mjs:59`：`next.updated_at = new Date().toISOString();`
- `local-server/server.mjs:463`：`const at = incoming.updated_at || nowIso();` → `:477 entry.updated_at = at;`（`nowIso()` 返回 ISO）
- `web/app-new.js:1208`：前端主动发 `updated_at: new Date().toISOString()`

`Number("2026-10-01T05:06:12.823Z")` → `NaN` → `new Date(NaN).toISOString()` 抛 `RangeError: Invalid time value`。**两个函数对任何真实数据必然抛错，不存在侥幸路径。**

**证据 1（函数级，实测复现）**

```
$ node --input-type=module -e "import {localToRemoteDocument,localToAndroidDocument} from './local-server/sync-format.mjs'; ..."
android/iso  THROW RangeError: Invalid time value
remote/iso   THROW RangeError: Invalid time value
android/num  OK
remote/num   OK
```

**证据 2（HTTP 级，实测复现）** — 服务 pid 37240，端口 18087，临时数据目录：

```
== state 落盘形态（GET /api/integrations/cxyonly/export?source=local 输出片段）
  "mastery_updated_at": "2026-10-01T05:06:12.823Z"      <- ISO 字符串

== GET /api/integrations/cxyonly/export?source=local
HTTP 200  {"format":"daguan-local-state","version":3,"revision":4, ...}

== GET /api/integrations/cxyonly/export?source=android
HTTP 500
{
  "ok": false,
  "code": null,
  "error": "Invalid time value"
}
```

**影响面（比任务简报里的结论更大）**

任务简报只指出 `export?source=android` 失败。实际 `buildPushPlan` 也调用 `localToRemoteDocument`：

- `local-server/sync-format.mjs:464-466` — `buildPushPlan()` 内调用 `localToRemoteDocument(...)`
- 实测：`buildPushPlan THROW RangeError: Invalid time value`
- 调用者：`local-server/server.mjs:211`（`pushPreview` → `POST /api/integrations/cxyonly/push/preview`）、`local-server/server.mjs:222`（`applyPush` → `POST /api/integrations/cxyonly/push/apply`）

**即：只要本机存在任意一条带 ISO `updated_at` 的进度记录（这是主路径默认格式），「上传到官网」的预览与应用必然 500，上传功能对真实用户完全不可用。**

- **不受影响**：`buildReconcilePlan` 走的是 `sync-format.mjs:48-53` 的 `timestamp(value)`（number 直接返回；字符串走 `Date.parse`，失败返回 0），`normalizeLocalState` / `normalizeRemoteStates` 已经把 `updated_at` 归一成数字，因此 `:304-305` 的 `Math.max(current.masteryUpdatedAt, current.favoriteUpdatedAt)` 与 `incoming.updatedAt` 比较是数字对数字。实测 `reconcile OK`。

  **同一文件内并存三套时间戳处理**：正确的 `timestamp()`（`:48-53`）、错误的 `Number()`（`:162`、`:198`、`:438`），以及直接输出 ISO 的 `nowIso()`（`:5`）。这正是本 bug 的成因——`normalizeX` 走 `timestamp()`，而序列化函数却用了 `Number()`。
- **HTTP 级未复现 push 的 500**：需要真实官网 token 才会走到 `buildPushPlan`；按约束未登录真实账号。**函数级已复现，判定为实测复现。**

**修复建议**

把 `sync-format.mjs` 的时间戳归一函数替换为仓库内已存在两次的正确实现，或直接复用：

- `web/app-new.js:1334-1341` — `function timestampOf(value)`（number→原值；string→先 `Number` 再 `Date.parse`，失败返回 `0`）
- `web/backup-migration.js:8-13` — `function timestamp(value)`（同上，失败返回 `null`）

修完后 `:162` / `:198` 改为 `new Date(timestampOf(state.updated_at) || Date.now()).toISOString()`（或直接回退到 `nowIso()`），并补一条用 **ISO 字符串** 入参的 `buildPushPlan` / `localToAndroidDocument` 回归测试。

---

### P1-01 · `POST /api/state/migrate` 清空未提交字段，旧版迁移会抹掉批注与学习位置 —— 实测复现

**位置**：`local-server/server.mjs:524-531`

```js
const incoming = localStateShape(await body(req));     // :525  -> normalizeLocalState，缺字段一律补默认值
const merged = { ...current, ...incoming, ... };       // :528  -> 默认值覆盖 current
```

**机制**

`local-server/sync-format.mjs:77-93` 的 `normalizeLocalState()` 对缺失字段返回**默认值而非 undefined**：

| 字段 | 缺失时被补成 |
| --- | --- |
| `annotations` | `{}` |
| `last_study` | `null` |
| `local_activity` | `{}` |
| `remote_activity` | `null` |
| `remote_last_study` | `null` |
| `remote_seeded_at` | `null` |
| `pending_unknown_states` | `{}` |
| `pending_remote_operations` | `[]` |

这些默认值经 `...incoming` **整体覆盖 `current` 的同名字段**。只有 `progress` / `favorites` / `picked` / `revision` 被显式合并保留。

**证据（实测复现，pid 37240 / port 18087）**

```
PATCH /api/state/questions/101/annotation {"revision":4,"markdown":"审计批注"}   -> HTTP 200
PATCH /api/state/last-study {"revision":5,"category_id":"42","question_id":"101","mode":"single"} -> HTTP 200
before: annotations={"101":{"markdown":"审计批注","updated_at":"2026-10-01T05:10:07.205Z", ...}}
        last_study={"category_id":"42","question_id":"101","mode":"single"}

POST /api/state/migrate
     body: {"format":"daguan-android-progress","progress":{"202":{"mastery":"mastered"}},"favorites":[]}
after : annotations={}   last_study=null
```

**真实触发路径**

- `web/app-legacy.js:3821-3825`（旧版 UI `legacy.html` 的官网配置向导「迁移」步骤）
  ```js
  body: JSON.stringify({ progress: state.progress, favorites: [...state.favorites],
                         picked: [...state.picked], annotations: state.annotations }),
  ```
  **不发 `last_study`** → 每次走旧版迁移都会把服务端 `last_study` 清成 `null`，「继续学习」位置丢失。
- 同一路径还会清空 `remote_seeded_at`：`local-server/server.mjs:249-253` 在 `remote_seeded_at` 为空时判定 `firstRepair` 并令 `remoteAuthoritative: true`，**下一次 reconcile 会以官网为权威反向覆盖本机进度**。
- 还会清空 `pending_remote_operations`：本机对官网失败的待重传队列被静默丢弃。
- `web/app2.js:3510-3514` 是同款代码，但 `app2.js` 只被陈旧的 `web/index-old-backup.html:769` 加载，**当前无 UI 入口**（见 §4）。
- `web/app-new.js` 不调用该端点（全仓库仅 `app2.js` / `app-legacy.js` 两处调用）。

**与既有报告的区分**：`docs/desktop-audit-20261001/01-electron-security.md` 已报该端点「无鉴权、无 Origin 校验」（P1）与「无 revision 前置条件」（F-07 P3）。本条的**字段清空导致数据丢失**是新发现，与上述两条不重复，且修复方式不同。

**修复建议**

在 `server.mjs:528` 之前对每个可选字段做「仅当请求体显式提供时才覆盖」：

```js
const raw = await body(req);
const incoming = localStateShape(raw);
const merged = { ...current, ...incoming,
  ...Object.fromEntries(['annotations','last_study','local_activity','remote_activity',
    'remote_last_study','remote_seeded_at','pending_unknown_states','pending_remote_operations']
    .filter(k => !(k in raw)).map(k => [k, current[k]])) };
```

并补回归测试：先写批注 + last_study，再发最小 migrate 体，断言两者仍在。

---

### P1-02 · `buildPullMerge` 对 ISO 本地时间戳失效，官网旧状态覆盖本机新编辑 —— 实测复现（函数级）

**位置**：`local-server/sync-format.mjs:437-439`

```js
const remoteTime = Date.parse(remote.updated_at || "");
const localTime = Number(cur.updated_at || 0);          // <- ISO 串 -> NaN
const canUpdateMastery = !Number.isFinite(remoteTime) || !localTime || remoteTime >= localTime;
```

**机制**：本地 `updated_at` 是 ISO 字符串 → `Number()` → `NaN` → `!localTime === true` → `canUpdateMastery` 恒真 → **官网状态无条件覆盖本机，无论本机多新**。这与 P0-01 同族（同一文件内混用 `Number()` 与 `Date.parse`）。

**证据（实测复现）**

```
remote:  updated_at = '2026-09-01T00:00:00.000Z', mastery = needs_practice
local :  updated_at = '2026-09-29T12:00:00.000Z'(更新), mastery = mastered

ISO 本地(2026-09-29, 更新)     => changes: [{"question_id":"101","type":"mastery","value":"learning"}]  final mastery: learning   <- 错
numeric 本地(2026-09-29, 更新) => changes: []                                                        final mastery: mastered   <- 对
```

**影响**：`server.mjs:187-194` `pullPreview()` 生成错误计划 → `server.mjs:196-207` `applyPull()` 以 `writeState(..., { studyImport: true })` 落盘，静默覆盖用户较新的本机掌握度与「已掌握」标记。用户点一次「读取官网」就丢本机进度。

**修复建议**：同 P0-01，`localTime` 改用 `timestamp(cur.updated_at)`。

---

### P1-03 · 官网客户端全链路无超时，且 reconcile 全程持有全局写锁 —— 静态确认

**位置**

| 调用 | 位置 | 超时 |
| --- | --- | --- |
| `request()` 的 fetch | `local-server/cxyonly-client.mjs:49` | **无** |
| `refreshCsrf()` 的 fetch | `local-server/cxyonly-client.mjs:73` | **无** |
| `login()` 的 `/auth/login` | `local-server/cxyonly-client.mjs:94` | **无** |
| `login()` 的 `/auth/me` | `local-server/cxyonly-client.mjs:106` | **无** |

全文件搜索 `AbortSignal` / `timeout` **零命中**。对比同仓库其他网络调用，全部带超时：

- `desktop/cloudflare-tunnel.cjs:10`、`:28`、`:33` — `AbortSignal.timeout(20000/20000/120000)`
- `web/app-new.js:1209` — `signal: AbortSignal.timeout(timeoutMs)`
- `desktop/service-handoff.mjs:67` — `signal: AbortSignal.timeout(3000)`

即前端与桌面侧都遵守了「网络调用必须有超时」的约定，**只有 cxyonly 客户端例外**。

**放大效应（关键）**

`local-server/server.mjs:294` `applyReconcile` 把**整个远端交互**包在 `withLock` 里：

```js
return withLock(async () => {        // :294
  ...
  await client.patchState(operation); // :321-330 串行循环
  ...
  await client.fetchRemoteSnapshot()  // :341
});
```

而 `withLock`（`local-server/server.mjs:120-126`）同时串行化 `PUT /api/state`（`:443`）、`PATCH /api/state/questions/:id`（`:452`）、`/annotation`（`:491`）、`/last-study`（`:511`）、`POST /api/state/migrate`（`:526`）。

**后果**：官网接口挂起（TCP 黑洞、TLS 握手卡死、对方不回包）→ `withLock` 永不释放 → 该服务进程内**所有本地写入永久阻塞**，界面表现为「保存无反应」。当前没有任何超时或看门狗能解开。

**附带**：`fetchStates()`（`:141-162`）`per_page=200` 最多 200 页**串行**；`:147-149` 只重抛 `AUTH_EXPIRED`，其他错误被吞后仍会退化成最多 200 次分页请求；`:146` `if (direct.length) return direct` 对「用户真实 0 条状态」不短路，同样退化成全量分页。

**修复建议**：给 `cxyonly-client.mjs` 的所有 fetch 加 `signal: AbortSignal.timeout(15000)`（下载类另设）；把 `applyReconcile` 的远端交互移出 `withLock`，只把 `writeState` 包在锁内（先远端收集 → 再短临界区落盘）。

---

### P2-01 · remote-gateway 的 `BLOCKED` 过滤可被 `/daguan-math` 前缀绕过 —— 实测复现

**位置**
- `desktop/remote-gateway.cjs:8`：`const BLOCKED = new Set(['/api/runtime/stop', '/api/catalog/refresh']);`
- `desktop/remote-gateway.cjs:28-32` `blockedPath()`：只对 `normalizePath()` 结果做**精确/前缀**匹配
- `desktop/remote-gateway.cjs:143-144`：只挡精确 `'/service-worker.js'` 与精确 `'/api/state/events'`
- 上游 `local-server/server.mjs:357-358` 会**剥掉 `/daguan-math` 前缀后再路由**：
  ```js
  const subpath = "/daguan-math";
  const pathname = url.pathname === subpath ? "/" : url.pathname.startsWith(`${subpath}/`) ? url.pathname.slice(subpath.length) : url.pathname;
  ```
- 隧道 ingress（`desktop/cloudflare-tunnel.cjs:153`）为 `{ hostname, service: http://127.0.0.1:${port} }`，**不做路径重写**，因此 `/daguan-math/...` 可从公网 hostname 直达网关。

**证据（实测复现，探针 `%TEMP%\dg-audit-09\gw-probe.cjs`，本地假上游，无真实网络请求）**

```
login status 200 cookie? true
GET  /service-worker.js                            -> 404 {"error":"Unavailable remotely"}
GET  /daguan-math/service-worker.js                -> 200 UPSTREAM-OK /daguan-math/service-worker.js
GET  /api/state/events                             -> 404 {"error":"Use polling"}
GET  /daguan-math/api/state/events                 -> 200 UPSTREAM-OK /daguan-math/api/state/events
GET  /api/runtime/stop                             -> 403 {"error":"Forbidden"}
GET  /daguan-math/api/runtime/stop                 -> 200 UPSTREAM-OK /daguan-math/api/runtime/stop
GET  /api/tunnel/status                            -> 403 {"error":"Forbidden"}
GET  /daguan-math/api/tunnel/status                -> 200 UPSTREAM-OK /daguan-math/api/tunnel/status
POST /api/runtime/stop (sameOrigin)                -> 403 {"error":"Forbidden"}
POST /daguan-math/api/runtime/stop (sameOrigin)    -> 200 UPSTREAM-OK /daguan-math/api/runtime/stop
POST /daguan-math/api/catalog/refresh (sameOrigin) -> 200 UPSTREAM-OK /daguan-math/api/catalog/ref...
POST /daguan-math/__remote/status (sameOrigin)     -> 200 UPSTREAM-OK /daguan-math/__remote/status
```

**实际可利用性评估（重要，勿高估）**

| 被绕过的目标 | 是否真正可利用 | 原因 |
| --- | --- | --- |
| `POST /api/runtime/stop` | **否** | 上游 `server.mjs:359-363` 要求 `Origin === http://${HOST}:${PORT}` **且** remoteAddress 属本机。网关 `:142` 已强制非 GET 必须 `Origin === https://<publicHost>`，两者不可能同时满足 → 403。纵深防御生效。 |
| `POST /api/catalog/refresh` | **否** | 同上（非 GET 需 `sameOrigin`，上游另有本地来源判断） |
| `/api/tunnel/*`、`/api/remote/*`、`/api/admin/*` | **否（当前）** | 上游 `server.mjs` **根本没有这些路由**（`:359-595` 全量枚举确认），只会落到静态 404 |
| `/__remote/*`（非 login/logout/status） | **否** | 上游无 `/__remote/*` 路由 |
| `GET /daguan-math/service-worker.js` | **是** | 上游 `server.mjs:633` 会正常返回该文件，绕过 `:143` 的「远程不提供 SW」策略 |
| `GET /daguan-math/api/state/events`（quick 模式） | **是** | 上游 `server.mjs:424` 正常开 SSE，绕过 `:144` 的「quick 模式请用轮询」策略 |

**结论**：这是**纵深防御失效 / 设计意图绕过**（P2），**不是当前可利用的越权**。但它意味着网关的 `BLOCKED` 名单在当前部署下**完全不起作用**——一旦上游新增任何 `/api/tunnel`、`/api/admin`、`/api/runtime/*` 路由（例如后续给隧道管理加 HTTP 端点），远程已登录用户会立刻获得该管理面。前缀处理与路由剥壳是两套独立逻辑，任何一方新增都会破。

**修复建议**：网关侧对 `normalizePath()` 结果先剥掉已知挂载前缀（与上游共享同一个常量，勿各写一份），再做黑名单匹配；把黑名单从「精确集合」改为「前缀集合」；`service-worker.js` 与 `/api/state/events` 同样用前缀/后缀规则匹配而非精确相等。

---

### P2-02 · remote-gateway 全局失败计数可被单个攻击者锁死全部远程登录（DoS）—— 静态确认

**位置**：`desktop/remote-gateway.cjs:86-87`

```js
globalFailures += 1;
if (globalFailures >= 20) globalBlockedUntil = Date.now() + 15 * 60_000;
```

**机制**：`:77` 在**密码校验之前**检查 `globalBlockedUntil`，`:87` 一旦累计 20 次失败就设置 15 分钟**全局**封锁（不区分 IP）。任意攻击者（甚至不知密码的爬虫）对公网 hostname 发 20 次错密码，即可让**所有**远程用户 15 分钟内无法登录。`:93` 只有在登录成功时才重置 `globalFailures`。

**附带**：`:49` `attempts` Map 按 IP 累积，除 `:93` 成功登录与 `:155` 改密码外**没有任何清理**，攻击者用大量伪造 IP 可无界增长（受 `cf-connecting-ip` 可伪造性影响，见「未能验证」）。

**修复建议**：全局计数只作为软熔断（如指数退避 + 上限 60s），或改为「全局令牌桶」；给 `attempts` 加 TTL 清理（`setInterval` 或惰性淘汰）。

---

### P2-03 · `previews` Map 无清理机制，预览对象无界驻留内存 —— 静态确认

**位置**：`local-server/server.mjs:36` `const previews = new Map();`

写入：`:192`（pull）、`:213`（push）、`:270`（reconcile）。
删除：**仅在成功 apply 时** `:205`、`:237`、`:349`。

**机制**：过期判断只在 `apply` 时惰性检查（`:198`、`:219`、`:292` 的 `Date.now() - createdAt > 30 * 60 * 1000`）。用户点「预览」后直接关页面/刷新 → 该条目**永不删除**。每个条目持有完整的远端文档 + 合并后状态（6000+ 题量级，单条可达数 MB）。桌面版服务常驻数天，反复预览会持续吃内存。

**修复建议**：在 `previews.set()` 处顺手淘汰过期条目（遍历删除 `createdAt` 超过 30 分钟的项），或改为 `setTimeout(...).unref()` 定时删除。

---

### P2-04 · `cxyonly-backups` 备份目录无保留策略，随同步次数无限增长 —— 静态确认

**位置**：`local-server/store.mjs:71-77` `writeBackup()`

```js
const file = path.join(backupDir, `${prefix}-${stamp}.json`);
await writeJson(file, value);
```

全仓库无任何 `readdir(backupDir)` / `unlink` / 保留数量限制。写入点：

| 时机 | 位置 | 份数 |
| --- | --- | --- |
| reconcile 预览 | `local-server/server.mjs:247-248` | 2 |
| reconcile 应用 | `local-server/server.mjs:303-304` | 2 |
| push 应用 | `local-server/server.mjs:221` | 1 |

即**每轮官网对账至少新增 4 份全量状态快照**（文件名仅含时间戳，`prefix` 固定）。以 6000 题量级的状态文件估算，长期使用会在用户数据目录累积大量 JSON。

**修复建议**：`writeBackup` 内按 `prefix` 保留最近 N 份（如 10 份）并删除更早的；或对备份做 gzip。

**未统计真实目录大小**：按约束未读取真实 `%LOCALAPPDATA%\DaguanMath\data`。

---

### P2-05 · `applyPull` 绕过 `withLock` 且无 revision 前置，可与并发写入互相覆盖 —— 静态确认

**位置**：`local-server/server.mjs:196-207`

```js
await writeState(localStateShape(result.state), { studyImport: true });   // :200 未走 withLock
```

对比：`PUT /api/state`（`:443`）、`PATCH question`（`:452`）、`annotation`（`:491`）、`last-study`（`:511`）、`migrate`（`:526`）**都**走 `withLock`。而 `applyPull` 直接调 `writeState`（`local-server/server.mjs:128-136`，该函数自身不加锁），且不传 `expectedRevision`（`store.mjs:49-56` 的冲突检查因此被跳过）。

**机制**：`previewId` 对应的 `merged.state` 是预览时刻的快照。若在预览与 apply 之间（预览有效期 30 分钟）用户在本机做了 `PATCH`，apply 会用旧快照整体覆盖 → **并发写入静默丢失**，且 `revision` 会被重新递增，用户看不出异常。

**修复建议**：`applyPull` 改走 `withLock`，并把预览时读到的 `current.revision` 作为 `expectedRevision` 传入，冲突时返回 409 让用户重新预览。

---

### P2-06 · 官网 token 明文落盘，与隧道 token 的加密策略不一致 —— 静态确认

**位置**
- `local-server/cxyonly-client.mjs:114-124`：`await this.store.writeIntegration({ ..., token, ... })`
- `local-server/store.mjs:69`：`writeIntegration(value) { return writeJson(file, value); }`
- `local-server/store.mjs:28-34`：`writeJson(..., mode = 0o600)` → `fs.writeFile(temp, ..., { mode })`，`:33` 的 `chmod` **仅非 Windows 执行**

**机制**：Windows 上 `mode: 0o600` 只影响「只读」位，**不产生 POSIX 权限**，文件继承目录 ACL。因此官网 Bearer token 以**明文**存放在 `%LOCALAPPDATA%\DaguanMath\data\cxyonly-integration.json`，同机任意用户/任意进程可读。

**对比（同仓库已有正确做法）**：`desktop/electron-main.cjs:320-322` 给隧道令牌注入 `safeStorage`：

```js
encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，无法保存 Tunnel 令牌'); return safeStorage.encryptString(value); },
decrypt: bytes => safeStorage.decryptString(bytes),
```

即 `remote-tunnel.json` 的 token 走 DPAPI 加密，而官网 token 不加密。两处敏感凭据策略不一致。

**缓解**：`cxyonly-client.mjs:13-19` `redactSecrets()` 会在返回给前端前过滤 `token|password|secret|authorization|cookie` 键；`login()`（`:127`）只返回 `{ profile: safeProfile }`，**token 不会回传浏览器**（`server.mjs:569` 的展开对象里没有 token）。这一层做得对。

**修复建议**：用同一套 `safeStorage` 封装 `writeIntegration` / `readIntegration` 的 token 字段（或至少把整个 integration 文件加密），保持与隧道令牌一致。

---

### P3-01 · 扩展 `externally_connectable` 允许任意本机端口驱动扩展 —— 静态确认

**位置**
- `sync-extension/manifest.json`：`externally_connectable.matches: ["http://localhost:*/*","http://127.0.0.1:*/*"]`
- `sync-extension/background.js:4`：`const LOCAL_ORIGIN = /^(http:\/\/(localhost|127\.0\.0\.1):\d+)$/`
- `sync-extension/background.js:7-14` `isAllowedSender()`

**机制**：只校验 `sender.url` 的 origin 是否为本机任意端口。因此**任意本机端口的网页**（其他本地应用、被入侵的本地服务、其他工具的本地 UI）都能向扩展发消息，驱动 `bridge.js` 用用户已登录的真实官网 `localStorage` token 执行 pull/push（真实写请求）。扩展本身不区分调用方是否为「大观园数学」的服务。

**修复建议**：把允许的 origin 收窄为固定的 `http://127.0.0.1:8080`（浏览器版）或改为运行时由扩展校验上游 `/api/health` 的 `service === "daguan-local-console"`。

---

### P3-02 · 未配置集成时返回 HTTP 500 而非 4xx —— 实测复现

```
GET /api/integrations/cxyonly/export?source=remote      （无 token）
HTTP 500
{ "ok": false, "code": null, "error": "尚未配置大观园登录，请先完成配置向导" }
```

「未配置」是**正常的用户状态**，不是服务端错误。返回 500 会让前端无法区分「需要配置」与「服务崩溃」，也会污染错误监控。同类问题存在于所有 cxyonly 端点（`server.mjs:564-594` 统一走顶层错误处理）。

**修复建议**：给业务异常加 `error.status`（如 `local-server/cxyonly-client.mjs:38` 的 `throw new Error("尚未配置大观园登录，请先完成配置向导")` 补 `error.status = 409`），顶层处理器按 `error.status` 返回。

---

### P3-03 · 登出只清客户端 cookie，无服务端会话吊销 —— 静态确认

**位置**：`desktop/remote-gateway.cjs:132-135`

```js
if (p === '/__remote/logout' && req.method === 'POST') {
  if (!sameOrigin(req)) return json(res, 403, ...);
  return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Max-Age=0; ...` });
}
```

会话是**无状态 HMAC 令牌**（`:56-60`），登出只删浏览器 cookie。真正吊销只能靠 `revokeSessions()`（`:157`，轮换 `auth.secret`）或改密码（`:150-155`）。被窃取的 token 在 `SESSION_AGE = 30 天`（`:7`）内持续有效。

**评估**：这是无状态会话的常见取舍，风险有限（需要先窃取 cookie，且 cookie 为 `HttpOnly; Secure; SameSite=Lax`、host-only）。仅建议在设置页明确提示「登出后如需立即失效所有设备，请改访问密码」。

---

### P3-04 · `test/web-sync.test.mjs` 只用数字时间戳，P0-01 / P1-02 的 ISO 路径零覆盖 —— 实测复现

```
test/web-sync.test.mjs:30:  "1": { mastery: "mastered",  updated_at: 1720000000000 },
test/web-sync.test.mjs:31:  "2": { mastery: "forgot",    updated_at: 1720000001000 },
test/web-sync.test.mjs:32:  "3": { mastery: "learning",  updated_at: 1720000002000 },
```

这解释了为什么 `node --test test/web-sync.test.mjs` 全绿（15/15 pass）却漏掉了对真实数据必然抛错的 P0-01，以及 P1-02 的错误覆盖行为。**测试用的是生产环境不存在的格式。**

**修复建议**：把这三行改成 ISO 字符串（或参数化跑两遍 number / ISO），即可让现有测试直接捕获 P0-01 与 P1-02。

---

## 3. 复核通过项（独立复核结论）

| 模块 | 结论 |
| --- | --- |
| **会话固定** | 无漏洞。`desktop/remote-gateway.cjs:68-73` `sessionCookie()` 每次登录新建 `nonce` + HMAC，**不采纳**客户端既有 cookie；`validSession()`（`:51-61`）用 `timingSafeEqual`（`:11-14`）比对，且校验 `expiry` 上下界（`:58`） |
| **cookie 作用域** | 合理。`Path=/; HttpOnly; Secure; SameSite=Lax`，**无 `Domain`** → host-only，不会被同域子路径以外的站点携带 |
| **`sameOrigin()` host 比较** | 合理。`:62-67` 强制 `https:` 且 `url.host.toLowerCase() === publicHost`；`publicHost` 由 `setPublicHost()`（`:158`）统一小写。Host 头另有 `:127-128` 校验（不符返回 421） |
| **`normalizePath` 的 `..` 与 `\0`** | 合理。`:20-27` 拒绝 `\0`、`..` 段、`//`，并把 `\` 归一为 `/`。双重编码 `%252e%252e` 可过网关，但上游 `local-server/server.mjs:608-609` 有 `path.resolve` + `startsWith(staticRoot + path.sep)` 兜底，不可逃逸 |
| **限流 IP 来源** | **未使用 `X-Forwarded-For`**。`:78` 取 `cf-connecting-ip`，`:101` 在转发时**主动删除** `x-forwarded-for` / `x-forwarded-host` / `x-forwarded-proto`（防止上游误判来源）。比预想更严谨 |
| **`cloudflare-tunnel.cjs` 下载校验** | 通过。`:31-36`：资产名精确 `cloudflared-windows-amd64.exe`、`digest` 必须匹配 `^sha256:[a-f0-9]{64}$`、URL 必须为 `https://github.com/cloudflare/cloudflared/releases/download/` 前缀、字节数 ≥ 1,000,000 且 sha256 相符。`:10/28/33` 全部有 `AbortSignal.timeout` |
| **`cloudflare-tunnel.cjs` `privateHome` 隔离** | 通过。`:74-76` 以 `userData/cloudflared-home` 作为 `HOME`/`USERPROFILE`，避开用户 `~/.cloudflared/config.yaml`，避免读到个人 Cloudflare 配置 |
| **`cloudflare-tunnel.cjs` `stop()` 超时** | 通过。`:58-67` 4s 超时后 `kill()` |
| **`cloudflare-tunnel.cjs` 失败回滚** | 部分通过。`:142-171` 在 DNS/ingress 失败时删除已建 Tunnel 与 DNS 记录，删除失败会把残留 ID 拼进错误抛出。**残留缺口**：若 `save()`（`:158`）已成功而 `startNamed()`（`:158-159` 之后）失败，`config` 已存在 → 不触发回滚，会在 Cloudflare 侧留下已创建但未被本地记录管理的 Tunnel/DNS 记录（用户看到 error 状态）。建议把 `startNamed` 失败也纳入回滚或提供「重新连接/清理」按钮 |
| **`desktop/service-handoff.mjs`** | 通过。交接前依次校验：`apiProtocol` 匹配（`:55`）→ 实例锁 owner 未变（`:56`）→ 健康检查身份匹配（`:57-60`）→ PID 仍存活（`:61`）→ `POST /api/runtime/stop` 带正确 `Origin` 且 `AbortSignal.timeout(3000)`（`:63-68`）→ 轮询至多 20s 确认锁消失且 PID 消失（`:72-81`）。逻辑链完整。仅两点小注：`:30` 依赖 `powershell.exe` + `Get-CimInstance`，在受限语言模式或极简系统上会静默返回 `null`（归类为 `unknown` 并拒绝交接，安全侧倾斜，可接受）；`:62` 用 `owner.host` 拼 Origin，若锁内 `host` 与上游 `HOST` 环境变量写法不一致（`localhost` vs `127.0.0.1`）会得到 403，属边界脆弱点 |
| **`official-question-bank.mjs`** | 与同步无关。全文仅 `:226 synced_at: new Date().toISOString()`，无 `updated_at` / mastery 处理，**不属 P0-01 同族** |
| **`web/backup-migration.js`** | 正确。`:8-13` `timestamp()` 兼容 number 与 ISO（`Date.parse`），`:72-73`、`:94-95`、`:113-114`、`:124-125` 全部经它比较，无 P0-01 同族问题 |

---

## 4. 可安全删除 / 清理的遗留物

| 对象 | 位置 | 判定依据 | 建议 |
| --- | --- | --- | --- |
| `web/index-old-backup.html` | 仓库（未跟踪） | `web/app2.js` 的**唯一**加载者（`web/index-old-backup.html:769`）。已确认当前入口 `web/index.html:160` 加载 `app-new.js?v=131`、`web/legacy.html:798` 加载 `app-legacy.js?v=101`，均不引用 `app2.js`。该页是陈旧快照，但其内嵌的 `migrateSetupState`（`app2.js:3502-3524`）含 P1-01 的清字段代码，保留它会扩大误用面 | 与本域相关，可清理；但前端归属见 `04-frontend-ui.md`，请与那条一起决定 |
| `web/index-new-backup.html` | 仓库（未跟踪） | `:131` 加载 `app-new.js?v=90`（陈旧版本号，当前为 `v=131`）。`04-frontend-ui.md` 已报其 `ChoiceGrading` undefined | 同上 |
| `local-server/cxyonly-backups/` 内历史快照 | **用户数据目录**，非仓库 | `store.mjs:71-77` 无保留策略（P2-04），仅追加 | **不要手动删用户数据**；应改为代码内保留 N 份（P2-04 修复） |
| `data/cxyonly-progress.json` | 用户数据目录 | `server.mjs:587-588` `export?source=backup` 仍在读 | **不可删** |
| 仓库内备份/迁移遗留源码 | — | 全仓库搜索 `backup-migration|backupMigration` 标识符**零命中**；实现位于 `web/backup-migration.js`（前端，测试通过，在用） | **无可删项** |
| `previews` Map 的过期条目 | 运行时内存 | P2-03 | 需代码修复，非文件清理 |
| 本次审查临时目录 `%TEMP%\dg-audit-09\` | 系统临时目录 | 含 `data\`（临时数据目录）、`gw-probe.cjs`、`gw-probe-auth.json` | 可整目录删除；不影响仓库 |

**结论**：仓库内没有属于本审查域的「死代码/遗留源码」可删；可清理项集中在两个陈旧 HTML 快照（前端域）和本次审查的临时目录。

---

## 5. 最值得先做的 3 条优化

### ① 修掉 `sync-format.mjs` 的时间戳归一（P0-01 + P1-02），同时把 `test/web-sync.test.mjs` 的输入改成 ISO

**理由**：这是唯一一条**让整条官网同步链路对真实用户完全不可用**的缺陷，而且是本次审查中修复成本最低的一条——仓库里已有两份正确实现（`web/app-new.js:1334-1341`、`web/backup-migration.js:8-13`），照抄即可；`:162`、`:198`、`:438` 三处改完，`export?source=android`、`push/preview`、`push/apply`、`pull/apply` 一起恢复。更关键的是：`test/web-sync.test.mjs:30-32` 只要把三个数字换成 ISO 字符串，现有测试立刻变成回归护栏——否则同类 bug 会再次静默上线。**改动量：3 行源码 + 3 行测试。**

### ② 给 `cxyonly-client.mjs` 加超时，并把 `applyReconcile` 的远端交互移出 `withLock`（P1-03）

**理由**：P0-01 是「功能不可用」，这条是「**整个本地服务被远端拖死**」。当前设计让一个不受本机控制的第三方 HTTP 服务（`www.cxyonly.fans`）成为本地写锁的持有者——官网不回包，用户连改一道题的掌握度都存不下来，且没有超时可解开，只能杀进程。这是架构级风险，比任何单点 bug 都更难在用户侧定位（用户会以为「软件卡了」而不是「官网挂了」）。修复方向明确：所有 fetch 加 `AbortSignal.timeout(15000)`，临界区只留 `writeState`。

### ③ 修 `POST /api/state/migrate` 的字段清空（P1-01）

**理由**：这是本次唯一一条**已实测复现的静默数据丢失**。旧版 UI 用户走一次官网配置向导，批注和「继续学习」位置就没了，且因为 `remote_seeded_at` 同时被清空，下一次对账会以官网为权威**反向覆盖本机进度**——损失会持续扩大而不是一次性。触发路径是普通用户的正常操作（`legacy.html` 的配置向导），不是边界用法。修复只需在 `server.mjs:528` 前加「仅显式提供才覆盖」的过滤。

> 第 4 名（未进前三）：P2-01 的网关前缀绕过。它当前**不可利用**（上游恰好没有对应路由 + `Origin` 双重校验），但一旦后续给隧道管理加 HTTP 端点就会立刻变成可利用缺陷。建议在做隧道相关功能时顺手修，不必单独排期。

---

## 6. 合规确认

### 6.1 git status 复查（审查结束后）

```
$ cd F:\AI\大观园本地 && git status --short --branch
## main...origin/main
?? .zcodeignore
?? AGENTS.md
?? "docs/SignPath申请材料草稿.md"
?? docs/desktop-audit-20261001/
?? docs/ui-redesign/DEEPSEEK-HANDOFF-RESUME.md
?? docs/ui-redesign/DEEPSEEK-HANDOFF.md
?? docs/ui-redesign/DSH-DESIGN-HANDOFF.md
?? docs/ui-redesign/REMEDIATION-CONTROL.md
?? docs/ui-redesign/remediation-1-acceptance-2.md
?? docs/ui-redesign/remediation-1-acceptance-3.md
?? docs/ui-redesign/remediation-1-acceptance.md
?? docs/ui-redesign/remediation-1-feedback-to-codex.md
?? docs/ui-redesign/remediation-1-report.md
?? docs/ui-redesign/remediation-2-acceptance.md
?? docs/ui-redesign/stage-1-acceptance-guide.md
?? docs/ui-redesign/stage-1-acceptance.md
?? docs/ui-redesign/stage-1-report.md
?? docs/ui-redesign/stage-2-brief.md
?? docs/ui-redesign/stage-2-report.md
?? docs/ui-redesign/stage-3-report.md
?? docs/ui-redesign/stage-4-report.md
?? "docs/干净环境安装验证.md"
?? web/index-new-backup.html
?? web/index-old-backup.html
?? web/ui-preview/
?? "宣传视频使用介绍-临时.md"

$ git rev-parse HEAD
126266dfb4a476c6a6f1bbe9e26652ca2c247904
```

- **0 个已跟踪文件被修改**（`git status` 无 `M`/`A`/`D` 行）。
- HEAD 仍为 `126266dfb4a476c6a6f1bbe9e26652ca2c247904`，与审查开始时一致。
- 25 项未跟踪文件与审查前基线**逐条一致**，无新增（本报告写入的 `docs/desktop-audit-20261001/` 本就在未跟踪列表中，属目录内新增文件，不改变 git 状态行）。
- 未执行 `git reset` / `git clean` / `git stash`，未推送、未部署、未发布。

### 6.2 临时数据目录

- 唯一使用：`C:\Users\14666\AppData\Local\Temp\dg-audit-09\data`
- 该目录内生成的文件（全部由本次审查产生，非仓库内）：
  - `state.json`（663 B）
  - `.service-instance.json`（235 B）
  - `study-activity.json`（137 B）
  - `cxyonly-backups/`（空）、`ai-history/`（空）
- 探针脚本：`C:\Users\14666\AppData\Local\Temp\dg-audit-09\gw-probe.cjs`（3,701 B）、`gw-probe-auth.json`（269 B）
- **真实 `%LOCALAPPDATA%\DaguanMath\data` 全程未被读取或写入**。真实桌面版服务（pid 6196 / port 5502）自始至终未收到任何请求，其锁文件未被触碰。

### 6.3 已退出进程清单

| 进程 / Job | 说明 | 状态 |
| --- | --- | --- |
| **pid 37240** | 本次审查启动的 `node local-server/server.mjs`（`PORT=18087`，`DAGUAN_DATA_DIR=%TEMP%\dg-audit-09\data`）；`/api/health` 报告 `instanceId b6b07968-f4ce-401b-88c1-c4794ef0fca7` | **已退出**（`job_kill pwsh-449` 后确认进程列表中不再存在） |
| **job `pwsh-449`** | 承载上述服务的后台 job | **已取消** |
| 其余本次运行的 `node --test` / 探针进程 | `node --test test/web-sync.test.mjs ...`（15 项）与 `gw-probe.cjs` | **已自然退出**（前台执行，均已返回） |

**端口复检（审查结束后）**

```
$ Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 18087,18088 }
（无输出 —— 两个端口均无监听）

$ Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 5502 }
LocalPort OwningProcess
     5502          6196      <- 真实桌面版，未受影响
```

**未触碰的其他进程**：审查期间观察到同机存在其他审查子代理的进程（如 `node local-server/server.mjs` pid 19280 监听 8234、pid 41020，以及 pid 46032/424/40780/43928 的 `npm test` / `node --test` 进程）。**未对其中任何一个发起信号、请求或干预。**

### 6.4 网络与账号合规

- 未登录任何真实官网账号，未使用真实 token。
- 未向 `www.cxyonly.fans`、`hsad.xyz` 或任何生产接口发起请求；`cxyonly-client.mjs` 相关结论全部来自静态阅读 + 本地 `buildPushPlan` / `buildPullMerge` / `localTo*Document` 的**纯函数调用**。
- 网关探针 `gw-probe.cjs` 使用本地假上游（`127.0.0.1` 随机端口），**零外部网络请求**。
- 未消耗任何真实配额。

---

## 7. 未能验证项（附理由）

| 项 | 为何未能验证 | 验证所需条件 |
| --- | --- | --- |
| `cf-connecting-ip` 是否可被客户端伪造（决定 P2-02 的 `attempts` Map 能否被无界污染） | 需要真实的 Cloudflare 边缘行为：该头是否被边缘覆盖取决于 Cloudflare 的具体规则与隧道模式，本地无法仿真 | 一个已接入 Cloudflare Tunnel 的真实 hostname + 抓包 |
| `POST /api/integrations/cxyonly/push/preview` 的 HTTP 500 端到端 | 上游 `client.pushPreview()`（`cxyonly-client.mjs:212-215`）会**先**调 `pullDocument()` 发真实网络请求，无 token 时在到达 `buildPushPlan` 前就抛「尚未配置大观园登录」。按约束未登录真实账号 | 一个真实（或 mock 到网络层的）官网 token |
| 扩展 `bridge.js:22-27 getToken()` 依赖的 `localStorage` 键（`daguan_token` / `token`）是否仍是官网当前实现 | 需要登录真实官网查看其前端 | 真实官网账号 + 浏览器 |
| Cloudflare 命名隧道的端到端建立（DNS/ingress/`startNamed`） | 需要真实 Cloudflare 账号、API token、可写域名 | 真实 Cloudflare 账号 |
| `cxyonly-backups/` 的真实累积体积 | 约束禁止读取真实 `%LOCALAPPDATA%\DaguanMath\data` | 用户授权读取该目录 |
| 扩展 `background.js` 的 3 并发批量 PATCH 是否触发官网限速 | 需要真实官网 + 大量题目状态 | 真实账号 + 生产接口 |
| 网关「全局锁死 DoS」（P2-02）的实际效果 | 本地可仿真，但真实公网暴露面（是否有 Cloudflare WAF/限速前置）未知，测了也不代表生产行为 | 已部署的隧道 hostname |

---

## 8. 结论摘要

- **1 条 P0**：`sync-format.mjs:162/:198` 的 `Number(ISO)` 时间戳假设错误，导致 `export?source=android` 与**全部官网上传端点**对真实数据必然 500（实测复现）。同族缺陷在 `:438` 造成 `pull/apply` 静默用官网旧状态覆盖本机新编辑（实测复现）。
- **3 条 P1**：`POST /api/state/migrate` 清空未提交字段导致批注与学习位置丢失（实测复现）；cxyonly 客户端零超时 + reconcile 全程持锁导致本地写入可被永久阻塞；`buildPullMerge` 的 ISO 失效。
- **6 条 P2**：网关黑名单被 `/daguan-math` 前缀绕过（实测复现，当前不可利用但纵深防御已失效）；网关全局登录 DoS；`previews` 无界内存；备份无保留策略；`applyPull` 绕过锁与 revision 检查；官网 token 明文落盘。
- **4 条 P3**：扩展允许任意本机端口驱动；未配置集成返回 500；登出无服务端吊销；测试只用数字时间戳导致 P0-01 零覆盖。
- **复核通过**：remote-gateway 的会话固定/限流 IP 来源/cookie 作用域/`normalizePath`、cloudflare-tunnel 的下载校验与 `privateHome` 隔离、`service-handoff.mjs` 的交接身份链。预想中的「`X-Forwarded-For` 伪造」「cookie 作用域过宽」「scrypt/HMAC 会话缺陷」**均未发现**。
