import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function dataFactory(fetch) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../web/new-data.js', import.meta.url), 'utf8'), context);
  return context.window.DaguanNewData.create({ AppState: { manifest: { shards: { sample: { file: 'shards/sample.json' } } } }, fetch });
}

test('real data module coalesces concurrent shard loads and caches the result', async () => {
  let calls = 0;
  const Data = dataFactory(async () => { calls++; return { ok: true, json: async () => [{ id: 7, stem: 'question' }] }; });
  const [a, b] = await Promise.all([Data.ensureShard('sample'), Data.ensureShard('sample')]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.get(7).stem, 'question');
  assert.equal(await Data.ensureShard('sample'), a);
  assert.equal(calls, 1);
});

test('real data module releases a failed in-flight load for retry', async () => {
  let calls = 0;
  const Data = dataFactory(async () => ({ ok: ++calls > 1, json: async () => [{ id: 7 }] }));
  await assert.rejects(Data.ensureShard('sample'), /分片加载失败/);
  assert.equal(Data.shardInflight.size, 0);
  assert.equal(Data.shardCache.size, 0);
  assert.ok((await Data.ensureShard('sample')).has(7));
  assert.equal(calls, 2);
});

test('separate data module instances never share shard caches', async () => {
  const first = dataFactory(async () => ({ ok: true, json: async () => [{ id: 7 }] }));
  const second = dataFactory(async () => ({ ok: true, json: async () => [{ id: 8 }] }));
  assert.ok((await first.ensureShard('sample')).has(7));
  assert.equal(second.shardCache.size, 0);
  assert.ok((await second.ensureShard('sample')).has(8));
});
