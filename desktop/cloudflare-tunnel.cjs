const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const API = 'https://api.cloudflare.com/client/v4';
function cloudflareError(data, fallback) { return (data?.errors || []).map(e => e.message).filter(Boolean).join('；') || fallback; }
async function apiRequest(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(API + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success !== true) throw Error(cloudflareError(data, `Cloudflare API HTTP ${response.status}`));
  return data.result;
}
function validateSetup({ accountId, zoneId, zone, subdomain, apiToken }) {
  if (![accountId, zoneId].every(v => /^[a-f0-9]{32}$/i.test(String(v || '')))) throw Error('Account ID 和 Zone ID 应为 32 位十六进制');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(String(zone || '')) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(subdomain || ''))) throw Error('请输入有效的域名和单级子域名');
  if (!apiToken || typeof apiToken !== 'string') throw Error('请输入限权 Cloudflare API 令牌');
  return `${subdomain.toLowerCase()}.${zone.toLowerCase()}`;
}
function locateCloudflared(userData) {
  const candidates = [path.join(userData, 'cloudflared.exe'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe')].filter(Boolean);
  for (const candidate of candidates) { try { if (require('node:fs').statSync(candidate).isFile()) return candidate; } catch {} }
  const found = spawnSync('where.exe', ['cloudflared.exe'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  return found.status === 0 ? found.stdout.split(/\r?\n/).find(Boolean) : null;
}
async function downloadCloudflared(userData, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DaguanMath' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`无法读取 Cloudflare 官方发布信息：HTTP ${response.status}`);
  const release = await response.json();
  const asset = release.assets?.find(a => a.name === 'cloudflared-windows-amd64.exe');
  if (!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !/^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\//.test(asset.browser_download_url || '')) throw Error('官方发布信息缺少可验证的 Windows 程序');
  const exe = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
  if (!exe.ok) throw Error(`下载失败：HTTP ${exe.status}`);
  const bytes = Buffer.from(await exe.arrayBuffer());
  if (bytes.length < 1_000_000 || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.digest.slice(7).toLowerCase()) throw Error('cloudflared 校验值不匹配');
  await fs.mkdir(userData, { recursive: true });
  const temp = path.join(userData, `cloudflared-${crypto.randomUUID()}.exe`);
  await fs.writeFile(temp, bytes, { flag: 'wx' });
  const destination = path.join(userData, 'cloudflared.exe');
  await fs.rename(temp, destination);
  return destination;
}
function createTunnelManager({ userData, gateway, encrypt, decrypt, fetchImpl = fetch, probeFetch = fetch, spawnImpl = spawn, findBinary = locateCloudflared }) {
  const file = path.join(userData, 'remote-tunnel.json');
  let config = null, child = null, mode = 'off', state = 'stopped', url = '', error = '', phase = '', restartTimer = null, stopping = false, restartDelay = 5000;
  const status = () => ({ mode, state, url, error, phase, configured: Boolean(config), enabled: Boolean(config?.enabled), hostname: config?.hostname || '', binary: findBinary(userData) || '' });
  async function save(next) {
    await fs.mkdir(userData, { recursive: true });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file); config = next;
  }
  async function init() {
    try { const parsed = JSON.parse(await fs.readFile(file, 'utf8')); if (parsed.version === 1 && parsed.token && parsed.hostname && parsed.port) config = parsed; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async function stop() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer); restartTimer = null;
    if (child) {
      const current = child; child = null;
      await new Promise(resolve => { const timer = setTimeout(() => { try { current.kill(); } catch {} resolve(); }, 4000); current.once('exit', () => { clearTimeout(timer); resolve(); }); try { current.kill(); } catch { clearTimeout(timer); resolve(); } });
    }
    mode = 'off'; state = 'stopped'; url = ''; error = ''; phase = ''; restartDelay = 5000; gateway.setPublicHost(null);
    stopping = false;
  }
  function launch(nextMode, args, host, token) {
    const binary = findBinary(userData);
    if (!binary) throw Error('找不到 cloudflared，请先下载');
    mode = nextMode; state = 'connecting'; error = ''; phase = nextMode === 'quick' ? '正在申请临时地址' : '正在连接 Cloudflare'; url = nextMode === 'named' ? `https://${host}/` : '';
    gateway.setPublicHost(host);
    let buffer = '';
    const privateHome = path.join(userData, 'cloudflared-home');
    fsSync.mkdirSync(privateHome, { recursive: true });
    const env = { ...process.env, HOME: privateHome, USERPROFILE: privateHome, ...(token ? { TUNNEL_TOKEN: token } : {}) };
    const proc = spawnImpl(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd: userData });
    child = proc;
    let probeRunning = false, registered = false;
    const probePublic = async () => {
      if (probeRunning || !url) return;
      probeRunning = true; state = 'connecting'; phase = '正在验证公网登录页';
      const slowAt = Date.now() + 90000;
      while (child === proc) {
        try {
          const response = await probeFetch(url + '__remote/login', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          if (response.status === 200 && child === proc) { state = 'connected'; phase = '公网登录页可访问'; error = ''; restartDelay = 5000; probeRunning = false; return; }
        } catch {}
        if (Date.now() > slowAt) { phase = '等待 DNS 生效，持续重试'; error = '公网登录页暂时不可达，请检查域名 DNS 和网络'; }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      probeRunning = false;
    };
    const onOutput = chunk => {
      const line = String(chunk);
      buffer = (buffer + line).slice(-12000);
      if (nextMode === 'quick') {
        const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
        if (match && url !== match[0] + '/') { url = match[0] + '/'; gateway.setPublicHost(new URL(url).host); if (registered) void probePublic(); }
      }
      if (/Unregistered tunnel connection|connection closed|Retrying connection|Unable to establish|Serve tunnel error/i.test(line)) { state = 'connecting'; phase = '连接中断，正在重试'; }
      else if (/Registered tunnel connection|Connection .* registered/i.test(line)) {
        registered = true;
        void probePublic();
      }
    };
    proc.stdout?.on('data', onOutput); proc.stderr?.on('data', onOutput);
    proc.once('error', e => { if (child !== proc) return; error = e.message; state = 'error'; phase = '连接程序启动失败'; gateway.setPublicHost(null); });
    proc.once('exit', code => {
      if (child !== proc) return;
      child = null; state = 'error'; phase = '连接程序已退出'; error = `cloudflared 已退出（${code ?? '信号'}）`; url = ''; gateway.setPublicHost(null);
      if (!stopping && nextMode === 'named' && config?.enabled) {
        const delay = restartDelay; restartDelay = Math.min(restartDelay * 2, 60000);
        restartTimer = setTimeout(() => { void startNamed().catch(e => { error = e.message; state = 'error'; }); }, delay);
      }
    });
  }
  async function startQuick() {
    if (!gateway.hasPassword()) throw Error('请先设置访问密码');
    if (mode !== 'off') await stop();
    const port = await gateway.start();
    // Keep cloudflared away from the user's ~/.cloudflared/config.yaml.
    launch('quick', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], null, null);
    return status();
  }
  async function startNamed() {
    if (!config?.enabled) throw Error('固定地址尚未启用');
    if (!gateway.hasPassword()) throw Error('请先设置访问密码');
    if (mode !== 'off' && (child || mode !== 'named')) await stop();
    try {
      const port = await gateway.start();
      if (port !== config.port) { await gateway.stop(); throw Error('固定地址的本机端口被占用，请关闭占用进程后重试'); }
      const token = decrypt(Buffer.from(config.token, 'base64'));
      launch('named', ['tunnel', '--no-autoupdate', 'run'], config.hostname, token);
      return status();
    } catch (e) { mode = 'named'; state = 'error'; phase = '启动连接失败'; error = e.message; throw e; }
  }
  async function setupNamed(input) {
    if (!gateway.hasPassword()) throw Error('请先设置访问密码');
    if (config) throw Error('已有固定地址配置，请先停用；更换域名暂不自动覆盖 Cloudflare 资源');
    if (!findBinary(userData)) throw Error('请先下载 cloudflared');
    const hostname = validateSetup(input);
    const accountId = input.accountId.toLowerCase(), zoneId = input.zoneId.toLowerCase();
    phase = '检查本机网关';
    const port = await gateway.start();
    let tunnelId = null, dnsId = null;
    try {
      phase = '创建 Cloudflare Tunnel';
      const created = await apiRequest(fetchImpl, input.apiToken, 'POST', `/accounts/${accountId}/cfd_tunnel`, { name: `daguan-${crypto.randomBytes(5).toString('hex')}`, config_src: 'cloudflare' });
      tunnelId = created.id;
      if (!/^[a-f0-9-]{36}$/i.test(tunnelId || '') || !created.token) throw Error('Cloudflare 未返回有效的 Tunnel ID 和运行令牌');
      phase = '设置公网路由';
      await apiRequest(fetchImpl, input.apiToken, 'PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}`, originRequest: {} }, { service: 'http_status:404' }] } });
      phase = '添加 DNS 记录';
      const dns = await apiRequest(fetchImpl, input.apiToken, 'POST', `/zones/${zoneId}/dns_records`, { type: 'CNAME', proxied: true, name: hostname, content: `${tunnelId}.cfargotunnel.com` });
      dnsId = dns.id;
      phase = '保存运行配置';
      await save({ version: 1, accountId, zoneId, hostname, tunnelId, port, token: encrypt(created.token).toString('base64'), enabled: true });
      await startNamed();
      return status();
    } catch (e) {
      const failedPhase = phase;
      phase = failedPhase; state = 'error'; error = e.message;
      if (!config) {
        const leftovers = [];
        if (dnsId) await apiRequest(fetchImpl, input.apiToken, 'DELETE', `/zones/${zoneId}/dns_records/${dnsId}`).catch(() => leftovers.push(`DNS ${dnsId}`));
        if (tunnelId) await apiRequest(fetchImpl, input.apiToken, 'DELETE', `/accounts/${accountId}/cfd_tunnel/${tunnelId}`).catch(() => leftovers.push(`Tunnel ${tunnelId}`));
        if (leftovers.length) throw Error(`${e.message}；Cloudflare 自动清理失败，请在控制台检查并删除：${leftovers.join('、')}`);
      }
      throw e;
    }
  }
  async function disableNamed() { await stop(); if (config) await save({ ...config, enabled: false }); }
  async function enableNamed() { if (!config) throw Error('尚未配置固定地址'); await save({ ...config, enabled: true }); return startNamed(); }
  return { init, status, startQuick, startNamed, setupNamed, disableNamed, enableNamed, stop, download: () => downloadCloudflared(userData, fetchImpl), hasNamed: () => Boolean(config), namedEnabled: () => Boolean(config?.enabled), gatewayPort: () => config?.port || 0 };
}
module.exports = { createTunnelManager, locateCloudflared, downloadCloudflared, validateSetup, apiRequest };
