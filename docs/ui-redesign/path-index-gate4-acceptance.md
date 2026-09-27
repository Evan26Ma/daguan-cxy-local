# Gate 4 本机搜索与快捷键：独立验收

结论：**通过**。允许进入第 5 关全站回归。

我阅读了 [实现报告](path-index-gate4-report.md)、搜索和快捷键实现、隔离 QA 脚本及记录，并查看桌面/手机搜索结果和快捷键帮助截图。独立重跑 `npm test`（133/133）、`npm run verify`（6,342 道唯一题号，既有 21 张题图缺失警告）、`node --check web/app-new.js`、`git diff --check`，均通过。

我另启 `127.0.0.1:8092` 服务，使用 `.build/ui-redesign/path-index-execution/gate4/root-acceptance-data/` 隔离数据和全新 Chromium context，分别在 1440×900 与 390×844 操作：从五题叶章进入全库搜索，限定当前章节后以题号找到唯一结果；点击打开对应原题的单题页，返回搜索后词和范围仍在。搜索输入聚焦时按 `M` 不会误切阅读模式，两种尺寸均无横向溢出或页面异常。独立脚本位于 `.build/ui-redesign/path-index-execution/gate4/root_acceptance.py`，服务已停止。

子 agent 的 27 项隔离浏览器记录额外覆盖恶意摘要转义、公式、结果滚动恢复、6,342 题响应、M/J/K/G、Alt+1、三态快捷键、旧版快捷键配置和冲突提醒、保存失败拦截。未逐题核对所有题目及 21 张缺图，也未调用外部 AI 或真实官网同步。搜索截图中的长公式摘要仍有原始 Markdown 截断感，留第 5 关视觉精修。此关未提交、推送、部署或打包。
