(() => {
  const DOWNLOAD_URL = "https://github.com/Evan26Ma/daguan-cxy-local/releases/download/v1.0.2/DaguanMathDesktop-Setup.exe";
  const packaged = new URLSearchParams(location.search).get("browserPackage") === "1";

  async function isBrowserService() {
    if (packaged) return true;
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const response = await fetch("./api/health", { cache: "no-store", signal: AbortSignal.timeout(1200) });
      const health = await response.json();
      return response.ok && health.launcherKind === "browser";
    } catch { return false; }
  }

  async function flushPending() {
    if (document.documentElement.dataset.appVersion === "old") {
      if (!window.DaguanBrowserMigration) return false;
      return window.DaguanBrowserMigration.flushPending();
    }
    const deadline = Date.now() + 15_000;
    while (!window.StateSync?.hydrated && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.StateSync?.hydrated) return false;
    window.StateSync.localizePending();
    await window.StateSync.retryPending();
    await window.StateSync.ensureFlushed();
    return !window.DaguanPendingSync?.hasAny();
  }

  function downloadBackup() {
    if (document.documentElement.dataset.appVersion === "old") {
      window.DaguanBrowserMigration?.downloadBackup();
    } else {
      window.StateSync?.localizePending();
      window.App?.downloadBackup();
    }
  }

  async function showRetirement() {
    if (document.getElementById("browser-retirement")) return;
    const panel = document.createElement("main");
    panel.id = "browser-retirement";
    panel.className = "browser-retirement";
    panel.innerHTML = `
      <section class="browser-retirement__card" aria-labelledby="browser-retirement-title">
        <p class="browser-retirement__eyebrow">大观园数学 · 版本迁移</p>
        <h1 id="browser-retirement-title">浏览器版已停止维护</h1>
        <p>请安装桌面版继续学习。进度、收藏和批注仍保存在这台电脑的共享数据目录中。</p>
        <p id="browser-retirement-status" class="browser-retirement__status" role="status" aria-live="polite">正在确认本机待同步记录…</p>
        <div class="browser-retirement__actions">
          <a href="${DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer">下载 Windows 桌面版</a>
          <button type="button" id="browser-retirement-backup">下载本机记录备份</button>
        </div>
        <p class="browser-retirement__note">安装 v1.0.2 后从开始菜单打开桌面版，它会接管旧浏览器服务。</p>
      </section>`;
    document.body.appendChild(panel);
    const disableOtherContent = () => {
      document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
      for (const child of document.body.children) {
        if (child !== panel && child.tagName !== "SCRIPT") child.inert = true;
      }
    };
    disableOtherContent();
    new MutationObserver(disableOtherContent).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["open"],
    });
    panel.querySelector("#browser-retirement-backup").addEventListener("click", downloadBackup);
    const status = panel.querySelector("#browser-retirement-status");
    try {
      const saved = await flushPending();
      status.textContent = saved
        ? "本机待同步记录已写入共享服务，可以安装并打开桌面版。"
        : "仍有记录等待同步。请先下载本机记录备份，安装桌面版后再导入。";
      status.dataset.state = saved ? "saved" : "pending";
    } catch {
      status.textContent = "暂时无法确认记录已同步。请先下载本机记录备份，安装桌面版后再导入。";
      status.dataset.state = "pending";
    }
  }

  void isBrowserService().then((enabled) => { if (enabled) void showRetirement(); });
})();
