import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { root } from './runtime-fixture.mjs';
import { listenHttp } from './http-fixture.mjs';

let playwright;
try {
  playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
} catch {}
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';

// 线性代数分片同时包含 #129（注入原生解析）与 #130（保留 Markdown 回退）。
const NATIVE_ID = 129;
const FALLBACK_ID = 130;
const ATTACK = '<script>window.pwned=1</script><img src=x onerror="window.pwned=1"><a href="java&#x73;cript:window.pwned=1">bad</a>';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// 静态托管 web/，并为 /api/* 返回最小 JSON，避免依赖尚在并行改动中的 local-server。
async function webFixture(t) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/access/status'
        ? { previewMode: false, unlocked: true }
        : url.pathname === '/api/state'
          ? { revision: 0, progress: {}, favorites: [], picked: [], annotations: {} }
          : {};
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
      return;
    }
    const rel = url.pathname === '/' ? 'legacy.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(root, 'web', rel);
    if (!file.startsWith(path.join(root, 'web') + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await listenHttp(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { base, page, errors };
}

// 注入前先按旧版浏览器夹具惯例暴露私有渲染函数（app-legacy.js 是 IIFE）。
async function installLegacyHooks(page) {
  const source = await fs.readFile(path.join(root, 'web/app-legacy.js'), 'utf8');
  const hooks = 'window.__nativeTest={state,setView,applyMode,renderSingle,renderFeed,loadQueueQuestions,printQuestionHtml,ensureIndexes}; ';
  const marker = 'window.DaguanDesktopSwitch = setUiVersion;';
  assert.ok(source.includes(marker), 'app-legacy.js 注入锚点缺失');
  await page.route('**/app-legacy.js*', route => route.fulfill({
    contentType: 'application/javascript; charset=utf-8',
    body: source.replace(marker, hooks + marker),
  }));
}

test('legacy 原生解析渲染、回退与打印清洗保持一致', { skip, timeout: 60000 }, async t => {
  const { base, page, errors } = await webFixture(t);
  await installLegacyHooks(page);

  const shardPath = path.join(root, 'web/data/shards/线性代数.json');
  const shard = JSON.parse(await fs.readFile(shardPath, 'utf8'));
  const native = shard.find(q => q.id === NATIVE_ID);
  const fallback = shard.find(q => q.id === FALLBACK_ID);
  assert.ok(native && fallback, '测试题目不在题库分片里');
  native.native_solution = {
    html: `<p>原生解析说明</p><math display="block"><mi>x</mi><mo>+</mo><mn>1</mn></math>${ATTACK}`,
    text: '原生解析说明',
    source: { document: '资料甲', label: '第 3 页' },
  };
  delete fallback.native_solution;
  fallback.explanation = `保留的 Markdown 解析 $A-2E$。${ATTACK}`;

  // 必须在页面加载前拦截分片，让 /legacy.html 走真实题库加载管线。
  await page.route('**/data/shards/**', route => route.fulfill({
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(shard),
  }));

  await page.goto(base + '/legacy.html?ui=old');
  await page.waitForFunction('window.__nativeTest && window.__nativeTest.state.manifest');

  const single = await page.evaluate(async ({ nativeId, fallbackId }) => {
    const h = window.__nativeTest;
    await h.ensureIndexes();
    const questions = await h.loadQueueQuestions([nativeId, fallbackId]);
    const byId = id => questions.find(q => String(q.id) === String(id));
    const read = id => {
      h.state.queue = [byId(id)];
      h.state.index = 0;
      h.state.showAnswer = true;
      h.state.selected = new Set();
      h.state.cardUI = new Map();
      h.setView('browse');
      h.applyMode('single');
      const host = document.getElementById('q-expl');
      return {
        native: !!host.querySelector('.native-solution'),
        math: !!host.querySelector('.native-solution math'),
        caption: host.querySelector('.native-solution-source')?.textContent || '',
        markdown: !!host.querySelector('.md'),
        html: host.innerHTML,
      };
    };
    return { withNative: read(nativeId), fallback: read(fallbackId) };
  }, { nativeId: NATIVE_ID, fallbackId: FALLBACK_ID });

  assert.ok(single.withNative.native, '单题原生解析未进入 native-solution 容器');
  assert.ok(single.withNative.math, '单题原生 MathML 未保留');
  assert.match(single.withNative.caption, /资料甲\/第 3 页/, '单题缺少来源说明');
  assert.doesNotMatch(single.withNative.html, /<script|onerror|javascript:/, '单题原生片段未清洗');
  assert.equal(single.fallback.native, false, '无原生解析的题目不应使用 native-solution');
  assert.match(single.fallback.html, /katex/i, '回退解析应渲染 Markdown 公式');
  assert.doesNotMatch(single.fallback.html, /<script|onerror|javascript:/, '回退解析未清洗');

  const multi = await page.evaluate(async ({ nativeId, fallbackId }) => {
    const h = window.__nativeTest;
    const questions = await h.loadQueueQuestions([nativeId, fallbackId]);
    const byId = id => questions.find(q => String(q.id) === String(id));
    h.state.queue = [byId(nativeId), byId(fallbackId)];
    h.state.index = 0;
    h.state.cardUI = new Map([[String(nativeId), { showAnswer: true, selected: new Set() }]]);
    h.setView('browse');
    h.applyMode('list');
    h.renderFeed(true);
    const card = document.querySelector(`.q-card[data-id="${nativeId}"]`);
    const expl = card?.querySelector('.answer-box .answer-block:nth-child(2)');
    const fbCard = document.querySelector(`.q-card[data-id="${fallbackId}"]`);
    return {
      native: !!expl?.querySelector('.native-solution'),
      math: !!expl?.querySelector('.native-solution math'),
      caption: expl?.querySelector('.native-solution-source')?.textContent || '',
      html: expl?.innerHTML || '',
      fallbackUsesNative: !!fbCard?.querySelector('.native-solution'),
    };
  }, { nativeId: NATIVE_ID, fallbackId: FALLBACK_ID });

  assert.ok(multi.native && multi.math, '多题卡片原生解析未渲染 MathML');
  assert.match(multi.caption, /资料甲\/第 3 页/, '多题卡片缺少来源说明');
  assert.doesNotMatch(multi.html, /<script|onerror|javascript:/, '多题卡片原生片段未清洗');
  assert.equal(multi.fallbackUsesNative, false, '无原生解析的卡片不应使用 native-solution');

  const printed = await page.evaluate(async ({ nativeId, fallbackId }) => {
    const h = window.__nativeTest;
    const questions = await h.loadQueueQuestions([nativeId, fallbackId]);
    const byId = id => questions.find(q => String(q.id) === String(id));
    const html = h.printQuestionHtml(byId(nativeId), 0, { withAnswers: true, withExpl: true });
    const fb = h.printQuestionHtml(byId(fallbackId), 0, { withAnswers: true, withExpl: true });
    const host = document.createElement('div');
    host.innerHTML = html;
    const fbHost = document.createElement('div');
    fbHost.innerHTML = fb;
    return {
      html,
      math: !!host.querySelector('.native-solution math'),
      caption: host.querySelector('.native-solution-source')?.textContent || '',
      fallbackMarkdown: !!fbHost.querySelector('.md'),
      fallbackNative: !!fbHost.querySelector('.native-solution'),
      fallbackFormula: /katex/i.test(fb),
    };
  }, { nativeId: NATIVE_ID, fallbackId: FALLBACK_ID });

  assert.ok(printed.math, '打印输出来源原生 MathML 未保留');
  assert.match(printed.caption, /资料甲\/第 3 页/, '打印输出缺少来源说明');
  assert.doesNotMatch(printed.html, /<script|onerror|javascript:/, '打印原生片段未清洗');
  assert.ok(printed.fallbackMarkdown && !printed.fallbackNative, '打印回退题目应保留 Markdown');
  assert.ok(printed.fallbackFormula, '打印回退题目应渲染 Markdown 公式');

  assert.equal(await page.evaluate(() => window.pwned), undefined, '注入脚本被执行');
  assert.deepEqual(errors, []);
});

test('legacy 真实章节导航后的原图支持离线点击、键盘放大与焦点返回', { skip, timeout: 60000 }, async t => {
  const { base, page, errors } = await webFixture(t);
  await installLegacyHooks(page); // Expose read-only state; do not inject a queue or question.
  await page.route('**/*', route => {
    const url = route.request().url();
    return !/^https?:/.test(url) || url.startsWith(base + '/') ? route.fallback() : route.abort();
  });
  await page.goto(base + '/legacy.html?ui=old&entry=chapters');
  await page.waitForFunction('window.__nativeTest && window.__nativeTest.state.manifest');
  const categories = JSON.parse(await fs.readFile(path.join(root, 'web/data/categories.json'), 'utf8'));
  const categoryQuestions = JSON.parse(await fs.readFile(path.join(root, 'web/data/category_questions.json'), 'utf8'));
  function findPath(nodes, trail = []) {
    for (const node of nodes) {
      const next = [...trail, String(node.id)];
      if (!node.children?.length && categoryQuestions[String(node.id)]?.some(id => Number(id) === 982)) return next;
      const found = findPath(node.children || [], next);
      if (found) return found;
    }
  }
  const chapterPath = findPath(categories);
  assert.ok(chapterPath, '真实样例必须位于可导航小节');
  for (const id of chapterPath) await page.locator(`.chapter-item[data-chapter-id="${id}"]`).click();
  await page.waitForFunction('window.__nativeTest.state.queue.some(q => Number(q.id) === 982)');
  await page.locator('#mode-single').click();
  const position = await page.evaluate(() => ({ current: window.__nativeTest.state.index, target: window.__nativeTest.state.queue.findIndex(q => Number(q.id) === 982) }));
  assert.ok(position.target >= 0);
  for (let n = 0; n < Math.abs(position.current - position.target); n++) await page.locator(position.current < position.target ? '#btn-next' : '#btn-prev').click();
  await page.locator('#btn-toggle-answer').click();
  await page.waitForSelector('#q-expl .native-solution img');
  const expected = await page.evaluate(() => {
    const h = window.__nativeTest, q = h.state.queue[h.state.index];
    return [...new DOMParser().parseFromString(q.native_solution.html, 'text/html').querySelectorAll('img')].map(i => i.src);
  });
  assert.ok(expected.length > 0, '真实题库样例缺少原 PDF 配图');
  await page.context().setOffline(true);
  const images = page.locator('#q-expl .native-solution img');
  assert.equal(await images.count(), expected.length);
  for (let index = 0; index < expected.length; index++) {
    const image = images.nth(index);
    assert.equal(await image.getAttribute('role'), 'button');
    assert.equal(await image.getAttribute('tabindex'), '0');
    await image.click();
    const zoom = await page.evaluate(async () => {
      const dialog = document.getElementById('question-image-zoom'), image = dialog.querySelector('img');
      await image.decode();
      return { open: dialog.open, src: image.src, width: image.naturalWidth, renderedWidth: image.getBoundingClientRect().width };
    });
    assert.equal(zoom.open, true);
    assert.equal(zoom.src, expected[index]);
    assert.ok(zoom.width > 0);
    assert.equal(zoom.renderedWidth, zoom.width, '缩放窗口必须展示未经缩小的原图');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate('window.__nativeTest.state.queue[window.__nativeTest.state.index].id'), 982, '弹窗内不能触发后台切题');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#question-image-zoom:not([open])', { state: 'attached' });
    assert.equal(await image.evaluate(i => document.activeElement === i), true);
  }
  for (const key of ['Enter', 'Space']) {
    await images.first().focus();
    await page.keyboard.press(key);
    await page.waitForSelector('#question-image-zoom[open]');
    await page.locator('#question-image-zoom button').click();
    await page.waitForSelector('#question-image-zoom:not([open])', { state: 'attached' });
    assert.equal(await images.first().evaluate(i => document.activeElement === i), true);
    assert.equal(await page.locator('#q-expl').isVisible(), true);
  }
  await page.context().setOffline(false);
  assert.deepEqual(errors, []);
});
