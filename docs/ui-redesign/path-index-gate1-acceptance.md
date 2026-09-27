# 路径式题库与六主题：第 1 关独立验收

结论：**通过**。本关只验收独立视觉样板，尚未把设计接入正式新版页面；第 2 关可以开始。

## 核对范围与证据

- 检查了 `gate1/index.html`、视觉报告和 Chromium 截图；我独立查看桌面与手机的首页、目录、单题、多题、AI、外观、深层路径、混合直属题、空节点及目录抽屉。
- 样板采用顶栏全局导航；题库左栏仅有当前同级章节，右栏仅有当前节点的直属子章。原先重复的全局侧栏在整改后移除。真实题库的 8 层路径、6 道直属题加 4 个子章的混合节点，以及空节点均有对应画面。
- 单题阅读面约 760px，题干与解析层级清晰。手机扫描题图可以点击放大；我曾发现放大图破图，整改后截图和自检确认源图 `naturalWidth=1120`，放大层能关闭。
- 六套主题均可在样板中切换。另独立用 Playwright 切到橙黑夜间检查目录：无横向溢出，主按钮使用深色前景。子 agent 针对夜间选中态复测：顶栏与目录文字对比度 12.14:1，科目选择 15.03:1，品牌按钮 6.86:1。
- 最终结构化自检在 1440×900、390×844 下记录 29 张截图、42 项检查；两端无浏览器页面错误、内容横向溢出或题图资源缺失。桌面曾出现搜索浮层持续遮挡其他页面，整改后浮层只在搜索截图出现。

证据入口：[交互样板](../../.build/ui-redesign/path-index-execution/gate1/index.html)、[视觉报告](path-index-gate1-report.md)、[自检结果](../../.build/ui-redesign/path-index-execution/gate1/visual-check.json)、[桌面目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-library.png)、[手机目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-library.png)、[夜间目录](../../.build/ui-redesign/path-index-execution/gate1/screenshots/desktop-night-library.png)、[手机题图放大](../../.build/ui-redesign/path-index-execution/gate1/screenshots/mobile-image-zoom.png)。

## 下一关约束

样板里的题数、路径和局部状态是演示，不能当作已完成产品功能。第 2 关必须从真实目录数据驱动路径导航，处理主题升级迁移、顶栏、同级/子章、直属题、空节点、手机抽屉、键盘焦点及返回位置；正式版旧版页面、学习数据与业务 API 保持不变。多题加载、全库搜索和快捷键分别留给第 3、4 关。正式版集成后重新核对 KaTeX、题图和实际页面性能。
