import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { root, serviceFixture } from './runtime-fixture.mjs';

const attack = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script><a href="java&#x73;cript:window.pwned=1">bad</a><div id="app-main" class="option-item" data-app-action="unlock" onclick="window.pwned=1">action</div><svg onload="window.pwned=1"><foreignObject><img src=x onerror="window.pwned=1"></foreignObject><image href="https://evil.invalid/track"></image></svg><form><button>submit</button></form>';
async function browserFixture(t) {
  const service = await serviceFixture(t);
  const browser = await chromium.launch({ headless: true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state/events', route => route.abort());
  return { ...service, page, errors };
}

test('renderer strips executable markup/actions and preserves math, tables, images and SVG geometry', { timeout: 30000 }, async t => {
  const { base, page } = await browserFixture(t);
  await page.route('**/render-fixture', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto(base + '/render-fixture');
  for (const name of ['vendor/purify.min.js', 'vendor/marked.min.js', 'vendor/katex.min.js', 'safe-render.js']) await page.addScriptTag({ path: path.join(root, 'web', name) });
  const result = await page.evaluate(attack => {
    const renderer = DaguanSafeRender.create();
    const main = document.querySelector('main');
    main.innerHTML = renderer.markdown(attack + '\n\n$$\\frac{x}{2}$$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![图](/assets/missing-image.svg)\n\n```js\nconst n = 1;\n```');
    const svg = renderer.svg('<svg viewBox="0 0 10 10"><defs><path id="glyph" d="M0 0L10 10"/></defs><use href="#glyph" style="fill: none; stroke: #123456; stroke-width: 2"/><image href="https://evil.invalid/a"/><foreignObject><div>bad</div></foreignObject></svg>');
    const out = { html: main.innerHTML, math: !!main.querySelector('.katex math'), table: !!main.querySelector('table'), code: !!main.querySelector('pre code'), image: !!main.querySelector('img[src="/assets/missing-image.svg"]'), svg };
    window.DOMPurify = undefined;
    out.fallback = DaguanSafeRender.create().markdown(attack);
    return out;
  }, attack);
  assert.doesNotMatch(result.html, /onerror|onclick|onload|javascript:|data-app-action|id="app-main"|<script|<form|<button|foreignObject|evil\.invalid/);
  assert.ok(result.math && result.table && result.code && result.image, JSON.stringify(result));
  assert.match(result.svg, /<path/);
  assert.doesNotMatch(result.svg, /foreignObject|https:|style=/);
  assert.match(result.svg, /<use[^>]+href="#daguan-svg-/);
  assert.match(result.svg, /stroke="#123456"/);
  assert.doesNotMatch(result.fallback, /<img|<script|<svg/);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
});

for (const ui of ['new', 'old']) test(`${ui}: real question and AI rendering reject stored HTML attacks`, { timeout: 30000 }, async t => {
  const { base, page, errors } = await browserFixture(t);
  if (ui === 'old') {
    const source = await fs.readFile(path.join(root, 'web/app-legacy.js'), 'utf8');
    await page.route('**/app-legacy.js*', route => route.fulfill({ contentType: 'application/javascript', body: source.replace('window.DaguanDesktopSwitch = setUiVersion;', 'window.__security = {renderMarkdown, renderAiMessage}; window.DaguanDesktopSwitch = setUiVersion;') }));
  }
  await page.goto(base + (ui === 'new' ? '/index.html?ui=new' : '/legacy.html?ui=old'));
  await page.waitForFunction(ui === 'new' ? 'window.App && AppState.categories' : 'window.__security');
  const html = await page.evaluate(async ({ ui, attack }) => {
    if (ui === 'old') {
      const host = document.createElement('div'); document.body.append(host);
      host.innerHTML = __security.renderMarkdown(attack);
      host.append(__security.renderAiMessage(attack, 'assistant'));
      return host.innerHTML;
    }
    const q = { id: 1, stem: attack, answer: '$x^2$', explanation: attack, options: [] };
    AppState.questions = [q]; AppState.currentQuestionIndex = 0;
    AppState.currentView = 'question'; AppState.currentCategory = null; AppState.currentChapter = null;
    AppState.ui.aiPanelOpen = true; AppState.questionMode = 'single';
    AppState.aiProfiles = [{ id: 'test', name: 'test', active: true }]; AppState.aiProfileId = 'test';
    await UIRenderer.renderQuestion(0);
    StorageService.saveAnnotation(1, attack);
    UIRenderer.renderAnnotationPanel();
    App.updateAnnotationPreview();
    const note = document.getElementById('annotation-preview').innerHTML;
    AIService.loadHistory = async () => [{ role: 'assistant', content: attack }];
    await UIRenderer.renderAIHistory(q);
    const history = document.getElementById('ai-messages').innerHTML;
    AIService.chatStream = async () => new Response('data: ' + JSON.stringify({ type: 'delta', content: attack }) + '\n\n');
    document.getElementById('ai-input').value = 'test';
    await App.sendAIMessage();
    const final = document.getElementById('ai-messages').innerHTML;
    // A partial answer followed by an abort must use the same safe renderer.
    AIService.chatStream = async () => {
      let sent = false;
      return new Response(new ReadableStream({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'delta', content: attack }) + '\n\n')); }
        else controller.error(new DOMException('Aborted', 'AbortError'));
      } }));
    };
    document.getElementById('ai-input').value = 'again'; await App.sendAIMessage();
    return note + history + final + document.getElementById('ai-messages').innerHTML;
  }, { ui, attack });
  assert.doesNotMatch(html, /onerror|onload|javascript:|data-app-action="unlock"|id="app-main"|<script|foreignObject|evil\.invalid/);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.deepEqual(errors, []);
});

test('offline shell installs extracted modules and replaces stale shell cache', { timeout: 30000 }, async t => {
  const { base } = await serviceFixture(t);
  const browser = await chromium.launch({ headless: true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/api/health');
  await page.evaluate(() => caches.open('daguan-shell-v144'));
  await page.goto(base + '/index.html?ui=new');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => !(await caches.keys()).includes('daguan-shell-v144'));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.App && window.DaguanNewAI && window.DaguanNewData && window.DaguanNewState && window.DOMPurify);
  assert.deepEqual(errors, []);
});
