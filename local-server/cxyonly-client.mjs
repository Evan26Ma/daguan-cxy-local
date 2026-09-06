import { buildPushPlan, normalizeRemoteStates, pageTotal, remoteStatesDocument, unwrapPageItems } from "./sync-format.mjs";

const DEFAULT_BASE_URL = "https://www.cxyonly.fans";

function textOf(payload) {
  return payload?.detail || payload?.message || payload?.error || payload?.msg || "请求失败";
}

function tokenFrom(payload) {
  return payload?.token || payload?.access_token || payload?.accessToken || payload?.data?.token || payload?.data?.access_token || payload?.data?.accessToken || payload?.data?.data?.token || payload?.data?.data?.access_token || null;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|password|passwd|secret|authorization|cookie)/i.test(key))
    .map(([key, entry]) => [key, redactSecrets(entry)]));
}

export class CxyonlyClient {
  constructor({ store, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
    this.store = store;
    this.baseUrl = String(baseUrl).replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.csrfToken = null;
  }

  apiUrl(pathname) {
    const path = String(pathname).startsWith("/api/") ? String(pathname) : `/api${String(pathname).startsWith("/") ? pathname : `/${pathname}`}`;
    return `${this.baseUrl}${path}`;
  }

  async integration() { return this.store.readIntegration(); }

  async request(pathname, options = {}, retryCsrf = true) {
    const integration = await this.integration();
    if (!integration?.token) throw new Error("尚未配置大观园登录，请先完成配置向导");
    const method = String(options.method || "GET").toUpperCase();
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
    if (mutating && !this.csrfToken) await this.refreshCsrf();
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${integration.token}`,
      ...(this.csrfToken ? { "X-CSRF-Token": this.csrfToken } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const response = await this.fetchImpl(this.apiUrl(pathname), {
      ...options,
      headers,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error(`${pathname}: ${textOf(data) || `HTTP ${response.status}`}`);
      error.status = response.status;
      if (response.status === 401) error.code = "AUTH_EXPIRED";
      if (response.status === 403 && retryCsrf && /csrf/i.test(error.message)) {
        this.csrfToken = null;
        await this.refreshCsrf();
        return this.request(pathname, options, false);
      }
      throw error;
    }
    return data;
  }

  async refreshCsrf() {
    const integration = await this.integration();
    if (!integration?.token) return null;
    const response = await this.fetchImpl(this.apiUrl("/auth/csrf"), {
      headers: { Accept: "application/json", Authorization: `Bearer ${integration.token}` },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) return null;
    this.csrfToken = data?.data?.csrf_token || data?.csrf_token || null;
    return this.csrfToken;
  }

  async login(credentials = {}) {
    const payload = credentials.payload && typeof credentials.payload === "object"
      ? credentials.payload
      : credentials.code
        ? { verification_code: String(credentials.code).trim(), login_mode: "new" }
        : Object.fromEntries(Object.entries({
            username: credentials.username,
            password: credentials.password,
          }).filter(([, value]) => value != null && String(value) !== ""));
    if (!Object.keys(payload).length) throw new Error("请输入登录码或账号信息");
    const response = await this.fetchImpl(this.apiUrl("/auth/login"), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(textOf(data) || `登录失败（HTTP ${response.status}）`);
    const token = tokenFrom(data);
    if (!token) throw new Error("登录成功响应中没有找到 Token，请检查大观园登录接口格式");
    const previous = await this.integration();
    const profile = await this.fetchImpl(this.apiUrl("/auth/me"), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    const profileText = await profile.text();
    let profileData = null;
    try { profileData = profileText ? JSON.parse(profileText) : null; } catch { profileData = null; }
    if (!profile.ok) throw new Error(textOf(profileData) || "Token 校验失败");
    const safeProfile = redactSecrets(profileData?.user || profileData?.data || profileData);
    await this.store.writeIntegration({
      format: "daguan-cxyonly-integration",
      version: 1,
      base_url: this.baseUrl,
      token,
      profile: safeProfile,
      logged_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(previous?.last_pull_at ? { last_pull_at: previous.last_pull_at } : {}),
      ...(previous?.last_push_at ? { last_push_at: previous.last_push_at } : {}),
    });
    this.csrfToken = null;
    if (typeof data?.csrf_token === "string" && data.csrf_token) this.csrfToken = data.csrf_token;
    return { profile: safeProfile };
  }

  async status() {
    const integration = await this.integration();
    if (!integration?.token) return { configured: false, authenticated: false };
    try {
      const data = await this.request("/auth/me");
      return { configured: true, authenticated: true, profile: redactSecrets(data?.data || data), lastPullAt: integration.last_pull_at || null, lastPushAt: integration.last_push_at || null };
    } catch (error) {
      return { configured: true, authenticated: false, error: error.message, code: error.code || null };
    }
  }

  async fetchStates() {
    let payload;
    try {
      payload = await this.request("/api/questions/mastery-map");
      const direct = normalizeRemoteStates(unwrapPageItems(payload));
      if (direct.length) return direct;
    } catch (error) {
      if (error.code === "AUTH_EXPIRED") throw error;
    }
    const items = [];
    const perPage = 200;
    for (let page = 1; page <= 200; page += 1) {
      const response = await this.request(`/api/questions?page=${page}&per_page=${perPage}`);
      const batch = unwrapPageItems(response);
      items.push(...batch);
      const total = pageTotal(response);
      if (!batch.length || batch.length < perPage || (total != null && items.length >= total)) break;
    }
    const states = normalizeRemoteStates(items);
    if (!states.length) throw new Error("大观园接口没有返回可识别的掌握状态");
    return states;
  }

  async pullDocument() {
    const states = await this.fetchStates();
    return { states, document: remoteStatesDocument(states) };
  }

  async fetchActivityCalendar(limit = 400) {
    try {
      const payload = await this.request(`/api/user/activity_calendar?limit=${Math.max(1, Math.min(400, Number(limit) || 400))}`);
      return payload?.data || payload;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async fetchLastStudy() {
    try {
      const payload = await this.request("/api/questions/user/last_study");
      return payload?.data || payload;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async saveLastStudy(value) {
    if (!value || typeof value !== "object") return null;
    try {
      const payload = await this.request("/api/questions/user/last_study", {
        method: "POST",
        body: JSON.stringify(value),
      });
      return payload?.data || payload;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async fetchRemoteSnapshot() {
    const [document, activity, lastStudy] = await Promise.all([
      this.pullDocument(),
      this.fetchActivityCalendar(),
      this.fetchLastStudy(),
    ]);
    return { ...document, activity, lastStudy };
  }

  async pushPreview(localState, knownIds = null) {
    const { states } = await this.pullDocument();
    return buildPushPlan(localState, states, knownIds);
  }

  async patchState(operation) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.request(`/api/questions/${operation.questionId}/state`, {
          method: "PATCH",
          body: JSON.stringify(operation.payload),
        });
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || (error.status !== 429 && (!error.status || error.status < 500))) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
      }
    }
    throw lastError;
  }
}
