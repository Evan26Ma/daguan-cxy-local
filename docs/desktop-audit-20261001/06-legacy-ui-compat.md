# 06 · 旧版界面与新旧兼容层审查（只读）

- 审查对象：`F:\AI\大观园本地`（正本 checkout，分支 `main`，HEAD=`126266d`，package.json v1.0.10）
- 审查日期：2026-10-01
- 审查性质：**只读**。未修改/删除/移动/重命名任何仓库源码，未执行 `git reset/clean/stash`，未推送。
- 本次唯一写入：本文件。
- 方法：静态交叉引用（grep/脚本比对）+ Playwright 真实浏览器主流程（`%TEMP%\dg-audit-06\`）+ 既有测试真实运行。
- 隔离：服务端口 `18084`，`DAGUAN_DATA_DIR` 一律指向 `%TEMP%\dg-audit-06\data*`，**未读写真实 `%LOCALAPPDATA%\DaguanMath\data`**；截图与脚本全部放 `%TEMP%`，未进仓库；每次运行结束服务 `exitCode 0`、浏览器已关闭。

---

## 0) 结论摘要

1. **旧界面仍然可用**，不是死代码。`web/legacy.html` + `web/app-legacy.js` 依赖完整：无 404、无 `pageerror`、控制台仅 1 条「Service Worker 被 Playwright 拦截」提示；实测可完成「侧栏 → 章节导航弹层下钻 → 题目列表 → 显示答案/标记已掌握」并真实写入进度。
2. **新旧数据双向兼容良好**：旧格式（数字 ms 时间戳）进新版会被就地规范化且不丢字段；新版写的 ISO 格式回旧版也能读，两版共用 12 个 localStorage 键（进度/收藏/批注/学习位置等）。
3. **兼容层存在一处真实逻辑缺陷（L-01）**：`?ui=new` 这类显式覆盖会被 `ui-version.js` 吃掉 —— 只要存储偏好是 `old`，`/index.html?ui=new` 仍然跳去旧版。根因是**三个重定向权威并存**。生产代码没有链接使用 `?ui`，所以**不构成 P0**，但它使覆盖语义失效，且是所有测试/调试入口的公共依赖。
4. **没有发现 P0**；最严重为 P2（L-01 覆盖失效、L-02 旧版沉浸态下无界面切换入口、L-04 `npm test` 在装好 Playwright 后会变红）。
5. 遗留文件（`app2.js`、`styles.css`、`index-*-backup.html`、`ui-preview/`）**在生产路径上已无引用**，可安全删除，但删前需同步改 `service-worker.js` 与 4 个测试文件（见第 3 节）。
6. 桌面版主进程**永远先加载 `index.html`**，从不直接加载 `legacy.html`；旧版只能由页面内切换进入。

---

## 1) 发现清单

### L-01 · P2 · `?ui=new` 显式覆盖被 `ui-version.js` 吃掉（三个重定向权威并存）

**证据**

`web/ui-version.js:196-203`：

```js
const current = root.location.pathname.endsWith("/legacy.html") ? "old" : "new";
...
migrate(localStorage);
if (current === "old") localStorage.setItem(selectionKey, "old");
else if (selected(localStorage) === "old") root.location.replace(targetUrl(location.href, "old"));
```

该分支**只看存储偏好，完全不读 `?ui`**；而它在 `web/index.html:18` 加载，早于同样做判断的 `web/ui-bootstrap.js`（`index.html:19`）：

```js
// web/ui-bootstrap.js:16-17
if (requestedUi === "old" || (preference === "old" && !requestedUi)) window.location.replace("./legacy.html" + window.location.search);
```

`web/app-new.js:3558-3567` 是第三个权威（defer 执行，同样读 `?ui`）。

实测矩阵（`%TEMP%\dg-audit-06\flow2.mjs`，每个 case 独立 browser context，`serviceWorkers:'block'`）：

| case | 种子 `daguan_ui_version_v1` | 访问 | 结果 |
|---|---|---|---|
| A | 无 | `/index.html?ui=new` | 停在 `/index.html?ui=new`，uiVersion=new ✅ |
| B | `old` | `/index.html?ui=new` | **`/legacy.html?ui=new`**，storage 仍 `old` ❌ |
| C | `old` | `/index.html` | `/legacy.html` ✅（预期行为） |
| D | `new` | `/legacy.html` | 停在旧版并把 storage 改写为 `old` ✅ |
| G | 同 context 两步：先 `goto /legacy.html`（写 storage=old），再 `goto /index.html?ui=new` | | **`/legacy.html?ui=new`** ❌（用户真实路径复现） |

**影响**

- `?ui=new` / `?ui=old` 的显式覆盖在「用户曾用过旧版」的 profile 上失效。
- 受影响入口（全部为测试/调试路径，生产无引用）：`test/ai-ui-browser.test.mjs:36,62,94,109`、`test/answer-scroll-browser.test.mjs:50`、`test/choice-ui-browser.test.mjs:34`、`test/font-scale-browser.test.mjs:50`、`test/study-report-browser.test.mjs:40`、`test/visibility-browser.test.mjs:72`、`tools/desktop-cdp-smoke.mjs:81`、`tools/desktop-csp-smoke.mjs:26`（`daguan://app/index.html?desktop=1&ui=new`）。在带持久 profile 的桌面上跑 CSP/冒烟脚本时，可能实际测的是旧页面。
- 三个权威并存本身是后续维护的隐患：任何新增入口/参数都要同时照顾三处。

**复现**

```powershell
$env:TEMP\dg-audit-06> node flow2.mjs   # case B / G
```

**修复建议**（择一，按推荐度排序）

1. 把「选哪套界面」收敛成唯一权威：让 `ui-version.js` 也读 `?ui`，并删除 `ui-bootstrap.js:16-17` 与 `app-new.js:3558-3567` 的重复跳转，只保留一处判定 + 一处写存储。
2. 最小改动：在 `ui-version.js:202` 的 `else if` 前加 `?ui` 短路（`if (params.get("ui") === "new") return;`），并让 `ui-bootstrap.js` 在 `requestedUi === "new"` 时同时清掉存储里的 `old`。

**验证方式**：`node --test test/dual-ui.test.mjs`（现有用例「显式 old 入口被记住」仍应通过）+ 重跑 `flow2.mjs` 的 B/G 两 case，期望停留在 `/index.html?ui=new`。

---

### L-02 · P2 · 新版单题（沉浸）态切到旧版后，旧版里没有界面切换入口

**证据**

`flow3.mjs`：新版进入单题态 → 点 `#btn-switch-legacy` → 落到 `/legacy.html?ui=new`，题目/位置保留成功（面包屑「高等数学 / 极限 / 函数 / 求函数表达式 · 11 题」，qid=3356，11 张卡）。但此时 `#btn-switch-new` 不可见，`page.click` 报 `Timeout 30000ms exceeded`。

`probe-switch2.mjs` 诊断：

```
document.body.className === "focus-mode"
祖先 header.topbar.learning-shell__topbar  computed display:none
#btn-switch-new  rect w=0 h=0
```

原因：切换前的界面模式经共享键 `daguan_local_mode_v1` 带到旧版（`web/app-legacy.js` 读取该键进入 focus 模式），旧版把整个顶栏隐藏，切换按钮随之消失。

用 JS 强制点隐藏按钮可正常切回：`/index.html?ui=new&uiSwitch=1`，uiVersion=new —— **切换函数本身正确，问题是入口不可达**。

**影响**：用户在新版沉浸刷题时点「切旧版」，进入的旧版没有可见的「切新版」按钮；只能先退出沉浸模式。不是死锁（旧版有退出沉浸的入口），但违反「切换随时可用」的直觉。

**复现**：`node probe-switch2.mjs`（脚本内已固定路径）；或手动：新版进单题 → 切旧版 → 顶栏消失。

**修复建议**：`setUiVersion()` 跳转前把模式键 `daguan_local_mode_v1` 重置为默认（或带 `uiSwitch=1` 时强制退出 focus 模式），使目标页面一定回到常规布局；或在旧版 focus 模式里补一个浮动的「切新版」入口。

**验证方式**：`flow3.mjs` 期望切换后 `#btn-switch-new` 可见；`node --test test/dual-ui.test.mjs`。

---

### L-03 · P3 · 切回新版后 URL 残留 `?ui=new`

**证据**：`flow3.mjs` 从旧版强制切回新版，落地 URL 为 `/index.html?ui=new&uiSwitch=1`。`web/app-legacy.js:5913` 只 `history.replaceState` 去掉了 `uiSwitch`，`?ui=new` 被保留（`ui-version.js:52-57` 的 `targetUrl` 明确保留 search）。

**影响**：URL 语义污染；与 L-01 叠加时，`?ui=new` 会被带到下一次导航。数据无损失。

**修复建议**：切换时由 `targetUrl` 生成「干净的」目标 URL（只保留与学习位置恢复相关的参数，或统一改用 `uiSwitch=1` 一个参数），落地页在 `replaceState` 时一并清理。

**验证方式**：`test/dual-ui.test.mjs` 用例「切换 URL 保留前缀+query+hash 并标记恢复」——注意该用例**要求保留 query**，修 URL 语义时需同步调整此断言。

---

### L-04 · P2 · 6 个浏览器测试失败：`networkidle` 与常驻 SSE 冲突（`npm test` 潜在变红）

**证据**（真实输出，`%TEMP%\dg-audit-06\browser-tests.txt`）

```
node --test test/choice-ui-browser.test.mjs test/font-scale-browser.test.mjs \
          test/study-report-browser.test.mjs test/visibility-browser.test.mjs
→ exit=1 ；choice-ui 14/14 通过，visibility 1/1 通过；失败 6 条：
  font-scale-browser  「选择 150% 字号后，目录切换、进入题目和刷新均保留字号」 31044ms
  study-report-browser 5 条（new/single、new/multi、old/single、old/multi、首页范围…）
    全部 page.waitForLoadState: Timeout 30000ms exceeded
```

根因：`test/font-scale-browser.test.mjs:51` 与 `test/study-report-browser.test.mjs:41` 在 `page.goto` 后执行 `await page.waitForLoadState('networkidle')`，而应用常驻 SSE（`/api/state/events`、`/api/study-activity/events`）使网络**永不 idle**。正确做法见 `test/ai-ui-browser.test.mjs:36`：

```js
await page.route('**/api/state/events', route => route.abort());
```

`test/study-report-browser.test.mjs:90` 只对第二个页面 abort 了 `**/api/study-activity/events`，首个页面（`:40-41`）没有。

**影响**：`package.json` 的 `npm test` **包含**这两个文件 → 一旦环境里能解析到 Playwright（本机需 `DAGUAN_PLAYWRIGHT_MODULE`），`npm test` 直接变红；不设该变量时两文件因 `skip=!playwright` 静默跳过，问题被掩盖。**注意：这是测试用例缺陷，不是产品缺陷。**

**复现**：

```powershell
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
node --test test/font-scale-browser.test.mjs
```

**修复建议**：把 `waitForLoadState('networkidle')` 改为 `waitForLoadState('domcontentloaded')` + 显式等待目标元素，或统一在 goto 前 abort `/api/state/events`（与 `ai-ui-browser.test.mjs` 一致）。

**验证方式**：重跑上述四文件，期望 `fail 0`。

---

### L-05 · P3 · 旧版 5 处无条件调试全局残留

**证据**：`web/app-legacy.js` 是 `(() => { "use strict"; … init(); })();` IIFE，有意暴露的全局仅 `window.DaguanDesktopSwitch`(`:5931`)、`window.DaguanBrowserMigration`(`:5932`)；另有：

- `:2111` `window.__fraw`（**存响应体前 120 字符**）
- `:2117` `window.__ferr`
- `:2160`、`:2174` `window.__fdbg`
- `:2207` `window.__fclick`

均无开发环境守卫。

**影响**：污染全局命名空间；`:2111` 把服务响应片段挂到 `window`，虽为本地数据，仍是不必要的暴露面。无功能影响。

**修复建议**：删除，或用 `if (location.search.includes("debug=1"))` 之类条件包住。

**验证方式**：`node --test test/ui-contract.test.mjs`（可顺带加一条 `assert.doesNotMatch(legacySource, /window\.__f/)` 防回归）。

---

### L-06 · P3 · 旧版 `innerHTML` 未转义插值（`app-legacy.js:2092`）

**证据**：

```js
lab.innerHTML = `<input type="checkbox" data-dim="${dim}" data-name="${o.name}"${checked} /><span>${o.name}</span><small>${o.count}</small>`;
```

`dim` / `o.name` 未转义。同文件 `:2346-2352` 已定义 `escapeHtml`，`:2310-2311`（侧栏标签）与 `:2980/:3058`（选项）都做了转义 —— 说明是**遗漏而非设计**。

**影响**：数据来源是本地题库 facets（`data/annotations.json` 等），非用户输入，实际可利用性低；但名称含 `"` 会直接破坏属性结构，含标签会被解析。

**修复建议**：`dim`/`o.name`/`o.count` 统一过 `escapeHtml`。

**验证方式**：静态即可；加一条 ui-contract 断言禁止裸 `${o.name}` 模板。

---

### L-07 · P3 · 旧版 6 个 class 在任何已加载 CSS 中都没有定义

**证据**（脚本 `%TEMP%\dg-audit-06\csscheck.mjs`，按各页**实际加载**的 CSS 集合计算）

| class | 位置 | 定义在哪 |
|---|---|---|
| `hero-learning` | `web/legacy.html:180` | 全仓库无处定义 |
| `learning-shell__chapter-shortcuts` | `web/legacy.html:59` | 全仓库无处定义 |
| `local-service-status` | `web/legacy.html:386` | 仅在**未加载**的 `styles-new.css` |
| `appearance-sheet` | `web/legacy.html:722` | 仅在**未加载**的 `styles.css` |
| `appearance-file` | `web/legacy.html:756` | 无定义 |
| `learning-shell__brand` | `web/legacy.html:50` | 定义在 `legacy.css`（+`styles.css`），此处无实际样式效果 |

新版页：0 个未定义。

**影响**：旧版页面是从「`styles.css` 时代」改写而来，残留了属于新版/旧壳的类名。功能无影响，但说明 `legacy.html` 与 `legacy.css` 存在未清理的耦合，也解释了「为什么 `styles.css` 看起来还像在用」。

**修复建议**：删除或改名为 `legacy.css` 里真实存在的类；`local-service-status` 若需要样式，应在 `legacy.css` 中补上。

---

### L-08 · P3 · 旧版侧栏只渲染两层，深层章节必须走「章节导航」弹层

**证据**：`web/app-legacy.js:2292`

```js
const hasKids = root && children.length > 0;   // root = (depth === 0)
```

实测：`.cat-row` 共 28 个（只到二级）；点「（一）极限」（`data-cat-id=321`）→ 进入 `view-browse`，提示「选择最末级小节开始刷题」，`#q-feed` 为空；真正进题路径是 `openCategory`(`:2521-2572`) → `openChapterMenu`(`:1710-1724`) 弹出 `#chapter-menu`，逐列下钻「极限 → 函数 57 → 求函数表达式 11」后才出现 11 张题卡。

**影响**：不是 bug（设计如此），但**侧栏看不到第三层及以下**，且浏览视图的提示不告诉用户「点这里会弹章节导航」。首次使用者容易认为「点了没反应」。

**修复建议**：把提示文案改成明确指引（如「继续选择小节：将弹出章节导航」），或在侧栏允许展开第三层。

---

### L-09 · P3 · Service Worker 预缓存约 430KB 死资产

**证据**：`web/service-worker.js:2-40` 的 `SHELL` 含 `./styles.css?v=89`(`:20`) 与 `./app2.js?v=91`(`:21`)，而 `web/index.html` 与 `web/legacy.html` **都不引用**这两个文件（`test/ui-contract.test.mjs:145`、`:209` 明确断言两页都不含 `app2.js`）。同文件还同时缓存了 `./design-tokens.css?v=2`(`:6`) 与 `?v=3`(`:7`) 两个版本。

**影响**：每次 Service Worker 安装/更新白下载、白存储约 430KB（`styles.css` 179799 B + `app2.js` 249665 B）。

**修复建议**：从 `SHELL` 移除 `app2.js`、`styles.css`、旧版 `design-tokens.css?v=2`；若要保留离线壳能力，改为按需运行时缓存。

---

### L-10 · P3 · 界面字号设置不互通（旧版无此功能）

**证据**：`--ui-font-scale` 只被 `styles-new.css` 与 `study-report.css` 消费，`legacy.css` 中 0 处；`web/app-new.js:122` `UI_FONT_SCALES=[1,1.15,1.3,1.5]`、`:171` `root.style.setProperty('--ui-font-scale', …)`；`:1800` 的用户文案已明说「只影响这台设备的新版界面」。

**影响**：符合当前设计（文案已声明），不算 bug；但用户从新版切到旧版会「字号变回去」，需在验收文档里作为已知差异登记。

**修复建议**：要么在旧版补 `--ui-font-scale` 消费，要么在旧版切换入口处提示该差异。

---

### L-11 · P3 · 窄窗口下旧版「切新版」按钮被滚出视口

**证据**：`probe-switch.mjs` —— 全新加载 `legacy.html`：W=1320/1600 时 `#btn-switch-new` rect 65×35 @ y=14（可见）；W=1024/800 时 y=-7（页面自动下滚约 21px），Playwright 仍判为 visible。

**影响**：桌面版 `minWidth:900`（`desktop/electron-main.cjs:254`），900–1024 宽度区间可能出现按钮被顶出视口顶部的情况；影响轻微（用户可滚动）。

**修复建议**：顶栏 `position: sticky`，或恢复学习位置后不自动滚动顶栏。

---

### L-12 · P3 · 桌面托盘切换界面在函数缺失时静默失败

**证据**：`desktop/electron-main.cjs:152-161`

```js
const method = currentPageIsLegacy ? "window.DaguanDesktopSwitch" : "window.App&&window.App.setUiVersion.bind(window.App)";
return await mainWindow.webContents.executeJavaScript("(async()=>{const switcher=" + method + ";if(typeof switcher!==\"function\")return false;await switcher(" + JSON.stringify(target) + ");return true})()", true);
```

页面脚本尚未就绪（或抛错）时 `switcher` 不是函数，`switchUi` 返回 `false`，**调用方没有给用户任何提示**。`switchUi` 的返回值在 `:339`（IPC `action==="switch"`）与 `:236-237`（托盘菜单）处被忽略。

**影响**：偶发「点托盘『新版学习区』没反应」。`:154` 已用 `did-finish-load` 缓解了「正在加载」的情况，所以概率低。

**修复建议**：`switchUi` 返回 false 时向窗口发送一次性 toast/通知，或重试一次。

---

### L-13 · P3 · 旧版 7 处死元素引用（null 守卫，静默失效）

| 选择器 | 引用位置 | 说明 |
|---|---|---|
| `#pick-bar` | `web/app-legacy.js:178` | `pickBar: $("#pick-bar")`，HTML 无、从未动态创建 |
| `#pick-count` | `web/app-legacy.js:523` | 同上 |
| `#sync-empty-hint` | `web/app-legacy.js:4517-4518` | `if (hint) hint.hidden = !empty` 永不生效 |
| `#btn-copy-script` | `web/app-legacy.js:4519-4520` | `if (copyBtn) copyBtn.disabled = empty` 永不生效 |
| `#setup-feedback` | `web/app-legacy.js:3728` | HTML 里只有 `#shortcut-feedback`，疑似改名漏改 |
| `#feed-sentinel` | `web/app-legacy.js:2718-2722` | 动态创建（非死引用） |
| `#legacy-cloudflare-link-slot` | `web/app-legacy.js:3576` | 依赖 `#cloudflare-dashboard-link` template |

静态比对：`legacy.html` 有 290 个 `id`，`app-legacy.js` 有 295 处 `$("#id")`，其中 68 个 id 不在 HTML 中；**绝大多数**是运行时动态创建（`feature-*`、`legacy-remote-*`、`legacy-sync-*`、`legacy-guide-*`、`legacy-domain-*`、`legacy-token-*`、`legacy-usage-*`），上表是逐一确认后剩余的真正失效项。

**影响**：这些功能（选题栏计数、同步空态提示、复制脚本按钮禁用、设置反馈）在旧版里静默不工作。属真实缺陷但影响面小。

**修复建议**：逐个确认是有意废弃还是漏改；废弃的删代码，漏改的补元素。至少修 `#setup-feedback`（疑似改名漏改）。

---

## 2) 新旧界面功能对照表

| 功能点 | 旧版 | 新版 | 是否一致 |
|---|---|---|---|
| 入口文件 | `web/legacy.html` + `web/app-legacy.js?v=101` | `web/index.html` + `web/app-new.js?v=131` | 两套独立入口 |
| 目录浏览 / 深层下钻 | 侧栏仅两层（`app-legacy.js:2292`）+ `#chapter-menu` 弹层多列下钻 | `.directory-column` / `.directory-column-item` 原地多列下钻 | 功能等价，交互不同 |
| 题目列表 | `#q-feed .q-card`（实测 11 张） | `.question-card` 等 | 一致（均可达） |
| 单题 / 连续模式 | focus 模式，键 `daguan_local_mode_v1` | 单题/连续，同一键 | 一致（模式跨版本传递） |
| 显示答案 / 掌握度三态 / 易错 | 卡片级按钮 + 单题控件 | `.mastery-btn.question-mastery-choice`（未开始/学习中/已掌握）、`.mastery-btn.question-mistake-toggle` | 一致 |
| 选择题作答（单选/多选） | `test/choice-ui-browser.test.mjs` 14/14 通过（含改选、收藏、易错、500/409 重试、离线补同步） | 同 | 一致 |
| 收藏 / 批注 | 共享键 `daguan_local_favorites_v1`、`daguan_question_annotations_v1` | 同 | 一致 |
| 学习位置跨界面 | `saveLearningPosition(true)` + `uiSwitch=1` 恢复同题 | `restoreFromServerPosition/restoreFromSessionPosition` | 一致（实测 qid 3356 保留） |
| 进度数据格式 | 数字 ms 时间戳 | ISO 字符串；**双向可读** | 一致（实测互通，无丢字段） |
| 主题 / 外观 | `daguan_ui_appearance_old_v1` | `daguan_ui_appearance_new_v1` | **键分开**（设计如此，含一次性迁移） |
| 界面字号 | 无 | 4 档 `--ui-font-scale`（`app-new.js:122`） | **不一致**（新版独有，见 L-10） |
| 界面版本切换入口 | 顶栏 `#btn-switch-new`（沉浸态被隐藏，见 L-02） | 顶栏 `#btn-switch-legacy`（`index.html:35`） | 基本一致 |
| 学习报告 | 无 | `study-report.js` + `study-report.css` | **新版独有** |
| 官网同步 / 待同步日志 | 共享 `daguan_pending_*`、`DaguanPendingSync` | 同 | 一致 |
| AI 助手 / 抽屉 | `ai-panel-layout.js?v=1` | `ai-panel-layout.js?v=3` | 各自实现，版本号不同 |
| 欢迎引导 | `showLegacyWelcomeOnce()`（`app-legacy.js:5905`，键 `daguan_welcome_once_v2`） | 未验证 | 未验证 |
| 快捷键 | 有 | 有 | 未逐项比对 |
| 离线 / Service Worker | 两页都在 `SHELL` 里，导航 network-first，失败回退 `legacy.html` | 同（回退 `index.html`） | 一致 |

---

## 3) 可安全删除的遗留文件清单

| 文件 | 体积 | 引用关系证据 | 删除是否安全 |
|---|---|---|---|
| `web/index-old-backup.html` | 66856 B | 仅它自己引用 `styles.css:13`、`app2.js:769`；无任何生产/测试引用 | ✅ 安全（未被跟踪） |
| `web/index-new-backup.html` | 5298 B | 无生产引用；`test/electron-security.test.mjs:69` 断言打包时应排除它 | ✅ 安全 |
| `web/ui-preview/` | — | 无生产引用；`test/electron-security.test.mjs:70`、`scripts/build-windows-exe.mjs:36`（`!relative.startsWith("web/ui-preview/")`）均排除 | ✅ 安全 |
| `web/app2.js` | 249665 B | 生产引用只剩 `web/service-worker.js:21`（预缓存）+ 未跟踪的 `web/index-old-backup.html:769`；`app-new.js:6/176/1397` 仅注释提及。**测试强耦合**：`test/dual-ui.test.mjs:42,81`、`test/ui-contract.test.mjs:226,228,455`、`test/landing-entry.test.mjs:6`、`tools/verify-web-data.mjs:19,73` | ⚠️ 需先改 `service-worker.js` + 上述 4 个测试与 1 个工具，否则测试红 |
| `web/styles.css` | 179799 B | 生产引用只剩 `web/service-worker.js:20` + 未跟踪的 `web/index-old-backup.html:13`；测试 `test/ui-contract.test.mjs:226-227,455-456`、`tools/verify-web-data.mjs:18,73` | ⚠️ 同上 |
| `docs/ui-redesign/`、`AGENTS.md`、`.zcodeignore` 等 25 个未跟踪文件 | — | 交接文档与配置，非遗留代码 | ❌ 不在本清单（属交接材料，保留） |

**注**：`test/electron-security.test.mjs:64-73` 只断言 `packagerConfig.ignore` 的正则列表包含这些路径，**不检查文件是否存在** —— 所以删除文件不会让该测试失败；但删掉后这些 ignore 规则会成为无害的冗余，可一并清理。

---

## 4) 已跑命令与结果摘录

```powershell
# 1) 必跑四项（真实输出）
node --test test/dual-ui.test.mjs test/new-ui-compat.test.mjs test/ui-contract.test.mjs test/web-sync.test.mjs
→ tests 106 / pass 106 / fail 0 / cancelled 0 / skipped 0 / duration_ms 477

# 2) 旧版/兼容相关浏览器测试（需 DAGUAN_PLAYWRIGHT_MODULE）
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
node --test test/choice-ui-browser.test.mjs test/font-scale-browser.test.mjs test/study-report-browser.test.mjs test/visibility-browser.test.mjs
→ exit=1
   choice-ui-browser    14/14 pass（含 old single/old multi 全链路、500/409 重试、离线补同步）
   visibility-browser    1/1  pass（SSE 跨页同步证据 {"revisionBefore":2,"serviceRevision":3,...}）
   font-scale-browser    1 fail  「选择 150% 字号后，目录切换、进入题目和刷新均保留字号」31044ms
   study-report-browser  5 fail  全部 page.waitForLoadState: Timeout 30000ms exceeded
   完整输出：%TEMP%\dg-audit-06\browser-tests.txt（ℹ duration_ms 158060.2165）

# 3) 本机 Playwright 实测脚本（服务 PORT=18084，DAGUAN_DATA_DIR=%TEMP%\dg-audit-06\data*）
node flow2.mjs   → 重定向矩阵 A/B/C/D/G + 新版题库 DOM + 旧版弹层下钻
node flow3.mjs   → 新版进题 → 切旧版（位置保留）→ 切回新版
node flow4.mjs   → 旧版作答写入 daguan_local_progress_v1（数字 ms）
node flow5.mjs   → 旧格式↔新格式双向读取
node probe-switch.mjs / probe-switch2.mjs → 切换按钮可见性 / focus-mode 诊断
node idcheck.mjs / csscheck.mjs           → HTML id 差集 / 未定义 class

# 4) 每次运行结束
service exitCode 0 ；browser 已 close（无残留进程）
```

**截图**（均在 `%TEMP%\dg-audit-06\`）：`legacy-01-home.png`、`legacy-02-chaptermenu.png`、`legacy-03-question.png`、`legacy-10-list.png`、`legacy-11-single.png`、`legacy-12-answered.png`、`legacy-13-new-after.png`、`new-01-home.png`、`new-02-library.png`、`new-03-list.png`、`new-04-question.png`、`new-05-question.png`、`switch-01-legacy.png`、`switch-02-new.png`、`probe-after-switch.png`、`debug-leaf.png`。

---

## 5) 未能验证事项

1. **Electron 内旧版界面的实际表现**（窗口尺寸 1320×860、隐藏标题栏 42px、右键菜单、快捷键）。未启动 Electron（会与真实用户数据目录/实例锁交互，超出本次只读与隔离约束）；仅通过 `desktop/electron-main.cjs` 静态阅读得出结论（主进程只加载 `index.html`，旧版由页面内切换进入）。**理由：隔离约束 + 避免触碰真实 `%LOCALAPPDATA%`。**
2. **旧版欢迎引导 / 引导卡片的真实交互**（`showLegacyWelcomeOnce`、`#legacy-welcome-card`）。未触发到该分支。**理由：非本次必查项，时间预算留给主流程。**
3. **`browser-retirement.js/css`、`remote-access.js`、AI 抽屉在旧版的完整功能**。未逐个走查。**理由：范围外（另有子代理负责其他模块）。**
4. **`test/new-ui-core/catalog/search` 与旧版的关系**。未运行（非必跑项）。
5. **`web/landing.html` 的界面入口**。未验证其是否提供新旧界面选择入口。
6. **`npm test` 全量**。按任务约定未跑（另有子代理负责）；L-04 的「npm test 会变红」结论是基于 `package.json` 的 `test` 脚本确实包含这两个失败文件 + 真实单跑结果推断，**未做端到端全量复现**。

---

## 6) 优化建议（按性价比排序）

1. **收敛界面选择为唯一权威**（修 L-01，顺带 L-03）：一处判定 + 一处写存储，`?ui` 与存储偏好优先级写清楚。收益：消除三处重复跳转逻辑与「覆盖失效」，测试与桌面冒烟脚本恢复可信。成本：约 20 行改动 + 1 条 dual-ui 用例调整。
2. **修两个 `networkidle` 用例**（修 L-04）：`font-scale-browser.test.mjs:51`、`study-report-browser.test.mjs:41` 改为 `domcontentloaded` 或先 abort `/api/state/events`。收益：`npm test` 在装好 Playwright 的环境下恢复绿色，浏览器用例重新变成可用的回归网。成本：2 行。
3. **切换前重置模式键**（修 L-02）：`setUiVersion` 跳转前清 `daguan_local_mode_v1`，保证目标页一定显示顶栏。收益：界面切换永远可达。成本：1 行 + 1 条用例。
4. 清理 `service-worker.js` 的 430KB 死预缓存（L-09）+ 删除 `index-*-backup.html` / `ui-preview/`（第 3 节）。收益：安装/更新更快，仓库更干净。
5. 清理旧版调试全局（L-05）与 `innerHTML` 转义（L-06），并补一条 ui-contract 断言防回归。
6. 清理 `legacy.html` 的 6 个无定义 class（L-07），让旧版样式来源可追溯。
7. 补旧版失效元素的处置（L-13，至少修 `#setup-feedback` 疑似改名漏改）。
8. 在验收文档登记「字号设置不互通」「旧版侧栏只到两层」两条已知差异（L-08/L-10）。
