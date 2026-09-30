// Manual isolated Electron smoke: start Electron with fresh DAGUAN_DATA_DIR and
// DAGUAN_USER_DATA_DIR plus --remote-debugging-port=9228, then run this file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const port = Number(process.argv.find((arg, index) => index >= 2 && /^\d+$/.test(arg)) || 9228);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith('daguan://app/'));
if (!page) throw Error('No isolated Daguan Electron page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = event => { const message = JSON.parse(event.data); if (!message.id) return; const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); };
function command(method, params) { return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); }); }
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text || 'renderer exception');
  return result.result.value;
}
try {
  await evaluate('App.showSettings(); true');
  const card = await evaluate('({title:document.getElementById("remote-title")?.textContent,button:document.getElementById("remote-quick")?.textContent})');
  assert.equal(card.title, '外网浏览器访问');
  assert.equal(card.button, '开启临时地址');
  if (process.argv.includes('--snapshot-only')) {
    const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const output = path.join(os.tmpdir(), 'daguan-remote-settings-smoke.png');
    await fs.writeFile(output, Buffer.from(capture.data, 'base64'));
    console.log(output);
    process.exitCode = 0;
  } else {
  let status = await evaluate('window.daguanDesktop.remoteAccess("status")');
  if (!status.passwordSet) status = await evaluate('window.daguanDesktop.remoteAccess("password", {password:"temporary-electron-smoke-password-492"})');
  assert.equal(status.passwordSet, true);
  status = await evaluate('window.daguanDesktop.remoteAccess("quick:start")');
  assert.equal(status.mode, 'quick');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !(status.state === 'connected' && status.url)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await evaluate('window.daguanDesktop.remoteAccess("status")');
  }
  assert.equal(status.state, 'connected', status.error || 'Quick Tunnel did not connect');
  const remote = status.url;
  let login;
  const publicDeadline = Date.now() + 60000;
  while (Date.now() < publicDeadline) {
    try { login = await fetch(remote + '__remote/login', { signal: AbortSignal.timeout(5000) }); if (login.status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(login?.status, 200, `Quick Tunnel URL was not publicly reachable: ${remote}`);
  const denied = await fetch(remote + 'api/state'); assert.equal(denied.status, 401);
  const signed = await fetch(remote + '__remote/login', { method: 'POST', headers: { Origin: new URL(remote).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'temporary-electron-smoke-password-492' }) });
  assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie').split(';')[0];
  for (const route of ['index.html', 'legacy.html', 'api/state', 'api/ai/profiles']) {
    const response = await fetch(remote + route, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, route);
  }
  const blocked = await fetch(remote + 'api/runtime/stop', { method: 'POST', headers: { Cookie: cookie, Origin: new URL(remote).origin } });
  assert.equal(blocked.status, 403);
  console.log('Electron UI, password IPC, Quick Tunnel, both web UIs, state/AI API and management block verified.');
  }
} finally {
  await evaluate('window.daguanDesktop.remoteAccess("stop")').catch(() => {});
  socket.close();
}
