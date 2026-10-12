import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../ios/Web/bridge.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(snapshot = {}, options = {}) {
  const sent = [], timers = new Map(); let timerId = 0;
  const listeners = new Map();
  const root = {
    location: new URL('daguan://app/index.html'), __DAGUAN_IOS_KV__: snapshot,
    webkit: { messageHandlers: { daguan: { postMessage(message) { sent.push(message); options.post?.(message); } } } },
    atob, btoa, addEventListener(type, listener) { listeners.set(type, listener); }, alert() {},
  };
  const context = vm.createContext({ window: root, TextEncoder, TextDecoder, URL, Request, Response, ReadableStream, EventTarget, Event, MessageEvent, DOMException, queueMicrotask,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(script, context);
  const ack = (message, result, ok = true) => root.DaguanIOS.receive({ id: message.id, ok, result, error: ok ? undefined : result });
  return { root, sent, ack, timers, listeners };
}
const envelope = (body, status = 200) => ({ status, body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'), headers: { 'Content-Type': 'application/json' } });

test('document-start fetch handles Request method/body/signal and binary response envelopes', async () => {
  const f = fixture();
  const job = f.root.fetch(new Request('daguan://app/api/state?x=1', { method: 'PUT', body: '{"revision":7}' }));
  await tick(); const message = f.sent[0];
  assert.equal(message.operation, 'request'); assert.equal(message.path, '/api/state?x=1'); assert.equal(message.method, 'PUT'); assert.equal(message.body, '{"revision":7}');
  f.ack(message, envelope({ revision: 8 }, 409));
  const result = await job; assert.equal(result.status, 409); assert.equal(result.ok, false); assert.deepEqual(await result.json(), { revision: 8 });
  const resource = f.root.fetch('./data/manifest.json'); await tick();
  assert.equal(f.sent[1].operation, 'resource'); f.ack(f.sent[1], envelope('你好')); assert.equal(await (await resource).text(), '你好');
  const head = f.root.fetch('./assets/landing/local-mark.png', { method: 'HEAD' }); await tick(); f.ack(f.sent[2], envelope('bytes')); assert.equal(await (await head).text(), '');
});

test('external schemes/hosts/credentials and encoded separators never reach native transport', async () => {
  const f = fixture();
  for (const url of ['https://evil.test/api/state', 'daguan://other/api/state', 'daguan://u:p@app/api/state', 'file:///data/x', '//evil.test/x', '/data/%252e%252e%255csecret', '/data/%00x']) await assert.rejects(f.root.fetch(url));
  assert.equal(f.sent.length, 0);
  assert.equal(f.root.DaguanIOS.isAssetURL('daguan://app/data/assets/a.svg'), true);
  assert.equal(f.root.DaguanIOS.isAssetURL('daguan://app/api/state'), false);
});

test('abort and timeout release pending slots; late replies are ignored', async () => {
  const f = fixture(); const controller = new AbortController();
  const promise = f.root.fetch('/api/state', { signal: controller.signal }); await tick(); controller.abort(); await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(f.sent[1].operation, 'cancel-request'); assert.equal(f.sent[1].requestId, f.sent[0].id);
  f.ack(f.sent[0], envelope('late')); assert.equal(f.timers.size, 0);
  const delayed = f.root.fetch('/api/state'); await tick(); [...f.timers.values()][0].fn(); await assert.rejects(delayed, /timed out/);
  assert.equal(f.sent[3].operation, 'cancel-request'); assert.equal(f.sent[3].requestId, f.sent[2].id);
  const jobs = Array.from({ length: 128 }, () => f.root.fetch('/api/state')); await tick();
  await assert.rejects(f.root.fetch('/api/state'), /Too many pending/);
  for (const message of f.sent.slice(4)) f.ack(message, envelope('{}')); await Promise.all(jobs);
});

test('chat creates SSE bytes preserving JSON payload type, close and cancel behavior', async () => {
  const f = fixture(); const abort = new AbortController();
  const promise = f.root.fetch('/api/ai/chat', { method: 'POST', body: '{}', signal: abort.signal }); await tick();
  const message = f.sent[0]; assert.equal(message.operation, 'chat'); f.ack(message, { runId: 'run-1' });
  const response = await promise; assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  f.root.DaguanIOS.stream({ id: message.id, event: 'started', data: JSON.stringify({ type: 'started', runId: 'run-1' }) });
  f.root.DaguanIOS.stream({ id: message.id, event: 'delta', data: { type: 'delta', content: '答\n案' } });
  f.root.DaguanIOS.stream({ id: message.id, event: 'done', data: { type: 'done' } });
  let text = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
  assert.deepEqual(text.trim().split('\n\n').map(line => JSON.parse(line.slice(6))).map(x => x.type), ['started', 'delta', 'done']);
  const second = f.root.fetch('/api/ai/chat', { method: 'POST', body: '{}', signal: abort.signal }); await tick(); const secondMessage = f.sent.at(-1); f.ack(secondMessage, { runId: 'run-2' });
  const secondReader = (await second).body.getReader(); abort.abort(); await assert.rejects(secondReader.read(), { name: 'AbortError' }); assert.equal(f.sent.at(-1).operation, 'cancel'); assert.equal(f.sent.at(-1).runId, 'run-2'); f.ack(f.sent.at(-1), {});
});

test('chat timeout before acknowledgement cancels using request ID; bounded unread buffers fail', async () => {
  const f = fixture(); const job = f.root.fetch('/api/ai/chat', { method: 'POST', body: '{}' }); await tick();
  const first = f.sent[0]; [...f.timers.values()].find(timer => timer.delay === 30000).fn(); await assert.rejects(job, /timed out/); assert.equal(f.sent.at(-1).runId, first.id); f.ack(f.sent.at(-1), {});
  const next = f.root.fetch('/api/ai/chat', { method: 'POST', body: '{}' }); await tick(); const message = f.sent.at(-1); f.ack(message, {}); const response = await next;
  f.root.DaguanIOS.stream({ id: message.id, event: 'delta', data: { content: 'x'.repeat(2097152) } }); await assert.rejects(response.text(), /buffer exceeded/); f.ack(f.sent.at(-1), {});
});

test('EventSource supports listeners properties close and no late-event delivery', async () => {
  const f = fixture(); const events = new f.root.EventSource('./api/state/events');
  assert.equal(events.readyState, events.CONNECTING); const request = f.sent[0];
  let initialRevision; events.addEventListener('state', event => { initialRevision = JSON.parse(event.data).revision; });
  f.root.DaguanIOS.event({ subscriptionId: request.subscriptionId, type: 'state', data: { revision: 5 } });
  f.ack(request, { subscriptionId: 'sub-1' }); await tick(); assert.equal(initialRevision, 5);
  assert.equal(events.readyState, events.OPEN);
  let data; events.addEventListener('state', event => { data = JSON.parse(event.data); }); f.root.DaguanIOS.event({ subscriptionId: 'sub-1', type: 'state', data: { revision: 12 } }); assert.deepEqual(data, { revision: 12 });
  events.close(); assert.equal(events.readyState, events.CLOSED); assert.equal(f.sent.at(-1).operation, 'unsubscribe'); f.ack(f.sent.at(-1), {});
  f.root.DaguanIOS.event({ subscriptionId: 'sub-1', type: 'state', data: { revision: 99 } }); assert.equal(data.revision, 12);
  assert.throws(() => new f.root.EventSource('https://evil.test/'));
  const closing = new f.root.EventSource('/api/state/events'); const subscription = f.sent.at(-1); closing.close(); f.ack(f.sent.at(-1), {}); f.ack(subscription, { subscriptionId: 'late-sub' }); await tick(); assert.equal(f.sent.at(-1).subscriptionId, 'late-sub'); f.ack(f.sent.at(-1), {});
});

test('sync storage snapshot writes serialize, failures stay dirty, explicit flush retries newest values', async () => {
  const f = fixture({ old: '1' }); const storage = f.root.localStorage;
  assert.equal(storage.getItem('old'), '1'); storage.setItem('first', 2); await tick(); const first = f.sent[0];
  storage.setItem('latest', '3'); await tick(); assert.equal(f.sent.length, 1);
  f.ack(first, {}); await tick(); assert.equal(f.sent.length, 2); assert.equal(f.sent[1].values.latest, '3');
  f.ack(f.sent[1], 'disk full', false); await tick(); assert.equal(f.root.DaguanIOS.persistence.dirty, true); assert.equal(f.root.DaguanIOS.persistence.error, 'disk full');
  storage.removeItem('old'); await tick(); assert.equal(f.sent.length, 2);
  const retry = f.root.DaguanIOS.flush(); assert.equal(f.sent.length, 3); assert.equal(f.sent[2].values.old, undefined); f.ack(f.sent[2], {}); await retry;
  assert.equal(f.root.DaguanIOS.persistence.dirty, false); assert.equal(storage.length, 2);
  storage.setItem('__proto__', 'safe'); assert.equal(storage.getItem('__proto__'), 'safe'); await tick(); f.ack(f.sent.at(-1), {}); await f.root.DaguanIOS.flush();
});

test('reload freezes mutations before flushing and resumes on failure or explicit native cancellation', async () => {
  const f = fixture(); f.root.localStorage.setItem('draft', 'latest');
  const reloading = f.root.DaguanIOS.prepareReload();
  assert.equal(f.root.DaguanIOS.prepareReload(), reloading);
  assert.throws(() => f.root.localStorage.setItem('draft', 'lost'), /编辑已暂停/);
  assert.equal(f.root.localStorage.getItem('draft'), 'latest');
  f.ack(f.sent[0], 'disk unavailable', false); await assert.rejects(reloading, /disk unavailable/);
  f.root.localStorage.setItem('draft', 'retry'); const retry = f.root.DaguanIOS.prepareReload(); f.ack(f.sent.at(-1), {}); await retry;
  assert.throws(() => f.root.localStorage.removeItem('draft'), /编辑已暂停/);
  f.root.DaguanIOS.resumeStorage(); f.root.localStorage.setItem('draft', 'resumed'); await tick(); f.ack(f.sent.at(-1), {}); await f.root.DaguanIOS.flush();
});

test('missing bootstrap refuses writes; export waits for durability and native acknowledgement', async () => {
  const missing = fixture(null); assert.throws(() => missing.root.localStorage.setItem('a', 'b'), /快照未加载/); await assert.rejects(missing.root.DaguanIOS.flush());
  const f = fixture(); f.root.localStorage.setItem('draft', 'keep'); await tick(); const exporting = f.root.DaguanIOS.exportBlob(new Blob(['备份'], { type: 'application/json' }), 'backup.json');
  assert.equal(f.sent.length, 1); f.ack(f.sent[0], {}); await tick(); const message = f.sent[1]; assert.equal(message.operation, 'export'); assert.equal(Buffer.from(message.base64, 'base64').toString(), '备份');
  f.ack(message, { presented: true }); assert.equal(await exporting, true);
});
