import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRemoteGateway, SESSION_AGE } = require('../desktop/remote-gateway.cjs');

test('remote gateway authenticates, proxies learning APIs, blocks management and revokes sessions', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-remote-gateway-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const upstream = http.createServer((req, res) => {
    if (req.url === '/api/ai/chat') { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: {"type":"delta","content":"hello"}\n\n'); setTimeout(() => res.end('data: {"type":"done"}\n\n'), 10); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method, cookie: req.headers.cookie || '' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const gateway = createRemoteGateway({ authFile: path.join(dir, 'auth.json'), upstream: () => `http://127.0.0.1:${upstream.address().port}`, getMode: () => 'quick' });
  await gateway.init();
  await gateway.setPassword('a strong testing password');
  gateway.setPublicHost('study.example.com');
  const port = await gateway.start();
  t.after(() => gateway.stop());
  const base = `http://127.0.0.1:${port}`;
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const outgoing = http.request(base + route, { method: options.method || 'GET', headers: { Host: 'study.example.com', ...options.headers } }, incoming => {
      const chunks = []; incoming.on('data', chunk => chunks.push(chunk)); incoming.on('end', () => { const body = Buffer.concat(chunks).toString(); resolve({ status: incoming.statusCode, headers: { get: name => { const value = incoming.headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value; } }, json: async () => JSON.parse(body), text: async () => body }); });
    });
    outgoing.on('error', reject); outgoing.end(options.body);
  });
  assert.equal((await request('/api/state')).status, 401);
  assert.equal((await request('/index.html')).status, 302);
  assert.equal((await request('/__remote/login')).status, 200);
  assert.equal((await request('/__remote/login', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: JSON.stringify({ password: 'a strong testing password' }) })).status, 403);
  const loggedIn = await request('/__remote/login', { method: 'POST', headers: { Origin: 'https://study.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'a strong testing password' }) });
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  const expiration = Number(cookie.split('=')[1].split('.')[0]);
  assert.ok(Math.abs(expiration - Date.now() - SESSION_AGE) < 10000);
  assert.match(loggedIn.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const headers = { Cookie: cookie };
  assert.deepEqual(await (await request('/api/state', { headers })).json(), { path: '/api/state', method: 'GET', cookie: '' });
  assert.equal((await request('/api/state/questions/1', { method: 'PATCH', headers: { ...headers, Origin: 'https://study.example.com' }, body: '{}' })).status, 200);
  assert.equal((await request('/api/state/questions/1', { method: 'PATCH', headers, body: '{}' })).status, 403);
  const ai = await request('/api/ai/chat', { method: 'POST', headers: { ...headers, Origin: 'https://study.example.com' }, body: '{}' });
  assert.equal(ai.status, 200);
  assert.equal(ai.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(await ai.text(), /"type":"delta"/);
  for (const route of ['/api/runtime/stop', '/api/runtime/stop%2f', '/api/catalog/refresh', '/api/tunnel/start', '/__remote/admin', '/service-worker.js', '/api/state/events']) {
    assert.notEqual((await request(route, { headers })).status, 200, route);
  }
  assert.equal((await request('/__remote/status', { headers })).status, 200);
  await gateway.revokeSessions();
  assert.equal((await request('/api/state', { headers })).status, 401);
  assert.equal((await request('/api/state', { headers: { Host: 'evil.example' } })).status, 421);
});

test('remote gateway limits repeated password guesses and can change password', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-remote-limit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const gateway = createRemoteGateway({ authFile: path.join(dir, 'auth.json'), upstream: () => 'http://127.0.0.1:1' });
  await gateway.init(); await gateway.setPassword('another strong password');
  gateway.setPublicHost('study.example.com');
  const port = await gateway.start(); t.after(() => gateway.stop());
  for (let i = 0; i < 5; i++) {
    const response = await new Promise((resolve, reject) => { const req = http.request({ hostname: '127.0.0.1', port, path: '/__remote/login', method: 'POST', headers: { Host: 'study.example.com', Origin: 'https://study.example.com' } }, res => { res.resume(); res.on('end', () => resolve(res)); }); req.on('error', reject); req.end(JSON.stringify({ password: 'wrong' })); });
    assert.equal(response.statusCode, i === 4 ? 429 : 401);
  }
  await assert.rejects(gateway.setPassword('new strong password', 'wrong'));
  await gateway.setPassword('new strong password', 'another strong password');
  assert.equal(gateway.hasPassword(), true);
});
