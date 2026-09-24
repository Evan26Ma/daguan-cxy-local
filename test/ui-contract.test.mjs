import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../web/app2.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../local-server/server.mjs", import.meta.url), "utf8");

test("工具区拥有独立选中态和清晰的同步入口", () => {
  assert.match(app, /const toolsWorkspace = name === "feature" && state\.feature === "tools"/);
  assert.match(app, /workspaceTools\?\.classList\.toggle\("active", toolsWorkspace\)/);
  assert.match(app, /feature-open-sync-guide/);
  assert.match(app, /feature-open-sync/);
});

test("章节导航提供显式返回、面包屑和逐列层级快照", () => {
  assert.match(html, /id="chapter-menu-back"/);
  assert.match(html, /id="chapter-menu-path"[^>]*aria-label="当前目录路径"/);
  assert.match(app, /const columnDepth = depth/);
  assert.match(app, /slice\(0, columnDepth\)\.concat/);
  assert.match(css, /\.chapter-menu-back[^}]*min-height:\s*2\.75rem/s);
});

test("题库详细筛选在题库目录和顶部直接可见", () => {
  assert.match(html, /class="chapter-head"[\s\S]*id="btn-adv-filter"/);
  assert.match(html, /class="btn ghost topbar-filter-trigger" id="btn-adv-filter-top"/);
  const moreMenu = html.match(/id="topbar-more-menu"[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(moreMenu, /btn-adv-filter-top/);
  assert.match(app, /querySelectorAll\("#btn-adv-filter, #btn-adv-filter-top"\)/);
});

test("官网同步教程在首页、工具区和同步中心均可到达", () => {
  assert.match(html, /id="dlg-sync-guide"/);
  assert.match(html, /id="btn-home-sync-guide"/);
  assert.match(html, /id="btn-online-sync-guide"/);
  assert.match(app, /btn-sync-guide-setup/);
  assert.match(app, /btn-sync-guide-center/);
});

test("AI 不再提供页面常驻入口，只保留题目入口", () => {
  assert.doesNotMatch(html, /id="ai-edge-tab"/);
  assert.match(html, /id="btn-single-ai"/);
  assert.match(app, /aiBtn\.addEventListener\("click", \(\) => openAiForQuestion\(q\)\)/);
  assert.match(css, /\.ai-edge-tab\s*\{\s*display:\s*none\s*!important/);
});

test("同步流程使用清晰的两步入口并隐藏低频操作", () => {
  assert.match(html, /id="btn-home-sync"/);
  assert.doesNotMatch(html, /id="btn-home-sync-setup"/);
  assert.doesNotMatch(html, /id="btn-home-pull"|id="btn-home-push"/);
  assert.match(html, /id="sync-flow-card"/);
  assert.match(html, /id="sync-summary"/);
  assert.match(html, /id="sync-advanced"/);
  assert.match(html, /id="btn-sync-push"[^>]*>确认同步/);
  assert.doesNotMatch(html, /应用对账计划|统一对账/);
  assert.match(app, /needsFirstSync/);
  assert.match(app, /remoteQuestionCount/);
  assert.match(app, /进度有新变化，请再次确认/);
});

test("首页不再显示无效的其他章节入口", () => {
  assert.doesNotMatch(html, /id="btn-hero-other"/);
  assert.doesNotMatch(app, /btn-hero-other/);
  assert.doesNotMatch(css, /chapter-menu-home-open/);
});

test("中等桌面宽度下侧栏仍保留手动展开按钮", () => {
  assert.match(css, /#app\.learning-shell \.sidebar-collapse\s*\{\s*display:\s*inline-flex\s*;?\s*\}/);
  assert.doesNotMatch(css, /#app\.learning-shell \.sidebar-collapse\s*\{\s*display:\s*none\s*!important?\s*\}/);
  assert.match(css, /#app\.learning-shell:not\(\[data-sidebar="collapsed"\]\) \.sidebar\s*\{\s*width:\s*var\(--shell-sidebar-width\)\s*;/);
  assert.match(css, /#app\.learning-shell:not\(\[data-sidebar="collapsed"\]\) \.brand span\s*\{\s*display:\s*inline\s*;/);
});

test("浏览题目时展开侧栏仍显示题库树", () => {
  assert.match(html, /id="app"[^>]*data-sidebar="expanded"/);
  assert.match(html, /id="cat-tree"[^>]*aria-label="分类"/);
  assert.match(css, /body\[data-view="browse"\] #app\.learning-shell \.learning-shell__sidebar\s*\{\s*display:\s*flex\s*!important/s);
  assert.match(css, /body\[data-view="browse"\] #app\.learning-shell\s*\{\s*display:\s*grid/s);
  assert.match(css, /body\[data-view="browse"\] #app\.learning-shell:not\(\[data-sidebar="collapsed"\]\) \.cat-tree\s*\{\s*display:\s*block\s*!important/s);
  assert.match(css, /body\[data-view="browse"\] #app\.learning-shell #btn-open-sidebar\s*\{\s*display:\s*inline-flex\s*!important/s);
});

test("首屏不阻塞加载题库索引", () => {
  assert.doesNotMatch(app, /const \[manifest, categories\] = await Promise\.all\(\[[\s\S]*?hydrated,[\s\S]*?serverHydrated,[\s\S]*?\]\);/);
  assert.match(app, /Promise\.allSettled\(\[hydrated, serverHydrated\]\)/);
  assert.match(app, /function ensureIndexes\(\)/);
});

test("Service Worker 不预缓存首屏之外的大型索引和字体", () => {
  const sw = fs.readFileSync(new URL("../web/service-worker.js", import.meta.url), "utf8");
  assert.match(sw, /daguan-shell-v74/);
  assert.match(app, /service-worker\.js\?v=71/);
  assert.doesNotMatch(sw, /data\/(category_questions|id_index|search_index)\.json/);
  assert.doesNotMatch(sw, /vendor\/fonts\//);
});

test("Service Worker 响应始终重新校验，避免线上继续命中旧脚本", () => {
  assert.match(server, /const isServiceWorker = path\.basename\(file\) === "service-worker\.js"/);
  assert.match(server, /isHtml \|\| isServiceWorker \? "no-cache"/);
});

test("公开预览版只读，个人功能需要预览密钥", () => {
  assert.match(server, /DAGUAN_PREVIEW_KEY/);
  assert.match(server, /PREVIEW_LOCKED/);
  assert.match(server, /api\/access\/unlock/);
  assert.match(app, /api\/access\/status/);
  assert.match(app, /previewPrivateAllowed/);
  assert.match(html, /dlg-preview-access/);
});

test("首页继续按钮回到上次刷题题目", () => {
  assert.match(html, /id="btn-start"/);
  assert.match(app, /startButton\.textContent = canResume \? "继续"/);
  assert.match(app, /async function resumeSavedLearningPosition\(\)/);
  assert.match(app, /openCategory\(leaf\.id, state\.last_study\.question_id/);
  assert.match(app, /if \(await resumeSavedLearningPosition\(\)\) return/);
});

test("沉浸模式隐藏左侧导航并让 AI 抽屉宽度参与页面布局", () => {
  assert.match(css, /body\.focus-mode #app\.learning-shell \.learning-shell__sidebar\s*,[\s\S]*display:\s*none\s*!important/s);
  assert.match(css, /body\.focus-mode #app\.learning-shell\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*!important/s);
  assert.match(css, /body\.ai-drawer-open #app\.learning-shell\s*\{\s*margin-right:\s*var\(--ai-drawer-width/s);
  assert.match(css, /\.ai-drawer\s*\{[\s\S]*container-type:\s*inline-size/s);
  assert.match(css, /@container \(max-width:\s*380px\)/);
});

test("单题展示统一为沉浸模式，快捷键只在沉浸模式显示", () => {
  assert.doesNotMatch(html, /id="btn-focus-mode"/);
  assert.match(html, /id="mode-single"[^>]*>沉浸<\/button>/);
  assert.match(app, /if \(mode === "single"\) \{\s*enterFocusMode\(\);/s);
  assert.match(app, /if \(!out\.answer \|\| out\.answer === "Space"/);
  assert.match(css, /#app\.learning-shell \.shortcut-hint\s*\{\s*display:\s*none/s);
  assert.match(css, /body\.focus-mode #app\.learning-shell \.shortcut-hint:not\(\[hidden\]\)\s*\{\s*display:\s*inline-flex/s);
});

test("iPad 外接键盘可以通过 event.code 使用沉浸快捷键", () => {
  assert.match(app, /const SHORTCUT_CODE_FALLBACK = Object\.freeze/);
  assert.match(app, /Space:\s*" "/);
  assert.match(app, /F6:\s*"F6"/);
  assert.match(app, /function shortcutEventKey\(event\)/);
  assert.match(app, /SHORTCUT_CODE_FALLBACK\[event\.code\]/);
  assert.match(app, /const key = shortcutEventKey\(e\)/);
});

test("主题色统一驱动学习区按钮且自定义背景绘制在页面容器", () => {
  assert.match(css, /--dg-teal:\s*var\(--color-brand\)/);
  assert.match(css, /#app\.learning-shell \.q-actions \.btn\.primary\s*\{\s*background:\s*var\(--dg-teal\)/);
  assert.match(css, /html\[data-theme="custom"\] #app\.learning-shell\s*\{[\s\S]*?background-image:/);
  assert.match(app, /--custom-background-image/);
});

test("AI 对话区区分用户和 AI 消息颜色", () => {
  assert.match(html, /id="ui-ai-user-color"/);
  assert.match(app, /aiUserColor:\s*"#356fe5"/);
  assert.match(app, /--ai-user-color/);
  assert.match(css, /\.ai-message-user\s*\{[\s\S]*?color:\s*var\(--ai-user-color\)/);
  assert.match(css, /\.ai-message-assistant\s*\{[\s\S]*?color:\s*var\(--color-foreground\)/);
  assert.match(css, /\.ai-message-user::before\s*\{[\s\S]*?content:\s*"用户"/);
  assert.match(css, /\.ai-message-assistant::before\s*\{[\s\S]*?content:\s*"AI"/);
});

test("沉浸模式提供清晰的退出入口", () => {
  assert.match(html, /id="btn-exit-focus"[^>]*>退出沉浸/);
  assert.match(app, /#btn-exit-focus.*addEventListener\("click", exitFocusMode\)/);
  assert.match(css, /#app\.learning-shell \.focus-exit\s*\{\s*display:\s*none/);
  assert.match(css, /body\.focus-mode #app\.learning-shell \.focus-exit\s*\{\s*display:\s*inline-flex/);
});

test("没有当前题目时进入沉浸模式不会把首页切成空白页", () => {
  assert.match(app, /if \(state\.view !== "browse" \|\| !currentQ\(\)\) \{/);
  assert.match(app, /请先选择章节并打开一道题，再进入沉浸模式/);
  assert.match(app, /const opened = leafId != null[\s\S]*?if \(opened && position\.mode === "single"\) enterFocusMode\(\);/);
  assert.match(css, /body\.focus-mode\[data-view="browse"\] #app\.learning-shell \.learning-shell__sidebar\s*\{[\s\S]*display:\s*none\s*!important/s);
});

test("已收藏状态使用绿色 UI 标记", () => {
  assert.match(app, /el\.classList\.toggle\("active", on\)/);
  assert.match(css, /\.q-actions \.btn\[data-favorite-id\]\.active[\s\S]*?color:\s*var\(--color-success\)/);
  assert.match(css, /#btn-toggle-favorite\.active/);
});

test("沉浸模式末题可以自动进入下一小节", () => {
  assert.match(app, /function findAdjacentChapter\(delta\)/);
  assert.match(app, /async function go\(delta\)/);
  assert.match(app, /next >= state\.queue\.length && delta > 0 && state\.focusMode/);
  assert.match(app, /const opened = await goToAdjacentChapter\(1\)/);
  assert.match(app, /state\.focusSnapshot\.index = 0/);
  assert.match(app, /const canContinueToNextChapter = state\.focusMode && Boolean\(findAdjacentChapter\(1\)\)/);
});

test("AI 流式回答节流渲染并在回到前台时恢复", () => {
  assert.match(app, /const aiStreamStates = new Set\(\)/);
  assert.match(app, /stream\.timer = window\.setTimeout\(paintNow, 120\)/);
  assert.match(app, /function refreshAiAfterResume\(\)/);
  assert.match(app, /else refreshAiAfterResume\(\)/);
  assert.match(app, /window\.addEventListener\("pageshow", refreshAiAfterResume\)/);
});

test("AI 题目入口提供完整解答和错题分析模板", () => {
  assert.match(html, /请按步骤逐步依次解答这道题[\s\S]*每个过程用到的信息可以从题目、图像、条件、选项或答案解析中的哪里提取/);
  assert.match(html, /解答结束后说明答案是什么[\s\S]*第一时间应该想到什么[\s\S]*此类题解的通式是什么[\s\S]*有没有类似题/);
  assert.match(html, /只围绕这些内容回答，不要添加其他无关内容/);
  assert.match(html, /错题模板/);
  assert.match(html, /错题分析/);
  assert.match(html, /所有数学公式都使用 LaTeX 格式/);
  assert.match(html, /只使用半角标点符号/);
});

test("AI 输入框回车发送且 Shift+Enter 换行", () => {
  assert.match(app, /\$\("#ai-prompt"\)\?\.addEventListener\("keydown"/);
  assert.match(app, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(app, /event\.preventDefault\(\);\s*sendAiMessage\(\);/);
});

test("切换题目时清空 AI 助手并停止上一题的回答", () => {
  assert.match(app, /function clearAiForQuestion\(q\)/);
  assert.match(app, /clearAiForQuestion\(state\.queue\[state\.index\] \|\| null\)/);
  assert.match(app, /function renderSingle\(\)\s*\{[\s\S]*?clearAiForQuestion\(q\)/);
  assert.match(app, /renderAiHistory\(null\)/);
  assert.match(app, /stream\.controller\?\.abort\(\)/);
  assert.match(app, /state\.aiQuestionId !== questionId/);
});

test("AI 输入框在桌面停靠左下角并在非聊天页隐藏", () => {
  assert.match(html, /<form class="ai-compose ai-compose-dock hidden" id="ai-compose"/);
  assert.match(app, /\$\("#ai-compose"\)\?\.classList\.toggle\("hidden", !state\.aiOpen \|\| state\.aiTab !== "chat"\)/);
  assert.match(app, /\$\("#ai-compose"\)\?\.classList\.add\("hidden"\)/);
  assert.match(css, /body\.ai-drawer-open #ai-compose\.ai-compose-dock\[data-ai-compose-position="left"\]:not\(\.hidden\)[\s\S]*position:\s*fixed/);
  assert.match(css, /body\.ai-drawer-open #ai-compose\.ai-compose-dock\[data-ai-compose-position="left"\]:not\(\.hidden\)[\s\S]*left:\s*max\(1rem/);
});

test("AI 输入框支持原位、左下角和右侧下方三种停靠位置", () => {
  assert.match(html, /id="ui-ai-compose-position"/);
  assert.match(html, /value="drawer">AI 面板内/);
  assert.match(html, /value="left">左下角/);
  assert.match(html, /value="right">右侧下方/);
  assert.match(app, /aiComposePosition:\s*"left"/);
  assert.match(app, /function applyAiComposePosition\(\)/);
  assert.match(app, /form\.classList\.toggle\("ai-compose-dock", mode !== "drawer"\)/);
  assert.match(app, /uiPrefs\.aiComposePosition = \["drawer", "left", "right"\]/);
  assert.match(css, /data-ai-compose-position="right"[\s\S]*bottom:\s*max\(5\.5rem/);
});

test("进度统计兼容数字时间戳和 ISO 时间", () => {
  assert.match(app, /function timestampOf\(value\)/);
  assert.match(app, /const parsed = Date\.parse\(value\)/);
  assert.match(app, /function practiceTimestamp\(progress\)/);
  assert.match(app, /last_practiced_at/);
  assert.match(app, /practiceTimestamp\(p\)/);
  assert.match(app, /timestampOf\(p\.updated_at\)/);
  assert.match(app, /new Date\(timestampOf\(latest\.updated_at\)\)/);
  assert.match(server, /if \(incoming\.seen != null\) entry\.seen = incoming\.seen === true/);
  assert.match(server, /if \(incoming\.last_practiced_at != null\) entry\.last_practiced_at = incoming\.last_practiced_at/);
});

test("同步预览按章节和小节展示可展开题号明细", () => {
  assert.match(html, /id="sync-detail"/);
  assert.match(app, /function syncQuestionPathMap\(\)/);
  assert.match(app, /function renderSyncDetails\(preview\)/);
  assert.match(app, /同步预览.*ensureIndexes|await ensureIndexes\(\)[\s\S]*reconcilePreview/s);
  assert.match(app, /sync-detail-group/);
});

test("单题界面不再显示勾选项且答案快捷键显示 Space", () => {
  assert.doesNotMatch(html, /id="single-pick"|勾选本题/);
  assert.doesNotMatch(app, /single-pick/);
  assert.match(html, /id="btn-toggle-answer"[^>]*>[\s\S]*<kbd[^>]*>空格<\/kbd>/);
  assert.match(app, /if \(!out\.answer \|\| out\.answer === "Space"/);
  assert.match(app, /if \(normalized === " "\) return "空格"/);
});

test("AI 学习助手支持鼠标拖拽和键盘调整宽度", () => {
  assert.match(html, /id="ai-resize-handle"[^>]*aria-valuemin="340"[^>]*aria-valuemax="620"/);
  assert.match(app, /function setAiDrawerWidth\(value\)/);
  assert.match(app, /handle\.addEventListener\("pointerdown"/);
  assert.match(app, /handle\.addEventListener\("keydown"/);
  assert.match(app, /localStorage\.setItem\(AI_WIDTH_KEY/);
  assert.match(css, /\.ai-resize-handle::after/);
  assert.match(css, /\.ai-resize-handle::before/);
  assert.match(css, /body\.ai-drawer-resizing \.ai-drawer[\s\S]*transition: none !important/);
  assert.match(css, /@media \(min-width: 80rem\)[\s\S]*body\.ai-drawer-open #app\.learning-shell/);
  assert.match(css, /\.ai-messages\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.ai-message-body pre\s*\{[\s\S]*white-space:\s*pre-wrap/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(app, /lostpointercapture/);
});
