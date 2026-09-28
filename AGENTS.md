# 项目接手指南

## 先区分三层

- **运行入口**：Electron 桌面版由 `desktop/electron-main.cjs` 管理窗口、托盘和更新；本地浏览器版由 Node 服务启动并打开系统默认浏览器。两者连接同一用户数据目录。
- **本地服务**：`local-server/server.mjs` 提供页面 API 和唯一写入入口；`local-server/store.mjs` 管理本地记录。桌面与浏览器启动器应发现并复用已有服务。
- **学习界面**：新版入口是 `web/index.html` 和 `web/app-new.js`；旧版入口是 `web/legacy.html` 和 `web/app-legacy.js`。`web/ui-bootstrap.js` 负责选择界面。两个运行入口都可使用新旧界面。

改动前先运行 `git status --short --branch`，确认当前 checkout、分支和已有改动；不要假定主 checkout 或未跟踪文件可丢弃。

## 关键位置与验证

- Electron 安全、IPC 和页面来源：`desktop/electron-main.cjs`、`desktop/preload.cjs`、`desktop/policy.mjs`；自动更新：`desktop/updater.cjs`。
- 服务实例排他和恢复：`local-server/instance-lock.mjs`。已安装 Windows 桌面版和浏览器版共用 `%LOCALAPPDATA%\DaguanMath\data`；开发服务未设置 `DAGUAN_DATA_DIR` 时使用仓库 `data/`，隔离测试应显式指定临时目录。
- 题库清单与分片：`web/data/manifest.json`、`web/data/shards/`；修改后运行 `npm run verify`。
- 常用命令以 `package.json` 为准：`npm ci`、`npm test`、`npm run verify`、`npm start`、`npm run desktop:start`。Windows 打包入口为 `npm run package:desktop:windows`（Electron）和 `npm run package:browser:windows`（本地浏览器版）。
- 锁、服务启动或跨窗口状态改动后，至少运行 `node --test test/service-instance.test.mjs test/electron-security.test.mjs`；涉及 UI 或下载入口时，再运行对应 `test/*.test.mjs`。
- 手动启动服务或桌面版做验证时，先将 `DAGUAN_DATA_DIR` 指向新的 `%TEMP%` 子目录；不要把测试记录写入日常用户数据。

## 数据与实例锁边界

同一数据目录只能有一个服务进程写入。`.service-instance.json` 是服务 owner 租约，创建使用独占方式；`.service-instance.recovery` 串行化 stale 租约回收。有效 owner 只有在 PID 被明确判定不存在、且租约未变化时才能回收；损坏租约须先经过代码中的宽限期并在恢复闸门内检查。进程存活、PID 状态不明或锁内容变化时应停止并保留数据。服务运行中不得手动删除这两个文件；若恢复闸门在意外退出后遗留，先确认没有使用该目录的服务进程，再按报错检查处理，不要自动猜测清理。

单元和集成测试应使用临时数据目录。不要在测试、打包或调试中读取、覆盖或清理真实 `%LOCALAPPDATA%\DaguanMath\data`。

## 分支、安装与发布

开始工作前核对分支、远端和工作树；提交不代表已推送或发布。公开发行前核对 GitHub 默认分支、tag、Release 资产及校验值，并确认目标远端。已安装程序不会自动包含工作树修改；当前 stale-lock 修复只在开发工作树本地提交，尚未推送、打包或安装进已安装的 1.0.1。

## 按需阅读

- Windows 安装、启动或卸载问题：读 `docs/Windows新手安装与配置.md`。
- 旧浏览器记录迁移或阶段验收细节：读 `docs/desktop-stage3-report.md`。
- 自动更新、打包证据或发布资产规则：读 `docs/desktop-stage4-report.md` 和 `docs/release-v1.0.0.md`；发布状态以当前 GitHub Release 为准。
- 修改百度网盘下载地址或落地页下载说明：读 `docs/百度网盘下载与引导页配置.md`。
