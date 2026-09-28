# 桌面版阶段 4 发布候选报告

状态：候选包和文档已生成，**尚未提交、推送或公开 Release**。本报告供独立验收；用户同意发布后，首个桌面 Release 使用 SemVer tag `v1.0.0`，package/app version 为 `1.0.0`。

## 更新实现

- Windows x64 打包版通过 Electron `autoUpdater` 查询 GitHub Release 更新；feed 路径为 `https://update.electronjs.org/Evan26Ma/daguan-cxy-local/win32-x64/${app.getVersion()}`。首次延迟检查，之后每 6 小时检查。浏览器版仍手动下载更新。
- 更新在后台下载。就绪后品牌栏和托盘菜单提供“重启并安装更新”；只有用户确认后才退出和安装。确认时先等待桌面版拥有的共享服务退出；若不能确认服务安全退出，就保留当前版本并提示重试。连接到浏览器版服务时，桌面退出不会擅自结束该服务。
- 更新状态与错误只记录在 `%LOCALAPPDATA%\DaguanMath\data\logs\desktop-updater.log`；没有遥测或日志上传。更新 feed 可通过 `DAGUAN_UPDATE_FEED_URL` 覆盖，用于隔离测试；正式构建未设置该变量。
- 首版未签名；Windows 可能显示 SmartScreen 未知发布者警告。浏览器 ZIP/单文件版仍由用户手动更新。

## 两版本真实更新与窗口证据

脚本：`python test\squirrel_update_e2e.py`。它对真实 Squirrel 安装器使用独立身份 `DaguanMathStage4QA`，安装根 `%LOCALAPPDATA%\DaguanMathStage4QA`，隔离数据根 `.build\stage4-update-qa-data-rerun17\data`；没有读取或覆盖 `%LOCALAPPDATA%\DaguanMath`。

- 更新版本：`0.9.0` → `0.9.1`。本地 feed：`http://127.0.0.1:2870/win32-x64/0.9.0`。0.9.0 `RELEASES` 行：`BF901BD95CE7CD67D605AB984D48DDF1B7A6F41A DaguanMathStage4QA-0.9.0-full.nupkg 421888354`；0.9.1 `RELEASES` 行：`ED3787EC1EB5C0F75D17F5DCE061FEE629BC0045 DaguanMathStage4QA-0.9.1-full.nupkg 421888367`。
- 下载待安装时，0.9.0 主进程 PID `71236` 仍运行，服务 PID `114016` 的 `.service-instance.json` 锁存在，题号 3356 收藏为 true。点击“重启并安装更新”并接受确认后，Squirrel 从 `app-0.9.1\DaguanMath.exe` 启动 PID `111416`；重新附加调试端口后的窗口报告 `app.getVersion() = 0.9.1`，服务锁和收藏仍在。更新流程自动启动的进程不保留临时调试参数；之后仅在隔离 QA 安装中正常停服务并重新打开同一 0.9.1 可执行文件，以完成窗口断言。
- 同一学习位置在真实桌面窗口和独立 Chrome 窗口同时打开。服务 revision 从 2 增至 3（跨窗口取消收藏），再增至 4（恢复收藏）；桌面 preload 分别收到 revision 3、4，桌面页 `document.visibilityState` 为 visible，3356 收藏按钮两方向均按服务端状态刷新。`crossWindowFavoriteSync=true`。
- 断开本地更新 feed 后触发更新错误事件，浏览器窗口的 `/api/health` 仍成功，说明更新源失败不影响本机学习服务。正常桌面版状态日志顺序包含 `checking → available → downloaded → started`。
- 结果 JSON：`.build\stage4-update-qa\e2e-result.json`。截图：`.build\stage4-update-qa\evidence\update-ready-0.9.1.png`（已下载，尚未确认重启）、`updated-0.9.1.png`（升级后）、`offline-update-check.png`（更新源不可用）。隔离数据哨兵在 QA 卸载后保留；测试退出后没有 QA 服务锁或 QA 应用进程。

## 检查结果

- `npm test`：169/169 通过、0 失败、0 跳过（另由独立验收复跑并启用 Playwright）。本报告中的升级与双窗口回归由 Python Playwright 对实际 Electron/Squirrel 进程完成。
- `npm run verify`：6,342 题及 6,342 个唯一题号通过；有 21 张既有题图缺失警告，补图需要未提供的 `DAGUAN_ASSET_TOKEN`，未运行联网资源同步。
- `node --check desktop\electron-main.cjs`、`desktop\preload.cjs`、`desktop\updater.cjs` 与 `python -m py_compile test\squirrel_update_e2e.py` 通过。
- 最终候选重建：`npm run package:desktop:windows` 产出正式 Squirrel Setup、`RELEASES` 和完整 nupkg；`npm run package:browser:windows` 完成 ZIP 解压、安装脚本 `-ValidateOnly` 和单文件 SEA smoke 检查。已从正式 nupkg 读取 `index.html`、`landing.html`、`service-worker.js`，确认链接指向 `v1.0.0` 且缓存版本为 `daguan-shell-v116`。
- `v1.0.0` tag 和 Release 当前均不存在。公开更新 feed 在 Release 尚未创建时返回 404，这是预期；不能据此证明公开升级服务已上线。阶段 4 的两版本真实升级使用本地 feed。

## 候选资产

所有文件位于 `.build\stage4-release-candidate\`，发布前不得将它们当作已公开下载：

| 资产 | 大小 | SHA-256 |
|---|---:|---|
| `DaguanMathDesktop-Setup.exe` | 422,521,856 B | `2139a96a85cf3d5865acb3814ae4241edaa703b0e9ce95f86d327be15816f6ac` |
| `DaguanMathDesktop-1.0.0-full.nupkg` | 421,888,326 B | `2b76325236409ae28aeaf2bfe4d9704f9797bc3dd1dfcc7e948295fa891ba379` |
| `RELEASES` | 88 B | `fbd01f6acf8135c5ef67aa9a97f8a4f18f71215f66c2b89944e896e292868ba2` |
| `DaguanMath-windows-x64.zip` | 310,789,161 B | `bd21f9a6f0827cd1679f900cab9ce2efe08b5e77ca5e5b1bbf9a603f42cdc40f` |
| `DaguanMath-windows-x64.exe` | 368,288,768 B | `3ed5c3757037726785d3a3d316fdc53dc85d27b9e952225065342676aeda4003` |
| 五个 `.sha256` sidecar（含 `RELEASES.sha256`） | — | 候选目录中随包提供，已逐项核对 |

桌面 Release 必须同时附上 `RELEASES`、`DaguanMathDesktop-1.0.0-full.nupkg` 和 `DaguanMathDesktop-Setup.exe`，才能供 Squirrel 更新服务选取。浏览器包有 ZIP、单文件 EXE 和校验 sidecar。

## 未验证项目

- 用户按计划明确选择跳过了正式 `DaguanMathDesktop-Setup.exe` 在干净 Windows 用户配置中的安装验收（阶段 3 验收记录及[阶段 3 报告](desktop-stage3-report.md)）。QA 更新使用不同 Squirrel 身份 `DaguanMathStage4QA`；这不等同于正式安装器在干净环境的验证。公开发布说明必须保留这一点。
- 未在公开 GitHub Release 上运行更新；当前 `v1.0.0` 尚未发布。只有 Release 创建并包含上述三项 Squirrel 资产后，公共 feed 才能验证。`v1.0.0` 占用检查已完成，tag/release 未占用。
- Windows 未签名包的 SmartScreen 提示无法消除；按已确认选择，本首版不签名。
- 题库仍有 21 张缺失图片，资源同步未执行。
