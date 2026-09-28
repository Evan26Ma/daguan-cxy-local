# 桌面版阶段 4 独立验收（2026-09-28）

结论：**本地发布候选通过；公开发布后仍须核验 GitHub 下载资产和更新 feed。** 已按用户要求跳过正式安装器在干净 Windows 用户配置中的实装，不能把隔离 QA 身份的测试写成该项已验。

## 独立复验

- 在隔离数据目录 `.build/stage4-update-qa-data-parent1/data`，亲自运行真实 Squirrel `0.9.0 → 0.9.1` 更新。下载完成而未确认重启时，旧进程仍运行、服务锁存在、题号 3356 收藏保留；确认后由 `app-0.9.1` 启动，新窗口报告 `0.9.1`。浏览器窗口取消并恢复 3356 收藏，桌面窗口分别收到 revision 3 和 4，两个方向的实际按钮状态随之改变。断开更新 feed 后，更新检查报错，本地服务 `/api/health` 仍正常。QA 退出后没有运行中的 QA 进程或服务锁；隔离数据哨兵保留。结果见 `.build/stage4-update-qa/e2e-result.json` 和 `evidence/` 截图。
- 使用 Playwright 模块独立重跑 `npm test`：169/169 通过，0 失败、0 跳过。`npm run verify`：6,342 题与唯一题号通过，仍有原有 21 张缺图警告。`git diff --check` 通过。
- 独立计算候选目录五项原始资产的 SHA-256，全部匹配各自 `.sha256`。桌面 nupkg 有 1,597 个条目，0 重复、0 非 ASCII 路径；没有装入个人学习状态或 AI 配置。包内 `index.html` 与 `landing.html` 链接均指向 `v1.0.0`，Service Worker 缓存标识为 `daguan-shell-v116`。浏览器 ZIP 含独立 EXE 和安装脚本。
- 已审查 `README.md`、Windows 安装教程与 `release-v1.0.0.md`：说明默认新版、旧版切换、共享数据路径、浏览器手动更新、未签名 SmartScreen 提示及正式干净环境安装未测。远程 `origin/main` 仍为 `c0c8cc9`，旧版归档分支仍为 `28a1a6c`；`v1.0.0` Release 尚不存在。没有向 `upstream` 操作。

## 发布后核验

子代理可以将已验收源码提交并推送到 `origin/main`，以 `v1.0.0` 创建非草稿、非预发布 Release，附上五项原始资产和五项 SHA-256 文件。发布后必须核对远端提交、默认分支、资产字节数/哈希、直接下载链接和公开更新 feed；任一失败不得报告为发布完成。

正式 `DaguanMathDesktop-Setup.exe` 在干净 Windows 用户配置中的安装、卸载与重装，是用户明确选择跳过的未验证项。当前 QA 身份的真实安装、卸载与升级通过，但两者不等价。公开更新 feed 也只有在 Release 创建后才能核验。
