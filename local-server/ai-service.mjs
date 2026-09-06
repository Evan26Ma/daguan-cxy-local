import dns from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROFILE_VERSION = 1;
const MAX_PROFILES = 12;
const MAX_HISTORY_MESSAGES = 400;
const REQUEST_TIMEOUT_MS = 90_000;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeText(value, max = 120_000) {
  return String(value ?? "").slice(0, max);
}

function profileKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default";
}

function isPrivateAddress(address) {
  const ip = net.isIP(address);
  if (ip === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (ip === 6) return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
  return false;
}

export async function validateBaseUrl(value) {
  const text = String(value || "").trim();
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error("AI API 地址必须是完整的 http:// 或 https:// 地址"); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("AI API 只支持 HTTP 或 HTTPS");
  if (parsed.username || parsed.password) throw new Error("API 地址不能内嵌账号或密码");
  if (parsed.hash) throw new Error("API 地址不能包含片段");
  const hostname = parsed.hostname.toLowerCase();
  let privateNetwork = hostname === "localhost" || hostname.endsWith(".local") || isPrivateAddress(hostname);
  if (!privateNetwork) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      privateNetwork = records.length > 0 && records.every((item) => isPrivateAddress(item.address));
    } catch {
      if (parsed.protocol === "http:") throw new Error("无法确认 HTTP 地址的网络范围；公网地址请使用 HTTPS");
    }
  }
  if (parsed.protocol === "http:" && !privateNetwork) throw new Error("公网 AI 接口必须使用 HTTPS；本机或局域网服务可以使用 HTTP");
  return parsed.toString().replace(/\/+$/, "");
}

function endpoint(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function authHeaders(profile) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (profile.key) headers.Authorization = `Bearer ${profile.key}`;
  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("AI 请求超时")), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: "error" }); }
  finally { clearTimeout(timer); }
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    active: profile.active === true,
    keyHint: profile.key ? `${profile.key.slice(0, 3)}••••${profile.key.slice(-3)}` : "未设置",
    capabilities: profile.capabilities || { text: false, vision: "unknown" },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function normalizeProfile(value, existing = {}) {
  const input = object(value);
  const profile = {
    ...existing,
    id: existing.id || String(input.id || randomUUID()),
    name: safeText(input.name || existing.name || "新 AI 服务", 80).trim() || "新 AI 服务",
    baseUrl: safeText(input.baseUrl || existing.baseUrl || "", 500).trim(),
    key: input.key === "" || input.key == null ? (existing.key || "") : safeText(input.key, 500).trim(),
    model: safeText(input.model || existing.model || "", 160).trim(),
    active: input.active == null ? existing.active === true : input.active === true,
    capabilities: { ...(existing.capabilities || {}), ...(object(input.capabilities)) },
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!profile.capabilities.vision) profile.capabilities.vision = "unknown";
  return profile;
}

function parseModels(value) {
  const body = object(value);
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : Array.isArray(value) ? value : [];
  return items.map((item) => object(item).id || object(item).name).filter(Boolean).map(String).slice(0, 500);
}

function parseChatContent(value) {
  const body = object(value);
  const choice = Array.isArray(body.choices) ? object(body.choices[0]) : {};
  const message = object(choice.message);
  return safeText(message.content || choice.text || "");
}

function writeSse(res, value) {
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

function xml(value) {
  return safeText(value, 240).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function safeSvg(spec) {
  const input = object(spec);
  const kind = String(input.kind || "function");
  const title = xml(input.title || "数学示意图");
  const width = 720;
  const height = 420;
  const points = Array.isArray(input.points) ? input.points.slice(0, 160).map((point) => [Number(point?.[0]), Number(point?.[1])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) : [];
  if (kind !== "function" && kind !== "polyline" && kind !== "vector") throw new Error("图形类型不在安全白名单中");
  if (kind === "vector" && points.length < 2) throw new Error("向量图至少需要两个点");
  if (kind !== "vector" && points.length < 2) throw new Error("示意图至少需要两个点");
  const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const sx = (x) => 70 + ((x - minX) / Math.max(1e-9, maxX - minX)) * 580;
  const sy = (y) => 350 - ((y - minY) / Math.max(1e-9, maxY - minY)) * 260;
  const polyline = points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
  const end = points[points.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><rect width="720" height="420" rx="16" fill="#fffdf9"/><text x="36" y="38" fill="#33434b" font-size="18" font-family="sans-serif">${title}</text><path d="M70 350H650M70 350V80" stroke="#aaa49a" stroke-width="1"/><polyline points="${polyline}" fill="none" stroke="#1f5364" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>${kind === "vector" ? `<circle cx="${sx(end[0]).toFixed(1)}" cy="${sy(end[1]).toFixed(1)}" r="6" fill="#bf6a4e"/>` : ""}</svg>`;
}

function sanitizeSvgMarkup(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\s(?:on[a-z]+|href|xlink:href)\s*=\s*("[^"]*"|'[^']*')/gi, (match, quoted) => /^(?:"|')\s*(?:#|data:image\/)/i.test(quoted) && !/javascript:|vbscript:|data:text/i.test(quoted) ? match : "")
    .replace(/<\/?(?:iframe|object|embed|style|link)\b[^>]*>/gi, "");
}

async function pythonSvg(spec) {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "render_math_diagram.py");
  const command = process.env.DAGUAN_PYTHON || (process.platform === "win32" ? "python" : "python3");
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [script], { stdio: ["pipe", "pipe", "pipe"] });
    const out = []; const err = []; let size = 0; let timer;
    const fail = (error) => { clearTimeout(timer); reject(error); };
    timer = setTimeout(() => { child.kill(); fail(new Error("Python 绘图超时")); }, 10_000);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size <= 5 * 1024 * 1024) out.push(chunk); else child.kill(); });
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", (error) => fail(error));
    child.once("close", (code) => { clearTimeout(timer); if (code !== 0) return reject(new Error(Buffer.concat(err).toString("utf8").slice(0, 500) || "Python 绘图失败")); resolve(Buffer.concat(out).toString("utf8")); });
    child.stdin.end(JSON.stringify(spec));
  });
}

export function createAiService({ store }) {
  const runs = new Map();

  async function readAll() {
    const raw = object(await store.readAiProfiles());
    return Array.isArray(raw.profiles) ? raw.profiles.map((item) => normalizeProfile(item, item)) : [];
  }

  async function saveAll(profiles) {
    await store.writeAiProfiles({ version: PROFILE_VERSION, profiles: profiles.slice(0, MAX_PROFILES) });
  }

  async function getProfile(id) {
    const profile = (await readAll()).find((item) => item.id === String(id));
    if (!profile) throw new Error("AI 服务档案不存在");
    if (!profile.baseUrl) throw new Error("请先填写 AI API 地址");
    if (!profile.model) throw new Error("请先选择或填写 AI 模型");
    return { ...profile, baseUrl: await validateBaseUrl(profile.baseUrl) };
  }

  async function profiles() { return (await readAll()).map(publicProfile); }

  async function upsert(input) {
    const all = await readAll();
    const existing = input?.id ? all.find((item) => item.id === String(input.id)) : null;
    const next = normalizeProfile(input, existing || {});
    next.baseUrl = await validateBaseUrl(next.baseUrl);
    if (!next.active && !all.length) next.active = true;
    if (next.active) all.forEach((item) => { item.active = false; });
    const index = all.findIndex((item) => item.id === next.id);
    if (index >= 0) all[index] = next; else all.push(next);
    await saveAll(all);
    return publicProfile(next);
  }

  async function remove(id, clearHistory = false) {
    const all = await readAll();
    const profile = all.find((item) => item.id === String(id));
    if (!profile) throw new Error("AI 服务档案不存在");
    await saveAll(all.filter((item) => item.id !== profile.id));
    if (clearHistory) {
      const files = await store.aiHistoryFiles();
      const prefix = `${profileKey(profile.id)}--`;
      await Promise.all(files.filter((file) => file.startsWith(prefix)).map((file) => store.clearAiHistory(file.slice(0, -5))));
    }
    return { ok: true };
  }

  async function models(id) {
    const profile = await getProfile(id);
    const started = Date.now();
    const response = await fetchWithTimeout(endpoint(profile.baseUrl, "models"), { headers: authHeaders(profile) });
    const text = await response.text();
    if (!response.ok) throw new Error(`模型列表失败（HTTP ${response.status}）`);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("模型列表返回的不是 JSON"); }
    return { models: parseModels(parsed), status: response.status, latencyMs: Date.now() - started };
  }

  async function test(id, kind = "text") {
    const all = await readAll();
    const profile = await getProfile(id);
    const started = Date.now();
    let content;
    const user = kind === "vision"
      ? [{ type: "text", text: "请只回复：视觉测试通过" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/5nR5WQAAAABJRU5ErkJggg==" } }]
      : "请只回复：文本测试通过";
    const response = await fetchWithTimeout(endpoint(profile.baseUrl, "chat/completions"), {
      method: "POST",
      headers: authHeaders(profile),
      body: JSON.stringify({ model: profile.model, messages: [{ role: "user", content: user }], stream: false, temperature: 0 }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`模型测试失败（HTTP ${response.status}）`);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("模型测试返回的不是 JSON"); }
    content = parseChatContent(parsed);
    const updated = all.map((item) => item.id === profile.id ? { ...item, capabilities: { ...(item.capabilities || {}), text: true, ...(kind === "vision" ? { vision: "passed", visionTestedAt: new Date().toISOString() } : {}) }, updatedAt: new Date().toISOString() } : item);
    await saveAll(updated);
    return { ok: true, kind, status: response.status, latencyMs: Date.now() - started, model: profile.model, response: content.slice(0, 2000), usage: parsed.usage || null };
  }

  function contextText(question, includePrivate = false) {
    const q = object(question);
    const lines = [
      `题号：${safeText(q.id, 40)}`,
      `知识路径：${safeText(q.category_path, 1000)}`,
      `来源：${safeText(q.source, 500)}`,
      `题型：${safeText(q.type, 100)}`,
      `题干：\n${safeText(q.stem)}`,
      `选项：\n${(Array.isArray(q.options) ? q.options : []).map((item) => `${safeText(item.label, 10)}. ${safeText(item.content_md)}`).join("\n") || "无"}`,
      `用户作答：${safeText(q.userAnswer || "未作答", 2000)}`,
      `标准答案：\n${safeText(q.answer)}`,
      `官方解析：\n${safeText(q.explanation)}`,
    ];
    if (includePrivate) lines.push(`本地批注：\n${safeText(q.annotation, 20_000)}`, `掌握：${safeText(q.mastery, 80)}`, `易错：${q.errorProne === true ? "是" : "否"}`, `收藏：${q.favorite === true ? "是" : "否"}`);
    return lines.join("\n\n");
  }

  async function streamChat(req, res, payload) {
    if (runs.size >= 2) throw new Error("当前已有两个 AI 任务在生成，请稍后再试");
    const profile = await getProfile(payload.profileId);
    const questionId = String(object(payload.question).id || "unknown");
    const key = `${profileKey(profile.id)}--${profileKey(questionId)}`;
    const history = object(await store.readAiHistory(key));
    const historyMessages = Array.isArray(history.messages) ? history.messages.filter((item) => item && (item.role === "user" || item.role === "assistant")).slice(-24) : [];
    const prompt = safeText(payload.prompt || "请讲解这道题。", 20_000);
    const userMessage = `${contextText(payload.question, payload.includePrivate === true)}\n\n本次请求：${prompt}`;
    const messages = [
      { role: "system", content: "你是大观园数学学习区的固定数学导师。请用中文回答，先给结论，再分步推导并说明关键理由，最后指出易错点。保留并正确使用 Markdown 与 LaTeX。需要图形时，只能在末尾输出 daguan-diagram JSON 结构，不要输出或执行任意 Python 代码。不要声称已经完成无法验证的计算。" },
      ...historyMessages.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: userMessage },
    ];
    if (profile.capabilities?.vision === "passed" && Array.isArray(payload.images) && payload.images.length) {
      messages[messages.length - 1].content = [{ type: "text", text: userMessage }, ...payload.images.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url: safeText(url, 2_000_000) } }))];
    }
    const runId = randomUUID();
    const controller = new AbortController();
    runs.set(runId, { controller });
    const timeout = setTimeout(() => controller.abort(new Error("AI 请求超时")), REQUEST_TIMEOUT_MS);
    let answer = "";
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Daguan-Run-Id": runId });
    writeSse(res, { type: "started", runId, historyTruncated: historyMessages.length >= 24 });
    const abortOnClose = () => controller.abort(new Error("浏览器已断开 AI 请求"));
    req.once("close", abortOnClose);
    try {
      const upstream = await fetch(endpoint(profile.baseUrl, "chat/completions"), {
        method: "POST",
        headers: { ...authHeaders(profile), Accept: "text/event-stream, application/json" },
        body: JSON.stringify({ model: profile.model, messages, stream: true, temperature: 0.2 }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!upstream.ok) throw new Error(`AI 请求失败（HTTP ${upstream.status}）`);
      const contentType = upstream.headers.get("content-type") || "";
      if (!upstream.body) throw new Error("AI 服务没有返回内容");
      if (contentType.includes("text/event-stream")) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const rows = buffer.split(/\r?\n/);
          buffer = rows.pop() || "";
          for (const row of rows) {
            if (!row.startsWith("data:")) continue;
            const data = row.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const delta = safeText(object(object(JSON.parse(data).choices?.[0]).delta).content);
              if (delta) { answer += delta; writeSse(res, { type: "delta", content: delta }); }
            } catch { /* ignore malformed keep-alive chunks */ }
          }
        }
      } else {
        let parsed;
        try { parsed = JSON.parse(await upstream.text()); } catch { throw new Error("AI 返回的不是 JSON"); }
        answer = parseChatContent(parsed);
        if (answer) writeSse(res, { type: "delta", content: answer });
      }
      const nextMessages = [...(Array.isArray(history.messages) ? history.messages : []), { role: "user", content: userMessage, at: new Date().toISOString() }, { role: "assistant", content: answer, at: new Date().toISOString() }].slice(-MAX_HISTORY_MESSAGES);
      await store.writeAiHistory(key, { version: 1, profileId: profile.id, questionId, messages: nextMessages, updatedAt: new Date().toISOString() });
      writeSse(res, { type: "done", runId, message: { role: "assistant", content: answer } });
    } catch (error) {
      writeSse(res, { type: "error", runId, error: error?.name === "AbortError" ? "AI 请求已停止" : safeText(error?.message || error, 500) });
    } finally {
      clearTimeout(timeout);
      req.off("close", abortOnClose);
      runs.delete(runId);
      res.end();
    }
  }

  async function conversation(profileId, questionId) {
    const key = `${profileKey(profileId)}--${profileKey(questionId)}`;
    return store.readAiHistory(key);
  }

  async function clearConversation(profileId, questionId) {
    const key = `${profileKey(profileId)}--${profileKey(questionId)}`;
    await store.clearAiHistory(key);
    return { ok: true };
  }

  async function diagram(spec) {
    const input = object(spec);
    if (input.engine === "python") {
      try { return { engine: "python", svg: sanitizeSvgMarkup(await pythonSvg(input)) }; }
      catch { /* optional enhancement: use the safe SVG fallback below */ }
    }
    return { engine: "svg", svg: safeSvg(input) };
  }

  return { profiles, upsert, remove, models, test, streamChat, conversation, clearConversation, diagram, stop: (runId) => { const run = runs.get(String(runId)); if (!run) return false; run.controller.abort(new Error("用户停止了 AI 请求")); return true; } };
}
