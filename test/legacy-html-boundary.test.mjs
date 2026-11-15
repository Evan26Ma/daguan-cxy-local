import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const tempRoot = process.env.DAGUAN_TEST_TMP || (process.platform === 'win32' ? 'F:/AI/tmp' : os.tmpdir());
if (process.platform === 'win32') {
  process.env.TEMP = process.env.TMP = tempRoot;
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(tempRoot, 'playwright-browsers');
}
const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'https://legacy-boundary.invalid';
const attack = '<img src=x onerror="window.boundaryAttack=1">';
const entries = ['legacy.html', 'index-old-backup.html'];
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';

function question(id = 'local-bank:合成-1') {
  return { id, type: 'single_choice', source: '合成题库', category_id: 101, category_path: '合成测试/小节', stem: '合成题干 $x^2$',
    options: [{ label: 'A', content_md: '合成选项' }, { label: 'B', content_md: '另一选项' }], correct_labels: ['A'], answer: 'A', explanation: '合成解析' };
}

async function fixture(t, entry, { questions = [question()], facets = [], missing = [], aiAnswer = '', diagramSvg = '<svg></svg>' } = {}) {
  await fs.mkdir(tempRoot, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(tempRoot, 'daguan-html-boundary-'));
  let context;
  t.after(async () => {
    try { await context?.close(); } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    headless: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 },
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  const page = context.pages()[0];
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('daguan_local_mode_v1', 'list');
    localStorage.setItem('daguan_legacy_welcome_seen_v1', '1');
  });
  const ids = questions.map(q => q.id);
  const data = {
    '/data/manifest.json': { total: questions.length, shards: { synthetic: { file: 'shards/synthetic.json' } } },
    '/data/categories.json': [{ id: 1, name: '合成测试', question_count: questions.length, children: [{ id: 101, name: '小节', question_count: questions.length, children: [] }] }],
    '/data/category_questions.json': { 1: ids, 101: ids },
    '/data/id_index.json': Object.fromEntries(ids.map(id => [id, 'synthetic'])),
    '/data/shards/synthetic.json': questions,
    '/data/search_index.json': questions,
    '/data/annotations.json': { annotations: Object.fromEntries(ids.map(id => [id, { chapter: '合成章节', src: '合成题源' }])), facets },
  };
  // Every data/API request is synthetic. No local service or real question data is read.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const pathname = url.pathname;
    if (pathname.startsWith('/data/')) return route.fulfill({ json: data[pathname] || { questions: {}, questionIds: [] } });
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/state/events') return route.abort();
      if (pathname === '/api/ai/profiles') return route.fulfill({ json: { profiles: [{ id: 'synthetic', name: '合成 AI', active: true, capabilities: { vision: 'unknown' } }] } });
      if (pathname === '/api/ai/chat') return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'delta', content: aiAnswer })}\n\n` });
      if (pathname === '/api/ai/diagram') return route.fulfill({ json: { svg: diagramSvg } });
      if (pathname.includes('/history')) return route.fulfill({ json: { history: { messages: [] } } });
      return route.fulfill({ json: { ok: true, revision: 1, progress: {}, favorites: [], picked: [], annotations: {}, entries: [], unlocked: true, previewMode: false } });
    }
    if (missing.some(name => pathname === `/${name}`)) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (pathname === '/index-old-backup.html') {
      const html = (await fs.readFile(path.join(root, 'legacy.html'), 'utf8'))
        .replace(/\.\/app-legacy\.js\?v=\d+/, './app2.js')
        .replace(/\.\/legacy\.css\?v=\d+/, './styles.css?v=89');
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root)) return route.abort();
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(filename)];
    if (!mime) return route.fulfill({ status: 404, body: '' });
    try { await route.fulfill({ contentType: mime, body: await fs.readFile(filename) }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto(`${origin}/${entry}?uiSwitch=1`, { waitUntil: 'networkidle' });
  await page.locator('#cat-tree [data-cat-id="101"]').waitFor({ state: 'attached' });
  return { page, errors };
}

async function openChapter(page) {
  await page.locator('#cat-tree [data-cat-id="101"]').evaluate(button => button.click());
  await page.locator('#view-browse').waitFor();
  await page.locator('#mode-list').click();
  await page.locator('#q-feed .q-card').first().waitFor();
}

async function sendMessage(page) {
  await page.locator('#q-feed .q-actions [data-shortcut-label="ai"]').click();
  await page.locator('#ai-prompt').fill('合成提问');
  await page.locator('#btn-ai-send').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ai-message-assistant')].some(el => el.textContent.includes('合成回答')));
}

for (const entry of entries) {
  test(`${entry}: malicious facet values stay literal and filtering remains selectable`, { timeout: 30000 }, async t => {
    const dim = `知识点${attack}`;
    const name = `\"'><svg onload=window.boundaryAttack=1>`;
    const label = `<b>标签</b>${attack}`;
    const count = `<i>7</i>${attack}`;
    const { page, errors } = await fixture(t, entry, { facets: [{ dim, options: [{ name, label, count, depth: 1 }] }] });
    await page.locator('#btn-adv-filter-top').click();
    const option = page.locator('#filter-options input[type=checkbox]').first();
    await option.waitFor();
    assert.equal(await option.getAttribute('data-dim'), dim);
    assert.equal(await option.getAttribute('data-name'), name);
    assert.equal(await page.locator('#filter-options label > span').first().textContent(), entry === 'legacy.html' ? label : name);
    assert.equal(await page.locator('#filter-options label > small').first().textContent(), count);
    assert.equal(await page.locator('#filter-options img, #filter-options svg, #filter-options b, #filter-options i').count(), 0);
    await option.check();
    await page.getByRole('button', { name: dim, exact: true }).click();
    assert.equal(await option.isChecked(), true);
    await option.uncheck();
    await page.getByRole('button', { name: dim, exact: true }).click();
    assert.equal(await option.isChecked(), false);
    assert.equal(await page.evaluate(() => window.boundaryAttack), undefined);
    assert.deepEqual(errors, []);
  });

  test(`${entry}: untrusted Markdown and native HTML preserve safe math, tables and image viewing`, { timeout: 30000 }, async t => {
    const q = question();
    q.stem = `${attack}<button data-app-action="unlock">bad action</button>\n\n$x^2$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![合成图](${image})\n\n\`\`\`text\n<script>literal code</script>\n\`\`\``;
    q.native_solution = { html: `<math><mi>x</mi><annotation encoding="application/x-tex">hidden-tex</annotation></math><table><tr><td>原生表格</td></tr></table><p>原生 $y^2$</p><img src="${image}" alt="合成原图" onerror="window.boundaryAttack=1">${attack}`, source: { document: '<b>合成资料</b>' } };
    const { page, errors } = await fixture(t, entry, { questions: [q] });
    await openChapter(page);
    const card = page.locator('#q-feed .q-card');
    assert.equal(await card.locator('.q-stem [onerror], .q-stem [data-app-action], .q-stem button, .q-stem script').count(), 0);
    assert.equal(await card.locator('.q-stem .katex').count(), 1);
    assert.equal(await card.locator('.q-stem table').count(), 1);
    assert.equal(await card.locator('.q-stem pre code').textContent(), '<script>literal code</script>\n');
    assert.equal(await card.locator('.q-stem img[src^="data:image/png;base64,"]').count(), 1);
    await card.locator('.q-actions [data-shortcut-label="answer"]').click();
    const native = card.locator('.native-solution');
    assert.equal(await native.locator('math mi').first().textContent(), 'x');
    assert.equal(await native.locator('table td').textContent(), '原生表格');
    assert.equal(await native.locator('.katex').count(), 1);
    assert.equal(await native.locator('[onerror], annotation, script, b').count(), 0);
    const picture = native.locator('img').first();
    await picture.focus();
    await page.keyboard.press('Enter');
    const zoom = page.locator('#question-image-zoom');
    assert.equal(await zoom.isVisible(), true);
    assert.equal(await zoom.locator('img').getAttribute('src'), image);
    await page.keyboard.press('Escape');
    assert.equal(await picture.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.boundaryAttack), undefined);
    assert.deepEqual(errors, []);
  });

  test(`${entry}: AI links and SVG reject executable protocols and keep safe diagram geometry`, { timeout: 30000 }, async t => {
    const aiAnswer = `合成回答 ${attack}<a href=" java&#x09;script:window.boundaryAttack=1">坏链接前导</a><a href="jav&#x0a;ascript:window.boundaryAttack=1">坏链接换行</a><a href="https://example.invalid/learn">正常链接</a>\n\n$x^2$\n\n\`\`\`daguan-diagram\n${JSON.stringify({ kind: 'line', title: `<b>合成图</b>${attack}` })}\n\`\`\``;
    const diagramSvg = `<svg viewBox="0 0 10 10" onload="window.boundaryAttack=1"><defs><path id="glyph" d="M0 0L10 10"/></defs><use href="#glyph"/><image href="https://outside.invalid/a"/><foreignObject>${attack}</foreignObject></svg>`;
    const { page, errors } = await fixture(t, entry, { aiAnswer, diagramSvg });
    await openChapter(page);
    await sendMessage(page);
    const answer = page.locator('.ai-message-assistant').last();
    await answer.locator('.ai-diagram-status path').waitFor({ state: 'attached' });
    for (const label of ['坏链接前导', '坏链接换行']) {
      const link = answer.locator('a').filter({ hasText: label });
      assert.equal(await link.getAttribute('href'), null);
      await link.click();
    }
    assert.equal(await answer.locator('a').filter({ hasText: '正常链接' }).getAttribute('href'), 'https://example.invalid/learn');
    assert.equal(await answer.locator('.katex').count(), 1);
    assert.equal(await answer.locator('[onerror], [onload], foreignObject, script, .ai-diagram figcaption b, .ai-diagram-status image[href]').count(), 0);
    assert.match(await answer.locator('.ai-diagram-status use').getAttribute('href'), /^#daguan-svg-/);
    assert.equal(await page.evaluate(() => window.boundaryAttack), undefined);
    assert.deepEqual(errors, []);
  });

  test(`${entry}: string question IDs remain literal through card rebuilds and selection`, { timeout: 30000 }, async t => {
    const id = `local-bank:合成/\"'><img src=x onerror=window.boundaryAttack=1>`;
    const q = { ...question(id), source: `<b>合成来源</b>${attack}`, type: `主观题${attack}` };
    const { page, errors } = await fixture(t, entry, { questions: [q] });
    await openChapter(page);
    const card = page.locator('#q-feed .q-card');
    const pick = card.locator('input[data-pick-id]');
    assert.equal(await card.getAttribute('data-id'), id);
    assert.equal(await pick.getAttribute('data-pick-id'), id);
    assert.equal(await card.locator('.q-card-head [data-error-toggle]').getAttribute('data-error-toggle'), id);
    assert.equal(await card.locator('.q-card-meta').textContent(), `${q.source} · ${q.type} · #${id}`);
    assert.equal(await card.locator('.q-card-head img, .q-card-head b, .q-card-head script').count(), 0);
    await card.locator('.q-actions [data-shortcut-label="answer"]').click();
    assert.equal(await card.locator('.answer-box').isVisible(), true);
    assert.equal(await pick.getAttribute('data-pick-id'), id);
    await pick.check();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('daguan_local_picked_v1'))), [id]);
    await card.locator('.q-actions [data-shortcut-label="answer"]').click();
    assert.equal(await pick.isChecked(), true);
    assert.equal(await card.locator('.q-card-head img, .q-card-head script').count(), 0);
    assert.equal(await page.evaluate(() => window.boundaryAttack), undefined);
    assert.deepEqual(errors, []);
  });
}

for (const missing of ['vendor/purify.min.js', 'safe-render.js']) {
  test(`app2 fails closed when ${missing} is unavailable`, { timeout: 30000 }, async t => {
    const q = { ...question(), stem: `合成题干 ${attack}`, native_solution: { html: `<math><mi>x</mi></math>${attack}` } };
    const aiAnswer = `合成回答 <a href=" javascript:window.boundaryAttack=1">坏链接</a>${attack}\n\n\`\`\`daguan-diagram\n{"kind":"line"}\n\`\`\``;
    const diagramSvg = '<svg onload="window.boundaryAttack=1"><path d="M0 0L1 1"/></svg>';
    const { page, errors } = await fixture(t, 'index-old-backup.html', { questions: [q], missing: [missing], aiAnswer, diagramSvg });
    await openChapter(page);
    const card = page.locator('#q-feed .q-card');
    assert.equal(await card.locator('.q-stem').textContent(), q.stem);
    assert.equal(await card.locator('.q-stem img, .q-stem math').count(), 0);
    await card.locator('.q-actions [data-shortcut-label="answer"]').click();
    assert.equal(await card.locator('.native-solution').textContent(), q.native_solution.html);
    assert.equal(await card.locator('.native-solution img, .native-solution math').count(), 0);
    await sendMessage(page);
    const answer = page.locator('.ai-message-assistant').last();
    await page.waitForFunction(() => document.querySelector('.ai-diagram-status')?.textContent.includes('<svg'));
    assert.equal(await answer.locator('.ai-message-body a, .ai-message-body img, .ai-diagram-status svg').count(), 0);
    assert.equal(await page.evaluate(() => window.boundaryAttack), undefined);
    assert.deepEqual(errors, []);
  });
}
