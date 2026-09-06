(function installBridge() {
  "use strict";

  if (globalThis.__daguanDataBridgeInstalled) return;
  globalThis.__daguanDataBridgeInstalled = true;

  const EXPECTED_HOST = "www.cxyonly.fans";
  const previews = new Map();
  const MAX_PREVIEWS = 3;
  let csrfTokenMemory = null;

  function ensureSite() {
    if (
      location.protocol !== "https:" ||
      location.hostname !== EXPECTED_HOST ||
      !location.pathname.startsWith("/math")
    ) {
      throw new Error("请在大观园数学题库原站页面使用此扩展");
    }
  }

  function getToken() {
    const token =
      localStorage.getItem("daguan_token") || localStorage.getItem("token");
    if (!token) throw new Error("没有检测到登录状态，请重新登录原站");
    return token;
  }

  function getCsrfToken() {
    return csrfTokenMemory || localStorage.getItem("csrf_token");
  }

  async function refreshCsrfToken() {
    const response = await fetch("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${getToken()}`
      }
    });
    if (!response.ok) return null;
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    const csrfToken = data?.data?.csrf_token || data?.csrf_token;
    if (typeof csrfToken !== "string" || !csrfToken) return null;
    csrfTokenMemory = csrfToken;
    return csrfToken;
  }

  function isCsrfError(detail) {
    const normalized = String(detail || "").toLowerCase();
    return (
      normalized === "missing csrf token" ||
      normalized === "invalid csrf token" ||
      normalized.includes("csrf token invalid")
    );
  }

  function updatePanel(text, error = false) {
    let panel = document.getElementById("daguan-data-bridge-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "daguan-data-bridge-panel";
      Object.assign(panel.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "2147483647",
        width: "340px",
        padding: "16px 18px",
        borderRadius: "12px",
        background: "#172033",
        color: "#fff",
        boxShadow: "0 12px 36px rgba(0,0,0,.28)",
        fontFamily: '"Microsoft YaHei",system-ui,sans-serif',
        fontSize: "14px",
        lineHeight: "1.6",
        whiteSpace: "pre-line"
      });
      document.body.appendChild(panel);
    }
    panel.style.background = error ? "#7f1d1d" : "#172033";
    panel.textContent = text;
    chrome.runtime
      .sendMessage({ type: "daguan-data-bridge-progress", text, error })
      .catch(() => {});
  }

  async function apiRequest(path, options = {}, csrfRetry = true) {
    const method = String(options.method || "GET").toUpperCase();
    const mutating =
      method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const csrfToken = mutating
      ? getCsrfToken() || (await refreshCsrfToken())
      : null;
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail =
        data?.detail || data?.message || data?.error || `HTTP ${response.status}`;
      if (response.status === 403 && csrfRetry && isCsrfError(detail)) {
        const refreshed = await refreshCsrfToken();
        if (refreshed) {
          return apiRequest(
            path,
            {
              ...options,
              headers: {
                ...(options.headers || {}),
                "X-CSRF-Token": refreshed
              }
            },
            false
          );
        }
      }
      const error = new Error(`${path}: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function pageBody(payload) {
    if (payload?.data && typeof payload.data === "object") return payload.data;
    return payload;
  }

  function pageItems(payload) {
    const body = pageBody(payload);
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.items)) return body.items;
    if (Array.isArray(body?.results)) return body.results;
    return [];
  }

  function pageTotal(payload) {
    const body = pageBody(payload);
    const value = Number(body?.total ?? body?.count ?? payload?.total);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  async function fetchStatesByPages() {
    const items = [];
    const perPage = 200;
    let page = 1;
    let total = null;
    while (page <= 200) {
      updatePanel(
        `正在扫描原站题目状态：${items.length}${total == null ? "" : ` / ${total}`}`
      );
      const payload = await apiRequest(
        `/questions?page=${page}&per_page=${perPage}`
      );
      const batch = pageItems(payload);
      if (total == null) total = pageTotal(payload);
      items.push(...batch);
      if (
        !batch.length ||
        batch.length < perPage ||
        (total != null && items.length >= total)
      ) {
        break;
      }
      page += 1;
    }
    return items;
  }

  async function fetchSiteStates() {
    updatePanel("正在读取原站题目状态…");
    try {
      const payload = await apiRequest("/questions/mastery-map");
      const items = pageItems(payload);
      if (items.length) return items;
    } catch {
      // Older site versions can fall back to the paginated question endpoint.
    }
    return fetchStatesByPages();
  }

  function downloadJson(value, prefix) {
    const json = JSON.stringify(value, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `${prefix}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function rememberPreview(document, currentStates) {
    const previewId = crypto.randomUUID();
    previews.set(previewId, { document, createdAt: Date.now() });
    while (previews.size > MAX_PREVIEWS) {
      previews.delete(previews.keys().next().value);
    }
    const plan = DaguanBridgeProtocol.buildImportPlan(document, currentStates);
    return { previewId, ...plan, operations: undefined };
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function patchState(operation) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await apiRequest(`/questions/${operation.questionId}/state`, {
          method: "PATCH",
          body: JSON.stringify(operation.payload)
        });
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || (error.status !== 429 && error.status < 500)) break;
        await wait(attempt * 600);
      }
    }
    throw lastError;
  }

  async function runImport(previewId) {
    const saved = previews.get(previewId);
    if (!saved || Date.now() - saved.createdAt > 30 * 60 * 1000) {
      throw new Error("导入预览已过期，请重新选择 JSON");
    }

    const currentStates = await fetchSiteStates();
    const backup = DaguanBridgeProtocol.buildSiteBackupDocument(
      currentStates,
      location.origin
    );
    updatePanel("正在下载导入前备份…");
    downloadJson(backup, "daguan-site-marker-backup");

    const plan = DaguanBridgeProtocol.buildImportPlan(
      saved.document,
      currentStates
    );
    if (!plan.operations.length) {
      previews.delete(previewId);
      updatePanel("备份完成，没有需要写入的变化。");
      return { succeeded: 0, failed: 0, failures: [], summary: plan.summary };
    }

    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    const failures = [];
    const worker = async () => {
      while (cursor < plan.operations.length) {
        const operation = plan.operations[cursor];
        cursor += 1;
        try {
          await patchState(operation);
          succeeded += 1;
        } catch (error) {
          failures.push({
            questionId: operation.questionId,
            message: String(error?.message || error)
          });
        }
        completed += 1;
        updatePanel(
          `正在导入移动端标记：${completed} / ${plan.operations.length}\n` +
            `成功 ${succeeded}，失败 ${failures.length}`
        );
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    previews.delete(previewId);

    const finalText = failures.length
      ? `导入完成：成功 ${succeeded}，失败 ${failures.length}。\n原站导入前备份已经下载。`
      : `导入完成：成功 ${succeeded}。\n原站导入前备份已经下载。`;
    updatePanel(finalText, failures.length > 0);
    return {
      succeeded,
      failed: failures.length,
      failures: failures.slice(0, 20),
      summary: plan.summary
    };
  }

  async function handleMessage(message) {
    ensureSite();
    if (message.action === "get-sync-document") {
      const states = await fetchSiteStates();
      return DaguanBridgeProtocol.buildMobileSyncDocument(
        states,
        location.origin
      );
    }
    if (message.action === "export") {
      const output = await handleMessage({ action: "get-sync-document" });
      downloadJson(output, "daguan-to-android");
      const exportedStates = output.question_states.states.length;
      updatePanel(`导出完成：${exportedStates} 道有标记题目。\n文件不包含账号资料或登录令牌。`);
      return { exportedStates };
    }
    if (message.action === "preview-import") {
      const input = message.payload?.document;
      const document =
        input && Array.isArray(input.items)
          ? input
          : DaguanBridgeProtocol.parseImportDocument(input);
      const states = await fetchSiteStates();
      const result = rememberPreview(document, states);
      updatePanel(
        `导入预览完成：预计更新 ${result.summary.changes} 道题。\n请回到扩展确认。`
      );
      return result;
    }
    if (message.action === "apply-import") {
      return runImport(message.payload?.previewId);
    }
    throw new Error("未知操作");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "daguan-data-bridge") return false;
    handleMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        const text = String(error?.message || error);
        updatePanel(`操作失败：${text}`, true);
        sendResponse({ ok: false, error: text });
      });
    return true;
  });
})();
