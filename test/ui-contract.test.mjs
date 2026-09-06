import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");

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
