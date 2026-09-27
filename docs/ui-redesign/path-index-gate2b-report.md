# 目录返工 Gate 2B 验收记录

## 范围

以恢复快照 `.build/ui-redesign/path-index-execution/snapshot-before-legacy-catalog-20260927-165505` 为基线，只改新版目录逻辑与样式、目录测试和测试脚本。快照中的第三关多题代码仍在，未覆盖旧版页面或题库数据；旧版导航文件未改。本次保留六主题和新版页面骨架，把原来“当前同级目录 + 内容区重复子章卡片”改为全部科目/一级章侧栏与逐级章节选择器。

实现包括桌面 280px 侧栏、题库页与做题页的“选择小节”入口、桌面逐列和手机底部抽屉、完整可换行路径、回退与方向键/Home/End/Enter/Escape、路径/滚动/查询状态保存、总题数与练习筛选数区分，以及完整/严选/真题范围。范围判定沿用旧版：严选看 `is_core`，真题看 `source/year/category` 上的旧正则，并与现有详细筛选、搜索共同生效。完整范围没有详细筛选或查询时直接使用题目映射，不预加载章节分片。

混合节点通过“本级直属题”独立进入；空节点不提供练习入口。章节切换和范围切换前先完成保存，失败时留在原题；新范围为空时恢复原范围；队列变化后按题号保留仍存在的当前题。

## 验收结果

- 浏览器使用独立 `DAGUAN_DATA_DIR` 和临时 Chromium context；尺寸为 1440×900 和 390×844。
- 目录实际包含 6 个科目（含“未分类”），桌面能够逐列打开 9 个节点深度；手机抽屉只显示当前层，标题/路径与当前目录一致，整条路径在屏幕内换行可见。
- 键盘 Home、End、方向键、Enter、Escape 可用；关闭菜单后焦点返回入口。做题页可重新打开章节菜单。
- 1146 显示 6 道本级直属题，4 个子章仍可达；389 保持在目录并只显示一个空节点说明。
- 浏览器验证完整/真题/严选入口、严选零结果回退、保存失败时不切题、范围切换后保留仍在队列中的题号，以及从一级叶章进入后返回原目录位置。
- 浏览器控制台错误 0，失败请求 0。
- `node --check web/app-new.js`、`node --check test/new-ui-catalog.test.mjs`、`git diff --check` 通过。`npm test`：130 项通过（原 127 项 + 3 项目录测试）。`npm run verify`：6342 题、6342 个唯一题号通过；报告现有 21 张题图缺失警告，与本次目录代码无关。

## 截图

- [桌面科目选择器](../../.build/ui-redesign/path-index-execution/gate2b/desktop-chapter-picker.png)
- [桌面九层路径选择器](../../.build/ui-redesign/path-index-execution/gate2b/desktop-deep-picker.png)
- [桌面做题页入口](../../.build/ui-redesign/path-index-execution/gate2b/desktop-deep-question.png)
- [桌面空节点](../../.build/ui-redesign/path-index-execution/gate2b/desktop-empty-node.png)
- [手机完整路径章节抽屉](../../.build/ui-redesign/path-index-execution/gate2b/mobile-chapter-sheet.png)

## 独立复核

目录返工实现及本地验收已完成，等待主任务独立检查后再进入后续多题模式验收。本记录不代表第三关或最终回归已通过。
