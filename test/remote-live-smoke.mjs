// Manual network smoke test: node test/remote-live-smoke.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRemoteGateway } = require('../desktop/remote-gateway.cjs');
const { createTunnelManager } = require('../desktop/cloudflare-tunnel.cjs');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-remote-smoke-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, [path.join(root, 'local-server', 'server.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DAGUAN_DATA_DIR: path.join(dir, 'data'), DAGUAN_LAUNCHER_KIND: 'desktop', DAGUAN_OPEN_BROWSER: '0' } });
const readyBy = Date.now() + 15000;
while (Date.now() < readyBy) {
  try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (Date.now() >= readyBy) throw Error('isolated local service did not start');
const gateway = createRemoteGateway({ authFile: path.join(dir, 'auth.json'), upstream: () => `http://127.0.0.1:${port}` });
await gateway.init(); await gateway.setPassword('temporary-smoke-password-492');
const manager = createTunnelManager({ userData: dir, gateway, encrypt: value => Buffer.from(value), decrypt: value => value.toString() });
try {
  await manager.init(); await manager.startQuick();
  const deadline = Date.now() + 90000;
  let url, response;
  while (Date.now() < deadline) {
    url = manager.status().url;
    if (url) {
      try { response = await fetch(url + '__remote/login', { signal: AbortSignal.timeout(5000) }); if (response.status === 200) break; } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!response || response.status !== 200) throw Error(`Quick Tunnel did not serve login: ${manager.status().state} ${manager.status().error}`);
  const connectedBy = Date.now() + 10000;
  while (manager.status().state !== 'connected' && Date.now() < connectedBy) await new Promise(resolve => setTimeout(resolve, 250));
  if (manager.status().state !== 'connected') throw Error(`Quick Tunnel status did not confirm public reachability: ${manager.status().state}`);
  const unauthenticated = await fetch(url + 'api/state');
  if (unauthenticated.status !== 401) throw Error(`unauthenticated API returned ${unauthenticated.status}`);
  const signed = await fetch(url + '__remote/login', { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'temporary-smoke-password-492' }) });
  if (signed.status !== 200) throw Error(`login failed: ${signed.status}`);
  const cookie = signed.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie };
  for (const route of ['index.html', 'legacy.html', 'api/state', 'api/ai/profiles', 'api/integrations/cxyonly/export?source=local']) {
    const response = await fetch(url + route, { headers });
    if (!response.ok) throw Error(`${route} failed: ${response.status}`);
  }
  const initial = await (await fetch(url + 'api/state', { headers })).json();
  const save = await fetch(url + 'api/state/questions/31001', { method: 'PATCH', headers: { ...headers, Origin: new URL(url).origin, 'If-Match': String(initial.revision), 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: true }) });
  if (!save.ok) throw Error(`remote learning write failed: ${save.status}`);
  const written = await save.json();
  const annotation = await fetch(url + 'api/state/questions/31001/annotation', { method: 'PATCH', headers: { ...headers, Origin: new URL(url).origin, 'If-Match': String(written.revision), 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: 'temporary remote smoke note' }) });
  if (!annotation.ok) throw Error(`remote annotation failed: ${annotation.status}`);
  const secondLogin = await fetch(url + '__remote/login', { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'temporary-smoke-password-492' }) });
  if (!secondLogin.ok) throw Error(`second-device login failed: ${secondLogin.status}`);
  const secondCookie = secondLogin.headers.get('set-cookie').split(';')[0];
  const secondState = await (await fetch(url + 'api/state', { headers: { Cookie: secondCookie } })).json();
  if (secondState.progress?.['31001']?.favorite !== true || secondState.annotations?.['31001']?.markdown !== 'temporary remote smoke note') throw Error('second session did not read updated learning record');
  const blocked = await fetch(url + 'api/runtime/stop', { method: 'POST', headers: { ...headers, Origin: new URL(url).origin } });
  if (blocked.status !== 403) throw Error(`remote management returned ${blocked.status}`);
  console.log('Quick Tunnel: login, both UIs, learning write, annotation, second session state, AI listing, download, and management block verified; host:', new URL(url).host);
} finally {
  await manager.stop(); await gateway.stop();
  if (server.exitCode === null) { server.send({ type: 'shutdown' }); await new Promise(resolve => server.once('exit', resolve)); }
  await fs.rm(dir, { recursive: true, force: true });
}
