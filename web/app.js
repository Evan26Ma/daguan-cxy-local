(() => {
  "use strict";

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  const DATA = "./data";
  const PROGRESS_KEY = "daguan_local_progress_v1";
  const MODE_KEY = "daguan_local_mode_v1";
  const PICK_KEY = "daguan_local_picked_v1";
  const FAVORITE_KEY = "daguan_local_favorites_v1";
  const ANNOTATION_KEY = "daguan_question_annotations_v1";
  const UI_PREFS_KEY = "daguan_ui_preferences_v1";
  const SHORTCUTS_KEY = "daguan_focus_shortcuts_v1";
  const AI_PREFS_KEY = "daguan_ai_preferences_v1";
  const AI_WIDTH_KEY = "daguan_ai_drawer_width_v1";
  const UI_BACKGROUND_KEY = "ui-background";
  const APP_VERSION = "2026.09.06-r5";
  const POSITION_KEY = "daguan_learning_position_v2";
  const UI_THEMES = ["official-light", "official-dark", "eye-care", "custom"];
  const DEFAULT_UI_PREFS = Object.freeze({
    version: 1,
    theme: "official-light",
    backgroundColor: "#f5f7fa",
    backgroundImageKey: "",
    backgroundPosition: "center",
    overlayOpacity: 0.78,
  });
  const PAGE_SIZE = 20;
  const TYPE_LABEL = {
    subjective: "主观题",
    single_choice: "单选",
    multiple_choice: "多选",
  };
  const MASTERY_LABEL = {
    not_started: "未开始",
    learning: "学习中",
    mastered: "已掌握",
  };
  const SHORTCUT_DEFAULTS = Object.freeze({ up: "ArrowUp", down: "ArrowDown", answer: " ", mastery1: "1", mastery2: "2", mastery3: "3", error: "e", favorite: "f", ai: "a", note: "n", copy: "c", help: "?", escape: "Escape", focus: "F6" });

  let uiPrefs = loadUiPrefs();
  let uiBackgroundUrl = "";
  let lastDialogTrigger = null;

  const state = {
    manifest: null,
    categories: [],
    catQuestions: {},
    idIndex: {},
    searchIndex: null,
    shards: new Map(),
    queue: [],
    index: 0,
    showAnswer: false,
    selected: new Set(),
    // per-question UI in list mode: { showAnswer, selected:Set }
    cardUI: new Map(),
    progress: loadProgress(),
    annotations: loadAnnotations(),
    currentCatId: null,
    chapterPathIds: [],
    chapterMenuOpen: false,
    chapterMenuRootId: null,
    crumb: "",
    filterCore: false,
    filterTodo: false,
    scope: "all", // all | core | real
    view: "home", // home | browse | search | feature
    feature: "favorites",
    mode: loadMode(), // list | single
    renderedCount: 0,
    specialQueue: null, // null | 'todo' | 'forgot'
    picked: loadPicked(),
    favorites: loadFavorites(),
    remote_activity: null,
    last_study: null,
    focusMode: false,
    focusSnapshot: null,
    aiOpen: false,
    aiTab: "chat",
    aiQuestionId: null,
    aiProfiles: [],
    aiRuns: new Map(),
    aiProfileId: "",
    noteHistory: [],
  };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    sidebar: $("#sidebar"),
    catTree: $("#cat-tree"),
    stats: $("#stats-line"),
    crumb: $("#crumb"),
    home: $("#view-home"),
    browse: $("#view-browse"),
    searchView: $("#view-search"),
    feature: $("#view-feature"),
    homeCards: $("#home-cards"),
    search: $("#search"),
    searchResults: $("#search-results"),
    searchCount: $("#search-count"),
    listMode: $("#list-mode"),
    singleMode: $("#single-mode"),
    qFeed: $("#q-feed"),
    feedFoot: $("#feed-foot"),
    feedStatus: $("#feed-status"),
    loadMore: $("#btn-load-more"),
    browseHeading: $("#browse-heading"),
    browseSub: $("#browse-sub"),
    browseProgress: $("#browse-progress"),
    progressFill: $("#progress-fill"),
    progressLabel: $("#progress-label"),
    qPos: $("#q-pos"),
    qSource: $("#q-source"),
    qType: $("#q-type"),
    qId: $("#q-id"),
    qPath: $("#q-path"),
    qStem: $("#q-stem"),
    qOptions: $("#q-options"),
    qAnswer: $("#q-answer"),
    qExpl: $("#q-expl"),
    answerBox: $("#answer-box"),
    listStrip: $("#list-strip"),
    toast: $("#toast"),
    filterCore: $("#filter-core"),
    filterTodo: $("#filter-todo"),
    metricTotal: $("#metric-total"),
    metricSeen: $("#metric-seen"),
    metricMastered: $("#metric-mastered"),
    metricForgot: $("#metric-forgot"),
    aiDrawer: $("#ai-drawer"),
    aiEdgeTab: $("#ai-edge-tab"),
    aiMessages: $("#ai-messages"),
    aiPrompt: $("#ai-prompt"),
    aiProfileSelect: $("#ai-profile-select"),
    noteEditor: $("#question-note-editor"),
    browseNavLeading: $("#browse-nav-leading"),
    chapterPicker: $("#chapter-picker"),
    chapterTrigger: $("#chapter-trigger"),
    chapterTriggerLabel: $("#chapter-trigger-label"),
    chapterMenu: $("#chapter-menu"),
    chapterMenuTitle: $("#chapter-menu-title"),
    chapterMenuPath: $("#chapter-menu-path"),
    chapterColumns: $("#chapter-columns"),
    chapterMenuFeedback: $("#chapter-menu-feedback"),
    chapterEmpty: $("#chapter-empty-state"),
    chapterEmptyCopy: $("#chapter-empty-copy"),
    chapterSectionNav: $("#chapter-section-nav"),
    chapterProgressTop: $("#chapter-progress-top"),
    prevSection: $("#btn-prev-section"),
    nextSection: $("#btn-next-section"),
    pickBar: $("#pick-bar"),
    topbarMore: $("#topbar-more-menu"),
    moreTrigger: $("#btn-more"),
  };

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") || {};
      const out = {};
      for (const [id, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") continue;
        const legacy = value.mastery === "forgot";
        out[String(id)] = { ...value, mastery: legacy ? "learning" : ["not_started", "learning", "mastered"].includes(value.mastery) ? value.mastery : "not_started", error_prone: value.error_prone === true || legacy };
      }
      return out;
    } catch {
      return {};
    }
  }

  function loadAnnotations() {
    try {
      const raw = JSON.parse(localStorage.getItem(ANNOTATION_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  }

  function loadShortcuts() {
    try { return { ...SHORTCUT_DEFAULTS, ...(JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || "{}") || {}) }; }
    catch { return { ...SHORTCUT_DEFAULTS }; }
  }

  const shortcuts = loadShortcuts();
  const SHORTCUT_LABELS = Object.freeze({ focus: "进入 / 退出焦点模式", up: "上一题", down: "下一题", answer: "显示 / 隐藏答案", mastery1: "标记未开始", mastery2: "标记学习中", mastery3: "标记已掌握", error: "切换易错", favorite: "切换收藏", ai: "打开 AI 解答", note: "打开题目批注", copy: "复制本题 Markdown", help: "显示快捷键帮助", escape: "关闭抽屉 / 退出焦点" });

  function shortcutDisplay(key) {
    if (key === " ") return "Space";
    if (key === "ArrowUp") return "↑";
    if (key === "ArrowDown") return "↓";
    if (key === "Escape") return "Esc";
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function shortcutButtonMarkup(label, action, icon = "") {
    return `${icon}<span class="action-label">${escapeHtml(label)}</span><kbd class="shortcut-hint" data-shortcut-hint="${action}">${escapeHtml(shortcutDisplay(shortcuts[action] || ""))}</kbd>`;
  }

  function renderShortcutHints() {
    document.querySelectorAll("[data-shortcut-label]").forEach((button) => {
      const hint = button.querySelector("[data-shortcut-hint]");
      if (!hint) return;
      const action = button.dataset.shortcutLabel;
      const value = shortcuts[action] || "";
      const display = shortcutDisplay(value);
      hint.textContent = display;
      hint.hidden = !value;
      if (value) {
        button.setAttribute("aria-keyshortcuts", value === " " ? "Space" : value);
        button.title = `${button.querySelector(".action-label")?.textContent || button.textContent.trim()}（快捷键：${display}）`;
      } else {
        button.removeAttribute("aria-keyshortcuts");
      }
    });
  }

  function renderShortcutSettings() {
    const root = $("#shortcut-list");
    if (!root) return;
    root.innerHTML = Object.keys(SHORTCUT_LABELS).map((action) => `<label class="shortcut-row"><span>${escapeHtml(SHORTCUT_LABELS[action])}</span><button type="button" class="shortcut-key" data-shortcut-action="${action}" aria-label="${escapeHtml(SHORTCUT_LABELS[action])}快捷键">${escapeHtml(shortcutDisplay(shortcuts[action]))}</button></label>`).join("");
    root.querySelectorAll("[data-shortcut-action]").forEach((button) => {
      button.addEventListener("keydown", (event) => {
        event.preventDefault();
        if (["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        const action = button.dataset.shortcutAction;
        const next = event.key === " " ? " " : event.key;
        const duplicate = Object.entries(shortcuts).find(([name, value]) => name !== action && value.toLowerCase?.() === next.toLowerCase?.());
        if (duplicate) {
          const feedback = $("#shortcut-feedback");
          if (feedback) feedback.textContent = `按键 ${shortcutDisplay(next)} 已被“${SHORTCUT_LABELS[duplicate[0]]}”占用。`;
          return;
        }
        shortcuts[action] = next;
        localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
        renderShortcutSettings();
        renderShortcutHints();
        $("#shortcut-feedback")?.replaceChildren(document.createTextNode(`已绑定：${SHORTCUT_LABELS[action]} → ${shortcutDisplay(next)}`));
        button.focus();
      });
    });
  }

  function loadPicked() {
    try {
      const raw = JSON.parse(localStorage.getItem(PICK_KEY) || "[]");
      return new Set((Array.isArray(raw) ? raw : []).map(String));
    } catch {
      return new Set();
    }
  }

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITE_KEY) || "[]");
      return new Set((Array.isArray(raw) ? raw : []).map(String));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITE_KEY, JSON.stringify([...state.favorites]));
    } catch {}
    refreshFavoriteUI();
    schedulePersist();
  }

  function isFavorite(id) {
    return state.favorites.has(String(id));
  }

  function setFavorite(id, on) {
    const key = String(id);
    if (on) state.favorites.add(key);
    else state.favorites.delete(key);
    const cur = state.progress[key] || {};
    state.progress[key] = { ...cur, favorite: !!on, favorite_updated_at: Date.now(), updated_at: Date.now() };
    queueQuestionSync(key, { favorite: !!on });
    saveFavorites();
    refreshCardChrome(id);
  }

  function setErrorProne(id, on) {
    const key = String(id);
    const cur = state.progress[key] || {};
    const at = Date.now();
    state.progress[key] = { ...cur, error_prone: !!on, error_prone_updated_at: at, updated_at: at, seen: true };
    queueQuestionSync(key, { error_prone: !!on, seen: true });
    saveProgress();
    refreshCardChrome(id);
    if (currentQ()?.id != null && String(currentQ().id) === key) renderSingle();
  }

  function refreshFavoriteUI() {
    document.querySelectorAll("[data-favorite-id]").forEach((el) => {
      const on = isFavorite(el.dataset.favoriteId);
      const label = el.querySelector(".action-label");
      if (label) label.textContent = on ? "已收藏" : "收藏";
      else el.textContent = on ? "已收藏" : "收藏";
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", String(on));
    });
  }

  function savePicked() {
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify([...state.picked]));
    } catch {
      /* quota */
    }
    refreshPickUI();
    schedulePersist();
  }

  function isPicked(id) {
    return state.picked.has(String(id));
  }

  function setPicked(id, on) {
    const key = String(id);
    if (on) state.picked.add(key);
    else state.picked.delete(key);
    savePicked();
  }

  function pickedIdsOrdered() {
    const seen = new Set();
    const out = [];
    for (const q of state.queue) {
      const id = String(q.id);
      if (state.picked.has(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of state.picked) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  }

  function refreshPickUI() {
    const n = state.picked.size;
    const count = $("#pick-count");
    if (count) count.textContent = `已勾选 ${n} 题`;
    document.querySelectorAll("[data-pick-id]").forEach((el) => {
      el.checked = state.picked.has(String(el.dataset.pickId));
    });
    document.querySelectorAll(".q-card[data-id]").forEach((card) => {
      card.classList.toggle("is-picked", isPicked(card.dataset.id));
    });
    const single = $("#single-pick");
    const q = typeof currentQ === "function" ? currentQ() : null;
    if (single && q) single.checked = isPicked(q.id);
  }

  const IDB_NAME = "daguan-math";
  const IDB_VER = 1;
  let idbPromise = null;
  let persistTimer = 0;
  let serverPersistTimer = 0;
  let serverStateHydrated = false;
  let serverStateAvailable = false;
  let serverStateSyncing = false;
  let serverRevision = 0;
  const serverQuestionQueue = new Map();
  let serverQuestionTimer = 0;

  function openIdb() {
    if (idbPromise) return idbPromise;
    if (!window.indexedDB) {
      idbPromise = Promise.resolve(null);
      return idbPromise;
    }
    idbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, IDB_VER);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return idbPromise;
  }

  function idbGet(key) {
    return openIdb().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) return resolve(undefined);
          try {
            const req = db.transaction("kv", "readonly").objectStore("kv").get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        })
    );
  }

  function idbSet(key, value) {
    return openIdb().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) return resolve();
          try {
            const req = db.transaction("kv", "readwrite").objectStore("kv").put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          } catch {
            resolve();
          }
        })
    );
  }

  function idbDelete(key) {
    return openIdb().then(
      (db) =>
        new Promise((resolve) => {
          if (!db) return resolve();
          try {
            const req = db.transaction("kv", "readwrite").objectStore("kv").delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          } catch {
            resolve();
          }
        })
    );
  }

  function loadUiPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
      const value = { ...DEFAULT_UI_PREFS, ...(raw && typeof raw === "object" ? raw : {}) };
      if (!UI_THEMES.includes(value.theme)) value.theme = DEFAULT_UI_PREFS.theme;
      if (!/^#[0-9a-f]{6}$/i.test(String(value.backgroundColor || ""))) {
        value.backgroundColor = DEFAULT_UI_PREFS.backgroundColor;
      }
      const overlay = Number(value.overlayOpacity);
      value.overlayOpacity = Number.isFinite(overlay)
        ? Math.min(0.95, Math.max(0.55, overlay))
        : DEFAULT_UI_PREFS.overlayOpacity;
      if (!["center", "top", "bottom", "left", "right"].includes(value.backgroundPosition)) {
        value.backgroundPosition = DEFAULT_UI_PREFS.backgroundPosition;
      }
      value.backgroundImageKey = value.backgroundImageKey === UI_BACKGROUND_KEY ? UI_BACKGROUND_KEY : "";
      return value;
    } catch {
      return { ...DEFAULT_UI_PREFS };
    }
  }

  function saveUiPrefs() {
    try {
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs));
    } catch {
      /* A full localStorage must not stop the question bank. */
    }
  }

  function iconMarkup(name) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  }

  function applyUiPreferences() {
    const root = document.documentElement;
    root.dataset.theme = uiPrefs.theme;
    root.style.colorScheme = uiPrefs.theme === "official-dark" ? "dark" : "light";
    root.style.setProperty("--custom-bg-color", uiPrefs.backgroundColor || DEFAULT_UI_PREFS.backgroundColor);
    root.style.setProperty("--custom-overlay-opacity", String(uiPrefs.overlayOpacity));
    root.style.setProperty("--custom-background-position", uiPrefs.backgroundPosition || "center");
    root.style.setProperty("--custom-background-image", uiBackgroundUrl ? `url("${uiBackgroundUrl}")` : "none");
    updateAppearanceUI();
    const toggle = $("#btn-theme-toggle");
    if (toggle) {
      const dark = uiPrefs.theme === "official-dark";
      toggle.innerHTML = `${iconMarkup(dark ? "sun" : "moon")}<span>${dark ? "切换浅色" : "切换深色"}</span>`;
      toggle.setAttribute("aria-label", dark ? "切换浅色主题" : "切换深色主题");
      toggle.title = dark ? "切换浅色主题" : "切换深色主题";
    }
  }

  function updateAppearanceUI() {
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const active = button.dataset.themeChoice === uiPrefs.theme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const color = $("#ui-bg-color");
    const position = $("#ui-bg-position");
    const overlay = $("#ui-bg-overlay");
    const output = $("#ui-bg-overlay-value");
    if (color) color.value = uiPrefs.backgroundColor;
    if (position) position.value = uiPrefs.backgroundPosition;
    if (overlay) overlay.value = String(uiPrefs.overlayOpacity);
    if (output) output.textContent = `${Math.round(uiPrefs.overlayOpacity * 100)}%`;
  }

  function setThemeFeedback(message, error = false) {
    const el = $("#ui-theme-feedback");
    if (!el) return;
    el.textContent = message;
    el.dataset.error = error ? "1" : "0";
  }

  function setUiTheme(theme) {
    if (!UI_THEMES.includes(theme)) return;
    uiPrefs.theme = theme;
    saveUiPrefs();
    applyUiPreferences();
    setThemeFeedback(`已切换到${theme === "official-light" ? "官网浅色" : theme === "official-dark" ? "官网深色" : theme === "eye-care" ? "米黄色护眼" : "自定义"}主题。`);
  }

  async function loadUiBackground() {
    if (uiPrefs.backgroundImageKey !== UI_BACKGROUND_KEY) {
      applyUiPreferences();
      return;
    }
    const value = await idbGet(UI_BACKGROUND_KEY);
    if (!(value instanceof Blob)) {
      uiPrefs.backgroundImageKey = "";
      saveUiPrefs();
      applyUiPreferences();
      return;
    }
    if (uiBackgroundUrl) URL.revokeObjectURL(uiBackgroundUrl);
    uiBackgroundUrl = URL.createObjectURL(value);
    applyUiPreferences();
  }

  async function setUiBackground(file) {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      setThemeFeedback("背景图片只支持 PNG、JPG 或 WEBP。", true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setThemeFeedback("背景图片不能超过 5MB。", true);
      return;
    }
    await idbSet(UI_BACKGROUND_KEY, file);
    if (uiBackgroundUrl) URL.revokeObjectURL(uiBackgroundUrl);
    uiBackgroundUrl = URL.createObjectURL(file);
    uiPrefs.backgroundImageKey = UI_BACKGROUND_KEY;
    uiPrefs.theme = "custom";
    saveUiPrefs();
    applyUiPreferences();
    setThemeFeedback("本地背景图片已保存，只在当前设备显示。");
  }

  async function clearUiBackground() {
    await idbDelete(UI_BACKGROUND_KEY);
    if (uiBackgroundUrl) URL.revokeObjectURL(uiBackgroundUrl);
    uiBackgroundUrl = "";
    uiPrefs.backgroundImageKey = "";
    saveUiPrefs();
    applyUiPreferences();
    setThemeFeedback("已清除本地背景图片。", false);
  }

  async function resetUiPreferences(theme = "official-light") {
    await clearUiBackground();
    uiPrefs = { ...DEFAULT_UI_PREFS, theme };
    saveUiPrefs();
    applyUiPreferences();
    setThemeFeedback(theme === "eye-care" ? "已恢复米黄色护眼主题。" : "已恢复官网浅色主题。", false);
  }

  function mergeProgress(a, b) {
    const out = { ...(a || {}) };
    for (const [id, p] of Object.entries(b || {})) {
      if (!p || typeof p !== "object") continue;
      const cur = out[id];
      if (!cur) out[id] = p;
      else if ((p.updated_at || 0) >= (cur.updated_at || 0)) out[id] = { ...cur, ...p };
    }
    return out;
  }

  function flushPersist() {
    persistTimer = 0;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
    } catch {
      /* quota: IndexedDB still holds it */
    }
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify([...state.picked]));
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(FAVORITE_KEY, JSON.stringify([...state.favorites]));
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(ANNOTATION_KEY, JSON.stringify(state.annotations));
    } catch {
      /* ignore */
    }
    idbSet("progress", state.progress);
    idbSet("picked", [...state.picked]);
    idbSet("favorites", [...state.favorites]);
    idbSet("annotations", state.annotations);
    idbSet("saved_at", Date.now());
    // Node 状态文件是权威源；浏览器存储只负责离线缓存。
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, 240);
  }

  async function hydrateStores() {
    try {
      const [p, pick, savedAt] = await Promise.all([
        idbGet("progress"),
        idbGet("picked"),
        idbGet("saved_at"),
      ]);
      if (!serverStateAvailable && p && typeof p === "object") state.progress = mergeProgress(state.progress, p);
      if (!serverStateAvailable && Array.isArray(pick)) {
        for (const id of pick) state.picked.add(String(id));
      }
      const favorites = await idbGet("favorites");
      if (!serverStateAvailable && Array.isArray(favorites)) {
        for (const id of favorites) state.favorites.add(String(id));
      }
      const annotations = await idbGet("annotations");
      if (!serverStateAvailable && annotations && typeof annotations === "object") state.annotations = { ...state.annotations, ...annotations };
      if (savedAt) state.savedAt = savedAt;
      flushPersist();
    } catch {
      /* stay on localStorage */
    }
  }

  async function hydrateServerState() {
    try {
      const response = await fetch("./api/state", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remote = await response.json();
      if (remote?.progress && typeof remote.progress === "object") state.progress = remote.progress;
      if (Array.isArray(remote?.favorites)) state.favorites = new Set(remote.favorites.map(String));
      if (Array.isArray(remote?.picked)) state.picked = new Set(remote.picked.map(String));
      if (remote?.annotations && typeof remote.annotations === "object") state.annotations = remote.annotations;
      state.remote_activity = remote.remote_activity || null;
      state.last_study = remote.last_study || null;
      serverRevision = Number(remote.revision) || 0;
      serverStateAvailable = true;
      flushPersist();
    } catch {
      serverStateAvailable = false;
    } finally {
      serverStateHydrated = true;
    }
  }

  function scheduleServerStatePersist() {
    // 兼容旧调用点：不再使用整份 PUT。
  }

  async function persistServerState() {
    return null;
  }

  function queueQuestionSync(id, patch) {
    if (!serverStateAvailable || !serverStateHydrated) return;
    const key = String(id);
    serverQuestionQueue.set(key, { ...(serverQuestionQueue.get(key) || {}), ...patch });
    if (serverQuestionTimer) clearTimeout(serverQuestionTimer);
    serverQuestionTimer = setTimeout(flushQuestionSync, 350);
  }

  async function flushQuestionSync() {
    serverQuestionTimer = 0;
    if (!serverStateAvailable || serverStateSyncing || !serverQuestionQueue.size) return;
    serverStateSyncing = true;
    const entries = [...serverQuestionQueue.entries()];
    serverQuestionQueue.clear();
    try {
      for (const [id, patch] of entries) {
        const response = await fetch(`./api/state/questions/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": String(serverRevision) },
          body: JSON.stringify({ ...patch, revision: serverRevision, updated_at: new Date().toISOString() }),
        });
        if (response.status === 409) {
          const conflict = await response.json().catch(() => ({}));
          if (conflict.current) {
            serverRevision = Number(conflict.current.revision) || serverRevision;
            state.progress = conflict.current.progress || state.progress;
            state.favorites = new Set((conflict.current.favorites || []).map(String));
            if (conflict.current.annotations && typeof conflict.current.annotations === "object") state.annotations = conflict.current.annotations;
          }
          entries.forEach(([queuedId, queuedPatch]) => serverQuestionQueue.set(queuedId, queuedPatch));
          break;
        }
        if (!response.ok) throw new Error(`状态写入失败（HTTP ${response.status}）`);
        const result = await response.json();
        serverRevision = Number(result.revision) || serverRevision;
      }
    } catch {
      entries.forEach(([queuedId, queuedPatch]) => serverQuestionQueue.set(queuedId, queuedPatch));
    } finally {
      serverStateSyncing = false;
      if (serverQuestionQueue.size && !serverQuestionTimer) serverQuestionTimer = setTimeout(flushQuestionSync, 900);
    }
  }

  function saveProgress() {
    state.savedAt = Date.now();
    updateStats();
    schedulePersist();
  }

  function loadMode() {
    const m = localStorage.getItem(MODE_KEY);
    return m === "single" ? "single" : "list";
  }

  function saveMode() {
    localStorage.setItem(MODE_KEY, state.mode);
  }

  function updateStats() {
    if (!state.manifest) return;
    const vals = Object.values(state.progress);
    const done = vals.filter((p) => p.mastery === "mastered").length;
    const seen = vals.filter((p) => p.seen).length;
    const forgot = vals.filter((p) => p.error_prone === true).length;
    const today = isoDate(new Date());
    const activeDates = new Set(vals.filter((p) => p.updated_at).map((p) => isoDate(new Date(Number(p.updated_at)))));
    const todayCount = vals.filter((p) => p.updated_at && isoDate(new Date(Number(p.updated_at))) === today).length;
    let streak = 0;
    const cursor = new Date();
    while (activeDates.has(isoDate(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    els.stats.textContent = `共 ${state.manifest.total} 题 · 看过 ${seen} · 掌握 ${done}`;
    if (els.metricTotal) {
      const exam = new Date(2026, 11, 19);
      const days = Math.max(0, Math.ceil((exam.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000));
      els.metricTotal.textContent = String(days);
    }
    if (els.metricSeen) els.metricSeen.textContent = String(todayCount);
    if (els.metricMastered) els.metricMastered.textContent = String(streak);
    if (els.metricForgot) els.metricForgot.textContent = String(state.manifest.total || forgot);
    updateBrowseProgress();
  }

  function updateBrowseProgress() {
    if (!state.queue.length) {
      els.browseProgress.hidden = true;
      return;
    }
    let seen = 0;
    let mastered = 0;
    for (const q of state.queue) {
      const p = progressOf(q.id);
      if (p.seen || p.answered || p.mastery) seen += 1;
      if (p.mastery === "mastered") mastered += 1;
    }
    els.browseProgress.hidden = false;
    const pct = Math.round((seen / state.queue.length) * 100);
    els.progressFill.style.width = `${pct}%`;
    els.progressLabel.textContent = `看过 ${seen}/${state.queue.length} · 掌握 ${mastered}`;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add("hidden"), 1800);
  }

  const fetchInflight = new Map();

  async function fetchJSON(path) {
    if (fetchInflight.has(path)) return fetchInflight.get(path);
    const job = (async () => {
      const res = await fetch(path, { cache: "force-cache" });
      if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`);
      return res.json();
    })();
    fetchInflight.set(path, job);
    try {
      return await job;
    } finally {
      fetchInflight.delete(path);
    }
  }

  function prefetchUrl(href) {
    if (!href || document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  }

  function assetUrl(src) {
    if (!src) return src;
    if (src.startsWith("data:")) return src;
    if (/^https?:\/\//i.test(src)) {
      try {
        const url = new URL(src);
        const match = url.pathname.match(/question-assets\/([0-9a-fA-F]{64})/);
        if (match) return `./data/assets/${match[1]}.png`;
      } catch {}
      return "./assets/missing-image.svg";
    }
    const m = String(src).match(/(?:^|\/)assets\/([0-9a-fA-F]{64})$/);
    if (m) {
      return `./data/assets/${m[1]}.png`;
    }
    if (src.startsWith("assets/")) {
      return `./data/assets/${src.slice("assets/".length).replace(/\.png$/i, "")}.png`;
    }
    return src;
  }

  function renderMarkdown(text) {
    const raw = text || "";
    const slots = [];
    const protect = (s) => {
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
        const i = slots.length;
        slots.push({ display: true, tex: m });
        return `%%MATH${i}%%`;
      });
      s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
        const i = slots.length;
        slots.push({ display: true, tex: m });
        return `%%MATH${i}%%`;
      });
      s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => {
        const i = slots.length;
        slots.push({ display: false, tex: m });
        return `%%MATH${i}%%`;
      });
      s = s.replace(/\$([^\$\n]+?)\$/g, (full, m, offset, whole) => {
        if (whole[offset - 1] === "$" || whole[offset + full.length] === "$") return full;
        const i = slots.length;
        slots.push({ display: false, tex: m });
        return `%%MATH${i}%%`;
      });
      return s;
    };

    let html;
    try {
      const src = protect(raw);
      html =
        typeof marked !== "undefined"
          ? marked.parse(src, { breaks: true })
          : src.replace(/</g, "&lt;").replace(/\n/g, "<br>");
      html = html.replace(/%%MATH(\d+)%%/g, (_, idx) => {
        const item = slots[Number(idx)];
        if (!item || typeof katex === "undefined") {
          return item ? (item.display ? `$$${item.tex}$$` : `$${item.tex}$`) : "";
        }
        try {
          return katex.renderToString(item.tex, {
            displayMode: item.display,
            throwOnError: false,
            strict: "ignore",
          });
        } catch {
          return item.display ? `$$${item.tex}$$` : `$${item.tex}$`;
        }
      });
    } catch {
      html = raw.replace(/</g, "&lt;").replace(/\n/g, "<br>");
    }

    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("img").forEach((img) => {
      img.src = assetUrl(img.getAttribute("src") || "");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = img.alt || "题目配图";
      img.addEventListener("error", () => {
        if (img.dataset.fallback) return;
        img.dataset.fallback = "1";
        img.src = "./assets/missing-image.svg";
      }, { once: true });
    });
    return div.innerHTML;
  }

  function setView(name) {
    if (name !== "browse" && state.chapterMenuOpen) closeChapterMenu({ restoreFocus: false });
    state.view = name;
    els.home.classList.toggle("hidden", name !== "home");
    els.browse.classList.toggle("hidden", name !== "browse");
    els.searchView.classList.toggle("hidden", name !== "search");
    els.feature?.classList.toggle("hidden", name !== "feature");
    document.body.dataset.view = name;
    document.querySelectorAll(".side-link").forEach((el) => {
      const specialNav = state.specialQueue === "todo" ? "mastery" : state.specialQueue === "forgot" ? "retest" : "";
      const active =
        (name === "home" && el.dataset.nav === "home") ||
        (name === "feature" && el.dataset.nav === state.feature) ||
        (name === "browse" && specialNav && el.dataset.nav === specialNav);
      el.classList.toggle("active", active);
    });
    updateChapterHeader();
  }

  function applyModeUI() {
    const list = state.mode === "list";
    const emptyChapter = state.view === "browse" && !state.specialQueue && !state.queue.length;
    els.listMode.classList.toggle("hidden", !list || emptyChapter);
    els.singleMode.classList.toggle("hidden", list || emptyChapter);
    setChapterEmptyState(emptyChapter);
    document.querySelectorAll(".mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === state.mode);
    });
    document.body.dataset.mode = state.mode;
    updateChapterHeader();
  }

  function setMode(mode) {
    if (mode !== "list" && mode !== "single") return;
    state.mode = mode;
    saveMode();
    applyModeUI();
    if (state.view === "browse" && state.queue.length) {
      if (mode === "list") renderFeed(true);
      else renderSingle();
    }
  }

  function findCat(id, nodes = state.categories, trail = []) {
    for (const n of nodes) {
      const t = trail.concat(n);
      if (String(n.id) === String(id)) return t;
      const hit = findCat(id, n.children || [], t);
      if (hit) return hit;
    }
    return null;
  }

  function categoryChildren(node, isRoot = false) {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (isRoot && ["836", "2500"].includes(String(node.id))) {
      return children.filter((child) => child.name === "数三");
    }
    return children;
  }

  function isCategoryLeaf(node) {
    return categoryChildren(node).length === 0;
  }

  function flattenCategoryLeaves(nodes = state.categories, trail = [], isRoot = true, output = []) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (isRoot && String(node.id) === "orphan") continue;
      const nextTrail = trail.concat(node);
      const children = categoryChildren(node, isRoot);
      if (children.length) flattenCategoryLeaves(children, nextTrail, false, output);
      else if (String(node.id) !== "orphan") output.push({ node, trail: nextTrail });
    }
    return output;
  }

  function categoryLeafEntry(id) {
    return flattenCategoryLeaves().find((entry) => String(entry.node.id) === String(id)) || null;
  }

  function chapterRootForTrail(trail) {
    return trail?.[1] || trail?.[0] || null;
  }

  function chapterLeavesFor(id) {
    const trail = findCat(id);
    if (!trail?.length) return [];
    const root = chapterRootForTrail(trail);
    if (!root) return [];
    return flattenCategoryLeaves([root], trail.slice(0, trail.indexOf(root)), false);
  }

  function chapterPathIdsFor(id) {
    return (findCat(id) || []).map((node) => String(node.id));
  }

  function chapterPathNames(ids = state.chapterPathIds) {
    const names = [];
    let nodes = state.categories;
    for (const id of ids) {
      const node = (Array.isArray(nodes) ? nodes : []).find((item) => String(item.id) === String(id));
      if (!node) break;
      names.push(node.name === "模拟哥专区" ? "模拟卷" : node.name);
      nodes = categoryChildren(node, names.length === 1);
    }
    return names;
  }

  function chapterScopedQuestionIds(id) {
    return state.catQuestions[String(id)] || [];
  }

  function setChapterEmptyState(visible, copy = "父级章节只用于展开目录，选择最末级小节后开始刷题。") {
    const empty = Boolean(visible);
    els.chapterEmpty?.classList.toggle("hidden", !empty);
    els.pickBar?.classList.toggle("hidden", empty);
    if (els.chapterEmptyCopy) els.chapterEmptyCopy.textContent = copy;
    if (empty) {
      els.listMode?.classList.add("hidden");
      els.singleMode?.classList.add("hidden");
    }
  }

  function updateChapterHeader() {
    const browsingLeaf = state.view === "browse" && state.currentCatId != null && !state.specialQueue;
    const browsePage = state.view === "browse";
    els.browseNavLeading?.classList.toggle("hidden", state.view !== "browse");
    els.chapterPicker?.classList.toggle("hidden", !browsePage);
    if (els.chapterTrigger) els.chapterTrigger.disabled = !browsePage;
    if (els.chapterTriggerLabel) {
      const entry = browsingLeaf ? categoryLeafEntry(state.currentCatId) : null;
      els.chapterTriggerLabel.textContent = entry?.node?.name || (state.specialQueue === "forgot" ? "错题复测" : state.specialQueue === "todo" ? "掌握地图" : "选择小节");
    }

    const showSectionNav = browsingLeaf && state.queue.length > 0;
    if (els.chapterSectionNav) els.chapterSectionNav.hidden = !showSectionNav;
    if (!showSectionNav) return;

    const leaves = chapterLeavesFor(state.currentCatId);
    const currentIndex = leaves.findIndex((entry) => String(entry.node.id) === String(state.currentCatId));
    const completed = state.queue.filter((question) => {
      const progress = progressOf(question.id);
      return progress.seen === true || progress.mastery !== "not_started";
    }).length;
    if (els.chapterProgressTop) els.chapterProgressTop.textContent = `${completed} / ${state.queue.length}`;
    if (els.prevSection) els.prevSection.disabled = currentIndex <= 0;
    if (els.nextSection) els.nextSection.disabled = currentIndex < 0 || currentIndex >= leaves.length - 1;
  }

  function syncChapterScopeUI() {
    document.querySelectorAll("[data-chapter-scope]").forEach((button) => {
      button.classList.toggle("active", button.dataset.chapterScope === state.scope);
      button.setAttribute("aria-pressed", String(button.dataset.chapterScope === state.scope));
    });
  }

  function renderChapterMenu() {
    if (!els.chapterColumns) return;
    const columns = document.createDocumentFragment();
    let nodes = state.categories.filter((node) => String(node.id) !== "orphan");
    let path = [];
    let depth = 0;
    while (nodes.length) {
      const column = document.createElement("div");
      column.className = "chapter-column";
      column.setAttribute("role", "listbox");
      column.setAttribute("aria-label", depth === 0 ? "学科" : `${path[path.length - 1]?.name || "章节"}下级`);
      const heading = document.createElement("div");
      heading.className = "chapter-column-title";
      heading.textContent = depth === 0 ? "学科" : path[path.length - 1]?.name || "章节";
      column.appendChild(heading);

      const selectedId = state.chapterPathIds[depth];
      let selectedNode = null;
      nodes.forEach((node) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chapter-item";
        button.setAttribute("role", "option");
        button.dataset.chapterId = String(node.id);
        const children = categoryChildren(node, depth === 0);
        const branch = children.length > 0;
        button.classList.toggle("has-children", branch);
        button.classList.toggle("active", String(node.id) === String(selectedId));
        button.setAttribute("aria-selected", String(String(node.id) === String(selectedId)));
        if (branch) button.setAttribute("aria-expanded", String(String(node.id) === String(selectedId)));

        const label = document.createElement("span");
        label.className = "chapter-item-label";
        label.textContent = node.name === "模拟哥专区" ? "模拟卷" : node.name;
        button.appendChild(label);
        const count = Number(node.question_count || chapterScopedQuestionIds(node.id).length || 0);
        if (count > 0) {
          const countEl = document.createElement("small");
          countEl.className = "chapter-item-count";
          countEl.textContent = String(count);
          button.appendChild(countEl);
        }
        if (branch) button.insertAdjacentHTML("beforeend", '<svg class="ui-icon chapter-item-chevron" aria-hidden="true"><use href="#icon-chevron"></use></svg>');
        button.addEventListener("click", () => {
          state.chapterPathIds = state.chapterPathIds.slice(0, depth).concat(String(node.id));
          if (branch) {
            state.chapterMenuRootId = String(node.id);
            renderChapterMenu();
          } else {
            selectChapterLeaf(node, path.concat(node));
          }
        });
        column.appendChild(button);
        if (String(node.id) === String(selectedId)) selectedNode = node;
      });
      columns.appendChild(column);
      if (!selectedNode || !categoryChildren(selectedNode, depth === 0).length) break;
      path = path.concat(selectedNode);
      nodes = categoryChildren(selectedNode, depth === 0);
      depth += 1;
    }
    els.chapterColumns.replaceChildren(columns);
    syncChapterScopeUI();
    if (els.chapterMenuPath) {
      const names = chapterPathNames();
      els.chapterMenuPath.textContent = names.length ? names.join(" / ") : "选择父级目录展开下一层";
    }
    if (els.chapterMenuTitle) {
      const names = chapterPathNames();
      els.chapterMenuTitle.textContent = names[names.length - 1] || "选择一个小节";
    }
    requestAnimationFrame(() => {
      if (els.chapterColumns) els.chapterColumns.scrollLeft = els.chapterColumns.scrollWidth;
      const active = els.chapterColumns?.querySelector(".chapter-item.active");
      active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function openChapterMenu(rootId = null) {
    if (!els.chapterMenu || !state.categories.length) return;
    state.chapterMenuOpen = true;
    const baseId = rootId != null ? rootId : state.currentCatId;
    state.chapterPathIds = baseId != null ? chapterPathIdsFor(baseId) : [];
    state.chapterMenuRootId = baseId == null ? null : String(baseId);
    els.chapterMenu.classList.remove("hidden");
    els.chapterTrigger?.setAttribute("aria-expanded", "true");
    renderChapterMenu();
    requestAnimationFrame(() => {
      const last = els.chapterColumns?.lastElementChild;
      const selected = last?.querySelector(".chapter-item.active");
      (selected || last?.querySelector(".chapter-item"))?.focus();
    });
  }

  function closeChapterMenu({ restoreFocus = true } = {}) {
    state.chapterMenuOpen = false;
    els.chapterMenu?.classList.add("hidden");
    els.chapterTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) els.chapterTrigger?.focus();
  }

  function closeMoreMenu({ restoreFocus = false } = {}) {
    els.topbarMore?.classList.add("hidden");
    els.moreTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) els.moreTrigger?.focus();
  }

  function focusChapterItem(column, index) {
    const items = [...(column?.querySelectorAll(".chapter-item") || [])];
    if (!items.length) return;
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function handleChapterMenuKeydown(event) {
    if (!state.chapterMenuOpen) return;
    const active = event.target.closest?.(".chapter-item");
    const columns = [...(els.chapterColumns?.querySelectorAll(".chapter-column") || [])];
    const currentColumn = active?.closest(".chapter-column") || columns[columns.length - 1];
    const items = [...(currentColumn?.querySelectorAll(".chapter-item") || [])];
    const currentIndex = Math.max(0, items.indexOf(active));

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const targetIndex = event.key === "ArrowDown" ? currentIndex + 1 : event.key === "ArrowUp" ? currentIndex - 1 : event.key === "Home" ? 0 : items.length - 1;
      focusChapterItem(currentColumn, targetIndex);
      return;
    }
    if (event.key === "ArrowRight" && active?.classList.contains("has-children")) {
      event.preventDefault();
      active.click();
      requestAnimationFrame(() => focusChapterItem(els.chapterColumns?.lastElementChild, 0));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (state.chapterPathIds.length) {
        state.chapterPathIds = state.chapterPathIds.slice(0, -1);
        state.chapterMenuRootId = state.chapterPathIds[state.chapterPathIds.length - 1] || null;
        renderChapterMenu();
        requestAnimationFrame(() => {
          const last = els.chapterColumns?.lastElementChild;
          const selected = last?.querySelector(".chapter-item.active");
          (selected || last?.querySelector(".chapter-item"))?.focus();
        });
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (active) {
        event.preventDefault();
        active.click();
      }
    }
  }

  async function selectChapterLeaf(node, trail) {
    if (!isCategoryLeaf(node)) return;
    if (els.chapterMenuFeedback) els.chapterMenuFeedback.textContent = "加载小节题目…";
    const ok = await openCategory(node.id, null, { fromChapterMenu: true, silent: true });
    if (ok) closeChapterMenu({ restoreFocus: false });
    else if (els.chapterMenuFeedback) els.chapterMenuFeedback.textContent = "当前题库范围下没有可用题目，请切换“完整 / 核心 / 真题”。";
  }

  async function goToAdjacentChapter(delta) {
    if (!state.currentCatId || state.specialQueue) return;
    const leaves = chapterLeavesFor(state.currentCatId);
    const currentIndex = leaves.findIndex((entry) => String(entry.node.id) === String(state.currentCatId));
    if (currentIndex < 0) return;
    for (let index = currentIndex + delta; index >= 0 && index < leaves.length; index += delta) {
      const entry = leaves[index];
      const ok = await openCategory(entry.node.id, null, { silent: true });
      if (ok) return;
    }
    toast(delta < 0 ? "已经是本章第一节" : "已经是本章最后一节");
    updateChapterHeader();
  }

  function progressOf(id) {
    return state.progress[String(id)] || {};
  }

  function cardState(id) {
    const key = String(id);
    if (!state.cardUI.has(key)) {
      state.cardUI.set(key, { showAnswer: false, selected: new Set() });
    }
    return state.cardUI.get(key);
  }

  function setMastery(id, mastery) {
    const key = String(id);
    const cur = state.progress[key] || {};
    const at = Date.now();
    const nextMastery = mastery === "forgot" ? "learning" : mastery;
    state.progress[key] = { ...cur, mastery: nextMastery, seen: true, updated_at: at, mastery_updated_at: at };
    queueQuestionSync(key, { mastery: nextMastery, seen: true });
    saveProgress();
    refreshCardChrome(id);
    if (state.mode === "single") {
      renderMasteryChips();
      renderListStrip();
    }
    updateChapterHeader();
  }

  function markSeen(id) {
    const key = String(id);
    const cur = state.progress[key] || {};
    if (!cur.seen) {
      state.progress[key] = { ...cur, seen: true, updated_at: Date.now() };
      queueQuestionSync(key, { seen: true });
      saveProgress();
      refreshCardChrome(id);
      updateChapterHeader();
    }
  }

  function markAnswered(id, ok) {
    const key = String(id);
    const cur = state.progress[key] || {};
    state.progress[key] = {
      ...cur,
      seen: true,
      answered: true,
      last_ok: !!ok,
      updated_at: Date.now(),
      mastery: cur.mastery || "learning",
      error_prone: ok ? cur.error_prone === true : true,
    };
    queueQuestionSync(key, { mastery: state.progress[key].mastery, error_prone: state.progress[key].error_prone === true, seen: true, answered: true, last_ok: !!ok });
    saveProgress();
    refreshCardChrome(id);
    updateChapterHeader();
  }

  function refreshCardChrome(id) {
    const card = els.qFeed?.querySelector(`.q-card[data-id="${id}"]`);
    if (!card) {
      updateBrowseProgress();
      return;
    }
    const p = progressOf(id);
    card.dataset.mastery = p.mastery || "not_started";
    if (p.seen) card.dataset.seen = "1";
    const badge = card.querySelector(".mastery-badge");
    if (badge) {
      const m = p.mastery || "not_started";
      badge.textContent = MASTERY_LABEL[m] || m;
      badge.dataset.mastery = m;
    }
    const errorBadge = card.querySelector(".attention-mark");
    if (errorBadge) errorBadge.classList.toggle("hidden", p.error_prone !== true);
    card.querySelector("[data-error-toggle]")?.classList.toggle("active", p.error_prone === true);
    card.querySelectorAll(".chip[data-mastery]").forEach((el) => {
      el.classList.toggle("active", el.dataset.mastery === (p.mastery || "not_started"));
    });
    updateBrowseProgress();
  }

  const shardInflight = new Map();

  async function ensureShard(name) {
    if (state.shards.has(name)) return state.shards.get(name);
    if (shardInflight.has(name)) return shardInflight.get(name);
    const meta = state.manifest.shards[name];
    if (!meta) throw new Error("未知分片: " + name);
    const job = (async () => {
      const list = await fetchJSON(`${DATA}/${meta.file}`);
      const map = new Map(list.map((q) => [q.id, q]));
      state.shards.set(name, map);
      return map;
    })();
    shardInflight.set(name, job);
    try {
      return await job;
    } finally {
      shardInflight.delete(name);
    }
  }

  let indexesReady = null;

  function ensureIndexes() {
    if (state.idIndex && Object.keys(state.idIndex).length) return Promise.resolve();
    if (!indexesReady) {
      indexesReady = Promise.all([
        fetchJSON(`${DATA}/category_questions.json`),
        fetchJSON(`${DATA}/id_index.json`),
      ]).then(([catQuestions, idIndex]) => {
        state.catQuestions = catQuestions;
        state.idIndex = idIndex;
      });
    }
    return indexesReady;
  }

  function prefetchCategory(catId) {
    ensureIndexes().then(() => {
      const ids = state.catQuestions[String(catId)] || [];
      const names = new Set();
      for (const id of ids) {
        const n = state.idIndex[String(id)];
        if (n) names.add(n);
      }
      for (const name of names) {
        const meta = state.manifest && state.manifest.shards[name];
        if (meta) prefetchUrl(`${DATA}/${meta.file}`);
      }
    }).catch(() => {});
  }

  function questionMarkdown(q) {
    const parts = [];
    if (q.stem) parts.push(String(q.stem).trim());
    const opts = q.options || [];
    if (opts.length) {
      parts.push(
        opts
          .map((opt, i) => {
            const lab = opt.label || String.fromCharCode(65 + i);
            return `${lab}. ${opt.content_md || ""}`.trimEnd();
          })
          .join("\n")
      );
    }
    if (q.answer) parts.push(`答案\n${String(q.answer).trim()}`);
    if (q.explanation) parts.push(`解析\n${String(q.explanation).trim()}`);
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  async function copyQuestionMarkdown(q) {
    if (!q) return;
    const ok = await copyText(questionMarkdown(q));
    toast(ok ? "已复制 Markdown" : "复制失败");
  }

  async function getQuestion(id) {
    const name = state.idIndex[String(id)];
    if (!name) return null;
    const map = await ensureShard(name);
    return map.get(Number(id)) || map.get(id) || null;
  }

  async function loadQueueQuestions(ids) {
    const byShard = new Map();
    for (const id of ids) {
      const name = state.idIndex[String(id)];
      if (!name) continue;
      if (!byShard.has(name)) byShard.set(name, []);
      byShard.get(name).push(id);
    }
    await Promise.all([...byShard.keys()].map((n) => ensureShard(n)));
    const out = [];
    for (const id of ids) {
      const q = await getQuestion(id);
      if (q) out.push(q);
    }
    return out;
  }

  function filterQuestions(qs) {
    return qs.filter((q) => {
      if ((state.filterCore || state.scope === "core") && !q.is_core) return false;
      if (state.scope === "real") {
        const source = `${q.source || ""} ${q.year || ""} ${q.category || ""}`;
        if (!/(真题|历年|模拟卷|数一|数二|数三)/.test(source)) return false;
      }
      if (state.filterTodo) {
        const p = progressOf(q.id);
        if (p.mastery === "mastered") return false;
      }
      return true;
    });
  }

  function renderTree(nodes = state.categories, depth = 0) {
    const frag = document.createDocumentFragment();
    const list = Array.isArray(nodes) ? nodes : [];
    const chinese = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    let childIndex = 0;
    for (const n of list) {
      if (depth === 0 && String(n.id) === "orphan") continue;
      const wrap = document.createElement("div");
      wrap.className = "cat-node";
      wrap.dataset.id = n.id;
      wrap.dataset.depth = String(depth);

      const root = depth === 0;
      const sourceChildren = Array.isArray(n.children) ? n.children : [];
      const children = root && ["836", "2500"].includes(String(n.id))
        ? sourceChildren.filter((child) => child.name === "数三")
        : sourceChildren;
      const hasKids = root && children.length > 0;
      const row = document.createElement("div");
      row.className = "cat-line";

      const twisty = root ? document.createElement("button") : null;
      if (twisty) {
        twisty.type = "button";
        twisty.className = "cat-twisty";
        twisty.textContent = hasKids ? "⌄" : "";
        twisty.disabled = !hasKids;
        twisty.setAttribute("aria-label", "展开/折叠");
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-row";
      btn.dataset.catId = n.id;
      if (String(state.currentCatId) === String(n.id)) btn.classList.add("active");
      const label = root ? (n.name === "模拟哥专区" ? "模拟卷" : n.name) : `${chinese[childIndex] ? `（${chinese[childIndex]}）` : ""}${escapeHtml(n.name)}`;
      btn.innerHTML = `<span class="cat-name">${root ? escapeHtml(label) : label}</span>`;

      const kids = document.createElement("div");
      kids.className = "cat-children";
      if (hasKids) kids.appendChild(renderTree(children, depth + 1));

      if (twisty) {
        twisty.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!hasKids) return;
          const collapsed = kids.classList.toggle("collapsed");
          twisty.textContent = collapsed ? "›" : "⌄";
        });
      }
      if (root) {
        btn.addEventListener("click", () => {
          if (!hasKids) return;
          const collapsed = kids.classList.toggle("collapsed");
          if (twisty) twisty.textContent = collapsed ? "›" : "⌄";
        });
      } else {
        btn.addEventListener("pointerenter", () => prefetchCategory(n.id), { once: true });
        btn.addEventListener("click", () => openCategory(n.id));
      }

      if (twisty) row.append(btn, twisty);
      else row.append(btn);
      wrap.append(row);
      if (hasKids) wrap.append(kids);
      frag.appendChild(wrap);
      if (!root) childIndex += 1;
    }
    return frag;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function paintTree() {
    els.catTree.innerHTML = "";
    els.catTree.appendChild(renderTree(state.categories, 0));
  }

  function renderHome() {
    els.homeCards.innerHTML = "";
    for (const n of state.categories) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "home-card";
      const done = countMasteredInCat(n.id);
      const total = n.question_count || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      b.innerHTML = `
        <div class="home-card-top">
          <strong>${escapeHtml(n.name)}</strong>
          <span class="home-card-count">${total} 题</span>
        </div>
        <div class="home-card-bar"><i style="width:${pct}%"></i></div>
        <span class="home-card-meta">${done ? `已掌握 ${done}` : "尚未开始"}</span>`;
      b.addEventListener("pointerenter", () => prefetchCategory(n.id), { once: true });
      b.addEventListener("click", () => openCategory(n.id));
      els.homeCards.appendChild(b);
    }
    renderHeroProgress();
    renderActivityHeatmap();
    updateStats();
  }

  function renderActivityHeatmap() {
    const grid = $("#heatmap-grid");
    if (!grid) return;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 10 * 7 - end.getDay());
    const counts = new Map();
    const remoteCounts = extractActivityCounts(state.remote_activity);
    for (const [date, count] of remoteCounts) counts.set(date, count);
    for (const progress of Object.values(state.progress)) {
      const time = Number(progress.updated_at || 0);
      if (!time) continue;
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) continue;
      const key = isoDate(date);
      if (!counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const summary = $("#heatmap-summary");
    if (summary) summary.textContent = `已记录 ${[...counts.values()].filter((count) => count > 0).length} 个作答日`;
    const fragment = document.createDocumentFragment();
    for (let week = 0; week < 11; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + week * 7 + day);
        const count = counts.get(isoDate(date)) || 0;
        const cell = document.createElement("i");
        cell.className = "heatmap-cell";
        cell.dataset.level = count >= 8 ? "4" : count >= 5 ? "3" : count >= 3 ? "2" : count >= 1 ? "1" : "0";
        cell.title = `${isoDate(date)} · ${count} 题`;
        fragment.appendChild(cell);
      }
    }
    grid.replaceChildren(fragment);
  }

  function extractActivityCounts(value) {
    const counts = new Map();
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      for (const [key, value] of Object.entries(node)) {
        const dateMatch = String(key).match(/^\d{4}-\d{2}-\d{2}$/);
        if (dateMatch) {
          const count = typeof value === "number" ? value : Number(value?.count ?? value?.total ?? value?.practice_count ?? 0);
          if (Number.isFinite(count)) counts.set(key, count);
        } else if (value && typeof value === "object") {
          const date = String(value.date ?? value.day ?? value.activity_date ?? "");
          if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const count = Number(value.count ?? value.total ?? value.practice_count ?? value.questions ?? 0);
            if (Number.isFinite(count)) counts.set(date, count);
          }
          visit(value);
        }
      }
    };
    visit(value);
    return counts;
  }

  function renderHeroProgress() {
    const chapter = $("#hero-chapter");
    const date = $("#hero-date");
    const doneEl = $("#hero-done");
    const remainingEl = $("#hero-remaining");
    const fill = $("#hero-progress-fill");
    if (!chapter || !date || !doneEl || !remainingEl || !fill) return;
    const records = Object.values(state.progress);
    const latest = records.reduce((current, item) => Number(item.updated_at || 0) > Number(current?.updated_at || 0) ? item : current, null);
    chapter.textContent = state.crumb || (latest ? "最近学习的题目" : "选择一个章节开始学习");
    date.textContent = latest?.updated_at ? `最近作答 ${isoDate(new Date(Number(latest.updated_at)))}` : "最近作答 —";
    const buckets = progressBuckets();
    const total = Number(state.manifest?.total || 0);
    const done = buckets.mastered.length;
    const remaining = Math.max(0, total - done);
    const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    doneEl.textContent = `已完成 ${done} 题`;
    remainingEl.textContent = `还剩 ${remaining} 题`;
    fill.style.width = `${percent}%`;
  }

  function countMasteredInCat(catId) {
    const ids = state.catQuestions[String(catId)] || [];
    let n = 0;
    for (const id of ids) {
      if (progressOf(id).mastery === "mastered") n += 1;
    }
    return n;
  }

  async function openCategory(catId, startId = null, { silent = false } = {}) {
    await ensureIndexes();
    const trail = findCat(catId) || [];
    const node = trail[trail.length - 1];
    if (!node) {
      if (!silent) toast("章节不存在");
      return false;
    }

    if (!isCategoryLeaf(node)) {
      state.specialQueue = null;
      state.currentCatId = null;
      state.chapterPathIds = trail.map((item) => String(item.id));
      state.chapterMenuRootId = String(node.id);
      state.crumb = trail.map((item) => item.name).join(" / ") || "练习";
      state.queue = [];
      state.index = 0;
      setView("browse");
      els.crumb.textContent = `${state.crumb} · 请选择小节`;
      els.browseHeading.textContent = state.crumb;
      els.browseSub.textContent = "选择最末级小节开始刷题";
      paintTree();
      setNavActive(null);
      applyModeUI();
      openChapterMenu(node.id);
      return false;
    }

    const ids = state.catQuestions[String(node.id)] || [];
    if (!ids.length) {
      if (!silent) toast("该小节暂无题目");
      return false;
    }

    const title = trail.map((item) => item.name).join(" / ") || "练习";
    els.crumb.textContent = title + " · 加载中…";
    let qs = await loadQueueQuestions(ids);
    qs = filterQuestions(qs);
    if (!qs.length) {
      if (!silent) toast("当前题库范围下没有可用题目");
      return false;
    }

    state.specialQueue = null;
    state.currentCatId = String(node.id);
    state.chapterPathIds = trail.map((item) => String(item.id));
    state.chapterMenuRootId = String(node.id);
    state.crumb = title;
    beginBrowse(qs, title, startId);
    queueLastStudyPosition();
    return true;
  }

  async function openSpecial(kind) {
    await ensureIndexes();
    state.specialQueue = kind;
    state.currentCatId = null;
    paintTree();
    setNavActive(kind);

    const ids = Object.keys(state.progress).filter((id) => {
      const p = state.progress[id];
      if (kind === "todo") return p.mastery && p.mastery !== "mastered";
      if (kind === "forgot") return p.error_prone === true;
      return false;
    });

    // also include seen-but-not-mastered for todo if none marked
    if (kind === "todo" && !ids.length) {
      for (const [id, p] of Object.entries(state.progress)) {
        if (p.seen && p.mastery !== "mastered") ids.push(id);
      }
    }

    const title = kind === "forgot" ? "易错题" : "未掌握";
    state.crumb = title;
    els.crumb.textContent = title + " · 加载中…";

    if (!ids.length) {
      toast(kind === "forgot" ? "还没有标记易错的题" : "还没有未掌握的题");
      els.crumb.textContent = title;
      setView("home");
      return;
    }

    let qs = await loadQueueQuestions(ids);
    qs = filterQuestions(qs);
    if (!qs.length) {
      toast("筛选后没有题目");
      setView("home");
      return;
    }
    beginBrowse(qs, title, null);
  }

  function setNavActive(kind) {
    const navKind = kind === "todo" ? "mastery" : kind === "forgot" ? "retest" : kind;
    document.querySelectorAll(".side-link").forEach((el) => {
      const nav = el.dataset.nav;
      el.classList.toggle(
        "active",
        (kind === null && nav === "home" && state.view === "home") ||
          (navKind && nav === navKind)
      );
    });
  }

  function beginBrowse(qs, title, startId) {
    state.queue = qs;
    state.index = 0;
    state.cardUI = new Map();
    state.renderedCount = 0;
    state.showAnswer = false;
    state.selected = new Set();

    if (startId != null) {
      const i = qs.findIndex((q) => Number(q.id) === Number(startId));
      if (i >= 0) state.index = i;
    }

    setView("browse");
    applyModeUI();
    els.crumb.textContent = `${title} · ${qs.length} 题`;
    els.browseHeading.textContent = title;
    els.browseSub.textContent = `共 ${qs.length} 题` + (state.mode === "list" ? " · 列表连续浏览" : " · 单题专注");
    updateBrowseProgress();

    if (state.mode === "list") {
      // if jumping to a specific id, ensure it's in the first batch window
      if (startId != null && state.index > 0) {
        state.renderedCount = 0;
        renderFeed(true);
        // expand pages until target is rendered
        while (state.renderedCount <= state.index && state.renderedCount < state.queue.length) {
          appendFeedPage();
        }
        requestAnimationFrame(() => {
          const el = els.qFeed.querySelector(`.q-card[data-id="${startId}"]`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else {
        renderFeed(true);
      }
    } else {
      renderSingle();
    }

    if (window.innerWidth <= 900) els.sidebar.classList.remove("open");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    updateChapterHeader();
  }

  function currentQ() {
    return state.queue[state.index] || null;
  }

  /* ---------- LIST MODE ---------- */

  function renderFeed(reset) {
    if (reset) {
      els.qFeed.innerHTML = "";
      state.renderedCount = 0;
      feedLoading = false;
    }
    ensureFeedSentinel();
    appendFeedPage();
    refreshPickUI();
  }

  let feedLoading = false;
  let feedSentinelObs = null;

  function ensureFeedSentinel() {
    let tip = document.getElementById("feed-sentinel");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "feed-sentinel";
      tip.className = "feed-sentinel";
      tip.setAttribute("aria-hidden", "true");
      els.feedFoot.before(tip);
    }
    if (!feedSentinelObs && "IntersectionObserver" in window) {
      feedSentinelObs = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          if (state.view !== "browse" || state.mode !== "list") return;
          if (els.loadMore.disabled || feedLoading) return;
          appendFeedPage();
        },
        { root: null, rootMargin: "240px 0px", threshold: 0 }
      );
      feedSentinelObs.observe(tip);
    }
    return tip;
  }

  function appendFeedPage() {
    if (feedLoading) return false;
    const start = state.renderedCount;
    const end = Math.min(state.queue.length, start + PAGE_SIZE);
    if (start >= end) {
      if (start > 0) {
        els.feedStatus.textContent = "已全部加载";
        els.loadMore.disabled = true;
      }
      return false;
    }

    feedLoading = true;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      frag.appendChild(buildCard(state.queue[i], i));
    }
    els.qFeed.appendChild(frag);
    state.renderedCount = end;

    const remain = state.queue.length - end;
    els.loadMore.disabled = remain <= 0;
    els.feedStatus.textContent =
      remain > 0
        ? `已显示 ${end} / ${state.queue.length} · 还有 ${remain} 题`
        : `共 ${state.queue.length} 题 · 已全部显示`;

    observeCards();
    ensureFeedSentinel();
    renderShortcutHints();

    // unlock after paint; next page only when sentinel intersects again
    requestAnimationFrame(() => {
      setTimeout(() => {
        feedLoading = false;
      }, 280);
    });
    return true;
  }

  let cardObserver = null;
  function observeCards() {
    if (!("IntersectionObserver" in window)) {
      // fallback: mark all rendered
      els.qFeed.querySelectorAll(".q-card").forEach((c) => markSeen(c.dataset.id));
      return;
    }
    if (!cardObserver) {
      cardObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              markSeen(e.target.dataset.id);
              cardObserver.unobserve(e.target);
            }
          }
        },
        { root: null, rootMargin: "80px", threshold: 0.2 }
      );
    }
    els.qFeed.querySelectorAll(".q-card:not([data-observed])").forEach((c) => {
      c.dataset.observed = "1";
      cardObserver.observe(c);
    });
  }

  function buildCard(q, index) {
    const ui = cardState(q.id);
    const p = progressOf(q.id);
    const mastery = p.mastery || "not_started";
    const li = document.createElement("li");
    li.className = "q-card dg-question-card";
    li.dataset.id = q.id;
    li.dataset.mastery = mastery;
    if (p.seen) li.dataset.seen = "1";
    li.id = `q-${q.id}`;

    const picked = isPicked(q.id);
    if (picked) li.classList.add("is-picked");

    const head = document.createElement("div");
    head.className = "q-card-head";
    head.innerHTML = `
      <div class="q-card-index">
        <label class="pick-check" title="勾选导出">
          <input type="checkbox" data-pick-id="${q.id}" ${picked ? "checked" : ""} />
        </label>
        <span class="q-num">${index + 1}</span>
        <span class="mastery-badge" data-mastery="${mastery}">${MASTERY_LABEL[mastery]}</span>
        <button type="button" class="attention-mark ${p.error_prone ? "" : "hidden"}" data-error-toggle="${q.id}" aria-pressed="${p.error_prone === true}">易错</button>
      </div>
      <div class="q-card-meta">${escapeHtml(q.source || "未知来源")} · ${escapeHtml(TYPE_LABEL[q.type] || q.type || "题目")} · #${q.id}</div>`;
    head.querySelector("[data-pick-id]").addEventListener("change", (e) => {
      setPicked(q.id, e.target.checked);
    });

    head.querySelector("[data-error-toggle]")?.addEventListener("click", () => setErrorProne(q.id, !progressOf(q.id).error_prone));

    const path = document.createElement("div");
    path.className = "q-path";
    path.textContent = q.category_path || "";

    const stem = document.createElement("div");
    stem.className = "md q-stem";
    stem.innerHTML = renderMarkdown(q.stem);

    const options = Array.isArray(q.options) && q.options.length ? document.createElement("div") : null;
    if (options) {
      options.className = "question-options dg-question__choices";
      renderOptionsInto(options, q, ui);
    }

    const actions = document.createElement("div");
    actions.className = "q-actions";
    const ansBtn = document.createElement("button");
    ansBtn.type = "button";
    ansBtn.className = "btn primary";
    ansBtn.dataset.shortcutLabel = "answer";
    ansBtn.innerHTML = shortcutButtonMarkup(ui.showAnswer ? "隐藏答案" : "显示答案", "answer");
    ansBtn.addEventListener("click", () => {
      ui.showAnswer = !ui.showAnswer;
      if (ui.showAnswer) {
        const ok = gradeChoice(q, ui.selected);
        if (ok != null) markAnswered(q.id, ok);
        else markSeen(q.id);
      }
      // re-render this card body parts
      rebuildCardBody(li, q, index);
    });

    const focusBtn = document.createElement("button");
    focusBtn.type = "button";
    focusBtn.className = "btn secondary";
    focusBtn.dataset.shortcutLabel = "focus";
    focusBtn.innerHTML = shortcutButtonMarkup("进入单题", "focus");
    focusBtn.title = "在单题模式中打开";
    focusBtn.addEventListener("click", () => {
      state.index = index;
      setMode("single");
    });

    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "btn ai-action";
    aiBtn.dataset.shortcutLabel = "ai";
    aiBtn.innerHTML = shortcutButtonMarkup("AI 解答", "ai", iconMarkup("spark"));
    aiBtn.addEventListener("click", () => openAiForQuestion(q));

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn ghost";
    copyBtn.dataset.shortcutLabel = "copy";
    copyBtn.innerHTML = shortcutButtonMarkup("复制 Markdown", "copy");
    copyBtn.title = "复制本题源 Markdown";
    copyBtn.addEventListener("click", () => copyQuestionMarkdown(q));

    const favoriteBtn = document.createElement("button");
    favoriteBtn.type = "button";
    favoriteBtn.className = "btn ghost";
    favoriteBtn.dataset.shortcutLabel = "favorite";
    favoriteBtn.dataset.favoriteId = String(q.id);
    favoriteBtn.innerHTML = shortcutButtonMarkup(isFavorite(q.id) ? "已收藏" : "收藏", "favorite");
    favoriteBtn.setAttribute("aria-pressed", String(isFavorite(q.id)));
    if (isFavorite(q.id)) favoriteBtn.classList.add("active");
    favoriteBtn.addEventListener("click", () => setFavorite(q.id, !isFavorite(q.id)));

    const noteBtn = document.createElement("button");
    noteBtn.type = "button";
    noteBtn.className = "btn ghost";
    noteBtn.dataset.shortcutLabel = "note";
    noteBtn.innerHTML = shortcutButtonMarkup("批注", "note", iconMarkup("note"));
    noteBtn.addEventListener("click", () => openNoteForQuestion(q));

    actions.append(ansBtn, focusBtn, aiBtn, copyBtn, favoriteBtn, noteBtn);

    const masteryRow = document.createElement("div");
    masteryRow.className = "mastery-row dg-mastery-control";
    masteryRow.innerHTML = `<span class="mastery-label">掌握程度</span>`;
    for (const [key, label] of Object.entries({ not_started: "未开始", learning: "学习中", mastered: "已掌握" })) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.shortcutLabel = key === "not_started" ? "mastery1" : key === "learning" ? "mastery2" : "mastery3";
      chip.dataset.mastery = key;
      chip.innerHTML = shortcutButtonMarkup(label, chip.dataset.shortcutLabel);
      if (key === mastery) chip.classList.add("active");
      chip.addEventListener("click", () => setMastery(q.id, key));
      masteryRow.appendChild(chip);
    }
    const errorToggle = document.createElement("button");
    errorToggle.type = "button";
    errorToggle.className = "chip danger";
    errorToggle.dataset.shortcutLabel = "error";
    errorToggle.dataset.errorToggle = q.id;
    errorToggle.innerHTML = shortcutButtonMarkup("易错", "error");
    errorToggle.setAttribute("aria-pressed", String(p.error_prone === true));
    if (p.error_prone === true) errorToggle.classList.add("active");
    errorToggle.addEventListener("click", () => setErrorProne(q.id, !progressOf(q.id).error_prone));
    masteryRow.appendChild(errorToggle);

    const answerBox = document.createElement("div");
    answerBox.className = "answer-box" + (ui.showAnswer ? "" : " hidden");
    if (ui.showAnswer) {
      answerBox.innerHTML = `
        <div class="answer-block">
          <h3>答案</h3>
          <div class="md">${renderMarkdown(q.answer || "（无答案）")}</div>
        </div>
        <div class="answer-block">
          <h3>解析</h3>
          <div class="md">${renderMarkdown(q.explanation || "（无解析）")}</div>
        </div>`;
    }

    li.append(head, path, stem, ...(options ? [options] : []), actions, masteryRow, answerBox);
    refreshFavoriteUI();
    return li;
  }

  function rebuildCardBody(li, q, index) {
    const next = buildCard(q, index);
    li.replaceWith(next);
    next.dataset.observed = "1";
    // keep in view roughly
  }

  function renderOptionsInto(container, q, ui) {
    container.innerHTML = "";
    const opts = q.options || [];
    const multi = q.type === "multiple_choice";
    opts.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      const lab = opt.label || String.fromCharCode(65 + i);
      const L = lab.toUpperCase();
      b.innerHTML = `<span class="opt-lab">${escapeHtml(lab)}</span><div class="md">${renderMarkdown(opt.content_md || "")}</div>`;
      if (ui.selected.has(L)) b.classList.add("selected");
      if (ui.showAnswer && q.correct_labels && q.correct_labels.length) {
        if (q.correct_labels.map((x) => String(x).toUpperCase()).includes(L)) b.classList.add("correct");
        else if (ui.selected.has(L)) b.classList.add("wrong");
      }
      b.addEventListener("click", () => {
        if (multi) {
          if (ui.selected.has(L)) ui.selected.delete(L);
          else ui.selected.add(L);
        } else {
          ui.selected = new Set([L]);
        }
        // update selection styles without full rebuild when answer hidden
        if (!ui.showAnswer) {
          container.querySelectorAll(".opt").forEach((el) => el.classList.remove("selected"));
          if (multi) {
            // rebuild simple
            renderOptionsInto(container, q, ui);
          } else {
            b.classList.add("selected");
            const ok = gradeChoice(q, ui.selected);
            if (ok != null) markAnswered(q.id, ok);
          }
        } else {
          const card = container.closest(".q-card");
          const idx = state.queue.findIndex((x) => Number(x.id) === Number(q.id));
          if (card) rebuildCardBody(card, q, idx >= 0 ? idx : 0);
        }
      });
      container.appendChild(b);
    });
  }

  /* ---------- SINGLE MODE ---------- */

  function renderSingle() {
    const q = currentQ();
    if (!q) return;
    const p = progressOf(q.id);
    markSeen(q.id);

    els.qPos.textContent = `${state.index + 1} / ${state.queue.length}`;
    els.qSource.textContent = q.source || "未知来源";
    els.qType.textContent = TYPE_LABEL[q.type] || q.type || "题目";
    els.qId.textContent = `#${q.id}`;
    $("#q-single-num").textContent = state.index + 1;
    $("#q-card-meta").textContent = `${q.source || "未知来源"} · ${TYPE_LABEL[q.type] || q.type || "题目"} · #${q.id}`;
    const badge = $("#single-mastery-badge");
    if (badge) { badge.textContent = MASTERY_LABEL[p.mastery || "not_started"]; badge.dataset.mastery = p.mastery || "not_started"; }
    $("#single-error-badge")?.classList.toggle("hidden", p.error_prone !== true);
    els.qPath.textContent = q.category_path || "";
    els.qStem.innerHTML = renderMarkdown(q.stem);

    els.qOptions.innerHTML = "";
    els.qOptions.className = "question-options dg-question__choices";
    const opts = q.options || [];
    const multi = q.type === "multiple_choice";
    opts.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      const lab = opt.label || String.fromCharCode(65 + i);
      b.innerHTML = `<span class="opt-lab">${escapeHtml(lab)}</span><div class="md">${renderMarkdown(opt.content_md || "")}</div>`;
      if (state.selected.has(lab.toUpperCase())) b.classList.add("selected");
      b.addEventListener("click", () => {
        const L = lab.toUpperCase();
        if (multi) {
          if (state.selected.has(L)) state.selected.delete(L);
          else state.selected.add(L);
        } else {
          state.selected = new Set([L]);
        }
        renderSingle();
        if (!multi && state.selected.size) {
          const ok = gradeChoice(q, state.selected);
          if (ok != null) markAnswered(q.id, ok);
        }
      });
      if (state.showAnswer && q.correct_labels && q.correct_labels.length) {
        const L = lab.toUpperCase();
        if (q.correct_labels.map((x) => String(x).toUpperCase()).includes(L)) b.classList.add("correct");
        else if (state.selected.has(L)) b.classList.add("wrong");
      }
      els.qOptions.appendChild(b);
    });

    els.answerBox.classList.toggle("hidden", !state.showAnswer);
    if (state.showAnswer) {
      els.qAnswer.innerHTML = renderMarkdown(q.answer || "（无答案）");
      els.qExpl.innerHTML = renderMarkdown(q.explanation || "（无解析）");
      const answerButton = $("#btn-toggle-answer");
      if (answerButton) answerButton.innerHTML = shortcutButtonMarkup("隐藏答案", "answer");
    } else {
      const answerButton = $("#btn-toggle-answer");
      if (answerButton) answerButton.innerHTML = shortcutButtonMarkup("显示答案", "answer");
    }

    $("#btn-prev").disabled = state.index <= 0;
    $("#btn-next").disabled = state.index >= state.queue.length - 1;
    const singlePick = $("#single-pick");
    if (singlePick) singlePick.checked = isPicked(q.id);
    const favoriteButton = $("#btn-toggle-favorite");
    if (favoriteButton) {
      favoriteButton.dataset.favoriteId = String(q.id);
      refreshFavoriteUI();
    }
    renderMasteryChips();
    const errorToggle = $("#single-error-toggle");
    if (errorToggle) {
      errorToggle.classList.toggle("active", p.error_prone === true);
      errorToggle.setAttribute("aria-pressed", String(p.error_prone === true));
    }
    renderListStrip();
    updateBrowseProgress();
    renderShortcutHints();
  }

  function gradeChoice(q, selectedSet) {
    const labels = (q.correct_labels || []).map((x) => String(x).toUpperCase());
    if (!labels.length || !selectedSet.size) return null;
    const sel = [...selectedSet].sort().join(",");
    const ans = [...labels].sort().join(",");
    return sel === ans;
  }

  function renderMasteryChips() {
    const q = currentQ();
    if (!q) return;
    const cur = progressOf(q.id).mastery || "not_started";
    document.querySelectorAll("#single-mastery .chip[data-mastery]").forEach((el) => {
      el.classList.toggle("active", el.dataset.mastery === cur);
    });
  }

  function renderListStrip() {
    const max = 80;
    const start = Math.max(0, Math.min(state.index - 20, state.queue.length - max));
    const end = Math.min(state.queue.length, start + max);
    els.listStrip.innerHTML = "";
    for (let i = start; i < end; i++) {
      const q = state.queue[i];
      const p = progressOf(q.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot";
      b.textContent = String(i + 1);
      if (i === state.index) b.classList.add("current");
      if (p.mastery === "mastered") b.classList.add("mastered");
      else if (p.error_prone === true || p.last_ok === false) b.classList.add("bad");
      else if (p.seen || p.answered) b.classList.add("done");
      b.addEventListener("click", () => {
        state.index = i;
        state.showAnswer = false;
        state.selected = new Set();
        renderSingle();
      });
      els.listStrip.appendChild(b);
    }
  }

  function go(delta) {
    const next = state.index + delta;
    if (next < 0 || next >= state.queue.length) return;
    state.index = next;
    state.showAnswer = false;
    state.selected = new Set();
    renderSingle();
    queueLastStudyPosition();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function shuffleQueue() {
    if (state.queue.length < 2) {
      toast("当前没有可打乱的题目");
      return;
    }
    const curId = currentQ()?.id;
    for (let i = state.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    }
    if (curId != null) {
      const i = state.queue.findIndex((q) => q.id === curId);
      state.index = i >= 0 ? i : 0;
    } else state.index = 0;
    state.showAnswer = false;
    state.selected = new Set();
    state.cardUI = new Map();
    if (state.mode === "list") renderFeed(true);
    else renderSingle();
    toast("已打乱顺序");
  }

  function expandAllAnswers() {
    if (state.mode !== "list") {
      state.showAnswer = true;
      renderSingle();
      return;
    }
    const cards = els.qFeed.querySelectorAll(".q-card");
    cards.forEach((card) => {
      const id = card.dataset.id;
      const ui = cardState(id);
      ui.showAnswer = true;
      const q = state.queue.find((x) => String(x.id) === String(id));
      if (!q) return;
      const idx = state.queue.indexOf(q);
      rebuildCardBody(card, q, idx);
    });
    toast("已展开当前页答案");
  }

  async function ensureSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    state.searchIndex = await fetchJSON(`${DATA}/search_index.json`);
    return state.searchIndex;
  }

  async function runSearch(q) {
    const query = q.trim();
    if (!query) {
      setView(state.queue.length ? "browse" : "home");
      return;
    }
    const idx = await ensureSearchIndex();
    const ql = query.toLowerCase();
    const asNum = /^\d+$/.test(query) ? Number(query) : null;
    const hits = [];
    for (const item of idx) {
      if (asNum != null && Number(item.id) === asNum) {
        hits.unshift(item);
        continue;
      }
      const blob = `${item.id} ${item.source || ""} ${item.path || ""} ${item.stem || ""}`.toLowerCase();
      if (blob.includes(ql)) hits.push(item);
      if (hits.length >= 80) break;
    }
    setView("search");
    els.searchCount.textContent = `(${hits.length})`;
    els.searchResults.innerHTML = "";
    if (!hits.length) {
      els.searchResults.innerHTML = `<p class="muted">没有匹配结果</p>`;
      return;
    }
    for (const h of hits) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "search-item";
      b.innerHTML = `
        <label class="pick-check" title="勾选导出">
          <input type="checkbox" data-pick-id="${h.id}" ${isPicked(h.id) ? "checked" : ""} />
        </label>
        <div class="s-top">
          <span>#${h.id}</span>
          <span>${escapeHtml(h.source || "")}</span>
          <span>${escapeHtml(TYPE_LABEL[h.type] || h.type || "")}</span>
          <span>${escapeHtml(h.path || "")}</span>
        </div>
        <div class="s-stem">${escapeHtml(stripMd(h.stem || ""))}</div>`;
      b.querySelector(".pick-check").addEventListener("click", (e) => e.stopPropagation());
      b.querySelector("[data-pick-id]").addEventListener("change", (e) => {
        setPicked(h.id, e.target.checked);
      });
      b.addEventListener("click", async () => {
        const top = (h.path || "未分类").split(" / ")[0];
        const cat = state.categories.find((c) => c.name === top) || state.categories[0];
        const catId = findCatIdByPath(h.path) || (cat && cat.id);
        await openCategory(catId, h.id);
      });
      els.searchResults.appendChild(b);
    }
  }

  function stripMd(s) {
    return String(s)
      .replace(/\$\$[\s\S]+?\$\$/g, " ")
      .replace(/\$[^$]+\$/g, " ")
      .replace(/[#>*_`\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findCatIdByPath(path) {
    if (!path) return null;
    const parts = path.split(" / ").map((x) => x.trim()).filter(Boolean);
    let nodes = state.categories;
    let last = null;
    for (const part of parts) {
      const hit = nodes.find((n) => n.name === part);
      if (!hit) break;
      last = hit;
      nodes = hit.children || [];
    }
    return last ? last.id : null;
  }

  function goHome() {
    closeChapterMenu({ restoreFocus: false });
    closeMoreMenu({ restoreFocus: false });
    setView("home");
    state.currentCatId = null;
    state.chapterPathIds = [];
    state.chapterMenuRootId = null;
    state.specialQueue = null;
    state.queue = [];
    state.index = 0;
    els.crumb.textContent = "选择左侧分类开始";
    paintTree();
    setNavActive(null);
    $("#nav-home")?.classList.add("active");
    renderHome();
  }

  function formatDate(d = new Date()) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function isoDate(d = new Date()) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function safeFilename(s) {
    return String(s || "题目")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "")
      .slice(0, 40) || "题目";
  }

  function progressBuckets() {
    const mastered = [];
    const forgot = [];
    const learning = [];
    for (const [id, p] of Object.entries(state.progress)) {
      if (p.mastery === "mastered") mastered.push(id);
      else if (p.error_prone === true) forgot.push(id);
      else if (p.mastery === "learning") learning.push(id);
    }
    return { mastered, forgot, learning };
  }

  function featureShell(title, description, actions, body) {
    return `
      <header class="feature-header">
        <div><p class="eyebrow">学习区</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(description)}</p></div>
        <div class="feature-actions">${actions || ""}</div>
      </header>
      ${body}`;
  }

  function featureStat(label, value, hint, icon) {
    return `<div class="feature-stat"><span class="feature-stat-icon">${iconMarkup(icon)}</span><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></div></div>`;
  }

  function categoryProgressMarkup() {
    return state.categories.map((category) => {
      const total = Number(category.question_count || 0);
      const mastered = countMasteredInCat(category.id);
      const percent = total ? Math.min(100, Math.round((mastered / total) * 100)) : 0;
      return `<div class="feature-row"><div><strong>${escapeHtml(category.name)}</strong><span class="muted">${mastered} / ${total} 题已掌握</span></div><div class="feature-progress"><i style="width:${percent}%"></i></div><b>${percent}%</b></div>`;
    }).join("");
  }

  async function openFavoritesQueue() {
    const ids = [...state.favorites];
    if (!ids.length) {
      toast("收藏本还是空的");
      return;
    }
    await ensureIndexes();
    const qs = filterQuestions(await loadQueueQuestions(ids));
    if (!qs.length) {
      toast("收藏题目暂时无法加载");
      return;
    }
    state.specialQueue = null;
    state.currentCatId = null;
    beginBrowse(qs, "收藏本", null);
  }

  function renderFeaturePage(kind) {
    if (!els.feature) return;
    const buckets = progressBuckets();
    const favoriteCount = state.favorites.size;
    const total = state.manifest?.total || 0;
    const notes = localStorage.getItem("daguan_feature_notes_v1") || "";
    let html = "";

    if (kind === "favorites") {
      html = featureShell(
        "收藏本",
        "把值得再次推敲的题目集中在这里。",
        `<button type="button" class="btn primary" id="feature-open-favorites" ${favoriteCount ? "" : "disabled"}>开始复习</button>`,
        `<section class="feature-panel"><div class="feature-stat-grid">${featureStat("已收藏", String(favoriteCount), "道题目", "star")}${featureStat("题库总量", String(total), "本地可用", "book")}</div>${favoriteCount ? `<div class="feature-list-note">你的收藏会和本机进度一起保存，断网也能使用。</div>` : `<div class="empty-state"><span class="empty-icon">${iconMarkup("star")}</span><h2>暂无收藏题目</h2><p>在题目卡片上点击星标，就能把题目加入收藏本。</p></div>`}</section>`
      );
    } else if (kind === "mastery") {
      html = featureShell(
        "掌握地图",
        "查看各章节的学习进度，找到下一步最值得投入的地方。",
        `<button type="button" class="btn primary" id="feature-practice-mastery">练习未掌握题</button>`,
        `<div class="feature-stat-grid three">${featureStat("已掌握", String(buckets.mastered.length), "道题", "chart")}${featureStat("学习中", String(buckets.learning.length), "道题", "book")}${featureStat("易错", String(buckets.forgot.length), "道题", "gauge")}</div><section class="feature-panel"><div class="feature-panel-heading"><div><h2>章节掌握度</h2><p class="muted">每次标记掌握后，地图会即时更新。</p></div><span class="panel-total">${total ? `${buckets.mastered.length} / ${total}` : "—"}</span></div><div class="feature-rows">${categoryProgressMarkup() || `<div class="empty-state compact"><p>题库分类加载中…</p></div>`}</div></section>`
      );
    } else if (kind === "retest") {
      html = featureShell(
        "错题复测",
        "重新面对曾经卡住的题目，用间隔复习把薄弱点变成稳定得分。",
        `<button type="button" class="btn primary" id="feature-start-retest" ${buckets.forgot.length ? "" : "disabled"}>开始复测</button>`,
        `<section class="feature-panel"><div class="feature-stat-grid">${featureStat("待复测", String(buckets.forgot.length), "道题", "gauge")}${featureStat("复测建议", buckets.forgot.length ? "现在" : "暂无", "基于本机记录", "calendar")}</div>${buckets.forgot.length ? `<div class="retest-callout"><strong>今天适合复习 ${Math.min(10, buckets.forgot.length)} 道错题</strong><span class="muted">先独立作答，再展开解析并重新标记掌握状态。</span></div>` : `<div class="empty-state"><span class="empty-icon">${iconMarkup("gauge")}</span><h2>暂无待复测题目</h2><p>把题目标记为“易错”后，它们会出现在这里。</p></div>`}</section>`
      );
    } else if (kind === "paper") {
      html = featureShell(
        "智能组卷",
        "按考试范围和题量生成一份适合当下状态的练习卷。",
        `<button type="button" class="btn primary" id="feature-generate-paper">生成试卷</button>`,
        `<section class="feature-panel"><div class="feature-controls"><label><span>考试范围</span><select id="feature-paper-scope"><option>数学一</option><option>数学二</option><option>数学三</option><option>全部题库</option></select></label><label><span>题目数量</span><input id="feature-paper-count" type="number" min="5" max="50" value="20" /></label><label><span>难度偏好</span><select id="feature-paper-level"><option>均衡</option><option>基础优先</option><option>重点突破</option></select></label></div><div id="feature-paper-result" class="paper-preview"><span class="empty-icon">${iconMarkup("file")}</span><h2>准备好开始了吗？</h2><p>选择范围后点击生成试卷，系统会从本地题库中组合练习。</p></div></section>`
      );
    } else if (kind === "notes") {
      html = featureShell(
        "题目笔记",
        "记录解题思路、易错点和下一次复习时要提醒自己的话。",
        `<button type="button" class="btn primary" id="feature-save-notes">保存笔记</button>`,
        `<section class="feature-panel note-panel"><div class="note-toolbar"><span class="muted">本机保存 · ${notes ? "已记录内容" : "还没有内容"}</span><span class="note-status" id="feature-note-status"></span></div><textarea id="feature-notes-editor" placeholder="写下今天的学习笔记…">${escapeHtml(notes)}</textarea></section>`
      );
    } else if (kind === "learning-records") {
      html = featureShell(
        "学习记录",
        "按时间回看你的刷题轨迹和掌握变化。",
        `<button type="button" class="btn" id="feature-records-home">回到学习区</button>`,
        `<section class="feature-panel"><div class="feature-stat-grid three">${featureStat("已作答", String(Object.keys(state.progress).length), "道题", "trend")}${featureStat("已掌握", String(buckets.mastered.length), "道题", "flame")}${featureStat("连续学习", buckets.mastered.length || buckets.learning.length ? "进行中" : "待开始", "学习状态", "calendar")}</div><div class="empty-state compact"><p>更详细的每日记录会随着刷题自动积累。</p></div></section>`
      );
    } else {
      html = featureShell(
        "工具区",
        "把题库之外的准备工作，收进一个清爽的工作台。",
        "",
        `<div class="tool-card-grid"><button type="button" class="tool-card" id="feature-open-tutorial"><span>${iconMarkup("book")}</span><strong>使用教程</strong><small>了解本地题库和同步方式</small></button><button type="button" class="tool-card" id="feature-open-sync"><span>${iconMarkup("cloud-upload")}</span><strong>数据同步</strong><small>备份进度或连接官网</small></button><button type="button" class="tool-card" id="feature-open-appearance"><span>${iconMarkup("palette")}</span><strong>界面设置</strong><small>调整主题、背景和阅读体验</small></button></div>`
      );
    }

    els.feature.innerHTML = html;
    if (kind === "favorites") $("#feature-open-favorites")?.addEventListener("click", openFavoritesQueue);
    if (kind === "mastery") $("#feature-practice-mastery")?.addEventListener("click", () => openSpecial("todo"));
    if (kind === "retest") $("#feature-start-retest")?.addEventListener("click", () => openSpecial("forgot"));
    if (kind === "paper") {
      $("#feature-generate-paper")?.addEventListener("click", () => {
        const count = Math.max(5, Math.min(50, Number($("#feature-paper-count")?.value || 20)));
        const scope = $("#feature-paper-scope")?.value || "全部题库";
        const level = $("#feature-paper-level")?.value || "均衡";
        const result = $("#feature-paper-result");
        if (result) result.innerHTML = `<span class="paper-ready-icon">${iconMarkup("check")}</span><h2>试卷已生成</h2><p>${escapeHtml(scope)} · ${count} 题 · ${escapeHtml(level)}难度</p><button type="button" class="btn primary" id="feature-paper-start">开始作答</button>`;
        $("#feature-paper-start")?.addEventListener("click", () => {
          const first = state.categories[0];
          if (first) openCategory(first.id);
          else toast("题库还在加载中");
        });
      });
    }
    if (kind === "notes") {
      $("#feature-save-notes")?.addEventListener("click", () => {
        const value = $("#feature-notes-editor")?.value || "";
        localStorage.setItem("daguan_feature_notes_v1", value);
        const status = $("#feature-note-status");
        if (status) status.textContent = "已保存";
        toast("笔记已保存");
      });
    }
    if (kind === "learning-records") $("#feature-records-home")?.addEventListener("click", goHome);
    if (kind === "tools") {
      $("#feature-open-tutorial")?.addEventListener("click", () => openSheet("dlg-tutorial"));
      $("#feature-open-sync")?.addEventListener("click", () => openSetupWizard());
      $("#feature-open-appearance")?.addEventListener("click", () => openSheet("dlg-appearance"));
    }
  }

  function openFeaturePage(kind) {
    state.feature = kind;
    state.specialQueue = null;
    state.currentCatId = null;
    state.crumb = "";
    setView("feature");
    paintTree();
    renderFeaturePage(kind);
    if (window.innerWidth <= 900) els.sidebar.classList.remove("open");
  }

  function buildProgressPayload() {
    const map = {};
    for (const [id, p] of Object.entries(state.progress)) {
      if (p.mastery === "mastered") map[id] = "m";
      else if (p.error_prone === true) map[id] = "f";
      else if (p.mastery === "learning") map[id] = "l";
    }
    return {
      format: "daguan-local-progress",
      version: 3,
      v: 3,
      src: "daguan-math",
      at: Date.now(),
      map,
      progress: state.progress,
      favorites: [...state.favorites],
      annotations: state.annotations,
    };
  }

  function backupFilename() {
    return `daguan-progress-${isoDate()}.json`;
  }

  function backupText() {
    return JSON.stringify(buildProgressPayload(), null, 2);
  }

  const TUTORIAL_SEEN_KEY = "daguan_tutorial_seen_v1";
  const LOCAL_API_PREFIX = "./api";

  function setHomeSyncCard(status, label, detail) {
    const badge = $("#home-sync-badge");
    const statusEl = $("#home-sync-status");
    const detailEl = $("#home-sync-detail");
    if (badge) badge.dataset.state = status;
    if (statusEl && label) statusEl.textContent = label;
    if (detailEl && detail) detailEl.textContent = detail;
  }

  function refreshHomeSyncCard() {
    setHomeSyncCard("setup", "正在检查本地中控台", "首次使用完成一次大观园登录配置，之后在同步中心手动对账。\n");
    syncRequest("status").then((result) => {
      if (result.authenticated) {
        setHomeSyncCard("ready", "大观园已连接", result.lastPullAt ? `上次拉取：${result.lastPullAt}` : "可以从官网读取或同步到官网。");
      } else if (result.configured) {
        setHomeSyncCard("warning", "需要重新登录", "本地中控台还在运行，但大观园 Token 已失效。");
      } else {
        setHomeSyncCard("setup", "尚未完成登录配置", "点击“设置同步”，输入一次大观园登录信息即可。");
      }
    }).catch(() => {
      setHomeSyncCard("warning", "本地中控台未连接", "请重新双击启动脚本，或检查 8080 端口是否被占用。");
    });
  }

  let setupStep = 1;
  const SETUP_STEP_NAMES = ["", "检查中控台", "配置登录", "测试读取", "迁移进度", "完成配置"];

  function setSetupFeedback(text, error = false) {
    const el = $("#setup-feedback");
    if (!el) return;
    el.textContent = text;
    el.dataset.error = error ? "1" : "0";
  }

  function showSetupStep(step) {
    setupStep = Math.max(1, Math.min(5, Number(step) || 1));
    document.querySelectorAll("[data-setup-step]").forEach((el) => {
      el.hidden = Number(el.dataset.setupStep) !== setupStep;
    });
    const label = $("#setup-progress-label");
    const name = $("#setup-progress-name");
    const fill = $("#setup-progress-fill");
    if (label) label.textContent = `第 ${setupStep} 步，共 5 步`;
    if (name) name.textContent = SETUP_STEP_NAMES[setupStep];
    if (fill) fill.style.width = `${(setupStep / 5) * 100}%`;
  }

  function openSetupWizard() {
    openSheet("dlg-setup-wizard");
    showSetupStep(1);
    checkLocalHealth();
  }

  async function checkLocalHealth() {
    const resultEl = $("#setup-health-result");
    if (resultEl) resultEl.textContent = "正在检查本地服务…";
    try {
      const response = await fetch(`${LOCAL_API_PREFIX}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (resultEl) resultEl.textContent = `中控台运行正常：${result.service}`;
    } catch (error) {
      if (resultEl) {
        resultEl.textContent = `本地服务不可用：${error.message || String(error)}。请重新运行启动脚本。`;
        resultEl.dataset.error = "1";
      }
    }
  }

  async function setupLogin() {
    const button = $("#btn-setup-login");
    const resultEl = $("#setup-login-feedback");
    const code = $("#setup-login-code")?.value.trim() || "";
    const username = $("#setup-login-username")?.value.trim() || "";
    const password = $("#setup-login-password")?.value || "";
    if (!code && !(username && password)) {
      if (resultEl) { resultEl.textContent = "请输入登录码，或同时填写账号和密码。"; resultEl.dataset.error = "1"; }
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "正在登录…";
    }
    if (resultEl) resultEl.textContent = "正在登录并验证账号…";
    try {
      const result = await syncRequest("login", { code, username, password });
      if (resultEl) resultEl.textContent = `登录成功${result.profile?.username ? `：${result.profile.username}` : ""}`;
      showSetupStep(3);
    } catch (error) {
      if (resultEl) { resultEl.textContent = `登录失败：${error.message || String(error)}`; resultEl.dataset.error = "1"; }
    } finally {
      if (button) { button.disabled = false; button.textContent = "保存并登录"; }
    }
  }

  async function testSetupConnection() {
    const button = $("#btn-setup-test-connection");
    const resultEl = $("#setup-connection-result");
    if (button) { button.disabled = true; button.textContent = "正在读取…"; }
    if (resultEl) resultEl.textContent = "正在读取官网状态，只读不修改…";
    try {
      const preview = await syncRequest("pullPreview");
      const entries = preview.summary?.entries || 0;
      const changes = preview.summary?.changes || 0;
      if (resultEl) resultEl.textContent = `读取成功：官网返回 ${entries} 条状态，可安全合并 ${changes} 项。`;
      showSetupStep(4);
    } catch (error) {
      if (resultEl) { resultEl.textContent = `读取失败：${error.message || String(error)}`; resultEl.dataset.error = "1"; }
    } finally {
      if (button) { button.disabled = false; button.textContent = "测试读取"; }
    }
  }

  async function migrateSetupState() {
    const button = $("#btn-setup-migrate");
    const resultEl = $("#setup-migration-result");
    if (button) { button.disabled = true; button.textContent = "正在迁移…"; }
    try {
      try {
        localStorage.setItem("daguan_browser_backup_before_reconcile_v2", JSON.stringify({ progress: state.progress, favorites: [...state.favorites], picked: [...state.picked], saved_at: new Date().toISOString() }));
      } catch {}
      const response = await fetch(`${LOCAL_API_PREFIX}/state/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: state.progress, favorites: [...state.favorites], picked: [...state.picked], annotations: state.annotations }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      serverStateAvailable = true;
      serverRevision = Number(result.state?.revision) || serverRevision;
      if (resultEl) resultEl.textContent = "旧浏览器快照已备份，正在读取官网完整掌握图并覆盖本地…";
      const preview = await syncRequest("reconcilePreview");
      const applied = await syncRequest("reconcileApply", { previewId: preview.previewId, winner: "remote" });
      if (applied.state) {
        state.progress = applied.state.progress || {};
        state.favorites = new Set((applied.state.favorites || []).map(String));
        state.annotations = applied.state.annotations || state.annotations;
        serverRevision = Number(applied.state.revision) || serverRevision;
      }
      if (resultEl) resultEl.textContent = `首次修复完成：官网状态已进入本地（${Object.keys(applied.state?.progress || {}).length} 条），未知题号 ${applied.unknownIds?.length || 0} 条已保留报告。`;
      showSetupStep(5);
      refreshHomeSyncCard();
    } catch (error) {
      if (resultEl) { resultEl.textContent = `迁移失败：${error.message || String(error)}`; resultEl.dataset.error = "1"; }
    } finally {
      if (button) { button.disabled = false; button.textContent = "备份并完成首次修复"; }
    }
  }

  function buildSyncDocument() {
    const states = {};
    for (const [id, p] of Object.entries(state.progress)) {
      const mastery =
        p.mastery === "mastered"
          ? "mastered"
          : p.mastery === "learning"
              ? "needs_practice"
              : "not_started";
      const favorite = isFavorite(id);
      if (mastery === "not_started" && !favorite) continue;
      states[id] = {
        mastery,
        favorite,
        updated_at: p.updated_at
          ? new Date(Number(p.updated_at)).toISOString()
          : new Date().toISOString(),
      };
    }
    for (const id of state.favorites) {
      if (states[id]) continue;
      states[id] = {
        mastery: "not_started",
        favorite: true,
        updated_at: new Date().toISOString(),
      };
    }
    return {
      format: "daguan-local-progress",
      version: 3,
      exported_at: new Date().toISOString(),
      states,
    };
  }

  async function localApi(pathname, options = {}) {
    const response = await fetch(`${LOCAL_API_PREFIX}${pathname}`, {
      cache: "no-store",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new Error(data?.error || `本地中控台请求失败（HTTP ${response.status}）`);
    return data;
  }

  function syncRequest(action, payload = {}) {
    const routes = {
      status: ["/integrations/cxyonly/status", "GET"],
      login: ["/integrations/cxyonly/login", "POST"],
      pullPreview: ["/integrations/cxyonly/pull/preview", "POST"],
      pullApply: ["/integrations/cxyonly/pull/apply", "POST"],
      pushPreview: ["/integrations/cxyonly/push/preview", "POST"],
      pushApply: ["/integrations/cxyonly/push/apply", "POST"],
      reconcilePreview: ["/integrations/cxyonly/reconcile/preview", "POST"],
      reconcileApply: ["/integrations/cxyonly/reconcile/apply", "POST"],
    };
    const route = routes[action];
    if (!route) return Promise.reject(new Error(`未知同步操作：${action}`));
    return localApi(route[0], { method: route[1], ...(route[1] === "POST" ? { body: JSON.stringify(payload) } : {}) });
  }

  // Public Web API for the sync panel and future integrations. The local
  // Node console remains the only component that can talk to the official site.
  const publicSyncApi = Object.freeze({
    status: () => syncRequest("status"),
    pullOnlineProgress: () => syncRequest("pullPreview"),
    previewPush: (localProgress = buildSyncDocument()) =>
      syncRequest("pushPreview", { document: localProgress }),
    pushProgress: async (localProgress = buildSyncDocument(), previewId = "") => {
      const preview = previewId
        ? { previewId }
        : await syncRequest("pushPreview", { document: localProgress });
      if (!preview.previewId) return preview;
      return syncRequest("pushApply", { previewId: preview.previewId });
    },
  });
  globalThis.daguanSync = publicSyncApi;
  try {
    globalThis.sync = publicSyncApi;
  } catch {
    // Some hosts reserve window.sync; daguanSync is the stable alias.
  }

  function showSyncResult(text, error = false) {
    const el = $("#sync-result");
    if (!el) return;
    el.hidden = false;
    el.dataset.error = error ? "1" : "0";
    el.textContent = text;
  }

  async function checkRuntimeVersion() {
    try {
      const response = await fetch("./api/runtime", { cache: "no-store" });
      if (!response.ok) return;
      const runtime = await response.json();
      if (runtime.appVersion && runtime.appVersion !== APP_VERSION) {
        const banner = $("#update-banner");
        if (banner) banner.dataset.visible = "1";
      }
    } catch { /* local server may be unavailable in offline mode */ }
  }

  function saveLearningPosition() {
    try {
      sessionStorage.setItem(POSITION_KEY, JSON.stringify({ view: state.view, cat: state.currentCatId, index: state.index, mode: state.mode, scroll: $("#main")?.scrollTop || 0 }));
    } catch {}
  }

  function queueLastStudyPosition() {
    if (!serverStateAvailable || !serverStateHydrated || !state.currentCatId || !currentQ()) return;
    state.last_study = { category_id: state.currentCatId, question_id: String(currentQ().id), mode: state.mode, updated_at: new Date().toISOString() };
    fetch("./api/state/last-study", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": String(serverRevision) },
      body: JSON.stringify({ ...state.last_study, revision: serverRevision }),
    }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      serverRevision = Number(result.revision) || serverRevision;
    }).catch(() => {});
  }

  async function restoreLearningPosition() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(POSITION_KEY) || "null");
      const position = saved || (state.last_study ? { view: "browse", cat: state.last_study.category_id, question: state.last_study.question_id, mode: state.last_study.mode } : null);
      if (!position || position.view !== "browse" || position.cat == null) return;
      if (position.mode === "single" || position.mode === "list") setMode(position.mode);
      await ensureIndexes();
      const trail = findCat(position.cat) || [];
      const node = trail[trail.length - 1];
      let leafId = node && isCategoryLeaf(node) ? node.id : null;
      if (!leafId) {
        const leaves = chapterLeavesFor(position.cat);
        const questionId = position.question || state.last_study?.question_id;
        const matched = leaves.find((entry) => questionId != null && (state.catQuestions[String(entry.node.id)] || []).some((id) => String(id) === String(questionId)));
        leafId = matched?.node?.id || leaves.find((entry) => (state.catQuestions[String(entry.node.id)] || []).length)?.node?.id || null;
      }
      if (leafId != null) await openCategory(leafId, position.question || state.last_study?.question_id, { silent: true });
      if (Number.isFinite(Number(position.index))) state.index = Math.max(0, Number(position.index));
      requestAnimationFrame(() => { if ($("#main")) $("#main").scrollTop = Number(position.scroll) || 0; });
    } catch {}
  }

  let reconcilePreview = null;

  function formatReconcilePreview(preview) {
    const s = preview.summary || {};
    const mastery = s.masteryChanges || {};
    const localMastery = s.localMasteryChanges || {};
    return [
      preview.firstRepair ? "首次修复：官网状态将覆盖本地状态（已安排双侧备份）" : "对账预览：默认按字段更新时间决定方向",
      `官网状态：${s.remoteEntries || 0} 条`,
      `官网 → 本地：${s.remoteToLocal || 0} 项（掌握/收藏）`,
      `本地 → 官网：${s.localToRemote || 0} 项（掌握/收藏）`,
      `冲突：${s.conflicts || 0} 项；未知题号：${s.unknown || 0} 项`,
      `本地 → 官网掌握：已掌握 ${mastery.mastered || 0}、学习中 ${mastery.needs_practice || 0}、易错 ${mastery.not_known || 0}、未开始 ${mastery.not_started || 0}`,
      `官网 → 本地掌握：已掌握 ${localMastery.mastered || 0}、学习中 ${localMastery.needs_practice || 0}、易错 ${localMastery.not_known || 0}、未开始 ${localMastery.not_started || 0}`,
      `收藏字段变化：${s.favoriteChanges || 0} 项`,
      `活动日历：已读取 ${preview.activityImpact?.remoteActivityDays ?? "未知"} 天；本次官网写入可能计入今日刷题数 ${preview.activityImpact?.possibleTodayWrites || 0} 项`,
      `题库：${preview.catalog?.total || "未知"} 题（${preview.catalog?.version || "未标记版本"}）`,
      preview.unknownIds?.length ? `未知题号将保留并报告：${preview.unknownIds.slice(0, 12).join(", ")}${preview.unknownIds.length > 12 ? "…" : ""}` : "没有未知题号",
    ].join("\n");
  }

  function remoteMasteryToLocal(value) {
    if (value === "mastered") return "mastered";
    if (value === "not_known") return "learning";
    if (value === "needs_practice") return "learning";
    return "not_started";
  }

  function summarizeRemoteSyncDocument(documentValue) {
    const entries = documentValue?.question_states?.states || [];
    let masteryChanges = 0;
    let favoriteAdds = 0;
    let unknown = 0;
    for (const entry of entries) {
      const id = String(entry.question_id ?? entry.id ?? "");
      if (!id) continue;
      const known = state.idIndex[id] || Object.prototype.hasOwnProperty.call(state.progress, id);
      if (!known) {
        unknown += 1;
        continue;
      }
      const remote = entry.user_state || entry;
      const mastery = remoteMasteryToLocal(remote.mastery);
      if (mastery !== "not_started" && state.progress[id]?.mastery !== mastery) {
        masteryChanges += 1;
      }
      if (
        (remote.favorite === true || remote.is_favorite === true || remote.favorited_at) &&
        !isFavorite(id)
      ) {
        favoriteAdds += 1;
      }
    }
    return { entries: entries.length, masteryChanges, favoriteAdds, unknown };
  }

  function applyRemoteSyncDocument(documentValue) {
    const entries = documentValue?.question_states?.states || [];
    let updated = 0;
    let favorites = 0;
    let unknown = 0;
    for (const entry of entries) {
      const id = String(entry.question_id ?? entry.id ?? "");
      if (!id) continue;
      const known = state.idIndex[id] || Object.prototype.hasOwnProperty.call(state.progress, id);
      if (!known) {
        unknown += 1;
        continue;
      }
      const remote = entry.user_state || entry;
      const mastery = remoteMasteryToLocal(remote.mastery);
      const cur = state.progress[id] || {};
      if (mastery !== "not_started") {
        state.progress[id] = {
          ...cur,
          mastery,
          error_prone: remote.mastery === "not_known" ? true : cur.error_prone === true,
          seen: true,
          updated_at: Date.now(),
          remote_updated_at: remote.updated_at || remote.updatedAt || null,
        };
        updated += 1;
      }
      if (remote.favorite === true || remote.is_favorite === true || remote.favorited_at) {
        state.favorites.add(id);
        favorites += 1;
      }
    }
    saveProgress();
    saveFavorites();
    flushPersist();
    renderHome();
    if (state.view === "browse") {
      if (state.mode === "list") renderFeed(true);
      else renderSingle();
    }
    return { entries: entries.length, updated, favorites, unknown };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function closeSheet(id) {
    const el = document.getElementById(id);
    if (el && typeof el.close === "function" && el.open) el.close();
    if (lastDialogTrigger && typeof lastDialogTrigger.focus === "function") {
      lastDialogTrigger.focus({ preventScroll: true });
      lastDialogTrigger = null;
    }
  }

  function openSheet(id, trigger = document.activeElement) {
    const el = document.getElementById(id);
    if (el && typeof el.showModal === "function") {
      lastDialogTrigger = trigger && trigger !== document.body ? trigger : null;
      el.showModal();
      window.setTimeout(() => {
        const target = el.querySelector("button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
        target?.focus({ preventScroll: true });
      }, 0);
    }
  }

  function exportScopeLabel(scope) {
    if (scope === "picked") return "已勾选";
    if (scope === "todo") return "未掌握";
    if (scope === "forgot") return "易错题";
    if (scope === "mastered") return "已掌握";
    return state.crumb || "当前列表";
  }

  async function collectExportQuestions(scope) {
    await ensureIndexes();
    if (scope === "queue") return state.queue.slice();
    if (scope === "picked") {
      const ids = pickedIdsOrdered();
      if (!ids.length) return [];
      return loadQueueQuestions(ids);
    }
    const b = progressBuckets();
    let ids = [];
    if (scope === "todo") ids = [...b.forgot, ...b.learning];
    else if (scope === "forgot") ids = b.forgot;
    else if (scope === "mastered") ids = b.mastered;
    if (!ids.length) return [];
    return loadQueueQuestions(ids);
  }

  function renderPrintOptions(q) {
    const opts = q.options || [];
    if (!opts.length) return "";
    const rows = opts
      .map((opt, i) => {
        const lab = opt.label || String.fromCharCode(65 + i);
        return `<div class="print-opt"><span class="lab">${escapeHtml(lab)}.</span><div class="md">${renderMarkdown(opt.content_md || "")}</div></div>`;
      })
      .join("");
    return `<div class="print-opts">${rows}</div>`;
  }

  function printMastHtml(qs, { title, withAnswers, withExpl }) {
    const extra = [withAnswers ? "含答案" : "", withExpl ? "含解析" : ""].filter(Boolean).join(" · ");
    return `<header class="print-mast">
        <strong>${escapeHtml(title)}</strong>
        <span>${qs.length} 题${extra ? " · " + extra : ""} · ${escapeHtml(formatDate())}</span>
      </header>`;
  }

  function printQuestionHtml(q, i, { withAnswers, withExpl }) {
    const bits = [TYPE_LABEL[q.type] || q.type, q.source, `#${q.id}`].filter(Boolean);
    const meta = `${i + 1}. ${bits.join(" · ")}`;
    let key = "";
    if (withAnswers) {
      key = `<div class="print-key"><div class="print-key-row"><span class="print-lab">答</span><div class="md">${renderMarkdown(q.answer || "（无）")}</div></div>`;
      if (withExpl) {
        key += `<div class="print-key-row"><span class="print-lab">析</span><div class="md">${renderMarkdown(q.explanation || "（无）")}</div></div>`;
      }
      key += `</div>`;
    }
    return `<article class="print-q">
          <p class="print-q-meta">${escapeHtml(meta)}</p>
          <div class="md stem">${renderMarkdown(q.stem)}</div>
          ${renderPrintOptions(q)}
          ${key}
        </article>`;
  }

  async function waitPrintAssets(root) {
    const imgs = [...root.querySelectorAll("img")];
    await Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth) return Promise.resolve();
        return img.decode ? img.decode().catch(() => {}) : new Promise((res) => {
          img.addEventListener("load", res, { once: true });
          img.addEventListener("error", res, { once: true });
        });
      })
    );
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    }
  }

  let printGen = 0;

  function closePrintPreview() {
    printGen += 1;
    document.body.classList.remove("print-preview");
    const stage = $("#print-stage");
    stage.hidden = true;
    stage.classList.add("hidden");
    $("#print-doc").innerHTML = "";
  }

  function yieldFrame() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  async function openPrintPreview(qs, opts) {
    const gen = ++printGen;
    const fname = `大观园-${safeFilename(opts.title)}-${isoDate()}.pdf`;
    const stage = $("#print-stage");
    const doc = $("#print-doc");
    doc.innerHTML = printMastHtml(qs, opts);
    $("#print-meta").textContent = `正在排版 0 / ${qs.length}`;
    stage.hidden = false;
    stage.classList.remove("hidden");
    document.body.classList.add("print-preview");
    window.scrollTo(0, 0);

    const chunk = 8;
    for (let i = 0; i < qs.length; i += chunk) {
      if (gen !== printGen) return;
      let html = "";
      const end = Math.min(i + chunk, qs.length);
      for (let j = i; j < end; j++) html += printQuestionHtml(qs[j], j, opts);
      doc.insertAdjacentHTML("beforeend", html);
      $("#print-meta").textContent = `正在排版 ${end} / ${qs.length}`;
      await yieldFrame();
      if (i && i % 64 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (gen !== printGen) return;
    $("#print-meta").textContent = `${qs.length} 题 · ${opts.title} · ${fname}`;
    await waitPrintAssets(doc);
  }

  function refreshExportCounts() {
    const b = progressBuckets();
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n ? `（${n}）` : "";
    };
    set("export-count-picked", state.picked.size);
    set("export-count-queue", state.queue.length);
    set("export-count-todo", b.forgot.length + b.learning.length);
    set("export-count-forgot", b.forgot.length);
    set("export-count-mastered", b.mastered.length);
    const pickedRadio = document.querySelector('input[name="export-scope"][value="picked"]');
    const queueRadio = document.querySelector('input[name="export-scope"][value="queue"]');
    if (pickedRadio) pickedRadio.disabled = !state.picked.size;
    if (queueRadio) queueRadio.disabled = !state.queue.length;
    if (state.picked.size && pickedRadio) pickedRadio.checked = true;
    else if (state.queue.length && queueRadio) queueRadio.checked = true;
    else if (!state.queue.length && !state.picked.size) {
      const mastered = document.querySelector('input[name="export-scope"][value="mastered"]');
      const todo = document.querySelector('input[name="export-scope"][value="todo"]');
      if (mastered && b.mastered.length) mastered.checked = true;
      else if (todo && (b.forgot.length || b.learning.length)) todo.checked = true;
    }
  }

  async function runExportPreview() {
    const scope =
      document.querySelector('input[name="export-scope"]:checked')?.value || "queue";
    const withAnswers = $("#export-answers").checked;
    const withExpl = $("#export-expl").checked && withAnswers;
    const btn = $("#btn-export-go");
    btn.disabled = true;
    btn.textContent = "正在整理题目…";
    try {
      const qs = await collectExportQuestions(scope);
      if (!qs.length) {
        toast(
          scope === "picked"
            ? "还没有勾选题目，点卡片左侧方框即可"
            : scope === "queue"
              ? "当前没有可导出的列表，先打开一个分类"
              : "这个范围里没有题目"
        );
        return;
      }
      closeSheet("dlg-export");
      await openPrintPreview(qs, {
        title: exportScopeLabel(scope),
        withAnswers,
        withExpl,
      });
    } catch (err) {
      console.error(err);
      toast("导出失败：" + (err.message || String(err)));
    } finally {
      btn.disabled = false;
      btn.textContent = "生成预览";
    }
  }

  function refreshSyncStats() {
    const b = progressBuckets();
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };
    set("sync-n-mastered", b.mastered.length);
    set("sync-n-forgot", b.forgot.length);
    set("sync-n-learning", b.learning.length);
    set("local-n-mastered", b.mastered.length);
    set("local-n-forgot", b.forgot.length);
    set("local-n-learning", b.learning.length);
    const updated = $("#local-updated");
    if (updated) {
      updated.textContent = state.savedAt
        ? `本机最近写入 ${formatDate(new Date(state.savedAt))} ${String(new Date(state.savedAt).getHours()).padStart(2, "0")}:${String(new Date(state.savedAt).getMinutes()).padStart(2, "0")}`
        : "";
    }
    const empty = !b.mastered.length && !b.forgot.length && !b.learning.length;
    const hint = $("#sync-empty-hint");
    if (hint) hint.hidden = !empty;
    const copyBtn = $("#btn-copy-script");
    if (copyBtn) copyBtn.disabled = empty;
    const share = $("#btn-share-progress");
    if (share) share.hidden = !navigator.share;
    refreshHomeSyncCard();
  }

  function parseProgressBundle(text) {
    const data = JSON.parse(text);
    if (data && data.progress && typeof data.progress === "object" && !Array.isArray(data.progress)) {
      return {
        kind: "full",
        progress: data.progress,
        favorites: Array.isArray(data.favorites) ? data.favorites.map(String) : [],
        annotations: data.annotations && typeof data.annotations === "object" ? data.annotations : {},
      };
    }
    const map = {};
    const favorites = [];
    const put = (id, code) => {
      const key = String(id);
      if (!key || code == null) return;
      if (code === "m" || code === "mastered") map[key] = "mastered";
      else if (code === "f" || code === "forgot" || code === "not_known") map[key] = "error_prone";
      else if (code === "l" || code === "learning" || code === "needs_practice") map[key] = "learning";
    };
    if (data && data.states && typeof data.states === "object" && !Array.isArray(data.states)) {
      for (const [id, value] of Object.entries(data.states)) {
        if (!value || typeof value !== "object") continue;
        put(id, value.mastery);
        if (value.favorite === true || value.favorited_at) favorites.push(id);
      }
      return { kind: "map", map, favorites };
    }
    if (data && Array.isArray(data.question_states?.states)) {
      for (const entry of data.question_states.states) {
        const id = String(entry?.question_id ?? entry?.id ?? "");
        const userState = entry?.user_state || entry;
        if (!id || !userState || typeof userState !== "object") continue;
        put(id, userState.mastery);
        if (userState.favorite === true || userState.is_favorite === true || userState.favorited_at) {
          favorites.push(id);
        }
      }
      return { kind: "map", map, favorites };
    }
    if (data && data.map && typeof data.map === "object" && !Array.isArray(data.map)) {
      for (const [id, v] of Object.entries(data.map)) put(id, v);
      return { kind: "map", map, favorites };
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [id, v] of Object.entries(data)) {
        if (v && typeof v === "object" && v.mastery) put(id, v.mastery);
        else if (typeof v === "string") put(id, v);
      }
    }
    return { kind: "map", map, favorites };
  }

  function applyImportedMap(map, favorites = []) {
    const ids = Object.keys(map);
    if (!ids.length && !favorites.length) {
      toast("进度包是空的");
      return 0;
    }
    let n = 0;
    for (const id of ids) {
      const mastery = map[id];
      if (!mastery) continue;
      const cur = state.progress[id] || {};
      state.progress[id] = { ...cur, mastery: mastery === "error_prone" ? "learning" : mastery, error_prone: mastery === "error_prone" ? true : cur.error_prone === true, seen: true, updated_at: Date.now() };
      n += 1;
    }
    for (const id of favorites) state.favorites.add(String(id));
    saveProgress();
    saveFavorites();
    flushPersist();
    renderHome();
    if (state.view === "browse") {
      if (state.mode === "list") renderFeed(true);
      else renderSingle();
    }
    refreshSyncStats();
    updateStats();
    return n;
  }

  async function importProgressText(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      toast("没有可导入的内容");
      return;
    }
    let bundle;
    try {
      bundle = parseProgressBundle(raw);
    } catch {
      toast("JSON 解析失败，请检查粘贴内容");
      return;
    }
    let n = 0;
    if (bundle.kind === "full") {
      state.progress = mergeProgress(state.progress, bundle.progress);
      for (const id of bundle.favorites || []) state.favorites.add(String(id));
      state.annotations = { ...state.annotations, ...(bundle.annotations || {}) };
      saveProgress();
      flushPersist();
      renderHome();
      if (state.view === "browse") {
        if (state.mode === "list") renderFeed(true);
        else renderSingle();
      }
      refreshSyncStats();
      updateStats();
      n = Object.keys(bundle.progress).length;
    } else {
      n = applyImportedMap(bundle.map, bundle.favorites);
    }
    if (n) toast(`已写入本地 ${n} 题`);
  }

  /* ---------- AI tutor / focus mode ---------- */

  function aiPrefs() {
    try { return JSON.parse(localStorage.getItem(AI_PREFS_KEY) || "{}") || {}; } catch { return {}; }
  }

  function saveAiPrefs(value) {
    try { localStorage.setItem(AI_PREFS_KEY, JSON.stringify(value)); } catch {}
  }

  function currentAiQuestion() {
    if (state.aiQuestionId != null) return getQuestionSync(state.aiQuestionId);
    if (state.mode === "single") return currentQ();
    const cards = [...(els.qFeed?.querySelectorAll(".q-card[data-id]") || [])];
    if (!cards.length) return null;
    const center = window.innerHeight / 2;
    const card = cards.sort((a, b) => Math.abs(a.getBoundingClientRect().top + a.offsetHeight / 2 - center) - Math.abs(b.getBoundingClientRect().top + b.offsetHeight / 2 - center))[0];
    return getQuestionSync(card?.dataset.id);
  }

  function getQuestionSync(id) {
    const key = String(id);
    return state.queue.find((q) => String(q.id) === key) || null;
  }

  function aiQuestionPayload(q) {
    const p = progressOf(q?.id);
    const annotation = state.annotations[String(q?.id)]?.markdown || "";
    return {
      id: q?.id,
      category_path: q?.category_path || "",
      source: q?.source || "",
      type: q?.type || "",
      stem: q?.stem || "",
      options: q?.options || [],
      answer: q?.answer || "",
      explanation: q?.explanation || "",
      userAnswer: [...(state.mode === "single" ? state.selected : cardState(q?.id).selected)].join(", "),
      annotation,
      mastery: p.mastery || "not_started",
      errorProne: p.error_prone === true,
      favorite: isFavorite(q?.id),
    };
  }

  async function questionImages(q) {
    if (!q) return [];
    const source = `${q.stem || ""}\n${(q.options || []).map((o) => o.content_md || "").join("\n")}\n${q.answer || ""}\n${q.explanation || ""}`;
    const refs = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1] || m[2]).filter(Boolean).slice(0, 4);
    const out = [];
    for (const ref of refs) {
      try {
        const response = await fetch(new URL(assetUrl(ref), location.href));
        if (!response.ok) continue;
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024) continue;
        const data = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(""); reader.readAsDataURL(blob); });
        if (data) out.push(data);
      } catch {}
    }
    return out;
  }

  function sanitizeAiHtml(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    wrap.querySelectorAll("script,iframe,object,embed,style,link,form,input,button,textarea,select").forEach((el) => el.remove());
    wrap.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (/^on/i.test(attr.name) || ["href", "src", "xlink:href"].includes(attr.name) && /^(javascript:|data:text\/html|vbscript:)/i.test(attr.value)) el.removeAttribute(attr.name);
      });
    });
    wrap.querySelectorAll("img").forEach((img) => { img.removeAttribute("srcset"); img.loading = "lazy"; img.alt = img.alt || "AI生成图形"; });
    return wrap.innerHTML;
  }

  function enhanceAiDiagrams(item, content) {
    const matches = [...String(content || "").matchAll(/```daguan-diagram\s*([\s\S]*?)```/gi)].slice(0, 2);
    for (const match of matches) {
      let spec;
      try { spec = JSON.parse(match[1]); } catch { continue; }
      if (!spec || typeof spec !== "object" || typeof spec.kind !== "string") continue;
      const figure = document.createElement("figure");
      figure.className = "ai-diagram";
      figure.innerHTML = `<figcaption>图形解释 · ${escapeHtml(spec.title || "安全示意图")}</figcaption><div class="ai-diagram-status">正在生成图形…</div>`;
      item.appendChild(figure);
      fetch("./api/ai/diagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("图形生成失败")))
        .then((result) => {
          const status = figure.querySelector(".ai-diagram-status");
          if (status) status.innerHTML = sanitizeAiHtml(result.svg || "图形生成失败");
        })
        .catch(() => { const status = figure.querySelector(".ai-diagram-status"); if (status) status.textContent = "图形暂时不可用，文字解答仍然保留。"; });
    }
  }

  function renderAiMessage(content, role, pending = false) {
    const item = document.createElement("article");
    item.className = `ai-message ai-message-${role}`;
    const body = document.createElement("div");
    body.className = "ai-message-body md";
    body.innerHTML = sanitizeAiHtml(renderMarkdown(content || (pending ? "正在思考…" : "")));
    item.appendChild(body);
    if (role === "assistant" && !pending) enhanceAiDiagrams(item, content);
    if (role === "assistant" && !pending) {
      const actions = document.createElement("div");
      actions.className = "ai-message-actions";
      const save = document.createElement("button");
      save.type = "button"; save.className = "btn ghost"; save.textContent = "保存到批注";
      save.addEventListener("click", () => {
        const selected = String(window.getSelection?.()?.toString() || "").trim();
        appendToAnnotation(selected || content);
      });
      const copy = document.createElement("button");
      copy.type = "button"; copy.className = "btn ghost"; copy.textContent = "复制";
      copy.addEventListener("click", async () => toast(await copyText(content) ? "已复制 AI 解答" : "复制失败"));
      actions.append(save, copy);
      item.appendChild(actions);
    }
    return item;
  }

  function renderAiHistory(history) {
    if (!els.aiMessages) return;
    els.aiMessages.innerHTML = "";
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    if (!messages.length) {
      els.aiMessages.innerHTML = `<div class="ai-empty">${iconMarkup("spark")}<strong>先问一个问题</strong><p>题目上下文已经准备好，选择下方提示或直接输入你的疑问。</p></div>`;
      return;
    }
    messages.forEach((message) => {
      if (message.role !== "user" && message.role !== "assistant") return;
      els.aiMessages.appendChild(renderAiMessage(message.content, message.role));
    });
    els.aiMessages.scrollTop = els.aiMessages.scrollHeight;
  }

  async function loadAiHistory() {
    const q = currentAiQuestion();
    if (!q || !state.aiProfileId) { renderAiHistory(null); return; }
    try {
      const response = await fetch(`./api/ai/conversations/${encodeURIComponent(state.aiProfileId)}/${encodeURIComponent(q.id)}`, { cache: "no-store" });
      renderAiHistory(response.ok ? await response.json() : null);
    } catch { renderAiHistory(null); }
  }

  async function loadAiProfiles() {
    try {
      const response = await fetch("./api/ai/profiles", { cache: "no-store" });
      const data = await response.json();
      state.aiProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      const preferred = aiPrefs().profileId;
      state.aiProfileId = state.aiProfiles.find((item) => item.id === preferred)?.id || state.aiProfiles.find((item) => item.active)?.id || state.aiProfiles[0]?.id || "";
      if (els.aiProfileSelect) {
        els.aiProfileSelect.innerHTML = state.aiProfiles.length ? state.aiProfiles.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ""}</option>`).join("") : `<option value="">未配置 AI</option>`;
        els.aiProfileSelect.value = state.aiProfileId;
      }
      renderAiProfilesSettings();
      if (state.aiOpen) loadAiHistory();
    } catch { state.aiProfiles = []; renderAiProfilesSettings(); }
  }

  function setAiTab(tab) {
    state.aiTab = tab === "note" ? "note" : "chat";
    document.querySelectorAll("[data-ai-tab]").forEach((el) => { const active = el.dataset.aiTab === state.aiTab; el.classList.toggle("active", active); el.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll("[data-ai-panel]").forEach((el) => el.classList.toggle("hidden", el.dataset.aiPanel !== state.aiTab));
    if (state.aiTab === "note") renderQuestionNote();
  }

  function openAiDrawer(q = currentAiQuestion(), tab = "chat") {
    if (!q) { toast("请先打开一道题"); return; }
    state.aiQuestionId = String(q.id);
    state.aiOpen = true;
    const line = $("#ai-context-line");
    if (line) line.textContent = `#${q.id} · ${q.source || TYPE_LABEL[q.type] || "当前题目"}`;
    document.body.classList.add("ai-drawer-open");
    const width = Math.max(340, Math.min(620, Number(localStorage.getItem(AI_WIDTH_KEY)) || 400));
    document.documentElement.style.setProperty("--ai-drawer-width", `${width}px`);
    els.aiDrawer?.setAttribute("aria-hidden", "false");
    els.aiEdgeTab?.classList.remove("hidden");
    els.aiEdgeTab?.setAttribute("aria-expanded", "true");
    setAiTab(tab);
    loadAiHistory();
    renderQuestionNote();
    window.setTimeout(() => (state.aiTab === "chat" ? els.aiPrompt : els.noteEditor)?.focus(), 80);
  }

  function openAiForQuestion(q) { openAiDrawer(q, "chat"); }
  function openNoteForQuestion(q) { openAiDrawer(q, "note"); }

  function closeAiDrawer() {
    state.aiOpen = false;
    document.body.classList.remove("ai-drawer-open");
    els.aiDrawer?.setAttribute("aria-hidden", "true");
    els.aiEdgeTab?.setAttribute("aria-expanded", "false");
  }

  function bindAiDrawerResize() {
    const handle = $("#ai-resize-handle");
    if (!handle) return;
    let startX = 0; let startWidth = 400;
    handle.addEventListener("pointerdown", (event) => {
      if (window.innerWidth < 1280) return;
      startX = event.clientX; startWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ai-drawer-width")) || 400;
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const width = Math.max(340, Math.min(620, startWidth + startX - moveEvent.clientX));
        document.documentElement.style.setProperty("--ai-drawer-width", `${width}px`);
        localStorage.setItem(AI_WIDTH_KEY, String(width));
      };
      const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end, { once: true });
    });
  }

  function renderQuestionNote() {
    const q = currentAiQuestion();
    if (!q || !els.noteEditor) return;
    const entry = state.annotations[String(q.id)] || {};
    els.noteEditor.value = entry.markdown || "";
    const status = $("#question-note-status");
    if (status) status.textContent = entry.updated_at ? `已保存 ${formatDate(new Date(entry.updated_at))}` : "未保存";
    state.noteHistory = Array.isArray(entry.history) ? entry.history : [];
    renderNoteHistory();
  }

  function renderNoteHistory() {
    const root = $("#question-note-history");
    if (!root) return;
    root.innerHTML = state.noteHistory.length ? state.noteHistory.slice().reverse().map((item, i) => `<button type="button" class="note-history-item" data-note-history-index="${state.noteHistory.length - 1 - i}"><span>${escapeHtml(formatDate(new Date(item.updated_at || Date.now())))}</span><small>${escapeHtml(String(item.markdown || "").slice(0, 90) || "空批注")}</small></button>`).join("") : `<p class="muted">还没有历史版本。</p>`;
    root.querySelectorAll("[data-note-history-index]").forEach((button) => button.addEventListener("click", () => {
      const item = state.noteHistory[Number(button.dataset.noteHistoryIndex)];
      if (item && els.noteEditor) { els.noteEditor.value = item.markdown || ""; $("#btn-note-restore")?.removeAttribute("hidden"); root.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected")); button.classList.add("selected"); }
    }));
  }

  let noteSaveTimer = 0;
  let activeAiRunId = "";
  async function saveQuestionNote() {
    const q = currentAiQuestion();
    if (!q || !els.noteEditor) return;
    const id = String(q.id);
    const markdown = els.noteEditor.value.slice(0, 100_000);
    const previous = state.annotations[id] || { history: [] };
    const history = Array.isArray(previous.history) ? previous.history.slice(-9) : [];
    if (previous.markdown !== markdown) history.push({ markdown: previous.markdown || "", updated_at: previous.updated_at || new Date().toISOString() });
    const entry = { markdown, updated_at: new Date().toISOString(), history };
    state.annotations[id] = entry;
    try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(state.annotations)); } catch {}
    const status = $("#question-note-status"); if (status) status.textContent = "保存中…";
    if (serverStateAvailable && serverStateHydrated) {
      try {
        const response = await fetch(`./api/state/questions/${encodeURIComponent(id)}/annotation`, { method: "PATCH", headers: { "Content-Type": "application/json", "If-Match": String(serverRevision) }, body: JSON.stringify({ markdown, revision: serverRevision }) });
        if (response.status === 409) { const conflict = await response.json().catch(() => ({})); if (conflict.current) serverRevision = Number(conflict.current.revision) || serverRevision; }
        else if (response.ok) serverRevision = Number((await response.json()).revision) || serverRevision;
      } catch {}
    }
    if (status) status.textContent = "已保存";
    state.noteHistory = history;
    renderNoteHistory();
  }

  function scheduleQuestionNoteSave() { clearTimeout(noteSaveTimer); noteSaveTimer = setTimeout(saveQuestionNote, 600); }

  function appendToAnnotation(content) {
    const text = String(content || "").trim();
    if (!text || !els.noteEditor) return;
    openAiDrawer(currentAiQuestion(), "note");
    els.noteEditor.value = `${els.noteEditor.value.trim()}${els.noteEditor.value.trim() ? "\n\n" : ""}> AI 解答\n\n${text}\n`;
    scheduleQuestionNoteSave();
    toast("已追加到题目批注");
  }

  async function sendAiMessage(prompt = els.aiPrompt?.value || "") {
    const q = currentAiQuestion();
    const text = String(prompt || "").trim();
    if (!q || !text) return;
    if (!state.aiProfileId) { toast("请先在设置中配置 AI 服务"); openSheet("dlg-appearance"); return; }
    const userItem = renderAiMessage(text, "user");
    const pending = renderAiMessage("", "assistant", true);
    els.aiMessages?.append(userItem, pending);
    els.aiMessages?.scrollTo({ top: els.aiMessages.scrollHeight, behavior: "smooth" });
    if (els.aiPrompt) els.aiPrompt.value = "";
    const images = (state.aiProfiles.find((item) => item.id === state.aiProfileId)?.capabilities?.vision === "passed") ? await questionImages(q) : [];
    try {
      const response = await fetch("./api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: state.aiProfileId, question: aiQuestionPayload(q), prompt: text, includePrivate: $("#ai-include-private")?.checked === true, images }) });
      if (!response.ok) throw new Error(`AI 请求失败（HTTP ${response.status}）`);
      const runId = response.headers.get("X-Daguan-Run-Id");
      activeAiRunId = runId || "";
      if (runId) state.aiRuns.set(runId, { questionId: String(q.id), startedAt: Date.now() });
      $("#btn-ai-stop")?.removeAttribute("hidden");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder(); let buffer = ""; let answer = "";
      const paint = () => { const body = pending.querySelector(".ai-message-body"); if (body) body.innerHTML = sanitizeAiHtml(renderMarkdown(answer || "正在思考…")); els.aiMessages?.scrollTo({ top: els.aiMessages.scrollHeight }); };
      while (reader) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const rows = buffer.split(/\r?\n/); buffer = rows.pop() || "";
        for (const row of rows) if (row.startsWith("data:")) {
          try { const event = JSON.parse(row.slice(5).trim()); if (event.type === "delta") { answer += event.content || ""; paint(); } if (event.type === "error") throw new Error(event.error || "AI 生成失败"); } catch (error) { if (error?.message && !/Unexpected token|JSON/.test(error.message)) throw error; }
        }
      }
      pending.replaceWith(renderAiMessage(answer, "assistant"));
      if (runId) state.aiRuns.delete(runId);
      activeAiRunId = "";
      $("#btn-ai-stop")?.setAttribute("hidden", "");
    } catch (error) {
      pending.replaceWith(renderAiMessage(`AI 暂时没有完成回答：${error.message || error}`, "assistant"));
      activeAiRunId = "";
      $("#btn-ai-stop")?.setAttribute("hidden", "");
    }
  }

  async function enterFocusMode() {
    if (state.focusMode) return;
    state.focusSnapshot = { view: state.view, mode: state.mode, index: state.index, scrollY: window.scrollY };
    state.focusMode = true;
    if (state.view !== "browse") setView("browse");
    if (state.mode !== "single") setMode("single");
    document.body.classList.add("focus-mode");
    renderSingle();
    window.scrollTo(0, 0);
  }

  function exitFocusMode() {
    if (!state.focusMode) return;
    const snapshot = state.focusSnapshot || { view: "browse", mode: "single", index: state.index, scrollY: 0 };
    state.focusMode = false; state.focusSnapshot = null;
    document.body.classList.remove("focus-mode");
    if (state.mode !== snapshot.mode) setMode(snapshot.mode); else if (snapshot.mode === "list") renderFeed(true);
    setView(snapshot.view);
    state.index = Math.max(0, Math.min(snapshot.index, state.queue.length - 1));
    if (state.view === "browse" && state.mode === "single") renderSingle();
    requestAnimationFrame(() => window.scrollTo(0, snapshot.scrollY || 0));
  }

  function renderAiProfilesSettings() {
    const root = $("#ai-profile-list"); if (!root) return;
    if (!state.aiProfiles.length) { root.innerHTML = `<div class="empty-state compact"><p>尚未配置 AI 服务。</p></div>`; return; }
    root.innerHTML = state.aiProfiles.map((item) => `<div class="ai-profile-card ${item.id === state.aiProfileId ? "active" : ""}"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.model || "未选模型")} · ${escapeHtml(item.keyHint || "未设置")}</span></div><div class="ai-profile-card-actions"><button type="button" class="btn ghost" data-ai-edit="${escapeHtml(item.id)}">编辑</button><button type="button" class="btn ghost" data-ai-use="${escapeHtml(item.id)}">使用</button><button type="button" class="btn ghost" data-ai-delete="${escapeHtml(item.id)}">删除</button></div></div>`).join("");
    root.querySelectorAll("[data-ai-edit]").forEach((button) => button.addEventListener("click", () => openAiProfileForm(button.dataset.aiEdit)));
    root.querySelectorAll("[data-ai-use]").forEach((button) => button.addEventListener("click", () => { state.aiProfileId = button.dataset.aiUse; saveAiPrefs({ ...aiPrefs(), profileId: state.aiProfileId }); if (els.aiProfileSelect) els.aiProfileSelect.value = state.aiProfileId; renderAiProfilesSettings(); toast("已切换 AI 服务"); }));
    root.querySelectorAll("[data-ai-delete]").forEach((button) => button.addEventListener("click", async () => {
      const profile = state.aiProfiles.find((item) => item.id === button.dataset.aiDelete);
      if (!profile || !confirm(`删除“${profile.name}”？历史记录默认保留。`)) return;
      const clearHistory = confirm("是否同时删除这个服务的全部 AI 历史？点击“取消”将只删除服务配置。");
      const response = await fetch(`./api/ai/profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clearHistory }) });
      if (!response.ok) { toast("删除失败"); return; }
      if (state.aiProfileId === profile.id) state.aiProfileId = "";
      await loadAiProfiles(); toast("AI 服务已删除");
    }));
  }

  function openAiProfileForm(id = "") {
    const form = $("#ai-profile-form"); if (!form) return;
    const item = state.aiProfiles.find((profile) => profile.id === id);
    $("#ai-profile-id").value = item?.id || "";
    $("#ai-profile-name").value = item?.name || "";
    $("#ai-profile-model").value = item?.model || "";
    $("#ai-profile-url").value = item?.baseUrl || "";
    $("#ai-profile-key").value = "";
    $("#ai-test-result").textContent = "";
    form.classList.remove("hidden");
    $("#ai-profile-name")?.focus();
  }

  function closeAiProfileForm() { $("#ai-profile-form")?.classList.add("hidden"); }

  async function saveAiProfile(event) {
    event.preventDefault();
    const id = $("#ai-profile-id").value;
    const body = { name: $("#ai-profile-name").value, model: $("#ai-profile-model").value, baseUrl: $("#ai-profile-url").value, key: $("#ai-profile-key").value };
    try {
      const response = await fetch(id ? `./api/ai/profiles/${encodeURIComponent(id)}` : "./api/ai/profiles", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "保存失败");
      state.aiProfileId = data.profile.id; saveAiPrefs({ ...aiPrefs(), profileId: state.aiProfileId }); closeAiProfileForm(); await loadAiProfiles(); toast("AI 服务已保存");
    } catch (error) { $("#ai-test-result").textContent = error.message || String(error); }
  }

  async function aiProfileAction(kind) {
    const id = $("#ai-profile-id").value;
    if (!id) { $("#ai-test-result").textContent = "请先保存服务，再测试。"; return; }
    const result = $("#ai-test-result"); result.textContent = "正在测试…";
    try {
      const response = await fetch(`./api/ai/profiles/${encodeURIComponent(id)}/${kind === "models" ? "models" : "test"}`, { method: kind === "models" ? "GET" : "POST", headers: kind === "models" ? {} : { "Content-Type": "application/json" }, body: kind === "models" ? undefined : JSON.stringify({ kind }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || data.message || "测试失败");
      if (kind === "models") { result.textContent = data.models?.length ? `已获取 ${data.models.length} 个模型：${data.models.slice(0, 12).join("、")}` : "接口未返回模型列表，请手动填写模型名。"; if (data.models?.[0] && !$("#ai-profile-model").value) $("#ai-profile-model").value = data.models[0]; }
      else result.textContent = `${kind === "vision" ? "视觉" : "文本"}测试通过 · HTTP ${data.status} · ${data.latencyMs}ms · ${data.response || "无摘要"}`;
      await loadAiProfiles();
    } catch (error) { result.textContent = error.message || String(error); }
  }

  function bindUI() {
    $("#btn-open-sidebar").addEventListener("click", () => els.sidebar.classList.add("open"));
    $("#btn-close-sidebar").addEventListener("click", () => els.sidebar.classList.remove("open"));
    $("#btn-collapse-sidebar")?.addEventListener("click", () => {
      const app = $("#app");
      const collapsed = app?.dataset.sidebar === "collapsed";
      if (app) app.dataset.sidebar = collapsed ? "expanded" : "collapsed";
      const button = $("#btn-collapse-sidebar");
      button?.setAttribute("aria-label", collapsed ? "收起侧栏" : "展开侧栏");
    });
    $("#btn-theme-toggle")?.addEventListener("click", () => {
      setUiTheme(uiPrefs.theme === "official-dark" ? "official-light" : "official-dark");
    });
    $("#btn-appearance")?.addEventListener("click", (event) => openSheet("dlg-appearance", event.currentTarget));
    $("#nav-settings")?.addEventListener("click", (event) => openSheet("dlg-appearance", event.currentTarget));
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => setUiTheme(button.dataset.themeChoice));
    });
    $("#ui-bg-color")?.addEventListener("input", (event) => {
      uiPrefs.backgroundColor = event.target.value;
      uiPrefs.theme = "custom";
      saveUiPrefs();
      applyUiPreferences();
      setThemeFeedback("自定义背景颜色已应用。", false);
    });
    $("#ui-bg-image")?.addEventListener("change", async (event) => {
      await setUiBackground(event.target.files?.[0]);
      event.target.value = "";
    });
    $("#ui-bg-position")?.addEventListener("change", (event) => {
      uiPrefs.backgroundPosition = event.target.value;
      uiPrefs.theme = "custom";
      saveUiPrefs();
      applyUiPreferences();
    });
    $("#ui-bg-overlay")?.addEventListener("input", (event) => {
      uiPrefs.overlayOpacity = Number(event.target.value);
      uiPrefs.theme = "custom";
      saveUiPrefs();
      applyUiPreferences();
    });
    $("#btn-appearance-reset")?.addEventListener("click", () => resetUiPreferences("official-light"));
    $("#btn-appearance-eye")?.addEventListener("click", () => resetUiPreferences("eye-care"));
    window.addEventListener("pagehide", flushPersist);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPersist();
    });
    $("#btn-browse-back")?.addEventListener("click", goHome);
    $("#chapter-trigger")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.chapterMenuOpen) closeChapterMenu();
      else openChapterMenu();
    });
    $("#chapter-menu-close")?.addEventListener("click", () => closeChapterMenu());
    $("#chapter-empty-open")?.addEventListener("click", () => openChapterMenu(state.chapterMenuRootId || state.chapterPathIds[state.chapterPathIds.length - 1] || null));
    $("#chapter-menu")?.addEventListener("click", (event) => event.stopPropagation());
    $("#chapter-menu")?.addEventListener("keydown", handleChapterMenuKeydown);
    document.querySelectorAll("[data-chapter-scope]").forEach((button) => {
      button.addEventListener("click", async () => {
        const previous = state.scope;
        state.scope = button.dataset.chapterScope || "all";
        state.filterCore = state.scope === "core";
        state.filterTodo = false;
        if (els.filterCore) els.filterCore.checked = state.filterCore;
        if (els.filterTodo) els.filterTodo.checked = false;
        document.querySelectorAll(".scope-btn").forEach((item) => item.classList.toggle("active", item.dataset.scope === state.scope));
        syncChapterScopeUI();
        if (state.currentCatId != null) {
          const currentId = currentQ()?.id;
          const ok = await openCategory(state.currentCatId, currentId, { silent: true });
          if (!ok) {
            state.scope = previous;
            state.filterCore = previous === "core";
            if (els.filterCore) els.filterCore.checked = state.filterCore;
            document.querySelectorAll(".scope-btn").forEach((item) => item.classList.toggle("active", item.dataset.scope === state.scope));
            syncChapterScopeUI();
            return;
          }
        }
        renderChapterMenu();
      });
    });
    $("#btn-prev-section")?.addEventListener("click", () => goToAdjacentChapter(-1));
    $("#btn-next-section")?.addEventListener("click", () => goToAdjacentChapter(1));
    $("#btn-more")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = els.topbarMore?.classList.contains("hidden");
      if (opening) {
        els.topbarMore?.classList.remove("hidden");
        els.moreTrigger?.setAttribute("aria-expanded", "true");
      } else closeMoreMenu();
    });
    document.addEventListener("pointerdown", (event) => {
      if (state.chapterMenuOpen && !els.chapterPicker?.contains(event.target)) closeChapterMenu({ restoreFocus: false });
      if (!els.topbarMore?.classList.contains("hidden") && !event.target.closest?.(".topbar-more-wrap")) closeMoreMenu();
    });
    $("#btn-home").addEventListener("click", goHome);
    $("#btn-brand").addEventListener("click", (e) => {
      e.preventDefault();
      goHome();
    });
    $("#nav-home").addEventListener("click", goHome);
    $("#nav-favorites")?.addEventListener("click", () => openFeaturePage("favorites"));
    $("#nav-todo").addEventListener("click", () => openFeaturePage("mastery"));
    $("#nav-forgot").addEventListener("click", () => openFeaturePage("retest"));
    $("#nav-paper")?.addEventListener("click", () => openFeaturePage("paper"));
    $("#nav-notes")?.addEventListener("click", () => openFeaturePage("notes"));
    $("#workspace-learning")?.addEventListener("click", goHome);
    $("#workspace-tools")?.addEventListener("click", () => openFeaturePage("tools"));
    $("#btn-learning-records")?.addEventListener("click", () => openFeaturePage("learning-records"));
    $("#btn-start").addEventListener("click", () => {
      const first = state.categories[0];
      if (first) openCategory(first.id);
    });

    $("#btn-prev").addEventListener("click", () => go(-1));
    $("#btn-next").addEventListener("click", () => go(1));
    $("#btn-focus-mode")?.addEventListener("click", enterFocusMode);
    $("#btn-single-ai")?.addEventListener("click", () => openAiForQuestion(currentQ()));
    $("#btn-single-note")?.addEventListener("click", () => openNoteForQuestion(currentQ()));
    $("#single-error-toggle")?.addEventListener("click", () => { const q = currentQ(); if (q) setErrorProne(q.id, !progressOf(q.id).error_prone); });
    $("#btn-toggle-answer").addEventListener("click", () => {
      state.showAnswer = !state.showAnswer;
      const q = currentQ();
      if (q && state.showAnswer) {
        const ok = gradeChoice(q, state.selected);
        if (ok != null) markAnswered(q.id, ok);
        else markSeen(q.id);
      }
      renderSingle();
    });
    $("#btn-shuffle").addEventListener("click", shuffleQueue);
    $("#btn-expand-all").addEventListener("click", expandAllAnswers);
    $("#btn-load-more").addEventListener("click", () => appendFeedPage());

    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    document.querySelectorAll(".scope-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.scope = btn.dataset.scope;
        document.querySelectorAll(".scope-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.scope === state.scope);
        });
        // sync checkbox
        els.filterCore.checked = state.scope === "core";
        state.filterCore = state.scope === "core";
        syncChapterScopeUI();
        if (state.currentCatId != null) await openCategory(state.currentCatId, currentQ()?.id);
        else if (state.specialQueue) await openSpecial(state.specialQueue);
      });
    });

    $("#btn-reset-progress").addEventListener("click", () => {
      if (!confirm("确定清除本机全部做题进度？")) return;
      state.progress = {};
      state.annotations = {};
      saveProgress();
      flushPersist();
      renderHome();
      if (state.view === "browse") {
        if (state.mode === "list") renderFeed(true);
        else renderSingle();
      }
      toast("已清除本地进度");
    });

    document.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => closeSheet(el.dataset.close));
    });

    document.querySelectorAll("dialog.sheet").forEach((dialog) => {
      dialog.addEventListener("close", () => {
        if (lastDialogTrigger && typeof lastDialogTrigger.focus === "function") {
          lastDialogTrigger.focus({ preventScroll: true });
          lastDialogTrigger = null;
        }
      });
      dialog.addEventListener("click", (e) => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog =
          rect.top <= e.clientY &&
          e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX &&
          e.clientX <= rect.left + rect.width;
        if (!isInDialog && typeof dialog.close === "function") {
          dialog.close();
        }
      });
    });

    const openOnlineSyncPanel = async (actionId = "", trigger = document.activeElement) => {
      try {
        const status = await syncRequest("status");
        if (!status.authenticated) {
          openSetupWizard();
          return;
        }
        refreshSyncStats();
        openSheet("dlg-online-sync", trigger);
        if (actionId) window.setTimeout(() => $("#" + actionId)?.click(), 0);
      } catch {
        openSetupWizard();
      }
    };

    $("#btn-top-online-sync")?.addEventListener("click", (event) => openOnlineSyncPanel("", event.currentTarget));
    $("#nav-sync")?.addEventListener("click", (event) => openOnlineSyncPanel("", event.currentTarget));

    const btnTutorial = $("#btn-tutorial");
    if (btnTutorial) btnTutorial.addEventListener("click", () => openSheet("dlg-tutorial"));

    const btnHeroTutorial = $("#btn-hero-tutorial");
    if (btnHeroTutorial) btnHeroTutorial.addEventListener("click", () => openSheet("dlg-tutorial"));

    const btnWelcomeLater = $("#btn-welcome-later");
    if (btnWelcomeLater) {
      btnWelcomeLater.addEventListener("click", () => {
        localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
        closeSheet("dlg-welcome");
      });
    }

    const btnWelcomeTutorial = $("#btn-welcome-tutorial");
    if (btnWelcomeTutorial) {
      btnWelcomeTutorial.addEventListener("click", () => {
        localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
        closeSheet("dlg-welcome");
        openSheet("dlg-tutorial");
      });
    }

    const btnTutorialSync = $("#btn-tutorial-sync");
    if (btnTutorialSync) {
      btnTutorialSync.addEventListener("click", () => {
        closeSheet("dlg-tutorial");
        openOnlineSyncPanel();
      });
    }
    const btnTutorialSyncCard = $("#btn-tutorial-sync-card");
    if (btnTutorialSyncCard) {
      btnTutorialSyncCard.addEventListener("click", () => {
        closeSheet("dlg-tutorial");
        openSetupWizard();
      });
    }

    document.querySelectorAll("[data-setup-next]").forEach((btn) => {
      btn.addEventListener("click", () => showSetupStep(btn.dataset.setupNext));
    });
    document.querySelectorAll("[data-setup-prev]").forEach((btn) => {
      btn.addEventListener("click", () => showSetupStep(btn.dataset.setupPrev));
    });
    const btnSetupHealth = $("#btn-setup-health");
    if (btnSetupHealth) btnSetupHealth.addEventListener("click", checkLocalHealth);
    const btnSetupLogin = $("#btn-setup-login");
    if (btnSetupLogin) btnSetupLogin.addEventListener("click", setupLogin);
    const btnSetupTest = $("#btn-setup-test-connection");
    if (btnSetupTest) btnSetupTest.addEventListener("click", testSetupConnection);
    const btnSetupMigrate = $("#btn-setup-migrate");
    if (btnSetupMigrate) btnSetupMigrate.addEventListener("click", migrateSetupState);
    const btnReopenSetupWizard = $("#btn-reopen-setup-wizard");
    if (btnReopenSetupWizard) {
      btnReopenSetupWizard.addEventListener("click", () => {
        closeSheet("dlg-online-sync");
        openSetupWizard();
      });
    }
    const btnHomePull = $("#btn-home-pull");
    if (btnHomePull) btnHomePull.addEventListener("click", () => openOnlineSyncPanel("btn-sync-pull"));
    const btnHomePush = $("#btn-home-push");
    if (btnHomePush) btnHomePush.addEventListener("click", () => openOnlineSyncPanel("btn-sync-pull"));
    const btnHomeSyncSetup = $("#btn-home-sync-setup");
    if (btnHomeSyncSetup) btnHomeSyncSetup.addEventListener("click", openSetupWizard);
    $("#btn-export").addEventListener("click", () => {
      refreshExportCounts();
      openSheet("dlg-export");
    });
    $("#btn-export-go").addEventListener("click", () => runExportPreview());
    $("#btn-print-back").addEventListener("click", closePrintPreview);
    $("#btn-copy-md").addEventListener("click", () => copyQuestionMarkdown(currentQ()));
    $("#btn-print-go").addEventListener("click", () => window.print());
    $("#export-answers").addEventListener("change", () => {
      const on = $("#export-answers").checked;
      $("#export-expl").disabled = !on;
      if (!on) $("#export-expl").checked = false;
    });

    $("#btn-sync").addEventListener("click", () => {
      refreshSyncStats();
      openSheet("dlg-sync");
    });
    $("#btn-online-sync").addEventListener("click", () => {
      openOnlineSyncPanel();
    });
    $("#btn-sync-status").addEventListener("click", async () => {
      try {
        const result = await syncRequest("status");
        $("#sync-connection-status").textContent = result.authenticated
          ? "大观园已连接，中控台可以直接同步。"
          : result.configured
            ? "Token 已失效，请重新登录。"
            : "尚未配置大观园登录。";
        setHomeSyncCard(
          result.authenticated ? "ready" : "warning",
          result.authenticated ? "大观园已连接" : "需要重新配置",
          result.authenticated ? "可以从这里读取或上传。" : "点击“设置同步”完成登录。"
        );
        showSyncResult(JSON.stringify(result, null, 2));
      } catch (error) {
        $("#sync-connection-status").textContent = "连接失败";
        setHomeSyncCard("warning", "同步连接失败", String(error.message || error));
        showSyncResult(String(error.message || error), true);
      }
    });
    $("#btn-sync-pull").addEventListener("click", async () => {
      try {
        const button = $("#btn-sync-pull");
        button.disabled = true;
        button.textContent = "正在检查…";
        try {
          localStorage.setItem("daguan_browser_backup_before_reconcile_v2", JSON.stringify({ progress: state.progress, favorites: [...state.favorites], picked: [...state.picked], saved_at: new Date().toISOString() }));
        } catch {}
        showSyncResult("正在增量读取题库、官网掌握图、收藏、最近学习和活动日历…");
        reconcilePreview = await syncRequest("reconcilePreview");
        showSyncResult(formatReconcilePreview(reconcilePreview));
        toast("差异检查完成，请确认后应用对账计划");
      } catch (error) {
        setHomeSyncCard("warning", "对账检查失败", "请检查本地中控台和大观园登录状态后重试。");
        showSyncResult(String(error.message || error), true);
      } finally {
        const button = $("#btn-sync-pull");
        button.disabled = false;
        button.textContent = "检查差异";
      }
    });
    $("#btn-sync-push").addEventListener("click", async () => {
      try {
        if (!reconcilePreview?.previewId) {
          toast("请先点击“检查差异”");
          return;
        }
        const winner = $("#sync-conflict-winner")?.value || "latest";
        if (!window.confirm("确认应用这次对账计划吗？应用前会生成本地与官网双侧备份。")) return;
        showSyncResult("正在先写入本地，再同步官网并重新校验…");
        const result = await syncRequest("reconcileApply", { previewId: reconcilePreview.previewId, winner: winner === "latest" ? null : winner });
        reconcilePreview = null;
        if (result.state) {
          state.progress = result.state.progress || state.progress;
          state.favorites = new Set((result.state.favorites || []).map(String));
          state.picked = new Set((result.state.picked || []).map(String));
          state.remote_activity = result.state.remote_activity || state.remote_activity;
          serverRevision = Number(result.state.revision) || serverRevision;
          renderHome();
          refreshFavoriteUI();
        }
        showSyncResult(`对账完成\n本地应用：${result.appliedLocal || 0}\n官网成功：${result.succeeded || 0}\n失败：${result.failed || 0}\n未知题号：${result.unknownIds?.length || 0}\n${result.verified ? "官网复读校验成功" : "官网复读校验失败，请稍后重试"}`);
        setHomeSyncCard("ready", result.failed ? "对账部分完成" : "对账完成", `本地 ${result.appliedLocal || 0} 项，官网成功 ${result.succeeded || 0} 项。`);
        toast(result.failed ? "对账完成，但有失败项已保留待同步" : "官网与本地已完成对账");
      } catch (error) {
        setHomeSyncCard("warning", "对账失败", "预览可能已过期或状态发生变化，请重新检查差异。");
        showSyncResult(String(error.message || error), true);
      }
    });
    $("#btn-sync-export-local").addEventListener("click", () => {
      window.location.href = `${LOCAL_API_PREFIX}/integrations/cxyonly/export?source=local`;
    });
    $("#btn-sync-export-remote").addEventListener("click", () => {
      window.location.href = `${LOCAL_API_PREFIX}/integrations/cxyonly/export?source=remote`;
    });
    $("#btn-sync-export-android").addEventListener("click", () => {
      window.location.href = `${LOCAL_API_PREFIX}/integrations/cxyonly/export?source=android`;
    });
    $("#btn-update-refresh")?.addEventListener("click", () => {
      saveLearningPosition();
      window.location.reload();
    });
    $("#btn-download-progress").addEventListener("click", () => {
      downloadText(backupFilename(), backupText(), "application/json");
      toast("已开始下载备份");
    });
    $("#btn-copy-backup").addEventListener("click", async () => {
      const ok = await copyText(backupText());
      toast(ok ? "已复制备份 JSON" : "复制失败，请改用下载");
    });
    $("#btn-share-progress").addEventListener("click", async () => {
      const name = backupFilename();
      const text = backupText();
      try {
        const file = new File([text], name, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "大观园进度" });
          return;
        }
        if (navigator.share) {
          await navigator.share({ title: "大观园进度", text });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      downloadText(name, text, "application/json");
      toast("已改为下载备份");
    });
    document.querySelectorAll("[data-progress-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.progressTab;
        document.querySelectorAll("[data-progress-tab]").forEach((b) => {
          b.classList.toggle("active", b.dataset.progressTab === tab);
        });
        $("#sync-panel-local").hidden = tab !== "local";
        $("#sync-panel-official").hidden = tab !== "official";
      });
    });
    document.querySelectorAll("[data-sync-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.syncTab;
        document.querySelectorAll("[data-sync-tab]").forEach((b) => {
          b.classList.toggle("active", b.dataset.syncTab === tab);
        });
        $("#sync-panel-push").hidden = tab !== "push";
        $("#sync-panel-pull").hidden = tab !== "pull";
      });
    });
    $("#btn-import-clipboard").addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        await importProgressText(text);
      } catch {
        toast("读不到剪贴板，请把 JSON 贴进文本框再点写入");
      }
    });
    $("#btn-import-file").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", async () => {
      const file = $("#import-file").files && $("#import-file").files[0];
      if (!file) return;
      try {
        const text = await file.text();
        $("#import-text").value = text;
        await importProgressText(text);
      } catch (err) {
        toast("读取文件失败");
      }
      $("#import-file").value = "";
    });
    $("#btn-import-apply").addEventListener("click", () => importProgressText($("#import-text").value));
    $("#btn-pick-queue").addEventListener("click", () => {
      if (!state.queue.length) {
        toast("先打开一个分类");
        return;
      }
      for (const q of state.queue) state.picked.add(String(q.id));
      savePicked();
      toast(`已勾选当前列表 ${state.queue.length} 题`);
    });
    $("#btn-pick-clear").addEventListener("click", () => {
      state.picked.clear();
      savePicked();
      toast("已清空勾选");
    });
    $("#single-pick").addEventListener("change", () => {
      const q = currentQ();
      if (!q) return;
      setPicked(q.id, $("#single-pick").checked);
    });
    $("#btn-toggle-favorite").addEventListener("click", () => {
      const q = currentQ();
      if (!q) return;
      setFavorite(q.id, !isFavorite(q.id));
    });
    $("#ai-edge-tab")?.addEventListener("click", () => openAiDrawer(currentAiQuestion(), "chat"));
    $("#btn-ai-close")?.addEventListener("click", closeAiDrawer);
    bindAiDrawerResize();
    document.querySelectorAll("[data-ai-tab]").forEach((button) => button.addEventListener("click", () => setAiTab(button.dataset.aiTab)));
    $("#ai-profile-select")?.addEventListener("change", (event) => { state.aiProfileId = event.target.value; saveAiPrefs({ ...aiPrefs(), profileId: state.aiProfileId }); loadAiHistory(); });
    document.querySelectorAll("[data-ai-prompt]").forEach((button) => button.addEventListener("click", () => sendAiMessage(button.dataset.aiPrompt)));
    $("#ai-compose")?.addEventListener("submit", (event) => { event.preventDefault(); sendAiMessage(); });
    $("#btn-ai-stop")?.addEventListener("click", async () => { if (!activeAiRunId) return; await fetch(`./api/ai/runs/${encodeURIComponent(activeAiRunId)}`, { method: "DELETE" }).catch(() => {}); });
    $("#question-note-editor")?.addEventListener("input", scheduleQuestionNoteSave);
    $("#btn-note-history")?.addEventListener("click", () => $("#question-note-history")?.classList.toggle("hidden"));
    $("#btn-note-restore")?.addEventListener("click", () => {
      const selected = $("#question-note-history .selected");
      const item = selected ? state.noteHistory[Number(selected.dataset.noteHistoryIndex)] : null;
      if (item && els.noteEditor) { els.noteEditor.value = item.markdown || ""; scheduleQuestionNoteSave(); toast("已恢复历史批注"); }
    });
    $("#btn-ai-settings")?.addEventListener("click", () => { openSheet("dlg-appearance"); window.setTimeout(() => $("#ai-settings-title")?.scrollIntoView({ block: "center" }), 80); });
    $("#btn-ai-add-profile")?.addEventListener("click", () => openAiProfileForm());
    $("#ai-profile-form")?.addEventListener("submit", saveAiProfile);
    $("#btn-ai-cancel-profile")?.addEventListener("click", closeAiProfileForm);
    $("#btn-ai-fetch-models")?.addEventListener("click", () => aiProfileAction("models"));
    $("#btn-ai-test-text")?.addEventListener("click", () => aiProfileAction("text"));
    $("#btn-ai-test-vision")?.addEventListener("click", () => aiProfileAction("vision"));
    $("#btn-shortcuts-reset")?.addEventListener("click", () => {
      Object.assign(shortcuts, SHORTCUT_DEFAULTS);
      localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
      renderShortcutSettings();
      renderShortcutHints();
      $("#shortcut-feedback")?.replaceChildren(document.createTextNode("已恢复默认快捷键。"));
    });
    renderShortcutSettings();
    renderShortcutHints();
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (state.chapterMenuOpen) {
        e.preventDefault();
        closeChapterMenu();
        return;
      }
      if (!els.topbarMore?.classList.contains("hidden")) {
        e.preventDefault();
        closeMoreMenu({ restoreFocus: true });
        return;
      }
      if (document.body.classList.contains("print-preview")) {
        e.preventDefault();
        closePrintPreview();
      }
    });

    els.filterCore.addEventListener("change", async () => {
      state.filterCore = els.filterCore.checked;
      if (!els.filterCore.checked && state.scope === "core") state.scope = "all";
      if (els.filterCore.checked) {
        state.scope = "core";
        document.querySelectorAll(".scope-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.scope === "core");
        });
      }
      syncChapterScopeUI();
      if (state.currentCatId != null) await openCategory(state.currentCatId, currentQ()?.id);
      else if (state.specialQueue) await openSpecial(state.specialQueue);
    });
    els.filterTodo.addEventListener("change", async () => {
      state.filterTodo = els.filterTodo.checked;
      syncChapterScopeUI();
      if (state.currentCatId != null) await openCategory(state.currentCatId, currentQ()?.id);
      else if (state.specialQueue) await openSpecial(state.specialQueue);
    });

    document.querySelectorAll("#single-mastery .chip[data-mastery]").forEach((el) => {
      el.addEventListener("click", () => {
        const q = currentQ();
        if (!q) return;
        setMastery(q.id, el.dataset.mastery);
      });
    });

    let searchTimer = null;
    els.search.addEventListener("focus", () => prefetchUrl(`${DATA}/search_index.json`), { once: true });
    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(els.search.value), 200);
    });

    document.addEventListener("keydown", (e) => {
      if (document.body.classList.contains("print-preview")) return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === shortcuts.focus) { e.preventDefault(); if (state.focusMode) exitFocusMode(); else enterFocusMode(); return; }
      if (state.focusMode) {
        if (e.key === shortcuts.escape) { e.preventDefault(); if (state.aiOpen) closeAiDrawer(); else exitFocusMode(); return; }
        if (e.key === shortcuts.up) { e.preventDefault(); go(-1); return; }
        if (e.key === shortcuts.down) { e.preventDefault(); go(1); return; }
        if (e.key === shortcuts.answer) { e.preventDefault(); $("#btn-toggle-answer")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.mastery1) { e.preventDefault(); $("#single-mastery [data-mastery='not_started']")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.mastery2) { e.preventDefault(); $("#single-mastery [data-mastery='learning']")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.mastery3) { e.preventDefault(); $("#single-mastery [data-mastery='mastered']")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.error) { e.preventDefault(); $("#single-error-toggle")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.favorite) { e.preventDefault(); $("#btn-toggle-favorite")?.click(); return; }
        if (e.key.toLowerCase() === shortcuts.ai) { e.preventDefault(); openAiForQuestion(currentQ()); return; }
        if (e.key.toLowerCase() === shortcuts.note) { e.preventDefault(); openNoteForQuestion(currentQ()); return; }
        if (e.key.toLowerCase() === shortcuts.copy) { e.preventDefault(); if (currentQ()) copyQuestionMarkdown(currentQ()); return; }
        if (e.key === shortcuts.help) { e.preventDefault(); toast("↑/↓ 切题 · Space 答案 · 1/2/3 掌握 · E 易错 · F 收藏 · A AI · N 批注 · C 复制 · Esc 关闭/退出"); return; }
        return;
      }
      if (state.view !== "browse" || state.mode !== "single") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        $("#btn-toggle-answer").click();
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const i = Number(e.key) - 1;
        const btn = els.qOptions.children[i];
        if (btn) btn.click();
      }
    });

    loadAiProfiles();
  }

  async function init() {
    checkRuntimeVersion();
    applyUiPreferences();
    loadUiBackground();
    bindUI();
    applyModeUI();
    const hydrated = hydrateStores();
    const serverHydrated = hydrateServerState();
    try {
      indexesReady = Promise.all([
        fetchJSON(`${DATA}/category_questions.json`),
        fetchJSON(`${DATA}/id_index.json`),
      ]).then(([catQuestions, idIndex]) => {
        state.catQuestions = catQuestions;
        state.idIndex = idIndex;
      });
      const [manifest, categories] = await Promise.all([
        fetchJSON(`${DATA}/manifest.json`),
        fetchJSON(`${DATA}/categories.json`),
        hydrated,
        serverHydrated,
      ]);
      state.manifest = manifest;
      state.categories = categories;
      paintTree();
      renderHome();
      refreshHomeSyncCard();
      setView("home");
      restoreLearningPosition();
      refreshPickUI();
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
        openSheet("dlg-welcome");
      }
      indexesReady.then(() => renderHome()).catch(() => {});
    } catch (err) {
      console.error(err);
      els.stats.textContent = "数据加载失败";
      els.home.innerHTML = `<h1>加载失败</h1><p class="muted">${escapeHtml(err.message || String(err))}</p>
        <p>请用本地 HTTP 服务打开（不要直接双击 HTML）。例如：</p>
        <pre>npm start</pre>`;
    }
  }

  window.addEventListener("pagehide", saveLearningPosition);
  init();
})();
