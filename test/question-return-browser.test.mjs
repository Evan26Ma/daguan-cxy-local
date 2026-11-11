import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serviceFixture } from './runtime-fixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');

async function fixture(t, count = 42) {
  const { base } = await serviceFixture(t);
  const browser = await chromium.launch({ ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ serviceWorkers: 'block', timezoneId: 'Asia/Hong_Kong', viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/index.html?ui=new');
  await page.waitForFunction(() => window.StateSync?.hydrated && window.AppState?.categories && document.querySelector('.subject-grid'));
  const ids = await page.evaluate(async count => {
    const ids = Object.keys(AppState.idIndex).filter(id => App.historyLocation(id)).slice(0, count);
    const data = StorageService.getProgress();
    for (const id of ids) {
      data.progress[id] = { mastery: 'learning', error_prone: true, favorite: true, updated_at: new Date().toISOString() };
      StateSync.queueQuestion(id, { mastery: 'learning', error_prone: true, favorite: true });
    }
    data.favorites = ids;
    StorageService.saveProgress(data);
    await StateSync.ensureFlushed();
    await DaguanVisitHistory.merge(ids.map((id, index) => {
      const location = App.historyLocation(id);
      return { question_id: id, category_id: location.top.id, chapter_id: location.leaf.id, visited_at: new Date(Date.now() - index * 1000).toISOString() };
    }));
    return ids;
  }, count);
  return { base, page, ids, errors };
}

async function enterView(page, view) {
  const item = page.locator(`[data-view="${view}"]`);
  const drawerClosed = await page.evaluate(() => innerWidth < 768 && !AppState.ui.navOpen);
  if (drawerClosed) await page.locator('#btn-toggle-nav').click();
  await item.click();
  await page.waitForFunction(view => AppState.currentView === view, view);
}

async function openQuestion(page, button) {
  await button.scrollIntoViewIfNeeded();
  const scrollTop = await page.locator('#app-main').evaluate(el => el.scrollTop);
  await button.click();
  await page.waitForFunction(() => AppState.currentView === 'question' && !!document.querySelector('.question-stem'));
  return scrollTop;
}

async function returnTo(page, name, view, scrollTop) {
  const back = page.getByRole('button', { name, exact: true });
  assert.equal(await back.count(), 1, `题目应提供“${name}”入口`);
  await back.click();
  await page.waitForFunction(view => AppState.currentView === view, view);
  await page.waitForFunction(({ view, scrollTop }) => AppState.currentView === view && Math.abs(document.getElementById('app-main').scrollTop - scrollTop) <= 3, { view, scrollTop });
  assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('class').then(value => value.includes('active')), true);
}

test('列表返回：易错、收藏、待掌握和历史保留原标签、筛选与滚动位置', { timeout: 60000 }, async t => {
  const { page, ids, errors } = await fixture(t);
  for (const [tab, label] of [['mistakes', '易错题'], ['favorites', '收藏'], ['todo', '待掌握']]) {
    await enterView(page, 'review');
    await page.getByRole('tab', { name: new RegExp(label) }).click();
    await page.waitForFunction(() => document.querySelectorAll('.review-item').length === 42);
    const scrollTop = await openQuestion(page, page.locator('.review-item button').nth(25));
    await returnTo(page, `返回${label}`, 'review', scrollTop);
    assert.equal(await page.evaluate(() => AppState.reviewTab), tab);
    assert.equal(await page.getByRole('tab', { name: new RegExp(label) }).getAttribute('aria-selected'), 'true');
  }
  await enterView(page, 'history');
  await page.locator('[data-history-filter="query"]').fill(ids[0]);
  await page.locator('[data-history-filter="mastery"]').selectOption('learning');
  await page.locator('[data-history-filter="favorite"]').selectOption('yes');
  const scrollTop = await openQuestion(page, page.locator('[data-history-open]').first());
  await returnTo(page, '返回历史', 'history', scrollTop);
  assert.equal(await page.locator('[data-history-filter="query"]').inputValue(), ids[0]);
  assert.equal(await page.locator('[data-history-filter="mastery"]').inputValue(), 'learning');
  assert.equal(await page.locator('[data-history-filter="favorite"]').inputValue(), 'yes');
  assert.deepEqual(errors, []);
});

test('学习记录返回：保留回看日期、展开片段、已加载题目、题干预览与滚动位置', { timeout: 60000 }, async t => {
  const { base, page, ids, errors } = await fixture(t);
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  const response = await fetch(base + '/api/study-activity/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: ids.slice(0, 35).map(id => ({ event_id: crypto.randomUUID(), question_id: id, at, type: 'study', chapter_name: '返回导航练习' })) }) });
  assert.equal(response.status, 200);
  await enterView(page, 'records');
  await page.locator('.journal-day', { hasText: '35 题' }).click();
  const day = await page.locator('[data-journal-date]').inputValue();
  await page.locator('.journal-log > summary').first().click();
  await page.getByRole('button', { name: '显示更多题目', exact: true }).click();
  assert.equal(await page.locator('.journal-question').count(), 35);
  const row = page.locator('.journal-question').nth(32);
  await row.locator('.journal-preview > summary').click();
  await page.waitForFunction(() => !document.querySelectorAll('.journal-stem')[32].textContent.includes('正在读取'));
  const scrollTop = await openQuestion(page, row.getByRole('button', { name: '回到这题', exact: true }));
  await returnTo(page, '返回学习记录', 'records', scrollTop);
  assert.equal(await page.locator('[data-journal-date]').inputValue(), day);
  assert.equal(await page.locator('.journal-log').first().evaluate(el => el.open), true);
  assert.equal(await page.locator('.journal-question').count(), 35);
  assert.equal(await page.locator('.journal-question').nth(32).locator('.journal-preview').evaluate(el => el.open), true);
  assert.deepEqual(errors, []);
});

test('返回来源页后，在途模式切换完成也不会覆盖列表', { timeout: 30000 }, async t => {
  const { page, errors } = await fixture(t, 3);
  await page.evaluate(() => localStorage.setItem('daguan_new_question_mode_v1', 'multi'));
  await enterView(page, 'history');
  await page.locator('[data-history-open]').first().click();
  await page.waitForSelector('.multi-question-view');
  await page.evaluate(() => {
    const load = DataService.loadQuestionsForChapter;
    DataService.loadQuestionsForChapter = async (...args) => {
      await new Promise(resolve => { window.finishModeSwitch = resolve; });
      return load.apply(DataService, args);
    };
    window.pendingModeSwitch = App.changeQuestionMode('single');
  });
  await page.waitForFunction(() => typeof window.finishModeSwitch === 'function');
  await page.getByRole('button', { name: '返回历史', exact: true }).click();
  await page.waitForSelector('#history-results');
  await page.evaluate(async () => { finishModeSwitch(); await pendingModeSwitch; });
  assert.equal(await page.evaluate(() => AppState.currentView), 'history');
  assert.equal(await page.locator('#history-results').count(), 1, '在途模式切换不得把返回后的列表重新覆盖成题目');
  assert.equal(await page.locator('.question-stem').count(), 0);
  assert.deepEqual(errors, []);
});

test('返回导航兼容连续做题和手机；保存失败留在原题，侧栏离开后不残留旧入口', { timeout: 60000 }, async t => {
  const { page, errors } = await fixture(t, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('daguan_new_question_mode_v1', 'multi'));
  await enterView(page, 'history');
  await page.locator('[data-history-open]').first().click();
  await page.waitForSelector('.multi-question-view');
  assert.equal(await page.getByRole('button', { name: '返回历史', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '单题做题', exact: true }).click();
  await page.waitForSelector('.question-stem');
  await page.evaluate(() => { window.originalFlush = App.flushAnnotationNow; App.flushAnnotationNow = async () => { throw new Error('返回保存失败测试'); }; });
  await page.getByRole('button', { name: '返回历史', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('返回保存失败测试'));
  assert.equal(await page.evaluate(() => AppState.currentView), 'question');
  assert.equal(await page.getByRole('button', { name: '返回历史', exact: true }).count(), 1);
  await page.evaluate(() => { App.flushAnnotationNow = window.originalFlush; delete window.originalFlush; });
  await returnTo(page, '返回历史', 'history', 0);
  await page.locator('[data-history-open]').first().click();
  await page.waitForSelector('.question-stem');
  await enterView(page, 'library');
  await page.evaluate(async () => {
    const location = App.historyLocation(Object.keys(AppState.idIndex).find(id => App.historyLocation(id)));
    AppState.currentCategory = location.top;
    await App.showChapter(location.leaf);
  });
  await page.waitForSelector('.question-stem');
  assert.equal(await page.getByRole('button', { name: '返回历史', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
