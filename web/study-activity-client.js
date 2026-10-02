(function (root) {
  'use strict';
  const prefix = 'daguan_study_event_v1:', restorePrefix = 'daguan_study_restore_v1:';
  const cacheKey = 'daguan_study_backup_cache_v1';
  const endpoint = './api/study-activity';
  let flushing = null, active = null, feed = '', stopped = false;
  let savedSessions = {};
  try { savedSessions = JSON.parse(sessionStorage.getItem('daguan_study_sessions_v1') || '{}'); } catch {}
  const sessions = new Map(Object.entries(savedSessions.sessions || {}));
  active = savedSessions.active || null; feed = savedSessions.feed || '';
  const saveSessions = () => sessionStorage.setItem('daguan_study_sessions_v1', JSON.stringify({ active, feed, sessions: Object.fromEntries(sessions) }));
  const uuid = () => root.crypto.randomUUID();
  const notify = () => root.dispatchEvent(new CustomEvent('daguan:study-activity'));
  function cacheSnapshot(data) {
    try {
      const previous = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (!previous || (data.revision || 0) >= (previous.revision || 0)) localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // Never fall back to an older, incomplete backup after quota exhaustion.
      localStorage.removeItem(cacheKey);
    }
  }
  function validateBackup(data) {
    if (data == null) return;
    if (data.version !== 1 || !data.events || typeof data.events !== 'object' || Array.isArray(data.events) ||
        !data.baseline || typeof data.baseline !== 'object' || Array.isArray(data.baseline) || !Number.isFinite(Date.parse(data.started_at))) throw new Error('学习战报备份格式无效');
    for (const e of Object.values(data.events)) {
      if (!e || !/^[\w-]{8,100}$/.test(e.event_id || '') || !/^\d+$/.test(String(e.question_id || '')) ||
          !['study', 'answer', 'reveal', 'favorite'].includes(e.type) || !Number.isFinite(Date.parse(e.at)) || Date.parse(e.at) > Date.now() + 60000 ||
          e.type === 'answer' && typeof e.correct !== 'boolean' || e.type === 'favorite' && !['manual', 'automatic'].includes(e.source)) throw new Error('学习战报备份包含无效事件');
    }
  }
  function keys(prefixValue) {
    const result = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key.startsWith(prefixValue)) result.push(key); }
    return result;
  }
  async function request(suffix = '', method = 'GET', value) {
    const response = await fetch(endpoint + suffix, { method, cache: 'no-store',
      headers: value ? { 'Content-Type': 'application/json' } : {}, body: value ? JSON.stringify(value) : undefined,
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(response.status === 403 ? '学习战报需要解锁个人功能' : '学习战报暂未同步，已保存本机，联网后重试');
    return response.json();
  }
  function session(id) {
    id = String(id);
    if (!sessions.has(id)) sessions.set(id, { id: uuid(), seen: false });
    saveSessions();
    return sessions.get(id);
  }
  function emit(type, id, details = {}) {
    if (!/^\d+$/.test(String(id || ''))) return;
    const s = session(id), event = { event_id: uuid(), question_id: String(id), type, at: new Date().toISOString(),
      session_id: s.id, answer_seen: s.seen, ...details };
    localStorage.setItem(prefix + event.event_id, JSON.stringify(event));
    notify(); void flush();
  }
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let changed = false;
      try {
        for (const key of keys(restorePrefix)) { await request('/merge', 'POST', JSON.parse(localStorage.getItem(key))); localStorage.removeItem(key); changed = true; }
        while (!stopped) {
          const batch = keys(prefix).slice(0, 250).map(key => JSON.parse(localStorage.getItem(key)));
          if (!batch.length) break;
          const result = await request('/events', 'POST', { events: batch });
          for (const id of result.accepted) localStorage.removeItem(prefix + id);
          changed = true;
        }
      } catch { return false; }
      if (changed) {
        try { cacheSnapshot(await request('/export')); } catch {}
        notify();
      }
      return true;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  root.DaguanStudyActivity = {
    beginSingle(id) {
      if (active !== String(id)) { if (!feed.split(',').includes(String(id))) sessions.delete(String(id)); active = String(id); }
      feed = ''; saveSessions();
    },
    beginFeed(ids) {
      const next = ids.map(String).join(',');
      if (next !== feed) { for (const id of ids) if (String(id) !== active) sessions.delete(String(id)); feed = next; saveSessions(); }
    },
    study(id, details) { emit('study', id, details); },
    answer(id, correct, reliable, details) { emit('answer', id, { ...details, correct, reliable }); },
    reveal(id) { const s = session(id); if (!s.seen) { emit('reveal', id); s.seen = true; saveSessions(); } },
    favorite(id, source, details) { emit('favorite', id, { ...details, source }); },
    flush,
    validateBackup,
    async summary(days) {
      await flush();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return request(`?days=${days}&timeZone=${encodeURIComponent(timeZone)}`);
    },
    async journal(end = '') {
      await flush();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(`${endpoint}/journal?end=${encodeURIComponent(end)}&timeZone=${encodeURIComponent(timeZone)}`, {
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(response.status === 403 ? '请先解锁个人功能，再查看学习手账' : '学习记录读取失败，请检查本地服务后重试');
      return response.json();
    },
    async export() {
      await flush();
      let data;
      try { data = await request('/export'); cacheSnapshot(data); }
      catch (error) { data = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (!data) throw error; }
      for (const key of keys(prefix)) { const e = JSON.parse(localStorage.getItem(key)); data.events[e.event_id] = e; }
      for (const key of keys(restorePrefix)) {
        const pending = JSON.parse(localStorage.getItem(key));
        Object.assign(data.events, pending.events); Object.assign(data.baseline, pending.baseline);
        if (pending.started_at < data.started_at) data.started_at = pending.started_at;
      }
      return data;
    },
    async restore(data, progress) {
      if (!data && progress) {
        const baseline = {};
        for (const [id, p] of Object.entries(progress)) if (p && (p.seen || p.answered || p.last_practiced_at || ['learning', 'mastered', 'forgot'].includes(p.mastery))) baseline[id] = { failed: false };
        data = { version: 1, started_at: new Date().toISOString(), events: {}, baseline, importedBaseline: true };
      }
      if (!data) return;
      validateBackup(data);
      localStorage.setItem(restorePrefix + uuid(), JSON.stringify(data));
      await flush(); notify();
    },
    pendingCount: () => keys(prefix).length + keys(restorePrefix).length,
  };
  root.addEventListener('online', () => { void flush(); });
  void request('/export').then(cacheSnapshot).catch(() => {});
  root.addEventListener('storage', e => { if (e.key?.startsWith(prefix) || e.key?.startsWith(restorePrefix)) notify(); });
  root.addEventListener('beforeunload', () => { stopped = true; });
  function scheduleLearningDay() {
    const now = new Date(), next = new Date(now);
    next.setHours(4, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => { notify(); scheduleLearningDay(); }, next.getTime() - now.getTime());
  }
  scheduleLearningDay();
  // Covers remote quick mode, which does not expose SSE, as well as missed
  // cross-window notifications and the 04:00 learning-day boundary.
  setInterval(() => { if (document.visibilityState !== 'hidden') notify(); if (keys(prefix).length || keys(restorePrefix).length) void flush(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { notify(); void flush(); } });
})(window);
