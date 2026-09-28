(() => {
  function clearCachesIfRequested() {
    if (!location.search.includes("purge=1")) return;
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    if (!localStorage.getItem("daguan_purged")) {
      localStorage.setItem("daguan_purged", "1");
      location.replace(location.pathname + "?fresh=1");
    }
  }

  function initializeNewUi() {
    const params = new URLSearchParams(window.location.search);
    const requestedUi = params.get("ui");
    const preference = (window.DaguanVersions && window.DaguanVersions.selected(localStorage)) || "new";
    if (requestedUi === "old" || (preference === "old" && !requestedUi)) {
      window.location.replace("./legacy.html" + window.location.search);
      return;
    }
    if (requestedUi === "new") {
      try { localStorage.setItem("daguan_ui_version_v1", "new"); } catch {}
    }
    try {
      const appearance = JSON.parse(localStorage.getItem((window.DaguanVersions && window.DaguanVersions.appearanceKey) || "daguan_ui_appearance_new_v1") || "{}");
      document.documentElement.dataset.theme = appearance.theme || "light";
      if (appearance.reduceMotion) document.documentElement.dataset.reduceMotion = "true";
    } catch { document.documentElement.dataset.theme = "light"; }
    document.documentElement.dataset.uiVersion = "new";
  }

  function initializeOldUi() {
    try {
      const appearance = JSON.parse(localStorage.getItem(window.DaguanVersions.appearanceKey) || "{}");
      const themes = ["official-light", "official-dark", "eye-care", "custom"];
      const theme = themes.includes(appearance.theme) ? appearance.theme : "official-light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme === "official-dark" ? "dark" : "light";
    } catch { document.documentElement.dataset.theme = "official-light"; }
  }

  clearCachesIfRequested();
  if (document.documentElement.dataset.appVersion === "old") initializeOldUi();
  else initializeNewUi();

  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-app-action]")?.dataset.appAction;
    if (!action) return;
    if (action === "show-home") event.preventDefault();
    if (action === "toggle-nav") window.App?.toggleNav();
    else if (action === "show-home") window.App?.showHome();
    else if (action === "open-search") window.App?.openGlobalSearch();
    else if (action === "show-shortcuts") window.App?.showShortcutHelp();
    else if (action === "open-unlock") window.PreviewAccess?.openUnlockDialog();
    else if (action === "unlock") window.PreviewAccess?.unlock(event);
    else if (action === "close-preview") document.getElementById("dlg-preview-access")?.close();
  });
})();
