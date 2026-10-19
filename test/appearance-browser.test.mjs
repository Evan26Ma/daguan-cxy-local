import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { serviceFixture } from './runtime-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');

async function appearanceFixture(t) {
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

async function navigate(page, view) {
  await page.locator(`.nav-item[data-view="${view}"]`).click();
  await page.waitForFunction(view => AppState.currentView === view, view);
}

const appearance = page => page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  brand: document.documentElement.style.getPropertyValue('--brand-orange'),
  fontScale: document.documentElement.style.getPropertyValue('--ui-font-scale'),
  saved: StorageService.getUIAppearance(),
}));

test('更换主题后直接进入题库、切换页面和刷新均保留外观', { timeout: 45000 }, async t => {
  const page = await appearanceFixture(t);
  await navigate(page, 'settings');
  await page.locator('[data-theme-preset="orange-night"]').click();
  assert.equal((await appearance(page)).theme, 'orange-night');
  await navigate(page, 'library');
  let current = await appearance(page);
  assert.equal(current.theme, 'orange-night', 'issue #6：进入题库不能把预览颜色重置为旧主题');
  assert.equal(current.brand, '#FF8A3D');
  assert.equal(current.saved.theme, 'orange-night');
  await navigate(page, 'home');
  await navigate(page, 'settings');
  await page.locator('[data-appearance-color="brand"]').fill('#123456');
  await page.locator('[data-font-scale="1.5"]').click();
  await navigate(page, 'notes');
  assert.equal((await appearance(page)).saved.brand, '#123456', '从其他导航离开也应保存颜色');
  await navigate(page, 'library');
  current = await appearance(page);
  assert.equal(current.theme, 'custom');
  assert.equal(current.brand, '#123456');
  assert.equal(current.fontScale, '1.5');
  await page.reload();
  await page.waitForFunction(() => window.AppState?.categories && window.StateSync?.hydrated);
  current = await appearance(page);
  assert.equal(current.theme, 'custom');
  assert.equal(current.brand, '#123456');
  assert.equal(current.fontScale, '1.5');
});

test('应用和取消保留原有含义，字号即时保存不提交颜色预览', { timeout: 45000 }, async t => {
  const page = await appearanceFixture(t);
  await navigate(page, 'settings');
  await page.locator('[data-theme-preset="blue-sand"]').click();
  await page.locator('#appearance-apply').click();
  await page.locator('[data-appearance-color="brand"]').fill('#123456');
  await page.locator('[data-font-scale="1.5"]').click();
  assert.equal((await appearance(page)).saved.brand, '#1E4A5C');
  await page.locator('#appearance-cancel').click();
  await navigate(page, 'library');
  const current = await appearance(page);
  assert.equal(current.theme, 'blue-sand');
  assert.equal(current.brand, '#1E4A5C');
  assert.equal(current.fontScale, '1.5');
  assert.equal(current.saved.brand, '#1E4A5C');
});

test('顶栏首页和搜索离开设置后，题库继续使用所选主题', { timeout: 45000 }, async t => {
  const page = await appearanceFixture(t);
  for (const [action, view, theme] of [['show-home', 'home', 'mint'], ['open-search', 'global-search', 'orange-night']]) {
    await navigate(page, 'settings');
    await page.locator(`[data-theme-preset="${theme}"]`).click();
    await page.locator(action === 'open-search' ? '#btn-global-search' : '[data-app-action="show-home"]').click();
    await page.waitForFunction(view => AppState.currentView === view, view);
    assert.equal((await appearance(page)).saved.theme, theme);
    await navigate(page, 'library');
    assert.equal((await appearance(page)).theme, theme);
  }
});

test('外观存储持续失败时，取消预览后仍能正常离开设置', { timeout: 45000 }, async t => {
  const page = await appearanceFixture(t);
  await navigate(page, 'settings');
  const saved = (await appearance(page)).saved;
  await page.locator('[data-theme-preset="mint"]').click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'daguan_ui_appearance_new_v1') throw new Error('simulated appearance save failure');
      return setItem.call(this, key, value);
    };
  });
  await page.locator('.nav-item[data-view="library"]').click();
  await page.getByText(/外观尚未保存/).waitFor();
  await page.locator('#appearance-cancel').click();
  await navigate(page, 'library');
  assert.equal((await appearance(page)).theme, saved.theme);
});

test('外观保存失败时留在设置并保留当前预览，重试后进入题库', { timeout: 45000 }, async t => {
  const page = await appearanceFixture(t);
  await navigate(page, 'settings');
  await page.locator('[data-theme-preset="mint"]').click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    window.restoreAppearanceStorage = () => { Storage.prototype.setItem = setItem; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'daguan_ui_appearance_new_v1') throw new Error('simulated appearance save failure');
      return setItem.call(this, key, value);
    };
  });
  await page.locator('.nav-item[data-view="library"]').click();
  await page.getByText(/外观尚未保存/).waitFor();
  assert.equal(await page.evaluate(() => AppState.currentView), 'settings');
  assert.equal((await appearance(page)).theme, 'mint');
  await page.evaluate(() => { window.restoreAppearanceStorage(); });
  await navigate(page, 'library');
  assert.equal((await appearance(page)).saved.theme, 'mint');
});
