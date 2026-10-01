(function (root) {
  "use strict";
  const pendingKey = "daguan_pending_visits_v1";
  const endpoint = "./api/visit-history";
  let flushing = Promise.resolve();
  function pending() {
    try { return JSON.parse(localStorage.getItem(pendingKey) || "{}"); } catch { return {}; }
  }
  function remember(entry) {
    try { const data = pending(); data[String(entry.question_id)] = entry; localStorage.setItem(pendingKey, JSON.stringify(data)); return true; } catch { return false; }
  }
  async function request(url, method = "GET", payload) {
    const response = await fetch(url, { method, cache: "no-store", ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) });
    if (!response.ok) throw new Error("做题历史暂时无法保存");
    return response.json();
  }
  function flush() {
    const run = flushing.then(async () => {
      for (const entry of Object.values(pending())) {
        try {
          await request(endpoint, "POST", entry);
          const data = pending();
          if (data[String(entry.question_id)]?.visited_at === entry.visited_at) {
            delete data[String(entry.question_id)];
            localStorage.setItem(pendingKey, JSON.stringify(data));
          }
        } catch { break; }
      }
    });
    flushing = run.catch(() => {});
    return run;
  }
  root.DaguanVisitHistory = {
    async list() { await flush(); return (await request(endpoint)).entries || []; },
    visit(questionId, categoryId = null, chapterId = null) {
      if (!/^\d+$/.test(String(questionId ?? ""))) return Promise.resolve(false);
      const entry = { question_id: String(questionId), category_id: categoryId == null ? null : String(categoryId), chapter_id: chapterId == null ? null : String(chapterId), visited_at: new Date().toISOString() };
      if (!remember(entry)) return request(endpoint, "POST", entry).then(() => true, () => false);
      return flush().then(() => true);
    },
    async remove(questionId) {
      await flushing;
      const data = pending(); delete data[String(questionId)]; localStorage.setItem(pendingKey, JSON.stringify(data));
      return request(`${endpoint}/${encodeURIComponent(String(questionId))}`, "DELETE");
    },
    async clear() { await flushing; localStorage.removeItem(pendingKey); return request(endpoint, "DELETE"); },
    async merge(entries) { await flush(); return request(`${endpoint}/merge`, "POST", { entries }); },
  };
  root.addEventListener?.("online", () => { void flush(); });
})(window);
