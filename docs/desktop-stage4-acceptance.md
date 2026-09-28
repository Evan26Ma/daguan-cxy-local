# 桌面版阶段 4 独立验收（2026-09-28）

结论：**v1.0.0 已公开发布，发布后资产、下载直链与 Windows Squirrel feed 核验通过。** 已按用户要求跳过正式安装器在干净 Windows 用户配置中的实装，不能把隔离 QA 身份的测试写成该项已验。

## 独立复验

- 在隔离数据目录 `.build/stage4-update-qa-data-parent1/data`，亲自运行真实 Squirrel `0.9.0 → 0.9.1` 更新。下载完成而未确认重启时，旧进程仍运行、服务锁存在、题号 3356 收藏保留；确认后由 `app-0.9.1` 启动，新窗口报告 `0.9.1`。浏览器窗口取消并恢复 3356 收藏，桌面窗口分别收到 revision 3 和 4，两个方向的实际按钮状态随之改变。断开更新 feed 后，更新检查报错，本地服务 `/api/health` 仍正常。QA 退出后没有运行中的 QA 进程或服务锁；隔离数据哨兵保留。结果见 `.build/stage4-update-qa/e2e-result.json` 和 `evidence/` 截图。
- 使用 Playwright 模块独立重跑 `npm test`：169/169 通过，0 失败、0 跳过。`npm run verify`：6,342 题与唯一题号通过，仍有原有 21 张缺图警告。`git diff --check` 通过。
- 独立计算候选目录五项原始资产的 SHA-256，全部匹配各自 `.sha256`。桌面 nupkg 有 1,597 个条目，0 重复、0 非 ASCII 路径；没有装入个人学习状态或 AI 配置。包内 `index.html` 与 `landing.html` 链接均指向 `v1.0.0`，Service Worker 缓存标识为 `daguan-shell-v116`。浏览器 ZIP 含独立 EXE 和安装脚本。
- 已审查 `README.md`、Windows 安装教程与 `release-v1.0.0.md`：说明默认新版、旧版切换、共享数据路径、浏览器手动更新、未签名 SmartScreen 提示及正式干净环境安装未测。公开发布后，GitHub 默认分支 `main` 为 `a216ed87315c0e3966b33a4ab7dd4f2f26589d55`，`v1.0.0` 指向该提交并列为 latest；旧版归档分支及 Release `v2026.09.27-r27` 未修改。没有向 `upstream` 操作。

## 发布后核验

- GitHub Release `v1.0.0` 为非草稿、非预发布并列为 latest，含 10 项资产（五项原始文件和五个 `.sha256`）。API 状态均为 `uploaded`；各项大小与 SHA-256 digest 均与候选一致。
- Setup、浏览器 ZIP、完整 nupkg 的公开下载直链 HEAD 均返回 HTTP 200。发布流程自身有一次间歇性 GitHub 连接超时；负责人独立复核了这三项下载。
- Windows Squirrel feed `https://update.electronjs.org/Evan26Ma/daguan-cxy-local/win32-x64/0.9.0/RELEASES` 返回 HTTP 200，正文指向 `DaguanMathDesktop-1.0.0-full.nupkg`，长度 421,888,326。`/win32-x64/1.0.0/RELEASES` 返回 HTTP 200；顶层 `/win32-x64/1.0.0` 返回 HTTP 204。顶层 `/win32-x64/0.9.0` 发布瞬间曾返回一次 HTTP 500，重查为 HTTP 200；Windows Squirrel 实际读取 `/RELEASES` 子路径。
- 未来 `v1.0.1` 真实公网版本升级尚未测试；本次两版本升级验证使用隔离 QA 身份和本地 feed。

正式 `DaguanMathDesktop-Setup.exe` 在干净 Windows 用户配置中的安装、卸载与重装，是用户明确选择跳过的未验证项。当前 QA 身份的真实安装、卸载与升级通过，但两者不等价。
