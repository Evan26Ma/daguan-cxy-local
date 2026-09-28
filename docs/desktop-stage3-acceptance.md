# 桌面版阶段 3 独立验收（2026-09-28）

结论：**通过，附明确未验证项**。实现和隔离 QA 已通过。用户于 2026-09-28 明确选择跳过正式安装器在干净 Windows 用户环境中的实装验收，因此此项不作为第三关阻塞；不得将它表述为已验证。现放行阶段 4。

## 已独立验证

- 发现并要求修复安装根与数据根同在 `%LOCALAPPDATA%\DaguanMath` 的卸载风险。现在桌面程序安装根为 `DaguanMathDesktop`、浏览器程序安装根为 `DaguanMathBrowser`，两者保留共享数据根 `DaguanMath\data`；原个人目录未修改。
- 正式 Squirrel nupkg 扫描 1,596 项，0 非 ASCII 文件名、0 重复，七个桌面打包副本 shard 均为 ASCII 名。QA 身份 `DaguanMathStage3QA` 的真实 Setup 完成安装、首次启动、卸载和重装；卸载注册项及开始菜单/桌面快捷方式随安装出现、随卸载移除。外置 QA 数据中题号 3356 的 `mastered`、收藏和学习位置重装后仍在，`state.json` 保留；退出后主进程、服务进程和实例锁均消失。真实窗口可搜索并打开题号 3356，KaTeX 公式正常。
- 第一次独立迁移 UI 测试发现 `App.previewLegacyBackup is not a function`，已退回本关修正。修正后，我在 `127.0.0.1:8097` 隔离服务运行 `.build/stage3-parent-qa/verify_migration.py`：预览不写入；目标 revision 在预览后变化时拒绝旧结果并要求重新备份；最终 3356 采用较新来源的掌握状态、收藏、批注和学习位置，3357 保留较新目标的掌握状态，其他目标字段未丢；浏览器页面错误为空。最终状态 revision 24。隔离服务已通过本地停止 API 正常退出。
- 我独立运行带 Playwright 的 `npm test`：164/164 通过、0 跳过；`npm run verify`：6,342 题与唯一题号通过，仍有原有 21 张缺图警告；`git diff --check` 通过。正式桌面 Setup 与浏览器 ZIP 的 SHA-256 与阶段报告一致。

## 仍需完成

- **用户于 2026-09-28 明确选择跳过**在干净 Windows 用户环境执行正式 `DaguanMathDesktop-Setup.exe`。隔离 QA 身份 `DaguanMathStage3QA` 的安装闭环已通过，但不能证明正式安装器在全新 Windows 用户配置下的表现。发布说明需显式列出此未验证项。
- 此阶段产物保持本地工作分支，未提交、推送、部署或发布。阶段 4 仍需独立验收两版本真实升级及发布资产。
