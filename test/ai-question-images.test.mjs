import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const collectorSource = fs.readFileSync(new URL('../web/ai-question-images.js', import.meta.url), 'utf8');
const MAX_BYTES = 2 * 1024 * 1024;
const hash = 'a'.repeat(64);
const imagePath = (extension = 'png', id = hash) => `./data/assets/${id}.${extension}`;
const signatures = {
  png: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  jpeg: Uint8Array.from([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 255, 217]),
  gif: new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000'),
  webp: new TextEncoder().encode('RIFF\u0004\u0000\u0000\u0000WEBP'),
};
class MemoryFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      if (this.aborted) return;
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.();
    }, () => this.onerror?.());
  }
  abort() { this.aborted = true; this.onabort?.(); }
}
function fixture(fetch, { href = 'http://127.0.0.1:8080/index.html', assetUrl = value => value, timers = {} } = {}) {
  const window = { Blob, FileReader: MemoryFileReader };
  const context = { window, URL, Uint8Array, AbortController, setTimeout, clearTimeout, ...timers };
  vm.runInNewContext(collectorSource, context, { filename: 'ai-question-images.js' });
  const dependencies = { fetch, location: { href }, assetUrl };
  return (question, signal) => window.DaguanAIQuestionImages.collect({ ...dependencies, question, signal });
}
function bodyFixture(chunks, { mime = 'image/png', length = null, ok = true, redirected = false, onRead } = {}) {
  const state = { reads: 0, cancelled: 0, released: 0 };
  const reader = {
    async read() {
      state.reads++;
      if (onRead) return onRead(state.reads);
      return chunks.length ? { done: false, value: chunks.shift() } : { done: true };
    },
    async cancel() { state.cancelled++; },
    releaseLock() { state.released++; },
  };
  return {
    state,
    response: {
      ok, redirected,
      headers: new Headers({ ...(mime ? { 'Content-Type': mime } : {}), ...(length === null ? {} : { 'Content-Length': String(length) }) }),
      body: { getReader: () => reader, cancel: async () => { state.cancelled++; } },
      blob: () => { throw new Error('Unbounded blob() must not be used'); },
      arrayBuffer: () => { throw new Error('Unbounded arrayBuffer() must not be used'); },
    },
  };
}
function paddedImage(size = MAX_BYTES) {
  const bytes = new Uint8Array(size);
  bytes.set(signatures.png);
  return bytes;
}
const questionWith = references => ({ stem: references.map(ref => `![diagram](${ref})`).join('\n'), options: [] });

for (const [extension, bytes] of Object.entries(signatures)) {
  test(`collects a bounded ${extension} image and requests no redirects`, async () => {
    const response = bodyFixture([bytes], { mime: `image/${extension}; charset=binary` });
    let request;
    const collect = fixture(async (url, init) => { request = { url: String(url), init }; return response.response; });
    const images = await collect(questionWith([imagePath(extension)]));
    assert.equal(images.length, 1);
    assert.equal(images[0], `data:image/${extension};base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(request.url, `http://127.0.0.1:8080/data/assets/${hash}.${extension}`);
    assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.credentials, 'same-origin');
    assert.ok(request.init.signal instanceof AbortSignal);
    assert.equal(response.state.released, 1);
  });
}

test('supports the Electron scheme and an HTTP mount prefix without relying on URL.origin', async () => {
  for (const href of ['daguan://app/index.html', 'https://learn.example/daguan-math/index.html']) {
    const calls = [];
    const collect = fixture(async url => { calls.push(String(url)); return new Response(signatures.png, { headers: { 'Content-Type': 'image/png' } }); }, { href });
    assert.equal((await collect(questionWith([imagePath()]))).length, 1);
    assert.equal(calls[0], new URL(imagePath(), href).href);
  }
});

test('rejects APIs, external and protocol-relative URLs, traversal, queries and unsupported image paths before fetching', async () => {
  const forbidden = [
    '/api/state', './api/ai/profiles', '/api/integrations/cxyonly/export?source=local',
    `https://collector.invalid/data/assets/${hash}.png`, `//127.0.0.1:8080/data/assets/${hash}.png`,
    `//collector.invalid/data/assets/${hash}.png`, `\\\\collector.invalid\\data\\assets\\${hash}.png`,
    `../data/assets/${hash}.png`, `./data/assets/../assets/${hash}.png`,
    `./data/assets/%2e%2e/assets/${hash}.png`, `./data/assets/${hash}.png?download=1`,
    `./data/assets/${hash}.png#fragment`, `./data/assets/${hash}.svg`,
    './data/assets/not-a-hash.png', `./data/other/${hash}.png`,
    'data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)',
    `http://user:pass@127.0.0.1:8080/data/assets/${hash}.png`,
  ];
  let calls = 0;
  const collect = fixture(async () => { calls++; throw new Error('Forbidden URL was fetched'); });
  for (const reference of forbidden) assert.equal((await collect(questionWith([reference]))).length, 0, reference);
  assert.equal(calls, 0);
  const electron = fixture(async () => { calls++; throw new Error('Foreign custom host was fetched'); }, { href: 'daguan://app/index.html' });
  assert.equal((await electron(questionWith([`daguan://foreign/data/assets/${hash}.png`]))).length, 0);
  assert.equal(calls, 0);
});

test('asset mapping cannot launder an external or API reference into a local image', async () => {
  let calls = 0;
  const collect = fixture(async () => { calls++; return new Response(signatures.png, { headers: { 'Content-Type': 'image/png' } }); }, { assetUrl: () => imagePath() });
  for (const reference of [`https://collector.invalid/assets/${hash}.png`, '/api/state', 'assets/../../api/state']) {
    assert.equal((await collect(questionWith([reference]))).length, 0, reference);
  }
  assert.equal(calls, 0);
});

test('maps ordinary assets/hash.jpg references and collects options, answers and explanations', async () => {
  const calls = [];
  const collect = fixture(async url => { calls.push(String(url)); return new Response(signatures.jpeg, { headers: { 'Content-Type': 'image/jpeg' } }); }, {
    assetUrl: value => value.startsWith('assets/') ? `./data/${value.replace(/\.jpg$/, '.jpeg')}` : value,
  });
  const images = await collect({
    stem: `![a](assets/${hash}.jpg)`,
    options: [{ content_md: `<img src="${imagePath('jpeg', 'b'.repeat(64))}">` }],
    answer: `![c](${imagePath('jpeg', 'c'.repeat(64))})`,
    explanation: `![d](${imagePath('jpeg', 'd'.repeat(64))})\n![e](${imagePath('jpeg', 'e'.repeat(64))})`,
  });
  assert.equal(images.length, 4);
  assert.equal(calls.length, 4);
  assert.equal(calls[0], `http://127.0.0.1:8080/data/assets/${hash}.jpeg`);
});

test('non-image MIME, false image MIME, empty data, redirects and failed responses never become AI attachments', async () => {
  const cases = [
    { mime: 'application/json', bytes: new TextEncoder().encode('{"annotation":"SYNTHETIC_PRIVATE_MARKER"}') },
    { mime: 'text/html', bytes: new TextEncoder().encode('<p>private</p>') },
    { mime: 'image/svg+xml', bytes: new TextEncoder().encode('<svg/>') },
    { mime: '', bytes: signatures.png },
    { mime: 'image/png', bytes: new TextEncoder().encode('{"annotation":"SYNTHETIC_PRIVATE_MARKER"}') },
    { mime: 'image/png', bytes: new Uint8Array() },
    { mime: 'image/png', bytes: signatures.png, redirected: true },
    { mime: 'image/png', bytes: signatures.png, ok: false },
  ];
  for (const item of cases) {
    const body = bodyFixture([item.bytes], item);
    const collect = fixture(async () => body.response);
    assert.equal((await collect(questionWith([imagePath()]))).length, 0, item.mime);
    if (!['image/png'].includes(item.mime) || item.redirected || item.ok === false) assert.equal(body.state.reads, 0);
    assert.ok(body.state.cancelled || body.state.released);
  }
});

test('an oversized Content-Length is rejected before reading the body', async () => {
  const body = bodyFixture([signatures.png], { length: MAX_BYTES + 1 });
  const collect = fixture(async () => body.response);
  assert.equal((await collect(questionWith([imagePath()]))).length, 0);
  assert.equal(body.state.reads, 0);
  assert.equal(body.state.cancelled, 1);
});

test('stops reading and cancels as soon as streamed bytes exceed the limit even with a short or missing length', async () => {
  for (const length of [null, 8]) {
    const body = bodyFixture([paddedImage(), Uint8Array.of(1)], { length, onRead: count => {
      assert.ok(count <= 2, 'must not read beyond the first overflowing chunk');
      return { done: false, value: count === 1 ? paddedImage() : Uint8Array.of(1) };
    } });
    const collect = fixture(async () => body.response);
    assert.equal((await collect(questionWith([imagePath()]))).length, 0);
    assert.equal(body.state.reads, 2);
    assert.equal(body.state.cancelled, 1);
    assert.equal(body.state.released, 1);
  }
});

test('accepts the per-image boundary and caps aggregate raw bytes to leave room for base64 JSON', async () => {
  let calls = 0;
  const collect = fixture(async () => { calls++; return new Response(paddedImage(), { headers: { 'Content-Type': 'image/png' } }); });
  const references = ['a', 'b', 'c', 'd'].map(letter => imagePath('png', letter.repeat(64)));
  const images = await collect(questionWith(references));
  assert.equal(images.length, 3);
  assert.equal(calls, 3);
  assert.equal(images.reduce((total, value) => total + Buffer.from(value.split(',')[1], 'base64').length, 0), 6 * 1024 * 1024);
});

test('refuses an unstreamable body instead of using an unbounded blob fallback', async () => {
  const body = bodyFixture([]);
  body.response.body.getReader = undefined;
  const collect = fixture(async () => body.response);
  assert.equal((await collect(questionWith([imagePath()]))).length, 0);
  assert.equal(body.state.cancelled, 1);
});

test('a pre-aborted request performs no image fetch', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const collect = fixture(async () => { calls++; throw new Error('must not fetch'); });
  assert.equal((await collect(questionWith([imagePath()]), controller.signal)).length, 0);
  assert.equal(calls, 0);
});

test('cancelling while reading cancels the stream and does not attach partial bytes', async () => {
  const controller = new AbortController();
  let finishRead;
  const body = bodyFixture([], { onRead: () => new Promise(resolve => { finishRead = resolve; queueMicrotask(() => controller.abort()); }) });
  body.response.body.getReader = () => ({
    read: () => new Promise(resolve => { finishRead = resolve; queueMicrotask(() => controller.abort()); }),
    cancel: async () => { body.state.cancelled++; finishRead?.({ done: true }); },
    releaseLock: () => { body.state.released++; },
  });
  const collect = fixture(async () => body.response);
  assert.equal((await collect(questionWith([imagePath()]), controller.signal)).length, 0);
  assert.equal(body.state.cancelled, 1);
  assert.equal(body.state.released, 1);
});

test('a stalled fetch is aborted by the image deadline', async () => {
  let timedOut = false;
  const collect = fixture((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { timedOut = true; reject(new Error('deadline')); }, { once: true });
  }), { timers: { setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout: () => {} } });
  assert.equal((await collect(questionWith([imagePath()]))).length, 0);
  assert.equal(timedOut, true);
});

test('all three browser entry points delegate with explicit dependencies and the caller cancellation signal', async () => {
  for (const file of ['app-legacy.js', 'app2.js', 'new-ai.js']) {
    const source = fs.readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8');
    let received;
    const window = { DaguanAIQuestionImages: { collect: async dependencies => { received = dependencies; return ['synthetic-image']; } } };
    const fetch = async () => { throw new Error('entry point must delegate'); };
    const location = { href: 'daguan://app/index.html' };
    const assetUrl = value => value;
    const context = { window, fetch, location, assetUrl };
    let collect;
    if (file === 'new-ai.js') {
      vm.runInNewContext(source, context);
      collect = window.DaguanNewAI.create({ window, fetch, location, assetUrl }).AIService.questionImages;
    } else {
      const from = source.indexOf('  async function questionImages(');
      const to = source.indexOf(file === 'app2.js' ? '  function sanitizeAiHtml' : '  function enhanceAiDiagrams', from);
      assert.ok(from >= 0 && to > from);
      vm.runInNewContext(source.slice(from, to), context);
      collect = context.questionImages;
    }
    const question = { stem: 'synthetic' };
    const controller = new AbortController();
    assert.equal((await collect(question, controller.signal))[0], 'synthetic-image', file);
    assert.equal(received.question, question, file);
    assert.equal(received.fetch, fetch, file);
    assert.equal(received.location, location, file);
    assert.equal(received.assetUrl, assetUrl, file);
    assert.equal(received.signal, controller.signal, file);
    assert.match(source, /questionImages\((?:q|question), controller\.signal\)/, file);
  }
});
