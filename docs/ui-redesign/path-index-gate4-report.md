# 第4关：本机全库搜索与快捷键

日期：2026-09-27

## 实现

新版顶栏增加全库搜索入口，也可在题库页或练习页打开搜索，并按全部题库、当前科目或当前章节限制范围。搜索使用已有本机 `search_index.json`，匹配题号、题干、来源和章节路径；归一 `\frac` / `\dfrac`、括号、空格、`\leq` / `≤`、`\cdot` / `×` 等常见写法。输入采用 120 ms 延迟更新，结果按需显示 40 道并可继续加载。

点击结果会从搜索索引定位所属叶章节，并以单题模式打开原题。题页提供“返回搜索”，恢复搜索词、范围和结果滚动位置；搜索起点为题目时也可返回原题。离开练习页、切题和切换模式均继续使用 `ensureSavedBeforeLeavingQuestion` 保存闸门。

搜索摘要在渲染 Markdown 前转义原始 HTML、去除外链与图片语法，再交给现有 KaTeX 流程；测试确认恶意 `<img>` / `<script>` 文本不会生成活动节点，数学公式仍以 KaTeX 显示。题库内原有搜索也使用同一数学写法归一函数。

沿用旧版 `daguan_focus_shortcuts_v1` 本机按键存储，并在新版设置页提供重新绑定、冲突提示和恢复默认。新增 `/` 搜索、M 单题/多题切换、J/K 多题定位、G 按题号跳转、Alt+1–4 选择 A–D；1–3 可直接设定未开始/学习中/已掌握。练习按键在搜索输入、其他输入框、批注区、AI 编辑区和快捷键设置区聚焦时暂停。固定按键优先，配置器会阻止新冲突，并提示从旧版带入的冲突。

## 验证

- `npm test`：133 项通过，0 失败。
- `npm run verify`：6,342 道题、6,342 个唯一题号通过。验证器报告数据中缺少 21 张题图；本关没有运行数据同步。
- `node --check web/app-new.js`、`node --check test/new-ui-search.test.mjs`、Playwright 脚本 `py_compile`、`git diff --check`：通过。
- 隔离 Playwright：27/27 项通过，视口为 1440×900 与 390×844。覆盖题号搜索、题目结果定位与范围、恶意摘要与公式渲染、返回时恢复搜索词/范围/滚动位置、6,342 项索引的搜索响应、M/J/K/G（含单题及多题跳转）与 Alt+1、三态掌握、快捷键旧键存储和冲突处理、搜索/批注/AI 编辑聚焦时暂停练习键，以及模拟保存失败时阻止离开当前题。记录中无页面异常或失败 HTTP 响应。

## QA 产物

脚本：`.build/ui-redesign/path-index-execution/gate4/capture_gate4.py`
结构化结果：`.build/ui-redesign/path-index-execution/gate4/browser-qa.json`
隔离服务器数据：`.build/ui-redesign/path-index-execution/gate4/isolated-data/`，服务仅绑定 `127.0.0.1:8188`。

截图：

- `.build/ui-redesign/path-index-execution/gate4/screenshots/desktop-global-search-results.png`
- `.build/ui-redesign/path-index-execution/gate4/screenshots/desktop-chapter-scope.png`
- `.build/ui-redesign/path-index-execution/gate4/screenshots/desktop-shortcut-help.png`
- `.build/ui-redesign/path-index-execution/gate4/screenshots/desktop-multi-keyboard.png`
- `.build/ui-redesign/path-index-execution/gate4/screenshots/mobile-global-search-results.png`
- `.build/ui-redesign/path-index-execution/gate4/screenshots/mobile-search-result-question.png`

## 未测项与范围

只浏览了题库中的代表性章节和搜索结果，没有逐题核对 6,342 道题或所有章节路径。缺失的 21 张题图没有逐张检查；搜索摘要刻意显示图片占位。未调用外部 AI、官网同步、真实凭据或真实用户数据，也未进入第5关全站回归。

开始完整第4关修改前，为保护当时工作区建立 Git 可恢复快照引用 `refs/backup/gate3-accepted-before-gate4`（对象 `23646a9d5f0b629a07c7acb91da96df687c9362a`），随后恢复原工作区并保留全部既有未提交工作。该快照建立时已包含第一次入口和搜索代码插入；后续完整实现另在当前工作区，不会覆盖原有六主题、旧版逻辑目录或多题模式。

本关未提交、推送、部署或打包。
