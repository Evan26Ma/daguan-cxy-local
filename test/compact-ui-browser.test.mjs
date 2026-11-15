import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try { playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright'); } catch {}
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';

async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value >= 12000 ? value : port();
}

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-compact-ui-'));
  const number = await port();
  const service = spawn(process.execPath, [path.join(ROOT, 'local-server/server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(number), DAGUAN_DATA_DIR: path.join(temp, 'data'), DAGUAN_OPEN_BROWSER: '0' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(async () => {
    if (service.exitCode == null) {
      service.send({ type: 'shutdown' });
      await Promise.race([once(service, 'close'), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (service.exitCode == null) { service.kill(); await once(service, 'close'); }
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${number}`;
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy, 'isolated local service starts');
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  return { base, browser };
}

async function openQuestion(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.AppState?.categories && !!window.StateSync?.hydrated);
  await page.evaluate(async () => {
    AppState.currentCategory = AppState.categories.categories.find(node => UIRenderer.findNodeById(node, 331));
    await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory, 331));
    App.toggleAI();
  });
  await page.locator('#ai-input').waitFor();
}

async function expectDrawerBottom(page, selector, expectedSelector = '#app-main') {
  await page.waitForFunction(({ selector, expectedSelector }) => {
    const drawer = document.querySelector(selector).getBoundingClientRect();
    const expected = document.querySelector(expectedSelector).getBoundingClientRect();
    const bottom = expectedSelector === '.app-statusbar' ? expected.top : expected.bottom;
    return Math.abs(drawer.bottom - bottom) <= 1;
  }, { selector, expectedSelector });
}

test('精简 UI：隐藏状态栏后抽屉贴底，服务提示仍可见，触屏操作保留点击尺寸', { skip, timeout: 60000 }, async t => {
  const { base, browser } = await fixture(t);
  const context = await browser.newContext({ viewport: { width: 500, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await openQuestion(page, `${base}/index.html?ui=new`);
  assert.equal(await page.locator('.app-statusbar').isVisible(), false);
  await expectDrawerBottom(page, '#ai-panel');
  for (const selector of ['.question-actions .action-btn', '.question-footer .btn', '.question-mastery-choice', '#ai-send-btn', '#btn-toggle-nav']) {
    for (const button of await page.locator(selector).all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 44, `${selector} retains a 44px touch target`);
    }
  }
  await page.evaluate(() => {
    const status = document.getElementById('local-service-status');
    status.textContent = '本地服务暂时不可用';
    status.hidden = false;
  });
  assert.equal(await page.locator('.app-statusbar').isVisible(), true);
  await expectDrawerBottom(page, '#ai-panel', '.app-statusbar');
  await page.evaluate(() => { document.getElementById('local-service-status').hidden = true; });
  await page.evaluate(async () => { await App.changeQuestionMode('multi'); });
  await expectDrawerBottom(page, '#ai-panel');
  await page.evaluate(() => { App.toggleAI(); App.toggleAnnotation(); });
  await expectDrawerBottom(page, '#annotation-panel');
});

test('精简 UI：HTTPS 远程退出位于导航，发送按钮可点击，退出请求保持有效', { skip, timeout: 60000 }, async t => {
  const { base, browser } = await fixture(t);
  const context = await browser.newContext({ viewport: { width: 1920, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const origin = 'https://daguan-ui.invalid';
  let logoutRequests = 0;
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__remote/status') { await route.fulfill({ json: { ok: true } }); return; }
    if (url.pathname === '/__remote/logout') {
      assert.equal(route.request().method(), 'POST');
      logoutRequests++;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname === '/__remote/login') { await route.fulfill({ contentType: 'text/html', body: '<h1>已退出远程登录</h1>' }); return; }
    if (url.pathname === '/api/state/events') { await route.abort(); return; }
    const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await openQuestion(page, `${origin}/index.html?ui=new`);
  const logout = page.getByRole('button', { name: '退出远程登录', exact: true });
  await logout.waitFor({ state: 'attached' });
  assert.equal(await logout.evaluate(button => !!button.closest('#app-nav')), true);
  const send = page.locator('#ai-send-btn');
  for (const viewport of [{ width: 1920, height: 800 }, { width: 500, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => DaguanAIPanelLayout.update());
    const hit = await send.evaluate(button => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    assert.equal(hit, true, `send stays clickable at ${viewport.width}px`);
  }
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.evaluate(() => App.toggleAI());
  if (!await page.locator('#app-nav').isVisible()) await page.locator('#btn-toggle-nav').click();
  await logout.click();
  await page.waitForURL(`${origin}/__remote/login`);
  assert.equal(logoutRequests, 1);
});
