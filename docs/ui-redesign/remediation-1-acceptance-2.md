# 整改关 1 第二次独立验收：不通过

验收日期：2026-09-27。检查对象为 DSH Crew job `hub-2-muj67cik` 完成后的工作树；仍仅验收功能兼容关 1，不放行视觉关。使用独立隔离服务 `127.0.0.1:18130`，数据目录 `.build/ui-redesign/remediation-1/codex-acceptance/data`，未接触真实学习数据或官网。

## 已通过

- `dsh_worker_result` 确认任务正常结束（`status=done`，Flash 模型）；报告和 56 项 DSH 浏览器检查有文件证据。
- Codex 独立复跑 `npm test`：115/115；`npm run verify`：6342 题、6342 唯一题号（缺 21 张历史题图）；两版主脚本 `node --check` 均通过。
- F1/F2/F3 与上一轮三项阻断的代码和实施者证据已核对，尚无新的反例；这不能抵消下述数据丢失。

## 阻断：普通离线批注在恢复在线后丢失（P0）

独立 Playwright 用真实界面打开题号 3356，令 `GET /api/state` 返回 503，输入批注 `Codex独立离线批注-20260927`。页面显示“已自动保存”，本地键 `daguan_question_annotations_v1` 确实包含该内容。恢复服务并刷新后，本地批注变为 `null`，未捕获 JS 错误。结果及前后截图见 `.build/ui-redesign/remediation-1/codex-acceptance/offline-annotation-result.json`、`offline-before.png`、`online-after.png`。

根因与 DSH 报告 §8.1 一致：`web/app-new.js` 的 `autoSaveAnnotation()` 离线时仅本地落盘并清除 dirty 标记；`StateSync.hydrate()` 在线后把服务端 `annotations` 整体覆盖本地。离线收藏也走服务端数组优先的水合路径，需同关验证。控制文档关 1 明确要求共享批注/收藏、保存可靠，且不得用过时服务端数据覆盖刚写入内容，因此这项属当前关阻断，不能列为后续视觉关或关 3 遗留。

补充独立复现：同一隔离实例另开干净浏览器，离线收藏题号 3356 后，本地收藏数组为 `["3356"]`；恢复在线并刷新后数组变成 `[]`。证据 `.build/ui-redesign/remediation-1/codex-acceptance/offline-favorite-result.json`。批注和收藏均确认存在同类丢失。

## 当前关整改与复验要求

1. 新版普通离线编辑的批注（更新和清空）以及收藏（添加和取消）须记录待同步状态；恢复在线或刷新时保留最新本地编辑并安全对账，不能用旧服务端值覆盖。
2. 处理 revision 409、服务端 500、刷新与跨新旧版切换。失败时保留本地编辑和待重试状态；重试成功后两版及服务端一致。不得以整份旧本地状态覆盖无关的服务端新改动。
3. 将上述路径加入默认自动测试，并在隔离浏览器以真实操作复验；报告明确通过、失败和未测。原 115 项及题库校验须保持通过。
4. 仍只做整改关 1，不推送、不部署、不使用真实凭据或同步。修完停下等待 Codex 再验收。
