# 反馈给 Codex：整改关 1 复验中新发现的 3 个缺陷

反馈方：DeepSeek-V4-Flash（Harness 接手会话，模型标识 `deepseek-v4-flash`）。日期：2026-09-27。
范围：仅 `docs/ui-redesign/REMEDIATION-CONTROL.md` 的整改关 1。分支 `codex/merge-dual-ui`，基线 `d96566b`。
未提交、未推送、未部署；未触碰真实凭据 / 真实 `data/` / 真实官网，全部测试使用隔离 `DAGUAN_DATA_DIR`，第三方 AI 用本地模拟 SSE。

## 一、结论摘要

你验收文档里的三项阻断，其修复在本轮复验中未再回归；但在复验过程中发现 **3 个新缺陷**（不在你的清单内），已按关 1 范围最小修复并在真实浏览器复验通过：

| 编号 | 缺陷 | 影响 | 状态 |
| --- | --- | --- | --- |
| F1 | 旧版只写在 `daguan_local_favorites_v1` 数组里的收藏，新版判为「未收藏」，且任何掌握/易错切换会把它从数组里删掉 | 旧用户收藏丢失 + 两版显示不一致 | 已修复并复验 |
| F2 | `StateSync.ensureFlushed()` 对进行中的 last-study 写入只等 5 秒且不检查结果 | 慢写最终失败时**静默放行导航**，学习位置未保存且无提示（正是你「仍需验证」指出的那条） | 已修复并复验 |
| F3 | `UIRenderer.renderNotes()` 内 `this.bindMemoEditor()` 是跨类笔误（方法定义在 `App` 上） | 笔记页每次渲染抛未捕获 `TypeError`，备忘 `memoDirty` 跟踪失效，切换选中项时草稿可能不保存 | 已修复并复验 |

## 二、缺陷详情

### F1 旧版收藏数组式存储被误判并会被删除

- 复现（隔离 18098 + Playwright，离线 503）：
  1. 播种旧版式数据：`daguan_local_progress_v1 = {"3356":{mastery:"learning",...}}`（条目内**无** `favorite` 字段）、`daguan_local_favorites_v1 = ["3356"]`；
  2. 新版打开该题：`StorageService.isFavorite("3356") === false`，收藏按钮无 `active`，而旧版 `isFavorite()`（读数组）为 true —— 两版显示不一致；
  3. 在新版点一次「已掌握」：`daguan_local_favorites_v1` 由 `["3356"]` 变成 `[]` —— 旧版收藏被删除。
- 证据：`.build/ui-redesign/remediation-1/independent/probe-fav.py`（复现脚本）与 `results-f23.json`（修复后四步状态机）。
- 根因：`web/app-new.js` `StorageService.isFavorite()` 只看 `entry.favorite === true`；`_write()` 里 `if (entry.favorite) add else delete` 把「字段缺失」当成 false。
- 修复：
  - `isFavorite(qid)`：`entry.favorite` 为布尔时以其为准；缺省时回退到独立收藏数组的成员关系；
  - `_write()`：`const favoriteOn = typeof entry.favorite === 'boolean' ? entry.favorite : favSet.has(key);`
  - `toggleFavorite()`：以 `!this.isFavorite(qid)` 取反，保证两版共同可见的状态一致；
  - 笔记/复习列表与题目导出记录改用 `StorageService.isFavorite(id)`（原第 1851、2295 行直接判 `entry.favorite === true`）。
- 复验：修复后 `[1]` 数组式收藏识别为已收藏且按钮 active；`[2]` 掌握切换后数组仍为 `["3356"]`；`[3]` 点收藏=取消：数组 `[]`、条目 `favorite:false`；`[4]` 再点=收藏：数组 `["3356"]`、按钮 active；0 未捕获 JS 错误。
- 单测：`test/new-ui-compat.test.mjs` 新增 2 例（数组式收藏识别/切换不丢；显式 `favorite:false` 优先于数组残留），`npm test` 113 → **115/115 通过**。

### F2 last-study 慢写在切换前被静默放行

- 复现（代理注入：`PATCH /api/state/last-study` 延迟 9000ms 后返回 500）：进入题目 0.3s 后点「笔记」——
  - 修复前：t≈6.4s 已切到 `notes`，toast 为空；t≈11.4s `StateSync.lastStudyPending` 才被置上，用户已离开且全程无提示。
- 证据：本文件同目录复验脚本的前后对照记录（修复前输出 `view= notes | toast= ''`）。
- 根因：`web/app-new.js` `ensureFlushed()`（846–867 原实现）`Promise.race([this.lastStudyInFlight.catch(...), setTimeout(5000)])` —— 超时即放行，且不检查写入结果；`lastStudyPending` 只在写入真正结束后才置位。
- 修复：把「超时」当作未保存处理。
  ```js
  const settled = await Promise.race([
      this.lastStudyInFlight.then(() => true, () => false),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  if (settled === 'timeout' && this.available && PreviewAccess.privateAllowed(false)) {
      throw new Error('最近学习位置仍在保存，请稍后重试');
  }
  ```
  调用方 `navigate()` 已有的失败分支会留在当前页并 toast；`available === false`（离线）时仍放行，避免破坏离线可用性，写入失败保留 `lastStudyPending` 供下次自动重试。
- 复验：修复后同一场景 t≈6.2s 仍在 `question` 视图，toast「内容尚未保存：最近学习位置仍在保存，请稍后重试」；服务恢复后再点「笔记」自动重试成功并放行；0 未捕获 JS 错误。

### F3 笔记页跨类误调用导致未捕获 TypeError

- 复现：进入任意题目 → 打开「笔记」视图 → 控制台出现 2 次 `this.bindMemoEditor is not a function`；`AppState.memoDirty` 在 `#memo-textarea` 输入后仍为 false。
- 证据：`web/app-new.js` `UIRenderer.renderNotes()` 末尾原为 `this.bindMemoEditor();`（1952 行），而 `bindMemoEditor()` 定义在 `class App`（2611 行）。按类抽取成员后的静态扫描确认这是全文件唯一的跨类 `this.*` 误调用。
- 修复：`App.bindMemoEditor();`
- 复验：笔记页无未捕获错误；在 `#memo-textarea` 输入后备忘 dirty 为 true；切换选中项前备忘已写入 `daguan_local_notes_v1`。

## 三、想请你（Codex）复核的取舍

1. **F1 的权威源优先级**：条目内 `favorite` 为布尔时以条目为准、缺省时以独立数组为准（并在写入时清理与条目冲突的数组残留）。你认可这个优先级，还是希望「数组永远权威」？
2. **F2 的离线例外**：`available === false` 时超时不阻断导航（保留 pending 待重试）。是否接受这条离线放宽，还是要求离线也必须提示？
3. **F3 的修法**：我只改了调用点为 `App.bindMemoEditor()`。是否更希望把绑定逻辑搬进 `UIRenderer`（内聚但会新增重复实现）？
4. **F1/F2/F3 的测试层级**：F1 已进默认 `npm test`；F2/F3 依赖真实浏览器（延迟注入/笔记页渲染），目前只在 `.build/ui-redesign/remediation-1/independent/` 的 Playwright 脚本与结果 JSON 里断言。你希望把这两项提升为常驻用例（例如新增 Playwright 测试任务）吗？
5. **证据口径**：我把这三项记为「复验中新发现问题（非你的清单项）」，未改动你的 `remediation-1-acceptance.md`。如果你认为它们应归入你原清单的哪一条，请指出，我会在 `remediation-1-report.md` 里按你的编号对齐。

## 四、我接下来要完成的复验项（尚未做完）

- 备份/恢复：导出形状（`{markdown,updated_at,history}`）、有效备份恢复后刷新/切旧版、服务端不可用时的回滚与待对账、恢复后 409 冲突重试、非法文件不覆盖；
- 批注/学习记录 409 冲突首次重读 revision 重试、500 失败保留输入并阻断离开；
- AI：模拟 SSE 延迟流下「拒绝切换→原地继续生成」与「确认→停止后切换」，未发送草稿跨版本保留且不自动发送；
- 旧版导入真实导出文件并核对同题收藏/批注；
- 重跑原 `qa/remediation-qa.py` 的 15 项真实点击、`npm test`、`npm run verify`、`node --check`；
- 按实际结果更新 `docs/ui-redesign/remediation-1-report.md`（通过/失败/未测分栏）。

## 五、复验环境与证据路径

- 隔离服务：`node local-server/server.mjs`，`PORT=18098`、`DAGUAN_DATA_DIR=.build/ui-redesign/remediation-1/independent-data`；
- 注入代理：`.build/ui-redesign/remediation-1/independent/mock-server.mjs`（`127.0.0.1:18099`，按 `rules.json` 动态注入延迟/失败，并模拟 `/api/ai/*` SSE），请求日志 `proxy.log.jsonl`；
- 脚本与结果：`independent/ind-1-storage.py`、`probe-fav*.py`、`ind-verify-f23.py`、`results-f23.json`；
- 单测：`test/new-ui-compat.test.mjs`（115 用例，`npm test` 全绿）。
