import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { transform } from '../ios/scripts/prepare-web.mjs';
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('Chromium DOM validates copied renderer daguan assets and precise capability UI, persistence errors and Files input', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><head></head><body><button id="btn-switch-legacy">旧版</button><section class="tool-card"><button id="sync-toggle-btn">官网同步</button></section><section id="ai-services-settings">AI settings</section><section id="tool-backup-card">备份</section><input type="file" id="restore-input" accept=".json,application/json"></body></html>');
    await page.addStyleTag({ content: await read('ios/Web/platform.css') });
    await page.addScriptTag({ content: await read('web/vendor/purify.min.js') });
    const bridge = await read('ios/Web/bridge.js'); const renderer = transform('safe-render.js', await read('web/safe-render.js'));
    const result = await page.evaluate(({ bridge, renderer }) => {
      // Chromium cannot navigate to WKURLSchemeHandler. Supply that origin only
      // to the reviewed modules; use real DOM, DOMPurify, CSS and Web Streams.
      const fake = Object.create(window);
      Object.defineProperties(fake, {
        location: { value: new URL('daguan://app/index.html') },
        document: { value: document },
        DOMPurify: { value: () => window.DOMPurify(window) },
        atob: { value: window.atob.bind(window) },
        btoa: { value: window.btoa.bind(window) },
        __DAGUAN_IOS_KV__: { value: {} },
        webkit: { value: { messageHandlers: { daguan: { postMessage(message) { window.__nativeMessages.push(message); } } } } },
        addEventListener: { value: window.addEventListener.bind(window) },
      });
      window.__nativeMessages = []; window.__iosFake = fake;
      new Function('window', bridge)(fake); new Function('window', renderer)(fake);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      const render = fake.DaguanSafeRender.create({ assetUrl: path => path.startsWith('assets/') ? './data/' + path : path });
      const html = render.html('<img src="daguan://app/data/assets/test.png" onerror="alert(1)"><img src="daguan://evil/data/assets/test.png"><img src="daguan://app/api/state"><img src="javascript:alert(1)"><a href="javascript:alert(1)">bad</a><button data-app-action="unlock">bad</button>');
      const holder = document.createElement('div'); holder.innerHTML = html;
      fake.localStorage.setItem('draft', 'important');
      return { srcs: [...holder.querySelectorAll('img')].map(img => img.getAttribute('src')), html };
    }, { bridge, renderer });
    assert.equal(result.srcs[0], 'daguan://app/data/assets/test.png'); assert.deepEqual(result.srcs.slice(1), [null, null, null]); assert.doesNotMatch(result.html, /onerror|javascript:|data-app-action|<button/);
    await page.waitForFunction(() => window.__nativeMessages.some(message => message.operation === 'kv'));
    await page.evaluate(() => { const message = window.__nativeMessages.find(message => message.operation === 'kv'); window.__iosFake.DaguanIOS.receive({ id: message.id, ok: false, error: 'storage unavailable' }); });
    await page.getByText(/尚未保存到设备：storage unavailable/).waitFor();
    assert.equal(await page.locator('#btn-switch-legacy').isVisible(), false); assert.equal(await page.locator('#sync-toggle-btn').isVisible(), false); assert.equal(await page.locator('#ai-services-settings').isVisible(), true); assert.equal(await page.locator('#tool-backup-card').isVisible(), true);
    await page.locator('#restore-input').setInputFiles({ name: 'daguan-progress-test.json', mimeType: 'application/json', buffer: Buffer.from('{"progress":{}}') });
    assert.equal(await page.locator('#restore-input').evaluate(input => input.files[0].name), 'daguan-progress-test.json');
    await page.getByRole('button', { name: '重试保存' }).click();
    await page.evaluate(() => { const message = window.__nativeMessages.at(-1); window.__iosFake.DaguanIOS.receive({ id: message.id, ok: true, result: {} }); });
    await page.locator('#ios-persistence-status').waitFor({ state: 'hidden' });
  } finally { await browser.close(); }
});
