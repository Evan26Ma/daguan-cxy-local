/* Shared bootstrap: appearance is separate; learning data keeps its existing keys. */
(function (root) {
  "use strict";
  const selectionKey = "daguan_ui_version_v1";
  const appearanceKeys = { new: "daguan_ui_appearance_new_v1", old: "daguan_ui_appearance_old_v1" };
  function readObject(storage, key) {
    try { const value = JSON.parse(storage.getItem(key)); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
  }
  function migrate(storage) {
    if (storage.getItem(appearanceKeys.old) === null) {
      storage.setItem(appearanceKeys.old, JSON.stringify(readObject(storage, "daguan_ui_preferences_v1")));
    }
    if (storage.getItem(appearanceKeys.new) === null) storage.setItem(appearanceKeys.new, "{}");
  }
  function selected(storage) { return storage.getItem(selectionKey) === "old" ? "old" : "new"; }
  function targetUrl(href, version, switching = false) {
    const url = new URL(href);
    url.pathname = url.pathname.replace(/[^/]*$/, version === "old" ? "legacy.html" : "index.html");
    if (switching) url.searchParams.set("uiSwitch", "1");
    return url.href;
  }
  function draftKey(questionId) { return `daguan_ai_draft_v1:${questionId}`; }
  const api = { selectionKey, appearanceKeys, migrate, selected, targetUrl, draftKey };
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
