# 整改关 1 独立验收：不通过

验收日期：2026-09-27。范围依据 `REMEDIATION-CONTROL.md` 的关 1；未放行视觉精修或最终回归。基线仍是 `d96566b`，当前工作树未提交；本次验收未修改产品源码、未连接真实官网、未改用户数据。独立浏览器使用 `127.0.0.1:18097` 与隔离数据目录 `.build/ui-redesign/acceptance-independent/data`。

## 已通过的检查

- 独立复跑 `npm test`：108/108 通过。
- 独立复跑 `npm run verify`：6342 题、6342 个唯一题号；仍缺 21 张历史题图。
- `node --check web/app-new.js` 通过。
- 查看 ZCode 提供的桌面与手机截图，确认实际浏览器曾渲染新旧页面；手机 AI 输入的尺寸问题留待关 2。
- ZCode 的快照压缩包存在且 SHA-256 与报告一致：`1c8bbaba879d31f3d06a030952d2e8471379af4f2c603d99c1f42daa92561357`。

## 阻断项 1：新旧版共享本地进度键的数据形状不一致（P0）

`web/app-legacy.js` 的 `loadProgress()`（约 279–292 行）把 `daguan_local_progress_v1` 直接当作 `{题号: 状态}`；收藏另存于 `daguan_local_favorites_v1`。新版 `web/app-new.js` 的 `StorageService.getProgress/saveProgress()`（约 177–203 行）把同一个进度键改写为 `{progress: {题号: 状态}, favorites: [...]}`，且没有写旧版收藏键。

独立浏览器通过真实点击新版的“收藏”后，记录到该键的顶层只有 `progress`、`favorites`，没有题号 `3356`，旧版独立收藏键为 `null`。随后仅模拟 `/api/state` GET 返回 503 并打开旧版，旧版同样没有顶层题号 `3356`。证据：`.build/ui-redesign/acceptance-independent/contract-results.json`。当前有服务端时的双向切换测试依赖服务端水合，掩盖了浏览器共享键被破坏的事实。`REMEDIATION-CONTROL.md` 明确要求沿用同一套学习数据，且两版立即可见。

修复标准：统一为旧版已经使用的存储形状和收藏独立键，或设计双向兼容迁移；不能以服务端在线作为本地共享前提。补充浏览器回归：服务端状态接口不可用时，在两版各做一次收藏、掌握、批注，往返切换及刷新后题号和状态仍一致；同时验证旧用户现存纯映射数据升级后不丢。

## 阻断项 2：备份恢复成功后刷新丢失收藏与批注（P0）

`web/app-new.js` 的 `restoreBackup()`（约 2691–2741 行）只改写浏览器 localStorage 并显示“恢复完成”，没有与服务端状态对账。下一次 `StateSync.hydrate()`（约 540–555 行）无条件使用服务端的 favorites 和 annotations 覆盖刚恢复的本地值。

独立浏览器上传有效 v3 备份，恢复后本地收藏包含 `3357`，批注包含 `3357`；刷新后收藏退回服务端旧值 `3356`，`3357` 批注消失。证据同上。现有 E2E A9 只上传了无效 JSON，未测试有效备份的刷新/跨版本结果。报告已提及“服务端追赶依赖后续逐题写入”，但这个实测结果比延迟追赶更严重：界面先报成功，刷新即丢数据。

修复标准：有效备份恢复要在保留可回滚快照的前提下完成服务端对账，或明确等待/报告未同步状态并保证刷新不会覆盖；失败不能显示成功，也不能留下部分写入。补充有效备份恢复后刷新、切旧版、重新启动隔离浏览器的测试。不得把真实官网同步当作恢复过程的一部分。

## 阻断项 3：新版导出的批注备份并非旧版同构（P1）

`buildBackupPayload()`（约 2608–2629 行）导出的 annotations 来自 `StorageService.getAnnotations()`，字段是 `{content,lastModified,history}`；旧版 `app-legacy.js` 的批注读取/渲染使用 `markdown`。ZCode 自己导出的 `.build/ui-redesign/remediation-1/files/daguan-progress-2026-09-27.json` 里，题号 `3356` 的批注字段实际为 `content`、`lastModified`、`history`。这不符合报告称的“旧版同构格式”，也不满足跨版本备份兼容。

修复标准：导出标准的 `{markdown,updated_at,history}`，导入时兼容已有新版测试产物；用真实导出的文件恢复并在旧版打开同题批注核对内容。

## 仍需验证

- ZCode 的 E2E 使用立即完成的模拟 SSE；没有实际验证“AI 正在生成时拒绝切换继续生成、确认后停止”的时序。修复后用可控延迟流覆盖两条分支。
- `StateSync.pushLastStudy()` 吞掉写入失败，`ensureFlushed()` 对进行中的写入最多等 5 秒且不检查完成结果。需用延迟/失败响应核查切换前保存学习位置的承诺，不能只测批注 500。
- 真实第三方 AI 与真实官网同步未测试，按关 1 约束继续保持未验证，不使用个人凭据。

结论：**整改关 1 不通过；只修复并复验当前关，不进入关 2。**
