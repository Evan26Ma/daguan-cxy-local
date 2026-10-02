import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../local-server/store.mjs';
import { localToRemoteDocument, localToAndroidDocument, buildPullMerge } from '../local-server/sync-format.mjs';

const iso = '2026-10-02T00:00:00.000Z';
for (const at of [iso, Date.parse(iso), String(Date.parse(iso))]) {
  test(`exports accept timestamp ${typeof at}: ${at}`, () => {
    const state = { progress: { 1: { mastery: 'learning', updated_at: at } } };
    assert.equal(localToRemoteDocument(state).states[1].updated_at, iso);
    assert.equal(localToAndroidDocument(state).states[1].updatedAt, iso);
  });
}
test('invalid export timestamps do not throw', () => {
  const state = { progress: { 1: { mastery: 'learning', updated_at: 'invalid' } } };
  assert.doesNotThrow(() => localToRemoteDocument(state));
  assert.equal(localToAndroidDocument(state).states[1].updatedAt, null);
});
test('epoch zero remains a valid timestamp', () => {
  for (const at of [0, '0', '1970-01-01T00:00:00Z']) {
    const state = { progress: { 1: { mastery: 'learning', updated_at: at } } };
    assert.equal(localToRemoteDocument(state).states[1].updated_at, '1970-01-01T00:00:00.000Z');
    assert.equal(localToAndroidDocument(state).states[1].updatedAt, '1970-01-01T00:00:00.000Z');
  }
});
for (const remoteAt of ['invalid', null, '2026-10-01T00:00:00Z']) {
  test(`older or unknown remote time preserves valid local progress: ${remoteAt}`, () => {
    const result = buildPullMerge({ progress: { 1: { mastery: 'learning', updated_at: iso } } },
      [{ question_id: 1, mastery: 'mastered', updated_at: remoteAt }]);
    assert.equal(result.state.progress[1].mastery, 'learning');
  });
}
test('corrupt state is preserved and cannot be overwritten', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createStore(dir, dir);
  await fs.writeFile(path.join(dir, 'state.json'), '{broken');
  await assert.rejects(store.readState(), { code: 'DATA_CORRUPT' });
  await assert.rejects(store.writeState({ progress: {} }), { code: 'DATA_CORRUPT' });
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), '{broken');
});
test('missing files initialize, other read errors are not empty data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-read-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createStore(dir, dir);
  assert.deepEqual((await store.readState()).progress, {});
  await fs.mkdir(path.join(dir, 'state.json'));
  await assert.rejects(store.readState(), { code: 'DATA_READ_FAILED' });
});
test('a failed write preserves the previous state and releases the write queue', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-write-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createStore(dir, dir);
  const saved = await store.writeState({ progress: { 1: { mastery: 'learning' } } });
  const before = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  const circular = {}; circular.self = circular;
  await assert.rejects(store.writeState({ progress: { 1: { circular } } }));
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), before);
  assert.deepEqual((await fs.readdir(dir)).filter(name => name.includes('.tmp-')), []);
  const after = await store.writeState({ progress: { 1: { mastery: 'mastered' } } }, { expectedRevision: saved.revision });
  assert.equal(after.revision, saved.revision + 1);
});
test('corrupt AI configuration cannot be silently replaced', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-profile-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createStore(dir, dir);
  await fs.writeFile(path.join(dir, 'ai-profiles.json'), '{broken');
  await assert.rejects(store.writeAiProfiles({ profiles: [] }), { code: 'DATA_CORRUPT' });
  assert.equal(await fs.readFile(path.join(dir, 'ai-profiles.json'), 'utf8'), '{broken');
});
