# DeepSeek Harness 接手：整改关 1 收尾与复验

更新时间：2026-09-27。工作目录 `F:\AI\大观园本地`，分支 `codex/merge-dual-ui`，基线提交 `d96566b`。本仓库有大量未提交成果和未跟踪源码；这些都是要保全的现有工作。不得 `reset`、`clean`、`stash`、覆盖整批文件、提交、推送、部署或替换发布包。

## 任务边界

只完成 `docs/ui-redesign/REMEDIATION-CONTROL.md` 的整改关 1「功能兼容」，依据 `docs/ui-redesign/remediation-1-acceptance.md` 的独立验收问题。修复后停下等待 Codex 再次独立验收；不得自行进入视觉关、最终回归或桌面/Cloudflare 工作。真实用户凭据、真实官网同步和真实 `data/` 不得触碰。测试统一使用隔离 `DAGUAN_DATA_DIR`；模拟第三方 AI 与官网接口。

## ZCode 已做到哪里

ZCode 在额度耗尽前修改了 `web/app-new.js`、`test/new-ui-compat.test.mjs`，新增 `.build/ui-redesign/remediation-1/qa/remediation-qa2.py` 和机器结果。它已经尝试修复三项阻断：

1. 让新版的 `daguan_local_progress_v1` 回到旧版的题号顶层映射形状，并使用独立的 `daguan_local_favorites_v1`；兼容先前新版包装形状。补了 `sessionStorage` 学习位置以支持离线跨版本恢复。
2. 恢复备份增加回滚快照、待对账标记和服务端 `PUT /api/state` 对账；刷新时避免服务端旧状态覆盖尚待对账的本地恢复内容。
3. 备份批注改为旧版 `{markdown,updated_at,history}` 形状；新增 last-study 保存失败检查和延迟 AI 流切换测试。

独立复跑当前工作树：`npm test` **113/113 通过**，`npm run verify` **6342 题、6342 唯一题号通过**（历史缺 21 张题图）。ZCode 的 `.build/ui-redesign/remediation-1/screenshots/remediation-results2.json` 记录 R1–R4 共 **11 项检查通过、0 个未捕获 JS 错误**。这只是实施者自测，尚未通过 Codex 独立复验。`docs/ui-redesign/remediation-1-report.md` 的最后修改时间仍在本轮修复之前，内容仍声称旧版存储/备份行为和 108 项测试，必须改成实情。ZCode 的 18095/18096 隔离服务可能仍在运行，不要误用真实数据目录。

## 现在需要完成

1. 先读取 `REMEDIATION-CONTROL.md`、`remediation-1-acceptance.md`、本文件及当前源码，核对工作树和未提交改动，不重复做已经完成的修改。
2. 独立检查修复的正确性，特别是旧用户纯映射升级、之前新版包装格式迁移、在线/离线双向切换、收藏和批注不被服务端旧状态覆盖、有效备份恢复失败的回滚与重试、409 revision 冲突、last-study 失败留页、延迟 AI 生成中的拒绝/确认切换。发现问题只修当前关。
3. 运行 `npm test`、`npm run verify`、相关语法检查，以及隔离数据中的真实浏览器流程。可以参考 `remediation-qa2.py`，但不能只相信它的结果；至少重跑原 `.build/ui-redesign/remediation-1/qa/remediation-qa.py` 的 15 项回归，并补对修复失败路径的独立断言。不得向真实官网写入。
4. 根据**实际**结果更新 `docs/ui-redesign/remediation-1-report.md`，准确区分通过、失败、未测；保存复验日志/截图/隔离数据路径。若不能完成或有阻断，直接报告具体原因，不写“全部通过”。
5. 最终只回复“整改关 1 待 Codex 复验”及文件/检查摘要，然后停止。不要启动关 2。

## 模型

用户指定 DeepSeek V4 Flash。使用 Harness 中的 DeepSeek 官方 Flash 路由，不切换 Pro。DeepSeek 官方 API 文档说明旧名 `deepseek-v4-flash` 已退役并被映射到 DeepSeek-V4.1-Flash；如果当前 Harness 列表显示 `DeepSeek-V41-Flash`，选它并在报告里写明实际模型标识。不要改变现有凭据配置。
