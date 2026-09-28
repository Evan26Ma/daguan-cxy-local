# 阶段 2：Electron 桌面窗口报告

日期：2026-09-27
工作区：`F:\AI\daguan-desktop-stage0-worktree`
分支：`codex/daguan-desktop-stage0`

本阶段实现 Electron + Electron Forge 桌面窗口和本地服务连接，未进入迁移、安装器、自动更新或发布。数据验证均使用 `%TEMP%` 下自动生成的隔离目录；没有读取或写入原仓库个人数据。

## 运行与验证

完整自动测试：

```powershell
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
$env:DAGUAN_TEST_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test
```

结果：155 项通过，0 失败、0 跳过。包含 CSP、安全策略、新旧 UI、共享状态刷新，以及两浏览器窗口后台漏掉 SSE 后恢复状态的真实浏览器集成测试。

题库校验：

```powershell
npm run verify
```

结果：6342 道题、6342 个唯一题号通过。工具提示缺少 21 张题图，建议有资源令牌时运行 `npm run sync:data`；本阶段未执行同步。

真实 Electron 新旧版流程与跨窗口测试：

```powershell
$env:DAGUAN_DATA_DIR = Join-Path $env:TEMP 'daguan-desktop-stage2-smoke6'
$env:DAGUAN_USER_DATA_DIR = Join-Path $env:TEMP 'daguan-desktop-stage2-profile6'
& .\node_modules\electron\dist\electron.exe . --remote-debugging-port=9222
```

另一个 PowerShell 窗口连接 CDP 并重放可复现操作：

```powershell
$env:DAGUAN_DATA_DIR = Join-Path $env:TEMP 'daguan-desktop-stage2-smoke6'
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
$env:DAGUAN_TEST_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node test/desktop-cdp-smoke.mjs
```

结果：新旧版均打开题目 3356；旧版模拟保存失败时保持在旧页；服务端与新版页面最终 revision 相同且收藏为真；启动设置默认为关闭；没有 renderer 错误。浏览器窗口加入同一学习服务后，双向收藏切换能刷新桌面页。

浏览器服务先启动的顺序、稳定根入口、托盘隐藏和服务归属使用以下独立生命周期脚本测试：

```powershell
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
node test/desktop-lifecycle-smoke.mjs
```

最近一次结果使用隔离目录 `%TEMP%\daguan-desktop-lifecycle-WjKHsH`：浏览器服务 PID `109692` 先启动；Electron PID `110884` 随后连接；锁文件 owner PID 与浏览器服务 PID 一致，instance ID `35223c95-2d95-43a7-99fb-510afec639c5`。`daguan://app/` 返回 HTTP 200 并载入带桌面顶栏的新版页面。点击关闭后，Win32 窗口枚举从该 Electron PID 有一个可见顶层窗口变为无可见顶层窗口；renderer target 与 Electron 进程仍在，服务健康检查成功，锁 owner 未变。结束该 Electron 进程树后，浏览器拥有的服务仍通过健康检查且锁 instance ID 不变。测试结束后脚本发送服务端 shutdown 并删除隔离目录。

Electron 安全策略和入口语法检查：

```powershell
node --test test/electron-security.test.mjs
node --check desktop/electron-main.cjs
node --check desktop/preload.cjs
```

检查结果通过。新增安全测试覆盖稳定来源、根路径和目录遍历、外链分类、API 代理头过滤、sandbox/contextIsolation、仅自有且经确认后停止服务，以及保存后切换版本。

下载对话框修复及真实 Windows GUI 验证：

```powershell
node --test test/electron-security.test.mjs
node --check desktop/electron-main.cjs
node --check desktop/policy.mjs
```

Electron 的 `will-download` 监听器现在同步调用 `DownloadItem.setSaveDialogOptions()`，不再异步自行打开第二个保存框；保存建议目录来自 Windows Downloads，建议名取下载原文件名。官方 API 要求此选项在 `will-download` 回调内设置：[DownloadItem.setSaveDialogOptions](https://www.electronjs.org/docs/latest/api/download-item)。测试结果 9/9 通过；完整测试结果见上。

在运行中的真实 Forge 隔离窗口从“工具”操作了进度备份与题目 HTML 导出。两次成功下载各只出现一个原生“另存为”对话框，均默认到 Windows Downloads；没有第二个 blob URL 对话框：

- `F:\Downloads\daguan-progress-2026-09-28.json`：199 字节，成功解析为 JSON，`format` 为 `daguan-local-progress`、`version` 为 3。
- `F:\Downloads\daguan-export-2026-09-27.html`：105826 字节；由题目队列导出，下载成功。
- HTML 取消验证：弹窗消失后目标文件此前不存在、之后仍不存在；再重新下载成功。取消截图保留在 [electron-html-cancelled.png](desktop-stage2/screenshots/electron-html-cancelled.png)。
- 保存对话框截图：[JSON 保存框](desktop-stage2/screenshots/electron-save-json-dialog.png)、[HTML 保存框](desktop-stage2/screenshots/electron-html-save-dialog.png)；[HTML 下载成功后的窗口](desktop-stage2/screenshots/electron-html-saved.png)。

## 截图

- [新版真实 Electron 页面](desktop-stage2/screenshots/electron-new-ui.png)
- [旧版真实 Electron 页面](desktop-stage2/screenshots/electron-old-ui.png)
- [Windows 整屏截图：单层原生标题栏](desktop-stage2/screenshots/electron-titlebar-fullscreen.png)

旧版截图已重拍，图标、名称、“本地学习”和右侧品牌操作都完整显示；没有旧版全局样式造成的裁切或换行。整屏截图由 Windows 屏幕捕获取得，展示白色品牌栏和原生最小化/最大化/关闭控件合在单行；没有第二条 Windows caption 或重复的自绘窗口按钮。

## 变更要点

阶段 2 原生窗口验收提出重复标题栏问题。现已使用 Electron `titleBarStyle: "hidden"` 与 42px `titleBarOverlay`；品牌栏使用窗口控制安全区宽度，自绘最小化、最大化、关闭按钮已删除。Forge 启动后的 Windows 整屏截图保存在 `desktop-stage2/screenshots/electron-titlebar-fullscreen.png`，可见品牌操作与原生窗口控件处于同一行，应用内容从该行下方开始。关闭按钮仍走窗口关闭事件并进入托盘。

- 用 `daguan://app` 提供稳定页面来源，并将 `daguan://app/` 映射至 `web/index.html`。目录路径变量改为可更新变量，避免目录补 `index.html` 时 `const` 赋值错误。
- 使用 Electron `titleBarStyle: "hidden"` 与 42px `titleBarOverlay` 将白色品牌栏和 Windows 原生窗口控件放在单一标题栏；品牌栏宽度使用 Window Controls Overlay 安全区变量。自绘最小化、最大化和关闭控件已移除；原生关闭仍进入托盘，版本切换、打印和明确退出仍保留。方案依据 [Electron 自定义标题栏文档](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)。
- Electron 窗口关闭时隐藏到托盘；切换新旧版经当前页面已有的保存入口；渲染进程关闭 Node integration 并启用 context isolation、sandbox 和 web security。
- 桌面版发现并连接已有本地服务；仅在没有服务时启动自有服务。主进程轮询共享 revision 并将变化通知新旧页面。
- 添加菜单开机启动设置，默认状态沿用 Windows 设置；打印走 Electron 打印对话框，下载走保存文件对话框，HTTP(S) 外链交给系统浏览器。
- SVG 数学标识作为桌面顶栏品牌图；未打包 Python/Matplotlib。

## 待人工验收

- 父代理已真实验收“取消退出”与“确认退出”；确认后自有服务锁释放。托盘双击恢复也已真实验收。
- 打印对话框已打开，但当前打印驱动不支持预览，尚未实际打印。真实外链在默认浏览器打开未验证。
- `npm run desktop:package`、安装器、升级流程和发布均属于后续阶段，未测试。

稳定来源 CSP 整改：

Electron 主进程只给 `daguan://app` 的 HTML 响应附加 CSP：默认及脚本、连接、字体、图片、Worker、清单均限制在同源及必要的数据/blob URL；禁止对象、外部 base 与外部表单目标，并禁止页面被 frame 嵌入。`script-src` 允许同源脚本和现有前端动态生成的内联事件处理器，但明确不允许 `unsafe-eval`；移除了两个入口页内联 bootstrap，并把入口操作改为外部 bootstrap 中的受控事件委托。浏览器版走 Node HTTP 的响应不受该桌面专用 CSP 改动影响。策略根据 [Electron 官方安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 使用 CSP 响应头配置。

自动安全测试增加 CSP 指令、无 `unsafe-eval`、桌面 HTML 都使用 CSP，以及入口 bootstrap/事件绑定检查。真实 Electron Playwright/CDP 验证命令：

```powershell
$env:DAGUAN_PLAYWRIGHT_MODULE='C:\Users\14666\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\package\index.js'
$env:DAGUAN_CDP_ENDPOINT='http://127.0.0.1:9225'
node test/desktop-csp-smoke.mjs
```

结果：真实稳定来源下新版和旧版各自收到 CSP，KaTeX `0.16.11` 可加载并渲染公式；新版搜索入口、返回首页和动态生成的收藏内联处理器正常，收藏成功写入本地服务；旧版收藏可同步切换回未收藏，桌面版本切换往返成功；AI profile 本地 API 返回 200。CDP 监听到 0 条 Electron 安全警告、CSP 拦截、控制台错误或页面错误；无失败请求。未发起外部 AI 模型调用，因为隔离配置没有模型凭据。测试使用新的隔离 `%TEMP%\daguan-desktop-csp-final2-data` 与 `%TEMP%\daguan-desktop-csp-final2-profile`，并未操作父代理的隔离窗口或个人数据。

Forge 开发启动命令也已真实运行：

```powershell
$env:DAGUAN_DATA_DIR = Join-Path $env:TEMP 'daguan-desktop-stage2-forge-data'
$env:DAGUAN_USER_DATA_DIR = Join-Path $env:TEMP 'daguan-desktop-stage2-forge-profile'
npm run desktop:start
```

Electron 窗口标题为“学习空间 · 本地大观园”，服务健康检查通过。下载复验时 Forge 隔离窗口以另一个临时 profile/data 目录启动；当前可用 `npm run desktop:start` 重启复现。上述进度 JSON 与 HTML 是本次 GUI 验证明确生成的测试产物，保存在 Windows Downloads；未访问原个人数据目录。
