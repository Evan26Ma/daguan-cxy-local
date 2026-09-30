const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const COOKIE = 'daguan_remote_session';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const BLOCKED = new Set(['/api/runtime/stop', '/api/catalog/refresh']);
const LOGIN_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>大观园 · 远程登录</title><style>body{font:16px system-ui,"Microsoft YaHei",sans-serif;background:#f6f2e9;color:#282522;display:grid;place-items:center;min-height:100vh;margin:0}main{background:white;border:1px solid #e5ddd0;border-radius:18px;padding:32px;width:min(360px,calc(100vw - 48px));box-shadow:0 12px 36px #0001}h1{font-size:24px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:12px;border-radius:9px;font:inherit}input{border:1px solid #bdb5a9}button{background:#c53d30;color:white;border:0;cursor:pointer}p{color:#9c251e;min-height:1.4em}</style><main><h1>大观园远程访问</h1><form id="login"><label for="password">访问密码</label><input id="password" type="password" autocomplete="current-password" required><button>登录</button><p id="message" role="alert"></p></form></main><script>document.getElementById('login').onsubmit=async e=>{e.preventDefault();const p=document.getElementById('password'),m=document.getElementById('message');m.textContent='';try{const r=await fetch('/__remote/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})});p.value='';if(!r.ok){m.textContent=r.status===429?'尝试过于频繁，请稍后重试':'密码错误';return}location.replace('/index.html')}catch{m.textContent='暂时无法连接'}};</script></html>`;

function equal(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function json(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function normalizePath(raw) {
  try {
    const pathname = new URL(raw, 'http://localhost').pathname;
    const decoded = decodeURIComponent(pathname).replace(/\\/g, '/');
    if (decoded.includes('\0') || decoded.split('/').includes('..') || /\/\//.test(decoded)) return null;
    return decoded.toLowerCase().replace(/\/+$/, '') || '/';
  } catch { return null; }
}
function blockedPath(p) {
  return !p || p.startsWith('/__remote') && !['/__remote/login', '/__remote/logout', '/__remote/status'].includes(p)
    || BLOCKED.has(p) || p.startsWith('/api/runtime/stop/') || p.startsWith('/api/catalog/refresh/')
    || p.startsWith('/api/tunnel') || p.startsWith('/api/remote') || p.startsWith('/api/admin');
}
async function loadAuth(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed.version === 1 && /^[a-f0-9]{32}$/.test(parsed.salt) && /^[a-f0-9]{128}$/.test(parsed.hash) && /^[a-f0-9]{64}$/.test(parsed.secret)) return parsed;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return null;
}
async function writeAuth(file, auth) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(auth), { mode: 0o600, flag: 'wx' });
  await fs.rename(tmp, file);
}

function createRemoteGateway({ authFile, upstream, port = 0, getMode = () => 'quick' }) {
  let auth = null, server = null, publicHost = null;
  const attempts = new Map();
  let globalFailures = 0, globalWindow = Date.now(), globalBlockedUntil = 0;
  function validSession(req) {
    if (!auth) return false;
    const cookies = String(req.headers.cookie || '').split(';').map(item => item.trim());
    const value = cookies.find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!value) return false;
    const [expiry, nonce, signature] = value.split('.');
    if (!/^\d+$/.test(expiry || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
    if (Number(expiry) < Date.now() || Number(expiry) > Date.now() + SESSION_AGE + 60000) return false;
    const expected = crypto.createHmac('sha256', auth.secret).update(`${expiry}.${nonce}`).digest('hex');
    return equal(signature, expected);
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || !publicHost) return false;
    try { const url = new URL(origin); return url.protocol === 'https:' && url.host.toLowerCase() === publicHost; }
    catch { return false; }
  }
  function sessionCookie() {
    const expiry = Date.now() + SESSION_AGE;
    const nonce = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', auth.secret).update(`${expiry}.${nonce}`).digest('hex');
    return `${COOKIE}=${expiry}.${nonce}.${sig}; Max-Age=${SESSION_AGE / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  }
  async function login(req, res) {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
    if (Date.now() - globalWindow > 15 * 60_000) { globalWindow = Date.now(); globalFailures = 0; globalBlockedUntil = 0; }
    if (globalBlockedUntil > Date.now()) return json(res, 429, { error: 'Too many attempts' }, { 'Retry-After': String(Math.ceil((globalBlockedUntil - Date.now()) / 1000)) });
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').slice(0, 128);
    const state = attempts.get(ip) || { failures: 0, until: 0 };
    if (state.until > Date.now()) return json(res, 429, { error: 'Too many attempts' }, { 'Retry-After': String(Math.ceil((state.until - Date.now()) / 1000)) });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res, 413, { error: 'Too large' }); }
    let password = '';
    try { password = JSON.parse(body).password; } catch {}
    if (!auth || typeof password !== 'string' || !equal(hashPassword(password, auth.salt), auth.hash)) {
      globalFailures += 1;
      if (globalFailures >= 20) globalBlockedUntil = Date.now() + 15 * 60_000;
      state.failures += 1;
      if (state.failures >= 5) { state.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(5, state.failures - 5)); }
      attempts.set(ip, state);
      return json(res, state.until > Date.now() || globalBlockedUntil > Date.now() ? 429 : 401, { error: 'Invalid password' });
    }
    attempts.delete(ip); globalFailures = 0; globalBlockedUntil = 0;
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie() });
  }
  function proxy(req, res, bufferAi = false) {
    let target;
    try { target = new URL(upstream()); if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw Error('invalid upstream'); }
    catch { return json(res, 503, { error: 'Local service unavailable' }); }
    const headers = { ...req.headers, host: target.host };
    for (const name of ['cookie', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'connection', 'proxy-connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']) delete headers[name];
    const forward = http.request({ hostname: '127.0.0.1', port: target.port, path: req.url, method: req.method, headers }, response => {
      const responseHeaders = { ...response.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
      for (const name of ['set-cookie', 'connection', 'proxy-connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']) delete responseHeaders[name];
      if (bufferAi && response.statusCode === 200) {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { forward.destroy(); if (!res.headersSent) json(res, 502, { error: 'AI 回答超过远程传输上限' }); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (res.headersSent) return;
          delete responseHeaders['content-length'];
          responseHeaders['content-type'] = 'text/plain; charset=utf-8';
          res.writeHead(200, responseHeaders); res.end(Buffer.concat(chunks));
        });
        return;
      }
      res.writeHead(response.statusCode || 502, responseHeaders); response.pipe(res);
    });
    forward.on('error', () => { if (!res.headersSent) json(res, 503, { error: 'Local service unavailable' }); else res.destroy(); });
    req.pipe(forward);
  }
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const host = String(req.headers.host || '').toLowerCase();
    if (!publicHost || host !== publicHost) return json(res, 421, { error: 'Unknown hostname' });
    const p = normalizePath(req.url);
    if (blockedPath(p)) return json(res, 403, { error: 'Forbidden' });
    if (p === '/__remote/login' && req.method === 'POST') return login(req, res);
    if (p === '/__remote/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` });
    }
    if (p === '/__remote/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'" }); return res.end(LOGIN_HTML); }
    if (!validSession(req)) {
      if (req.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/data/')) { res.writeHead(302, { Location: '/__remote/login', 'Cache-Control': 'no-store' }); return res.end(); }
      return json(res, 401, { error: 'Login required' });
    }
    if (p === '/__remote/status') return json(res, 200, { mode: getMode(), authenticated: true });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
    if (p === '/service-worker.js') return json(res, 404, { error: 'Unavailable remotely' });
    if (getMode() === 'quick' && p === '/api/state/events') return json(res, 404, { error: 'Use polling' });
    proxy(req, res, getMode() === 'quick' && p === '/api/ai/chat');
  }
  return {
    async init() { auth = await loadAuth(authFile); },
    hasPassword() { return Boolean(auth); },
    async setPassword(password, oldPassword) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw Error('访问密码至少 12 位，最多 256 位');
      if (auth && (!oldPassword || !equal(hashPassword(oldPassword, auth.salt), auth.hash))) throw Error('原密码不正确');
      const salt = crypto.randomBytes(16).toString('hex');
      const next = { version: 1, salt, hash: hashPassword(password, salt), secret: crypto.randomBytes(32).toString('hex') };
      await writeAuth(authFile, next); auth = next; attempts.clear(); globalFailures = 0; globalBlockedUntil = 0;
    },
    async revokeSessions() { if (!auth) throw Error('请先设置访问密码'); const next = { ...auth, secret: crypto.randomBytes(32).toString('hex') }; await writeAuth(authFile, next); auth = next; },
    setPublicHost(host) { publicHost = host ? String(host).toLowerCase() : null; },
    getPublicHost() { return publicHost; },
    async start() {
      if (server) return server.address().port;
      server = http.createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: 'Gateway error' }); else res.destroy(); }); });
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
      catch (error) { server = null; throw error; }
      return server.address().port;
    },
    async stop() { if (!server) return; const current = server; server = null; current.closeAllConnections(); await new Promise(resolve => current.close(resolve)); },
  };
}
module.exports = { createRemoteGateway, normalizePath, blockedPath, SESSION_AGE };
