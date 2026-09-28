# 桌面版阶段 2 独立验收（2026-09-28）

结论：**通过**。基线为 `main` 的 `c0c8cc9d00f9e78e5abad0d56674d3de1d20008e`，实现留在 `codex/daguan-desktop-stage0` 独立工作树；未提交、推送或发布。

## 独立检查证据

- 阅读 `desktop/electron-main.cjs`、`desktop/policy.mjs`、`desktop/preload.cjs` 及其安全测试；页面使用稳定 `daguan://app` 来源，渲染进程启用 sandbox 与 context isolation，关闭 Node integration；HTML 响应带 CSP，脚本不允许 `unsafe-eval`。当前 UI 的动态内联事件仍依赖 `unsafe-inline`，此限制在阶段报告记录。
- 真实 Windows Forge 窗口操作：新版和旧版做题、收藏共享、保存失败时阻止切换、托盘隐藏与双击恢复、退出取消和确认、自有服务退出后锁释放，均在隔离数据目录验证。品牌栏与 Windows 原生窗口控件为单层；打印打开原生打印窗口，本机打印驱动没有预览，未实际向物理打印机输出。
- 发现并要求修复过两项：备份/导出连续弹两个保存框；无 CSP 的 Electron 安全警告。修复后，我操作备份只出现一个默认 Downloads 的原生保存框，取消后没有第二个弹窗；HTML 成功导出与取消不落盘由子代理另行提供文件和截图。外链 `window.open('https://example.com')` 实际启动系统 Edge `--single-argument https://example.com/`。
- 我独立运行 `test/desktop-csp-smoke.mjs` 连接真实 Electron CDP `9225`：新版/旧版切换、动态收藏、KaTeX 与 AI profile API 正常；securityWarnings、consoleErrors、pageErrors、failedRequests 均为空。
- 我独立运行 `npm test`：155/155 通过、0 跳过；`npm run verify`：6,342 题与唯一题号通过，仍提示 21 张题图缺失；`git diff --check` 通过。

## 后续边界

安装器、迁移、卸载与重装属于阶段 3；更新与公开 Release 属于阶段 4。阶段 2 未实际打印实体纸张；本机打印驱动不提供预览。原个人数据目录和 `main` 保持不变。
