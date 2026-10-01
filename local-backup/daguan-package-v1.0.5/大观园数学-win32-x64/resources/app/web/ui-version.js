/* Shared bootstrap: appearance is separate; learning data keeps its existing keys. */
(function (root) {
  "use strict";
  const selectionKey = "daguan_ui_version_v1";
  const appearanceKeys = { new: "daguan_ui_appearance_new_v1", old: "daguan_ui_appearance_old_v1" };
  const appearanceInitKey = "daguan_ui_appearance_new_initialized_v1";
  const freshAppearance = { theme: "path-red", brand: "#C83F32", app: "#F7F3EA", reading: "#FFFEFA", accent: "#9A7746" };
  const orangeAppearance = { theme: "orange-white", brand: "#FF6A1A", app: "#F5F6F8", reading: "#FFFFFF", accent: "#B83D00" };
  function readObject(storage, key) {
    try { const value = JSON.parse(storage.getItem(key)); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  function migrate(storage) {
    if (!storage) return;
    // Capture device history before this bootstrap creates any appearance keys.
    const hadDeviceHistory = [selectionKey, appearanceKeys.old, "daguan_ui_appearance_new", "daguan_ui_preferences_v1",
      "daguan_learning_position_v2", "daguan_local_progress_v1", "daguan_local_favorites_v1",
      "daguan_question_annotations_v1", "daguan_local_notes_v1", "daguan_ai_preferences_v1", "ui-background", "ui-font"]
      .some(key => storage.getItem(key) !== null);
    if (storage.getItem(appearanceKeys.old) === null) {
      storage.setItem(appearanceKeys.old, JSON.stringify(readObject(storage, "daguan_ui_preferences_v1")));
    }
    const raw = storage.getItem(appearanceKeys.new);
    if (raw === null) {
      let initial = hadDeviceHistory ? orangeAppearance : freshAppearance;
      try {
        const legacyNew = readObject(storage, "daguan_ui_appearance_new");
        if (Object.keys(legacyNew).length) {
          const legacyTheme = legacyNew.theme === "light" ? "orange-white" : legacyNew.theme === "official-dark" ? "orange-night" : legacyNew.theme === "eye-care" ? "eye-care" : legacyNew.theme;
          initial = { ...orangeAppearance, ...legacyNew, theme: legacyTheme || "orange-white" };
        }
      } catch {}
      storage.setItem(appearanceKeys.new, JSON.stringify(initial));
      storage.setItem(appearanceInitKey, hadDeviceHistory ? "existing-device" : "fresh-install");
      return;
    }
    if (storage.getItem(appearanceInitKey) === null) storage.setItem(appearanceInitKey, "existing-device");
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        // Earlier bootstrap versions wrote {} or theme:light on existing installs.
        if (!Object.keys(value).length || value.theme === "light") {
          storage.setItem(appearanceKeys.new, JSON.stringify({ ...orangeAppearance, reduceMotion: !!value.reduceMotion }));
        } else if (value.theme === "official-dark") {
          storage.setItem(appearanceKeys.new, JSON.stringify({ ...orangeAppearance, theme: "orange-night" }));
        } else if (value.theme === "eye-care") {
          storage.setItem(appearanceKeys.new, JSON.stringify({ ...orangeAppearance, theme: "eye-care" }));
        }
      }
    } catch { storage.setItem(appearanceKeys.new, JSON.stringify(hadDeviceHistory ? orangeAppearance : freshAppearance)); }
  }
  function selected(storage) { return storage.getItem(selectionKey) === "old" ? "old" : "new"; }
  function targetUrl(href, version, switching = false) {
    const url = new URL(href);
    url.pathname = url.pathname.replace(/[^/]*$/, version === "old" ? "legacy.html" : "index.html");
    if (switching) url.searchParams.set("uiSwitch", "1");
    return url.href;
  }
  function draftKey(questionId) { return `daguan_ai_draft_v1:${questionId}`; }

  // ---- 待同步日志（新版/旧版共用，键 daguan_pending_sync_v1） ----
  // 记录“本地已经写入、服务端尚未确认”的批注与收藏编辑，使离线、写入失败、刷新、
  // 跨版本切换都不会丢掉刚写入的本地编辑。日志只保存意图与内容指纹；真正推送的内容
  // 由调用方按 updated_at 取“本机最新值”，不会用日志里的旧快照覆盖更新的本地编辑。
  const pendingKey = "daguan_pending_sync_v1";
  function emptyPending() { return { version: 1, annotations: {}, questions: {} }; }
  function storageOf(storage) {
    if (storage && typeof storage.getItem === "function") return storage;
    return root.localStorage || null;
  }
  function readPending(storage) {
    const out = emptyPending();
    const store = storageOf(storage);
    if (!store) return out;
    let parsed = null;
    try { parsed = JSON.parse(store.getItem(pendingKey)); } catch { return out; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    const annotations = parsed.annotations;
    if (annotations && typeof annotations === "object" && !Array.isArray(annotations)) {
      for (const [id, entry] of Object.entries(annotations)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        out.annotations[String(id)] = {
          markdown: typeof entry.markdown === "string" ? entry.markdown : "",
          updated_at: typeof entry.updated_at === "string" ? entry.updated_at : null,
          queued_at: Number(entry.queued_at) || 0,
        };
      }
    }
    const questions = parsed.questions;
    if (questions && typeof questions === "object" && !Array.isArray(questions)) {
      for (const [id, entry] of Object.entries(questions)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const patch = entry.patch && typeof entry.patch === "object" && !Array.isArray(entry.patch) ? entry.patch : null;
        if (!patch || !Object.keys(patch).length) continue;
        out.questions[String(id)] = {
          patch: { ...patch },
          updated_at: typeof entry.updated_at === "string" ? entry.updated_at : null,
          queued_at: Number(entry.queued_at) || 0,
        };
      }
    }
    return out;
  }
  function writePending(journal, storage) {
    const store = storageOf(storage);
    const next = emptyPending();
    for (const [id, entry] of Object.entries((journal && journal.annotations) || {})) {
      next.annotations[String(id)] = {
        markdown: String(entry.markdown == null ? "" : entry.markdown),
        updated_at: entry.updated_at || new Date().toISOString(),
        queued_at: Number(entry.queued_at) || Date.now(),
      };
    }
    for (const [id, entry] of Object.entries((journal && journal.questions) || {})) {
      const patch = { ...((entry && entry.patch) || {}) };
      if (!Object.keys(patch).length) continue;
      next.questions[String(id)] = { patch, updated_at: (entry && entry.updated_at) || new Date().toISOString(), queued_at: Number(entry && entry.queued_at) || Date.now() };
    }
    if (!store) return false;
    try {
      if (!Object.keys(next.annotations).length && !Object.keys(next.questions).length) {
        if (typeof store.removeItem === "function") store.removeItem(pendingKey);
        else store.setItem(pendingKey, "");
      } else {
        store.setItem(pendingKey, JSON.stringify(next));
      }
      return true;
    } catch { return false; }
  }
  function queueAnnotation(id, markdown, updatedAt, storage) {
    const journal = readPending(storage);
    journal.annotations[String(id)] = {
      markdown: String(markdown == null ? "" : markdown),
      updated_at: updatedAt || new Date().toISOString(),
      queued_at: Date.now(),
    };
    return writePending(journal, storage);
  }
  function queueQuestion(id, patch, storage) {
    const fields = Object.entries(patch || {}).filter(([, value]) => value !== undefined);
    if (!fields.length) return false;
    const key = String(id);
    const journal = readPending(storage);
    const merged = { ...((journal.questions[key] || {}).patch || {}) };
    for (const [field, value] of fields) merged[field] = value;
    journal.questions[key] = { patch: merged, updated_at: new Date().toISOString(), queued_at: Date.now() };
    return writePending(journal, storage);
  }
  // 服务端确认后才清除；若期间用户又改了（指纹不同）则保留待同步状态。
  function clearAnnotation(id, markdown, storage) {
    const key = String(id);
    const journal = readPending(storage);
    const entry = journal.annotations[key];
    if (!entry) return false;
    if (markdown !== undefined && entry.markdown !== markdown) return false;
    delete journal.annotations[key];
    return writePending(journal, storage);
  }
  function clearQuestion(id, patch, storage) {
    const key = String(id);
    const journal = readPending(storage);
    const entry = journal.questions[key];
    if (!entry) return false;
    const fields = patch && Object.keys(patch).length ? Object.keys(patch) : Object.keys(entry.patch);
    let changed = false;
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(entry.patch, field)) continue;
      // 只清除“已确认写服务端”的那个值；期间被改成别的值就继续挂着待同步
      if (patch && Object.prototype.hasOwnProperty.call(patch, field) && entry.patch[field] !== patch[field]) continue;
      delete entry.patch[field];
      changed = true;
    }
    if (!Object.keys(entry.patch).length) delete journal.questions[key];
    return changed ? writePending(journal, storage) : false;
  }
  function pendingHasAny(storage) {
    const journal = readPending(storage);
    return Object.keys(journal.annotations).length > 0 || Object.keys(journal.questions).length > 0;
  }
  root.DaguanPendingSync = {
    key: pendingKey,
    empty: emptyPending,
    read: readPending,
    write: writePending,
    queueAnnotation,
    queueQuestion,
    clearAnnotation,
    clearQuestion,
    annotationIds: storage => Object.keys(readPending(storage).annotations),
    questionIds: storage => Object.keys(readPending(storage).questions),
    hasAny: pendingHasAny,
  };

  const api = { selectionKey, appearanceKeys, appearanceInitKey, migrate, selected, targetUrl, draftKey };
  root.DaguanVersions = api;
  if (!root.document) return;
  const current = root.location.pathname.endsWith("/legacy.html") ? "old" : "new";
  api.current = current;
  api.appearanceKey = appearanceKeys[current];
  try {
    migrate(root.localStorage);
    if (current === "old") root.localStorage.setItem(selectionKey, "old");
    else if (selected(root.localStorage) === "old") root.location.replace(targetUrl(root.location.href, "old"));
  } catch { /* Restricted storage must not prevent reading the question bank. */ }
  root.document.documentElement.dataset.uiVersion = current;
})(typeof window === "undefined" ? globalThis : window);
