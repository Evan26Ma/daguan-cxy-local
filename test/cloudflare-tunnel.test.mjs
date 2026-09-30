import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTunnelManager, downloadCloudflared } = require('../desktop/cloudflare-tunnel.cjs');

function fakeProcess() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true; };
  return child;
}
test('named setup uses Cloudflare API, retains only encrypted connector token, and restores after restart', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-named-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [], launches = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body), auth: init.headers.Authorization });
    const result = url.endsWith('/cfd_tunnel') ? { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', token: 'connector-secret' } : { id: 'dns-1' };
    return { ok: true, json: async () => ({ success: true, result }) };
  };
  const gateway = { hasPassword: () => true, start: async () => 49287, stop: async () => {}, setPublicHost: () => {} };
  const options = { userData: dir, gateway, encrypt: value => Buffer.from(`cipher:${value}`), decrypt: bytes => bytes.toString().slice(7), fetchImpl, findBinary: () => 'cloudflared.exe', spawnImpl: (...args) => { launches.push(args); return fakeProcess(); } };
  const manager = createTunnelManager(options); await manager.init();
  await manager.setupNamed({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), zone: 'example.com', subdomain: 'study', apiToken: 'short-lived-api-token' });
  assert.equal(manager.status().hostname, 'study.example.com');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[1].method, 'PUT'); assert.equal(calls[2].method, 'POST');
  assert.equal(calls[1].body.config.ingress[0].service, 'http://127.0.0.1:49287');
  assert.equal(calls[2].body.content, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.cfargotunnel.com');
  const persisted = await fs.readFile(path.join(dir, 'remote-tunnel.json'), 'utf8');
  assert.ok(!persisted.includes('short-lived-api-token') && !persisted.includes('connector-secret'));
  assert.equal(launches[0][2].env.TUNNEL_TOKEN, 'connector-secret');
  await manager.startQuick();
  assert.equal(manager.status().mode, 'quick');
  assert.equal(launches.length, 2, 'switching mode starts one replacement connector');
  await manager.stop();
  const restored = createTunnelManager(options); await restored.init(); await restored.startNamed();
  assert.equal(restored.status().mode, 'named'); await restored.stop();
});

test('DNS conflict rolls back newly created tunnel and leaves no configuration', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-dns-conflict-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith('/dns_records')) return { ok: false, status: 400, json: async () => ({ success: false, errors: [{ message: 'DNS record already exists' }] }) };
    return { ok: true, json: async () => ({ success: true, result: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', token: 'connector-secret' } }) };
  };
  const manager = createTunnelManager({ userData: dir, gateway: { hasPassword: () => true, start: async () => 49288, setPublicHost: () => {} }, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString(), fetchImpl, findBinary: () => 'cloudflared.exe' });
  await manager.init();
  await assert.rejects(manager.setupNamed({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), zone: 'example.com', subdomain: 'study', apiToken: 'token' }), /already exists/);
  assert.equal(manager.status().phase, '添加 DNS 记录');
  assert.match(manager.status().error, /already exists/);
  assert.ok(calls.some(item => item.startsWith('DELETE ') && item.includes('/cfd_tunnel/')));
  await assert.rejects(fs.readFile(path.join(dir, 'remote-tunnel.json')));
});

test('named address is successful only after public login page responds', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-public-probe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let child, publicChecks = 0;
  const fetchImpl = async url => ({ ok: true, json: async () => ({ success: true, result: url.endsWith('/cfd_tunnel') ? { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', token: 'connector-secret' } : { id: 'dns-1' } }) });
  const manager = createTunnelManager({ userData: dir, gateway: { hasPassword: () => true, start: async () => 49287, setPublicHost: () => {} }, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString(), fetchImpl, probeFetch: async url => { publicChecks++; assert.equal(url, 'https://study.example.com/__remote/login'); return { status: 200 }; }, findBinary: () => 'cloudflared.exe', spawnImpl: () => { child = fakeProcess(); return child; } });
  await manager.init();
  await manager.setupNamed({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), zone: 'example.com', subdomain: 'study', apiToken: 'token' });
  assert.equal(manager.status().state, 'connecting');
  child.stderr.emit('data', 'Registered tunnel connection');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(publicChecks, 1);
  assert.equal(manager.status().state, 'connected');
  assert.equal(manager.status().phase, '公网登录页可访问');
  await manager.stop();
});

test('quick address stays unverified until the public login page responds', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-quick-probe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let child, checkedUrl = '';
  const manager = createTunnelManager({ userData: dir, gateway: { hasPassword: () => true, start: async () => 49287, setPublicHost: () => {} }, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString(), probeFetch: async url => { checkedUrl = url; return { status: 200 }; }, findBinary: () => 'cloudflared.exe', spawnImpl: () => { child = fakeProcess(); return child; } });
  await manager.startQuick();
  child.stderr.emit('data', 'https://daily-test.trycloudflare.com');
  assert.equal(manager.status().state, 'connecting');
  assert.equal(checkedUrl, '');
  child.stderr.emit('data', 'Registered tunnel connection');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checkedUrl, 'https://daily-test.trycloudflare.com/__remote/login');
  assert.equal(manager.status().state, 'connected');
  await manager.stop();
});

test('ingress configuration failure removes the new tunnel before saving', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-ingress-failure-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (init.method === 'PUT') return { ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: 'Tunnel permission denied' }] }) };
    return { ok: true, json: async () => ({ success: true, result: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', token: 'connector-secret' } }) };
  };
  const manager = createTunnelManager({ userData: dir, gateway: { hasPassword: () => true, start: async () => 49288, setPublicHost: () => {} }, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString(), fetchImpl, findBinary: () => 'cloudflared.exe' });
  await manager.init();
  await assert.rejects(manager.setupNamed({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), zone: 'example.com', subdomain: 'study', apiToken: 'token' }), /permission denied/);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].startsWith('DELETE '));
  await assert.rejects(fs.readFile(path.join(dir, 'remote-tunnel.json')));
});

test('cloudflared download verifies the official release SHA-256 before install', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-cloudflared-download-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.alloc(1_000_100, 42);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const fakeFetch = async url => url.includes('api.github.com')
    ? { ok: true, json: async () => ({ assets: [{ name: 'cloudflared-windows-amd64.exe', digest: `sha256:${digest}`, browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe' }] }) }
    : { ok: true, arrayBuffer: async () => bytes };
  const installed = await downloadCloudflared(dir, fakeFetch);
  assert.equal(await fs.stat(installed).then(item => item.size), bytes.length);
  const badFetch = async url => url.includes('api.github.com')
    ? { ok: true, json: async () => ({ assets: [{ name: 'cloudflared-windows-amd64.exe', digest: `sha256:${'0'.repeat(64)}`, browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe' }] }) }
    : { ok: true, arrayBuffer: async () => bytes };
  await assert.rejects(downloadCloudflared(path.join(dir, 'bad'), badFetch), /校验值不匹配/);
});
