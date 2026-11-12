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
const playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.DAGUAN_INPUT_BROWSER || 'chromium';
const tempRoot = process.env.DAGUAN_TEST_TMP || (process.platform === 'win32' ? 'F:/AI/tmp' : os.tmpdir());
process.env.TEMP = process.env.TMP = tempRoot;
if (process.platform === 'win32') process.env.PLAYWRIGHT_BROWSERS_PATH ||= 'F:/AI/tmp/playwright-browsers';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(tempRoot, 'daguan-ai-input-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const service = spawn(process.execPath, [path.join(ROOT, 'local-server/server.mjs')], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: path.join(temp, 'data'), DAGUAN_OPEN_BROWSER: '0' },
  });
  t.after(async () => {
    if (service.exitCode == null) {
      service.send({ type: 'shutdown' });
      await Promise.race([once(service, 'close'), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (service.exitCode == null) { service.kill(); await once(service, 'close'); }
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy, 'isolated AI input service starts');
  const browser = await playwright[engine].launch({ headless: true,
    ...(engine === 'chromium' && process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  return async (subtest, viewport = { width: 1280, height: 900 }) => {
    const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
    subtest.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    subtest.after(() => assert.deepEqual(errors, [], 'no browser script errors'));
    await page.route('**/api/state/events', route => route.abort());
    await page.goto(`${base}/index.html?ui=new`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.AppState?.categories);
    await page.evaluate(async () => {
      AIService.loadHistory = async () => [];
      AppState.aiProfiles = [{ id: 'input-fixture', name: '输入测试', streaming: true }];
      AppState.aiProfileId = 'input-fixture';
      AppState.currentCategory = AppState.categories.categories.find(node => UIRenderer.findNodeById(node, 331));
      await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory, 331));
      if (!AppState.ui.aiPanelOpen) App.toggleAI();
    });
    await frames(page);
    return page;
  };
}

const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const size = page => page.locator('#ai-input').evaluate(input => {
  const style = getComputedStyle(input);
  return { height: input.getBoundingClientRect().height, line: parseFloat(style.lineHeight),
    extras: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
    scroll: input.scrollHeight, client: input.clientHeight, width: input.getBoundingClientRect().width };
});

// Count real browser layout accesses, including temporary height=auto writes that would
// be invisible if only the final inline style were inspected.
async function instrument(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('ai-panel'), input = document.getElementById('ai-input');
    const stats = window.inputStats = { sync: false, reads: [], deferredReads: [], mirrorReads: 0, writes: 0 };
    const style = window.getComputedStyle;
    window.getComputedStyle = function(element, ...rest) {
      if (panel.contains(element)) (stats.sync ? stats.reads : stats.deferredReads).push('getComputedStyle');
      return style.call(this, element, ...rest);
    };
    for (const [prototype, properties] of [[HTMLElement.prototype, ['offsetHeight', 'offsetWidth']],
      [Element.prototype, ['clientHeight', 'clientWidth', 'scrollHeight', 'scrollWidth']]]) {
      for (const name of properties) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        Object.defineProperty(prototype, name, { ...descriptor, get() {
          if (this === panel || panel.contains(this)) (stats.sync ? stats.reads : stats.deferredReads).push(`${this.id || this.className}.${name}`);
          if (name === 'scrollHeight' && this instanceof HTMLTextAreaElement && this !== input) stats.mirrorReads++;
          return descriptor.get.call(this);
        } });
      }
    }
    const bounds = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function(...args) {
      if (this === panel || panel.contains(this)) (stats.sync ? stats.reads : stats.deferredReads).push('getBoundingClientRect');
      return bounds.apply(this, args);
    };
    stats.mutations = new MutationObserver(records => { stats.writes += records.length; });
    stats.mutations.observe(input, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  });
}

function burstInPage(values) {
  const input = document.getElementById('ai-input'), stats = window.inputStats;
  stats.reads = []; stats.deferredReads = []; stats.mirrorReads = 0; stats.writes = 0; stats.mutations.takeRecords();
  const before = input.style.height;
  stats.sync = true;
  for (const value of values) {
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value.at(-1) }));
  }
  stats.sync = false;
  return { reads: stats.reads, writes: stats.mutations.takeRecords().length, before, after: input.style.height };
}

// DAGUAN_INPUT_BROWSER=webkit runs the same contracts against Safari's engine.
test(`AI input browser contracts (${engine})`, { timeout: 120000 }, async t => {
  const open = await fixture(t);

  await t.test('IME Enter never sends; normal Enter sends and Shift+Enter inserts a newline', async t => {
    const page = await open(t);
    const events = await page.evaluate(() => {
      const input = document.getElementById('ai-input');
      let sent = 0;
      App.sendAIMessage = () => { sent++; };
      const enter = options => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
        input.dispatchEvent(event);
        return { sent, prevented: event.defaultPrevented };
      };
      const result = [enter({ isComposing: true }), enter({ keyCode: 229 })];
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      result.push(enter({ isComposing: false, keyCode: 13 }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
      result.push(enter({ isComposing: true }), enter({ keyCode: 229 }), enter({}));
      window.sentCount = () => sent;
      return result;
    });
    assert.deepEqual(events.slice(0, 5).map(event => event.sent), [0, 0, 0, 0, 0]);
    assert.ok(events.slice(0, 5).every(event => !event.prevented), 'IME retains native candidate selection');
    assert.deepEqual(events[5], { sent: 1, prevented: true });
    await page.locator('#ai-input').fill('第一行');
    await page.locator('#ai-input').press('End');
    await page.locator('#ai-input').press('Shift+Enter');
    assert.equal(await page.locator('#ai-input').inputValue(), '第一行\n');
    assert.equal(await page.evaluate(() => sentCount()), 1);
  });

  await t.test('ordinary input does no synchronous sizing and a burst measures only once', async t => {
    const page = await open(t);
    await instrument(page);
    const values = Array.from({ length: 12 }, (_, index) => '中文长草稿需要自动换行。'.repeat(index + 1));
    const sync = await page.evaluate(burstInPage, values);
    assert.deepEqual(sync.reads, [], 'input handler must not read panel geometry or computed style');
    assert.equal(sync.writes, 0, 'input handler must not reset or write visible textarea height');
    assert.equal(sync.after, sync.before);
    await frames(page);
    const deferred = await page.evaluate(() => ({ reads: inputStats.mirrorReads, panelReads: inputStats.deferredReads,
      writes: inputStats.writes + inputStats.mutations.takeRecords().length }));
    assert.equal(deferred.reads, 1, 'one isolated measurement for the entire input burst');
    assert.deepEqual(deferred.panelReads, [], 'deferred input measurement also avoids panel geometry');
    assert.equal(deferred.writes, 1, 'the burst grows the visible input once');
    assert.equal(await page.locator('#ai-input').inputValue(), values.at(-1));
    const sameRow = await page.evaluate(burstInPage, [values.at(-1) + '再']);
    assert.equal(sameRow.writes, 0);
    await frames(page);
    assert.equal(await page.evaluate(() => inputStats.writes + inputStats.mutations.takeRecords().length), 0, 'same row count does not rewrite height');
  });

  await t.test('one to five rows, deletion shrink, widths and font scale use an isolated measurer', async t => {
    const page = await open(t);
    const input = page.locator('#ai-input');
    await input.fill('短'); await frames(page);
    const one = await size(page);
    assert.ok(Math.abs(one.height - one.line - one.extras) <= 2, JSON.stringify(one));
    await input.fill('第一行\n第二行\n第三行'); await frames(page);
    const three = await size(page);
    assert.ok(Math.abs(three.height - three.line * 3 - three.extras) <= 2, JSON.stringify(three));
    await input.fill('一行\n'.repeat(15)); await frames(page);
    const five = await size(page);
    assert.ok(Math.abs(five.height - five.line * 5 - five.extras) <= 2, JSON.stringify(five));
    assert.ok(five.scroll > five.client);
    await input.fill('删回一行'); await frames(page);
    assert.ok(Math.abs((await size(page)).height - one.height) <= 1);
    // Wrapping must follow the live width and type metrics, even without another input.
    const draft = '讨论一下这一步为什么可以使用这个公式。'.repeat(4);
    await input.fill(draft); await frames(page);
    await page.locator('.ai-panel-resize').focus();
    await page.locator('.ai-panel-resize').press('End'); await frames(page);
    const wide = await size(page);
    await page.locator('.ai-panel-resize').press('Home'); await frames(page);
    const narrow = await size(page);
    assert.ok(narrow.height > wide.height, JSON.stringify({ wide, narrow }));
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.5'));
    await frames(page);
    const large = await size(page);
    assert.ok(Math.abs(large.height - large.line * 5 - large.extras) <= 2, JSON.stringify(large));
    assert.equal(await input.inputValue(), draft);
    await page.setViewportSize({ width: 500, height: 800 }); await frames(page);
    assert.ok((await size(page)).width < 500);
    await page.setViewportSize({ width: 1024, height: 768 }); await frames(page);
    assert.equal(await input.inputValue(), draft);
    const mirror = await page.evaluate(() => {
      const input = document.getElementById('ai-input');
      const mirror = [...document.querySelectorAll('textarea')].find(element => element !== input && !element.closest('#ai-panel'));
      if (!mirror) return null;
      return { hidden: getComputedStyle(mirror).visibility === 'hidden', isolated: [mirror, mirror.parentElement].some(element => getComputedStyle(element).contain.includes('strict')),
        font: getComputedStyle(mirror).fontSize, inputFont: getComputedStyle(input).fontSize };
    });
    assert.ok(mirror?.hidden && mirror?.isolated, 'measurer lives outside the panel in a hidden containment boundary');
    assert.equal(mirror.font, mirror.inputFont);
  });

  await t.test('composition defers all fitting until compositionend and merges its final input', async t => {
    const page = await open(t);
    await instrument(page);
    await page.evaluate(() => document.getElementById('ai-input').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    const sync = await page.evaluate(burstInPage, ['中文拼音输入。'.repeat(40)]);
    await frames(page);
    assert.deepEqual(sync.reads, []);
    assert.equal(sync.writes, 0);
    assert.equal(await page.evaluate(() => inputStats.mirrorReads), 0, 'no fitting during composition');
    assert.equal(await page.locator('#ai-input').evaluate(input => input.style.height), sync.before);
    await page.evaluate(() => {
      const input = document.getElementById('ai-input');
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文' }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '文' }));
    });
    await frames(page);
    assert.equal(await page.evaluate(() => inputStats.mirrorReads), 1, 'compositionend and final input share one fit');
    const five = await size(page);
    assert.ok(Math.abs(five.height - five.line * 5 - five.extras) <= 2);
  });

  await t.test('question changes retain the latest unmeasured draft; send and rebind shrink safely', async t => {
    const page = await open(t);
    const draft = '切题前的草稿。'.repeat(40);
    const ids = await page.evaluate(draft => {
      const first = AppState.questions[AppState.currentQuestionIndex].id;
      const input = document.getElementById('ai-input');
      input.value = draft;
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      AppState.currentQuestionIndex++;
      const second = AppState.questions[AppState.currentQuestionIndex].id;
      UIRenderer.renderAIPanel();
      return { first, second, saved: StorageService.getAIDraft(first) };
    }, draft);
    assert.equal(ids.saved, draft);
    assert.equal(await page.locator('#ai-input').inputValue(), '');
    await page.locator('#ai-input').fill('第二题草稿');
    await page.evaluate(() => { AppState.currentQuestionIndex--; UIRenderer.renderAIPanel(); });
    await frames(page);
    assert.equal(await page.locator('#ai-input').inputValue(), draft);
    await page.evaluate(async () => {
      AIService.chatStream = async () => new Response('data: {"type":"delta","content":"完成"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      await App.sendAIMessage();
    });
    await frames(page);
    assert.equal(await page.locator('#ai-input').inputValue(), '');
    const one = await size(page);
    assert.ok(Math.abs(one.height - one.line - one.extras) <= 2);
    await page.evaluate(() => { AppState.currentQuestionIndex++; UIRenderer.renderAIPanel(); });
    await frames(page);
    assert.equal(await page.locator('#ai-input').inputValue(), '第二题草稿');
    assert.equal(await page.locator('textarea').count(), 2, 'rebind does not leak hidden measurers');
    await page.evaluate(() => App.toggleAI()); await frames(page);
    await page.evaluate(() => App.toggleAI()); await frames(page);
    assert.equal(await page.locator('#ai-input').inputValue(), '第二题草稿');
    await page.evaluate(() => App.showHome()); await frames(page);
    assert.equal(await page.locator('textarea').count(), 0, 'disconnected panel releases its measurer');
  });

  await t.test('long math chat input performance comparison (diagnostic, no hardware time threshold)', async t => {
    const page = await open(t);
    const result = await page.evaluate(async () => {
      const input = document.getElementById('ai-input'), messages = document.getElementById('ai-messages');
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let mirrorTimes = [], fitFrameTimes = [];
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => requestFrame(time => {
        const count = mirrorTimes.length, start = performance.now();
        callback(time);
        if (mirrorTimes.length > count) fitFrameTimes.push(performance.now() - start);
      });
      const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
      Object.defineProperty(Element.prototype, 'scrollHeight', { ...scrollHeight, get() {
        const start = performance.now(), height = scrollHeight.get.call(this);
        if (this instanceof HTMLTextAreaElement && this !== input) mirrorTimes.push(performance.now() - start);
        return height;
      } });
      const math = renderMarkdown('讨论极限与积分。\n\n$$\\int_0^1 \\frac{x^n}{1+x^2}\\,dx = \\sum_{k=0}^{\\infty}\\frac{(-1)^k}{n+2k+1}$$\n\n');
      const measure = async count => {
        messages.innerHTML = `<div class="ai-message assistant"><div class="ai-message-bubble">${math.repeat(count)}</div></div>`;
        input.value = '短草稿'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); await settle();
        const times = []; mirrorTimes = []; fitFrameTimes = [];
        // Alternating short drafts leaves row count unchanged, the reported iPad hot path.
        for (let i = 0; i < 140; i++) {
          input.value = `短草稿继续输入中文${i % 10}`;
          const start = performance.now();
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '文' }));
          times.push(performance.now() - start);
        }
        await settle();
        const framed = [];
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          input.value = `逐帧短草稿${i % 10}`;
          const start = performance.now(); input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '文' }));
          framed.push(performance.now() - start);
        }
        await settle();
        const summary = values => ({ mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
          p95: [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)] ?? 0 });
        return { nodes: messages.querySelectorAll('*').length, math: messages.querySelectorAll('.katex').length,
          burst: summary(times), framed: summary(framed), mirror: { count: mirrorTimes.length, ...summary(mirrorTimes) },
          fitFrame: { count: fitFrameTimes.length, ...summary(fitFrameTimes) } };
      };
      return { short: await measure(1), long: await measure(120) };
    });
    assert.equal(result.long.math, 120, 'benchmark uses actual rendered KaTeX');
    t.diagnostic(`${engine} ms/input ${JSON.stringify(result)}`);
  });
});
