# 新版六主题、顶栏与路径目录接入（第 2 关）

状态：实现与验收自检完成，等待独立验收。工作严格限于正式新版主题迁移、全局顶栏和真实数据驱动的路径目录；没有进入多题流、全库搜索、快捷键或全站回归。

## 实现

新版首次安装默认为朱红奶白（`#C83F32 / #F7F3EA / #FFFEFA / #9A7746`）。启动迁移先检查已有新旧版外观、版本选择和学习痕迹，再初始化新版外观键；真实新装记录一次初始化标记，既有新版空对象和旧 `theme:light` 偏好升级为橙白。已有新版暗色、护眼设置会映射到对应新版预设。旧版外观键单独保存，不由新版设置改写；迁移可重复执行。

外观页接入六套样板预设、品牌色/应用底色/阅读面/次强调色四项自定义、对比色自动选择、即时预览、应用、取消和恢复预设。主题色应用到新版页面变量、按钮、阅读面、浏览器主题色和新版品牌图标。旧版继续使用原品牌图片。浏览器验证还确认了应用预设会持久化、取消预览会恢复已应用主题。

全局导航移入顶栏，保留学习、题库、复习、笔记、记录、工具、设置七个现有入口；窄屏折叠为菜单。题库桌面同级栏宽 280px，内容区只显示当前节点的直属子章，面包屑在深路径折叠中间层级。路径、滚动、查询和筛选按科目分别保存，科目切换后可返回各自位置。手机目录为全屏抽屉，显示完整当前路径和返回上级按钮。

题库目录和题数来自 `web/data/categories.json` 与现有题目映射。聚合题目映射保留给既有本机检索；新版另计算直属题队列，避免父节点题目重复混入子章节。真实混合节点 id `1146` 显示 6 道直属题和 4 个子章；从头开始只载入直属 6 题，直属题号索引可进入单题。叶章节真实学习位置会显示“继续”，并按记录题号定位；桌面和手机均验证题目 id `3356` 在叶章节 id `331` 队列中可继续。真实空节点 id `389` 显示空状态，不提供开始或继续操作。未增加虚假的多题按钮。

## 验收

`npm test`：124 项通过。新增测试覆盖新装与既有外观迁移、空对象/旧 `light`、幂等迁移、旧版外观隔离，以及真实混合/空目录节点的直属题数据。

`npm run verify`：题库验证通过，共 6,342 题、6,342 个唯一题号；工具报告现有 21 张题图缺失，需要单独运行数据同步才能补齐，本关没有执行数据同步。`node --check web/app-new.js`、`node --check web/ui-version.js` 和 `git diff --check` 均通过。

浏览器验证在隔离的 `DAGUAN_DATA_DIR=.build/ui-redesign/path-index-execution/gate2/isolated-data` 运行，桌面 1440×900、手机 390×844。两端均无横向溢出、页面异常、console error、失败请求或 HTTP 错误；两端保留全部 7 个顶栏入口。测试了新装朱红默认、既有空键/旧 `light` 橙白迁移、旧外观映射、主题应用持久化和取消恢复、桌面键盘 3px 焦点环、9 节点深路径折叠、每科目路径/滚动/查询/筛选恢复、手机全屏目录与完整路径返回、混合节点 6 道直属题及空节点无效开始保护。浏览器脚本与结构化记录在 [gate2 目录](../../.build/ui-redesign/path-index-execution/gate2/)，共生成 14 张截图。

代表截图：[桌面目录](../../.build/ui-redesign/path-index-execution/gate2/screenshots/desktop-library-root.png)、[手机全屏目录与路径](../../.build/ui-redesign/path-index-execution/gate2/screenshots/mobile-directory-drawer.png)、[桌面混合节点](../../.build/ui-redesign/path-index-execution/gate2/screenshots/desktop-mixed-node.png)、[桌面主题预览](../../.build/ui-redesign/path-index-execution/gate2/screenshots/desktop-theme-preview.png)、[键盘焦点](../../.build/ui-redesign/path-index-execution/gate2/screenshots/desktop-keyboard-focus.png)。详细数据见 [browser-qa.json](../../.build/ui-redesign/path-index-execution/gate2/browser-qa.json)，可重复浏览器脚本见 [capture_gate2.py](../../.build/ui-redesign/path-index-execution/gate2/capture_gate2.py)。

## 边界

只改新版入口、新版主题/目录代码和相关自动测试。没有改旧版布局或业务 API/题库文件，没有写入真实 `data/`、没有同步官网、打包、提交或推送。已有工作快照 `.build/ui-redesign/path-index-execution/snapshot-20260927-134435` 未覆盖。此关完成后停在待验收状态。
