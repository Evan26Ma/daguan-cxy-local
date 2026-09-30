import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';

let playwright;
try { playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright'); } catch {}

test('空格展开答案只滚动题目区，底部操作栏不跳出空白', { skip: !playwright, timeout: 30000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-answer-scroll-'));
  let desktop;
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const service = spawn(process.execPath, ['local-server/server.mjs'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: temp, DAGUAN_OPEN_BROWSER: '0' },
  });
  t.after(async () => {
    if (desktop) await desktop.close();
    if (service.exitCode == null) {
      service.send({ type: 'shutdown' });
      await Promise.race([once(service, 'close'), new Promise(r => setTimeout(r, 3000))]);
      if (service.exitCode == null) service.kill();
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  let page;
  if (process.env.DAGUAN_SCROLL_ELECTRON === '1') {
    const env = { ...process.env, DAGUAN_DATA_DIR: path.join(temp, 'desktop-data'), DAGUAN_USER_DATA_DIR: path.join(temp, 'desktop-profile'), DAGUAN_UPDATE_FEED_URL: 'http://127.0.0.1:1/disabled' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await playwright._electron.launch({ executablePath: path.resolve('out/大观园数学-win32-x64/DaguanMath.exe'), env });
    await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    page = await desktop.firstWindow();
  } else {
    const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE });
    t.after(() => browser.close());
    page = await browser.newPage({ viewport: { width: 1320, height: 860 }, serviceWorkers: 'block' });
    await page.goto(base + '/index.html?ui=new');
  }
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.AppState?.categories);
  const question = JSON.parse(await fs.readFile('web/data/shards/线性代数.json', 'utf8')).find(q => q.id === 435);
  assert.ok(question);
  await page.evaluate(async question => {
    document.documentElement.style.setProperty('--ui-font-scale', '1.5');
    AppState.questions = [question];
    AppState.currentQuestionIndex = 0; AppState.currentView = 'question'; AppState.questionMode = 'single';
    AppState.answers = {}; AppState.currentCategory = null; AppState.currentChapter = null;
    await UIRenderer.renderQuestion(0);
    document.activeElement?.blur();
  }, question);
  const geometry = () => page.evaluate(() => ({
    window: scrollY,
    scrolls: [...document.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => ({ selector: e.id || e.className, top: e.scrollTop })),
    footer: document.querySelector('#show-answer-btn').getBoundingClientRect().toJSON(),
  }));
  const before = await geometry();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const after = await geometry();
  assert.equal(await page.locator('.answer-section').isVisible(), true);
  assert.equal(after.window, before.window, '空格不应滚动整个页面');
  assert.deepEqual(after.scrolls.filter(s => s.selector !== 'question-content'), before.scrolls.filter(s => s.selector !== 'question-content'), '展示答案只应滚动题目区，不能拉动外层布局');
  assert.equal(after.footer.y, before.footer.y, '底部操作栏应保持原位');
  await page.locator('#show-answer-btn').click();
  const focusedBefore = await geometry();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const focusedAfter = await geometry();
  assert.equal(await page.locator('.answer-section').isVisible(), true, '按钮聚焦后空格只展开一次答案');
  assert.equal(focusedAfter.window, focusedBefore.window, '操作栏按钮聚焦后空格不能滚动页面');
  assert.equal(focusedAfter.footer.y, focusedBefore.footer.y, '聚焦按钮展开答案不能产生底部空白');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.answer-section').isVisible(), false);
  assert.equal((await geometry()).footer.y, before.footer.y, '快速显隐答案不产生过期的外层滚动');
});
