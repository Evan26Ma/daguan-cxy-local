# 大观园新版 · 路径目录视觉样板（第 1 关）

状态：视觉样板与本地自检完成，等待独立验收。范围只包括新版六主题及首页、题库目录、单题、多题、AI 展开和外观设置样板；未进入产品代码实现。

样板入口：[打开 index.html](../../.build/ui-redesign/path-index-execution/gate1/index.html)。截图、可重复截图脚本和结构化自检结果都保存在 [gate1 目录](../../.build/ui-redesign/path-index-execution/gate1/)。已有未提交工作保全快照为 `.build/ui-redesign/path-index-execution/snapshot-20260927-134435`。

## 视觉系统

首页和目录使用奶白纸面、细坐标分隔线与朱红位置标记。桌面导航放在顶栏；题库页唯一的侧栏宽 280px，只列当前节点的同级章节，右栏只显示当前节点的直接子章。标题控制在清晰易读的层级，题目阅读面最大 760px，公式采用独立的安静排版。手机隐藏同级侧栏，以全屏目录抽屉浏览路径；全库搜索始终有独立入口。

界面字体沿用 Segoe UI、Microsoft YaHei 等系统中文无衬线字体；少量章节大标题使用宋体作书页式标题，数学表达使用衬线斜体表现，正文仍保持无衬线。焦点环使用蓝色 3px 描边，操作行保持连续排版，不给每个目录行增加卡片阴影。

| 预设 | 品牌 / 应用背景 / 阅读面 / 次要强调 | 品牌按钮自动前景 | 实测按钮文字对比度 |
|---|---|---|---:|
| 朱红奶白（新装默认） | `#C83F32` / `#F7F3EA` / `#FFFEFA` / `#9A7746` | 白色 | 4.98:1 |
| 橙白（现有新版） | `#FF6A1A` / `#F5F6F8` / `#FFFFFF` / `#B83D00` | `#202124` | 5.62:1 |
| 蓝砂（旧版色板、新版布局） | `#1E4A5C` / `#ECE7DC` / `#FAF7F0` / `#8A6D49` | 白色 | 9.59:1 |
| 米黄护眼 | `#80613B` / `#EDE8D9` / `#FBF8EE` / `#66816B` | 白色 | 5.69:1 |
| 橙黑夜间 | `#FF8A3D` / `#191B1C` / `#242729` / `#E6B36B` | `#202124` | 6.86:1 |
| 薄荷实验 | `#31785E` / `#EAF3ED` / `#FBFEFC` / `#AD7444` | 白色 | 5.28:1 |

外观页提供品牌色、应用背景、阅读面和次要强调色自定义；更换品牌色会按 WCAG 对比计算品牌按钮前景，改背景或阅读面时也会切换相应正文前景。预设按钮、实时预览、取消和应用都有样板状态；目前不会保存偏好。

## 真实目录与页面状态

| 样板状态 | 题库内容与设计检查 |
|---|---|
| 首页 | 高数 3,703、线代 958、概率统计 476 为真实目录总数。学习位置未知时显示“还没有本机学习记录”，不编造进度或连续天数。 |
| 路径目录 | `高等数学 › 极限 › 函数`；左栏标题“同级目录 · 极限”，高亮“函数 56 题”，同级仅列函数、极限、连续；右栏仅列“求函数表达式 11 题”和“函数性质考察 45 题”。 |
| 叶章节 | “求函数表达式”含真实 11 题；展示单题 / 多题入口及题号索引。进度显示“未读取”，不出现假数量。 |
| 混合直属题节点 | 真实节点 id `1146`“系数以递推数列给出”：14 题、直属 6 题、4 个子章（2、1、3、2 题）；直属题单独成组，子章节仍保留。 |
| 空节点 | 真实节点 id `389`“大题”：0 直属题、无子章；提供空状态和返回目录入口，没有开始练习按钮。 |
| 八层路径 | 真实路径为 `高等数学 › 极限 › 极限计算 › 数列极限 › n 项数列极限计算 › n 项和 › 定积分定义求 n 项和极限 › 0 到 1，n 等分，取端点`，共 9 个节点（科目加 8 层）。中间节点收入省略号菜单；长章节名保持可读。 |
| 单题 / 图片 | 真实题号 10662，来源 1994 数二及 880 题库，含原题图片；提供“点击放大查看原图”和可关闭原图预览。 |
| 多题 | 同一面积关系章节真实展示第 4 题 7255（1991 数三）和第 5 题 10662；题干与答案分别展开。桌面使用固定题号轨道，手机使用题号抽屉。 |
| 搜索入口 | 顶栏独立入口与结果浮层展示真实题号 10662、7255 的题名、来源和路径。这里只展示搜索状态，完整本机搜索功能留在后续关。 |
| AI 展开 | 显示题目上下文、提示按钮、连续解析和底部输入区。解题文字只用于布局演示，真实 AI 调用、失败恢复和滚动行为未验证。 |

## 截图与自检

Chromium 在 1440×900 与 390×844 截图，涵盖 10 个状态的桌面与手机画面，并单独截取两端搜索、手机目录和题号抽屉、图片放大层、键盘焦点及夜间主题目录 / 单题，共 29 张。示例：

- [桌面首页](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-home.png)、[桌面路径目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-library.png)、[桌面混合直属题](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-mixed.png)
- [手机首页](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-home.png)、[手机路径目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-library.png)、[手机全屏目录抽屉](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-directory-drawer.png)
- [桌面单题](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-single.png)、[手机多题](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-multi.png)、[手机 AI 展开](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-ai.png)
- [桌面搜索结果](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-search-results.png)、[手机搜索结果](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-search-results.png)、[手机图片放大](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-image-zoom.png)
- [手机多题号抽屉](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-question-index.png)
- [夜间主题目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-night-library.png)、[夜间主题单题](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-night-single.png)、[键盘焦点](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-keyboard-focus.png)

执行脚本为 [capture.py](../../.build/ui-redesign/path-index-execution/gate1/capture.py)，采集结果为 [visual-check.json](../../.build/ui-redesign/path-index-execution/gate1/visual-check.json)。两种尺寸下所有样板页 `documentWidth` 均未超过视口，活动页 `scrollWidth` 未超过内容宽度；没有浏览器 JavaScript 错误。题目缩略图和放大图均加载真实 1120px 资源（`naturalWidth=1120`）；桌面放大预览关闭后返回单题页，手机关闭目录抽屉后仍停留在题库目录。桌面多题可分别展开答案，手机题号抽屉可打开；键盘 Tab 焦点有 3px 可见描边。六个品牌按钮实测对比度均超过 4.5:1。夜间状态另测顶栏当前项及目录选中行为 12.14:1、科目选择框 15.03:1、主按钮 6.86:1、辅助提示 9.20:1；图中选中文字和 select 前景已改成与深底对比充分的颜色。

## 未验证项

本关只验证视觉样板和局部样板交互。实际产品中的目录路径及滚动位置持久化、键盘操作完整性、全库搜索与返回恢复、主题保存和升级迁移、多题按 20 题分段加载、用户学习进度读取、200% 缩放、其他三个最终验收尺寸、离线缓存、预览权限、真实 AI 和新旧版共享数据仍待后续阶段验证。公式在本样板中用排版后的字符示意；最终 KaTeX 渲染需在产品集成后验证。

本关只新增了 `.build/ui-redesign/path-index-execution/gate1/` 下的独立样板、截图与自检文件，以及本报告；没有修改 `web/`、`local-server/`、`test/`、`data/`，也没有提交、推送、部署、打包、写入学习数据或执行官网同步。
