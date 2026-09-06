# 大观园本地题库：UI 与一键使用交接文档

## 1. 交接目的

本文件用于交给其他 AI 继续设计和实现 UI、使用教程以及“一键启动”体验。

当前任务已经暂停，不要把本文件当成“功能已全部完成”的说明。尤其是本次新增的教程 DOM 还没有完成 JavaScript 事件绑定、CSS 样式和启动脚本。

## 2. 项目位置与 Git 状态

本地仓库绝对路径：

```text
C:\Users\14666\Documents\ChatGPT\大观园本地
```

GitHub 仓库：

```text
https://github.com/Evan26Ma/daguanyuan-math-local-sync
```

当前分支：

```text
codex/daguan-math-local-sync
```

已完成并推送的基础提交：

```text
0291ef6 feat: add offline web client and official sync bridge
```

当前暂停时的工作区状态：

```text
M web/index.html
```

也就是说，`web/index.html` 有一组未提交的教程入口和同步准备步骤；`web/app.js`、`web/styles.css`、启动脚本和教程文档尚未针对这组新增 DOM 完成收尾。继续工作前先运行：

```powershell
cd 'C:\Users\14666\Documents\ChatGPT\大观园本地'
git diff -- web/index.html
git status --short
```

不要使用 `git reset --hard`，也不要覆盖当前未提交的 `web/index.html`。

## 3. 本次已经写入 `web/index.html` 的待完成入口

文件地址：

[web/index.html](C:\Users\14666\Documents\ChatGPT\大观园本地\web\index.html)

目前新增或需要继续处理的 ID：

```text
btn-tutorial
btn-hero-tutorial
dlg-welcome
btn-welcome-later
btn-welcome-tutorial
dlg-tutorial
btn-open-extension-page
btn-open-official-site
btn-tutorial-sync
btn-open-official-site-sync
btn-open-extension-page-sync
```

现有官网同步对话框 `dlg-online-sync` 也已经增加了“登录官网、安装扩展、复制扩展 ID”的准备步骤。

### 继续实现时必须完成

1. 给上述按钮绑定事件；如果决定重新设计 DOM，可以保留等价功能并同步修改 ID。
2. 给欢迎弹窗和教程弹窗补充样式、移动端布局、键盘关闭和焦点可用性。
3. 增加首次打开提示的本地标记，例如：

   ```text
   daguan_tutorial_seen_v1
   ```

4. “打开扩展管理页”可尝试打开 `chrome://extensions/`；如果浏览器拦截，必须给出文字提示，并显示用户可手动输入的地址。
5. “打开官网”使用：

   ```text
   https://www.cxyonly.fans/math
   ```

6. 教程按钮不能影响原有刷题、进度备份和同步逻辑。

## 4. 关键文件清单

### Web 本地刷题站

| 文件 | 作用 | UI AI 需要注意 |
|---|---|---|
| [web/index.html](C:\Users\14666\Documents\ChatGPT\大观园本地\web\index.html) | 页面结构、侧栏、首页、对话框 | 本次暂停时已加入教程入口和同步准备步骤 |
| [web/styles.css](C:\Users\14666\Documents\ChatGPT\大观园本地\web\styles.css) | 页面全部样式 | 保持现有米白/深蓝风格；不要引入 CDN 图标、字体或框架 |
| [web/app.js](C:\Users\14666\Documents\ChatGPT\大观园本地\web\app.js) | 刷题、搜索、进度、收藏、同步交互 | 不要把官网令牌或官网请求搬到这里 |
| [web/manifest.webmanifest](C:\Users\14666\Documents\ChatGPT\大观园本地\web\manifest.webmanifest) | PWA 配置 | 资源路径必须兼容根路径和子路径 |
| [web/service-worker.js](C:\Users\14666\Documents\ChatGPT\大观园本地\web\service-worker.js) | 离线缓存 | 如果修改脚本或教程资源，更新 cache 版本 |
| [web/data](C:\Users\14666\Documents\ChatGPT\大观园本地\web\data) | 本地题库 JSON、索引、题图 | 不要手工改题库数据来解决 UI 问题 |
| [web/vendor](C:\Users\14666\Documents\ChatGPT\大观园本地\web\vendor) | 本地 marked、KaTeX 和字体 | 禁止恢复 CDN 依赖 |

### 官网同步扩展

| 文件 | 作用 |
|---|---|
| [sync-extension/manifest.json](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\manifest.json) | MV3 权限、官网 host 权限、本地来源白名单 |
| [sync-extension/background.js](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\background.js) | 接收本地页面消息，转发到官网标签页 |
| [sync-extension/bridge.js](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\bridge.js) | 官网适配层、CSRF、读取/写入、备份、重试 |
| [sync-extension/protocol.js](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\protocol.js) | 扩展端同步协议和数据校验 |
| [sync-extension/popup.html](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\popup.html) | 点击浏览器扩展图标后的弹窗 |
| [sync-extension/popup.js](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\popup.js) | 扩展弹窗逻辑 |
| [sync-extension/popup.css](C:\Users\14666\Documents\ChatGPT\大观园本地\sync-extension\popup.css) | 扩展弹窗样式 |

可以在扩展弹窗中增加“复制扩展 ID”按钮，读取 `chrome.runtime.id`，这样用户只需复制并粘贴一次 ID。

### 协议、数据和部署

| 文件 | 作用 |
|---|---|
| [shared/sync-protocol.js](C:\Users\14666\Documents\ChatGPT\大观园本地\shared\sync-protocol.js) | Web 与扩展共用的数据协议副本 |
| [tools/sync-web-data.mjs](C:\Users\14666\Documents\ChatGPT\大观园本地\tools\sync-web-data.mjs) | 下载线上题库、题图和本地依赖 |
| [tools/verify-web-data.mjs](C:\Users\14666\Documents\ChatGPT\大观园本地\tools\verify-web-data.mjs) | 校验题库、资源、外部 URL 和字体 |
| [deploy/docker-compose.yml](C:\Users\14666\Documents\ChatGPT\大观园本地\deploy\docker-compose.yml) | Docker 端口映射 `8080:80` |
| [deploy/Dockerfile](C:\Users\14666\Documents\ChatGPT\大观园本地\deploy\Dockerfile) | Nginx 静态部署镜像 |
| [deploy/README.md](C:\Users\14666\Documents\ChatGPT\大观园本地\deploy\README.md) | Linux/Docker 部署说明 |
| [package.json](C:\Users\14666\Documents\ChatGPT\大观园本地\package.json) | `npm test`、`npm run verify` 等脚本 |

## 5. 一键使用功能的目标

### Windows

在仓库根目录新增：

```text
C:\Users\14666\Documents\ChatGPT\大观园本地\启动本地题库.cmd
```

双击后应当：

1. 自动切换到仓库目录。
2. 优先使用 `py -3`，其次使用 `python`。
3. 启动 `python -m http.server 8080 --directory web`。
4. 自动打开 `http://localhost:8080/`。
5. 找不到 Python 时显示明确安装提示，不要静默退出。

可选地新增：

```text
C:\Users\14666\Documents\ChatGPT\大观园本地\启动本地题库-Docker.cmd
```

用于执行：

```powershell
docker compose -f deploy/docker-compose.yml up -d --build
```

### Linux

现有命令：

```bash
python3 -m http.server 8080 --directory web
```

Docker：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

## 6. 现有同步接口，不要破坏

`web/app.js` 已有同步 API：

```javascript
globalThis.daguanSync.status()
globalThis.daguanSync.pullOnlineProgress()
globalThis.daguanSync.previewPush(localProgress)
globalThis.daguanSync.pushProgress(localProgress, previewId)
```

同时尝试提供兼容别名：

```javascript
globalThis.sync
```

本地页面到扩展的消息格式：

```javascript
{
  protocol: "daguan-sync-v1",
  requestId: "...",
  action: "status" | "pull" | "previewPush" | "push",
  payload: {}
}
```

同步约束：

- 本地页面不直接请求官网 API。
- 登录令牌只留在官网标签页/浏览器会话中。
- 默认同步掌握状态、收藏、题号、更新时间。
- 读取官网时，官网“未开始”不清除本地已有状态。
- 写入官网时，默认不清空官网状态、不自动取消收藏。
- 写入前自动生成官网备份。
- 所有批量写入必须有明确确认。

## 7. UI 设计要求

### 必须保留

- 首页能明确看出“本地刷题”和“官网同步”是两个不同概念。
- “从高等数学开始”是首页主按钮。
- 侧栏能找到“使用教程”“进度备份”“官网同步”。
- 教程要能解释：启动、刷题、备份、安装扩展、官网登录、读取、上传。
- 官网同步对话框要显示当前连接状态、扩展 ID 输入框、读取按钮、上传按钮和结果区域。
- 失败信息要告诉用户下一步怎么恢复，例如“先打开官网并登录”“检查扩展 ID”“重试”。

### 视觉与交互

- 沿用当前米白背景、深蓝品牌色、衬线标题的产品风格。
- 不引入 Emoji 作为结构性图标，不引入外部图标库。
- 所有按钮和表单控件要有可见 focus 状态，移动端点击区域至少约 44px。
- 教程弹窗在 375px 宽度下可滚动，不能出现横向溢出。
- 弹窗必须有关闭按钮和 Escape 关闭路径。
- 不要用颜色作为唯一状态提示；连接成功/失败要有文字。
- 不要让教程遮挡题目内容太久；首次弹窗应提供“以后再看”。
- 不要为了教程增加账号系统、后端数据库或个人信息收集。

## 8. 建议的使用教程文档

建议新增：

```text
C:\Users\14666\Documents\ChatGPT\大观园本地\docs\使用教程.md
```

内容至少包括：

1. Windows 双击 `启动本地题库.cmd`。
2. 没有 Python 时的安装方式和检查命令。
3. Chrome/Edge 加载 `sync-extension/` 未打包扩展。
4. 官网登录并保持官网标签页打开。
5. 从扩展弹窗复制扩展 ID并粘贴到本地页面。
6. “从官网读取”的合并规则。
7. “预览并同步到官网”的确认、备份和失败重试规则。
8. 本地 JSON 备份导出/导入。
9. Linux、Docker 和局域网部署。
10. 常见错误：双击 HTML、端口占用、扩展 ID 错误、官网未登录、题图缺失。

同时应在：

[README.md](C:\Users\14666\Documents\ChatGPT\大观园本地\README.md)

增加一个“最快开始”段落，并链接到 `docs/使用教程.md`。

## 9. 验收命令

在仓库根目录运行：

```powershell
npm test
npm run verify
node --check web/app.js
node --check sync-extension/background.js
node --check sync-extension/bridge.js
node --check sync-extension/popup.js
```

手工验收：

1. 双击 Windows 启动脚本，浏览器是否自动打开本地首页。
2. 浏览器断网后，本地题库、公式、字体和题图是否仍可用。
3. 首次打开是否出现教程，点击“以后再看”后刷新不再弹出。
4. 375px 宽度下教程、同步对话框是否能滚动且按钮可点。
5. 题目进度刷新后仍存在。
6. 官网未登录时是否给出明确提示。
7. 官网读取失败时，本地进度是否不变。
8. 同步到官网前是否显示预览并生成备份。
9. 部分题目失败时是否继续处理并报告失败题号。
10. 无外部 CDN、脚本、字体和图片请求。

## 10. 交给下一个 AI 的建议提示词

可以直接把下面这段发给下一个 AI：

```text
请在 C:\Users\14666\Documents\ChatGPT\大观园本地 继续工作。
先阅读交接文档-本地题库与UI设计.md，不要 reset 或覆盖当前未提交的 web/index.html。
本次目标是完善“一键使用 + 页面内使用教程”的 UI 和交互：
1. 完成 web/index.html 中现有教程/同步准备 DOM 的 CSS 和 JS 事件绑定；
2. 新增根目录启动本地题库.cmd，双击后自动启动 Python 静态服务并打开浏览器；
3. 在 sync-extension/popup.html、popup.js、popup.css 中增加复制扩展 ID 的低摩擦流程；
4. 新增 docs/使用教程.md，并更新 README.md 的最快开始；
5. 不破坏现有刷题、离线资源、localStorage/IndexedDB、本地备份和官网同步协议；
6. 完成 npm test、npm run verify、node --check 和 375px 移动端手工检查。
最后报告修改文件、测试结果和仍需用户确认的事项，不要擅自推送未确认的提交。
```

