# 大观园数学 · 桌面版前端 UI/UX 只读审查报告

- 审查对象：`F:\AI\大观园本地`（正本 checkout，分支 `main`，HEAD `126266d fix: constrain answer reveal scrolling to question content`，package.json v1.0.10）
- 审查范围：新版学习界面（`web/index.html` + `web/app-new.js`）与旧版（`web/legacy.html` + `web/app-legacy.js`）的刷题流程、判题、章节导航、答案滚动、字号缩放、学习报告、访问历史、AI 面板、备份迁移、双界面一致性、可访问性、性能、桌面特性
- 方式：静态阅读 + 真实浏览器（Playwright/Chromium headless）真实点击复现 + 已存在的 UI 测试
- 审查性质：**只读**。除本报告外未修改、删除、移动、重命名任何仓库文件，未执行 `git reset/clean/stash`，未推送部署
- 数据隔离：所有服务均以 `DAGUAN_DATA_DIR=%TEMP%\dg-audit-04\data` 启动，端口 18082/18083，**从未读写真实的 `%LOCALAPPDATA%\DaguanMath\data`**

---

## 0) 结论摘要

**总体判断：新版界面的工程质量明显高于「379KB 单文件」这个数字给人的印象**——判题、章节导航、答案滚动、字号缩放、备份恢复等核心流程在真实点击下都工作正常，静态扫描也没找到 XSS 或全局污染（52 处 `innerHTML` 中的题目文本全部经过 `escapeHtml`，只挂 17 个命名空间化全局）。**但有两个 P1 级缺陷会直接伤害用户对产品的信任**：

1. **「继续学习」对服务端记录的位置完全失效。** 新版把「章节 id」当作 `category_id` 写到服务端，读回来时却用只搜**顶层科目**的 `findCategoryById()` 去解析。结果是首页「继续学习」卡片消失、题库页弹出**假的**「上次学习的题目已不在当前题库」警告、`resumeLearning()` **静默什么都不做**。这不是理论推断：同一条学习位置，只把 `categoryId` 从嵌套章节 id 改成顶层科目 id，三条链路就从全部失效变成全部正常。旧版客户端用全树搜索 `findCat()`，行为是对的——**这是新版引入的跨版本兼容回归，而且新版会自我投毒**（走过一次 `?uiSwitch=1` 恢复就会中招）。

2. **外部状态同步会抹掉当前窗口的判题结果。** 只要另一个窗口/旧版界面/官网改动了共享状态，SSE 推送就会触发 `refreshFromEvent` → `renderQuestion`，而 `renderQuestion` 用 `main.innerHTML = ...` 整块重建 DOM，**完全不回填 `AppState.answers`**。用户会看到：刚判对的题变成「从没答过」——选中项、对/错标记、「你的选择/正确答案」标签、判题反馈文字全部消失，已经展开的答案解析也被自动收起。实测 8.4 秒采样只有一种状态：`0/0/0/无标记/无反馈/答案收起`。

另有 4 个 P2（折叠侧边栏仍可 Tab 聚焦到离屏按钮、首屏预取 4.4MB 且其中 1.16MB 图片被加载两次、章节分片按科目切导致进任一章节都拉 3.7MB、`renderQuestion` 单次 50–79ms 超帧预算）与若干 P3。

**测试结论：产品代码基本健康，问题出在测试自身。** 非浏览器 UI 测试 9 个文件 **145/145 全通过**；浏览器测试 6 个文件 26 个用例中 **6 个失败，全部是同一个测试写法缺陷**（`waitForLoadState('networkidle')` 在常驻 SSE 连接下永不满足），不是产品 bug。

---

## 1) 发现清单

### P1-01 「继续学习」链路对服务端记录的位置全部失效（首页卡片消失 + 题库假警告 + 恢复静默无操作）

**严重度**：P1（功能完全不可用，且伴随误导性文案）
**位置**：`web/app-new.js:1653-1657`、`web/app-new.js:1362`、`web/app-new.js:1167`、`web/app-new.js:3625`、`web/app-new.js:1544`、`web/app-new.js:1534`、`web/app-new.js:1708`、`web/app-new.js:4639-4643`、`web/app-new.js:2286`

**证据（代码）**

`web/app-new.js:1653-1657` —— 病根，只搜顶层科目：

```js
static findCategoryById(id) {
    if (!AppState.categories) return null;
    // 内联 onclick 传字符串 id，统一 Number 宽松比较
    return AppState.categories.categories.find(c => String(c.id) === String(id) || Number(c.id) === Number(id));
}
```

`web/app-new.js:1345-1380` —— 服务端位置被解析时，匹配到嵌套节点就把**嵌套节点自己**当 `top`：

```js
const walk = node => {
    if (found) return;
    if (categoryId != null && Number(node.id) === Number(categoryId)) {
        const leaf = matchLeaf(node);
        if (leaf) { found = { top: node, leaf }; return; }   // 1362 ← top 可能是嵌套章节，不是顶层科目
    }
    for (const child of node.children || []) walk(child);
};
```

写入侧与服务端契约：`web/app-new.js:2286` 以 `AppState.currentChapter.id` 调用 `StateSync.pushLastStudy(...)`；旧版 `web/app-legacy.js:2565` `state.currentCatId = String(node.id);`（打开的叶子节点）、`web/app-legacy.js:3974` 把 `category_id: state.currentCatId` 写服务端。**所以服务端 `category_id` 的既有契约就是「叶子章节 id」。**

读取侧：`web/app-new.js:1167` `absorbLastStudy` 用 `saveLearningPosition(resolved.top.id, resolved.leaf.id, null, String(lastStudy.question_id))` —— 把嵌套节点 id 存成本地 `categoryId`；`web/app-new.js:3625` `openResolvedPosition` 里 `AppState.currentCategory = resolved.top`，随后 `renderQuestion` 的保存又把它写成 `categoryId`。

三处消费点因此全部失效：

```js
// web/app-new.js:1544  renderHome()：category 为 null → continueSection 保持空 → 回落到「选择一章，开始学习」
const category = this.findCategoryById(position.categoryId);

// web/app-new.js:1534  lastPositionTrail()：category 为 null → trail 为 null → 返回 null
const category = position && this.findCategoryById(position.categoryId);

// web/app-new.js:4639-4643  resumeLearning()：静默 return，连提示都没有
const category = UIRenderer.findCategoryById(position.categoryId);
if (!category) return;
const chapter = UIRenderer.findChapterById(category, position.chapterId);
if (!chapter) return;
```

假警告的产出点 `web/app-new.js:1708`：

```js
${StorageService.getLearningPosition() && !this.lastPositionTrail()
  ? '<p class="text-helper" role="status">上次学习的题目已不在当前题库，无法直达；可重新选择小节。</p>' : ''}
```

**证据（实测）**

顶层科目实测只有 6 个：`223 高等数学(7 kids)`、`1 线性代数(7)`、`601 概率统计(7)`、`836 历年真题(3)`、`2500 模拟卷(4)`、`"orphan" 未分类(0)`。被投毒的 id `331` = `{id:331, name:"求函数表达式", depth:3, kids:0, questions:11}` —— **深度 3 的嵌套章节，不是顶层**。`findCategoryById(331)` 返回 `null`。

对照实验（同一份位置，只改 `categoryId` 的形状）：

| 观察点 | `categoryId = 331`（嵌套章节） | `categoryId = 223`（顶层科目） |
|---|---|---|
| 首页卡片 | ❌ `label:"学习"`、`title:"选择一章，开始学习"`、`btn:"浏览题库"` | ✅ `label:"继续学习"`、`title:"求函数表达式"`、`meta:"上次学习：第 3 题"`、`btn:"继续做题"` |
| 题库页警告 | ❌ `warning:true`（假警告，qid 3356 其实就在 331 里） | — |
| `lastPositionTrail()` | ❌ `null` | ✅ 非 null |
| `resumeLearning()` | ❌ `{view:"home", qid:null}` 静默无效 | ✅ `{view:"question", idx:2, qid:3358, cat:223, chapter:331}` |

**自我投毒的真实路径（不需要旧版参与）**：正常刷题后服务端 `last_study` 实测为 `{"category_id":"1111","question_id":"10767","mode":"single"}`（`1111` = 章节「幂级数」，不是科目 `223`）；随后用 `?uiSwitch=1` 打开一次，本地位置立刻从健康的 `{"categoryId":223,"chapterId":1111,...}` 变成 `{"categoryId":1111,"chapterId":1111,...}`；再下次普通开机，首页「继续学习」就消失了。`?uiSwitch=1` 是真实用户路径（`web/ui-version.js:55` `if (switching) url.searchParams.set("uiSwitch", "1");`，即新旧界面切换按钮）。

跨版本场景同样复现：把服务端 `last_study` 用 `PATCH ./api/state/last-study` 设成 `{category_id:'331', question_id:'3356', mode:'list'}` 并清空本地位置后启动，`absorbLastStudy` 立刻把本地位置重写成嵌套 id，首页退化为「选择一章，开始学习」，`lastPositionTrail()` 为 `null`，题库页弹出假警告，`resumeLearning()` 静默无效。

**影响**：
- 「继续学习」是首页第一入口，失效后用户每次都得自己重新翻目录找上次做到哪一题；
- 题库页的「上次学习的题目已不在当前题库」是**事实错误**的文案，会让用户以为题库丢了内容；
- 题库页里「继续上次练习」按钮（`web/app-new.js:1932`，条件 `positionIndex >= 0`，而 `positionIndex` 在 `web/app-new.js:1921` 要求 `position.categoryId === category.id`）和目录里「上次 · 题号 X ↗」快捷按钮（`web/app-new.js:1883-1891`，依赖 `lastPositionTrail()`）**一并消失**；
- 恢复路径行为不一致：`?uiSwitch=1` 走 `openResolvedPosition`（用 `resolveChapterForQuestion` 全树搜索）能正常打开，用户可见的按钮却全都无效。

**复现步骤**：
1. `DAGUAN_DATA_DIR=%TEMP%\dg-audit-04\data` 启动 `node local-server/server.mjs`（端口 18082），浏览器打开 `http://127.0.0.1:18082/index.html`；
2. 首页点「高等数学」→ 在级联目录里点到任一叶子章节进入题目，做一题（这一步会把 `category_id = <章节 id>` 写到服务端）；
3. 访问 `http://127.0.0.1:18082/index.html?uiSwitch=1`，再普通刷新回 `index.html`；
4. 观察：首页变成「选择一章，开始学习 / 浏览题库」，没有「继续学习」卡片；进题库页出现红字提示「上次学习的题目已不在当前题库，无法直达」；即使手动 `App.resumeLearning()` 也毫无反应。

**修复建议（两处，建议都做）**：

1. **让 `resolveChapterForQuestion` 返回真正的顶层科目**——把循环变量 `top` 传进递归，而不是用被匹配的节点：

```js
const walk = (node, topRoot) => {
    if (found) return;
    if (categoryId != null && Number(node.id) === Number(categoryId)) {
        const leaf = matchLeaf(node);
        if (leaf) { found = { top: topRoot, leaf }; return; }   // 修：top 恒为顶层科目
    }
    for (const child of node.children || []) walk(child, topRoot);
};
for (const top of AppState.categories.categories || []) {
    if (found) break;
    if (categoryId != null && Number(top.id) === Number(categoryId)) { const leaf = matchLeaf(top); if (leaf) { found = { top, leaf }; break; } }
    walk(top, top);
    ...
}
```

2. **给 `findCategoryById` 增加全树兜底**（与旧版 `web/app-legacy.js:1481-1489` 的 `findCat` 语义对齐），保证历史遗留的嵌套 `categoryId` 也能恢复：

```js
static findCategoryById(id) {
    if (!AppState.categories) return null;
    const tops = AppState.categories.categories || [];
    const direct = tops.find(c => String(c.id) === String(id) || Number(c.id) === Number(id));
    if (direct) return direct;
    // 兜底：旧版/服务端可能写入叶子章节 id，向上找它的顶层科目
    let hit = null;
    const walk = node => { if (hit) return;
        if (String(node.id) === String(id)) { hit = node; return; }
        for (const child of node.children || []) walk(child); };
    for (const top of tops) { walk(top); if (hit) break; }
    if (!hit) return null;
    for (const top of tops) {   // 找到命中节点的顶层祖先
        let found = false;
        const visit = n => { if (String(n.id) === String(hit.id)) { found = true; return; }
            for (const c of n.children || []) visit(c); };
        visit(top); if (found) return top;
    }
    return null;
}
```

3. 顺带把 `web/app-new.js:2286`（以及 `:2368`、`:4415`、`:4491`）推给服务端的 `category_id` 改成**顶层科目 id**，让新旧两条写入路径语义统一，从源头止血。

**验证方式**：
- 单测：新增 `test/` 用例——给定 `{categoryId: <叶子章节 id>, chapterId: <同一 id>, questionId: <该章节内题号>}`，断言 `UIRenderer.lastPositionTrail()` 非 null、`UIRenderer.findCategoryById(<叶子 id>).id === <顶层科目 id>`、`renderHome()` 输出含 `continue-section`；
- 回归：`node --test test/chapter-navigation.test.mjs test/new-ui-core.test.mjs test/new-ui-catalog.test.mjs`；
- 手工：按上面 4 步复现，修复后第 4 步应显示「继续学习 · <章节名> · 上次学习：第 N 题」且点击能直接落到该题。

---

### P1-02 外部状态同步会清空当前窗口的判题结果（选中项 / 对错标记 / 反馈 / 答案展开全部丢失）

**严重度**：P1（用户会以为自己没答过，或以为答错了）
**位置**：`web/app-new.js:1102`（触发）→ `web/app-new.js:2168-2197`（`renderQuestion`，`main.innerHTML` 在 `:2190`）

**证据（代码）**

`web/app-new.js:1090-1110` 的 SSE 处理里，重新渲染当前题目：

```js
// web/app-new.js:1102
await UIRenderer.renderQuestion(AppState.currentQuestionIndex);
```

`web/app-new.js:2168-2197` 的 `renderQuestion` 用整块字符串重建 DOM，**没有任何从 `AppState.answers` 回填判题状态的代码**：

```js
static async renderQuestion(questionIndex) {
    ...
    main.scrollTop = 0;                                   // :2183
    main.innerHTML = `...`;                               // :2190 全量重建，判题痕迹随旧 DOM 一起消失
    ...
}
```

对比：判题时的状态渲染逻辑只存在于 `web/app-new.js:5680-5698`（点击处理器内部），`renderQuestion` 不会复用它。

**证据（实测）**

页面 A 在 qid `8786`（`single_choice`，正确答案 D）上真实点选正确项，状态为 `{selected:1, correct:1, feedback:"回答正确", answerVisible:true, rev:73}`；随后同 context 的第二个页面执行 `PATCH ./api/state/last-study`（`rev 73 → 74`）模拟另一窗口/旧版界面/官网的写入。页面 A 采样 14×600ms（约 8.4 秒）**只有一种状态**：

```
T2_distinct = ["0/0/0/,,,/-/false/75/r1"]
              selected=0, correct=0, incorrect=0, tags 全空, feedback="", answerVisible=false, rev=75, renders=1
```

触发栈（探针包裹 `UIRenderer.renderQuestion` 捕获）确认了唯一原因：

```
window.UIRenderer.renderQuestion (<anonymous>:9:66)
Object.refreshFromEvent (app-new.js?v=131:1102:100)
```

题目本身没有丢（`T2_viewAfter = {view:"question", qid:8786}`），`AppState.answers` 与已落盘进度也都在（`{mastery:"mastered", answered:true, last_ok:true}`），只是**界面上的判题痕迹被抹掉了**。再点一次同一选项可以恢复标记（`web/app-new.js:5680-5698` 的 DOM 更新在 `if (ChoiceGrading.answer(question))` 内无条件执行），但界面上没有任何提示告诉用户要这么做；已经展开的答案解析被自动收起尤其突兀。

**补充说明（避免误判）**：单窗口内的判题与改答案是**正常**的。实测先点错项 A 再点正确项 D：`afterWrong = {selected:1, correct:1, incorrect:1, tags:"你的选择,,,正确答案", feedback:"回答错误，请查看答案与解析", answerVisible:true}`，`afterRightImmediate = {selected:1, correct:1, incorrect:0, tags:",,,正确答案", feedback:"回答正确"}`，4.8 秒内稳定；在干净流程里点正确项 8.25 秒采样也全程稳定（`renders: []`，无重渲染）。**因此这个问题只在「外部版本号变化」时发生**——而多窗口同步、旧版界面、官网写入都是产品明确支持的真实场景（`test/visibility-browser.test.mjs` 就在测这条同步链路）。

**影响**：
- 用户刚判对的题视觉上变回「未作答」，无法判断自己是否已经答过，也无法回看刚才的对错；
- 答案解析被自动收起，正在看解析的用户会被打断；
- 由于进度已正确落盘，用户再答一次不会产生错误数据，但体验上像是「白答了」。

**复现步骤**：
1. 起服务（同 P1-01 步骤 1）；
2. 打开两个窗口（或一个窗口 + 旧版 `legacy.html`）都指向 `http://127.0.0.1:18082/index.html`；
3. 在窗口 A 进入任一 `single_choice` 题并点选正确选项（会出现「回答正确」与展开的答案）；
4. 在窗口 B 做任意会产生状态写入的操作（答题、切题、收藏），或在 B 的控制台执行 `PATCH ./api/state/last-study`；
5. 回到窗口 A：选中项、对错标记、「正确答案」标签、反馈文字全部消失，答案区收起。

**修复建议**：

在 `renderQuestion` 末尾（`main.innerHTML` 赋值之后）补一个状态回填函数，而不是在点击处理器里重复渲染逻辑：

```js
static restoreGradedState(question, root) {
    if (!ChoiceGrading.answer(question)) return;            // 非单选/多选可判题则跳过
    const key = String(question.id);
    const chosen = AppState.answers?.[key];
    if (!chosen || !chosen.size) return;
    const label = [...chosen][0];
    const ok = ChoiceGrading.grade(question, chosen);
    root.querySelectorAll('.option-item').forEach((item, i) => {
        const optionLabel = ChoiceGrading.label(question, i);
        const selected = optionLabel === label;
        const correct = optionLabel === ChoiceGrading.answer(question);
        item.classList.toggle('selected', selected);
        item.classList.toggle('correct', correct);
        item.classList.toggle('incorrect', selected && !correct);
        item.setAttribute('aria-pressed', String(selected));
        item.querySelector('.choice-option-tag')?.remove();
        if (correct || selected) {
            const tag = document.createElement('span');
            tag.className = 'choice-option-tag';
            tag.textContent = correct ? '正确答案' : '你的选择';
            item.appendChild(tag);
        }
    });
    ChoiceGrading.feedback(root.querySelector('.question-options'), ok);
    const answer = root.querySelector('.answer-section');
    if (answer) answer.style.display = 'block';
    const button = root.querySelector('.expand-answer-btn') || document.getElementById('show-answer-btn');
    if (button) { button.textContent = '隐藏答案'; button.setAttribute('aria-expanded', 'true'); }
}
```

（更彻底的做法是让 `web/app-new.js:5680-5698` 与这个函数共用同一段渲染逻辑，消除重复。）

**验证方式**：
- 单测：在 `test/choice-grading.test.mjs` 或 `test/new-ui-core.test.mjs` 里断言「对已作答题目调用 `renderQuestion` 后，DOM 仍含 `.selected` / `.choice-option-tag` / `.choice-feedback`」；
- 端到端：按上面 5 步复现，修复后窗口 A 的判题痕迹应保持；可直接复用本报告的探针思路（`%TEMP%\dg-audit-04\probe12.mjs` 的 T2 段）。

---

### P2-01 折叠侧边栏里的按钮仍可被 Tab 聚焦到屏幕外（WCAG 2.4.3 / 2.4.7 / 1.3.2）

**严重度**：P2
**位置**：`web/styles-new.css:2254-2255`、`web/styles-new.css:3006`

**证据**

```css
/* web/styles-new.css:2254 */
@media (max-width: 1023px) {
  .app-nav.sidebar-nav { position: fixed; z-index: 1100; top: 56px; bottom: 0; left: 0;
    width: min(280px, 88vw); transform: translateX(-105%); transition: transform 180ms ease;
    box-shadow: 10px 0 28px #0002; }
  /* web/styles-new.css:2255 */
  .app-nav.sidebar-nav.open { left: 0; transform: translateX(0); }
}
```

折叠只用了 `transform: translateX(-105%)`——元素**仍然可见、仍在可访问性树里、仍然可聚焦**。没有 `inert`、没有 `aria-hidden`、没有 `visibility: hidden`。

实测（900×600 视口）：`getComputedStyle` 得到 `transform: matrix(1,0,0,1,-294,0)`、`visibility: visible`，`navButtonsWithTabindexMinus1: 0`。按 Tab 前进时，焦点**5 次**落在屏幕外的 `BUTTON.nav-item`（`left=-282, right=-27`），即 `offscreenFocusCount: 5`。

**影响**：键盘/辅助技术用户会陷入「焦点消失了」的状态——按 Tab 后画面没有任何可见变化，必须盲按多次才能回到可见区域；屏幕阅读器会朗读一个视觉上并不存在的导航菜单。

**复现步骤**：视口宽度设为 ≤1023px（如 900×600），不打开侧边栏，从地址栏开始连续按 Tab，观察焦点依次进入 `left` 为负值的侧边栏按钮。

**修复建议**：折叠时让它真正离开可访问性树与 Tab 序列。首选 `inert`（Chromium/Electron 已支持，且能一次性覆盖子元素）：

```css
@media (max-width: 1023px) {
  .app-nav.sidebar-nav { visibility: hidden; }        /* 配合 transform 保留过渡 */
  .app-nav.sidebar-nav.open { visibility: visible; }
}
```

或在 `App.toggleNav()` 里对侧边栏元素设置 `nav.toggleAttribute('inert', !open)` 与 `nav.setAttribute('aria-hidden', String(!open))`。注意 `visibility: hidden` 会中断过渡动画，如需保留动画可用 `transition: transform 180ms ease, visibility 0s linear 180ms`。

**验证方式**：在 `test/visibility-browser.test.mjs`（或新增用例）里断言折叠状态下侧边栏内 `button:not([tabindex="-1"])` 的数量为 0，或用 `page.keyboard.press('Tab')` 循环并检查 `document.activeElement.getBoundingClientRect().left >= 0`。

---

### P2-02 首屏预取约 4.4MB，其中 2.3MB 的搜索索引与 1.16MB 的图片并非首屏所需，且该图片被重复加载两次

**严重度**：P2
**位置**：`web/app-new.js:181-182`、`web/app-new.js:220`、`web/app-new.js:231-246`

**证据**

冷启动资源统计（`performance.getEntriesByType('resource')`）：`readyMs=233`、`dcl=143ms`、`load=145ms`、`FCP=356ms`、DOM 218 节点。启动阶段预取：

| 资源 | 大小 | 备注 |
|---|---|---|
| `/data/search_index.json` | **2307 KB** | 首屏完全不需要，只有用户输入搜索词时才用 |
| `/assets/landing/local-mark.png` | **1161 KB** | 被加载**两次**（`initiatorType` 分别为 `img` 与 `other`） |
| `/data/lecture-video-mappings.json` | 444 KB | 只有按讲师筛选时才用 |
| `/data/category_questions.json` | 189 KB | |
| `/data/id_index.json` | 143 KB | |
| `/data/categories.json` | 110 KB | |
| `app-new.js?v=131` | 371 KB | |
| `vendor/katex.min.js` | 269 KB | |
| `vendor/marked.min.js` | 35 KB | |
| `styles-new.css?v=119` | 108 KB | |
| `vendor/katex.min.css` | 23 KB | |

进入任一章节还会拉取 `/data/shards/高等数学.json` **3699 KB**（见 P2-03）。旧版界面预取同一批资源。`assets/landing/local-mark.png` 1.16MB 同时作为 `<link rel="icon">`（`web/index.html:9`）和页面图形使用，两张请求都是完整图片。

**影响**：首屏 FCP 本身不差（356ms，本地服务无网络延迟），但在真实磁盘/首次安装场景下要先把约 4.4MB 从 asar 解出来、解析 JSON（2.3MB 的 `search_index.json` 解析是主线程工作）；低配机上「点开就卡一下」主要来自这里。移动端/热区窄带下更明显。

**修复建议**（按收益排序）：
1. `search_index.json` 改为**首次聚焦搜索框时才拉取**（`web/app-new.js:220` 的调用点挪进 `App.openGlobalSearch()`），可省 2.3MB；
2. `assets/landing/local-mark.png` 压缩到 ≤100KB（或换成 SVG——`index-new-backup.html` 用的正是 `local-mark.svg`），并消除重复加载；
3. `lecture-video-mappings.json` 延迟到打开筛选抽屉时拉取，可省 444KB；
4. 给这些 JSON 加 HTTP 缓存头/`ETag`（本地服务同样适用），二次启动可省绝大部分字节。

**验证方式**：在探针里记录 `performance.getEntriesByType('resource').map(r => [r.name, r.transferSize])` 求和，断言首屏（`load` 事件前）传输量下降；或用 `test/new-ui-core.test.mjs` 断言启动后 `AppState.searchIndex` 为空、搜索框聚焦后才被填充。

---

### P2-03 题库分片按「科目」切分，进入任一章节都要拉取整科数据（高等数学单文件 3.7MB）

**严重度**：P2
**位置**：`web/data/shards/`、`web/app-new.js:252` `ensureShard(name)`、`web/app-new.js:269` `loadQuestionsForChapter(chapter)`

**证据**

分片体积：`高等数学.json` **3,787,634 B**、`历年真题.json` 1,895,046 B、`线性代数.json` 910,284 B、`模拟哥专区.json` 818,225 B、`概率统计.json` 358,952 B、`高等数学-核心.json` 4,084 B、`未分类.json` 3 B。

实测进入「幂级数」章节（该章只有 1 道直属题）触发了 `/data/shards/高等数学.json` 的 **3699 KB** 下载。`web/app-new.js:287` 的 `chapterEntries(chapter)` 只返回轻量的 `{id, shard}`，`web/app-new.js:292` 的 `loadQuestionRange(chapter, start, count = 20)` 也只取 20 道——**但分片粒度是科目，所以为了 20 道题要拉整科 3.7MB**。

**影响**：冷启动后第一次进任何高等数学章节都要等 3.7MB；在低配机/慢盘上是明显的「点一下卡住」。也解释了为什么 P2-04 的渲染耗时问题在真实使用中会被放大。

**修复建议**：把分片键从「科目」下沉到「二级/三级章节」（或按固定题量切片 + 一个 `chapter → [shardIds]` 映射表），让首屏只拉当前章节所需的几十到几百 KB。现有 `manifest.json` + `ensureShard(name)` 的惰性加载机制不用改，只需改分片生成脚本与 `web/app-new.js:287` 的映射。注意题库分片改动后必须跑 `npm run verify`。

**验证方式**：进入单个章节后统计 shard 传输量应 < 300KB；`npm run verify` 通过；`node --test test/new-ui-catalog.test.mjs test/chapter-navigation.test.mjs`。

---

### P2-04 `renderQuestion` 单次渲染 50–79ms（超 16.7ms 帧预算），多题模式 11 张卡产生 9263 个 DOM 节点

**严重度**：P2
**位置**：`web/app-new.js:2168-2197`（`renderQuestion`）、`web/app-new.js:2171`（多题分支 → `renderMultiQuestions`）

**证据**

- `renderQuestion` 12 次采样耗时 **49.7–78.7 ms/次**，而 60fps 的帧预算是 16.7ms；
- 多题模式 `enterChapterQuestions(node, 0, null, 'multi')` 耗时 **914 ms**，渲染 11 张卡片产生 **9263 个 DOM 节点**；
- 由于 `renderQuestion` 是整块 `main.innerHTML = ...` 重建（`web/app-new.js:2190`），每次切题都是一次完整的 DOM 拆除 + 重建 + KaTeX 重排。

**影响**：切题有可感知的延迟；多题模式首次进入接近 1 秒空白；这也是 P1-02（判题态被清空）的结构性根因——全量重建天然难以保留局部状态。

**修复建议**：
1. 切题改为**增量更新**：题干/选项/答案分区各自只改变化的 `textContent`/`innerHTML`，复用外层容器与事件委托，避免整块重建；
2. 事件监听改为在 `.question-wrapper` 上做一次委托（现在每次重建都重新绑定）；
3. 多题模式（9263 节点）做窗口化或分页，只渲染视口附近的卡片；
4. `renderQuestion` 内 `renderMarkdown`/`renderKaTeX` 的结果按题目 id 缓存。

**验证方式**：`performance.now()` 包裹 `renderQuestion` 断言 P95 < 30ms；多题模式 DOM 节点数断言 < 3000。无泄漏证据：25 次 `showHome/showLibrary/showSettings` 循环后 DOM 从 9263 回落到 210，堆内存 22.9MB → 18.3MB，**未发现监听器或定时器泄漏**。

---

### P3-01 `#show-answer-btn` 的 `aria-expanded` 只在判题路径被设置，键盘/按钮路径不设置也不复位

**严重度**：P3
**位置**：`web/app-new.js:5697-5698`（判题路径设置）vs `web/app-new.js:5725` `toggleAnswer()`（不设置）

**证据**：判题路径 `if (button) { button.textContent = '隐藏答案'; button.setAttribute('aria-expanded', 'true'); }`；而 `App.toggleAnswer()`（`web/app-new.js:5725`）只切换 `answerSection.style.display` 与按钮文案，**从不同步 `aria-expanded`**。实测：走判题路径时 `btnAria = "true"`；走 `toggleAnswer()`/空格键路径时 `btnAria = null`（属性从未被设置）。

**影响**：屏幕阅读器无法得知答案解析的展开/收起状态；属性一旦被判题路径设为 `"true"` 就再不复位，收起后仍朗读「已展开」。

**修复建议**：在 `toggleAnswer()` 里同步 `btn.setAttribute('aria-expanded', String(展开))`；判题路径也改为调用同一处逻辑。

**验证方式**：断言两种进入路径下 `aria-expanded` 都与 `#answer-section` 的实际可见性一致。

---

### P3-02 题目页缺少 `h1`；解锁输入框无标签；预览解锁对话框缺 `aria-modal`

**严重度**：P3
**位置**：`web/app-new.js` 题目视图模板；`web/index.html`（`#preview-access-key`、`#dlg-preview-access`）

**证据**：新版题目页实测 `h1Count: 0`（旧版 `legacy.html` 为 `h1Count: 1`）；`input#preview-access-key` 没有 `<label>`、没有 `aria-label`；`dialog#dlg-preview-access` 缺 `aria-modal`。其余可访问性项良好：焦点环可见（`outlineStyle: solid`、`outlineWidth: 3px`）、图片 `alt` 齐全（新版 `imgsNoAlt: 0`）。

**影响**：辅助技术用户缺少页面主标题的定位锚点；密码输入框在屏幕阅读器里是「未命名编辑框」。

**修复建议**：题目视图给题干加 `<h1 class="sr-only">`（或把现有标题元素提升为 `h1`）；给 `#preview-access-key` 补 `aria-label="访问密钥"`；给对话框补 `aria-modal="true"`。

**验证方式**：`h1Count >= 1`；`#preview-access-key` 有可访问名；对话框有 `aria-modal`。

---

### P3-03 展开长答案后 `.question-content` 可滚动，但滚动位置不跟随，用户需手动找答案尾部

**严重度**：P3
**位置**：`web/app-new.js` 答案展开逻辑（HEAD `126266d` 修的就是这里）

**证据**：HEAD 的修复已验证有效——在 qid 1486 上展开 334 字答案后，`.question-content` 变为可滚动（`scrollHeight 956 > clientHeight 626`，`overflow-y: auto`），同时 `contentScrollTop` 保持 `0`、`window.scrollY` 为 `0`、`.question-footer` 的 top/bottom 稳定在 757/832、`blankBelowFooter` 为 28。**滚动不再影响整页，行为正确。** 残留问题：`contentScrollTop` 不会自动滚到答案尾部，用户展开后仍需手动往下滚才能看到解析。

**修复建议**：展开答案后对 `.question-content` 做一次 `scrollTo({ top: scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })`（或至少把答案区 `scrollIntoView({ block: 'nearest' })`），尊重 `appearance.reduceMotion`。

**验证方式**：展开长答案后断言 `contentScrollTop > 0`，且 `window.scrollY === 0`、页脚位置不变。

---

### P3-04 快速连点「下一题」被 `questionStepping` 守卫静默丢弃

**严重度**：P3
**位置**：`web/app-new.js` `App.nextQuestion()` 的 `AppState.questionStepping` 守卫

**证据**：并发调用 3 次 `App.nextQuestion()` 只前进 1 次——后两次被 `questionStepping` 静默丢弃。这是刻意的重入保护（防止重复渲染），但用户连点时会丢输入且没有任何反馈。

**修复建议**：改为把待处理的方向入队，在渲染完成后消费队列；或至少在守卫命中时给出轻微视觉反馈（按钮短暂 disabled/`aria-busy`）。

**验证方式**：连续 3 次点击后应前进 3 题。

---

### P3-05 6 个浏览器测试文件因 `waitForLoadState('networkidle')` 永不满足而失败（**测试缺陷，非产品 bug**）

**严重度**：P3
**位置**：`test/answer-scroll-browser.test.mjs:14`、`test/font-scale-browser.test.mjs:16`、`test/font-scale-browser.test.mjs:51`、`test/study-report-browser.test.mjs:41`、`test/study-report-browser.test.mjs:58-77`，以及 `test/choice-ui-browser.test.mjs` / `test/visibility-browser.test.mjs` / `test/ai-ui-browser.test.mjs` 中的同类调用

**证据**：`page.waitForLoadState('networkidle')` 在 `index.html` 与 `legacy.html` 上**都**超时（TimeoutError 30000ms / 12000ms）。根因是页面持有一条**常驻 SSE 连接** `EventSource('./api/state/events')`（`web/app-new.js:1060` 创建、`:1086` 在 `pagehide` 关闭；旧版 `web/app-legacy.js:1018` / `:1040`），因此「网络空闲」永远不成立。已排除「慢请求」：`performance.getEntriesByType('resource')` 中**没有** `responseEnd === 0` 或 `duration > 10000` 的条目。同时确认这不是产品缺陷——这些功能本身实测都正常（例如字号缩放：选 150% 后 `documentElement` 字号 16px→24px、持久化到 `localStorage['daguan_ui_appearance_new_v1']`、`aria-pressed` 正确、跨页面与刷新均保持）。

**修复建议**：把 `waitForLoadState('networkidle')` 换成显式等待就绪信号，例如：

```js
await page.waitForFunction(() => window.AppState && Array.isArray(window.AppState.questions), null, { timeout: 25000 });
```

或 `waitUntil: 'domcontentloaded'` + 针对被测元素的 `waitForSelector`。全项目 grep 替换 `networkidle` 即可一次性修好这 6 个失败。

**验证方式**：修好后浏览器测试应 26/26 通过。

---

### P3-06 陈旧的界面快照文件随应用一起发布，且可被直接访问

**严重度**：P3
**位置**：`web/index-new-backup.html`（5,298 B，未跟踪）、`web/index-old-backup.html`（66,856 B，未跟踪）、`web/ui-preview/`（未跟踪）

**证据**：`web/index-new-backup.html` 实测 HTTP **200** 可访问，它引用的是**旧版本资源**：`styles-new.css?v=90`（现为 `?v=119`）、`design-tokens.css?v=2`（现为 `?v=3`）、`ui-version.js?v=90`（现为 `?v=106`）、`app-new.js?v=90`（现为 `?v=131`）、图标用 `local-mark.svg`（现为 `local-mark.png`），并且**完全没有** `choice-grading.js`、`study-report.js`、`ai-*.js`、`backup-migration.js` 等 17 个 `defer` 脚本。加载后 `window.ChoiceGrading` 为 `undefined`。`web/index-old-backup.html` 同样返回 200。

由于桌面版 `forge.config.js` 配置为 `asar: false`，`web/` 是**明文目录**，这些文件会随安装包一起落到用户磁盘上。它们与正式界面**共用同一套 `localStorage` 键**（含 `daguan_ui_version_v1`、`daguan_ui_appearance_new_v1`），而 `ui-version.js` 正是负责读写界面版本偏好的模块——用旧版 `ui-version.js?v=90` 写一次就可能让正式界面的偏好读取错乱。

**修复建议**：这些是未跟踪的临时快照，直接删除；若需保留历史版本，移到 `docs/` 或 `archive/` 下（不参与打包），并确保 `forge.config.js` 只打包 `web/` 中真正需要的文件。

**验证方式**：打包产物中不含 `*-backup.html` 与 `ui-preview/`；`/index-new-backup.html` 返回 404。

---

## 2) 已跑命令与测试结果摘录

### 2.1 UI 相关测试（按任务要求，未跑全量 `npm test`）

**非浏览器测试（9 个文件）—— 全通过**

```
node --test test/ui-contract.test.mjs test/dual-ui.test.mjs test/new-ui-core.test.mjs \
              test/new-ui-compat.test.mjs test/new-ui-catalog.test.mjs test/new-ui-search.test.mjs \
              test/choice-grading.test.mjs test/chapter-navigation.test.mjs test/landing-entry.test.mjs

# tests 145 / pass 145 / fail 0 / cancelled 0 / skipped 0 / duration_ms 1044
```

**浏览器测试（6 个文件）—— 19 通过 / 6 失败，失败全部同一原因**

```
DAGUAN_PLAYWRIGHT_MODULE=...\pw\node_modules\playwright \
DAGUAN_CHROMIUM_EXECUTABLE=...\ms-playwright\chromium-1243\chrome-win64\chrome.exe \
node --test test/choice-ui-browser.test.mjs test/font-scale-browser.test.mjs \
              test/answer-scroll-browser.test.mjs test/study-report-browser.test.mjs \
              test/visibility-browser.test.mjs test/ai-ui-browser.test.mjs

# tests 26 / pass 19 / fail 6 / cancelled 1 / skipped 0 / duration_ms 172720
# 6 个失败全部为 waitForLoadState('networkidle') 超时（见 P3-05），非产品缺陷
```

### 2.2 服务与数据隔离

```powershell
$env:DAGUAN_DATA_DIR = "$env:TEMP\dg-audit-04\data"
node local-server/server.mjs        # 端口 18082（另有 18083 用于双实例检查）
```

全程未触碰 `%LOCALAPPDATA%\DaguanMath\data`。审查结束后所有启动的进程均已退出（见 2.4）。

### 2.3 仓库状态（只读检查）

```
git status --short --branch
## main...origin/main
（0 个已跟踪文件被修改；25 个未跟踪：AGENTS.md、.zcodeignore、docs/ui-redesign/*、
  docs/SignPath申请材料草稿.md、docs/干净环境安装验证.md、web/index-{new,old}-backup.html、
  web/ui-preview/、宣贯视频使用介绍-临时.md 等）

git log -1 --oneline
126266d fix: constrain answer reveal scrolling to question content
```

审查结束时再次确认：除本报告外没有新增/修改任何仓库文件。

### 2.4 探针脚本（均位于 `%TEMP%\dg-audit-04\`，仓库外）

| 探针 | 用途 | 关键结论 |
|---|---|---|
| `probe-e2e.mjs` | 首屏资源与启动时序 | FCP 356ms；预取 4.4MB；无 404、无 JS 错误 |
| `probe2–probe5.mjs` | 判题、答案滚动、字号、位置写入 | 判题与字号正常；发现位置写入不一致 |
| `probe6.mjs` | 直接调用 `enterChapterQuestions` | 假警报，改为真实点击（教训已记录） |
| `probe7.mjs` | 真实点击进题库 | 首次发现假警告「上次学习的题目已不在当前题库」 |
| `probe8.mjs` | `lastPositionTrail()` 内部探查 | 修正：相关方法在 `class UIRenderer` 上 |
| `probe9.mjs` | **对照实验：嵌套 vs 顶层 categoryId** | P1-01 的决定性证据 |
| `probe10.mjs` | **真实端到端 + 跨版本投毒复现** | 服务端写叶子 id、`?uiSwitch=1` 自我投毒 |
| `probe11.mjs` | 干净流程点正确项 8.25s 采样 | 无重渲染、无清空（修正早前误判） |
| `probe12.mjs` | **改答案路径 + 外部版本号变化** | T1 正常；T2 判题态被清空（P1-02 决定性证据） |
| `probe13.mjs` | 陈旧快照页可达性 | `/index-new-backup.html` 200 且 `ChoiceGrading` 未定义 |

截图位于 `%TEMP%\dg-audit-04\shots\`（`p9-A-home.png`、`p9-A-library.png`、`p9-B-home.png`、`p9-B-resumed.png`、`p9-C-chapter.png`、`p10-A-question.png`、`p10-B-library-warning.png`）。**未放入仓库**。

### 2.5 已验证为「正常」的功能（避免误报）

- **判题（choice-grading）**：错答 → `selected[0] correct[1] incorrect[0] tags["你的选择","正确答案"] feedback"回答错误，请查看答案与解析" answerVisible true btnAria"true"`，进度 `mastery:"learning", error_prone:true, favorite:true, answered:true, last_ok:false`；正答 → `mastery:"mastered", last_ok:true`；改答案（错→对）4.8s 稳定正确。
- **字号缩放**：`data-font-scale` 为 `1 / 1.15 / 1.3 / 1.5`（显示 100%/115%/130%/150%），150% 时根字号 16px→24px，持久化、`aria-pressed`、跨页面与刷新均正确。
- **答案滚动**（HEAD `126266d`）：展开长答案后滚动被正确约束在 `.question-content` 内，页脚不动。
- **章节导航边界**：第一题的「上一题」正确跳到上一节最后一题（`index 4/5, qid 5671`），「下一题」在末尾回绕到 `index 0 qid 5577`。
- **布局无横向溢出**：1280×860 / 1024×720 / 900×600 / 800×560 / 700×500 / 480×800 六档下 `documentElement.scrollWidth === innerWidth`（新旧界面均是）。
- **无 JS 错误、无 404**：新旧界面 `badStatus: []`、`console.error: []`、`pageerror: []`；唯一的 `requestfailed` 是 `GET /api/state/events :: net::ERR_ABORTED`（SSE 正常拆除）。
- **无内存/监听器泄漏**：25 次视图循环后 DOM 9263→210、堆 22.9MB→18.3MB。
- **无 XSS 面**：`web/app-new.js` 的 52 处 `innerHTML` / 33 处模板字符串中，题目名称与 id 的插值全部经过 `escapeHtml`（`web/app-new.js:1407`），未发现裸拼接题目文本。
- **无全局污染**：`web/app-new.js` 只挂 17 个命名空间化全局（`web/app-new.js:6293-6300`、`:6297`）。
- **数据统计**：1085 个分类节点、最大深度 8、819 个节点含题、6521 道唯一题（与 `manifest.json` 一致；`npm run verify` 内部使用 6342 这一口径，两者不一致，见第 3 节）。题型分布：`subjective` 4677、`single_choice` 1848、`multiple_choice` 4。

---

## 3) 未能验证事项

以下项目**本次审查未取得可靠结论**，请勿据本报告假设它们已通过：

1. **学习报告（study-report）与访问历史（visit-history）的实际交互**：只跑了对应测试文件，未做真实点击的全流程走查（受 P3-05 影响，`study-report-browser` 用例未跑通）。
2. **AI 面板**（`ai-settings.js` / `ai-reading.js` / `ai-panel-layout.js` / `ai-services.css`）与**备份迁移**（`backup-migration.js`）的端到端行为：未逐项实测；`ai-ui-browser` 用例因同一原因未跑通。
3. **Service Worker 离线能力**：`web/service-worker.js` 只在 `ui-bootstrap.js:4` 的 `purge=1` 分支被引用（用于反注册），未见注册代码；`file://` 或 Electron 自定义协议下的离线行为**未验证**。
4. **Electron 桌面特有项**：右键菜单、快捷键、外链打开策略、中文字体渲染（未做像素级比对）**均未验证**——本次审查全部在 Chromium 中通过 HTTP 访问，未启动 Electron 外壳。
5. **`multiple_choice` 判题路径**：全库只有 4 道多选题，所探测章节（331）内为 0 道，**未能用真实数据覆盖**。
6. **「无可信答案时不自动判错」这一边界**：所探测章节 331 内 0 道不可信答案题，**未能用真实数据覆盖**。
7. **双界面一致性的完整比对**：已确认 `web/index-new-backup.html` 是陈旧快照（P3-06）与 `ui-bootstrap.js` 的选择逻辑，但 `web/app2.js`（249,665 B）与 `web/app-legacy.js` 的关系、`index-old-backup.html` 是否仍是任何入口的目标，**未完全厘清**。
8. **题量口径矛盾**：`manifest.json` 计 6521 道唯一题，`tools/verify-web-data.mjs` 使用 6342 这一数字，**未查明差异来源**（可能一处含重复、一处按章节归属去重）。建议后续单独核对。
9. **高 DPI / 最小窗口尺寸下的视觉细节**：仅验证了无横向溢出，未做 200% 缩放的视觉检查。
10. **真实 `%LOCALAPPDATA%\DaguanMath\data` 的历史数据兼容性**：按任务要求全程隔离，因此**未验证**既有用户真实数据目录在新版下的读取表现。

---

## 4) 按性价比排序的优化建议

**第一梯队（先做，1–2 天，直接修复用户可感知的信任问题）**

1. **修 P1-01「继续学习」失效**。改 `resolveChapterForQuestion` 让 `top` 恒为顶层科目，并给 `findCategoryById` 加全树兜底；同时把 `pushLastStudy` 的 `category_id` 统一成顶层科目 id。**这是本次审查最值得先做的事**：一个入口级功能完全不可用，还附带一条事实错误的警告文案。改动集中在 2 个函数，回归面小，且可被单测完全覆盖。
2. **修 P1-02 判题态被清空**。在 `renderQuestion` 末尾补状态回填（或与 `web/app-new.js:5680-5698` 共用渲染逻辑）。改动约 25 行，收益是「同步时不再丢失用户已作答的视觉反馈」。
3. **修 P3-05 测试写法**。全项目把 `waitForLoadState('networkidle')` 换成 `waitForFunction(() => window.AppState && Array.isArray(window.AppState.questions))`。这是**纯收益**改动：6 个失败用例立刻转绿，浏览器测试从 19/26 变成 26/26，后续任何人改前端都能拿到真实的回归信号。**不做这个，前面两项修复就没有自动化保护。**

**第二梯队（本周内，成本低收益明确）**

4. **P2-01 折叠侧边栏加 `inert` / `visibility: hidden`**。CSS 加两行即可修好一个明确的 WCAG 违规，键盘用户立刻受益。
5. **P2-02 首屏瘦身**：`search_index.json`（2.3MB）与 `lecture-video-mappings.json`（444KB）改为按需加载，`local-mark.png`（1.16MB，还加载两次）压缩或换 SVG。首屏传输量可从约 4.4MB 降到 1MB 量级。
6. **P3-06 删掉陈旧快照**。`web/index-new-backup.html`、`web/index-old-backup.html`、`web/ui-preview/` 是未跟踪的临时产物，删掉即消除「旧版 `ui-version.js` 污染界面偏好」的隐患，也让打包目录干净。

**第三梯队（需要排期，收益体现在体感与长期可维护性）**

7. **P2-03 分片粒度下沉到章节**。进任一章节从 3.7MB 降到几百 KB，是低配机上最明显的体感改善，但要改分片生成脚本 + 跑 `npm run verify`，需要预留验证时间。
8. **P2-04 切题改增量更新**。`renderQuestion` 从 50–79ms 降到帧预算内，同时从结构上消除「全量重建导致状态丢失」这类问题（P1-02 的根因之一）。这项改动也是把 379KB 单文件逐步拆成可测模块的切入口——**建议在拆模块时顺带做，而不是为了性能单独大改**。
9. **P3-01 / P3-02 / P3-03 / P3-04 的零散体验修正**：`aria-expanded` 同步、题目页补 `h1`、展开答案后自动滚到解析、连点「下一题」入队。每项都是几行到几十行，可合并成一次「体验与可访问性清理」提交。

**关于「379KB 单文件」这个维护风险**：本次审查**没有**发现它导致的实际缺陷——XSS 面干净、全局无污染、监听器与定时器无泄漏、`removeEventListener=0` 是因为监听器绑在每次重建的新元素或一次性单例上（不是泄漏）。所以不建议以「拆文件」为名义做大规模重构；更划算的做法是**在修 P2-04 时把判题渲染、位置解析这两块最先抽出来**（它们正好对应 P1-01 与 P1-02，抽出来就能独立单测）。

---

## 附：报告产出说明

- 本报告是本次审查**唯一**的写入产物：`F:\AI\大观园本地\docs\desktop-audit-20261001\04-frontend-ui.md`
- 未修改、删除、移动、重命名任何仓库文件；未执行 `git reset` / `clean` / `stash`；未推送、未部署
- 所有服务进程已退出；临时数据目录 `%TEMP%\dg-audit-04\` 按要求保留
