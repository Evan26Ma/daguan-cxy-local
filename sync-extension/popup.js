(function initializePopup() {
  "use strict";

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const connection = document.getElementById("connection");
  const exportButton = document.getElementById("export-button");
  const importFile = document.getElementById("import-file");
  const importButton = document.getElementById("import-button");
  const preview = document.getElementById("preview");
  const message = document.getElementById("message");
  let activeTabId = null;
  let previewId = null;
  let parsedDocument = null;

  function setMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  function setBusy(busy) {
    exportButton.disabled = busy || activeTabId == null;
    importFile.disabled = busy || activeTabId == null;
    importButton.disabled = busy || !previewId;
  }

  function isSupportedUrl(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "www.cxyonly.fans" &&
        url.pathname.startsWith("/math")
      );
    } catch {
      return false;
    }
  }

  async function ensureBridge() {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ["protocol.js", "bridge.js"]
    });
  }

  async function sendToBridge(action, payload = {}) {
    await ensureBridge();
    const response = await chrome.tabs.sendMessage(activeTabId, {
      target: "daguan-data-bridge",
      action,
      payload
    });
    if (!response || response.ok !== true) {
      throw new Error(response?.error || "原站页面没有返回结果");
    }
    return response.result;
  }

  function previewText(result) {
    const summary = result.summary;
    const lines = [
      result.exact ? "模式：恢复插件备份（精确还原）" : "模式：安全合并",
      `文件中题目：${result.inputCount}`,
      `预计更新：${summary.changes}`,
      `已掌握：${summary.masteryChanges.mastered}`,
      `需练习：${summary.masteryChanges.needs_practice}`,
      `完全不会：${summary.masteryChanges.not_known}`,
      `新增收藏：${summary.favoriteAdds}`,
      `忽略默认/取消标记：${summary.ignoredDefaults}`,
      `未知题号：${summary.unknown}`
    ];
    if (result.exact) {
      lines.push(`取消收藏：${summary.favoriteRemovals}`);
      lines.push(`恢复为未开始：${summary.masteryChanges.not_started}`);
    }
    return lines.join("\n");
  }

  async function initialize() {
    const extId = chrome.runtime?.id || "";
    const extIdEl = document.getElementById("extension-id-text");
    if (extIdEl) extIdEl.textContent = extId || "无法获取";
    const copyBtn = document.getElementById("copy-extension-id-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        if (!extId) return;
        try {
          await navigator.clipboard.writeText(extId);
          copyBtn.textContent = "已复制 ✓";
          setTimeout(() => {
            copyBtn.textContent = "复制 ID";
          }, 1500);
        } catch {
          copyBtn.textContent = "复制失败";
        }
      });
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !isSupportedUrl(tab.url)) {
      connection.textContent = "未连接";
      connection.className = "status-pill error";
      setMessage("请先打开并登录大观园数学题库原站，再点击扩展。", true);
      return;
    }
    activeTabId = tab.id;
    connection.textContent = "已连接";
    connection.className = "status-pill ready";
    setBusy(false);
  }

  exportButton.addEventListener("click", async () => {
    setBusy(true);
    setMessage("正在读取原站掌握状态和收藏…");
    try {
      const result = await sendToBridge("export");
      setMessage(`导出完成：${result.exportedStates} 道有标记题目。`);
    } catch (error) {
      setMessage(`导出失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  importFile.addEventListener("change", async () => {
    preview.hidden = true;
    previewId = null;
    parsedDocument = null;
    setBusy(true);
    try {
      const file = importFile.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        throw new Error("JSON 文件超过 20 MB 限制");
      }
      const root = JSON.parse(await file.text());
      parsedDocument = DaguanBridgeProtocol.parseImportDocument(root);
      setMessage("正在读取原站当前状态并计算变更…");
      const result = await sendToBridge("preview-import", {
        document: parsedDocument
      });
      previewId = result.previewId;
      preview.textContent = previewText(result);
      preview.hidden = false;
      setMessage(
        result.summary.changes
          ? "预览完成。导入前会先自动下载原站标记备份。"
          : "没有需要写入原站的变化。"
      );
    } catch (error) {
      setMessage(`读取失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  importButton.addEventListener("click", async () => {
    if (!previewId || !parsedDocument) return;
    const exact = parsedDocument.exact;
    const confirmed = window.confirm(
      exact
        ? "这是插件生成的原站备份。继续后会精确恢复其中的掌握状态和收藏。导入前仍会再次备份当前状态。确定继续吗？"
        : "将把预览中的非空掌握状态和已收藏写入原站。缺失项、未开始和未收藏不会清空原站。导入前会自动下载备份。确定继续吗？"
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("正在备份原站并开始导入，请不要关闭原站页面…");
    try {
      const result = await sendToBridge("apply-import", { previewId });
      const failureText = result.failed ? `，失败 ${result.failed}` : "";
      setMessage(`导入完成：成功 ${result.succeeded}${failureText}。`);
      previewId = null;
      parsedDocument = null;
      importFile.value = "";
      importButton.disabled = true;
    } catch (error) {
      setMessage(`导入失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  chrome.runtime.onMessage.addListener((incoming) => {
    if (incoming?.type !== "daguan-data-bridge-progress") return;
    setMessage(incoming.text || "正在处理…", Boolean(incoming.error));
  });

  initialize().catch((error) => {
    connection.textContent = "连接失败";
    connection.className = "status-pill error";
    setMessage(error.message, true);
  });
})();
