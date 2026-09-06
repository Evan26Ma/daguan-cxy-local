"use strict";

const PROTOCOL = "daguan-sync-v1";
const LOCAL_ORIGIN = /^(http:\/\/(localhost|127\.0\.0\.1):\d+)$/;
const MAX_STATES = 10000;

function isAllowedSender(sender) {
  try {
    const url = new URL(sender?.url || "");
    return LOCAL_ORIGIN.test(url.origin);
  } catch {
    return false;
  }
}

function queryOfficialTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://www.cxyonly.fans/math*" }, (tabs) => {
      resolve(tabs?.find((tab) => Number.isInteger(tab.id)) || null);
    });
  });
}

function sendToOfficial(message) {
  return new Promise(async (resolve, reject) => {
    const tab = await queryOfficialTab();
    if (!tab || tab.id == null) {
      reject(new Error("没有找到已打开的官网题库标签页，请先登录 https://www.cxyonly.fans/math"));
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["protocol.js", "bridge.js"],
      });
      chrome.tabs.sendMessage(
        tab.id,
        { target: "daguan-data-bridge", ...message },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) return reject(new Error(runtimeError.message));
          if (!response || response.ok !== true) {
            return reject(new Error(response?.error || "官网页面没有返回结果"));
          }
          resolve(response.result);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

function validateDocument(documentValue) {
  if (!documentValue || typeof documentValue !== "object") {
    throw new Error("同步文档必须是对象");
  }
  const states = documentValue.states || documentValue.question_states?.states;
  if (states && !Array.isArray(states) && typeof states !== "object") {
    throw new Error("同步状态格式错误");
  }
  const size = Array.isArray(states) ? states.length : Object.keys(states || {}).length;
  if (size > MAX_STATES) throw new Error(`同步题目超过 ${MAX_STATES} 道限制`);
}

function isValidRequestId(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 100;
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender) || message?.protocol !== PROTOCOL) return false;
  if (!isValidRequestId(message.requestId)) {
    sendResponse({ ok: false, error: "无效的同步请求 ID" });
    return false;
  }

  (async () => {
    const action = message.action;
    if (action === "status") {
      const tab = await queryOfficialTab();
      return {
        message: tab ? "已找到官网标签页" : "未找到官网标签页",
        officialTab: tab
          ? { id: tab.id, title: tab.title || "", url: tab.url || "" }
          : null,
        extensionVersion: chrome.runtime.getManifest().version,
      };
    }
    if (action === "pull") {
      return { document: await sendToOfficial({ action: "get-sync-document" }) };
    }
    if (action === "previewPush") {
      const document = message.payload?.document;
      validateDocument(document);
      return await sendToOfficial({
        action: "preview-import",
        payload: { document },
      });
    }
    if (action === "push") {
      const previewId = String(message.payload?.previewId || "");
      if (!previewId) throw new Error("缺少同步预览 ID");
      return await sendToOfficial({
        action: "apply-import",
        payload: { previewId },
      });
    }
    throw new Error(`未知同步操作：${String(action)}`);
  })()
    .then((result) => sendResponse({ ok: true, requestId: message.requestId, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        requestId: message.requestId,
        error: String(error?.message || error),
      })
    );

  return true;
});
