(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DaguanBackupMigration = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function timestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function validRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function normalisePosition(value) {
    if (!validRecord(value)) return null;
    if (value.category_id != null && value.question_id != null) return { ...value };
    if (value.cat != null && (value.question != null || value.question_id != null)) {
      return { category_id: value.cat, question_id: String(value.question ?? value.question_id), mode: value.mode, updated_at: value.updated_at || value.saved_at || null };
    }
    return null;
  }

  function parseBackup(value) {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    if (!validRecord(data)) throw new Error("备份必须是 JSON 对象");
    const progress = {};
    if (validRecord(data.progress)) {
      for (const [id, raw] of Object.entries(data.progress)) {
        const row = validRecord(raw) ? { ...raw } : {};
        const code = typeof raw === "string" ? raw : null;
        const mastery = ({ m: "mastered", mastered: "mastered", l: "learning", learning: "learning", f: "learning", forgot: "learning", error_prone: "learning", not_known: "learning" })[String(code || "")];
        if (mastery && row.mastery == null) row.mastery = mastery;
        if (["f", "forgot", "error_prone", "not_known"].includes(String(code))) row.error_prone = true;
        const allowed = ["mastery", "mastery_updated_at", "error_prone", "error_prone_updated_at", "favorite", "favorite_updated_at", "seen", "answered", "last_ok", "last_practiced_at", "updated_at", "updatedAt"];
        const clean = Object.fromEntries(Object.entries(row).filter(([key]) => allowed.includes(key)));
        if (Object.keys(clean).length) progress[String(id)] = clean;
      }
    }
    const map = validRecord(data.map) ? data.map : validRecord(data.states) ? data.states : null;
    if (map) for (const [id, value] of Object.entries(map)) {
      const code = typeof value === "object" && value ? (value.mastery || value.status) : value;
      const mastery = ({ m: "mastered", mastered: "mastered", l: "learning", learning: "learning", f: "learning", forgot: "learning", error_prone: "learning", not_known: "learning" })[String(code || "")];
      if (!mastery) continue;
      const row = progress[String(id)] || {};
      if (row.mastery == null) row.mastery = mastery;
      if (["f", "forgot", "error_prone", "not_known"].includes(String(code))) row.error_prone = true;
      if (row.seen == null) row.seen = true;
      progress[String(id)] = row;
    }
    const favorites = Array.isArray(data.favorites) ? [...new Set(data.favorites.map(String))] : [];
    const annotations = validRecord(data.annotations) ? data.annotations : {};
    const position = normalisePosition(data.last_study || data.lastStudy || data.learningPosition || data.learning_position)
      || normalisePosition(data.position)
      || normalisePosition(data.learning_position_v2);
    if (!Object.keys(progress).length && !favorites.length && !Object.keys(annotations).length && !position) throw new Error("备份中没有可迁移的进度、收藏、批注或学习位置");
    return { progress, favorites, annotations, last_study: position };
  }

  function merge(source, target) {
    const current = validRecord(target) ? target : {};
    const progress = { ...(validRecord(current.progress) ? current.progress : {}) };
    let importedProgress = 0;
    let keptTargetProgress = 0;
    for (const [id, incoming] of Object.entries(source.progress || {})) {
      const existing = validRecord(progress[id]) ? progress[id] : null;
      if (!existing) { progress[id] = { ...incoming }; importedProgress += 1; continue; }
      const a = timestamp(incoming.updated_at || incoming.updatedAt);
      const b = timestamp(existing.updated_at || existing.updatedAt);
      if (a != null && b != null && a > b) { progress[id] = { ...existing, ...incoming }; importedProgress += 1; }
      else keptTargetProgress += 1;
    }

    const targetProgress = validRecord(current.progress) ? current.progress : {};
    const targetFavorites = new Set((Array.isArray(current.favorites) ? current.favorites : []).map(String));
    const favorites = new Set(targetFavorites);
    let importedFavorites = 0;
    let keptTargetFavorites = 0;
    const sourceFavorites = new Set((source.favorites || []).map(String));
    const favoriteIds = new Set([...sourceFavorites, ...Object.keys(source.progress || {}).filter((id) => Object.hasOwn(source.progress[id] || {}, "favorite"))]);
    for (const key of favoriteIds) {
      const old = validRecord(targetProgress[key]) ? targetProgress[key] : null;
      const incoming = source.progress?.[key];
      const targetHasValue = targetFavorites.has(key) || old != null;
      const targetValue = targetFavorites.has(key) || old?.favorite === true;
      const sourceHasValue = sourceFavorites.has(key) || Object.hasOwn(incoming || {}, "favorite");
      const sourceValue = sourceFavorites.has(key) || incoming?.favorite === true;
      let value = targetValue;
      let useSource = !targetHasValue;
      const incomingAt = timestamp(incoming?.favorite_updated_at || incoming?.updated_at || incoming?.updatedAt);
      const targetAt = timestamp(old?.favorite_updated_at || old?.updated_at || old?.updatedAt);
      if (targetHasValue && sourceHasValue && incomingAt != null && targetAt != null && incomingAt > targetAt) useSource = true;
      if (useSource && sourceHasValue) value = sourceValue;
      if (targetHasValue && sourceHasValue && !useSource) keptTargetFavorites += 1;
      if (useSource && sourceHasValue) {
        if (value) favorites.add(key); else favorites.delete(key);
        if (value !== targetValue) importedFavorites += 1;
        progress[key] = { ...(validRecord(progress[key]) ? progress[key] : {}), favorite: value, ...(incomingAt != null ? { favorite_updated_at: new Date(incomingAt).toISOString() } : {}) };
      }
    }

    const annotations = { ...(validRecord(current.annotations) ? current.annotations : {}) };
    let importedAnnotations = 0;
    let keptTargetAnnotations = 0;
    for (const [id, incoming] of Object.entries(source.annotations || {})) {
      if (!validRecord(incoming)) continue;
      const existing = validRecord(annotations[id]) ? annotations[id] : null;
      if (!existing) { annotations[id] = { ...incoming }; importedAnnotations += 1; continue; }
      const a = timestamp(incoming.updated_at || incoming.updatedAt);
      const b = timestamp(existing.updated_at || existing.updatedAt);
      if (a != null && b != null && a > b) { annotations[id] = { ...existing, ...incoming }; importedAnnotations += 1; }
      else keptTargetAnnotations += 1;
    }

    let last_study = current.last_study || null;
    let importedPosition = 0;
    if (source.last_study) {
      if (!last_study) { last_study = { ...source.last_study }; importedPosition = 1; }
      else {
        const a = timestamp(source.last_study.updated_at || source.last_study.updatedAt);
        const b = timestamp(last_study.updated_at || last_study.updatedAt);
        if (a != null && b != null && a > b) { last_study = { ...source.last_study }; importedPosition = 1; }
      }
    }
    return {
      state: { ...current, progress, favorites: [...favorites], annotations, last_study },
      counts: { sourceProgress: Object.keys(source.progress || {}).length, importedProgress, keptTargetProgress, sourceFavorites: (source.favorites || []).length, importedFavorites, keptTargetFavorites, sourceAnnotations: Object.keys(source.annotations || {}).length, importedAnnotations, keptTargetAnnotations, importedPosition },
    };
  }

  return { parseBackup, merge, timestamp };
});
