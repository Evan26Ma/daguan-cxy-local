# 大观园本地版新版 UI 交接

更新日期：2026-09-27
工作区：`F:\AI\大观园本地`，分支 `codex/merge-dual-ui`，HEAD `d96566b`。当前所有 UI 与 Gate 5 修复都保留在本地工作区，未提交、未推送、未部署、未打包。Gate 1–5 均有独立验收记录。

本文按当前源码和 `path-index-gate1` 至 `path-index-gate5` 记录重写，可独立使用。路径验收记录只代表各关明列的范围；未逐题验收全部题库，也不代表上线或外网服务已验收。

## 当前产品结构

本地 Node 中控台配原生 HTML、CSS、JavaScript，不依赖构建后端。新版入口是 `web/index.html`，旧版入口是 `web/legacy.html`。首页共用入口偏好；新版在设置页切换旧版，旧版有版本切换按钮。旧版业务主体仍由 `web/app-legacy.js`、`web/app2.js` 和 `web/styles.css` / `web/legacy.css` 承载。新版主逻辑在 `web/app-new.js`，新版样式在 `web/styles-new.css`。题库数据仍从 `web/data/` 读取。

新版当前包括首页、路径式题库、单题和分段多题练习、复习、题目笔记、记录、工具与设置。七个页面入口位于桌面左侧栏，手机以左侧抽屉打开；顶栏保留全库搜索与快捷键帮助，侧栏底部也可打开。做题按钮直接显示实际快捷键，可配置键从 `daguan_focus_shortcuts_v1` 读取；多题导航按钮显示 J/K，模式切换显示 M，跳题显示 G。题库路径来自现有真实章节数据，题目按数据分片载入。五种常用浏览尺寸和 200% 等效 640 CSS px 的最终检查，见 Gate 5 报告及其结构化结果；侧栏改动另在 `.build/ui-redesign/sidebar-nav-qa/` 留有四尺寸截图。

## 本地资源版本与离线壳

| 资源 | 当前引用 |
|---|---|
| 新版样式 | `styles-new.css?v=110` |
| 新版脚本 | `app-new.js?v=110` |
| 新旧共用版本与待同步模块 | `ui-version.js?v=106` |
| 旧版脚本与样式 | `app-legacy.js?v=89`、`app2.js?v=89`、`legacy.css?v=89`、`styles.css?v=89` |
| Service Worker 缓存名 / 注册地址 | `daguan-shell-v112` / `service-worker.js?v=112` |
| `package.json` 版本 | `1.0.0`（包元数据，非 UI 发布号） |

Service Worker shell 缓存两版入口、脚本与样式、共用版本脚本、KaTeX 核心资源及讲解视频映射。Gate 5 使用干净 Chromium context 先联网安装缓存，再切离线分别打开新版与旧版，均成功渲染。详情和新证据在 `docs/ui-redesign/path-index-gate5-report.md`、`.build/ui-redesign/path-index-execution/gate5/theme-final/offline-final-qa.json`。需要改任何 shell 资源 URL 时，同步检查入口引用、Service Worker 预缓存 URL、缓存名和 `test/ui-contract.test.mjs`。

## 双版本偏好与共享数据

新版/旧版选择保存在 localStorage `daguan_ui_version_v1`，值为 `new` 或 `old`；外观分别保存在 `daguan_ui_appearance_new_v1`、`daguan_ui_appearance_old_v1`。`web/ui-version.js` 负责设备迁移：全新设备默认新版朱红奶白 `path-red`；检测到既有使用历史但没有新版外观键时，初始化为橙白 `orange-white`。旧版外观键保留，不由新版主题写入。新版有六套预设：`path-red`、`orange-white`、`blue-sand`、`eye-care`、`orange-night`、`mint`。应用会保存；取消会恢复已存主题；仅预览的草稿离开题库渲染时按已保存主题回滚。

新旧版共享以下本机键与数据：

- 学习状态：`daguan_local_progress_v1`，题号到掌握状态、易错/收藏等字段的映射；收藏兼容键 `daguan_local_favorites_v1`。
- 题目批注：`daguan_question_annotations_v1`；本机全局备忘：`daguan_local_notes_v1`。
- AI 档案选择：`daguan_ai_preferences_v1`；逐题草稿通过 `DaguanVersions.draftKey(questionId)` 生成同一题号的共享键。AI 服务凭据留在本地服务端配置，不进入新版设置页。
- 快捷键：`daguan_focus_shortcuts_v1`；离线/服务器同步待处理日志：`daguan_pending_sync_v1`。

学习位置是两个本地形状加一个服务端桥接：新版写 localStorage `daguan_learning_position_v2`，并同时写旧版可读的 sessionStorage 形状；旧版以 sessionStorage 保存当前标签页详细队列/滚动信息，并在服务可用时 PATCH `/api/state/last-study`。新版切换到旧版时使用 sessionStorage 兼容形状，旧版切回新版时优先通过服务端 `last_study` 定位题号，离线再回退兼容形状。新版自己的章节/模式索引仍以其本地结构为准；切换版本复原依赖可用的标签页状态或服务端 `last_study`，不等同于两版所有滚动/队列细节完全相同。收藏、进度、笔记、题目批注共键共享；外观设置独立。

## 工具的实际边界

新版工具页并非只有静态入口：

- 智能组卷会按“全部题库”或科目收集本机题目，抽取 5–50 题，生成题号清单，可开始答题或导出该卷。
- 导出页按收藏、易错、已掌握、当前章节队列收集本机题目，支持含答案/解析；生成打印/另存 PDF 预览窗口，或下载离线 HTML。Gate 5 隔离浏览器实际完成了 5 道题组卷、1 道收藏题预览和 HTML 下载。
- 备份支持下载/恢复本机进度类数据。同步页实现状态、读取变化预览、应用导入预览、上传预览及分步确认；Gate 5 未用真实官网、登录凭据或外网写入验收该链路。因此只能说界面与本地流程存在，真实账户同步仍未验证。

设置页有主题、快捷键和 AI 档案选择。AI 面板本地打开已验，没有发送外部请求。讲解视频映射来自本地数据文件；浏览器外链行为有代表题验证，离线壳缓存映射文件。

## Gate 1–5 验收记录

- Gate 1 的视觉样板通过独立验收；它是样板，不代表当时正式产品代码已实现。见 `path-index-gate1-acceptance.md`。
- Gate 2 正式接入主题、迁移、顶栏、真实路径目录，通过独立验收。见 `path-index-gate2-acceptance.md`。
- Gate 3 多题模式通过独立验收。见 `path-index-gate3-acceptance.md`。
- Gate 4 本机全库搜索和快捷键通过独立验收。见 `path-index-gate4-acceptance.md`。搜索可以按题号/正文/来源/路径检索，限定题库范围；摘要会安全渲染 KaTeX。
- Gate 5 完成其余页面、主题、离线、预览权限与工具局部回归，并通过独立验收。最终验收矩阵与限制详见 `path-index-gate5-report.md` 和 `path-index-gate5-acceptance.md`。

Gate 5 最终主题复测覆盖 6 个主题 × 6 个 CSS 视口（1440×900、390×844、1280×800、1024×768、360×800、640×800 等效 200%）× 3 页（设置、题库、单题），108 条结构化检查，横向溢出和页面异常为 0。橙黑页额外断言 body、题库目录与概览、单题阅读、设置卡片的计算背景为暗色、前景明亮；搜索框也以暗色底呈现。橙黑题库初次验收曾发现目录按钮采用浏览器默认黑字、搜索框保留白底，已修复。主题截图保存在 `.build/ui-redesign/path-index-execution/gate5/theme-final/screenshots/`。

为避免旧报告遗漏工具现有流程，Gate 5 另在隔离数据与干净浏览器 context 中组卷、导出预览与下载；未真实同步。长公式题号 `99000016` 的搜索结果现在对含数学内容的摘要取消 CSS 行数/高度截断，确认 5 组 KaTeX 和 (1)–(5) 五个编号部分均保留；390×844 下也无横向溢出。截图和记录见 `theme-final/targeted-final-qa.json`、`long-formula-search-final.png` 与 `long-formula-search-mobile-390.png`。

## 常用检查命令

```powershell
npm test
npm run verify
node --check web/app-new.js
node --check web/app-legacy.js
node --check web/service-worker.js
node --check web/ui-version.js
git diff --check
```

Gate 5 最终运行记录以最新 `path-index-gate5-report.md` 为准。当前本机 `npm test` 为 133/133；`npm run verify` 通过 6,342 道题与唯一题号检查，仍报告 21 张历史题图缺失；四个 JS 文件语法检查和 `git diff --check` 通过。本轮没有同步题库/图片。

隔离服务必须使用独立目录，不要让回归读写真实用户状态：

```powershell
$env:DAGUAN_DATA_DIR = (Resolve-Path '.build/ui-redesign/path-index-execution/gate5/theme-recheck-data').Path
$env:PORT = '8096'
node local-server/server.mjs
```

浏览器工作使用 Playwright 的干净 Chromium context。预览权限测试用临时隔离目录和临时访问 key；不要把真实凭据放入命令、日志或 QA 文件。

## 已知未验证与限制

- 21 张已有题图缺失警告尚未处理；本轮没有运行数据同步。题图 10781 在本机存在并完成显示/尺寸检查，但未逐图查看 6,342 道题。
- 浏览器 QA 使用 Chromium 桌面版。没有实机手机、Firefox、Safari、屏幕阅读器验收。200% 按 640 CSS px 宽度模拟，未驱动 Windows 原生缩放。
- 主题检查覆盖指定关键页面和代表入口；并非对每个组件状态、弹层、错误态逐个目视验收。未核对所有题目与解析内容正确性。
- 未调用真实外部 AI，未用真实账号登录/同步官网，也未实测远程服务异常恢复、跨设备同步及真实凭据迁移。预览权限边界仅用隔离访问密钥验证。
- 当前实现没有在本关新增官方账号同步、AI 服务或题库业务；同步链路存在但真实外网写入未验收。导出 HTML 在单机隔离环境确认，未测试不同浏览器打印成 PDF 的版式。

## 交接时的保护要求

本地工作区里包含先前关卡和其他任务的未提交改动及新增文件。后续验收或修复须原样保留现场；不要清理、重置或覆盖其它修改，不做提交/推送/部署/打包，除非之后得到明确任务。不要访问真实用户数据目录或触发官网写入。发现问题时先记录可复现证据，再做最小范围修复并重新运行对应 QA。
