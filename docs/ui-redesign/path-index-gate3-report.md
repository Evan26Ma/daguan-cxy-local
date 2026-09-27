# Gate 3：新版多题模式实现与验证报告

日期：2026-09-27

## 结果

新版题目阅读区已提供单题/多题切换。首次进入章节时使用单题；之后记住本机选择。章节学习位置按题目 ID 及阅读模式保存，模式切换、段跳转会先保存当前必要状态；保存失败时保持原模式和题目，并保留未发送 AI 文本与批注以便重试。

多题视图每段最多加载 20 题，题号导航覆盖当前叶章节直属题，可按题号、收藏、易错及未开始/学习中/已掌握过滤。题卡显示完整题干内容，每题答案独立展开，选项、收藏、易错、三态掌握、批注、AI 和视频入口使用对应题目 ID。桌面采用固定题号轨道，手机采用题号抽屉。阅读内容宽度约 760px，AI 面板按需浮层打开，不压缩题目区域。

掌握状态与旧版共享 `not_started`、`learning`、`mastered` 三态；易错标记保持为独立 `error_prone` 字段。题目、收藏、批注、AI 设置和视频继续使用现有共享存储/API，不改变题库格式及旧版页面布局。

## 验证证据

- `npm test`：130 个测试通过，0 失败。
- `npm run verify`：6,342 道题通过，题号唯一；验证器同时报告数据目录缺少 21 张题图（未运行数据同步）。
- `node --check web/app-new.js`、`node --check web/ui-version.js`、`git diff --check`：通过。
- Playwright 独立浏览器 QA：36 项通过，0 失败；视口为 1440×900 和 390×844。隔离数据目录为 `.build/ui-redesign/path-index-execution/gate3/isolated-data-final-3/`，地址仅绑定 `127.0.0.1:8087`。
- 浏览器流程覆盖：首次默认单题、5 题叶章、独立答案/公式、题目自己的选项状态、收藏/易错/三态筛选、模式记忆和按 ID 恢复、快速连续切换；模拟 AI 保存失败及批注保存失败并确认原模式/当前题/草稿不丢、修复后可重试；281 题叶章首段只加载 20 题，输入 281 后只渲染目标题卡、按需加载其题库分片并滚动到目标题；移动端题号抽屉可见且无横向溢出。QA 未记录页面异常、控制台错误、失败请求或失败 HTTP 响应。

## QA 文件

结构化记录：`.build/ui-redesign/path-index-execution/gate3/browser-qa.json`

独立脚本：`.build/ui-redesign/path-index-execution/gate3/capture_gate3.py`

截图：

- `.build/ui-redesign/path-index-execution/gate3/screenshots/desktop-single-default.png`
- `.build/ui-redesign/path-index-execution/gate3/screenshots/desktop-multi-five.png`
- `.build/ui-redesign/path-index-execution/gate3/screenshots/desktop-deep-question-281.png`
- `.build/ui-redesign/path-index-execution/gate3/screenshots/mobile-question-index-drawer.png`

## 未测项与范围

QA 使用真实题库目录索引中的 5 题叶章（目录 ID 714）和 281 题“未分类”叶节点；没有逐一浏览所有章节。缺失的 21 张题图未通过数据同步补齐，因而没有声称逐图目视验收。浏览器 QA 的 AI/批注保存失败通过隔离环境中的故障注入验证，未调用真实外部 AI 服务。未进入第 4 关全库搜索/快捷键或第 5 关全站回归。

本报告只覆盖第三关实现及指定检查；当前工作区原有的其他未提交变更继续保留。本关未提交、推送、部署、打包，也未访问或更改真实 `data/` 与官网同步状态。
