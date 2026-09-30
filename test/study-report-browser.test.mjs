import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try { playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright'); } catch {}
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';
const question = { id: 32, type: 'single_choice', stem: '战报回归题', answer: 'B', explanation: '答案为 B', options: [{ label: 'A', content_md: '错误项' }, { label: 'B', content_md: '正确项' }], correct_labels: ['B'] };
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-study-browser-'));
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const service = spawn(process.execPath, [path.join(ROOT, 'local-server/server.mjs')], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: path.join(temp, 'data'), DAGUAN_OPEN_BROWSER: '0' } });
  t.after(async () => {
    if (service.exitCode == null) { service.send({ type: 'shutdown' }); await Promise.race([once(service, 'close'), new Promise(r => setTimeout(r, 3000))]); if (service.exitCode == null) service.kill(); }
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 50)); }
  assert.ok(ready);
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const source = await fs.readFile(path.join(ROOT, 'web/app-legacy.js'), 'utf8');
  await context.route('**/app-legacy.js*', r => r.fulfill({ contentType: 'application/javascript', body: source.replace('window.DaguanDesktopSwitch = setUiVersion;', 'window.__studyTest={state,renderSingle,renderFeed,setView,applyMode}; window.DaguanDesktopSwitch = setUiVersion;') }));
  return { page, context, base, errors, temp };
}
async function goto(page, base, ui) {
  await page.goto(base + (ui === 'old' ? '/legacy.html?ui=old' : '/index.html?ui=new'));
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(ui === 'old' ? 'window.__studyTest' : 'window.AppState?.categories && window.StateSync?.hydrated');
}
async function render(page, ui, mode, id = 32) {
  await page.evaluate(async ({ q, ui, mode }) => {
    if (ui === 'old') {
      const h = window.__studyTest; h.state.queue = [q]; h.state.index = 0; h.state.showAnswer = false; h.state.selected = new Set(); h.state.cardUI.clear();
      h.setView('browse'); h.applyMode(mode === 'single' ? 'single' : 'list'); if (mode === 'single') h.renderSingle(); else h.renderFeed(true);
    } else {
      AppState.questions = [q]; AppState.currentQuestionIndex = 0; AppState.currentView = 'question'; AppState.answers = {}; AppState.currentCategory = null; AppState.currentChapter = null; AppState.questionMode = mode;
      if (mode === 'single') await UIRenderer.renderQuestion(0); else UIRenderer.renderMultiQuestions(0);
    }
  }, { q: { ...question, id }, ui, mode });
}
const flush = page => page.evaluate(() => DaguanStudyActivity.flush());
const summary = page => page.evaluate(() => DaguanStudyActivity.summary(1));

for (const ui of ['new', 'old']) for (const mode of ['single', 'multi']) test(`${ui}/${mode}：真实作答和答案显隐保持首答口径`, { skip, timeout: 45000 }, async t => {
  const { page, base, errors } = await fixture(t); await goto(page, base, ui);
  await render(page, ui, mode);
  assert.equal((await summary(page)).metrics.learned, 0, '纯浏览不计题数');
  const choices = page.locator(ui === 'new' ? '.question-options .option-item' : mode === 'single' ? '#q-options .opt' : '.q-card .opt');
  await choices.nth(0).click(); await choices.nth(1).click(); await flush(page);
  let s = await summary(page);
  assert.equal(s.metrics.learned, 1); assert.equal(s.metrics.firstPass, 0); assert.equal(s.metrics.conquered, 0); assert.equal(s.metrics.favorites, 1);
  assert.equal(s.favoriteSources.automatic, 1);
  await render(page, ui, mode, 33); await choices.nth(1).click(); await flush(page);
  assert.equal((await summary(page)).metrics.firstPass, 1);
  await render(page, ui, mode, 34);
  const toggle = page.locator(ui === 'new' ? mode === 'single' ? '#show-answer-btn' : '.expand-answer-btn' : mode === 'single' ? '#btn-toggle-answer' : '.q-card .q-actions button').filter({ hasText: /答案/ }).first();
  await toggle.click(); await toggle.click(); await choices.nth(1).click(); await flush(page);
  s = await summary(page);
  assert.equal(s.metrics.learned, 3); assert.equal(s.metrics.firstPass, 1, '看答案再隐藏也不能一遍过');
  assert.deepEqual(errors, []);
});

test('首页范围、详情、跨窗口更新、150%布局及离线刷新重试与备份', { skip, timeout: 60000 }, async t => {
  const { page, context, base, errors, temp } = await fixture(t); await goto(page, base, 'new');
  await page.waitForSelector('.study-report-metrics');
  assert.equal(await page.locator('[data-study-days="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.study-report-metrics strong').first().innerText(), '0');
  await page.locator('[data-study-days="365"]').click(); await page.locator('#study-details-toggle').click();
  await page.waitForSelector('.study-heat'); assert.equal(await page.locator('.study-heat').count(), 365);
  await page.evaluate(() => { document.documentElement.style.setProperty('--ui-font-scale', '1.5'); });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(temp, 'study-report-150.png') });
  const second = await context.newPage(); await goto(second, base, 'new');
  await render(second, 'new', 'single'); await second.locator('.question-options .option-item').nth(1).click(); await flush(second);
  await page.waitForFunction(() => document.querySelector('.study-report-metrics strong')?.textContent === '1');
  await context.route('**/api/study-activity/events', r => r.abort());
  await render(second, 'new', 'single', 33); await second.locator('.question-options .option-item').nth(0).click();
  await second.waitForFunction(() => DaguanStudyActivity.pendingCount() >= 3);
  const pendingIds = await second.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daguan_study_event_v1:')));
  await second.reload(); await second.waitForLoadState('networkidle');
  assert.deepEqual(await second.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daguan_study_event_v1:'))), pendingIds);
  await context.unroute('**/api/study-activity/events'); await flush(second); await flush(second);
  const s = await summary(second); assert.equal(s.metrics.learned, 2); assert.equal(s.metrics.favorites, 1);
  const data = await second.evaluate(() => DaguanStudyActivity.export());
  await second.evaluate(async data => { await DaguanStudyActivity.restore(data); await DaguanStudyActivity.restore(data); }, data);
  assert.equal((await summary(second)).metrics.learned, 2);
  const { events } = await (await fetch(base + '/api/study-activity/export')).json();
  assert.equal(Object.values(events).filter(e => e.type === 'answer').length, 2);
  await assert.rejects(async () => second.evaluate(() => DaguanStudyActivity.restore({ version: 1, started_at: 'bad', baseline: {}, events: {} })));
  await second.evaluate(async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'daguan_study_backup_cache_v1') throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    try { await DaguanStudyActivity.export(); } finally { Storage.prototype.setItem = original; }
  });
  assert.equal(await second.evaluate(() => localStorage.getItem('daguan_study_backup_cache_v1')), null);
  await context.route('**/api/study-activity/export', r => r.abort());
  await assert.rejects(async () => second.evaluate(() => DaguanStudyActivity.export()), '离线时不能使用已过期的备份缓存');
  assert.deepEqual(errors, []);
});
