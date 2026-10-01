(function () {
  "use strict";
  const nativeFetch = window.fetch.bind(window);
  const statusPromise = nativeFetch("./api/question-bank/status", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null).catch(() => null);
  let pinnedId = null;
  let enabled = false;
  statusPromise.then(status => {
    pinnedId = status?.activeId || null;
    enabled = status?.enabled === true;
  });

  window.fetch = async function (input, init) {
    const raw = input instanceof Request ? input.url : String(input);
    let url;
    try { url = new URL(raw, location.href); } catch { return nativeFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.includes("/data/") || url.pathname.includes("/data/assets/")) {
      return nativeFetch(input, init);
    }
    await statusPromise;
    if (!pinnedId) return nativeFetch(input, init);
    url.searchParams.set("bank", pinnedId);
    return nativeFetch(input instanceof Request ? new Request(url, input) : url.href, init);
  };

  function showUpdate() {
    if (!enabled || document.getElementById("question-bank-update-notice")) return;
    const notice = document.createElement("aside");
    notice.id = "question-bank-update-notice";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:10000;padding:12px 16px;border-radius:12px;background:#193b35;color:white;box-shadow:0 8px 24px #0004;font:14px system-ui,sans-serif";
    const label = document.createElement("span");
    label.textContent = "新题库已下载，刷新页面即可使用。 ";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "刷新题库";
    button.style.cssText = "margin-left:8px;padding:5px 9px;border:0;border-radius:6px;cursor:pointer";
    button.addEventListener("click", () => location.reload());
    notice.append(label, button);
    document.body.append(notice);
  }

  async function checkCurrent() {
    if (!enabled || !pinnedId) return;
    const latest = await nativeFetch("./api/question-bank/status", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null).catch(() => null);
    if (latest?.activeId && latest.activeId !== pinnedId) showUpdate();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await statusPromise;
    if (!enabled || !window.EventSource) return;
    const events = new EventSource("./api/state/events");
    events.addEventListener("bank-updated", checkCurrent);
    events.addEventListener("open", checkCurrent);
    window.addEventListener("pagehide", () => events.close(), { once: true });
  });
})();
