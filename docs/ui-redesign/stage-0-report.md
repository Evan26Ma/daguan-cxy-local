# 阶段 0 报告：保全现有成果、整理可运行基线

- 执行者：ZCode / GLM-5.3-Flash
- 日期：2026-09-26
- 范围：仅阶段 0（UI-REDESIGN-CONTROL.md）。未开始任何视觉改造；未进入阶段 1。
- 合并状态：分支 `codex/merge-dual-ui`，HEAD `ab61f356d2e0f2764fe70d097eb4ecf8cbeb6e6c`，MERGE_HEAD `c1f0e14f5511e547aa8dc85e16860fcab92f59a0`，与控制文档记载一致。索引中 6 个文件仍为 UU（`local-server/server.mjs`、`test/landing-entry.test.mjs`、`test/ui-contract.test.mjs`、`web/app2.js`、`web/index.html`、`web/service-worker.js`），工作区内容均已无冲突标记（人工已解决、未 `git add`）。按要求未提交合并、未 reset/clean/abort。

## 1. 可恢复快照（未动 git 状态）

`.build/ui-redesign/stage-0/backup/`：

| 文件 | 说明 |
|---|---|
| `git-state.txt` | 分支/HEAD/MERGE_HEAD/采集时间 |
| `status-porcelain.txt` | 22 项改动+未跟踪清单 |
| `unmerged-index.txt` | `git ls-files -u` 全部未合并索引项 |
| `worktree-vs-index.diff` | 未暂存改动 diff（1475 行） |
| `index-vs-head.diff` | 已暂存改动 diff（10263 行） |
| `changed-files.txt` | 归档文件清单 |
| `merge-dual-ui-worktree-snapshot.tar.gz` | 全部 22 个改动/未跟踪文件的路径归档（274 KB），可整树恢复 |
| `stash-list-before.txt` | 操作前 stash 列表（为空，未新增 stash） |

备份只含项目代码，不含凭据与个人学习数据。

## 2. 本阶段产品代码修改（仅 1 处基线必要修复）

### scripts/build-windows-exe.mjs:30 — 修复 SW 打包正则漏写闭合引号

`packageServiceWorker` 用于在 Windows 离线壳的 service worker 缓存清单中剔除 landing 资产（这些文件被 `WINDOWS_EXCLUDED_WEB_FILES` 排除、不进安装包，清单若残留引用会在离线预缓存时 404）。原正则在可选组后直接接 `,`，漏了闭合引号 `"`：

```diff
- /^\s+"\.\/(?:landing\.html|landing\.css\?v=\d+|landing\.js\?v=\d+|assets\/landing\/(?:math-surface\.svg)),\r?\n/gm
+ /^\s+"\.\/(?:landing\.html|landing\.css\?v=\d+|landing\.js\?v=\d+|assets\/landing\/(?:math-surface\.svg))",\r?\n/gm
```

缓存行实际形如 `"./landing.html",`，失配导致整条替换静默失效。这正是 `test/dual-ui.test.mjs` 中"Windows bundle retains both frontends and new logo in its offline shell"失败的根因（即控制文档所述"加了一个 Windows bundle 检查但尚未复跑"的那条）。诊断证据：`.build/ui-redesign/stage-0/debug-regex.mjs`。

除该正则外，未修改任何产品代码；双版本成果（旧版=ab61f35 行为、新版含多讲师与最新 AI、`web/ui-version.js` 版本迁移/偏好/草稿）全部按现状检查、原样保留。

## 3. 检查命令与真实结果

| 检查 | 结果 |
|---|---|
| `npm test`（7 个测试文件） | 修复后 **81/81 通过**（修复前 80/81，唯一失败即上述 Windows bundle 项） |
| `npm run verify` | 题库验证通过：**6342 题、6342 唯一题号**；警告缺 **21 张题图**（与历史记载一致，本轮未补图） |
| 6 个 UU 文件冲突标记扫描 | 均为 0 处 `<<<<<<<`/`=======`/`>>>>>>>` |
| QA 脚本 daguan-qa.py | **7 项 PASS**、0 个未捕获 JS 错误、0 个 HTTP≥400（结果见 `screenshots/browser-results.json`） |
| QA 脚本 daguan-switch.py | 切换前后题号同为 `#3356`；AI 草稿"待发送的草稿"跨版本恢复；无 JS 错误 |
| QA 脚本 daguan-ai-qa.py | **5 项 PASS**：新旧版 mock AI 响应；提示词含"总体路线→逐步推导"完整解答结构（断言"总体思路""题目直接给出的信息"在请求中）；生成中切换先取消（confirm 拒绝则停留）再确认；保存失败（500）阻断切换并提示、服务恢复后重试成功 |
| QA 脚本 daguan-video-qa.py | **2 项 PASS**：新旧版真实题目的讲师链接 `bvid`/`p`/`t` 参数与 `lecture-video-mappings.json` 一致（李艳芳、没咋了） |
| 预览权限链路（curl，见 §4 实例 B） | 未解锁访问 `/api/state` → 403 `PREVIEW_LOCKED`；错误密钥 → 401 `PREVIEW_KEY_INVALID`；正确密钥 → 200 并种 cookie；带 cookie → 200 返回状态；`index.html`/`landing.html` 无需密钥 → 200（公共预览边界正确） |
| 隔离验证 | 两实例均以 `DAGUAN_DATA_DIR` 指向 `.build/ui-redesign/stage-0/qa-data*`；真实 `data/state.json` mtime 仍为 2026-09-25 02:58（测试开始前），未被触碰 |
| 根路径 `/` | 200，默认进 landing（`DAGUAN_DEFAULT_PAGE` 未设时的默认行为） |

daguan-qa.py 覆盖项：双向切换保持题号/掌握/易错/批注/AI 草稿 → 新版工具（备份/官网同步/外观/组卷入口）→ 两版三个讲师筛选入口 → 版本偏好持久化与显式旧版入口 → 1440×900 与 390×844 桌面手机布局无横向溢出 → 离线缓存下双前端可用且题目恢复 → 无未捕获错误。

## 4. 测试服务（隔离实例，仅本机）

| 实例 | 地址 | 启动方式 |
|---|---|---|
| A 常规 | `http://127.0.0.1:18089` | `DAGUAN_DATA_DIR=F:/AI/大观园本地/.build/ui-redesign/stage-0/qa-data PORT=18089 node local-server/server.mjs` |
| B 预览模式 | `http://127.0.0.1:18090` | 同上但 `PORT=18090`、数据目录 `qa-data-preview`、`DAGUAN_PREVIEW_KEY=daguan-stage0-qa-key` |

18089 在启动前已核实无人占用（netstat 为空）。两个实例仍在后台运行供验收复用；日志在 `stage-0/server.log`、`stage-0/server-preview.log`。未向任何真实官网写入。

## 5. 截图（`.build/ui-redesign/stage-0/screenshots/`）

- 12 张基线截图（QA 脚本自动生成）：`{new|old}-{desktop|mobile}-{home|catalog|question}.png`，尺寸 1440×900 与 390×844。
- 2 张诊断对照：`probe-index-sidebar-open.png`（新版手机抽屉正常展开）、`probe-legacy-sidebar-open.png`（旧版点汉堡后无抽屉，见已知问题 1）。
- `browser-results.json`：机器结果。
- QA 脚本副本在 `stage-0/qa-scripts/`（复制自 TEMP，输出目录改指 stage-0，未覆盖 `.build/dual-ui` 历史对照）。

## 6. QA 脚本副本的两处适配（非产品代码）

1. **自动关闭适配（daguan-qa.py:75）**：新版按规格"选择页面后自动关闭"手机抽屉；关闭后按钮随抽屉移出视口（x=-145），Playwright 仍判"可见"，原脚本点击超时。副本改为仅当按钮 bbox 在视口内才点击。已实测确认这是脚本假设过时、产品行为符合规格，历史版本当时尚无自动关闭所以旧脚本曾通过。
2. **输出目录**：`OUT` 改为 `.build/ui-redesign/stage-0/screenshots`（含一次 sed 反斜杠转义事故的修复过程，畸形目录已清理，最终以正斜杠路径稳定复跑通过）。

TEMP 下原始脚本未改动。

## 7. 已知问题（如实记录，本阶段不修）

1. **旧版手机端汉堡按钮无可见效果**：legacy.css 后层规则（2221/2516 行附近）把 `.learning-shell__sidebar` 定义为固定底部 4.25rem 五列标签栏，`.open` 类无视觉效果、`#btn-close-sidebar` 为 `display:none`。已逐字核对 ab61f35 原版 `web/styles.css`（2221 行起）行为完全一致——**非合并回归**，属旧版既有设计；旧版 CSS/JS 按要求原样保全，未清理其中残留的死代码抽屉规则（如 1814 行）。
2. **缺 21 张题图**：历史已知状态，本轮未补齐（需 `DAGUAN_ASSET_TOKEN` 走 `npm run sync:data`）。
3. 新版切题后的旧版"新版/旧版"切换条仍按合并成果保留（规格 §3 设置页对它的改造属后续阶段）。

## 8. 未验证项

1. **真实 AI 调用**：无可用 API 凭据，AI 相关均用 mock（route 拦截）验证提示词构造与流式 UI，真实服务端到端未测。
2. **Windows exe 产物**：仅验证 bundle/SW 变换逻辑与单测，未构建 exe（遵守"不替换发布包"）。
3. **官网同步全链路**：仅验证工具入口可达；未做真实 pull/push。
4. **最终阶段尺寸**：1280×800、1024×768、360×800（控制文档归入最终回归，本阶段仅 1440×900、390×844）。
5. **DAGUAN_DEFAULT_PAGE=/index.html 变体**：未起专用实例实测（解析为单行三元，静态入口测试已覆盖 landing/index 双入口可达）。
6. **深色/护眼/自定义外观**：未逐一截图，仅依赖单测（外观迁移幂等）与历史对照。
7. 阶段 1+ 的一切视觉与信息结构改造。

## 9. 结论

双版本合并成果在隔离环境下可运行、可切换、状态互通；测试套件 81/81；题库 6342 题完整（21 缺图为历史已知）；预览权限边界正确；基线唯一产品代码修复为 SW 打包正则闭合引号。等待 Codex 验收。
