import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { newUiModules } from './new-ui-loader.mjs';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const tempRoot = process.env.DAGUAN_TEST_TMP || (process.platform === 'win32' ? 'F:/AI/tmp' : os.tmpdir());
process.env.TEMP = process.env.TMP = tempRoot;
if (process.platform === 'win32') process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(tempRoot, 'playwright-browsers');
const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'https://new-question-boundary.invalid';
const attack = '<img src=x data-boundary-injected onerror="window.questionBoundaryAttack=1"><svg data-boundary-injected onload="window.questionBoundaryAttack=1"></svg>';
const ids = [
  "local-bank:合成-1');window.questionBoundaryAttack=1;//",
  `local-bank:合成/\"'><img src=x data-boundary-injected onerror=window.questionBoundaryAttack=1>&quot;&#39;\\尾`,
  'local-bank:正常题号-2',
  734,
];

function question(id) {
  return { id, type: 'single_choice', stem: '合成题干', source: '合成来源', year: 2026,
    options: [{ label: 'A', content_md: '错误选项' }, { label: 'B', content_md: '正确选项' }],
    correct_labels: ['B'], answer: 'B', explanation: '合成解析' };
}

async function fixture(t) {
  await fs.mkdir(tempRoot, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(tempRoot, 'daguan-new-question-boundary-'));
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
  // Only renderer dependencies are loaded, after DOMContentLoaded. No app startup,
  // local service, real question bank or user storage participates in this fixture.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main id="app-main"></main></body></html>' });
    if (url.pathname === '/data/explanations-v2.json') return route.fulfill({ json: { questions: {} } });
    return route.abort();
  });
  await page.goto(`${origin}/fixture.html`);
  for (const name of ['ui-version.js', 'vendor/purify.min.js', 'vendor/marked.min.js', 'choice-grading.js', ...newUiModules, 'app-new.js']) {
    await page.addScriptTag({ path: path.join(webRoot, name) });
  }
  await page.evaluate(() => {
    window.boundaryWrites = [];
    StateSync.available = true;
    StateSync.queueQuestion = (id, patch) => boundaryWrites.push({ id: String(id), patch });
    // Navigation is checked at its argument boundary; drawers are outside this test's scope.
    App.showLibrary = id => { window.boundaryCategoryId = id; };
    App.ensureSavedBeforeLeavingQuestion = async () => true;
    UIRenderer.renderAnnotationPanel = () => {};
    UIRenderer.renderAIPanel = () => {};
  });
  return { page, errors };
}

async function render(page, mode, questions, extra = {}) {
  await page.evaluate(async ({ mode, questions, extra }) => {
    const chapter = { id: 'synthetic-chapter', name: '合成章节', questions, ...extra.chapter };
    const category = { id: 'synthetic-category', name: '合成科目', children: [chapter], ...extra.category };
    Object.assign(AppState, { questions, currentQuestionIndex: 0, currentCategory: category, currentChapter: chapter,
      chapterQuestionCount: questions.length, questionMode: mode, questionOffset: 0, currentView: 'question',
      questionRailQuery: extra.railQuery || '', questionRailFilter: '', suspendLastStudy: true, answers: {} });
    AppState.ui.aiPanelOpen = AppState.ui.annotationPanelOpen = false;
    await UIRenderer.renderQuestion(0, { refresh: true });
  }, { mode, questions, extra });
}

async function assertBoundary(page, errors) {
  const boundary = await page.locator('#app-main').evaluate(root => ({
    injected: root.querySelectorAll('script, iframe, object, embed, [data-boundary-injected], [onerror], [onload], [onfocus]').length,
    handlers: [...root.querySelectorAll('*')].flatMap(node => [...node.attributes])
      .filter(attr => /^on/i.test(attr.name) && attr.value.includes('questionBoundaryAttack')).map(attr => attr.value),
    executed: window.questionBoundaryAttack ?? null,
  }));
  assert.deepEqual(boundary, { injected: 0, handlers: [], executed: null });
  assert.deepEqual(errors, []);
}

for (const mode of ['single', 'multi']) {
  test(`${mode}: question metadata and quoted attributes remain literal HTML`, { timeout: 30000 }, async t => {
    const { page, errors } = await fixture(t);
    const q = { ...question(ids[1]), source: `来源${attack}`, year: `年份${attack}`,
      image: 'missing.png" onerror="window.questionBoundaryAttack=1' };
    const category = { id: ids[0], name: `科目${attack}` };
    const chapter = { name: `章节${attack}`, title: `备用标题${attack}` };
    const railQuery = `\" onfocus=\"window.questionBoundaryAttack=1`;
    await render(page, mode, [q], { category, chapter, railQuery });
    const root = page.locator(mode === 'single' ? '.question-wrapper' : '.multi-question-card');
    assert.equal(await root.getAttribute('data-question-id'), String(q.id));
    const crumbs = page.locator('.breadcrumb-nav');
    assert.equal((await crumbs.locator('a').nth(1).textContent()).trim(), category.name);
    assert.equal(await crumbs.locator(':scope > span').last().textContent(), chapter.name);
    const source = root.locator(mode === 'single' ? '.question-source' : '.multi-question-source');
    assert.equal((await source.textContent()).trim(), `${q.source}${mode === 'single' ? ' ' : ' · '}${q.year}年`);
    assert.equal(await root.locator('.question-image img').getAttribute('src'), q.image);
    assert.equal(await root.locator('[data-explanation-v2]').getAttribute('data-explanation-v2'), String(q.id));
    if (mode === 'multi') {
      assert.equal(await page.locator('.question-rail-tools input').first().inputValue(), railQuery);
      assert.equal(await page.locator('.question-rail-item').first().getAttribute('data-question-id'), String(q.id));
    }
    await assertBoundary(page, errors);
    await crumbs.locator('a').nth(1).click();
    assert.equal(await page.evaluate(() => window.boundaryCategoryId), category.id);
    await page.evaluate(async () => { AppState.currentChapter.name = ''; await UIRenderer.renderQuestion(0, { refresh: true }); });
    assert.equal(await page.locator('.breadcrumb-nav > span').last().textContent(), chapter.title);
    await assertBoundary(page, errors);
  });

  test(`${mode}: favorites, mastery and option callbacks preserve exact string question IDs`, { timeout: 45000 }, async t => {
    const { page, errors } = await fixture(t);
    for (const id of ids) {
      const q = question(id);
      const other = question('local-bank:另一题');
      await page.evaluate(() => { localStorage.clear(); window.boundaryWrites = []; });
      await render(page, mode, mode === 'multi' ? [other, q] : [q]);
      const root = page.locator(mode === 'single' ? '.question-wrapper' : '.multi-question-card').last();
      await assertBoundary(page, errors);
      await root.locator(mode === 'single' ? '[data-shortcut-hint="favorite"]' : '.multi-card-actions .action-btn').first().click();
      assert.equal(await page.evaluate(id => StorageService.isFavorite(id), id), true);
      assert.deepEqual(await page.evaluate(() => boundaryWrites.at(-1)), { id: String(id), patch: { favorite: true } });
      await root.locator('[data-mastery-choice="mastered"]').click();
      assert.equal(await root.locator('[data-mastery-choice="mastered"]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.evaluate(() => boundaryWrites.at(-1)), { id: String(id), patch: { mastery: 'mastered' } });
      await root.locator('.question-mistake-toggle').click();
      assert.deepEqual(await page.evaluate(() => boundaryWrites.at(-1)), { id: String(id), patch: { error_prone: true } });
      await root.locator('.option-item').nth(0).click();
      assert.deepEqual(await page.evaluate(id => [...AppState.answers[String(id)]], id), ['A']);
      await root.locator('.option-item').nth(1).focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(id => [...AppState.answers[String(id)]], id), ['B']);
      const state = await page.evaluate(id => ({ entry: StorageService.getProgress().progress[String(id)], writes: boundaryWrites.map(write => write.id) }), id);
      assert.equal(state.entry.mastery, 'mastered');
      assert.equal(state.entry.last_ok, true);
      assert.equal(state.entry.favorite, true);
      assert.equal(state.entry.error_prone, true);
      assert.ok(state.writes.every(writtenId => writtenId === String(id)), 'every state write targets the selected question');
      if (mode === 'multi') {
        assert.equal(await page.evaluate(() => AppState.answers['local-bank:另一题']), undefined);
        assert.equal(await page.evaluate(() => AppState.currentQuestionIndex), 0, 'selecting another card targets its question without changing the active index');
        await root.locator('.multi-card-actions .action-btn').nth(1).click();
        assert.equal(await page.evaluate(() => String(AppState.questions[AppState.currentQuestionIndex].id)), String(id));
        await page.evaluate(() => { AppState.currentQuestionIndex = 0; });
        await root.locator('.multi-card-actions .action-btn').nth(2).click();
        assert.equal(await page.evaluate(() => String(AppState.questions[AppState.currentQuestionIndex].id)), String(id));
      }
      await assertBoundary(page, errors);
    }
  });
}
