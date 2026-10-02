(function(root) {
"use strict";
root.DaguanNewState = { create({ window, document, localStorage, sessionStorage, fetch, AppState, normalizeFontScale, resolveChapterForQuestion, toast, getAccess, getRenderer, getApp }) {
const PROGRESS_KEY_SHARED = 'daguan_local_progress_v1';
const FAVORITES_KEY_SHARED = 'daguan_local_favorites_v1';

function normalizeProgressEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const legacyForgot = value.mastery === 'forgot';
    return {
        ...value,
        mastery: ['not_started', 'learning', 'mastered'].includes(value.mastery)
            ? value.mastery
            : (legacyForgot ? 'learning' : (value.mastery || 'not_started')),
        error_prone: value.error_prone === true || legacyForgot,
    };
}

function readProgressStorage() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PROGRESS_KEY_SHARED) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { progress: {}, favorites: null, wrapped: false };
    if (raw.progress && typeof raw.progress === 'object' && !Array.isArray(raw.progress)) {
        // 新版本会话写过的包装形状：拆包升级
        const progress = {};
        for (const [id, value] of Object.entries(raw.progress)) {
            const entry = normalizeProgressEntry(value);
            if (entry) progress[String(id)] = entry;
        }
        return { progress, favorites: Array.isArray(raw.favorites) ? raw.favorites.map(String) : [], wrapped: true };
    }
    // 旧版形状：纯映射
    const progress = {};
    for (const [id, value] of Object.entries(raw)) {
        const entry = normalizeProgressEntry(value);
        if (entry) progress[String(id)] = entry;
    }
    return { progress, favorites: null, wrapped: false };
}

function writeProgressStorage(progress, favorites) {
    // 写旧版同形数据：进度键纯映射；收藏独立键。两版立即可见，不依赖服务端。
    const normalized = {};
    for (const [id, value] of Object.entries(progress || {})) {
        const entry = normalizeProgressEntry(value);
        if (entry) normalized[String(id)] = entry;
    }
    localStorage.setItem(PROGRESS_KEY_SHARED, JSON.stringify(normalized));
    localStorage.setItem(FAVORITES_KEY_SHARED, JSON.stringify((Array.isArray(favorites) ? favorites : []).map(String)));
}

// 待同步日志（真实实现与键名定义在 ui-version.js，新旧两版共用同一份）。
// 记录“本机已写入、服务端未确认”的批注与收藏编辑，使离线、写入失败、刷新与跨版本切换
// 都不会丢掉刚写入的本地编辑；恢复在线后按 updated_at 取本机最新值安全对账。
const PendingSync = typeof window !== 'undefined' ? window.DaguanPendingSync || null : null;
const ANNOTATION_KEY_SHARED = 'daguan_question_annotations_v1';

function readPendingSync() {
    const empty = { version: 1, annotations: {}, questions: {} };
    if (!PendingSync) return empty;
    try {
        const journal = PendingSync.read();
        return journal && typeof journal === 'object' ? journal : empty;
    } catch { return empty; }
}

function pendingAnnotationEntry(questionId) {
    return readPendingSync().annotations[String(questionId)] || null;
}

function pendingQuestionEntry(questionId) {
    return readPendingSync().questions[String(questionId)] || null;
}

function hasPendingSync() {
    if (!PendingSync) return false;
    try { return !!PendingSync.hasAny(); } catch { return false; }
}

class StorageService {
    static getProgress() {
        const stored = readProgressStorage();
        let favorites = stored.favorites;
        if (favorites == null) {
            try {
                const separate = JSON.parse(localStorage.getItem(FAVORITES_KEY_SHARED) || 'null');
                favorites = Array.isArray(separate) ? separate.map(String) : [];
            } catch { favorites = []; }
        }
        if (stored.wrapped) {
            // 立即把包装形状升级为旧版形状，保证旧版随时读到正确数据
            try { writeProgressStorage(stored.progress, favorites); } catch {}
        }
        return { progress: stored.progress, favorites };
    }

    static saveProgress(data) {
        const progress = data && typeof data.progress === 'object' && data.progress ? data.progress : {};
        const favorites = Array.isArray(data?.favorites) ? data.favorites : [];
        writeProgressStorage(progress, favorites);
    }

    static _entry(qid) {
        const data = this.getProgress();
        const entry = data.progress[String(qid)] || {};
        return { data, entry };
    }

    static _write(data, qid, entry) {
        entry.updated_at = new Date().toISOString();
        const key = String(qid);
        data.progress[key] = entry;
        const favSet = new Set(data.favorites.map(String));
        // 旧版可能只在独立收藏键里记录收藏（进度条目内没有 favorite 字段）。
        // 此时按收藏数组的现有状态保留，避免一次掌握/易错切换把旧版收藏删掉。
        const favoriteOn = typeof entry.favorite === 'boolean' ? entry.favorite : favSet.has(key);
        if (favoriteOn) favSet.add(key); else favSet.delete(key);
        data.favorites = [...favSet].sort((a, b) => Number(a) - Number(b));
        this.saveProgress(data);
    }

    static toggleFavorite(qid) {
        const { data, entry } = this._entry(qid);
        entry.favorite = !this.isFavorite(qid);
        this._write(data, qid, entry);
        return entry.favorite;
    }

    static toggleMistake(qid) {
        const { data, entry } = this._entry(qid);
        entry.error_prone = !entry.error_prone;
        this._write(data, qid, entry);
        return entry.error_prone;
    }

    static toggleMastered(qid) {
        const current = this._entry(qid).entry.mastery || 'not_started';
        const next = current === 'mastered' ? 'not_started' : 'mastered';
        return this.setMastery(qid, next) === 'mastered';
    }

    static cycleMastery(qid) {
        const current = this._entry(qid).entry.mastery || 'not_started';
        const next = current === 'not_started' ? 'learning' : current === 'learning' ? 'mastered' : 'not_started';
        return this.setMastery(qid, next);
    }

    static setMastery(qid, mastery) {
        const { data, entry } = this._entry(qid);
        entry.mastery = ['not_started', 'learning', 'mastered'].includes(mastery) ? mastery : 'not_started';
        this._write(data, qid, entry);
        return entry.mastery;
    }

    static isFavorite(qid) {
        const { data, entry } = this._entry(qid);
        if (entry.favorite === true) return true;
        if (entry.favorite === false) return false;
        // 旧版把收藏只写在 daguan_local_favorites_v1 数组里，条目内没有 favorite 字段
        return data.favorites.map(String).includes(String(qid));
    }

    static isMistake(qid) {
        return this._entry(qid).entry.error_prone === true;
    }

    static isMastered(qid) {
        return this._entry(qid).entry.mastery === 'mastered';
    }

    static favoriteCount() {
        return this.getProgress().favorites.length;
    }

    static mistakeCount() {
        const { progress } = this.getProgress();
        return Object.values(progress).filter(e => e.error_prone === true).length;
    }

    static unmasteredCount() {
        const { progress } = this.getProgress();
        return Object.values(progress).filter(e => e.mastery && e.mastery !== 'mastered').length;
    }

    // 落盘格式与旧版/服务端对齐：{markdown, updated_at, history:[{markdown, updated_at}]}
    // 读取时归一化为 {content, lastModified, history} 视图，下游代码不用关心存储字段
    static getAnnotations() {
        try {
            const raw = JSON.parse(localStorage.getItem('daguan_question_annotations_v1') || '{}');
            const out = {};
            for (const [qid, entry] of Object.entries(raw)) {
                if (!entry || typeof entry !== 'object') continue;
                out[qid] = {
                    content: typeof entry.markdown === 'string' ? entry.markdown : (typeof entry.content === 'string' ? entry.content : ''),
                    lastModified: entry.updated_at || entry.lastModified || null,
                    history: Array.isArray(entry.history) ? entry.history : [],
                };
            }
            return out;
        } catch { return {}; }
    }

    static saveAnnotations(annotations) {
        localStorage.setItem('daguan_question_annotations_v1', JSON.stringify(this.normalizeAnnotationsForStorage(annotations)));
    }

    // 批注统一为旧版落盘形状 {markdown, updated_at, history:[{markdown, updated_at}]}
    // （本会话早前版本导出过 {content, lastModified, history} 视图形状，导入时在此兼容）
    static normalizeAnnotationsForStorage(annotations) {
        const out = {};
        const now = new Date().toISOString();
        for (const [qid, entry] of Object.entries(annotations || {})) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const markdown = typeof entry.markdown === 'string' ? entry.markdown : (typeof entry.content === 'string' ? entry.content : '');
            out[String(qid)] = {
                markdown,
                updated_at: entry.updated_at || entry.lastModified || now,
                history: (Array.isArray(entry.history) ? entry.history : []).map(h => ({
                    markdown: typeof (h && (h.markdown ?? h.content)) === 'string' ? (h.markdown ?? h.content) : '',
                    updated_at: (h && (h.updated_at || h.timestamp)) || now,
                })),
            };
        }
        return out;
    }

    static readAnnotationsStorage() {
        try {
            const raw = JSON.parse(localStorage.getItem('daguan_question_annotations_v1') || '{}');
            return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        } catch { return {}; }
    }

    static getAnnotation(questionId) {
        return this.getAnnotations()[String(questionId)] || { content: '', history: [] };
    }

    static saveAnnotation(questionId, content) {
        const annotations = this.getAnnotations();
        const now = new Date().toISOString();
        const entry = annotations[String(questionId)] || { content: '', history: [], lastModified: null };

        if (entry.content !== content) {
            entry.history.unshift({ content: entry.content, timestamp: entry.lastModified || now });
            if (entry.history.length > 10) entry.history = entry.history.slice(0, 10);
        }
        entry.content = content;
        entry.lastModified = now;

        annotations[String(questionId)] = entry;
        this.saveAnnotations(annotations);
        return true;
    }

    // 学习备忘（旧版全局备忘，键 daguan_local_notes_v1：纯字符串或 {content,...} 对象）
    static getLocalMemo() {
        const raw = localStorage.getItem('daguan_local_notes_v1');
        if (raw == null) return { content: '', savedAt: null, rawObject: null };
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return {
                    content: typeof parsed.content === 'string' ? parsed.content : '',
                    savedAt: parsed.updated_at || parsed.lastModified || null,
                    rawObject: parsed
                };
            }
            if (typeof parsed === 'string') return { content: parsed, savedAt: null, rawObject: null };
        } catch {}
        // 非 JSON 的纯文本
        return { content: raw, savedAt: null, rawObject: null };
    }

    static saveLocalMemo(content) {
        const memo = this.getLocalMemo();
        if (memo.rawObject) {
            memo.rawObject.content = content;
            memo.rawObject.updated_at = new Date().toISOString();
            localStorage.setItem('daguan_local_notes_v1', JSON.stringify(memo.rawObject));
        } else {
            localStorage.setItem('daguan_local_notes_v1', content);
        }
    }

    static getLearningPosition() {
        try {
            const data = JSON.parse(localStorage.getItem('daguan_learning_position_v2') || 'null');
            return data && typeof data === 'object' ? data : null;
        } catch { return null; }
    }

    // questionIndex 可为 null（跨版本恢复时按 questionId 在章节队列中定位）。
    // 同时写 sessionStorage 的旧版形状（同标签页跨版本切换时旧版直接读取恢复同题，离线也可用）。
    static saveLearningPosition(categoryId, chapterId, questionIndex, questionId = null, mode = 'single') {
        const payload = {
            categoryId,
            chapterId,
            questionIndex: Number.isInteger(questionIndex) ? questionIndex : null,
            questionId: questionId == null ? null : String(questionId),
            mode: mode === 'multi' ? 'multi' : 'single',
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('daguan_learning_position_v2', JSON.stringify(payload));
        try {
            sessionStorage.setItem('daguan_learning_position_v2', JSON.stringify({
                view: 'browse',
                cat: chapterId,
                question: questionId == null ? null : String(questionId),
                index: Number.isInteger(questionIndex) ? questionIndex : 0,
                mode: mode === 'multi' ? 'multi' : 'single',
            }));
        } catch { /* 隐私模式等场景忽略 */ }
    }

    static getAIPreferences() {
        // 与旧版共享 daguan_ai_preferences_v1：档案选择存 profileId，API Key 一律保存在本地服务端档案里。
        try {
            const data = JSON.parse(localStorage.getItem('daguan_ai_preferences_v1') || 'null');
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch { return {}; }
    }

    static saveAIPreferences(prefs) {
        localStorage.setItem('daguan_ai_preferences_v1', JSON.stringify(prefs && typeof prefs === 'object' ? prefs : {}));
    }

    static saveAIPreference(field, value) {
        const prefs = this.getAIPreferences();
        if (value == null || value === '') delete prefs[field];
        else prefs[field] = value;
        this.saveAIPreferences(prefs);
        return prefs;
    }

    static getAIDraft(questionId) {
        const key = (window.DaguanVersions && window.DaguanVersions.draftKey) ? window.DaguanVersions.draftKey(questionId) : `daguan_ai_draft_v1:${questionId}`;
        return localStorage.getItem(key) || '';
    }

    static saveAIDraft(questionId, content) {
        const key = (window.DaguanVersions && window.DaguanVersions.draftKey) ? window.DaguanVersions.draftKey(questionId) : `daguan_ai_draft_v1:${questionId}`;
        if (content) {
            localStorage.setItem(key, content);
        } else {
            localStorage.removeItem(key);
        }
    }

    // 新版旧键（daguan_ai_draft_<id>、daguan_ui_appearance_new）迁移到共享模块的键。
    // 只填空白目标键、不覆盖已有偏好；可重复执行。
    static migrateLegacyKeys() {
        let migrated = 0;
        try {
            const draftPrefix = (window.DaguanVersions && window.DaguanVersions.draftKey) ? window.DaguanVersions.draftKey('') : 'daguan_ai_draft_v1:';
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                const match = /^daguan_ai_draft_(.+)$/.exec(key || '');
                if (!match || match[1].startsWith('v1:')) continue;
                const target = `${draftPrefix}${match[1]}`;
                if (localStorage.getItem(target) == null) {
                    localStorage.setItem(target, localStorage.getItem(key));
                    migrated += 1;
                }
            }
        } catch {}
        try {
            const appearanceKey = (window.DaguanVersions && window.DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
            const current = localStorage.getItem(appearanceKey);
            const blank = current == null || current === '' || current === '{}';
            const legacy = localStorage.getItem('daguan_ui_appearance_new');
            if (blank && legacy != null) {
                const parsed = JSON.parse(legacy);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
                    localStorage.setItem(appearanceKey, legacy);
                    migrated += 1;
                }
            }
        } catch {}
        return migrated;
    }

    static getUIAppearance() {
        const key = (window.DaguanVersions && window.DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
        let data = {};
        try {
            data = JSON.parse(localStorage.getItem(key) || '{}');
        } catch { data = {}; }
        const defaults = { theme: 'path-red', brand: '#C83F32', app: '#F7F3EA', reading: '#FFFEFA', accent: '#9A7746', reduceMotion: false, fontScale: 1 };
        const appearance = data && typeof data === 'object' && !Array.isArray(data) ? { ...defaults, ...data } : defaults;
        appearance.fontScale = normalizeFontScale(appearance.fontScale);
        return appearance;
    }

    static saveUIAppearance(appearance) {
        const key = (window.DaguanVersions && window.DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
        const data = appearance && typeof appearance === 'object' ? appearance : {};
        localStorage.setItem(key, JSON.stringify({ ...data, fontScale: normalizeFontScale(data.fontScale) }));
    }

    static getVersionPreference() {
        try { return localStorage.getItem('daguan_ui_version_v1') === 'old' ? 'old' : 'new'; } catch { return 'new'; }
    }

    static saveVersionPreference(version) {
        try { localStorage.setItem('daguan_ui_version_v1', version === 'old' ? 'old' : 'new'); } catch {}
    }
}

// ========== 预览权限（与旧版 /api/access 契约一致） ==========
const RESTORE_PENDING_KEY = 'daguan_restore_pending_v1';
const RESTORE_ROLLBACK_KEY = 'daguan_restore_rollback_v1';

const StateSync = {
    available: false,
    hydrated: false,
    revision: 0,
    queue: new Map(),
    timer: 0,
    syncing: false,
    lastStudyInFlight: null,
    lastStudyPending: null,
    retryTimer: 0,
    retryAttempts: 0,
    eventSource: null,
    eventRefreshTimer: 0,

    mergeProgress(a, b) {
        const out = { ...(a || {}) };
        for (const [id, p] of Object.entries(b || {})) {
            if (!p || typeof p !== 'object') continue;
            const cur = out[id];
            if (!cur) out[id] = p;
            else if (timestampOf(p.updated_at) >= timestampOf(cur.updated_at)) out[id] = { ...cur, ...p };
        }
        return out;
    },

    hasRestorePending() {
        return localStorage.getItem(RESTORE_PENDING_KEY) != null;
    },
    markRestorePending() {
        localStorage.setItem(RESTORE_PENDING_KEY, String(Date.now()));
    },
    clearRestorePending() {
        localStorage.removeItem(RESTORE_PENDING_KEY);
    },
    clearRestoreRollback() {
        localStorage.removeItem(RESTORE_ROLLBACK_KEY);
    },

    // ------- 待同步日志：离线/失败编辑的留痕、对账与补写 -------

    // 本机对某题批注的“最新意图”：待同步日志快照与本机存储取 updated_at 新者（本机更新则以本机为准）
    pendingAnnotationValue(questionId) {
        const id = String(questionId);
        const pending = pendingAnnotationEntry(id);
        const local = StorageService.readAnnotationsStorage()[id] || null;
        if (local && (!pending || timestampOf(local.updated_at) > timestampOf(pending.updated_at))) {
            return { markdown: String(local.markdown == null ? '' : local.markdown), updated_at: local.updated_at || null, queued: !!pending };
        }
        if (pending) return { markdown: String(pending.markdown == null ? '' : pending.markdown), updated_at: pending.updated_at || null, queued: true };
        if (local) return { markdown: String(local.markdown == null ? '' : local.markdown), updated_at: local.updated_at || null, queued: false };
        return null;
    },

    // 本机对某题逐题状态的“最新意图”：日志 patch 里比本机进度条目更新的字段以日志为准
    pendingQuestionPatch(questionId) {
        const id = String(questionId);
        const pending = pendingQuestionEntry(id);
        if (!pending) return null;
        const local = StorageService.getProgress().progress[id] || null;
        const pendingAt = timestampOf(pending.updated_at);
        const localAt = timestampOf(local && local.updated_at);
        const patch = {};
        for (const [field, value] of Object.entries(pending.patch)) {
            patch[field] = (local && localAt > pendingAt && field in local) ? local[field] : value;
        }
        return patch;
    },

    // 服务端数据与待同步日志合并（绝不用旧服务端值覆盖待同步的本地编辑）
    mergeFavorites(remoteFavorites, local, mergedProgress) {
        const localSet = new Set((local?.favorites || []).map(String));
        const sortIds = ids => [...ids].sort((a, b) => Number(a) - Number(b));
        if (!Array.isArray(remoteFavorites)) return sortIds(localSet);
        const remoteSet = new Set(remoteFavorites.map(String));
        const journal = readPendingSync().questions;
        const out = new Set();
        for (const id of new Set([...remoteSet, ...localSet])) {
            const patch = journal[id] && journal[id].patch;
            const entry = mergedProgress[id];
            let favorite;
            if (patch && typeof patch.favorite === 'boolean') favorite = patch.favorite;
            else if (entry && typeof entry.favorite === 'boolean') favorite = entry.favorite;
            else favorite = remoteSet.has(id) || localSet.has(id);
            if (favorite) out.add(id);
        }
        return sortIds(out);
    },

    mergeAnnotations(remoteAnnotations, localAnnotations) {
        const local = localAnnotations || StorageService.readAnnotationsStorage();
        const journal = readPendingSync().annotations;
        const out = { ...local };
        if (!remoteAnnotations || typeof remoteAnnotations !== 'object' || Array.isArray(remoteAnnotations)) return out;
        for (const [id, value] of Object.entries(remoteAnnotations)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            if (Object.prototype.hasOwnProperty.call(journal, id)) continue;
            const localEntry = local[id];
            if (localEntry && timestampOf(localEntry.updated_at) > timestampOf(value.updated_at)) continue;
            out[id] = value;
        }
        return out;
    },

    // 把待同步日志里的本地编辑回填本机存储：即使服务端不可读，刷新后本地编辑也还在
    localizePending() {
        const journal = readPendingSync();
        const annotationIds = Object.keys(journal.annotations);
        if (annotationIds.length) {
            const annotations = StorageService.readAnnotationsStorage();
            for (const id of annotationIds) {
                const pending = journal.annotations[id];
                const local = annotations[id];
                if (local && timestampOf(local.updated_at) >= timestampOf(pending.updated_at)) continue;
                annotations[id] = {
                    markdown: pending.markdown,
                    updated_at: pending.updated_at || new Date().toISOString(),
                    history: Array.isArray(local?.history) ? local.history : [],
                };
            }
            try { localStorage.setItem(ANNOTATION_KEY_SHARED, JSON.stringify(annotations)); } catch {}
        }
        const questionIds = Object.keys(journal.questions);
        if (questionIds.length) {
            const local = StorageService.getProgress();
            const progress = { ...local.progress };
            const favorites = new Set(local.favorites.map(String));
            let touched = false;
            for (const id of questionIds) {
                const patch = journal.questions[id].patch;
                if (!patch || !Object.keys(patch).length) continue;
                progress[id] = { ...(progress[id] || {}), ...patch };
                if (typeof patch.favorite === 'boolean') {
                    if (patch.favorite) favorites.add(id);
                    else favorites.delete(id);
                }
                touched = true;
            }
            if (touched) {
                try {
                    StorageService.saveProgress({ progress, favorites: [...favorites].sort((a, b) => Number(a) - Number(b)) });
                } catch {}
            }
        }
    },

    // 写入失败/离线后的自动重试只按需安排，并且有次数上限；测试可用 cancelRetry 收尾
    cancelRetry() {
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = 0; }
    },

    scheduleRetry(delay = 8000) {
        if (this.retryTimer || this.retryAttempts >= 20) return;
        if (!hasPendingSync()) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = 0;
            if (!hasPendingSync()) { this.retryAttempts = 0; return; }
            this.retryAttempts += 1;
            this.retryPending();
        }, delay);
    },

    // 恢复在线/页面回到前台后的自动补写：先水合（拿到最新 revision），再把待同步编辑补上
    async retryPending() {
        if (!getAccess().privateAllowed(false) || !hasPendingSync()) return false;
        if (!this.available) await this.hydrate();
        if (!this.available) { this.scheduleRetry(); return false; }
        return this.flushPending();
    },

    // 把待同步日志中的编辑逐题补写到服务端（只走逐题接口，绝不整份 PUT 覆盖服务端其它改动）
    async flushPending() {
        if (!getAccess().privateAllowed(false)) return false;
        const journal = readPendingSync();
        const annotationIds = Object.keys(journal.annotations);
        const questionIds = Object.keys(journal.questions);
        if (!annotationIds.length && !questionIds.length) { this.retryAttempts = 0; return true; }
        if (!this.available) { this.scheduleRetry(); return false; }
        let ok = true;
        for (const id of annotationIds) {
            const value = this.pendingAnnotationValue(id);
            if (!value) continue;
            const stamp = value.updated_at || new Date().toISOString();
            // 先把日志指纹刷新为即将推送的值：成功后按指纹清除，期间再次编辑不会被误清
            if (PendingSync) PendingSync.queueAnnotation(id, value.markdown, stamp);
            try { await this.flushAnnotation(id, value.markdown); }
            catch { ok = false; }
        }
        if (questionIds.length) {
            for (const id of questionIds) {
                const patch = this.pendingQuestionPatch(id);
                if (!patch || !Object.keys(patch).length) continue;
                this.queueQuestion(id, patch);
            }
            const flushed = await this.flush();
            if (!flushed) ok = false;
        }
        if (hasPendingSync()) { this.scheduleRetry(); return false; }
        this.retryAttempts = 0;
        return ok;
    },

    async hydrate() {
        if (!getAccess().privateAllowed(false)) { this.hydrated = true; return this; }
        // 恢复备份后的待对账保护：先以本地为准推送到服务端；失败时绝不用旧服务端数据覆盖刚恢复的收藏/批注
        if (this.hasRestorePending()) {
            const reconciled = await this.reconcileLocalToServer();
            if (reconciled) {
                this.clearRestorePending();
                this.clearRestoreRollback();
            } else {
                this.available = false;
                this.hydrated = true;
                return this;
            }
        }
        try {
            const response = await fetch('./api/state', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const remote = await response.json();
            const local = StorageService.getProgress();
            const progress = this.mergeProgress(remote?.progress, local.progress);
            this.revision = Number(remote?.revision) || 0;
            // 收藏与批注都不再用服务端值整体覆盖本地：
            // 待同步（离线/写入失败）的编辑、以及本机 updated_at 更新的编辑一律保留，
            // 服务端只补上本地确实没有或更旧的部分。
            const favorites = this.mergeFavorites(remote?.favorites, local, progress);
            StorageService.saveProgress({ progress, favorites });
            const annotations = this.mergeAnnotations(remote?.annotations);
            try { localStorage.setItem(ANNOTATION_KEY_SHARED, JSON.stringify(annotations)); } catch {}
            if (Array.isArray(remote?.picked)) {
                localStorage.setItem('daguan_local_picked_v1', JSON.stringify(remote.picked.map(String)));
            }
            this.localizePending();
            this.available = true;
            this.absorbLastStudy(remote?.last_study || null);
        } catch {
            // 服务端不可用（离线/500）：保留本地编辑与待同步状态，绝不因为读不到服务端而丢数据
            this.available = false;
            try { this.localizePending(); } catch {}
            this.scheduleRetry();
        } finally {
            this.hydrated = true;
        }
        if (this.available && hasPendingSync()) await this.flushPending();
        return this;
    },

    connectEvents() {
        if (window.location.protocol === 'https:') {
            if (!this.remotePollTimer) {
                this.remotePollTimer = setInterval(() => { if (document.visibilityState === 'visible') void this.refreshFromEvent(); }, 5000);
                window.addEventListener('pagehide', () => clearInterval(this.remotePollTimer), { once: true });
            }
            return;
        }
        if (this.eventSource || !window.EventSource || !getAccess().privateAllowed(false)) return;
        const status = document.getElementById('local-service-status');
        let disconnected = false;
        this.eventSource = new window.EventSource('./api/state/events');
        this.eventSource.onopen = () => {
            const wasDisconnected = disconnected;
            if (disconnected && status) {
                status.textContent = '本地服务已恢复连接，学习记录已同步';
                status.hidden = false;
                setTimeout(() => { if (status.textContent === '本地服务已恢复连接，学习记录已同步') status.hidden = true; }, 3500);
            } else if (status) {
                status.hidden = true;
            }
            disconnected = false;
            if (wasDisconnected) this.refreshFromEvent();
        };
        this.eventSource.onerror = () => {
            disconnected = true;
            if (status) {
                status.textContent = '本地服务连接中断，正在自动重连；未提交批注仍保留在本机。';
                status.hidden = false;
            }
        };
        this.eventSource.addEventListener('state', event => {
            let revision = 0;
            try { revision = Number(JSON.parse(event.data || '{}').revision) || 0; } catch {}
            if (revision > this.revision) this.refreshFromEvent();
        });
        this.eventSource.addEventListener('visit-history', () => { if (AppState.currentView === 'history') void getApp().showHistory(); });
        window.addEventListener('pagehide', () => this.eventSource?.close(), { once: true });
    },

    async refreshFromEvent() {
        if (!this.hydrated || document.visibilityState !== 'visible') return;
        if (this.syncing || this.lastStudyInFlight) {
            if (!this.eventRefreshTimer) this.eventRefreshTimer = setTimeout(() => {
                this.eventRefreshTimer = 0;
                this.refreshFromEvent();
            }, 600);
            return;
        }
        const previousRevision = this.revision;
        await this.hydrate();
        if (!this.available || this.revision <= previousRevision) return;
        try {
            if (AppState.currentView === 'question' && !AppState.annotationDirty) await getRenderer().renderQuestion(AppState.currentQuestionIndex);
            else if (AppState.currentView === 'home') getRenderer().renderHome();
            else if (AppState.currentView === 'records') getRenderer().renderRecords();
            else if (AppState.currentView === 'library') getRenderer().renderLibrary(AppState.currentCategory?.id);
            else if (AppState.currentView === 'notes' && !AppState.memoDirty) getRenderer().renderNotes();
        } catch (error) {
            console.warn('刷新其他窗口的学习记录失败', error);
        }
    },

    // 备份恢复对账：以本地当前数据为准整份写入服务端（PUT /api/state，携带 revision；409 重读后重试一次）。
    // last_study 保留服务端现有值，不因恢复而改变“继续学习”位置。
    async reconcileLocalToServer() {
        try {
            const response = await fetch('./api/state', { cache: 'no-store' });
            if (!response.ok) return false;
            const remote = await response.json();
            this.revision = Number(remote?.revision) || 0;
            let picked = [];
            try { picked = JSON.parse(localStorage.getItem('daguan_local_picked_v1') || '[]'); } catch { picked = []; }
            const payload = {
                progress: StorageService.getProgress().progress,
                favorites: StorageService.getProgress().favorites,
                picked: Array.isArray(picked) ? picked.map(String) : [],
                annotations: StorageService.readAnnotationsStorage(),
                last_study: remote?.last_study || null,
            };
            for (let attempt = 0; attempt < 2; attempt++) {
                const put = await fetch('./api/state', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'If-Match': String(this.revision) },
                    body: JSON.stringify({ ...payload, revision: this.revision }),
                    signal: AbortSignal.timeout(15000),
                });
                if (put.status === 409 && attempt === 0) {
                    const reread = await fetch('./api/state', { cache: 'no-store' }).catch(() => null);
                    if (reread && reread.ok) {
                        const current = await reread.json();
                        this.revision = Number(current?.revision) || 0;
                        continue;
                    }
                    return false;
                }
                if (!put.ok) return false;
                const result = await put.json();
                this.revision = Number(result.revision) || this.revision;
                this.available = true;
                return true;
            }
            return false;
        } catch {
            return false;
        }
    },

    // 官网/旧版写入的最近学习位置 → 新版“继续学习”位置（只在新数据时落盘，不覆盖更新的本机位置）
    absorbLastStudy(lastStudy) {
        if (!lastStudy || lastStudy.category_id == null || lastStudy.question_id == null) return;
        const position = StorageService.getLearningPosition();
        const remoteAt = timestampOf(lastStudy.updated_at);
        const localAt = timestampOf(position?.timestamp);
        if (position && position.questionId === String(lastStudy.question_id)) return;
        if (position && localAt >= remoteAt) return;
        const resolved = resolveChapterForQuestion(lastStudy.category_id, lastStudy.question_id);
        if (!resolved) return;
        StorageService.saveLearningPosition(resolved.top.id, resolved.leaf.id, null, String(lastStudy.question_id));
    },

    queueQuestion(questionId, patch) {
        const key = String(questionId);
        this.queue.set(key, { ...(this.queue.get(key) || {}), ...patch });
        // 本机已写入、服务端尚未确认 → 记入待同步日志：离线、失败、刷新、跨版本都不会丢
        if (PendingSync) {
            try { PendingSync.queueQuestion(key, patch); } catch {}
        }
        if (this.available && this.hydrated) {
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => { this.flush(); }, 350);
        } else {
            this.scheduleRetry();
        }
    },

    // 服务端确认写入后才清除待同步状态；期间被改成别的值则继续挂着待同步
    confirmQuestion(questionId, patch) {
        if (!PendingSync) return;
        try { PendingSync.clearQuestion(String(questionId), patch); } catch {}
    },

    confirmAnnotation(questionId, markdown) {
        if (!PendingSync) return;
        try { PendingSync.clearAnnotation(String(questionId), markdown); } catch {}
    },

    async flush(timeoutMs = 10000) {
        if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
        if (!this.available || this.syncing || !this.queue.size) return true;
        this.syncing = true;
        const entries = [...this.queue.entries()];
        this.queue.clear();
        const requeue = () => { for (const [id, patch] of entries) this.queue.set(id, { ...patch, ...(this.queue.get(id) || {}) }); };
        try {
            for (const [id, patch] of entries) {
                const response = await fetch(`./api/state/questions/${encodeURIComponent(id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'If-Match': String(this.revision) },
                    body: JSON.stringify({ ...patch, revision: this.revision, updated_at: new Date().toISOString() }),
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (response.status === 409) {
                    const conflict = await response.json().catch(() => ({}));
                    if (conflict?.current) {
                        this.revision = Number(conflict.current.revision) || this.revision;
                        // 冲突时合并服务端进度，但保留本机未写入的编辑（新值 updated_at 更新者胜出）。
                        const local = StorageService.getProgress();
                        StorageService.saveProgress({
                            progress: this.mergeProgress(conflict.current.progress || {}, local.progress),
                            favorites: this.mergeFavorites(conflict.current.favorites, local, local.progress),
                        });
                    }
                    requeue();
                    return false;
                }
                if (!response.ok) throw new Error(`状态写入失败（HTTP ${response.status}）`);
                const result = await response.json();
                this.revision = Number(result.revision) || this.revision;
                this.confirmQuestion(id, patch);
            }
            this.choiceSyncWarning = false;
            return true;
        } catch {
            requeue();
            if (!this.choiceSyncWarning && entries.some(([, patch]) => 'last_ok' in patch)) {
                this.choiceSyncWarning = true;
                toast('作答状态尚未同步，已保留在本机，将自动重试');
            }
            return false;
        } finally {
            this.syncing = false;
            if (this.queue.size && !this.timer) this.timer = setTimeout(() => { this.flush(); }, 900);
        }
    },

    async flushAnnotation(questionId, markdown) {
        if (!this.available || !getAccess().privateAllowed(false)) return;
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await fetch(`./api/state/questions/${encodeURIComponent(questionId)}/annotation`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'If-Match': String(this.revision) },
                body: JSON.stringify({ markdown, revision: this.revision }),
                signal: AbortSignal.timeout(10000),
            });
            if (response.status === 409 && attempt === 0) {
                const conflict = await response.json().catch(() => ({}));
                if (conflict?.current) this.revision = Number(conflict.current.revision) || this.revision;
                continue;
            }
            if (!response.ok) throw new Error(`批注保存失败（HTTP ${response.status}）`);
            const result = await response.json();
            this.revision = Number(result.revision) || this.revision;
            this.confirmAnnotation(questionId, markdown);
            break;
        }
    },

    // 最近学习位置：真实题号 + 章节，携带 revision；409 重新读取后安全重试一次。
    // 平时失败不阻塞做题（记录待重试），但切换版本前 ensureFlushed 会严格核查。
    async pushLastStudy(categoryId, questionId, mode = 'single') {
        if (!this.available || !getAccess().privateAllowed(false)) return false;
        if (categoryId == null || questionId == null) return false;
        const payload = { category_id: String(categoryId), question_id: String(questionId), mode, updated_at: new Date().toISOString() };
        const run = (async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
                const response = await fetch('./api/state/last-study', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'If-Match': String(this.revision) },
                    body: JSON.stringify({ ...payload, revision: this.revision }),
                    signal: AbortSignal.timeout(10000),
                });
                if (response.status === 409 && attempt === 0) {
                    const conflict = await response.json().catch(() => ({}));
                    if (conflict?.current) {
                        this.revision = Number(conflict.current.revision) || this.revision;
                        continue;
                    }
                }
                if (!response.ok) return false;
                const result = await response.json();
                this.revision = Number(result.revision) || this.revision;
                return true;
            }
            return false;
        })();
        let trackedRun;
        trackedRun = run.finally(() => { if (this.lastStudyInFlight === trackedRun) this.lastStudyInFlight = null; });
        this.lastStudyInFlight = trackedRun;
        let ok = false;
        try { ok = await trackedRun; } catch { ok = false; }
        if (ok) this.lastStudyPending = null;
        else this.lastStudyPending = payload;
        return ok;
    },

    // 切换/离开前等待必要的服务端写入完成；位置或队列未落盘时抛错，由调用方留在当前页。
    async ensureFlushed() {
        if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
        if (this.lastStudyInFlight) {
            // 进行中的学习位置写入必须有明确结果：超时（仍在写）视为未保存，
            // 交由调用方留在当前页并提示重试，不能静默放行导航。
            const settled = await Promise.race([
                this.lastStudyInFlight.then(() => true, () => false),
                new Promise(resolve => setTimeout(() => resolve('timeout'), 5000)),
            ]);
            if (settled === 'timeout' && this.available && getAccess().privateAllowed(false)) {
                throw new Error('最近学习位置仍在保存，请稍后重试');
            }
        }
        // 学习位置写入未成功：切换前重试一次，仍失败则阻断导航
        if (this.lastStudyPending && this.available && getAccess().privateAllowed(false)) {
            const retry = await this.pushLastStudy(this.lastStudyPending.category_id, this.lastStudyPending.question_id, this.lastStudyPending.mode);
            if (!retry) throw new Error('最近学习位置未能保存，请重试');
        }
        if (!this.available) return;
        const deadline = Date.now() + 10000;
        while (this.syncing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (this.queue.size) {
            const ok = await this.flush();
            if (!ok || this.queue.size) throw new Error('学习记录仍在保存，请稍后重试');
        }
    }
};

function timestampOf(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}


return { StorageService, StateSync, PROGRESS_KEY_SHARED, FAVORITES_KEY_SHARED, PendingSync, ANNOTATION_KEY_SHARED, RESTORE_PENDING_KEY, RESTORE_ROLLBACK_KEY, normalizeProgressEntry, readProgressStorage, writeProgressStorage, readPendingSync, pendingAnnotationEntry, pendingQuestionEntry, hasPendingSync, timestampOf };
} };
})(window);
