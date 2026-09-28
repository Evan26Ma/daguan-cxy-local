# 桌面版阶段 3 报告

本阶段实现了旧浏览器学习备份预览合并、Windows x64 Squirrel 桌面包和独立浏览器包，并将两种安装方式的程序目录与共享学习数据目录分开。未推送、未发布，也未运行正式安装器覆盖现有用户目录。

## 迁移行为

- 导入流程先解析备份并显示逐题预览；用户确认后先下载并保存当前目标端备份，再提交合并。
- 只迁移进度、收藏、批注和 `last_study` 学习位置；不导入外观、快捷键或 AI 草稿。
- 按各字段修改时间决定冲突胜者；若时间缺失或无法比较则保留目标端记录。提交时携带 revision，目标端版本已变化则重新预览。
- 迁移函数测试覆盖逐字段时间合并、旧映射格式、忽略无关设置、无时间目标优先与无效备份拒绝。

## 安装目录

- 桌面 Squirrel 安装根：`%LOCALAPPDATA%\DaguanMathDesktop`。
- 浏览器包程序根：`%LOCALAPPDATA%\DaguanMathBrowser`。
- 新共享学习数据根：`%LOCALAPPDATA%\DaguanMath\data`。
- 浏览器卸载仅移除自己的程序文件和快捷方式；兼容旧 `DaguanMath` 程序根，旧目录下的 `data` 不会删除。安装脚本拒绝程序根与共享数据根重叠。

Squirrel 的 NuGet/卸载注册代码无法正确索引中文 shard 文件名，会将七个路径解码成重复的问号路径并导致 Setup 失败。Forge 的 Windows 打包副本在 `afterCopy` 中将 shard 文件重命名为 `shard-01.json` 到 `shard-07.json`，并只更新副本 manifest 的 `shards[*].file`；JSON 题目内容及开发/浏览器题库格式不变。桌面包还排除了四个非 ASCII 仓库根级文档/脚本名。正式完整 nupkg 扫描到 1596 个条目，非 ASCII 路径 0 个、重复路径 0 个。

## 验证

- 迁移真实浏览器回归：`$env:PYTHONIOENCODING='utf-8'; python test\migration_browser_playwright.py`（完成后清除该环境变量）。连接隔离 QA 服务 `http://127.0.0.1:8097`，预览和取消均保持 revision 19；第一次合并因目标变更停在 revision 20，要求重新预览并下载 revision 20 的备份，确认后合并到 revision 21。最终逐字段验证 3356/3357 进度、收藏、批注、学习位置以及保留目标端无关字段；未迁移 appearance/AI 草稿。工具页浏览器包停止入口显示正常，取消确认后没有发出停止请求；另启动独立临时服务验证确认停止后服务以退出码 0 退出且实例锁释放。页面无异常。截图：`.build/stage3-migration-test/migration-merged.png`。本脚本只使用父代理给出的隔离服务、独立临时服务和临时导入文件，不访问个人数据。
- 修复工具页迁移入口和浏览器包停止入口误调用 `App` 的问题，改为调用静态方法所在的 `UIRenderer`；补充取消合并按钮。应用脚本变更后更新新版脚本及 Service Worker 缓存版本，`test/ui-contract.test.mjs` 中对应版本断言已同步。
- `node --check web/app-new.js`：通过。
- `node --test test/backup-migration.test.mjs test/desktop-package.test.mjs test/runtime-stop.test.mjs`：5 项通过。
- `npm test`：164 项，163 通过、0 失败、1 跳过（跨页面可见性 Playwright 回归因环境未安装 Playwright 而跳过）。
- `npm run verify`：6342 题、6342 个唯一题号通过；已有 21 张题图缺失警告，补图需要未提供的 `DAGUAN_ASSET_TOKEN`，未运行联网同步。
- `node --test test/backup-migration.test.mjs test/desktop-package.test.mjs`：4 项通过。打包副本测试验证 shard 内容逐字节不变且输出路径全部 ASCII。
- `npm run package:browser:windows`：浏览器 ZIP 解压并通过 `install.ps1 -ValidateOnly`；最终隔离路径测试执行安装、卸载、重装、再次卸载，检查程序目录删除、哨兵数据保留、安装根重叠保护和旧路径兼容。测试的 `LOCALAPPDATA` 位于 worktree `.build` 隔离目录。
- 浏览器包路径生命周期验证输出：默认安装到 `DaguanMathBrowser`，共享数据留在同一隔离 profile 的 `DaguanMath\data`；连续两次卸载均删除程序根，`stage3-sentinel.txt` 始终为 `preserve-me`。旧路径测试删除模拟的 `DaguanMath\app` 和浏览器 EXE，同时保留 `DaguanMath\data\sentinel.txt`。
- Squirrel QA 使用不同安装身份 `DaguanMathStage3QA` 与外置数据目录 `%LOCALAPPDATA%\DaguanMathStage3QA-data\data`。真实 Setup 安装成功，卸载注册表项为 `Daguan Math Stage 3 QA`，卸载命令指向 QA 根的 `Update.exe --uninstall`；Squirrel 创建开始菜单和桌面快捷方式。父代理在真实窗口打开题号 3356，确认 KaTeX 显示，并经品牌栏“退出”及浏览器断开确认正常退出；保存了 `%TEMP%\daguan-stage3-qa-{app,search,question,exit-dialog,exited}.png`。
- `Update.exe --uninstall` 实测退出码 0，卸载注册项和两处快捷方式消失，服务锁释放；安装目录仅残留 Squirrel 的 `.dead` 与 `Update.exe`。外置 `state.json` 保留，revision 从 41 变为 42（首次启动规范化状态字段并写入学习位置），题号 3356 的 mastered 与收藏仍为 true。使用同一 QA Setup 重装后，注册项及两处快捷方式重建，服务锁重新指向外置 QA 数据目录，revision 42 的学习记录仍可读。重装后的 QA 窗口/服务等待最后由父代理正常关闭。
- 正式旧程序 `%LOCALAPPDATA%\DaguanMath` 未被打开、覆盖或卸载；它的根目录修改时间仍是 2026-09-07，当前 `%LOCALAPPDATA%\DaguanMath\data` 不存在。

## 产物

以下哈希是阶段 3 当时的检查点。阶段 4 已按最终 `1.0.0` 代码重建桌面和浏览器包；发布候选的当前文件名与 SHA-256 以 [阶段 4 报告](desktop-stage4-report.md) 为准。

- 桌面安装器：[DaguanMathDesktop-Setup.exe](../out/make/squirrel.windows/x64/DaguanMathDesktop-Setup.exe) — SHA-256 `c7c96c75f3036c732d3a75a568d9af24645a945d21613b56cde2117b889da020`。
- 桌面完整包：[DaguanMathDesktop-1.0.0-full.nupkg](../out/make/squirrel.windows/x64/DaguanMathDesktop-1.0.0-full.nupkg)。
- 独立浏览器包：[DaguanMath-windows-x64.zip](../dist/DaguanMath-windows-x64.zip) — SHA-256 `535b4a90aacb2fa2dc94d7c27c43871275579ce1cff0144acad7fda571c73f56`。
- 浏览器单文件 EXE：[DaguanMath-windows-x64.exe](../dist/DaguanMath-windows-x64.exe) — SHA-256 `4c4067976195814603ddee98b51e898261696ce42a5dbd6a6a93d58c024823c9`。
- QA 隔离安装器：[DaguanMath-Stage3-QA-Setup.exe](../.build/stage3-qa-squirrel-ascii/make/squirrel.windows/x64/DaguanMath-Stage3-QA-Setup.exe) — SHA-256 `decc8474bf064f1542d6f93f14e71bfeb8a5b8cde6ba5acbaca42e3a9fa7f747`。只用于验收，身份与正式桌面包不同。
- 桌面完整包 SHA-256：`dfbb5ba40fd87ce0d78e5cb4d46203aacf9ecf3628bf6c6e8b7412ef8ffd7b0d`。

## 尚未完成的验收

- **正式 `DaguanMathDesktop-Setup.exe` 未在干净 Windows 用户配置中实装**：用户明确选择跳过此项（2026-09-28），因此只执行了不同 Squirrel 身份 `DaguanMathStage3QA` 的真实隔离安装、卸载和重装。QA 身份测试不能替代正式安装器在全新 Windows 用户配置下的最终验证；发布说明仍须列出此未验证项。
- 父代理仍需独立复验备份迁移 UI；本次 Playwright 验证通过不代替用户逐关验收。浏览器包真实 GUI 打开以及干净 Windows 环境的完整导入/卸载/重装仍待独立验收。
