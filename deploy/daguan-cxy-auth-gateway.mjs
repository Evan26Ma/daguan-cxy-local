import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HOST = process.env.CXY_AUTH_HOST || "127.0.0.1";
const PORT = Number(process.env.CXY_AUTH_PORT || 18090);
const UPSTREAM = new URL(process.env.CXY_AUTH_UPSTREAM || "http://127.0.0.1:8080");
const TOKEN_FILE = process.env.CXY_AUTH_TOKEN_FILE || "/etc/daguan-cxy-auth/token";
const SECRET_FILE = process.env.CXY_AUTH_SECRET_FILE || "/var/lib/daguan-cxy-auth/cookie-secret";
const TRUST_DAYS = Math.max(1, Number(process.env.CXY_AUTH_TRUST_DAYS || 180));
const COOKIE_NAME = "daguan_cxy_trusted_device";
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

function readOrCreate(file, create) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value) return value;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const value = create();
  fs.writeFileSync(file, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  return value;
}

const ACCESS_TOKEN = readOrCreate(TOKEN_FILE, () => crypto.randomBytes(32).toString("base64url"));
const COOKIE_SECRET = readOrCreate(SECRET_FILE, () => crypto.randomBytes(48).toString("base64url"));

function equal(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(value) { return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("base64url"); }
function trustedCookie() {
  const expires = Math.floor(Date.now() / 1000) + TRUST_DAYS * 86400;
  const payload = `v1.${expires}.${crypto.randomBytes(18).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}
function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? ["", ""] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([name]) => name));
}
function isTrusted(request) {
  const value = cookies(request)[COOKIE_NAME];
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const payload = parts.slice(0, 3).join(".");
  return Number(parts[1]) > Date.now() / 1000 && equal(parts[3], sign(payload));
}
function safeNext(value) {
  const target = String(value || "/");
  return target.startsWith("/") && !target.startsWith("//") ? target : "/";
}
function headers(type) {
  return { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function loginPage(next = "/", error = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>信任设备 · 大观园</title><style>:root{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;color:#182230;background:#f3f6fa}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:20px}main{width:min(100%,420px);padding:30px;background:#fff;border:1px solid #dce3ec;border-radius:18px;box-shadow:0 20px 50px #1f37501f}h1{margin:0 0 10px;font-size:24px}.lead{color:#526173;line-height:1.6}.error{padding:10px;border-radius:9px;background:#fff0f0;color:#9f1d1d}label{display:block;margin:18px 0 8px;font-weight:700}input,button{width:100%;min-height:46px;padding:10px 13px;border-radius:10px;font:inherit}input{border:1px solid #aab7c6}button{margin-top:14px;border:0;background:#155eef;color:#fff;font-weight:750}small{display:block;margin-top:16px;color:#667587;line-height:1.5}</style></head><body><main><h1>信任这台设备</h1><p class="lead">首次输入访问 Token 后，本浏览器 ${TRUST_DAYS} 天内不再重复认证。</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}<form method="post" action="/_auth/login"><input type="hidden" name="next" value="${escapeHtml(safeNext(next))}"><label for="token">访问 Token</label><input id="token" name="token" type="password" autocomplete="current-password" required autofocus><button type="submit">信任此设备</button></form><small>只在自己的设备上使用。清除 Cookie 后需要重新信任。</small></main></body></html>`;
}
async function form(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
function clientKey(request) { return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim(); }
function failed(request) {
  const now = Date.now();
  const key = clientKey(request);
  const current = failures.get(key);
  if (!current || now - current.startedAt > FAILURE_WINDOW_MS) {
    const next = { count: 0, startedAt: now };
    failures.set(key, next);
    return next;
  }
  return current;
}
function redirect(response, location, extra = {}) { response.writeHead(303, { location, ...headers("text/plain; charset=utf-8"), ...extra }); response.end(); }
function proxy(request, response) {
  const requestHeaders = { ...request.headers, host: UPSTREAM.host };
  delete requestHeaders.cookie;
  const upstream = http.request({ protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: request.method, path: request.url, headers: requestHeaders }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, headers("text/plain; charset=utf-8")); response.end("上游服务暂时不可用"); });
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/_auth/health") { response.writeHead(200, headers("text/plain; charset=utf-8")); response.end("ok"); return; }
    if (url.pathname === "/_auth/login" && request.method === "GET") {
      if (isTrusted(request)) return redirect(response, safeNext(url.searchParams.get("next")));
      response.writeHead(200, headers("text/html; charset=utf-8")); response.end(loginPage(url.searchParams.get("next") || "/")); return;
    }
    if (url.pathname === "/_auth/login" && request.method === "POST") {
      const state = failed(request);
      if (state.count >= MAX_FAILURES) { response.writeHead(429, { ...headers("text/plain; charset=utf-8"), "retry-after": "900" }); response.end("尝试次数过多，请稍后再试"); return; }
      const incoming = await form(request);
      const next = safeNext(incoming.get("next"));
      if (!equal(incoming.get("token") || "", ACCESS_TOKEN)) { state.count += 1; response.writeHead(401, headers("text/html; charset=utf-8")); response.end(loginPage(next, "Token 不正确，请重新输入。")); return; }
      failures.delete(clientKey(request));
      redirect(response, next, { "set-cookie": `${COOKIE_NAME}=${trustedCookie()}; Path=/; Max-Age=${TRUST_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` });
      return;
    }
    if (url.pathname === "/_auth/logout" && request.method === "POST") { redirect(response, "/_auth/login", { "set-cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` }); return; }
    if (!isTrusted(request)) {
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) return redirect(response, `/_auth/login?next=${encodeURIComponent(safeNext(request.url))}`);
      response.writeHead(401, headers("application/json; charset=utf-8")); response.end(JSON.stringify({ ok: false, message: "设备尚未信任" })); return;
    }
    proxy(request, response);
  } catch (error) { response.writeHead(500, headers("text/plain; charset=utf-8")); response.end(error?.message || "认证服务错误"); }
});
server.listen(PORT, HOST, () => console.log(`Daguan trusted-device gateway listening on http://${HOST}:${PORT}`));
