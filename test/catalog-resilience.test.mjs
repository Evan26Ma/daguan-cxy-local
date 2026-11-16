import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CATALOG_FETCH, catalogSource, fetchJson, refreshCatalog } from '../local-server/catalog.mjs';

const FAST = { timeoutMs: 200, attempts: 3, retryDelayMs: 5 };

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-catalog-net-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('daguan-catalog-net-')) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  });
  await fs.mkdir(path.join(root, 'web', 'data'), { recursive: true });
  return root;
}

const MANIFEST = { version: 'fixture-1', total: 2, types: {}, shards: { 高等数学: { file: 'shards/高等数学.json', count: 2 } } };
const BODIES = {
  'manifest.json': MANIFEST,
  'categories.json': [{ id: 'c1', name: '高等数学' }],
  'category_questions.json': {},
  'id_index.json': ['1', '2'],
  'search_index.json': [],
  'shards/高等数学.json': [{ id: '1' }, { id: '2' }],
};

function bodyFor(url) {
  const name = String(url).split('/data/')[1];
  return new Response(JSON.stringify(BODIES[name] ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init, calls.length); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('镜像瞬时断连会重试，恢复后仍能完成整轮刷新', { timeout: 20000 }, async t => {
  const root = await tempRoot(t);
  const fixture = stubFetch((url, init, count) => {
    if (count <= 2) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return bodyFor(url);
  });
  t.after(fixture.restore);
  const result = await refreshCatalog(root, undefined, FAST);
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(fixture.calls.filter(url => url.endsWith('/data/manifest.json')).length, 3);
  assert.equal(await fs.readFile(path.join(root, 'web', 'data', 'manifest.json'), 'utf8').then(JSON.parse).then(value => value.total), 2);
});

test('镜像不响应时按单次超时中止，并报告尝试次数', async () => {
  const fixture = stubFetch((url, init) => new Promise((resolve, reject) => {
    if (init.signal.aborted) return reject(init.signal.reason);
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  try {
    await assert.rejects(
      () => fetchJson('https://mirror.test/data/manifest.json', { timeoutMs: 30, attempts: 3, retryDelayMs: 1 }),
      /连接官网题库超时（30 毫秒）：https:\/\/mirror\.test\/data\/manifest\.json（已尝试 3 次）/,
    );
    assert.equal(fixture.calls.length, 3);
  } finally {
    fixture.restore();
  }
});

test('镜像返回 404 时不重试，直接把文件名问题暴露出来', async () => {
  const fixture = stubFetch(() => new Response('not found', { status: 404, statusText: 'Not Found' }));
  try {
    await assert.rejects(() => fetchJson('https://mirror.test/data/missing.json', FAST), error => {
      assert.match(error.message, /404 Not Found: https:\/\/mirror\.test\/data\/missing\.json$/);
      assert.doesNotMatch(error.message, /已尝试/);
      return true;
    });
    assert.equal(fixture.calls.length, 1);
  } finally {
    fixture.restore();
  }
});

test('镜像 5xx 会重试，连续失败时报出尝试次数', async () => {
  const fixture = stubFetch(() => new Response('busy', { status: 503, statusText: 'Service Unavailable' }));
  try {
    await assert.rejects(
      () => fetchJson('https://mirror.test/data/manifest.json', { ...FAST, attempts: 2 }),
      /503 Service Unavailable: https:\/\/mirror\.test\/data\/manifest\.json（已尝试 2 次）/,
    );
    assert.equal(fixture.calls.length, 2);
  } finally {
    fixture.restore();
  }
});

test('镜像地址可由 DAGUAN_CATALOG_SOURCE 覆盖，便于自建镜像与回归测试', { timeout: 20000 }, async t => {
  const root = await tempRoot(t);
  const previous = process.env.DAGUAN_CATALOG_SOURCE;
  process.env.DAGUAN_CATALOG_SOURCE = 'https://mirror.test/daguan-math';
  t.after(() => {
    if (previous === undefined) delete process.env.DAGUAN_CATALOG_SOURCE;
    else process.env.DAGUAN_CATALOG_SOURCE = previous;
  });
  const fixture = stubFetch(url => bodyFor(url));
  t.after(fixture.restore);
  assert.equal(catalogSource(), 'https://mirror.test/daguan-math');
  await refreshCatalog(root, undefined, FAST);
  assert.ok(fixture.calls.length >= 6);
  assert.ok(fixture.calls.every(url => url.startsWith('https://mirror.test/daguan-math/data/')), fixture.calls.join('\n'));
  assert.ok(CATALOG_FETCH.timeoutMs >= 1000 && CATALOG_FETCH.attempts >= 2);
});
