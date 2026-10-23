import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { serviceFixture } from './runtime-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');

async function catalogFixture(t) {
  const { base } = await serviceFixture(t);
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/api/state/events', route => route.abort());
  await page.goto(`${base}/index.html?ui=new`);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.AppState?.categories && window.StateSync?.hydrated);
  return page;
}

function columnNames(page, index) {
  return page.locator('#directory-columns .directory-column').nth(index)
    .locator('.directory-column-name').allInnerTexts();
}

test('严选范围只保留线代严选题入口并隐藏空分类', { timeout: 45000 }, async t => {
  const page = await catalogFixture(t);
  await page.getByText('线性代数', { exact: true }).first().click();
  await page.waitForSelector('#directory-columns');
  const fullChapters = await columnNames(page, 1);
  assert.ok(fullChapters.includes('线代严选题'));
  assert.ok(fullChapters.includes('线性方程组'), '完整范围保留原目录');

  await page.locator('#directory-columns .directory-column').nth(1)
    .getByText('线性方程组', { exact: true }).click();
  assert.equal(await page.locator('#library-node-title').innerText(), '线性方程组');

  await page.getByRole('button', { name: '严选', exact: true }).first().click();
  await page.waitForFunction(() => AppState.chapterScope === 'core');
  await page.waitForFunction(() => document.querySelector('#library-node-title')?.textContent === '线性代数');
  assert.deepEqual(await columnNames(page, 1), ['线代严选题'], '严选范围不重复挂载原章节');
  assert.equal((await page.locator('body').innerText()).includes('线性方程组'), false, '0 题分类应隐藏');

  await page.getByText('线代严选题', { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#library-node-title')?.textContent === '线代严选题');
  assert.deepEqual(await columnNames(page, 2), ['行列式', '矩阵', '向量', '方程组', '特征值与特征向量', '二次型', '数学一专项']);

  await page.getByRole('button', { name: '完整', exact: true }).first().click();
  await page.waitForFunction(() => AppState.chapterScope === 'all');
  const restored = await columnNames(page, 1);
  assert.ok(restored.includes('线性方程组'));
  assert.ok(restored.includes('线代严选题'));
});
