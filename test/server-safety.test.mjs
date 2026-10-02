import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serviceFixture } from './runtime-fixture.mjs';

test('invalid mastery returns one 400, server and subsequent writes survive', { timeout: 15000 }, async t => {
  const { base, output } = await serviceFixture(t);
  const patch = mastery => fetch(base + '/api/state/questions/1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, mastery }),
  });
  const invalid = await patch('invalid');
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /掌握状态无效/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await patch('learning')).status, 200);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.revision, 1);
  assert.equal(state.progress[1].mastery, 'learning');
  assert.doesNotMatch(output(), /ERR_HTTP_HEADERS_SENT/);
});

test('corrupt state stops startup, preserves original and releases its own lease', { timeout: 15000 }, async t => {
  const { dir, closed, output } = await serviceFixture(t, { corrupt: true });
  const [code] = await closed;
  assert.notEqual(code, 0);
  assert.match(output(), /DATA_CORRUPT/);
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), '{broken');
  await assert.rejects(fs.stat(path.join(dir, '.service-instance.json')), { code: 'ENOENT' });
});
