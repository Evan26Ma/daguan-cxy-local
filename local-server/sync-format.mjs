const MASTERY_VALUES = new Set(["not_started", "mastered", "needs_practice", "not_known"]);
const LOCAL_MASTERY_VALUES = new Set(["not_started", "learning", "mastered"]);

export function nowIso() {
  return new Date().toISOString();
}

export function asQuestionId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d+$/.test(id) || Number(id) <= 0) throw new Error(`无效题目 ID：${id}`);
  return id;
}

function asState(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readMastery(value) {
  const state = asState(value);
  const mastery = state.mastery || state.status || "not_started";
  return MASTERY_VALUES.has(mastery) ? mastery : "not_started";
}

function readFavorite(value) {
  const state = asState(value);
  return state.favorite === true || state.is_favorite === true || state.favorited_at != null;
}

function readUpdatedAt(value) {
  const state = asState(value);
  return state.updated_at || state.updatedAt || null;
}

function localMasteryToRemote(value) {
  if (value === "mastered") return "mastered";
  if (value === "forgot") return "not_known";
  if (value === "learning") return "needs_practice";
  return "not_started";
}

function remoteMasteryToLocal(value) {
  if (value === "mastered") return "mastered";
  if (value === "not_known") return "learning";
  if (value === "needs_practice") return "learning";
  return "not_started";
}

function timestamp(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeLocalState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const progress = source.progress && typeof source.progress === "object" && !Array.isArray(source.progress)
    ? source.progress
    : {};
  const favorites = Array.isArray(source.favorites)
    ? [...new Set(source.favorites.map(String))]
    : [];
  const picked = Array.isArray(source.picked)
    ? [...new Set(source.picked.map(String))]
    : [];
  const normalizedProgress = {};
  for (const [id, rawValue] of Object.entries(progress)) {
    const item = asState(rawValue);
    const legacyForgot = item.mastery === "forgot";
    normalizedProgress[String(id)] = {
      ...item,
      mastery: LOCAL_MASTERY_VALUES.has(item.mastery) ? item.mastery : legacyForgot ? "learning" : "not_started",
      error_prone: item.error_prone === true || legacyForgot,
      ...(legacyForgot ? { legacy_mastery: "forgot" } : {}),
    };
  }
  return {
    format: "daguan-local-state",
    version: 3,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    progress: normalizedProgress,
    annotations: source.annotations && typeof source.annotations === "object" && !Array.isArray(source.annotations) ? { ...source.annotations } : {},
    favorites,
    picked,
    last_study: source.last_study && typeof source.last_study === "object" ? { ...source.last_study } : null,
    local_activity: source.local_activity && typeof source.local_activity === "object" ? { ...source.local_activity } : {},
    remote_activity: source.remote_activity && typeof source.remote_activity === "object" ? { ...source.remote_activity } : null,
    remote_last_study: source.remote_last_study && typeof source.remote_last_study === "object" ? { ...source.remote_last_study } : null,
    remote_seeded_at: source.remote_seeded_at || null,
    pending_unknown_states: source.pending_unknown_states && typeof source.pending_unknown_states === "object" ? { ...source.pending_unknown_states } : {},
    pending_remote_operations: Array.isArray(source.pending_remote_operations) ? [...source.pending_remote_operations] : [],
    updated_at: source.updated_at || null,
  };
}

export function normalizeRemoteStates(entries) {
  const source = Array.isArray(entries)
    ? entries
    : entries && typeof entries === "object"
      ? Object.entries(entries).map(([question_id, value]) => ({ question_id, ...asState(value) }))
      : [];
  const byId = new Map();
  for (const entryValue of source) {
    const entry = asState(entryValue);
    const rawId = entry.question_id ?? entry.questionId ?? entry.id;
    if (rawId == null) continue;
    let questionId;
    try {
      questionId = asQuestionId(rawId);
    } catch {
      continue;
    }
    const nested = asState(entry.user_state || entry.state || entry);
    byId.set(questionId, {
      question_id: questionId,
      mastery: readMastery(nested),
      favorite: readFavorite(nested),
      favorited_at: nested.favorited_at || null,
      updated_at: readUpdatedAt(nested),
    });
  }
  return [...byId.values()].sort((a, b) => Number(a.question_id) - Number(b.question_id));
}

export function unwrapPageItems(payload) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.states)) return body.states;
  if (body?.states && typeof body.states === "object") return body.states;
  if (body?.items && typeof body.items === "object") return body.items;
  return [];
}

export function pageTotal(payload) {
  const body = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const value = Number(body?.total ?? body?.count ?? payload?.total);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function localToRemoteDocument(localState) {
  const states = {};
  const progress = localState?.progress && typeof localState.progress === "object" ? localState.progress : {};
  const favorites = new Set((Array.isArray(localState?.favorites) ? localState.favorites : []).map(String));
  for (const [idValue, value] of Object.entries(progress)) {
    let id;
    try { id = asQuestionId(idValue); } catch { continue; }
    const state = asState(value);
    const mastery = state.mastery === "mastered"
      ? "mastered"
      : state.mastery === "forgot"
        ? "not_known"
        : state.mastery === "learning"
          ? "needs_practice"
          : "not_started";
    const favorite = favorites.has(id);
    if (mastery === "not_started" && !favorite) continue;
    states[id] = {
      mastery,
      favorite,
      updated_at: state.updated_at ? new Date(Number(state.updated_at)).toISOString() : nowIso(),
    };
  }
  for (const idValue of favorites) {
    let id;
    try { id = asQuestionId(idValue); } catch { continue; }
    if (!states[id]) states[id] = { mastery: "not_started", favorite: true, updated_at: nowIso() };
  }
  return {
    format: "daguan-local-progress",
    version: 1,
    exported_at: nowIso(),
    states,
  };
}

export function localToAndroidDocument(localState) {
  const progress = localState?.progress && typeof localState.progress === "object" ? localState.progress : {};
  const favorites = new Set((Array.isArray(localState?.favorites) ? localState.favorites : []).map(String));
  const states = {};
  for (const [idValue, value] of Object.entries(progress)) {
    let id;
    try { id = asQuestionId(idValue); } catch { continue; }
    const state = asState(value);
    const mastery = MASTERY_VALUES.has(state.mastery)
      ? state.mastery
      : state.mastery === "forgot"
        ? "not_known"
        : state.mastery === "learning"
          ? "needs_practice"
          : "not_started";
    const favorite = favorites.has(id);
    if (mastery === "not_started" && !favorite) continue;
    states[id] = {
      mastery,
      favorite,
      updatedAt: state.updated_at ? new Date(Number(state.updated_at)).toISOString() : null,
    };
  }
  for (const id of favorites) {
    if (!states[id]) states[id] = { mastery: "not_started", favorite: true, updatedAt: null };
  }
  return {
    format: "daguan-android-progress",
    version: 2,
    updatedAt: nowIso(),
    states,
    events: [],
    lastStudy: null,
  };
}

export function remoteStatesDocument(entries, format = "daguan-browser-sync") {
  const states = normalizeRemoteStates(entries).map((entry) => ({
    question_id: entry.question_id,
    user_state: {
      mastery: entry.mastery,
      favorited_at: entry.favorite ? entry.favorited_at || entry.updated_at || nowIso() : null,
      updated_at: entry.updated_at,
    },
  }));
  return {
    format,
    version: 1,
    exported_at: nowIso(),
    question_states: { total: states.length, states },
  };
}

function localEntry(local, id) {
  const progress = local.progress?.[id] && typeof local.progress[id] === "object" ? local.progress[id] : {};
  const favorite = new Set(local.favorites || []).has(id) || progress.favorite === true;
  const mastery = localMasteryToRemote(progress.mastery);
  const masteryUpdatedAt = timestamp(progress.mastery_updated_at || progress.updated_at);
  const favoriteUpdatedAt = timestamp(progress.favorite_updated_at || progress.updated_at);
  return {
    mastery,
    favorite,
    masteryUpdatedAt,
    favoriteUpdatedAt,
    present: Boolean(Object.keys(progress).length || favorite),
  };
}

function remoteEntry(remote) {
  const updatedAt = timestamp(remote.updated_at);
  return {
    mastery: remote.mastery || "not_started",
    favorite: remote.favorite === true,
    updatedAt,
  };
}

function changed(a, b) {
  return a !== b;
}

function localChange(questionId, field, value, remote, extra = {}) {
  return {
    questionId,
    field,
    value,
    remoteUpdatedAt: remote.updated_at || null,
    ...extra,
  };
}

export function buildReconcilePlan(localValue, remoteEntries, knownIds = null, options = {}) {
  const local = normalizeLocalState(localValue);
  const remote = normalizeRemoteStates(remoteEntries);
  const remoteById = new Map(remote.map((entry) => [entry.question_id, entry]));
  const localChanges = [];
  const remoteOperations = [];
  const conflicts = [];
  const unknownIds = [];
  const remoteAuthoritative = options.remoteAuthoritative === true;
  const forcedWinner = options.forceWinner === "local" || options.forceWinner === "remote" ? options.forceWinner : null;
  const localIds = new Set([
    ...Object.keys(local.progress || {}).map(String),
    ...(local.favorites || []).map(String),
  ]);

  for (const remoteRaw of remote) {
    const id = remoteRaw.question_id;
    if (knownIds && !knownIds.has(id)) {
      unknownIds.push(id);
      continue;
    }
    const incoming = remoteEntry(remoteRaw);
    const current = localEntry(local, id);
    const hasLocalMeaningfulState = current.present && (current.mastery !== "not_started" || current.favorite);
    const masteryDiff = changed(current.mastery, incoming.mastery);
    const favoriteDiff = changed(current.favorite, incoming.favorite);
    if (!masteryDiff && !favoriteDiff) continue;

    if (remoteAuthoritative || forcedWinner === "remote") {
      if (incoming.mastery !== "not_started") localChanges.push(localChange(id, "mastery", remoteMasteryToLocal(incoming.mastery), remoteRaw, { errorProne: incoming.mastery === "not_known" }));
      else if (current.mastery !== "not_started") localChanges.push(localChange(id, "mastery", "not_started", remoteRaw));
      if (favoriteDiff) localChanges.push(localChange(id, "favorite", incoming.favorite, remoteRaw));
      continue;
    }

    const localTime = Math.max(current.masteryUpdatedAt, current.favoriteUpdatedAt);
    const remoteTime = incoming.updatedAt;
    if (hasLocalMeaningfulState && remoteTime > 0 && localTime > 0 && localTime !== remoteTime) {
      conflicts.push({
        questionId: id,
        local: { mastery: current.mastery, favorite: current.favorite, updatedAt: localTime },
        remote: { mastery: incoming.mastery, favorite: incoming.favorite, updatedAt: remoteTime, updatedAtIso: remoteRaw.updated_at || null },
        defaultWinner: localTime > remoteTime ? "local" : "remote",
      });
    }
    const winner = forcedWinner || (localTime > remoteTime && localTime > 0 ? "local" : "remote");
    if (winner === "local") {
      const payload = {};
      if (masteryDiff) payload.mastery = current.mastery;
      if (favoriteDiff) payload.is_favorite = current.favorite;
      if (Object.keys(payload).length) remoteOperations.push({ questionId: id, payload });
    } else {
      if (masteryDiff) localChanges.push(localChange(id, "mastery", remoteMasteryToLocal(incoming.mastery), remoteRaw, { errorProne: incoming.mastery === "not_known" }));
      if (favoriteDiff) localChanges.push(localChange(id, "favorite", incoming.favorite, remoteRaw));
    }
  }

  for (const id of localIds) {
    if (knownIds && !knownIds.has(id)) {
      unknownIds.push(id);
      continue;
    }
    if (!remoteById.has(id)) {
      const current = localEntry(local, id);
      if (current.present && (current.mastery !== "not_started" || current.favorite)) {
        if (remoteAuthoritative || forcedWinner === "remote") {
          if (current.mastery !== "not_started") localChanges.push({ questionId: id, field: "mastery", value: "not_started", remoteUpdatedAt: null });
          if (current.favorite) localChanges.push({ questionId: id, field: "favorite", value: false, remoteUpdatedAt: null });
        } else {
          remoteOperations.push({ questionId: id, payload: { mastery: current.mastery, is_favorite: current.favorite } });
        }
      }
    }
  }

  const masteryChanges = { mastered: 0, needs_practice: 0, not_known: 0, not_started: 0 };
  const localMasteryChanges = { mastered: 0, needs_practice: 0, not_known: 0, not_started: 0 };
  let favoriteChanges = 0;
  const remoteQuestionIds = new Set();
  const localQuestionIds = new Set();
  for (const operation of remoteOperations) {
    remoteQuestionIds.add(String(operation.questionId));
    if (operation.payload.mastery) masteryChanges[operation.payload.mastery] += 1;
    if (Object.prototype.hasOwnProperty.call(operation.payload, "is_favorite")) favoriteChanges += 1;
  }
  for (const change of localChanges) {
    localQuestionIds.add(String(change.questionId));
    if (change.field !== "mastery") continue;
    const remoteValue = localMasteryToRemote(change.value);
    localMasteryChanges[remoteValue] += 1;
  }
  return {
    local: normalizeLocalState(local),
    remote: remoteStatesDocument(remote),
    localChanges,
    remoteOperations,
    conflicts,
    unknownIds: [...new Set(unknownIds)],
    summary: {
      remoteEntries: remote.length,
      localToRemote: remoteOperations.length,
      remoteToLocal: localChanges.length,
      localQuestionCount: remoteQuestionIds.size,
      remoteQuestionCount: localQuestionIds.size,
      conflictQuestionCount: new Set(conflicts.map((item) => String(item.questionId))).size,
      conflicts: conflicts.length,
      unknown: new Set(unknownIds).size,
      masteryChanges,
      localMasteryChanges,
      favoriteChanges,
    },
  };
}

export function applyLocalChanges(localValue, changes, metadata = {}) {
  const local = normalizeLocalState(localValue);
  for (const change of changes || []) {
    const id = String(change.questionId);
    const cur = local.progress[id] && typeof local.progress[id] === "object" ? { ...local.progress[id] } : {};
    if (change.field === "mastery") {
      cur.mastery = change.value;
      cur.seen = change.value !== "not_started" || cur.seen === true;
      cur.updated_at = Date.now();
      cur.mastery_updated_at = Date.now();
      cur.remote_updated_at = change.remoteUpdatedAt || null;
      if (change.errorProne === true) cur.error_prone = true;
      if (change.value === "not_started" && !cur.seen) delete local.progress[id];
      else local.progress[id] = cur;
    }
    if (change.field === "favorite") {
      cur.favorite = change.value === true;
      cur.favorite_updated_at = Date.now();
      if (cur.favorite) local.progress[id] = cur;
      const favorites = new Set(local.favorites);
      if (cur.favorite) favorites.add(id);
      else favorites.delete(id);
      local.favorites = [...favorites].sort((a, b) => Number(a) - Number(b));
    }
  }
  if (metadata.remoteActivity) local.remote_activity = metadata.remoteActivity;
  if (metadata.remoteLastStudy) {
    local.remote_last_study = metadata.remoteLastStudy;
    const remoteAt = timestamp(metadata.remoteLastStudy.updated_at || metadata.remoteLastStudy.updatedAt);
    const localAt = timestamp(local.last_study?.updated_at || local.last_study?.updatedAt);
    if (!local.last_study || remoteAt >= localAt) local.last_study = { ...metadata.remoteLastStudy };
  }
  if (metadata.remoteSeededAt) local.remote_seeded_at = metadata.remoteSeededAt;
  local.updated_at = nowIso();
  return local;
}

export function buildPullMerge(localState, remoteEntries, knownIds = null) {
  const local = {
    ...(localState || {}),
    progress: { ...(localState?.progress || {}) },
    favorites: [...(Array.isArray(localState?.favorites) ? localState.favorites : [])].map(String),
    picked: [...(Array.isArray(localState?.picked) ? localState.picked : [])].map(String),
  };
  const favorites = new Set(local.favorites);
  const changes = [];
  const unknownIds = [];
  for (const remote of normalizeRemoteStates(remoteEntries)) {
    const id = remote.question_id;
    if (knownIds && !knownIds.has(id)) {
      unknownIds.push(id);
      continue;
    }
    const cur = local.progress[id] && typeof local.progress[id] === "object" ? local.progress[id] : {};
    const remoteTime = Date.parse(remote.updated_at || "");
    const localTime = Number(cur.updated_at || 0);
    const canUpdateMastery = !Number.isFinite(remoteTime) || !localTime || remoteTime >= localTime;
    const localMastery = remote.mastery === "not_known" ? "learning" : remote.mastery === "needs_practice" ? "learning" : remote.mastery === "mastered" ? "mastered" : "not_started";
    const remoteAddsErrorFlag = remote.mastery === "not_known" && cur.error_prone !== true;
    if (remote.mastery !== "not_started" && canUpdateMastery && (cur.mastery !== localMastery || remoteAddsErrorFlag)) {
      local.progress[id] = {
        ...cur,
        mastery: localMastery,
        error_prone: remote.mastery === "not_known" ? true : cur.error_prone === true,
        seen: true,
        updated_at: Date.now(),
        remote_updated_at: remote.updated_at || null,
        remote_mastery: remote.mastery,
      };
      changes.push({ question_id: id, type: "mastery", value: local.progress[id].mastery });
    }
    if (remote.favorite && !favorites.has(id)) {
      favorites.add(id);
      changes.push({ question_id: id, type: "favorite", value: true });
    }
  }
  local.favorites = [...favorites].sort((a, b) => Number(a) - Number(b));
  local.updated_at = nowIso();
  return { state: local, changes, unknownIds: [...new Set(unknownIds)] };
}

export function buildPushPlan(localState, remoteEntries, knownIds = null) {
  const remote = new Map(normalizeRemoteStates(remoteEntries).map((entry) => [entry.question_id, entry]));
  const document = localToRemoteDocument(localState);
  const operations = [];
  const unknownIds = [];
  for (const [id, incoming] of Object.entries(document.states)) {
    if (knownIds && !knownIds.has(id)) {
      unknownIds.push(id);
      continue;
    }
    const existing = remote.get(id) || { mastery: "not_started", favorite: false };
    const payload = {};
    if (incoming.mastery !== "not_started" && incoming.mastery !== existing.mastery) payload.mastery = incoming.mastery;
    if (incoming.favorite && !existing.favorite) payload.is_favorite = true;
    if (Object.keys(payload).length) operations.push({ questionId: id, payload });
  }
  const masteryChanges = { mastered: 0, needs_practice: 0, not_known: 0 };
  let favoriteAdds = 0;
  for (const operation of operations) {
    if (operation.payload.mastery) masteryChanges[operation.payload.mastery] += 1;
    if (operation.payload.is_favorite) favoriteAdds += 1;
  }
  return {
    document,
    operations,
    summary: {
      inputCount: Object.keys(document.states).length,
      changes: operations.length,
      unknown: unknownIds.length,
      unknownIds,
      masteryChanges,
      favoriteAdds,
      favoriteRemovals: 0,
    },
  };
}
