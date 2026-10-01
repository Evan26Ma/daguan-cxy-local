# 阶段报告：阶段 C 修复 + 阶段 D 辅助页面（新版 UI）

- 日期：2026-09-26
- 执行：阶段 C 修复由主代理完成；阶段 D 四页面由 GLM 子代理完成、主代理验收并修复摘要问题
- 分支：codex/merge-dual-ui（未提交，未推送）
- 服务：http://127.0.0.1:18089（DAGUAN_DATA_DIR=Temp/daguan-qa 隔离实例）

## 阶段 C 修复（主要学习流程跑通）

上一轮遗留问题与根因：

1. **浏览器缓存旧 JS**：版本号不变导致改动不生效。修复：建立版本号机制，本轮 v90 → v96，每次改 JS/CSS 同步 bump index.html 与 service-worker.js。
2. **数据层格式错配**：重写 `DataService`，对齐 app2.js 生产逻辑——`manifest.json` 提供 `shards[name].file` 分片路径；`id_index.json` 为题号→分片名；`category_questions.json` 为章节→题号数组；分片 JSON 为数组格式，加载后建 `Map(id → question)` 缓存。
3. **公式不渲染**：vendor 无 KaTeX auto-render。移植 app2.js 的 `renderMarkdown()`（公式占位提取 → marked → `katex.renderToString` 回填，含图片 URL 转换与缺图回退），index.html 补载 marked.min.js。
4. **选项格式**：真实数据选项为 `{label, content_md}` 对象数组，兼容字符串；`correct_labels` 写入 data-correct。
5. **视频链接**：改为真实映射格式 `lecture-video-mappings.json → questions[qid]` 数组（teacher/bvid/page/startSeconds），生成 `?p=&t=` 参数。
6. **状态格式兼容旧版**：StorageService 重写为 `progress[题号]={mastery, favorite, error_prone,...}` + `favorites` 数组，与旧版/服务端共享同一 localStorage 键。
7. **目录树叶子节点不可点**：renderNode 修复——有 children 才有 has-children 类，叶子（有题目）直接进章节；章节列表改事件委托。
8. 导出块引用不存在的类导致脚本中断（子代理顺带修复）。

**实测**：题目 157 渲染 18 个 KaTeX 公式、4 个选项、2 个视频链接（李艳芳，`p=44&t=82`）；章节 331 加载 11 题（含题干/答案/解析）；6342 题索引与 7 个分片全部就位。截图 `desktop-question-expanded-v93.png`。

## 阶段 D（辅助页面，子代理交付）

新增四页 + 导航（7 项：首页/题库/复习/笔记/记录/工具/设置），文件改动：app-new.js +567 行、styles-new.css +444 行、index.html +33 行。

1. **复习页**：易错/收藏/待掌握三标签，计数与列表一致（骨架屏 + 并行加载），列表项含摘要/章节/状态胶囊/继续按钮，空状态引导去题库。
2. **笔记页**：双栏，批注列表 + KaTeX 预览 + 查看原题；「学习备忘」读写旧版 `daguan_local_notes_v1`。
3. **学习记录页**：四张真实统计卡 + 12 周热力图（7×12，#E3E6EA→#FF6A1A 五档，title 逐格日期）+ 口径说明，不伪造连续天数。
4. **工具页**：组卷/导出/同步为清晰样板入口（行内提示，无假按钮）；备份下载（progress+批注+AI 配置 JSON）与恢复（校验+confirm+写回）真实可用。

子代理自测：40 项 Playwright 断言通过、0 console 错误。

## 主代理验收结果

- 导航 7 项齐全（v96 实测）；语法 `node --check` 通过；9 个静态资源 200。
- 复习页：注入 2 易错/2 收藏/4 待掌握，计数与列表一致；「继续」→ 题 3356 做题页（4 公式渲染）。
- 记录页：统计卡数字与注入数据一致（2/4/2/6），热力图 83+ 格带图例。
- 工具页：6 组卡片齐全，备份/恢复真实可用。
- 手机 390×844：抽屉 7 项导航 + 遮罩正常。
- **验收中修复**：复习/笔记列表摘要 LaTeX 泄露（KaTeX textContent 拼接问题），改为纯文本清洗（公式符号转换 + 矩阵 &/\\ 处理）。

## 截图（.build/ui-redesign/stage-3/screenshots/）

desktop-review-final.png、desktop-notes.png、desktop-records.png、desktop-tools.png、mobile-nav-drawer.png；阶段 C 对照：stage-2/screenshots/desktop-question-expanded-v93.png

## 已知限制

1. 复习/笔记单题跳转为单题模式（无上下题），面包屑为占位；不覆盖首页继续学习位置。
2. 笔记页切换选中项会丢弃未保存的备忘编辑；批注自动保存仅在做题页。
3. 备份 JSON 含明文 AI apiKey，仅限本地。
4. 热力图固定阈值分档；「总作答数」口径为有 updated_at 条目。
5. 组卷/导出/官网同步为样板入口，业务待接入（下一阶段）。
6. 真实 AI 调用仍未测（无凭据，沿用 mock 验证结论）。

按流程停下，等待验收。不推送、不部署、不提交。
