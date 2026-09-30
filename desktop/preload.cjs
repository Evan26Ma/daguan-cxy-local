const { contextBridge, ipcRenderer } = require("electron");
let updateState = "idle";

function addDesktopBar() {
  if (!document.body || document.getElementById("daguan-desktop-bar")) return;
  const bar = document.createElement("header");
  bar.id = "daguan-desktop-bar";
  bar.innerHTML = '<div id="daguan-desktop-brand"><img src="daguan://app/assets/landing/local-mark.png" alt=""><span>大观园数学</span><i></i><small>本地学习</small></div><div id="daguan-desktop-actions"><button data-action="switch" title="切换新旧版">切换版本</button><button data-action="print" title="打印当前页面">打印</button><button data-action="updates" title="检查桌面版更新">检查更新</button><button class="quit" data-action="quit" title="退出">退出</button></div>';
  const style = document.createElement("style");
  style.textContent = `
    #daguan-desktop-bar {
      box-sizing: border-box !important;
      display: flex !important;
      flex: 0 0 auto !important;
      align-items: center !important;
      justify-content: space-between !important;
      width: env(titlebar-area-width, 100%) !important;
      height: env(titlebar-area-height, 42px) !important;
      min-height: 42px !important;
      max-height: 42px !important;
      margin-top: 0 !important;
      margin-right: 0 !important;
      margin-bottom: 0 !important;
      margin-left: env(titlebar-area-x, 0px) !important;
      padding: 0 10px 0 12px !important;
      overflow: hidden !important;
      background: #fff !important;
      color: #252a31 !important;
      border: 0 !important;
      border-bottom: 1px solid #e6e8eb !important;
      font: 13px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif !important;
      user-select: none;
      -webkit-app-region: drag;
      position: relative !important;
      z-index: 10000 !important;
    }
    #daguan-desktop-bar #daguan-desktop-brand {
      display: flex !important; flex: 0 0 auto !important; align-items: center !important;
      gap: 8px !important; width: auto !important; min-width: 0 !important;
      height: 42px !important; max-height: 42px !important; margin: 0 !important;
      padding: 0 !important; overflow: visible !important; white-space: nowrap !important;
      position: static !important;
    }
    #daguan-desktop-bar #daguan-desktop-brand img {
      display: block !important; flex: 0 0 24px !important; width: 24px !important;
      min-width: 24px !important; height: 24px !important; max-height: 24px !important;
      object-fit: contain !important; margin: 0 !important; padding: 0 !important;
    }
    #daguan-desktop-bar #daguan-desktop-brand span {
      display: inline-block !important; flex: 0 0 auto !important;
      font: 650 14px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif !important;
      letter-spacing: .02em !important; white-space: nowrap !important;
      margin: 0 !important; padding: 0 !important;
    }
    #daguan-desktop-bar #daguan-desktop-brand i {
      display: block !important; flex: 0 0 1px !important; height: 17px !important;
      border: 0 !important; border-left: 1px solid #dfe2e7 !important;
      margin: 0 3px !important; padding: 0 !important;
    }
    #daguan-desktop-bar #daguan-desktop-brand small {
      display: inline-block !important; flex: 0 0 auto !important; color: #777f89 !important;
      font: 400 12px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif !important;
      white-space: nowrap !important; margin: 0 !important; padding: 0 !important;
    }
    #daguan-desktop-bar #daguan-desktop-actions {
      display: flex !important; flex: 0 0 auto !important; align-items: center !important;
      gap: 8px !important; height: 42px !important; margin: 0 !important;
      padding: 0 !important; white-space: nowrap !important;
    }
    #daguan-desktop-bar #daguan-desktop-actions button {
      display: inline-flex !important; flex: 0 0 auto !important; align-items: center !important;
      justify-content: center !important; height: 28px !important; min-height: 28px !important;
      max-height: 28px !important; width: auto !important; margin: 0 !important;
      padding: 0 10px !important; border: 0 !important; border-radius: 5px !important;
      background: transparent !important; color: #3d4650 !important;
      font: 400 13px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif !important;
      cursor: pointer; -webkit-app-region: no-drag;
    }
    #daguan-desktop-bar #daguan-desktop-actions button:hover { background: #f0f2f5 !important; }
    #daguan-desktop-bar #daguan-desktop-actions button:focus-visible { outline: 2px solid #ff6a1a !important; outline-offset: 1px !important; }
    #daguan-desktop-bar #daguan-desktop-actions .quit { margin-left: 4px !important; color: #a64218 !important; }
    #daguan-desktop-bar #daguan-desktop-actions .quit:hover { background: #fff1e9 !important; }
    @media (max-width: 760px) { #daguan-desktop-bar #daguan-desktop-brand small, #daguan-desktop-bar [data-action="print"] { display: none !important; } }
  `;
  document.head.appendChild(style);
  document.body.prepend(bar);
  for (const button of bar.querySelectorAll("button")) button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "switch") {
      await ipcRenderer.invoke("daguan:window", "switch");
      return;
    }
    if (action === "updates") {
      if (updateState === "downloaded") {
        if (window.confirm("更新已下载。重启安装会暂时中断其他浏览器窗口的学习页；尚未保存的编辑请先保存。现在重启安装吗？")) {
          await ipcRenderer.invoke("daguan:update:install");
        }
      } else {
        await ipcRenderer.invoke("daguan:update:check");
      }
      return;
    }
    await ipcRenderer.invoke("daguan:window", action);
  });
}

contextBridge.exposeInMainWorld("daguanDesktop", Object.freeze({
  getStartup: () => ipcRenderer.invoke("daguan:startup:get"),
  setStartup: (enabled) => ipcRenderer.invoke("daguan:startup", Boolean(enabled)),
  getAppVersion: () => ipcRenderer.invoke("daguan:app:version"),
  remoteAccess: (action, input) => ipcRenderer.invoke('daguan:remote', String(action), input),
}));
ipcRenderer.on("daguan:update-state", (_event, state) => {
  const value = String(state || "idle");
  const button = document.querySelector('#daguan-desktop-bar [data-action="updates"]');
  if (button) {
    button.disabled = value === "checking" || value === "available";
    button.textContent = value === "checking" ? "正在检查…"
      : value === "available" ? "正在下载…"
      : value === "downloaded" ? "重启并安装更新"
      : value === "not-available" ? "当前已是最新"
      : value === "error" ? "检查更新失败"
      : "检查更新";
    button.title = value === "downloaded"
      ? "更新已下载；点击后选择重启安装，其他浏览器窗口会暂时断开"
      : "检查桌面版更新";
    if (value === "not-available" || value === "error") setTimeout(() => {
      if (button.isConnected && updateState === value) {
        button.textContent = "检查更新";
        button.disabled = false;
        button.title = "检查桌面版更新";
        updateState = "idle";
      }
    }, 3500);
  }
  updateState = value;
  window.dispatchEvent(new CustomEvent("daguan:update-state", { detail: { state: value } }));
});
ipcRenderer.on("daguan:state-changed", (_event, revision) => {
  window.dispatchEvent(new CustomEvent("daguan:state-changed", { detail: { revision: Number(revision) || 0 } }));
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addDesktopBar, { once: true });
else addDesktopBar();
