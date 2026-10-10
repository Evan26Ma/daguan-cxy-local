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

test('远端状态变化触发的自动重绘保留展开的答案与滚动位置，且不重复写学习位置', { skip: !playwright, timeout: 60000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-answer-refresh-'));
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const service = spawn(process.execPath, ['local-server/server.mjs'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: temp, DAGUAN_OPEN_BROWSER: '0' },
  });
  t.after(async () => {
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
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE });
  t.after(() => browser.close().catch(() => {}));
  const page = await browser.newPage({ viewport: { width: 1320, height: 860 }, serviceWorkers: 'block' });
  await page.goto(base + '/index.html?ui=new');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.AppState?.categories);
  await page.waitForFunction(() => window.StateSync?.hydrated && window.StateSync.available);

  const question = JSON.parse(await fs.readFile('web/data/shards/线性代数.json', 'utf8')).find(q => q.id === 435);
  assert.ok(question);
  await page.evaluate(async question => {
    document.documentElement.style.setProperty('--ui-font-scale', '1.5');
    AppState.questions = [question];
    AppState.currentQuestionIndex = 0;
    AppState.currentView = 'question';
    AppState.questionMode = 'single';
    AppState.answers = {};
    // 真实章节上下文：让“记录学习位置 / 阅读即计 seen”的写入路径处于激活状态
    AppState.currentCategory = { id: '626', name: '线代' };
    AppState.currentChapter = { id: '626', name: '章节' };
    AppState.temporaryQuestionView = false;
    AppState.suspendLastStudy = false;
    await UIRenderer.renderQuestion(0);
    document.activeElement?.blur();
  }, question);

  // 首次渲染的 seen / last-study 写入先落盘并逐笔确认
  await page.waitForFunction(() => StateSync.queue.size === 0 && !StateSync.syncing && !StateSync.lastStudyInFlight);
  await page.waitForFunction(async () => (await fetch('./api/state', { cache: 'no-store' }).then(r => r.json())).revision === StateSync.revision);

  // 只保留显式刷新通道：关闭 SSE 自动推送，让下面的远端写入必然经由 refreshFromEvent 重绘
  await page.evaluate(() => {
    try { StateSync.eventSource?.close(); } catch {}
    StateSync.eventSource = null;
    const render = UIRenderer.renderQuestion.bind(UIRenderer);
    window.__refreshRenderCount = 0;
    UIRenderer.renderQuestion = async (...args) => { const result = await render(...args); window.__refreshRenderCount += 1; return result; };
  });

  // 展开答案并滚到答案中段
  await page.locator('#show-answer-btn').click();
  assert.equal(await page.locator('.answer-section').isVisible(), true);
  const scrolled = await page.evaluate(() => {
    const content = document.getElementById('question-content');
    content.scrollTop = 240;
    return content.scrollTop;
  });
  assert.ok(scrolled > 0, '题目区应已滚动到答案中段');

  // 模拟另一窗口/设备的写入：revision 被推高
  const bumped = await page.evaluate(async () => {
    const state = await fetch('./api/state', { cache: 'no-store' }).then(r => r.json());
    const response = await fetch('./api/state/questions/436', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true, revision: state.revision }),
    });
    return { status: response.status, revision: (await response.json()).revision };
  });
  assert.equal(bumped.status, 200);

  // 收到远端变化后的自动刷新重绘
  await page.evaluate(() => StateSync.refreshFromEvent());
  assert.equal(await page.evaluate(() => window.__refreshRenderCount), 1, '自动刷新应重绘一次题目视图');

  // 症状优先：自动重绘后答案必须保持展开，滚动位置保留
  const after = await page.evaluate(() => ({
    visible: document.querySelector('.answer-section')?.style.display === 'block',
    button: document.getElementById('show-answer-btn')?.textContent || '',
    scroll: document.getElementById('question-content')?.scrollTop || 0,
  }));
  assert.equal(after.visible, true, '自动重绘后答案应保持展开，不能收起');
  assert.match(after.button, /隐藏答案/, '自动重绘后按钮应保持“隐藏答案”');
  assert.ok(Math.abs(after.scroll - scrolled) <= 8, `自动重绘后应恢复滚动位置（${scrolled} → ${after.scroll}）`);

  // 重绘路径不得重复写学习位置/已读：服务端 revision 不应再增长
  assert.equal(await page.evaluate(() => StateSync.revision), bumped.revision);
  await page.waitForTimeout(600);
  const finalRevision = await fetch(base + '/api/state', { cache: 'no-store' }).then(r => r.json()).then(s => s.revision);
  assert.equal(finalRevision, bumped.revision, '自动重绘不应再触发学习位置等状态写入');
  assert.equal(await page.evaluate(() => StateSync.queue.size), 0);
});
