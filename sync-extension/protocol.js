(function initializeProtocol(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DaguanBridgeProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function protocolFactory() {
  "use strict";

  const MASTERY_VALUES = [
    "not_started",
    "mastered",
    "needs_practice",
    "not_known"
  ];
  const MASTERY_SET = new Set(MASTERY_VALUES);
  const MAX_IMPORT_STATES = 10000;

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function assertObject(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(message);
    }
    return value;
  }

  function readQuestionId(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error("题目 ID 必须是正整数");
    }
    return parsed;
  }

  function readMastery(state, questionId) {
    if (!hasOwn(state, "mastery")) {
      return { present: false, value: "not_started" };
    }
    if (!MASTERY_SET.has(state.mastery)) {
      throw new Error(`题目 ${questionId} 的 mastery 无效`);
    }
    return { present: true, value: state.mastery };
  }

  function readFavorite(state, questionId) {
    if (hasOwn(state, "favorite")) {
      if (typeof state.favorite !== "boolean") {
        throw new Error(`题目 ${questionId} 的 favorite 必须是布尔值`);
      }
      return { present: true, value: state.favorite };
    }
    if (hasOwn(state, "is_favorite")) {
      if (typeof state.is_favorite !== "boolean") {
        throw new Error(`题目 ${questionId} 的 is_favorite 必须是布尔值`);
      }
      return { present: true, value: state.is_favorite };
    }
    if (hasOwn(state, "favorited_at")) {
      return { present: true, value: state.favorited_at != null };
    }
    return { present: false, value: false };
  }

  function normalizedItem(questionIdValue, stateValue) {
    const questionId = readQuestionId(questionIdValue);
    const state = assertObject(stateValue, `题目 ${questionId} 的状态格式错误`);
    const mastery = readMastery(state, questionId);
    const favorite = readFavorite(state, questionId);
    return {
      questionId,
      hasMastery: mastery.present,
      mastery: mastery.value,
      hasFavorite: favorite.present,
      favorite: favorite.value,
      updatedAt:
        typeof state.updatedAt === "string"
          ? state.updatedAt
          : typeof state.updated_at === "string"
            ? state.updated_at
            : null
    };
  }

  function parseImportDocument(value) {
    const root = assertObject(value, "JSON 根节点必须是对象");
    const exact = root.format === "daguan-site-marker-backup";
    const itemsById = new Map();

    if (root.states && typeof root.states === "object" && !Array.isArray(root.states)) {
      for (const [questionId, state] of Object.entries(root.states)) {
        const item = normalizedItem(questionId, state);
        itemsById.set(item.questionId, item);
      }
    } else {
      const questionStates = assertObject(
        root.question_states,
        "未找到移动端 states 或原站 question_states"
      );
      if (!Array.isArray(questionStates.states)) {
        throw new Error("question_states.states 必须是数组");
      }
      for (const entryValue of questionStates.states) {
        const entry = assertObject(entryValue, "题目状态条目格式错误");
        const userState = assertObject(
          entry.user_state,
          `题目 ${String(entry.question_id ?? "")} 缺少 user_state`
        );
        const item = normalizedItem(entry.question_id, userState);
        itemsById.set(item.questionId, item);
      }
    }

    if (itemsById.size > MAX_IMPORT_STATES) {
      throw new Error(`题目状态超过 ${MAX_IMPORT_STATES} 条限制`);
    }

    return {
      format: typeof root.format === "string" ? root.format : "unknown",
      exact,
      items: Array.from(itemsById.values()).sort(
        (left, right) => left.questionId - right.questionId
      )
    };
  }

  function normalizeSiteState(entryValue) {
    const entry = assertObject(entryValue, "原站题目状态格式错误");
    const questionId = readQuestionId(entry.question_id ?? entry.id);
    const state =
      entry.user_state && typeof entry.user_state === "object"
        ? entry.user_state
        : entry;
    const mastery = readMastery(state, questionId);
    const favorite = readFavorite(state, questionId);
    return {
      questionId,
      mastery: mastery.present ? mastery.value : "not_started",
      favorite: favorite.present ? favorite.value : false,
      favoritedAt:
        typeof state.favorited_at === "string" ? state.favorited_at : null,
      updatedAt:
        typeof state.updated_at === "string"
          ? state.updated_at
          : typeof state.updatedAt === "string"
            ? state.updatedAt
            : null
    };
  }

  function normalizeSiteStates(entries) {
    if (!Array.isArray(entries)) throw new Error("原站题目状态必须是数组");
    const statesById = new Map();
    for (const entry of entries) {
      const state = normalizeSiteState(entry);
      statesById.set(state.questionId, state);
    }
    return Array.from(statesById.values()).sort(
      (left, right) => left.questionId - right.questionId
    );
  }

  function buildImportPlan(documentValue, currentEntries) {
    const document = assertObject(documentValue, "导入文档格式错误");
    if (!Array.isArray(document.items)) throw new Error("导入文档缺少 items");
    const current = new Map(
      normalizeSiteStates(currentEntries).map((state) => [state.questionId, state])
    );
    const operations = [];
    let unknown = 0;
    let ignoredDefaults = 0;
    let unchanged = 0;
    const masteryChanges = {
      mastered: 0,
      needs_practice: 0,
      not_known: 0,
      not_started: 0
    };
    let favoriteAdds = 0;
    let favoriteRemovals = 0;

    for (const incoming of document.items) {
      const existing = current.get(incoming.questionId);
      if (!existing) {
        unknown += 1;
        continue;
      }

      const payload = {};
      if (incoming.hasMastery) {
        if (document.exact || incoming.mastery !== "not_started") {
          if (incoming.mastery !== existing.mastery) {
            payload.mastery = incoming.mastery;
            masteryChanges[incoming.mastery] += 1;
          }
        } else {
          ignoredDefaults += 1;
        }
      }

      if (incoming.hasFavorite) {
        if (document.exact || incoming.favorite) {
          if (incoming.favorite !== existing.favorite) {
            payload.is_favorite = incoming.favorite;
            if (incoming.favorite) favoriteAdds += 1;
            else favoriteRemovals += 1;
          }
        } else {
          ignoredDefaults += 1;
        }
      }

      if (Object.keys(payload).length) {
        operations.push({ questionId: incoming.questionId, payload });
      } else {
        unchanged += 1;
      }
    }

    return {
      exact: Boolean(document.exact),
      inputCount: document.items.length,
      currentCount: current.size,
      operations,
      summary: {
        changes: operations.length,
        unknown,
        ignoredDefaults,
        unchanged,
        masteryChanges,
        favoriteAdds,
        favoriteRemovals
      }
    };
  }

  function buildMobileSyncDocument(currentEntries, sourceOrigin, nowValue) {
    const now = nowValue || new Date().toISOString();
    const states = [];
    for (const state of normalizeSiteStates(currentEntries)) {
      const userState = {};
      if (state.mastery !== "not_started") userState.mastery = state.mastery;
      if (state.favorite) {
        userState.favorited_at = state.favoritedAt || state.updatedAt || now;
      }
      if (!Object.keys(userState).length) continue;
      if (state.updatedAt) userState.updated_at = state.updatedAt;
      states.push({ question_id: state.questionId, user_state: userState });
    }
    return {
      format: "daguan-browser-sync",
      version: 1,
      exported_at: now,
      source_origin: sourceOrigin,
      question_states: {
        total: states.length,
        states
      }
    };
  }

  function buildSiteBackupDocument(currentEntries, sourceOrigin, nowValue) {
    const now = nowValue || new Date().toISOString();
    const states = normalizeSiteStates(currentEntries).map((state) => ({
      question_id: state.questionId,
      user_state: {
        mastery: state.mastery,
        favorited_at: state.favorite
          ? state.favoritedAt || state.updatedAt || now
          : null,
        updated_at: state.updatedAt
      }
    }));
    return {
      format: "daguan-site-marker-backup",
      version: 1,
      exported_at: now,
      source_origin: sourceOrigin,
      question_states: {
        total: states.length,
        states
      }
    };
  }

  return {
    MASTERY_VALUES,
    MAX_IMPORT_STATES,
    parseImportDocument,
    normalizeSiteStates,
    buildImportPlan,
    buildMobileSyncDocument,
    buildSiteBackupDocument
  };
});
