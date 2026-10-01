# 阶段 2：核心学习业务整合（第三关）

授权来源：用户要求阶段 1 验收通过后继续阶段 2。现在仅执行本阶段，完成后停下等待验收。

## 交付目标

将阶段 1 的视觉样板整合到生产环境，实现核心学习流程的完整业务逻辑：题库浏览、做题、答案解析、视频链接、AI 辅助、批注保存。

## 实施方式

### 整合策略
- 在 `web/index.html` 中整合新版 UI，使用 `data-app-version="new"` 标识
- 保持 `web/legacy.html` 旧版完整不变
- 利用现有 `web/ui-version.js` 版本切换机制
- 共享现有数据层：localStorage、API、题库 JSON

### 文件修改原则
- **创建新文件**：`web/app-new.js`（新版业务逻辑）、`web/styles-new.css`（新版样式）
- **修改现有文件**：`web/index.html`（整合新版结构）、`web/service-worker.js`（缓存新资源）
- **不修改文件**：`web/app-legacy.js`、`web/legacy.css`、`web/legacy.html`、题库数据、服务端代码
- **复用文件**：`web/design-tokens.css`、`web/ui-version.js`、`web/vendor/katex.min.css`

## 必须实现的功能

### 1. 题库浏览
- 从 `web/data/categories.json` 动态构建目录树
- 256px 侧边栏，展开/收起子章节
- 搜索功能：从 `web/data/search_index.json` 实时搜索，250ms 防抖
- 筛选功能：
  - 来源（source）：使用 `web/data/manifest.json` 的 `sources` 列表
  - 年份（year）：1987-2024
  - 题型（type）：单选/多选/主观题
  - 三个讲师：帕拉迪宇（paradiyuVideoMapping）、李艳芳、没咋了（映射在 `web/data/lecture-video-mappings.json`）
- 筛选抽屉：桌面右侧面板，手机全屏，底部固定"重置/应用"
- 空结果提供重置入口

### 2. 做题核心
- 从 `web/data/shards/*.json` 按需加载题目
- 单题/列表模式切换（新版默认单题，保留切换入口）
- 题目结构：
  - 面包屑 + 题序（例如"第 8 题 / 共 24 题"）
  - 元信息行：来源、题型、收藏/批注/AI 按钮
  - 题干与选项（支持 KaTeX 公式渲染）
  - 展开/收起解析
  - 教师视频链接（三个讲师映射，带 bvid/p/t 参数）
  - 底部操作栏：上一题、显示解析、下一题、掌握状态、易错标记
- 选项交互：
  - 整行可点击
  - 选中态：浅橙底 #FFF0E6
  - 正确/错误态：对应语义色 + 图标
- 答案/解析：
  - 普通段落，不套灰盒
  - 展开时仅在内容位于屏幕外时滚动
  - 保留原数据步骤结构，不捏造编号
- 图片题：
  - 路径 `web/data/assets/{hash}`
  - 保持比例、可放大
  - 缺图：稳定占位 + 重试按钮
- 公式处理：
  - 行内 `$...$`、行间 `$$...$$` 使用 KaTeX
  - 局部横滚，页面不横向溢出
  - 上下间距 16px

### 3. 状态持久化
- 使用现有 localStorage 键：
  - `daguan_local_progress_v1`：收藏、易错、掌握、已答、最近练习时间
  - `daguan_question_annotations_v1`：批注与历史
  - `daguan_learning_position_v2`：最近学习位置（章节、题号）
  - `daguan_local_picked_v1`：已选题目
  - `daguan_ai_preferences_v1`：AI 配置
- 双版本共享：收藏、易错、掌握、批注、快捷键、AI 配置
- 新版独立：外观偏好（`daguan_ui_appearance_new`）
- 切题保存：
  - 快速切换不能丢失批注/草稿
  - 保存失败阻止导航，提示并重试
  - 等待必要持久化完成

### 4. AI 辅助
- 默认关闭，点击后展开
- 桌面：右侧 400px，可调 360-480px
- 手机：全屏覆盖，返回按钮恢复题目位置
- 题目与 AI 独立滚动
- 输入框固定在 AI 面板底部
- 快捷提示（3 个）：
  - "这道题应该从哪些思路入手？"
  - "详细讲解这道题的解题步骤"
  - "提供完整解答和方法总结"
- 保留最新提示模板："总体路线 → 逐步推导 → 最终答案 → 方法总结"
- 调用 `/api/ai/chat`，流式响应
- 生成中：停止按钮，用户向上读历史时不强制滚动，显示"新内容"提示
- 失败：保留输入和上下文，可重试
- 配置缺失：提供设置入口
- 未发送内容按题目保存草稿，恢复但不自动发送
- 草稿键：`daguan_ai_draft_{questionId}`

### 5. 批注功能
- 编辑/预览切换，支持 Markdown + KaTeX
- 明确保存状态：保存中、已保存、失败
- 快速切题仍可靠保存
- 历史功能（次级入口，保留最近 10 条）
- 手机：全屏编辑，软键盘弹出后输入区可用

### 6. 视频链接
- 读取 `web/data/lecture-video-mappings.json`
- 三个讲师筛选：
  - **帕拉迪宇**：`paradiyuVideoMapping` 字段
  - **李艳芳**：`source` 包含"李艳芳"
  - **没咋了**：`source` 包含"没咋了"
- 显示：讲师名、课程/分集、时间
- 链接格式：`https://www.bilibili.com/video/{bvid}?p={p}&t={t}`
- 保留现有映射逻辑，不改数据结构

## 响应式要求

- **≥1280**：导航展开、AI 并排、题库侧边栏固定
- **1024-1279**：导航收起、AI 并排
- **768-1023**：导航抽屉、AI 覆盖面板
- **<768**：单列、AI/批注全屏、导航抽屉选项后自动关闭

并排时题目可用宽度 ≥520px，否则转覆盖。触控目标 ≥44px。

## 双版本兼容

### 版本切换
- 入口位置：
  - 新版：设置页"外观"分组、应用菜单
  - 旧版：设置页、应用菜单
  - 公共：landing.html 预览卡片
- 切换前：
  - 保存当前位置（章节、题号）
  - 保存批注草稿
  - 保存 AI 草稿
  - 等待持久化完成
- AI 生成中：confirm 确认后结束再切换
- 失败：停留当前版本，显示错误
- 点击当前版本：不刷新
- 保留 query/hash 参数

### 数据共享
- 共享：progress、favorites、picked、annotations、shortcuts、ai_preferences
- 分开：ui_appearance（`daguan_ui_appearance_new` vs `ui-background`）
- 外观迁移：
  - 首次从旧版读取 `ui-background`
  - 写入 `daguan_ui_appearance_new`
  - 迁移可重复，不覆盖新偏好
- 版本偏好：
  - 键：`daguan_version_preference`
  - 合法值：`new` / `old`
  - 缺失/损坏默认 `new`

### 入口逻辑
- `/`、`/index.html`：读取版本偏好
  - `new`：加载新版（`web/index.html` + `app-new.js`）
  - `old`：重定向 `/legacy.html`
- `/legacy.html`：强制旧版
- `?ui=old`：显式旧版，写入偏好
- `?ui=new`：显式新版，写入偏好

## 离线缓存

更新 `web/service-worker.js`：
- 版本号递增（例如 `v=90`）
- 预缓存列表添加：
  - `./styles-new.css?v=90`
  - `./app-new.js?v=90`
  - `./design-tokens.css?v=2`
- 保留旧版资源：
  - `./legacy.html`
  - `./legacy.css?v=89`
  - `./app-legacy.js?v=89`
- 运行时缓存：题库 JSON、图片、视频映射
- 仅删除过期应用缓存，不删学习数据

## 技术约束

- 沿用原生 HTML/CSS/JavaScript，不引入 React
- 不修改服务端代码 `local-server/`
- 不修改题库数据 `web/data/`
- 不修改 Windows 打包逻辑 `scripts/build-windows-exe.mjs`
- 保持现有 API 接口不变
- KaTeX 版本不变（现有 `web/vendor/katex.min.css`）

## 测试要求

### 自动化测试
- 扩展 `test/dual-ui.test.mjs`：
  - 新版题库加载
  - 搜索/筛选逻辑
  - 状态持久化
  - 版本切换保持位置
- 创建 `test/new-ui-core.test.mjs`：
  - 做题导航
  - 收藏/易错/掌握切换
  - 批注保存/恢复
  - AI 草稿保存

### 浏览器验证
- 创建 `.build/ui-redesign/stage-2/qa-new-ui.py`：
  - 题库搜索"二次型"
  - 筛选"李艳芳"讲师
  - 做题切换、展开解析
  - 收藏/掌握状态跨版本共享
  - AI 面板开关
  - 批注编辑保存
  - 手机导航自动关闭
- 尺寸：1440×900、390×844

### 手动检查项
- 长公式题无横向溢出
- 图片题缺图占位稳定
- 三个讲师视频链接正确（bvid/p/t）
- 200% 缩放不截断关键操作
- 减少动效模式生效
- 离线缓存可用（purge=1 清理后重载）

## 验收标准

### 代码修改
- 报告列出所有修改/新增文件
- 旧版文件未改动（`git diff` 验证）
- 新增代码遵循现有风格

### 功能完整性
- 题库目录动态加载，展开/收起正常
- 搜索实时响应，结果准确
- 筛选三个讲师可用，空结果有提示
- 做题上下切换，题序正确
- 收藏/易错/掌握实时保存，跨版本共享
- 批注快速切题不丢失
- AI 草稿按题目恢复
- 视频链接 bvid/p/t 参数正确

### 视觉一致性
- 沿用阶段 1 设计系统（色彩、字体、布局）
- 响应式在 4 个断点正常
- 无横向溢出、无遮挡、无样式泄漏

### 双版本兼容
- 新旧切换保持位置/批注/草稿
- AI 生成中切换有确认
- 保存失败阻断切换
- 入口逻辑正确（`/` 读偏好、`/legacy.html` 强制旧版、`?ui=old/new` 显式）

### 测试通过
- `npm test` 全部通过
- QA 脚本 7+ 项 PASS
- 无 JS 未捕获错误
- 无 HTTP ≥400（正常流程）

## 交付物

### 代码
- `web/app-new.js`：新版业务逻辑
- `web/styles-new.css`：新版样式（整合 `ui-preview/css/design-system.css`）
- `web/index.html`：整合新版结构
- `web/service-worker.js`：更新缓存列表

### 测试
- `test/new-ui-core.test.mjs`：核心功能单测
- `.build/ui-redesign/stage-2/qa-new-ui.py`：浏览器 QA 脚本
- 扩展 `test/dual-ui.test.mjs`

### 文档
- `docs/ui-redesign/stage-2-report.md`：
  - 修改文件清单
  - 数据层对接说明
  - API 调用清单
  - 测试结果
  - 未验证项（例如真实 AI 未配置）
  - 已知限制

### 截图
- `.build/ui-redesign/stage-2/`：
  - 桌面/手机：首页、题库搜索、题库筛选、做题、AI、批注
  - 新旧版同一题对照

## 执行步骤建议

1. **创建新版 CSS**：整合 `ui-preview/css/design-system.css` 到 `web/styles-new.css`
2. **创建新版 JS**：`web/app-new.js`，参考 `web/app2.js` 结构，实现新版业务逻辑
3. **修改 index.html**：替换为新版结构，保留 `data-app-version="new"`
4. **数据层对接**：
   - 读取 `categories.json` 构建目录
   - 读取 `search_index.json` 实现搜索
   - 读取 `shards/*.json` 加载题目
   - 读取 `lecture-video-mappings.json` 显示视频
5. **状态管理**：localStorage 读写，版本切换逻辑
6. **AI 整合**：调用 `/api/ai/chat`，流式处理
7. **批注功能**：Markdown 编辑，KaTeX 预览
8. **响应式适配**：4 个断点测试
9. **离线缓存**：更新 service worker
10. **测试验证**：单测 + QA 脚本 + 截图

完成后回复"阶段 2 核心业务整合完成，等待验收"，然后停止。不推送、不部署、不替换发布包。
