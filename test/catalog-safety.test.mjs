import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { catalogTarget, refreshCatalog } from '../local-server/catalog.mjs';

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-catalog-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('daguan-catalog-')) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  });
  await fs.mkdir(path.join(root, 'web', 'data'), { recursive: true });
  return root;
}

function stubFetch(manifest, bodyFor = () => ({})) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const value = String(url).endsWith('/data/manifest.json') ? manifest : bodyFor(String(url));
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test('题库同步只接受目录内的相对 JSON 文件名', async t => {
  const root = await tempRoot(t);
  const base = path.join(root, 'web', 'data');
  assert.equal(catalogTarget(base, 'manifest.json'), path.join(base, 'manifest.json'));
  assert.equal(catalogTarget(base, 'shards/高等数学.json'), path.join(base, 'shards', '高等数学.json'));
  for (const value of [
    undefined, null, 7, '', '../escaped.json', 'shards/../../escaped.json', '/absolute.json',
    'C:/windows.json', 'C:relative.json', 'shards\\escaped.json', 'shards/./x.json', 'shards/..',
    'shards/con.json', 'shards/name.json ', 'shards/name:stream.json', 'shards/name.txt',
    'shards//empty.json',
  ]) {
    assert.throws(() => catalogTarget(base, value), /文件名|JSON/, `accepted ${String(value)}`);
  }
});

test('恶意 manifest 分片名在写入和下载前被拒绝，暂存目录外不产生文件', async t => {
  const root = await tempRoot(t);
  const fixture = stubFetch({ total: 1, shards: { 高等数学: { file: '../../escaped.json', count: 1 } } });
  t.after(fixture.restore);
  await assert.rejects(() => refreshCatalog(root), /文件名/);
  assert.deepEqual(fixture.requests, ['https://hsad.xyz/daguan-math/data/manifest.json']);
  await assert.rejects(() => fs.access(path.join(root, 'web', 'escaped.json')));
  await assert.rejects(() => fs.access(path.join(root, 'escaped.json')));
  assert.deepEqual((await fs.readdir(path.join(root, 'web', 'data'))).filter((name) => name.startsWith('.staging-')), []);
});

test('合法中文分片名仍能完整同步', async t => {
  const root = await tempRoot(t);
  const manifest = {
    version: 1, total: 1, types: {}, shards: { 高等数学: { file: 'shards/高等数学.json', count: 1 } },
  };
  const bodies = {
    'categories.json': [],
    'category_questions.json': {},
    'id_index.json': {},
    'search_index.json': [],
    'shards/高等数学.json': [{ id: 1 }],
  };
  const fixture = stubFetch(manifest, (url) => bodies[decodeURIComponent(String(url).split('/data/')[1])]);
  t.after(fixture.restore);
  const result = await refreshCatalog(root);
  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  const dataDir = path.join(root, 'web', 'data');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'shards', '高等数学.json'), 'utf8')), [{ id: 1 }]);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf8')).total, 1);
  assert.deepEqual((await fs.readdir(dataDir)).filter((name) => name.startsWith('.staging-')), []);
});
