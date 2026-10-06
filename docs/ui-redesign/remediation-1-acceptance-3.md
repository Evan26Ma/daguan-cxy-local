# 整改关 1 第三次独立验收：通过

后续关 2 审查补充（2026-09-27）：关 1 的自动测试与隔离浏览器用例没有实际覆盖帕拉迪宇视频映射和新版题库搜索筛选。关 2 发现新版遗漏加载 `paradiyu-linear-video.json`，搜索和筛选仍是空操作；这些缺口已补齐，并用桌面和手机浏览器真实点击验证。原关 1 结论仅适用于当时列出的验收项，不应据此推断视频与题库全部通过。见 `remediation-2-acceptance.md`。

日期：2026-09-27。仅验收功能兼容与数据可靠性；不放行视觉精修关。工作树为 `codex/merge-dual-ui`，HEAD `d96566b`，既有未提交修改原样保留。未推送、部署、提交、替换发布包或触碰真实学习数据及官网同步。

## 本轮失败原因与处置

DeepSeek Crew Flash worker `hub-3-muj70yf3` 最终状态为 `failed`：`DeepSeek Messages stream: tool input is invalid JSON`（`MALFORMED_RESPONSE`）。这是模型生成的工具参数无法解析；不是 PowerShell 工具损坏、余额错误或代码测试失败。按既定要求已用 `dsh_worker_result` 收取该 worker 的最终结果。中止前的离线待同步日志和 6 项自动测试已写入工作树，Codex 没有丢弃这些有效修改。

独立代码检查发现其旧版路径仍缺批注补写：旧版读取待同步日志后只补写题目状态。Codex 在 `web/app-legacy.js` 增加旧版批注补写、冲突重试与联网/回到前台的重试入口，并调整相关 UI 契约断言。改动只针对关 1 的缺口。

## 验收证据

| 检查 | 结果 |
|---|---|
| 默认自动测试 | `npm test`：121/121，通过；包含新增的离线批注、清空批注、收藏、409/500、刷新与待同步日志测试 |
| 题库数据 | `npm run verify`：6342 题、6342 个唯一题号，通过；仍警告缺 21 张历史题图 |
| 语法 | `node --check web/app-new.js`、`web/app-legacy.js`、`web/ui-version.js` 通过 |
| 新版离线批注 | 独立 Playwright 操作题号 3356，令状态读取返回 503 后输入批注；联网刷新后本地批注保留，隔离服务端也取得批注；`offline-annotation-result.json` 的 `lost=false` |
| 新版离线收藏 | 同样操作收藏；联网刷新后本地仍收藏，服务端取得收藏；`offline-favorite-result.json` 的 `lost=false` |
| 新版失败写入 → 旧版补写 | 独立 Playwright 令批注及题目 PATCH 返回 500，分别写批注、切换收藏，再打开旧版。旧版在同一道题补写两项，待同步日志清空，未捕获 JS 错误；同时在隔离服务端改动另一道题，补写后该改动仍保留。见 `cross-version-replay-result.json` |
| 先前关 1 场景 | 上一轮 DeepSeek 报告记录 8 个 Playwright 脚本、56 项检查、0 失败，覆盖模拟 AI 流、备份恢复、工具入口、保存失败和跨版本流程；本轮修改未触及这些业务流程，自动测试保持全绿 |

浏览器证据位于 `.build/ui-redesign/remediation-1/codex-acceptance/`，仅使用隔离服务 `127.0.0.1:18130` 和该目录下的独立数据。`remediation-1-acceptance-2.md` 的丢失复现保留作为历史失败记录；上述 JSON 已在修复后重跑。跨版本脚本 `cross-version-replay.py` 可重复运行，每次使用唯一批注内容，并在服务端验证结果。

## 结论与边界

关 1 **通过**：原先的离线批注/收藏丢失已消除，跨新版到旧版的失败写入、补写及无关服务端状态保留得到独立浏览器验证。此结论不等于视觉关通过。未配置真实 AI 档案，因此真实第三方 AI 调用未测；官网同步仅检查入口和模拟流程，未向真实官网写入。21 张历史题图仍缺失，属现有数据资源问题。按阶段约定，停在此处等待下一阶段指令。
