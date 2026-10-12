/* Inject as a main-frame WKUserScript at document start, after __DAGUAN_IOS_KV__. */
(function (root) {
  'use strict';
  if (root.DaguanIOS) return;
  const handler = root.webkit?.messageHandlers?.daguan;
  if (!handler || root.location.protocol !== 'daguan:' || root.location.host !== 'app') return;
  const pending = new Map(), streams = new Map(), subscriptions = new Map();
  const encoder = new TextEncoder();
  let sequence = 0;
  const id = () => `web-${Date.now().toString(36)}-${++sequence}`;
  const abortError = () => new DOMException('The operation was aborted', 'AbortError');
  const failure = value => new Error(typeof value === 'string' ? value : value?.message || 'Native operation failed');
  const limits = Object.freeze({ pending: 128, streams: 8, subscriptions: 16, timeout: 30000, streamIdle: 180000, streamBytes: 2097152, storageBytes: 8388608 });
  function localURL(input) {
    const url = new URL(String(input), root.location.href);
    if (url.protocol !== 'daguan:' || url.host !== 'app' || url.username || url.password) throw new TypeError('Only daguan://app local URLs are supported');
    let path = url.pathname;
    for (let n = 0; n < 4; n++) {
      if (/[\\\u0000-\u001f]/.test(path) || path.split('/').some(s => s === '..' || s === '.')) throw new TypeError('Invalid local path');
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
      if (n === 3) throw new TypeError('Over-encoded local path');
    }
    return url;
  }
  function isAssetURL(input) {
    try { const url = localURL(input); return /^\/(?:data\/assets|assets)\//.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
  }
  function post(message) { handler.postMessage(message); }
  function rpc(operation, fields = {}, { signal, requestId = id(), onFailure } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (pending.size >= limits.pending) return Promise.reject(new Error('Too many pending native requests'));
    return new Promise((resolve, reject) => {
      const settle = (ok, value) => {
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId); clearTimeout(entry.timer);
        signal?.removeEventListener('abort', entry.abort);
        if (!ok) onFailure?.(value);
        (ok ? resolve : reject)(value);
      };
      const cancelRequest = () => { if (operation === 'request' && pending.has(requestId)) { try { post({ id: id(), operation: 'cancel-request', requestId }); } catch {} } };
      const abort = () => { cancelRequest(); settle(false, abortError()); };
      const timer = setTimeout(() => { cancelRequest(); settle(false, new Error(`Native ${operation} timed out`)); }, limits.timeout);
      pending.set(requestId, { settle, abort, timer });
      signal?.addEventListener('abort', abort, { once: true });
      try { post({ id: requestId, operation, ...fields }); } catch (error) { settle(false, error); }
    });
  }
  function receive(message) {
    if (!message || typeof message.id !== 'string') return;
    pending.get(message.id)?.settle(message.ok === true, message.ok === true ? message.result : failure(message.error));
  }
  function bytes(base64) {
    const binary = root.atob(base64 || '');
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  function response(result, method) {
    if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599 || typeof result.body !== 'string') throw new TypeError('Invalid native response envelope');
    return new Response(method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : bytes(result.body), { status: result.status, headers: result.headers || {} });
  }
  function cancelRun(runId) { return rpc('cancel', { runId: String(runId) }); }
  function chat(body, signal) {
    if (streams.size >= limits.streams) return Promise.reject(new Error('Too many active AI streams'));
    if (signal?.aborted) return Promise.reject(abortError());
    const requestId = id();
    let controller;
    const entry = { runId: requestId, signal, timer: null, controller: null };
    const cleanup = () => { streams.delete(requestId); clearTimeout(entry.timer); signal?.removeEventListener('abort', entry.abort); };
    entry.finish = error => { if (!streams.has(requestId)) return; cleanup(); try { if (error) controller.error(error); else controller.close(); } catch { /* Reader cancellation already closed the stream. */ } };
    entry.stop = error => { if (!streams.has(requestId)) return; entry.finish(error); void cancelRun(entry.runId).catch(() => {}); };
    entry.abort = () => entry.stop(abortError());
    entry.touch = () => { clearTimeout(entry.timer); entry.timer = setTimeout(() => entry.stop(new Error('AI stream timed out')), limits.streamIdle); };
    const readable = new ReadableStream({ start(value) { controller = value; entry.controller = value; }, cancel() { entry.stop(abortError()); } }, { highWaterMark: limits.streamBytes, size: chunk => chunk.byteLength });
    streams.set(requestId, entry);
    signal?.addEventListener('abort', entry.abort, { once: true });
    entry.touch();
    return rpc('chat', { body }, { requestId, signal, onFailure: error => entry.stop(error) }).then(result => {
      if (result?.runId) entry.runId = String(result.runId);
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
    }).catch(error => { entry.stop(error); throw error; });
  }
  function stream(message) {
    const entry = streams.get(message?.id);
    if (!entry) return;
    try {
      const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
      const type = message.event || data?.type;
      if (!['started', 'delta', 'done', 'error'].includes(type) || !data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Invalid AI stream event');
      if (data.runId) entry.runId = String(data.runId);
      const chunk = encoder.encode(`data: ${JSON.stringify({ ...data, type })}\n\n`);
      if (entry.controller.desiredSize < chunk.byteLength) throw new Error('AI stream buffer exceeded');
      entry.controller.enqueue(chunk); entry.touch();
      if (type === 'done' || type === 'error') entry.finish();
    } catch (error) { entry.stop(error); }
  }
  root.fetch = async function (input, init = {}) {
    const url = localURL(input instanceof Request ? input.url : input);
    const effective = input instanceof Request ? new Request(input, init) : new Request(url.href, init);
    if (effective.signal.aborted) throw abortError();
    const method = effective.method.toUpperCase();
    const body = ['GET', 'HEAD'].includes(method) ? null : await effective.text();
    if (effective.signal.aborted) throw abortError();
    const path = url.pathname + url.search;
    if (url.pathname === '/api/ai/chat' && method === 'POST') return chat(body, effective.signal);
    const cancel = url.pathname.match(/^\/api\/ai\/runs\/([^/]+)$/);
    if (cancel && method === 'DELETE') { await cancelRun(decodeURIComponent(cancel[1])); return new Response(null, { status: 204 }); }
    if (url.pathname.startsWith('/api/')) return response(await rpc('request', { path, method, body }, { signal: effective.signal }), method);
    if (!['GET', 'HEAD'].includes(method)) throw new TypeError('Bundled resources are read-only');
    return response(await rpc('resource', { path: url.pathname }, { signal: effective.signal }), method);
  };

  class NativeEventSource extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    CONNECTING = 0; OPEN = 1; CLOSED = 2;
    onopen = null; onmessage = null; onerror = null;
    constructor(input, options = {}) {
      super();
      const url = localURL(input);
      if (url.pathname !== '/api/state/events' || url.search || options.withCredentials) throw new TypeError('Unsupported native event subscription');
      if (subscriptions.size >= limits.subscriptions) throw new Error('Too many native subscriptions');
      this.url = url.href; this.withCredentials = false; this.readyState = 0;
      this.buffer = []; this.subscriptionId = id(); subscriptions.set(this.subscriptionId, this);
      this.connect();
    }
    connect() {
      if (this.readyState === 2) return;
      const requested = this.subscriptionId;
      void rpc('subscribe', { path: '/api/state/events', subscriptionId: requested }).then(result => {
        const assigned = result?.subscriptionId;
        if (typeof assigned !== 'string' || !assigned) throw new Error('Invalid subscription acknowledgement');
        subscriptions.delete(requested);
        if (this.readyState === 2) { void rpc('unsubscribe', { subscriptionId: assigned }).catch(() => {}); return; }
        this.subscriptionId = assigned; subscriptions.set(assigned, this); this.readyState = 1;
        this.emit('open');
        for (const message of this.buffer.splice(0)) if (this.readyState === 1) this.emit(message.type, message.data);
      }).catch(() => { if (this.readyState !== 2) { this.readyState = 0; this.emit('error'); this.timer = setTimeout(() => this.connect(), 3000); } });
    }
    emit(type, data) {
      const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data), origin: 'daguan://app', lastEventId: '' });
      this.dispatchEvent(event);
      const listener = this[`on${type}`]; if (typeof listener === 'function') listener.call(this, event);
    }
    close() {
      if (this.readyState === 2) return;
      this.readyState = 2; clearTimeout(this.timer); subscriptions.delete(this.subscriptionId);
      void rpc('unsubscribe', { subscriptionId: this.subscriptionId }).catch(() => {});
    }
  }
  root.EventSource = NativeEventSource;
  function event(message) {
    const source = subscriptions.get(message?.subscriptionId);
    if (!source || typeof message.type !== 'string') return;
    if (source.readyState === 1) source.emit(message.type, message.data);
    else if (source.readyState === 0) {
      if (source.buffer.length < 64) source.buffer.push(message);
      else { source.close(); source.emit('error'); }
    }
  }

  const initial = root.__DAGUAN_IOS_KV__;
  let storageError = null, revision = 0, durableRevision = 0, writing = null, storageFrozen = false, reloading = null;
  let values = Object.create(null);
  if (!initial || typeof initial !== 'object' || Array.isArray(initial) || Object.values(initial).some(value => typeof value !== 'string')) storageError = new Error('原生存储快照未加载，请重新打开应用');
  else values = Object.assign(Object.create(null), initial);
  const snapshotLoaded = !storageError;
  function storageStatus() {
    const document = root.document;
    if (!document?.body) return;
    let panel = document.getElementById('ios-persistence-status');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'ios-persistence-status'; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
      const text = document.createElement('span'); text.id = 'ios-persistence-message'; panel.appendChild(text);
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试保存'; retry.onclick = () => { void flush().catch(() => {}); }; panel.appendChild(retry);
      document.body.appendChild(panel);
    }
    panel.hidden = !storageFrozen && !storageError && revision === durableRevision;
    panel.dataset.error = storageError ? 'true' : 'false';
    panel.querySelector('span').textContent = storageError ? `尚未保存到设备：${storageError.message}。请保留当前页面并重试。` : storageFrozen ? '正在安全重新加载，编辑已暂停，请稍候…' : '正在保存到设备，请稍候…';
    panel.querySelector('button').hidden = !storageError || !snapshotLoaded;
  }
  function flush() {
    if (!snapshotLoaded) return Promise.reject(storageError);
    if (writing) return writing;
    if (revision === durableRevision) return Promise.resolve();
    writing = (async () => {
      while (durableRevision !== revision) {
        const version = revision, copy = { ...values };
        try { await rpc('kv', { values: copy }); durableRevision = version; storageError = null; storageStatus(); }
        catch (error) { storageError = error; storageStatus(); throw error; }
      }
    })().finally(() => { writing = null; storageStatus(); });
    return writing;
  }
  function prepareReload() {
    if (reloading) return reloading;
    storageFrozen = true; storageStatus();
    reloading = flush().catch(error => { storageFrozen = false; reloading = null; storageStatus(); throw error; });
    return reloading;
  }
  function resumeStorage() { storageFrozen = false; reloading = null; storageStatus(); }
  function mutate(next) {
    if (storageFrozen) { storageStatus(); throw new Error('正在安全重新加载，编辑已暂停'); }
    if (!snapshotLoaded) { storageStatus(); throw storageError; }
    if (encoder.encode(JSON.stringify(next)).byteLength > limits.storageBytes) throw new DOMException('Device cache quota exceeded', 'QuotaExceededError');
    values = next; revision++; storageStatus();
    // The synchronous API only changes the cache; flush is the durability acknowledgement.
    queueMicrotask(() => { if (!storageError) void flush().catch(() => {}); });
  }
  const storage = {
    get length() { return Object.keys(values).length; },
    key(index) { return Object.keys(values)[Number(index)] ?? null; },
    getItem(key) { return Object.hasOwn(values, String(key)) ? values[String(key)] : null; },
    setItem(key, value) { mutate(Object.assign(Object.create(null), values, { [String(key)]: String(value) })); },
    removeItem(key) { key = String(key); if (!Object.hasOwn(values, key)) return; const next = { ...values }; delete next[key]; mutate(next); },
    clear() { if (Object.keys(values).length) mutate(Object.create(null)); }
  };
  Object.defineProperty(root, 'localStorage', { configurable: false, value: storage });
  async function exportBlob(blob, name) {
    try {
      await flush();
      const data = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192));
      await rpc('export', { name: String(name), base64: root.btoa(binary), mime: blob.type || 'application/octet-stream' });
      return true;
    } catch (error) { root.alert?.(`未能打开文件分享：${error.message}`); throw error; }
  }
  const unsupported = Object.freeze({
    '#btn-switch-legacy': null, '#desktop-storage-settings': null, '#remote-title': '.card', '#btn-stop-local-service': '.tool-card',
    '.home-sync-card': null, '#sync-toggle-btn': '.tool-card', '#preview-banner': null, '#dlg-preview-access': null,
    '#preview-status': '.card', '#btn-preview-unlock': null, '#btn-preview-lock': null,
    '#btn-export-go': '.tool-card', '#usage-open-sync': '[data-guide-panel]',
  });
  function capabilities() {
    const document = root.document; if (!document?.documentElement) return;
    document.documentElement.dataset.platform = 'ios';
    for (const [selector, container] of Object.entries(unsupported)) for (const node of document.querySelectorAll(selector)) (container ? node.closest(container) : node)?.setAttribute('data-ios-unsupported', 'true');
  }
  root.DaguanIOS = Object.freeze({ receive, event, stream, flush, prepareReload, resumeStorage, exportBlob, isAssetURL, capabilities: Object.freeze({ officialSync: false, desktop: false, legacy: false, preview: false, exportPreview: false }), limits,
    get persistence() { return { dirty: revision !== durableRevision, error: storageError?.message || null }; } });
  root.document?.addEventListener('error', event => {
    const image = event.target;
    if (image?.tagName !== 'IMG' || image.dataset.iosMissing === 'true') return;
    image.dataset.iosMissing = 'true'; image.alt = '此配图未包含在当前资源包中';
    image.src = 'daguan://app/assets/missing-image.svg';
  }, true);
  function mount() { capabilities(); storageStatus(); if (root.MutationObserver) new MutationObserver(capabilities).observe(root.document.body, { childList: true, subtree: true }); }
  root.document?.addEventListener('DOMContentLoaded', mount, { once: true });
  root.addEventListener('pagehide', () => { for (const source of [...subscriptions.values()]) source.close(); for (const entry of [...streams.values()]) entry.stop(abortError()); void flush().catch(() => {}); });
  root.addEventListener('beforeunload', event => { if (revision !== durableRevision) { event.preventDefault(); event.returnValue = ''; } });
})(window);
