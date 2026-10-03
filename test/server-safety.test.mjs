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

test('legacy migration preserves annotations, study position and local sync metadata', { timeout: 15000 }, async t => {
  const { base } = await serviceFixture(t);
  const request = (route, method, value) => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  const initial = {
    revision: 0,
    progress: { 1: { mastery: 'mastered', updated_at: '2026-10-03T00:00:00Z' } },
    annotations: { 1: { markdown: 'Keep this note', updated_at: '2026-10-03T00:00:00Z' } },
    favorites: ['1'], picked: ['1'],
    last_study: { category_id: 331, question_id: 1, updated_at: '2026-10-03T00:00:00Z' },
    remote_seeded_at: '2026-10-02T00:00:00Z',
    pending_remote_operations: [{ questionId: '1', payload: { mastery: 'mastered' } }],
    pending_unknown_states: { 99999: { source: 'reconcile' } },
    local_activity: { marker: 'local' }, remote_activity: { marker: 'remote' },
    remote_last_study: { question_id: 2 },
  };
  assert.equal((await request('/api/state', 'PUT', initial)).status, 200);
  const before = await (await fetch(base + '/api/state')).json();
  for (const incoming of [
    { progress: { 1: { mastery: 'learning', updated_at: '2026-10-01T00:00:00Z' }, 2: { mastery: 'learning' } }, favorites: ['2'], picked: ['2'], settings: {} },
    { progress: {}, annotations: {}, last_study: null, remote_seeded_at: null, pending_remote_operations: [] },
  ]) {
    const response = await request('/api/state/migrate', 'POST', incoming);
    assert.equal(response.status, 200);
    const { state } = await response.json();
    for (const key of ['annotations', 'last_study', 'remote_seeded_at', 'pending_remote_operations', 'pending_unknown_states', 'local_activity', 'remote_activity', 'remote_last_study']) {
      assert.deepEqual(state[key], before[key], key);
    }
    assert.equal(state.progress[1].mastery, 'mastered');
    assert.equal(state.progress[2].mastery, 'learning');
    assert.deepEqual(state.favorites, ['1', '2']);
    assert.deepEqual(state.picked, ['1', '2']);
  }
});

test('legacy migration merges notes and position without replacing newer local records', { timeout: 15000 }, async t => {
  const { base } = await serviceFixture(t);
  const put = value => fetch(base + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await put({ revision: 0,
    annotations: { 1: { markdown: 'New local note', updated_at: '2026-10-03T00:00:00Z' } },
    last_study: { question_id: 1, updated_at: '2026-10-03T00:00:00Z' },
  })).status, 200);
  const migrate = async value => {
    const response = await fetch(base + '/api/state/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal(response.status, 200);
    return (await response.json()).state;
  };
  let state = await migrate({ annotations: { 1: { markdown: 'Old note', updated_at: '2026-10-01T00:00:00Z' }, 2: { markdown: 'Imported note' } }, last_study: { question_id: 2, updated_at: '2026-10-01T00:00:00Z' } });
  assert.equal(state.annotations[1].markdown, 'New local note');
  assert.equal(state.annotations[2].markdown, 'Imported note');
  assert.equal(state.last_study.question_id, 1);
  state = await migrate({ annotations: { 1: { markdown: 'Newest note', updated_at: '2026-10-04T00:00:00Z' } }, last_study: { question_id: 3, updated_at: '2026-10-04T00:00:00Z' } });
  assert.equal(state.annotations[1].markdown, 'Newest note');
  assert.equal(state.annotations[2].markdown, 'Imported note');
  assert.equal(state.last_study.question_id, 3);
});
