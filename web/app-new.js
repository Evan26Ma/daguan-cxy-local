/**
 * 大观园新版应用 - 阶段 2 核心业务整合
 * 基于原生 JavaScript，整合题库浏览、做题、AI、批注等完整功能
 */

// ========== 离线缓存注册（与 app2.js 一致） ==========
if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js?v=118").catch(() => {});
}

// ========== 全局状态 ==========
const AppState = {
    currentView: 'home', // home, library, question, review, notes, records, tools, settings
    currentCategory: null,
    currentChapter: null,
    currentQuestionIndex: 0,
    questionOffset: 0,
    chapterQuestionCount: 0,
    questionMode: 'single',
    modeSwitchToken: 0,
    modeSwitchTarget: null,
    questionRailQuery: '',
    questionRailFilter: '',
    questions: [],
    categories: null,
    reviewTab: 'mistakes', // review 页当前标签：mistakes / favorites / todo
    selectedNoteId: null, // notes 页当前选中的批注题号或 '__memo__'
    manifest: null,
    catQuestions: {},
    idIndex: {},
    searchIndex: null,
    globalSearchQuery: '',
    globalSearchScope: 'all',
    globalSearchRows: [],
    globalSearchLimit: 40,
    globalSearchReturn: null,
    globalSearchScrollTop: 0,
    globalSearchContext: null,
    shortcuts: {},
    videoMappings: null,
    paradiyuVideoMapping: null,
    aiProfiles: [],
    aiProfileId: '',
    aiRunId: '',
    aiBusy: false,
    aiAbort: null,
    answers: {}, // 本次会话内每题已选选项 {qid: Set(label)}
    annotationDirty: false,
    memoDirty: false,
    switchingVersion: false,
    filters: {
        sources: [],
        years: [],
        types: [],
        lecturers: []
    },
    libraryQuery: '',
    libraryResultLimit: 40,
    directoryNodeId: null,
    catalogExpandedId: null,
    chapterScope: 'all',
    chapterPickerPath: [],
    libraryScrollTop: 0,
    appearanceDraft: null,
    ui: {
        navExpanded: window.innerWidth >= 1280,
        navOpen: false,
        aiPanelOpen: false,
        annotationPanelOpen: false,
        filterDrawerOpen: false
    }
};

const SHORTCUT_STORAGE_KEY = 'daguan_focus_shortcuts_v1';
const SHORTCUT_DEFAULTS = Object.freeze({ focus: 'F6', up: 'ArrowUp', down: 'ArrowDown', answer: ' ', mastery1: '1', mastery2: '2', mastery3: '3', error: 'e', favorite: 'f', ai: 'a', note: 'n', copy: 'c', help: '?', escape: 'Escape' });
const SHORTCUT_LABELS = Object.freeze({ focus: '沉浸阅读', up: '上一题', down: '下一题', answer: '显示 / 隐藏答案', mastery1: '标记未开始', mastery2: '标记学习中', mastery3: '标记已掌握', error: '切换易错', favorite: '切换收藏', ai: '打开 AI 解答', note: '打开题目批注', copy: '复制本题 Markdown', help: '显示快捷键帮助', escape: '关闭面板' });
const RESERVED_SHORTCUTS = new Set(['/', 'm', 'j', 'k', 'g']);
const SHORTCUT_CODE_FALLBACK = Object.freeze({ Space: ' ', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Escape: 'Escape', F6: 'F6', KeyA: 'a', KeyC: 'c', KeyE: 'e', KeyF: 'f', KeyN: 'n', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Slash: '/' });

function sourceGroup(source) {
    const text = String(source || '').trim();
    if (/^(?:19|20)\d{2}\s*数/.test(text)) return '历年真题';
    if (/880/.test(text)) return '880 题库';
    if (/660/.test(text)) return '660 题库';
    if (/真题同源/.test(text)) return '真题同源';
    if (/强化/.test(text)) return '强化练习';
    if (/基础/.test(text)) return '基础练习';
    if (/模拟/.test(text)) return '模拟练习';
    return '其他来源';
}

function sourceYear(source) {
    const match = String(source || '').match(/(?:19|20)\d{2}/);
    return match ? match[0] : '';
}

function masteryLabel(value) {
    return ({ not_started: '未开始', learning: '学习中', mastered: '已掌握' })[value] || '未开始';
}

function questionTypeLabel(type) {
    return ({ single_choice: '单选题', multiple_choice: '多选题', subjective: '主观题' })[type] || String(type || '其他题型');
}

const UI_THEMES = [
    { id: 'path-red', name: '朱红奶白', brand: '#C83F32', app: '#F7F3EA', reading: '#FFFEFA', accent: '#9A7746' },
    { id: 'orange-white', name: '橙白', brand: '#FF6A1A', app: '#F5F6F8', reading: '#FFFFFF', accent: '#B83D00' },
    { id: 'blue-sand', name: '蓝砂', brand: '#1E4A5C', app: '#ECE7DC', reading: '#FAF7F0', accent: '#8A6D49' },
    { id: 'eye-care', name: '米黄护眼', brand: '#80613B', app: '#EDE8D9', reading: '#FBF8EE', accent: '#66816B' },
    { id: 'orange-night', name: '橙黑夜间', brand: '#FF8A3D', app: '#191B1C', reading: '#242729', accent: '#E6B36B' },
    { id: 'mint', name: '薄荷实验', brand: '#31785E', app: '#EAF3ED', reading: '#FBFEFC', accent: '#AD7444' },
];
function relativeLuminance(hex) {
    const rgb = String(hex || '').replace('#', '').match(/.{2}/g);
    if (!rgb || rgb.length !== 3) return .5;
    const values = rgb.map(pair => parseInt(pair, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}
function contrastForeground(hex) {
    const luminance = relativeLuminance(hex);
    return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#202124' : '#FFFFFF';
}
function applyAppearanceValues(appearance) {
    const root = document.documentElement;
    if (!root) return;
    const data = appearance || {};
    const preset = UI_THEMES.find(item => item.id === data.theme) || UI_THEMES[0];
    const brand = data.brand || preset.brand;
    const app = data.app || preset.app;
    const reading = data.reading || preset.reading;
    const accent = data.accent || preset.accent;
    const dark = relativeLuminance(app) < .10;
    root.dataset.theme = data.theme || preset.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', brand);
    root.style.setProperty('--brand-orange', brand);
    root.style.setProperty('--brand-hover', brand);
    root.style.setProperty('--brand-active', brand);
    root.style.setProperty('--brand-light-bg', `${brand}24`);
    root.style.setProperty('--brand-text-on-white', dark ? '#FFD0B5' : brand);
    root.style.setProperty('--text-on-brand', contrastForeground(brand));
    root.style.setProperty('--bg-app', app);
    root.style.setProperty('--bg-surface', reading);
    root.style.setProperty('--bg-nav', dark ? '#2B2E30' : app);
    root.style.setProperty('--text-primary', dark ? '#F5F2EB' : contrastForeground(reading));
    root.style.setProperty('--text-secondary', dark ? '#C1C1BA' : '#5E5B55');
    root.style.setProperty('--border-default', dark ? '#484B4D' : `${accent}38`);
    root.style.setProperty('--border-control', dark ? '#85898B' : `${accent}99`);
    root.style.setProperty('--color-brand', brand);
    root.style.setProperty('--color-canvas', app);
    root.style.setProperty('--color-surface', reading);
    root.style.setProperty('--color-foreground', dark ? '#F5F2EB' : contrastForeground(reading));
    root.style.setProperty('--color-foreground-muted', dark ? '#C1C1BA' : '#5E5B55');
    root.style.setProperty('--color-border', dark ? '#484B4D' : `${accent}38`);
    root.style.setProperty('--color-on-brand', contrastForeground(brand));
    root.style.setProperty('--color-brand-text', dark ? '#FFD0B5' : brand);
    root.style.setProperty('--color-brand-soft', `${brand}24`);
}

// ========== 数据层 ==========
class DataService {
    // 一次性加载目录、题目映射与分片索引（格式对齐 app2.js 生产逻辑）
    static async loadAll() {
        const results = await Promise.all([
            fetch('./data/manifest.json').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('./data/categories.json').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('./data/category_questions.json').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('./data/id_index.json').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        const [manifest, categories, catQuestions, idIndex] = results;

        AppState.manifest = manifest || { shards: {} };
        AppState.categories = Array.isArray(categories) ? { categories } : (categories || { categories: [] });
        AppState.catQuestions = catQuestions || {};
        AppState.idIndex = idIndex || {};

        this.populateQuestions(AppState.categories.categories);
        return AppState.categories;
    }

    static async loadCategories() { return this.loadAll(); }

    static shardFileFor(name) {
        const meta = AppState.manifest && AppState.manifest.shards && AppState.manifest.shards[name];
        return meta ? `./data/${meta.file}` : null;
    }

    // 用 category_questions + id_index 填充每章的题目条目 {id, shard}
    static populateQuestions(nodes) {
        const populate = node => {
            const childIds = new Set();
            (node.children || []).forEach(child => populate(child).forEach(id => childIds.add(id)));
            const ids = AppState.catQuestions[String(node.id)] || [];
            node.questions = ids.map(id => ({ id, shard: AppState.idIndex[String(id)] || '未分类' }));
            node.direct_questions = node.questions.filter(entry => !childIds.has(String(entry.id)));
            const subtreeIds = new Set(childIds);
            node.direct_questions.forEach(entry => subtreeIds.add(String(entry.id)));
            return subtreeIds;
        };
        nodes.forEach(populate);
    }

    static async loadSearchIndex() {
        try {
            const response = await fetch('./data/search_index.json');
            if (!response.ok) throw new Error('Failed to load search index');
            const data = await response.json();
            AppState.searchIndex = data;
            return data;
        } catch (error) {
            console.error('Load search index error:', error);
            return null;
        }
    }

    static async loadVideoMappings() {
        try {
            const [lecture, paradiyu] = await Promise.all([
                fetch('./data/lecture-video-mappings.json').then(r => r.ok ? r.json() : null).catch(() => null),
                fetch('./data/paradiyu-linear-video.json').then(r => r.ok ? r.json() : null).catch(() => null),
            ]);
            AppState.videoMappings = lecture || { questions: {} };
            AppState.paradiyuVideoMapping = paradiyu || { questions: {} };
            return AppState.videoMappings;
        } catch (error) {
            console.warn('Load video mappings error:', error);
            AppState.videoMappings = { questions: {} };
            AppState.paradiyuVideoMapping = { questions: {} };
            return AppState.videoMappings;
        }
    }

    // 分片缓存：shard 名 → Map(question.id → question)
    static shardCache = new Map();
    static shardInflight = new Map();

    static async ensureShard(name) {
        if (DataService.shardCache.has(name)) return DataService.shardCache.get(name);
        if (DataService.shardInflight.has(name)) return DataService.shardInflight.get(name);
        const file = this.shardFileFor(name);
        if (!file) throw new Error('未知分片: ' + name);
        const job = fetch(file)
            .then(r => { if (!r.ok) throw new Error('分片加载失败: ' + name); return r.json(); })
            .then(list => {
                const arr = Array.isArray(list) ? list : (list.questions || []);
                const map = new Map(arr.map(q => [q.id, q]));
                DataService.shardCache.set(name, map);
                return map;
            });
        DataService.shardInflight.set(name, job);
        try { return await job; } finally { DataService.shardInflight.delete(name); }
    }

    static async loadQuestionsForChapter(chapter) {
        const entries = chapter.direct_questions || chapter.questions || [];
        if (!entries.length) return [];
        const byShard = new Map();
        entries.forEach(e => {
            if (!byShard.has(e.shard)) byShard.set(e.shard, []);
            byShard.get(e.shard).push(e.id);
        });
        await Promise.all([...byShard.keys()].map(n => this.ensureShard(n).catch(() => null)));
        const out = [];
        for (const e of entries) {
            const map = DataService.shardCache.get(e.shard);
            const q = map && (map.get(Number(e.id)) || map.get(String(e.id)));
            if (q) out.push(q);
        }
        return out;
    }

    static chapterEntries(chapter) {
        return chapter?.direct_questions || chapter?.questions || [];
    }

    // 多题阅读只取目标 20 题；深处定位不会先构造前面的题目对象或卡片。
    static async loadQuestionRange(chapter, start, count = 20) {
        const entries = this.chapterEntries(chapter);
        const offset = Math.max(0, Math.min(entries.length, Number(start) || 0));
        const selected = entries.slice(offset, offset + Math.max(1, Number(count) || 20));
        if (!selected.length) return [];
        const byShard = new Set(selected.map(entry => entry.shard));
        await Promise.all([...byShard].map(name => this.ensureShard(name).catch(() => null)));
        return selected.map(entry => {
            const map = DataService.shardCache.get(entry.shard);
            return map && (map.get(Number(entry.id)) || map.get(String(entry.id)));
        }).filter(Boolean);
    }

    static async getQuestion(id) {
        const name = AppState.idIndex[String(id)];
        if (!name) return null;
        try {
            const map = await this.ensureShard(name);
            return map.get(Number(id)) || map.get(String(id)) || null;
        } catch { return null; }
    }
}

// ========== 存储层 ==========
// 进度键 daguan_local_progress_v1 与旧版完全同形：纯映射 {题号: 状态}；
// 收藏独立存 daguan_local_favorites_v1（数组）。旧版本会话写入过的 {progress, favorites}
// 包装形状在读取时自动拆包升级，不丢数据。
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
        const key = (window.DaguanVersions && DaguanVersions.draftKey) ? DaguanVersions.draftKey(questionId) : `daguan_ai_draft_v1:${questionId}`;
        return localStorage.getItem(key) || '';
    }

    static saveAIDraft(questionId, content) {
        const key = (window.DaguanVersions && DaguanVersions.draftKey) ? DaguanVersions.draftKey(questionId) : `daguan_ai_draft_v1:${questionId}`;
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
            const draftPrefix = (window.DaguanVersions && DaguanVersions.draftKey) ? DaguanVersions.draftKey('') : 'daguan_ai_draft_v1:';
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
            const appearanceKey = (window.DaguanVersions && DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
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
        const key = (window.DaguanVersions && DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
        let data = {};
        try {
            data = JSON.parse(localStorage.getItem(key) || '{}');
        } catch { data = {}; }
        return data && typeof data === 'object' && !Array.isArray(data)
            ? { theme: 'path-red', brand: '#C83F32', app: '#F7F3EA', reading: '#FFFEFA', accent: '#9A7746', reduceMotion: false, ...data }
            : { theme: 'path-red', brand: '#C83F32', app: '#F7F3EA', reading: '#FFFEFA', accent: '#9A7746', reduceMotion: false };
    }

    static saveUIAppearance(appearance) {
        const key = (window.DaguanVersions && DaguanVersions.appearanceKey) || 'daguan_ui_appearance_new_v1';
        localStorage.setItem(key, JSON.stringify(appearance && typeof appearance === 'object' ? appearance : {}));
    }

    static getVersionPreference() {
        try { return localStorage.getItem('daguan_ui_version_v1') === 'old' ? 'old' : 'new'; } catch { return 'new'; }
    }

    static saveVersionPreference(version) {
        try { localStorage.setItem('daguan_ui_version_v1', version === 'old' ? 'old' : 'new'); } catch {}
    }
}

// ========== 预览权限（与旧版 /api/access 契约一致） ==========
const PreviewAccess = {
    mode: false,
    unlocked: true,
    async hydrate() {
        try {
            const response = await fetch('./api/access/status', { cache: 'no-store', credentials: 'include' });
            if (!response.ok) throw new Error('access status unavailable');
            const data = await response.json();
            this.mode = data.previewMode === true;
            this.unlocked = !this.mode || data.unlocked === true;
        } catch {
            this.mode = false;
            this.unlocked = true;
        }
        this.applyUi();
        return this;
    },
    privateAllowed(showDialog = true) {
        if (!this.mode || this.unlocked) return true;
        if (showDialog) this.openUnlockDialog();
        return false;
    },
    applyUi() {
        document.body.classList.toggle('preview-mode', this.mode);
        document.body.classList.toggle('preview-locked', this.mode && !this.unlocked);
        const banner = document.getElementById('preview-banner');
        if (banner) banner.hidden = !(this.mode && !this.unlocked);
        const status = document.getElementById('preview-status');
        if (status) status.textContent = !this.mode ? '普通本地模式' : this.unlocked ? '个人功能已解锁' : '只读预览模式：收藏、掌握、批注、AI 与同步需要解锁';
    },
    openUnlockDialog() {
        const dialog = document.getElementById('dlg-preview-access');
        if (!dialog) return;
        const feedback = document.getElementById('preview-access-feedback');
        if (feedback) feedback.textContent = '输入访问 Token 后即可使用收藏、错题、批注和同步。';
        if (!dialog.open) dialog.showModal();
        document.getElementById('preview-access-key')?.focus();
    },
    async unlock(event) {
        event?.preventDefault?.();
        const input = document.getElementById('preview-access-key');
        const feedback = document.getElementById('preview-access-feedback');
        const key = String(input?.value || '').trim();
        if (!key && feedback) { feedback.textContent = '请输入访问 Token。'; return; }
        if (feedback) feedback.textContent = '正在验证…';
        try {
            const response = await fetch('./api/access/unlock', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '预览密钥不正确');
            this.mode = data.previewMode === true;
            this.unlocked = true;
            if (input) input.value = '';
            document.getElementById('dlg-preview-access')?.close();
            this.applyUi();
            toast('个人功能已解锁');
            await StateSync.hydrate();
            if (AppState.currentView === 'settings') App.showSettings();
        } catch (error) {
            if (feedback) feedback.textContent = error.message || '验证失败，请重试。';
        }
    },
    async lock() {
        await fetch('./api/access/lock', { method: 'POST', credentials: 'include' }).catch(() => {});
        this.unlocked = false;
        this.applyUi();
        toast('已回到只读预览模式');
    }
};

// ========== 服务端状态同步（协议与旧版 app-legacy.js 完全一致） ==========
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
        if (!PreviewAccess.privateAllowed(false) || !hasPendingSync()) return false;
        if (!this.available) await this.hydrate();
        if (!this.available) { this.scheduleRetry(); return false; }
        return this.flushPending();
    },

    // 把待同步日志中的编辑逐题补写到服务端（只走逐题接口，绝不整份 PUT 覆盖服务端其它改动）
    async flushPending() {
        if (!PreviewAccess.privateAllowed(false)) return false;
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
        if (!PreviewAccess.privateAllowed(false)) { this.hydrated = true; return this; }
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
        if (this.eventSource || !window.EventSource || !PreviewAccess.privateAllowed(false)) return;
        const status = document.getElementById('local-service-status');
        let disconnected = false;
        this.eventSource = new EventSource('./api/state/events');
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
            if (AppState.currentView === 'question' && !AppState.annotationDirty) await UIRenderer.renderQuestion(AppState.currentQuestionIndex);
            else if (AppState.currentView === 'home') UIRenderer.renderHome();
            else if (AppState.currentView === 'records') UIRenderer.renderRecords();
            else if (AppState.currentView === 'notes' && !AppState.memoDirty) UIRenderer.renderNotes();
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
        const requeue = () => { for (const [id, patch] of entries) this.queue.set(id, patch); };
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
                            favorites: Array.isArray(conflict.current.favorites) ? conflict.current.favorites.map(String) : local.favorites,
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
            return true;
        } catch {
            requeue();
            return false;
        } finally {
            this.syncing = false;
            if (this.queue.size && !this.timer) this.timer = setTimeout(() => { this.flush(); }, 900);
        }
    },

    async flushAnnotation(questionId, markdown) {
        if (!this.available || !PreviewAccess.privateAllowed(false)) return;
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
        if (!this.available || !PreviewAccess.privateAllowed(false)) return false;
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
            if (settled === 'timeout' && this.available && PreviewAccess.privateAllowed(false)) {
                throw new Error('最近学习位置仍在保存，请稍后重试');
            }
        }
        // 学习位置写入未成功：切换前重试一次，仍失败则阻断导航
        if (this.lastStudyPending && this.available && PreviewAccess.privateAllowed(false)) {
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

// 把旧版/服务端的 last_study（category_id 可为任意层级 + 真实题号）解析为 {top, leaf}：
// 优先找包含该题号的叶子章节；题目不存在时退回 categoryId 节点（或其子树第一个叶子）。
function resolveChapterForQuestion(categoryId, questionId) {
    if (!AppState.categories) return null;
    let found = null;
    const matchLeaf = node => {
        if (node.questions?.length) {
            if (questionId == null || node.questions.some(q => String(q.id) === String(questionId))) return node;
        }
        for (const child of node.children || []) {
            const leaf = matchLeaf(child);
            if (leaf) return leaf;
        }
        return null;
    };
    const walk = node => {
        if (found) return;
        if (categoryId != null && Number(node.id) === Number(categoryId)) {
            const leaf = matchLeaf(node);
            if (leaf) { found = { top: node, leaf }; return; }
        }
        for (const child of node.children || []) walk(child);
    };
    for (const top of AppState.categories.categories || []) {
        if (found) break;
        if (categoryId != null && Number(top.id) === Number(categoryId)) {
            const leaf = matchLeaf(top);
            if (leaf) { found = { top, leaf }; break; }
        }
        walk(top);
        if (!found) {
            // category_id 不在顶层链上时，也允许题号命中的任意叶子归属当前顶层
            const leaf = questionId == null ? null : matchLeaf(top);
            if (leaf && leaf.questions?.some(q => String(q.id) === String(questionId))) found = { top, leaf };
        }
    }
    return found;
}

function toast(message, kind = '') {
    let el = document.getElementById('daguan-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'daguan-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.className = `daguan-toast ${kind}`.trim();
    el.dataset.visible = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.dataset.visible = ''; }, 3200);
}

// ========== 渲染工具（移植自 app2.js 生产逻辑） ==========
function assetUrl(src) {
    const m = String(src).match(/(?:^|\/)assets\/([0-9a-fA-F]{64})$/);
    if (m) return `./data/assets/${m[1]}.png`;
    if (src.startsWith("assets/")) {
        return `./data/assets/${src.slice("assets/".length).replace(/\.png$/i, "")}.png`;
    }
    return src;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    const raw = text || "";
    const slots = [];
    const protect = (s) => {
        s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
            const i = slots.length;
            slots.push({ display: true, tex: m });
            return `%%MATH${i}%%`;
        });
        s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
            const i = slots.length;
            slots.push({ display: true, tex: m });
            return `%%MATH${i}%%`;
        });
        s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => {
            const i = slots.length;
            slots.push({ display: false, tex: m });
            return `%%MATH${i}%%`;
        });
        s = s.replace(/\$([^\$\n]+?)\$/g, (full, m, offset, whole) => {
            if (whole[offset - 1] === "$" || whole[offset + full.length] === "$") return full;
            const i = slots.length;
            slots.push({ display: false, tex: m });
            return `%%MATH${i}%%`;
        });
        return s;
    };

    let html;
    try {
        const src = protect(raw);
        html = typeof marked !== "undefined"
            ? marked.parse(src, { breaks: true })
            : src.replace(/</g, "&lt;").replace(/\n/g, "<br>");
        html = html.replace(/%%MATH(\d+)%%/g, (_, idx) => {
            const item = slots[Number(idx)];
            if (!item || typeof katex === "undefined") {
                return item ? (item.display ? `$$${item.tex}$$` : `$${item.tex}$`) : "";
            }
            try {
                return katex.renderToString(item.tex, {
                    displayMode: item.display,
                    throwOnError: false,
                    strict: "ignore",
                });
            } catch {
                return item.display ? `$$${item.tex}$$` : `$${item.tex}$`;
            }
        });
    } catch {
        html = raw.replace(/</g, "&lt;").replace(/\n/g, "<br>");
    }

    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("img").forEach((img) => {
        img.src = assetUrl(img.getAttribute("src") || "");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = img.alt || "题目配图";
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.title = '点击放大图片';
        img.addEventListener("error", () => {
            if (img.dataset.fallback) return;
            img.dataset.fallback = "1";
            img.src = "./assets/missing-image.svg";
        }, { once: true });
    });
    return div.innerHTML;
}

function renderSafeSearchMarkdown(text) {
    const safeText = String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const math = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;
    return renderMarkdown(safeText.split(math).map((part, index) => index % 2 ? part : escapeHtml(part)).join(''));
}

function renderSearchResultStem(text) {
    const source = String(text || '');
    const hasMath = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/.test(source);
    return `<span class="search-result-stem${hasMath ? ' has-math' : ''}">${renderSafeSearchMarkdown(source)}</span>`;
}

// ========== UI 渲染器 ==========
class UIRenderer {
    static renderHome() {
        const main = document.getElementById('app-main');
        const progress = StorageService.getProgress();
        const position = StorageService.getLearningPosition();

        let continueSection = '';
        if (position) {
            const category = this.findCategoryById(position.categoryId);
            const chapter = category ? this.findChapterById(category, position.chapterId) : null;

            if (chapter) {
                continueSection = `
                    <div class="continue-section">
                        ${this.renderBrandGeometry()}
                        <div class="continue-label">继续学习</div>
                        <h2 class="continue-title">${chapter.name || chapter.title || '未命名章节'}</h2>
                        <p class="continue-meta">${Number.isInteger(position.questionIndex) ? `上次学习：第 ${position.questionIndex + 1} 题` : position.questionId ? `上次学习：题号 ${position.questionId}` : '上次学习位置已就绪'}</p>
                        <button class="btn btn-continue" onclick="App.resumeLearning()">
                            继续做题
                        </button>
                    </div>
                `;
            }
        }

        // 无学习历史（或记录的章节已不存在）时，橙色主区显示选择章节引导（规格 §3 首次使用）
        if (!continueSection) {
            continueSection = `
                <div class="continue-section">
                    ${this.renderBrandGeometry()}
                    <div class="continue-label">学习</div>
                    <h2 class="continue-title">选择一章，开始学习</h2>
                    <p class="continue-meta">从题库挑一个小节，第一道题就在下面。</p>
                    <button class="btn btn-continue" onclick="App.navigate('library')">
                        浏览题库
                    </button>
                </div>
            `;
        }

        main.innerHTML = `
            <div class="home-content">
                <div class="home-grid">
                    ${continueSection}
                    <div class="review-section">
                        ${StorageService.favoriteCount() || StorageService.mistakeCount() ? `
                            <div class="review-card">
                                <h3 class="review-title">待回看的题</h3>
                                <a href="#" class="review-row" onclick="App.showReview('favorites'); return false;">
                                    <span>收藏</span><strong>${StorageService.favoriteCount()}</strong>
                                </a>
                                <a href="#" class="review-row" onclick="App.showReview('mistakes'); return false;">
                                    <span>易错</span><strong>${StorageService.mistakeCount()}</strong>
                                </a>
                                <p class="review-note">从做过的题里，继续查漏补缺。</p>
                            </div>
                        ` : `
                            <div class="review-card review-empty">
                                <span class="review-empty-mark" aria-hidden="true">∴</span>
                                <h3 class="review-title">复习从第一道题开始</h3>
                                <p>做题时可以收藏或标记易错，之后从这里集中回看。</p>
                                <a href="#" class="review-link" onclick="App.navigate('library'); return false;">选择章节</a>
                            </div>
                        `}
                    </div>
                </div>

                <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">科目浏览</h2>
                <div class="subject-grid">
                    ${this.renderSubjectCards()}
                </div>
            </div>
        `;
    }

    static renderBrandGeometry() {
        return `<svg class="brand-decoration" viewBox="0 0 240 220" aria-hidden="true" focusable="false">
            <path d="M70 31H42v158h28M170 31h28v158h-28" />
            <path d="M68 147l37-36 29 20 43-55" />
            <circle cx="68" cy="147" r="5"/><circle cx="105" cy="111" r="5"/>
            <circle cx="134" cy="131" r="5"/><circle cx="177" cy="76" r="5"/>
        </svg>`;
    }

    static renderSubjectCards() {
        if (!AppState.categories) return '';

        return AppState.categories.categories.map((cat, index) => `
            <a href="#" class="subject-card" onclick="App.showLibrary('${cat.id}'); return false;">
                <span class="subject-icon" aria-hidden="true">${['∫', '[ ]', 'P', '∑', 'π', '⋯'][index] || '∴'}</span>
                <span class="subject-info"><span class="subject-name">${cat.name}</span><span class="subject-count">${this.countQuestions(cat)} 道题</span></span>
            </a>
        `).join('');
    }

    static countQuestions(category) {
        if (category.question_count != null) return category.question_count;
        let count = 0;
        const traverse = (node) => {
            if (node.questions) count += node.questions.length;
            if (node.children) node.children.forEach(traverse);
        };
        traverse(category);
        return count;
    }

    static findCategoryById(id) {
        if (!AppState.categories) return null;
        // 内联 onclick 传字符串 id，统一 Number 宽松比较
        return AppState.categories.categories.find(c => String(c.id) === String(id) || Number(c.id) === Number(id));
    }

    static findChapterById(category, chapterId) {
        const traverse = (node) => {
            if (Number(node.id) === Number(chapterId)) return node;
            if (node.children) {
                for (const child of node.children) {
                    const found = traverse(child);
                    if (found) return found;
                }
            }
            return null;
        };
        return traverse(category);
    }

    static pathToNode(category, targetId) {
        const visit = (node, path) => {
            const next = [...path, node];
            if (String(node.id) === String(targetId)) return next;
            for (const child of node.children || []) {
                const found = visit(child, next);
                if (found) return found;
            }
            return null;
        };
        return visit(category, []);
    }

    static renderLibrary(categoryId) {
        const category = this.findCategoryById(categoryId);
        if (!category) return;
        const saved = this.readDirectoryState().subjects[String(category.id)] || {};
        if (this.findNodeById(category, saved.nodeId)) AppState.directoryNodeId = String(saved.nodeId);
        else if (!AppState.directoryNodeId || !this.findNodeById(category, AppState.directoryNodeId)) AppState.directoryNodeId = String(category.id);
        AppState.libraryScrollTop = Number(saved.scrollTop) || 0;
        AppState.libraryQuery = String(saved.query || '');
        AppState.libraryResultLimit = Number(saved.resultLimit) || 40;
        AppState.filters = saved.filters && typeof saved.filters === 'object' ? saved.filters : { sources: [], years: [], types: [], lecturers: [] };
        const active = this.findNodeById(category, AppState.directoryNodeId) || category;
        if (AppState.catalogExpandedId == null) {
            const activePath = this.pathToNode(category, active.id) || [category];
            AppState.catalogExpandedId = String(activePath[0].id);
        }

        const main = document.getElementById('app-main');
        main.innerHTML = `
            <div class="library-layout">
                <div class="library-sidebar" id="library-sidebar">
                    <div class="library-sidebar-header">
                        <div class="library-sidebar-titles"><h2>章节目录</h2><p>选择科目和一级章节</p></div>
                        <button type="button" class="btn btn-icon btn-text library-toc-close" onclick="App.toggleLibraryToc()" aria-label="关闭目录">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <div class="catalog-scopes" role="group" aria-label="题库范围">${this.scopeButtons()}</div>
                    <div class="library-tree" id="library-tree"></div>
                </div>
                <div class="library-main">
                    <div class="library-header">
                        <nav class="library-breadcrumb" id="library-breadcrumb" aria-label="当前位置"></nav>
                        <div class="library-title-row"><button type="button" class="btn btn-text library-up" id="library-up" onclick="App.directoryUp()">← 返回上级</button><h1 id="library-node-title">${escapeHtml(active.name || active.title || category.name)}</h1></div>
                        <div class="library-toolbar">
                            <button type="button" class="btn btn-secondary library-toc-trigger" onclick="App.toggleLibraryToc()">
                                <svg class="icon nav-icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                                目录
                            </button>
                            <button type="button" class="btn btn-secondary chapter-picker-trigger" data-open-chapter-picker>选择小节</button>
                            <div class="search-box">
                                <input type="search" class="search-input"
                                    placeholder="搜索题目..."
                                    id="search-input"
                                    oninput="App.handleSearch(this.value)">
                            </div>
                            <button class="btn btn-secondary" onclick="App.toggleFilterDrawer()">
                                <svg class="icon nav-icon" viewBox="0 0 24 24">
                                    <path d="M3 6h18M7 12h10M11 18h2"/>
                                </svg>
                                筛选
                            </button>
                        </div>
                    </div>
                    <div class="library-content" id="library-content"></div>
                </div>
            </div>

            <div class="filter-overlay" id="filter-overlay" onclick="App.toggleFilterDrawer()"></div>
            <div class="nav-overlay" id="library-toc-overlay" onclick="App.toggleLibraryToc()"></div>
            <div class="filter-drawer" id="filter-drawer">
                <div class="filter-header">
                    <h2>筛选条件</h2>
                    <button class="btn btn-icon btn-text" onclick="App.toggleFilterDrawer()">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="filter-content" id="filter-content"></div>
                <div class="filter-footer">
                    <button class="btn btn-secondary" onclick="App.resetFilters()">重置</button>
                    <button class="btn btn-primary" onclick="App.applyFilters()">应用</button>
                </div>
            </div>
        `;

        this.renderLibraryTree(category);
        this.bindChapterPickerTriggers();
        this.bindScopeButtons();
        this.renderFilterOptions();
        document.getElementById('search-input').value = AppState.libraryQuery;
        this.renderDirectoryNode(active);
        const filtering = AppState.libraryQuery.trim() || Object.values(AppState.filters || {}).some(values => Array.isArray(values) && values.length);
        if (filtering) this.renderLibraryResults();
        if (AppState.libraryScrollTop) document.getElementById('library-content').scrollTop = AppState.libraryScrollTop;
        this.saveDirectoryState();
        this.applySavedAppearance();
    }

    static applySavedAppearance() { applyAppearanceValues(StorageService.getUIAppearance()); }

    static readDirectoryState() {
        try {
            const saved = JSON.parse(localStorage.getItem('daguan_new_directory_paths_v1') || '{}');
            if (saved && saved.version === 1 && saved.subjects && typeof saved.subjects === 'object') return saved;
        } catch {}
        try {
            const previous = JSON.parse(localStorage.getItem('daguan_new_directory_path_v1') || '{}');
            if (previous && previous.categoryId != null) return { version: 1, lastCategory: String(previous.categoryId), subjects: { [String(previous.categoryId)]: { nodeId: String(previous.nodeId), scrollTop: Number(previous.scrollTop) || 0, query: '', filters: null, resultLimit: 40 } } };
        } catch {}
        return { version: 1, lastCategory: null, subjects: {} };
    }

    static saveDirectoryState() {
        const content = document.getElementById('library-content');
        if (content) AppState.libraryScrollTop = content.scrollTop;
        const categoryId = AppState.currentCategory?.id;
        if (categoryId == null) return;
        try {
            const saved = this.readDirectoryState();
            saved.lastCategory = String(categoryId);
            saved.subjects[String(categoryId)] = {
                nodeId: String(AppState.directoryNodeId || categoryId),
                scrollTop: Number(AppState.libraryScrollTop) || 0,
                query: String(AppState.libraryQuery || ''),
                filters: JSON.parse(JSON.stringify(AppState.filters || { sources: [], years: [], types: [], lecturers: [] })),
                resultLimit: Number(AppState.libraryResultLimit) || 40,
            };
            localStorage.setItem('daguan_new_directory_paths_v1', JSON.stringify(saved));
        } catch {}
    }

    static renderThemeSettings() {
        const saved = StorageService.getUIAppearance();
        AppState.appearanceDraft = { ...saved };
        return `<section class="card appearance-settings" aria-labelledby="appearance-title"><h2 id="appearance-title" class="text-section-title">新版外观</h2><p class="text-helper">只影响新版页面，旧版外观设置保持独立。</p>
            <div class="theme-presets">${UI_THEMES.map(theme => `<button type="button" class="theme-preset" data-theme-preset="${theme.id}" aria-pressed="${saved.theme === theme.id}"><span class="theme-swatch" style="--swatch-brand:${theme.brand};--swatch-app:${theme.app};--swatch-reading:${theme.reading}"></span><span>${theme.name}</span></button>`).join('')}</div>
            <div class="custom-colors"><h3>自定义品牌色</h3>${[['brand','品牌色'],['app','应用底色'],['reading','阅读面'],['accent','次强调色']].map(([key,label]) => `<label>${label}<input type="color" data-appearance-color="${key}" value="${saved[key] || UI_THEMES[0][key]}"></label>`).join('')}</div>
            <div class="appearance-preview" id="appearance-preview"><strong>实时预览</strong><p>正文与按钮文字会按背景自动选择对比色。</p><button type="button" class="btn btn-primary">品牌按钮预览</button></div>
            <div class="appearance-actions"><button type="button" class="btn btn-primary" id="appearance-apply">应用</button><button type="button" class="btn btn-secondary" id="appearance-cancel">取消</button><button type="button" class="btn btn-text" id="appearance-reset">恢复预设</button></div>
        </section>`;
    }

    static bindThemeSettings() {
        const preview = () => applyAppearanceValues(AppState.appearanceDraft);
        document.querySelectorAll('[data-theme-preset]').forEach(button => button.addEventListener('click', () => {
            const preset = UI_THEMES.find(item => item.id === button.dataset.themePreset);
            if (!preset) return;
            AppState.appearanceDraft = { ...AppState.appearanceDraft, ...preset, theme: preset.id };
            document.querySelectorAll('[data-appearance-color]').forEach(input => { input.value = preset[input.dataset.appearanceColor]; });
            document.querySelectorAll('[data-theme-preset]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
            preview();
        }));
        document.querySelectorAll('[data-appearance-color]').forEach(input => input.addEventListener('input', () => {
            AppState.appearanceDraft[input.dataset.appearanceColor] = input.value;
            AppState.appearanceDraft.theme = 'custom';
            document.querySelectorAll('[data-theme-preset]').forEach(item => item.setAttribute('aria-pressed', 'false'));
            preview();
        }));
        document.getElementById('appearance-apply')?.addEventListener('click', () => {
            StorageService.saveUIAppearance(AppState.appearanceDraft);
            toast('新版外观已应用');
        });
        document.getElementById('appearance-cancel')?.addEventListener('click', () => {
            AppState.appearanceDraft = StorageService.getUIAppearance();
            applyAppearanceValues(AppState.appearanceDraft);
            App.showSettings();
        });
        document.getElementById('appearance-reset')?.addEventListener('click', () => {
            const base = UI_THEMES.find(item => item.id === AppState.appearanceDraft.theme) || UI_THEMES[0];
            AppState.appearanceDraft = { ...base, theme: base.id };
            document.querySelectorAll('[data-appearance-color]').forEach(input => { input.value = base[input.dataset.appearanceColor]; });
            document.querySelectorAll('[data-theme-preset]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.themePreset === base.id)));
            preview();
        });
    }

    static renderLibraryTree(category, parentEl = null) {
        const treeEl = parentEl || document.getElementById('library-tree');
        if (!treeEl) return;
        treeEl.innerHTML = '';
        const selectedPath = this.pathToNode(category, AppState.directoryNodeId) || [category];
        const expandedId = AppState.catalogExpandedId == null ? String(selectedPath[0]?.id ?? category?.id) : String(AppState.catalogExpandedId);
        (AppState.categories?.categories || []).forEach(subject => {
            const wrap = document.createElement('div');
            wrap.className = 'catalog-subject';
            const expanded = String(subject.id) === expandedId;
            const root = document.createElement('button');
            root.type = 'button';
            root.className = `tree-item catalog-subject-row${expanded ? ' active' : ''}`;
            root.setAttribute('aria-expanded', String(expanded));
            root.innerHTML = `<span class="catalog-chevron" aria-hidden="true">${expanded ? '⌄' : '›'}</span><span class="catalog-subject-name">${escapeHtml(subject.name || subject.title || '')}</span><span class="tree-count">${Number(subject.question_count || 0)}</span>`;
            root.addEventListener('click', () => expanded ? App.toggleCatalogSubject(subject.id) : App.showLibrary(subject.id));
            wrap.appendChild(root);
            if (expanded) {
                const children = document.createElement('div');
                children.className = 'catalog-first-level';
                (subject.children || []).forEach(child => {
                    const branch = (child.children || []).length > 0;
                    const row = document.createElement('button');
                    row.type = 'button';
                    const selectedFirstLevel = String(child.id) === String(selectedPath[1]?.id);
                    row.className = `tree-item catalog-first-row${selectedFirstLevel ? ' active' : ''}`;
                    row.setAttribute('aria-current', selectedFirstLevel ? 'page' : 'false');
                    row.setAttribute('aria-expanded', String(branch && selectedFirstLevel));
                    row.innerHTML = `<span class="catalog-chevron" aria-hidden="true">${branch ? (selectedFirstLevel ? '⌄' : '›') : ''}</span><span class="catalog-subject-name">${escapeHtml(child.name || child.title || '')}</span><span class="tree-count">${Number(child.question_count || 0)}</span>`;
                    row.addEventListener('click', () => App.selectFirstLevel(subject, child));
                    children.appendChild(row);
                });
                wrap.appendChild(children);
            }
            treeEl.appendChild(wrap);
        });
    }

    static renderDirectoryNode(node) {
        if (!node) return;
        const contentEl = document.getElementById('library-content');
        if (!contentEl) return;
        const category = AppState.currentCategory;
        const path = this.pathToNode(category, node.id) || [category, node];
        const crumbs = path.map((part, index) => `<button type="button" class="breadcrumb-part" data-node-id="${escapeHtml(String(part.id))}" aria-current="${index === path.length - 1 ? 'page' : 'false'}">${escapeHtml(part.name || part.title || '')}</button>`);
        const compact = crumbs.length > 5 ? [crumbs[0], `<details class="breadcrumb-more"><summary>…</summary><div>${crumbs.slice(1, -2).join('')}</div></details>`, ...crumbs.slice(-2)] : crumbs;
        document.getElementById('library-breadcrumb').innerHTML = compact.join('<span aria-hidden="true">›</span>');
        document.querySelectorAll('.breadcrumb-part').forEach(button => button.addEventListener('click', () => App.openDirectoryNode(button.dataset.nodeId)));
        document.getElementById('library-node-title').textContent = node.name || node.title || '';
        const up = document.getElementById('library-up');
        up.hidden = path.length < 2;
        this.renderLibraryTree(category);
        const children = node.children || [];
        const direct = node.direct_questions || node.questions || [];
        const position = StorageService.getLearningPosition();
        const positionIndex = position && String(position.categoryId) === String(category.id) && String(position.chapterId) === String(node.id)
            ? Math.max(0, Number(position.questionIndex) || 0) : -1;
        const isLeaf = children.length === 0;
        const total = Number(node.question_count ?? direct.length);
        const locationText = positionIndex >= 0 ? `已到第 ${positionIndex + 1} 题 · 题号 ${escapeHtml(String(position.questionId || direct[positionIndex]?.id || ''))}` : '本机还没有此章节的学习位置';
        const totalLabel = `${total} 道题 · 题数为全范围总数${direct.length && children.length ? ` · 本级直属 ${direct.length} 道` : ''} · ${locationText}`;
        contentEl.innerHTML = `<section class="directory-overview"><div><p class="eyebrow">章节概览</p><h2>${escapeHtml(node.name || node.title || '')}</h2><p>${totalLabel}</p></div><div class="directory-actions">${children.length ? '<button type="button" class="btn btn-primary" id="choose-directory">选择小节</button>' : direct.length ? `<button type="button" class="btn btn-primary" id="start-directory">开始练习（${direct.length} 题）</button>` : ''}${positionIndex >= 0 && !children.length ? '<button type="button" class="btn btn-secondary" id="continue-directory">继续</button>' : ''}${direct.length && children.length ? `<button type="button" class="btn btn-secondary" id="start-direct-directory">本级直属题 ${direct.length} 题</button>` : ''}</div></section>
            ${isLeaf && total === 0 ? `<div class="empty-state"><h3>此章节暂无题目</h3><p>该空节点可从目录定位，但没有可开始的题目。</p></div>` : ''}`;
        document.getElementById('choose-directory')?.addEventListener('click', () => App.openChapterPicker(category.id, node.id));
        document.getElementById('start-directory')?.addEventListener('click', () => App.showChapter(node));
        document.getElementById('start-direct-directory')?.addEventListener('click', () => App.showChapter(node, { directOnly: true }));
        document.getElementById('continue-directory')?.addEventListener('click', () => App.continueDirectoryNode(node));
        contentEl.onscroll = () => this.saveDirectoryState();
    }

    static renderChapterList(category) { this.renderDirectoryNode(category); }

    static scopeButtons() {
        return [['all', '完整'], ['core', '严选'], ['real', '真题']].map(([key, label]) => `<button type="button" class="catalog-scope${AppState.chapterScope === key ? ' active' : ''}" data-chapter-scope="${key}" aria-pressed="${AppState.chapterScope === key}">${label}</button>`).join('');
    }

    static bindScopeButtons() {
        document.querySelectorAll('[data-chapter-scope]').forEach(button => button.addEventListener('click', () => App.changeChapterScope(button.dataset.chapterScope)));
    }

    static bindChapterPickerTriggers() {
        document.querySelectorAll('[data-open-chapter-picker]').forEach(button => button.addEventListener('click', () => App.openChapterPicker()));
    }

    static chapterScopeMatch(question) {
        if (AppState.chapterScope === 'core' && !question?.is_core) return false;
        if (AppState.chapterScope === 'real') {
            const source = `${question?.source || ''} ${question?.year || ''} ${question?.category || ''}`;
            if (!/(真题|历年|模拟卷|数一|数二|数三)/.test(source)) return false;
        }
        const filters = AppState.filters || {};
        if (filters.sources?.length && !filters.sources.includes(sourceGroup(question?.source))) return false;
        if (filters.years?.length && !filters.years.includes(sourceYear(question?.source))) return false;
        if (filters.types?.length && !filters.types.includes(question?.type)) return false;
        if (filters.lecturers?.length) {
            const videos = AppState.videoMappings?.questions?.[String(question.id)] || [];
            const paradiyu = !!AppState.paradiyuVideoMapping?.questions?.[String(question.id)];
            if (!videos.some(video => filters.lecturers.includes(video.teacher)) && !(paradiyu && filters.lecturers.includes('帕拉迪宇'))) return false;
        }
        const query = String(AppState.libraryQuery || '').trim().toLocaleLowerCase();
        if (query) {
            const row = (AppState.searchIndex || []).find(item => String(item.id) === String(question.id));
            if (!`${question.id} ${question.stem || question.question || ''} ${question.source || ''} ${row?.path || ''}`.toLocaleLowerCase().includes(query)) return false;
        }
        return true;
    }

    static async filteredChapter(chapter, directOnly = false) {
        const entries = directOnly ? (chapter.direct_questions || []) : (chapter.direct_questions || chapter.questions || []);
        const shell = { ...chapter, direct_questions: entries, children: [] };
        const hasDetails = Object.values(AppState.filters || {}).some(values => Array.isArray(values) && values.length > 0);
        const hasQuery = String(AppState.libraryQuery || '').trim().length > 0;
        if (AppState.chapterScope === 'all' && !hasDetails && !hasQuery) return shell;
        const loaded = await DataService.loadQuestionsForChapter(shell);
        const acceptedIds = new Set(loaded.filter(question => this.chapterScopeMatch(question)).map(question => String(question.id)));
        return { ...shell, direct_questions: entries.filter(entry => acceptedIds.has(String(entry.id))) };
    }

    static renderChapterPicker() {
        const host = document.getElementById('chapter-picker');
        if (!host) return;
        const roots = AppState.categories?.categories || [];
        let nodes = roots;
        let path = [];
        const selectedIds = AppState.chapterPickerPath || [];
        const columns = [];
        for (let depth = 0; depth <= selectedIds.length; depth += 1) {
            const selectedId = selectedIds[depth];
            columns.push(`<div class="chapter-picker-column" role="listbox" aria-label="${depth ? escapeHtml(path.at(-1)?.name || '章节') + '下级' : '科目'}">${nodes.map(node => {
                const selected = String(node.id) === String(selectedId);
                const children = node.children || [];
                const hasBranch = children.length > 0;
                const count = Number(node.question_count || 0);
                return `<button type="button" class="chapter-picker-item${selected ? ' active' : ''}${hasBranch ? ' has-children' : ''}" role="option" aria-selected="${selected}" aria-expanded="${hasBranch ? selected : 'false'}" data-picker-id="${escapeHtml(String(node.id))}" data-picker-depth="${depth}"><span>${escapeHtml(node.name || node.title || '')}</span><small>${count} 题</small>${hasBranch ? '<span aria-hidden="true">›</span>' : ''}</button>`;
            }).join('')}${path.at(-1)?.direct_questions?.length ? `<button type="button" class="chapter-picker-item direct-picker-item" data-picker-direct="${escapeHtml(String(path.at(-1).id))}" data-picker-depth="${depth}"><span>本级直属题</span><small>${path.at(-1).direct_questions.length} 题</small></button>` : ''}</div>`);
            const selectedNode = nodes.find(node => String(node.id) === String(selectedId));
            if (!selectedNode || !selectedNode.children?.length) break;
            path.push(selectedNode);
            nodes = selectedNode.children;
        }
        const pathNodes = [];
        let cursor = roots;
        for (const id of selectedIds) {
            const node = cursor.find(item => String(item.id) === String(id));
            if (!node) break;
            pathNodes.push(node);
            cursor = node.children || [];
        }
        const backDisabled = selectedIds.length ? '' : 'disabled aria-disabled="true"';
        host.innerHTML = `<div class="chapter-picker-backdrop" data-picker-close></div><section class="chapter-picker-dialog" role="dialog" aria-modal="true" aria-label="选择小节"><header><div><p>章节导航</p><h2>${escapeHtml(pathNodes.at(-1)?.name || '选择小节')}</h2></div><button type="button" class="btn btn-text" data-picker-close aria-label="关闭章节导航">关闭</button></header><div class="chapter-picker-controls">${this.scopeButtons()}</div><nav class="chapter-picker-path" aria-label="当前目录路径"><button type="button" data-picker-path="0">科目</button>${pathNodes.map((node, index) => `<span aria-hidden="true">›</span><button type="button" data-picker-path="${index + 1}" aria-current="${index === pathNodes.length - 1 ? 'page' : 'false'}">${escapeHtml(node.name || node.title || '')}</button>`).join('')}</nav><div class="chapter-picker-columns">${columns.join('')}</div><footer><button type="button" class="btn btn-secondary" data-picker-back ${backDisabled}>上一级</button><p class="chapter-picker-feedback" role="status" aria-live="polite">目录题数为总数；进入章节后显示筛选结果。</p></footer></section>`;
        host.querySelectorAll('[data-picker-id]').forEach(button => button.addEventListener('click', () => App.selectPickerNode(button.dataset.pickerId, Number(button.dataset.pickerDepth))));
        host.querySelectorAll('[data-picker-direct]').forEach(button => button.addEventListener('click', () => App.startDirectFromPicker(button.dataset.pickerDirect)));
        host.querySelectorAll('[data-picker-path]').forEach(button => button.addEventListener('click', () => { AppState.chapterPickerPath = AppState.chapterPickerPath.slice(0, Number(button.dataset.pickerPath)); this.renderChapterPicker(); }));
        host.querySelector('[data-picker-back]')?.addEventListener('click', () => { AppState.chapterPickerPath = AppState.chapterPickerPath.slice(0, -1); this.renderChapterPicker(); });
        host.querySelectorAll('[data-picker-close]').forEach(button => button.addEventListener('click', () => App.closeChapterPicker()));
        host.querySelectorAll('[data-chapter-scope]').forEach(button => button.addEventListener('click', () => App.changeChapterScope(button.dataset.chapterScope)));
        host.onkeydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); App.closeChapterPicker(); return; }
            const current = event.target.closest('.chapter-picker-item');
            if (!current) return;
            const siblings = [...current.parentElement.querySelectorAll('.chapter-picker-item')];
            const index = siblings.indexOf(current);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : siblings.length - 1;
                siblings[Math.max(0, Math.min(siblings.length - 1, next))]?.focus();
            } else if ((event.key === 'ArrowRight' || event.key === 'Enter') && current.classList.contains('has-children')) {
                event.preventDefault(); current.click();
                requestAnimationFrame(() => host.querySelector('.chapter-picker-column:last-child .chapter-picker-item')?.focus());
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault(); host.querySelector('[data-picker-back]')?.click();
                requestAnimationFrame(() => host.querySelector('.chapter-picker-column:last-child .chapter-picker-item.active')?.focus());
            } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); current.click(); }
        };
        requestAnimationFrame(() => host.querySelector('.chapter-picker-column:last-child .chapter-picker-item.active, .chapter-picker-column:last-child .chapter-picker-item')?.focus());
    }

    static findNodeById(node, targetId) {
        if (String(node.id) === String(targetId) || Number(node.id) === Number(targetId)) return node;
        if (node.children) {
            for (const child of node.children) {
                const found = this.findNodeById(child, targetId);
                if (found) return found;
            }
        }
        return null;
    }

    static collectChapters(node) {
        const chapters = [];
        const traverse = (n) => {
            if (n.questions && n.questions.length > 0) {
                chapters.push(n);
            }
            if (n.children) {
                n.children.forEach(traverse);
            }
        };
        traverse(node);
        return chapters;
    }

    static libraryRows() {
        const ids = new Set((AppState.currentCategory?.questions || []).map(item => String(item.id)));
        return (AppState.searchIndex || []).filter(row => ids.has(String(row.id)));
    }

    static renderLibraryResults() {
        const category = AppState.currentCategory;
        const content = document.getElementById('library-content');
        if (!category || !content) return;
        const query = App.normalizeSearchText(AppState.libraryQuery.trim());
        const filters = AppState.filters;
        const filtering = query || Object.values(filters).some(values => values.length);
        if (!filtering) { this.renderDirectoryNode(this.findNodeById(category, AppState.directoryNodeId) || category); return; }

        const mapping = AppState.videoMappings?.questions || {};
        const matches = this.libraryRows().filter(row => {
            if (query && !App.normalizeSearchText(`${row.id} ${row.stem || ''} ${row.source || ''} ${row.path || ''}`).includes(query)) return false;
            if (filters.sources.length && !filters.sources.includes(sourceGroup(row.source))) return false;
            if (filters.years.length && !filters.years.includes(sourceYear(row.source))) return false;
            if (filters.types.length && !filters.types.includes(row.type)) return false;
            if (filters.lecturers.length) {
                const videos = mapping[String(row.id)] || [];
                const paradiyu = !!AppState.paradiyuVideoMapping?.questions?.[String(row.id)];
                if (!videos.some(video => filters.lecturers.includes(video.teacher))
                    && !(paradiyu && filters.lecturers.includes('帕拉迪宇'))) return false;
            }
            return true;
        });

        if (!matches.length) {
            content.innerHTML = `<div class="empty-state"><div class="empty-state-icon" aria-hidden="true">∅</div><h3>没有符合条件的题目</h3><p>换一个关键词，或清除筛选后再试。</p><button type="button" class="btn btn-secondary" onclick="App.clearLibrarySearch()">清除条件</button></div>`;
            return;
        }
        content.innerHTML = `
            <div class="search-result-summary">找到 ${matches.length} 道题${matches.length > AppState.libraryResultLimit ? `，已显示 ${AppState.libraryResultLimit} 道` : ''}</div>
            <div class="search-result-list">
                ${matches.slice(0, AppState.libraryResultLimit).map(row => `
                    <div class="search-result" role="button" tabindex="0" data-question-id="${row.id}">
                        <span class="search-result-meta">${escapeHtml(row.source || '未标注来源')} · ${questionTypeLabel(row.type)} · 题号 ${row.id}</span>
                        ${renderSearchResultStem(row.stem || '')}
                    </div>
                `).join('')}
            </div>
            ${matches.length > AppState.libraryResultLimit ? '<button type="button" class="btn btn-secondary search-more" onclick="App.showMoreLibraryResults()">加载更多题目</button>' : ''}`;
        content.querySelectorAll('.search-result').forEach(button => {
            button.addEventListener('click', () => App.openLibraryQuestion(button.dataset.questionId));
            button.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                App.openLibraryQuestion(button.dataset.questionId);
            });
        });
    }

    static renderFilterOptions() {
        const filterContent = document.getElementById('filter-content');
        if (!filterContent) return;

        const rows = this.libraryRows();
        const counts = new Map();
        for (const row of rows) {
            const group = sourceGroup(row.source);
            counts.set(group, (counts.get(group) || 0) + 1);
        }
        const groups = [...counts].sort((a, b) => b[1] - a[1]);
        const years = [...new Set(rows.map(row => sourceYear(row.source)).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
        const types = [...new Set(rows.map(row => row.type).filter(Boolean))];
        const checkbox = (value, label, selected) => `<label class="filter-checkbox"><input type="checkbox" value="${escapeHtml(value)}" ${selected ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;

        filterContent.innerHTML = `
            <div class="filter-section">
                <h3>题目来源</h3>
                <div class="filter-options" id="filter-sources">${groups.map(([group, count]) => checkbox(group, `${group}（${count}）`, AppState.filters.sources.includes(group))).join('')}</div>
            </div>
            <div class="filter-section">
                <h3>年份</h3>
                <div class="filter-options filter-years" id="filter-years">${years.length ? years.map(year => checkbox(year, year, AppState.filters.years.includes(year))).join('') : '<p class="text-helper">此科目暂无年份信息</p>'}</div>
            </div>
            <div class="filter-section">
                <h3>题型</h3>
                <div class="filter-options" id="filter-types">${types.map(type => checkbox(type, questionTypeLabel(type), AppState.filters.types.includes(type))).join('')}</div>
            </div>
            <div class="filter-section">
                <h3>讲师</h3>
                <div class="filter-options" id="filter-lecturers">
                    ${['帕拉迪宇', '李艳芳', '没咋了'].map(name => checkbox(name, name, AppState.filters.lecturers.includes(name))).join('')}
                </div>
            </div>
        `;
    }

    static async renderQuestion(questionIndex = 0) {
        if (!AppState.questions || AppState.questions.length === 0) return;

        if (AppState.questionMode === 'multi' && AppState.currentCategory && AppState.currentChapter) {
            return this.renderMultiQuestions(questionIndex);
        }

        const question = AppState.questions[questionIndex];
        if (!question) return;

        AppState.currentQuestionIndex = questionIndex;

        const main = document.getElementById('app-main');
        const progress = StorageService.getProgress();
        const isFav = StorageService.isFavorite(question.id);
        const isMistake = StorageService.isMistake(question.id);
        const isMastered = StorageService.isMastered(question.id);
        const annotation = StorageService.getAnnotation(question.id);

        main.innerHTML = `
            <div class="question-layout">
                <div class="question-main">
                    <div class="question-header">
                        <div class="breadcrumb-nav">
                            <a href="#" onclick="App.showHome(); return false;">首页</a>
                            <span class="breadcrumb-sep">/</span>
                            <a href="#" onclick="App.showLibrary('${AppState.currentCategory?.id || ''}'); return false;">
                                ${AppState.currentCategory?.name || '题库'}
                            </a>
                            <span class="breadcrumb-sep">/</span>
                            <span>${AppState.currentChapter?.name || AppState.currentChapter?.title || '章节'}</span>
                        </div>
                        <div class="question-sequence">
                            第 ${questionIndex + 1} 题 / 共 ${AppState.chapterQuestionCount || AppState.questions.length} 题
                        </div>
                        ${AppState.globalSearchReturn ? '<button type="button" class="btn btn-secondary" onclick="App.returnToGlobalSearch()">返回搜索</button>' : ''}
                        ${AppState.currentCategory && AppState.currentChapter ? '<button type="button" class="btn btn-secondary chapter-picker-trigger" data-open-chapter-picker>选择小节</button>' : ''}
                    </div>

                    ${AppState.currentCategory && AppState.currentChapter ? `<div class="mode-toolbar"><span>单题阅读</span><div class="mode-toolbar-actions"><button type="button" class="mode-jump-button" data-shortcut-hint="jump" onclick="App.promptJumpToQuestion()">跳题</button><div class="mode-switch"><button type="button" class="active" aria-pressed="true">单题</button><button type="button" data-shortcut-hint="mode" onclick="App.changeQuestionMode('multi')">多题</button></div></div></div>` : ''}

                    <div class="question-content" id="question-content">
                        <div class="question-wrapper">
                            <div class="question-meta-row">
                                <div class="question-source">
                                    ${question.source || ''} ${question.year ? question.year + '年' : ''}
                                </div>
                                <div class="question-actions">
                                    <button class="action-btn ${isFav ? 'active' : ''}" data-shortcut-hint="favorite"
                                        onclick="App.toggleFavorite('${question.id}')">
                                        <svg class="icon" viewBox="0 0 24 24">
                                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                        </svg>
                                        收藏
                                    </button>
                                    <button class="action-btn ${annotation.content ? 'active' : ''}" data-shortcut-hint="note"
                                        onclick="App.toggleAnnotation()">
                                        <svg class="icon" viewBox="0 0 24 24">
                                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                                        </svg>
                                        批注
                                    </button>
                                    <button class="action-btn" data-shortcut-hint="ai" onclick="App.toggleAI()">
                                        <svg class="icon" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M12 16v-4M12 8h.01"/>
                                        </svg>
                                        AI辅助
                                    </button>
                                </div>
                            </div>

                            ${this.renderQuestionContent(question)}
                        </div>
                    </div>

                    <div class="question-footer">
                        <div class="footer-nav">
                            <button class="btn btn-secondary" data-shortcut-hint="up"
                                onclick="App.previousQuestion()"
                                ${questionIndex === 0 ? 'disabled' : ''}>
                                上一题
                            </button>
                            <button class="btn btn-secondary" id="show-answer-btn" data-shortcut-hint="answer"
                                onclick="App.toggleAnswer()">
                                显示答案
                            </button>
                            <button class="btn btn-secondary" data-shortcut-hint="down"
                                onclick="App.nextQuestion()"
                                ${questionIndex === AppState.questions.length - 1 ? 'disabled' : ''}>
                                下一题
                            </button>
                        </div>
                        <div class="footer-status">
                            <button class="mastery-btn mastery-status-button mastery-${progress.progress[String(question.id)]?.mastery || 'not_started'}" data-shortcut-hint="mastery"
                                onclick="App.cycleMastery('${question.id}')" aria-label="掌握状态：${masteryLabel(progress.progress[String(question.id)]?.mastery)}，点击切换">
                                ${masteryLabel(progress.progress[String(question.id)]?.mastery)}
                            </button>
                            <button class="mastery-btn ${isMistake ? 'active' : ''}" data-shortcut-hint="error"
                                onclick="App.toggleMistake('${question.id}')">
                                ${isMistake ? '✓ ' : ''}易错
                            </button>
                        </div>
                    </div>
                </div>

                <div class="ai-panel closed" id="ai-panel"></div>
                <div class="annotation-panel closed" id="annotation-panel"></div>
            </div>
        `;

        this.bindChapterPickerTriggers();
        App.refreshShortcutHints(main);
        this.renderKaTeX();
        // 仅在从章节进入做题时记录学习位置；复习/笔记单题跳转不覆盖“继续学习”
        if (AppState.currentCategory && AppState.currentChapter) {
            StorageService.saveLearningPosition(
                AppState.currentCategory.id,
                AppState.currentChapter.id,
                questionIndex,
                question.id,
                AppState.questionMode
            );
            StateSync.pushLastStudy(AppState.currentChapter.id, question.id, 'single');
        }
        if (PreviewAccess.privateAllowed(false) && StorageService.isMastered(question.id) === false) {
            // 阅读即计 seen：与旧版逐题 PATCH 协议共享进度
            const entry = StorageService.getProgress().progress[String(question.id)] || {};
            if (!entry.seen) {
                const { data } = StorageService._entry(question.id);
                data.progress[String(question.id)] = { ...entry, seen: true, updated_at: new Date().toISOString() };
                StorageService.saveProgress(data);
                StateSync.queueQuestion(question.id, { seen: true });
            }
        }
        // AI 抽屉按题隔离：切题即刷新消息与草稿
        if (AppState.ui.aiPanelOpen) UIRenderer.renderAIPanel();
    }

    static renderMultiQuestions(activeIndex = AppState.currentQuestionIndex) {
        const main = document.getElementById('app-main');
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const start = AppState.questionOffset || 0;
        const total = AppState.chapterQuestionCount || entries.length;
        const progress = StorageService.getProgress();
        const rangeButtons = entries.map((entry, globalIndex) => {
            const id = String(entry.id);
            const mastery = progress.progress[id]?.mastery || 'not_started';
            const flags = `${StorageService.isFavorite(id) ? ' favorite' : ''}${StorageService.isMistake(id) ? ' error-prone' : ''}${mastery !== 'not_started' ? ` ${mastery}` : ''}`;
            return `<button type="button" class="question-rail-item${globalIndex === start + activeIndex ? ' current' : ''}${flags}" data-question-id="${escapeHtml(id)}" data-question-number="${globalIndex + 1}" data-mastery="${escapeHtml(mastery)}" aria-label="第 ${globalIndex + 1} 题，题号 ${escapeHtml(id)}，${masteryLabel(mastery)}${StorageService.isFavorite(id) ? '，已收藏' : ''}${StorageService.isMistake(id) ? '，易错' : ''}" onclick="App.goToChapterQuestion(${globalIndex})">${globalIndex + 1}</button>`;
        }).join('');
        const cards = AppState.questions.map((question, localIndex) => {
            const globalIndex = start + localIndex;
            const id = String(question.id);
            const entry = progress.progress[id] || {};
            const mastery = entry.mastery || 'not_started';
            const active = localIndex === activeIndex;
            const favorite = StorageService.isFavorite(id);
            const mistake = StorageService.isMistake(id);
            const stem = this.renderQuestionContent(question, { multi: true })
                .replace(/ id="(?:question-options|answer-section)"/g, '');
            return `<article class="multi-question-card${active ? ' active-question' : ''}" id="multi-question-${globalIndex}" data-question-id="${escapeHtml(id)}">
                <header class="multi-question-head"><div><span class="multi-question-number">第 ${globalIndex + 1} 题</span><span class="multi-question-id">题号 ${escapeHtml(id)}</span><span class="multi-question-source">${escapeHtml(question.source || '')}${question.year ? ` · ${escapeHtml(question.year)}年` : ''}</span></div>
                <div class="multi-card-actions">
                  <button type="button" class="action-btn${favorite ? ' active' : ''}" onclick="App.toggleQuestionFavorite('${escapeHtml(id)}')">收藏</button>
                  <button type="button" class="action-btn${mistake ? ' active' : ''}" onclick="App.toggleQuestionMistake('${escapeHtml(id)}')">易错</button>
                  <button type="button" class="action-btn" onclick="App.openQuestionAnnotation('${escapeHtml(id)}')">批注</button>
                  <button type="button" class="action-btn" onclick="App.openQuestionAI('${escapeHtml(id)}')">AI 辅助</button>
                </div></header>
                <div class="multi-question-reading">${stem}</div>
                <div class="multi-question-status"><button type="button" class="mastery-btn mastery-${mastery}" onclick="App.cycleMastery('${escapeHtml(id)}')">${masteryLabel(mastery)}</button><button type="button" class="expand-answer-btn" aria-expanded="false" onclick="App.toggleCardAnswer(${globalIndex}, this)">显示答案</button></div>
            </article>`;
        }).join('');
        const pageStart = Math.floor(start / 20) * 20;
        const railTools = `<div class="question-rail-tools"><label class="sr-only">按题号定位</label><input type="search" inputmode="numeric" aria-label="按题号定位" placeholder="题号" value="${escapeHtml(AppState.questionRailQuery)}" oninput="App.filterQuestionIndex(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();App.jumpByQuestionNumber(this.value)}"><div class="question-rail-filters"><button type="button" data-rail-filter="favorite" aria-pressed="${AppState.questionRailFilter === 'favorite'}" class="${AppState.questionRailFilter === 'favorite' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('favorite')">收藏</button><button type="button" data-rail-filter="error-prone" aria-pressed="${AppState.questionRailFilter === 'error-prone'}" class="${AppState.questionRailFilter === 'error-prone' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('error-prone')">易错</button><button type="button" data-rail-filter="learning" aria-pressed="${AppState.questionRailFilter === 'learning'}" class="${AppState.questionRailFilter === 'learning' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('learning')">学习中</button><button type="button" data-rail-filter="mastered" aria-pressed="${AppState.questionRailFilter === 'mastered'}" class="${AppState.questionRailFilter === 'mastered' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('mastered')">已掌握</button><button type="button" data-rail-filter="not_started" aria-pressed="${AppState.questionRailFilter === 'not_started'}" class="${AppState.questionRailFilter === 'not_started' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('not_started')">未开始</button></div></div>`;
        main.innerHTML = `<div class="multi-question-view">
            <div class="question-header"><div class="breadcrumb-nav"><a href="#" onclick="App.showHome(); return false;">首页</a><span class="breadcrumb-sep">/</span><a href="#" onclick="App.showLibrary('${escapeHtml(AppState.currentCategory?.id || '')}'); return false;">${escapeHtml(AppState.currentCategory?.name || '题库')}</a><span class="breadcrumb-sep">/</span><span>${escapeHtml(AppState.currentChapter?.name || AppState.currentChapter?.title || '章节')}</span></div><div class="question-sequence">${total} 题 · 每段 20 题</div>${AppState.globalSearchReturn ? '<button type="button" class="btn btn-secondary" onclick="App.returnToGlobalSearch()">返回搜索</button>' : ''}${AppState.currentCategory && AppState.currentChapter ? '<button type="button" class="btn btn-secondary chapter-picker-trigger" data-open-chapter-picker>选择小节</button>' : ''}</div>
            <div class="mode-toolbar"><span>多题阅读 · 第 ${pageStart + 1}–${Math.min(pageStart + AppState.questions.length, total)} 题</span><div class="mode-toolbar-actions"><button type="button" class="mode-step-button" data-shortcut-hint="multiPrev" onclick="App.goToChapterQuestion(AppState.questionOffset + AppState.currentQuestionIndex - 1)">上一题</button><button type="button" class="mode-step-button" data-shortcut-hint="multiNext" onclick="App.goToChapterQuestion(AppState.questionOffset + AppState.currentQuestionIndex + 1)">下一题</button><button type="button" class="mode-jump-button" data-shortcut-hint="jump" onclick="App.promptJumpToQuestion()">跳题</button><div class="mode-switch"><button type="button" data-shortcut-hint="mode" onclick="App.changeQuestionMode('single')">单题</button><button type="button" class="active" aria-pressed="true">多题</button></div><button type="button" class="mobile-question-index-btn" onclick="App.toggleQuestionDrawer()">题号目录</button></div></div>
            <div class="multi-reading-layout"><aside class="question-rail" aria-label="题号目录">${railTools}${rangeButtons}</aside><div class="multi-question-list">${cards}<div class="multi-page-nav"><button type="button" class="btn btn-secondary" ${start === 0 ? 'disabled' : ''} onclick="App.goToChapterQuestion(${Math.max(0, start - 1)})">上一段</button><button type="button" class="btn btn-secondary" ${start + AppState.questions.length >= total ? 'disabled' : ''} onclick="App.goToChapterQuestion(${Math.min(total - 1, start + AppState.questions.length)})">下一段</button></div></div></div>
            <div class="question-drawer-backdrop" onclick="App.toggleQuestionDrawer()"></div><aside class="question-drawer" aria-label="题号目录">${railTools}${rangeButtons}</aside>
            <div class="ai-panel closed" id="ai-panel"></div><div class="annotation-panel closed" id="annotation-panel"></div>
        </div>`;
        this.bindChapterPickerTriggers();
        App.refreshShortcutHints(main);
        this.renderKaTeX();
        AppState.currentQuestionIndex = Math.min(Math.max(0, activeIndex), AppState.questions.length - 1);
        App.filterQuestionRailItems();
        const selected = AppState.questions[AppState.currentQuestionIndex];
        if (selected && AppState.currentCategory && AppState.currentChapter) {
            StorageService.saveLearningPosition(AppState.currentCategory.id, AppState.currentChapter.id, start + AppState.currentQuestionIndex, selected.id, 'multi');
        }
        if (AppState.ui.aiPanelOpen) this.renderAIPanel();
        if (AppState.ui.annotationPanelOpen) this.renderAnnotationPanel();
    }

    static async renderMultiRange(start, selectedId = null, token = null) {
        const questions = await DataService.loadQuestionRange(AppState.currentChapter, start, 20);
        if (token != null && token !== AppState.modeSwitchToken) return false;
        if (!questions.length) throw new Error('该段题目暂时无法加载');
        AppState.questions = questions;
        AppState.questionOffset = start;
        const localIndex = selectedId == null ? 0 : questions.findIndex(q => String(q.id) === String(selectedId));
        await UIRenderer.renderQuestion(Math.max(0, localIndex));
        if (selectedId != null || start > 0) {
            const globalIndex = start + Math.max(0, localIndex);
            document.getElementById(`multi-question-${globalIndex}`)?.scrollIntoView({ block: 'start' });
        }
    }

    static renderQuestionContent(question, { multi = false } = {}) {
        let html = `<div class="question-stem">${renderMarkdown(question.stem || question.question || '')}</div>`;

        if (question.image) {
            html += `
                <div class="question-image">
                    <img src="${assetUrl(question.image)}" alt="题目配图" loading="lazy" tabindex="0" role="button" title="点击放大图片">
                </div>
            `;
        }

        if (question.options && question.options.length > 0) {
            html += `<div class="question-options" id="question-options">`;
            question.options.forEach((opt, idx) => {
                const isObj = typeof opt === 'object' && opt !== null;
                const label = (isObj && opt.label) || String.fromCharCode(65 + idx);
                const content = isObj ? (opt.content_md || opt.content || opt.text || '') : opt;
                const correct = Array.isArray(question.correct_labels) && question.correct_labels.includes(label);
                html += `
                        <div class="option-item" data-correct="${correct ? '1' : '0'}" onclick="${multi ? `App.selectQuestionOption('${escapeHtml(question.id)}', ${idx}, this)` : `App.selectOption(${idx})`}">
                        <div class="option-label">${escapeHtml(label)}</div>
                        <div class="option-content">${renderMarkdown(content)}</div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        html += `
            <div class="answer-section" id="answer-section" style="display: none;">
                <h3>答案</h3>
                <div class="answer-content">${renderMarkdown(question.answer || '暂无答案')}</div>

                ${question.explanation ? `
                    <div class="explanation-section">
                        <h3>解析</h3>
                        <div class="explanation-content">${renderMarkdown(question.explanation)}</div>
                    </div>
                ` : ''}

                ${this.renderVideoLinks(question)}
            </div>
        `;

        return html;
    }

    static renderVideoLinks(question) {
        const mapping = AppState.videoMappings;
        const entries = mapping && Array.isArray(mapping.questions?.[String(question.id)])
            ? mapping.questions[String(question.id)]
            : [];

        const links = [];
        for (const entry of entries) {
            const bvid = String(entry?.bvid || '').trim();
            const page = Number(entry?.page);
            const seconds = Number(entry?.startSeconds);
            if (!/^BV[\w]+$/.test(bvid) || !Number.isInteger(page) || page < 1 || !Number.isFinite(seconds) || seconds < 0) continue;
            const url = new URL(`https://www.bilibili.com/video/${encodeURIComponent(bvid)}/`);
            url.searchParams.set('p', String(page));
            url.searchParams.set('t', String(Math.floor(seconds)));
            const time = seconds >= 60
                ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
                : `${Math.floor(seconds)}s`;
            links.push({ teacher: entry.teacher || '视频', title: entry.title || entry.seriesTitle || bvid, time, url: url.toString() });
        }

        const paradiyu = AppState.paradiyuVideoMapping;
        const paradiyuEntry = paradiyu?.questions?.[String(question.id)];
        const paradiyuId = String(paradiyu?.videoId || '');
        const paradiyuSeconds = Number(paradiyuEntry?.startSeconds);
        if (paradiyuEntry && /^BV[\w]+$/.test(paradiyuId) && Number.isFinite(paradiyuSeconds) && paradiyuSeconds >= 0) {
            const url = new URL(`https://www.bilibili.com/video/${encodeURIComponent(paradiyuId)}/`);
            url.searchParams.set('t', String(Math.floor(paradiyuSeconds)));
            const time = paradiyuSeconds >= 60
                ? `${Math.floor(paradiyuSeconds / 60)}:${String(Math.floor(paradiyuSeconds % 60)).padStart(2, '0')}`
                : `${Math.floor(paradiyuSeconds)}s`;
            links.push({ teacher: '帕拉迪宇', title: paradiyuEntry.title || '线性代数讲解', time, url: url.toString() });
        }

        if (links.length === 0) return '';

        return `
            <div class="video-section">
                <h4>视频讲解</h4>
                ${links.map(v => `
                    <div class="video-link-row">
                        <strong>${escapeHtml(v.teacher)}</strong>
                        <a href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer" class="video-link">
                            ${escapeHtml(v.title)} · ${escapeHtml(v.time)}
                            <span aria-hidden="true"> ↗</span>
                        </a>
                    </div>
                `).join('')}
            </div>
        `;
    }

    static renderKaTeX() {
        if (typeof renderMathInElement !== 'undefined') {
            const content = document.getElementById('question-content') || document.querySelector('.multi-question-view');
            if (content) {
                renderMathInElement(content, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
        }
    }

    static renderAIPanel() {
        const panel = document.getElementById('ai-panel');
        if (!panel) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        const draft = question ? StorageService.getAIDraft(question.id) : '';
        const profiles = AppState.aiProfiles || [];
        const profileOptions = profiles.length
            ? profiles.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === AppState.aiProfileId ? 'selected' : ''}>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''}</option>`).join('')
            : '<option value="">未配置 AI</option>';

        panel.innerHTML = `
            <div class="ai-header">
                <h3>AI 辅助</h3>
                <button class="btn btn-icon btn-text" onclick="App.toggleAI()" aria-label="关闭 AI 面板">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="ai-profile-row">
                <label for="ai-profile-select-new">服务</label>
                <select id="ai-profile-select-new" onchange="App.selectAIProfile(this.value)">${profileOptions}</select>
                <button type="button" class="btn btn-text btn-sm" onclick="App.navigate('settings')">设置</button>
            </div>

            <div class="ai-quick-prompts">
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.full)">完整解答</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.hint)">给我提示</button>
                <button class="quick-prompt-btn" onclick="App.sendAIPrompt(AI_COMPOSE_PROMPTS.pitfall)">易错点</button>
            </div>

            <div class="ai-messages" id="ai-messages"><div class="ai-empty"><strong>先问一个问题</strong><p>题目上下文已经准备好，选择上方提示或直接输入你的疑问。</p></div></div>

            <div class="ai-input-area">
                <div class="ai-input-wrapper">
                    <textarea class="ai-input" id="ai-input"
                        placeholder="输入你的问题..."
                        rows="2">${escapeHtml(draft)}</textarea>
                    <div class="ai-input-actions">
                        <label class="ai-privacy-check"><input type="checkbox" id="ai-include-private-new"> 包含我的批注与学习状态</label>
                        <span class="ai-input-buttons">
                            <button type="button" class="btn btn-secondary btn-sm" id="ai-stop-btn" hidden onclick="App.stopAIStream()">停止</button>
                            <button class="btn btn-primary ai-send-btn" id="ai-send-btn" onclick="App.sendAIMessage()">发送</button>
                        </span>
                    </div>
                </div>
            </div>
        `;

        const input = document.getElementById('ai-input');
        if (input) {
            input.addEventListener('input', () => {
                if (question) StorageService.saveAIDraft(question.id, input.value);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendAIMessage(); }
            });
        }
        if (question) this.renderAIHistory(question);
    }

    static async renderAIHistory(question) {
        const messagesEl = document.getElementById('ai-messages');
        if (!messagesEl || !question) return;
        const history = await AIService.loadHistory(question);
        // 用户可能已切题，历史回来时校验仍是当前题
        const current = AppState.questions[AppState.currentQuestionIndex];
        if (!current || String(current.id) !== String(question.id)) return;
        if (!history.length) return;
        messagesEl.innerHTML = '';
        for (const message of history) {
            const msg = document.createElement('div');
            msg.className = `ai-message ${message.role === 'user' ? 'user' : 'assistant'}`;
            msg.innerHTML = `<div class="ai-message-bubble">${message.role === 'user' ? escapeHtml(message.content) : renderMarkdown(message.content)}</div>`;
            messagesEl.appendChild(msg);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    static renderAnnotationPanel() {
        const panel = document.getElementById('annotation-panel');
        if (!panel) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        const annotation = StorageService.getAnnotation(question.id);

        panel.innerHTML = `
            <div class="annotation-header">
                <h3>批注</h3>
                <button class="btn btn-icon btn-text" onclick="App.toggleAnnotation()">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>

            <div class="annotation-tabs">
                <button class="annotation-tab active" data-tab="edit" onclick="App.switchAnnotationTab('edit')">
                    编辑
                </button>
                <button class="annotation-tab" data-tab="preview" onclick="App.switchAnnotationTab('preview')">
                    预览
                </button>
            </div>

            <div class="annotation-editor">
                <textarea class="annotation-textarea" id="annotation-textarea"
                    placeholder="支持 Markdown 和 KaTeX 公式...">${annotation.content}</textarea>
                <div class="annotation-preview hidden" id="annotation-preview"></div>
            </div>

            <div class="annotation-footer">
                <div class="annotation-status" id="annotation-status">未保存</div>
                <button class="btn btn-primary btn-sm" onclick="App.saveAnnotation()">
                    保存
                </button>
            </div>
        `;

        const textarea = document.getElementById('annotation-textarea');
        if (textarea) {
            let saveTimeout;
            textarea.addEventListener('input', () => {
                AppState.annotationDirty = true;
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    App.autoSaveAnnotation();
                }, 1000);
            });
        }
    }

    // ========== 阶段 D 辅助页面 ==========

    // ---- 通用小工具 ----

    // 纯文本摘要：不渲染 KaTeX（渲染产物 textContent 会重复拼接），直接清洗 LaTeX 记号
    static plainSummary(markdown, maxLen = 60) {
        const text = String(markdown || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\$\$([\s\S]+?)\$\$/g, ' ［公式］ ')
            .replace(/\\\[([\s\S]+?)\\\]/g, ' ［公式］ ')
            .replace(/\\\(([\s\S]+?)\\\)/g, ' ［公式］ ')
            .replace(/\$([^\$\n]+?)\$/g, (_, tex) => ' ' + tex + ' ')
            .replace(/\\(?:pmatrix|bmatrix|vmatrix|matrix|cases|array)/g, '')
            .replace(/\\\\/g, '；')
            .replace(/&/g, '，')
            .replace(/\\(?:mathrm|mathbf|mathit|text|left|right|begin|end)\{[^{}]*\}/g, '')
            .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
            .replace(/\\(?:int|sum|prod|lim|sqrt|alpha|beta|gamma|varphi|varphi|vartheta|lambda|mu|pi|phi|theta|omega)/g, m => ({
                '\\int': '∫', '\\sum': 'Σ', '\\prod': 'Π', '\\lim': 'lim', '\\sqrt': '√',
                '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\varphi': 'φ', '\\vartheta': 'θ',
                '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\phi': 'φ', '\\theta': 'θ', '\\omega': 'ω'
            })[m] || '')
            .replace(/\\[a-zA-Z]+/g, '')
            .replace(/[\^_]/g, '')
            .replace(/[{}]/g, '')
            .replace(/[#>*~|]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
    }

    static masteryLabel(mastery) {
        return ({ mastered: '已掌握', learning: '学习中', not_started: '未开始' })[mastery] || String(mastery);
    }

    static chapterLabel(question) {
        const p = question && question.category_path;
        if (Array.isArray(p)) return p.join(' / ');
        if (p) return String(p);
        return (question && question.source) || '未分类';
    }

    static formatDateTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    // ---- 复习页 ----

    // 三类队列的题号列表（数据源与 StorageService 计数口径一致）
    static reviewTabIds(tab, progress, favorites) {
        const entries = progress || {};
        if (tab === 'favorites') return (favorites || []).map(String);
        if (tab === 'todo') {
            return Object.keys(entries).filter(id => entries[id] && entries[id].mastery && entries[id].mastery !== 'mastered');
        }
        return Object.keys(entries).filter(id => entries[id] && entries[id].error_prone === true);
    }

    static async renderReview(tab) {
        tab = ['mistakes', 'favorites', 'todo'].includes(tab) ? tab : (AppState.reviewTab || 'mistakes');
        AppState.reviewTab = tab;

        const main = document.getElementById('app-main');
        const { progress, favorites } = StorageService.getProgress();

        const tabs = [
            { key: 'mistakes', label: '易错题' },
            { key: 'favorites', label: '收藏' },
            { key: 'todo', label: '待掌握' }
        ];

        main.innerHTML = `
            <div class="home-content">
                <h1 class="text-page-title" style="margin-bottom: var(--spacing-xl);">复习</h1>
                <div class="review-tabs" role="tablist">
                    ${tabs.map(t => `
                        <button type="button" class="review-tab ${t.key === tab ? 'active' : ''}" role="tab"
                            aria-selected="${t.key === tab}" onclick="App.showReview('${t.key}')">
                            ${t.label}
                            <span class="review-tab-count" id="review-count-${t.key}">${this.reviewTabIds(t.key, progress, favorites).length}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="review-list" id="review-list">
                    <div class="review-loading"><span class="spinner"></span> 正在加载题目…</div>
                </div>
            </div>
        `;

        const ids = this.reviewTabIds(tab, progress, favorites)
            .sort((a, b) => new Date((progress[b] && progress[b].updated_at) || 0) - new Date((progress[a] && progress[a].updated_at) || 0));

        const loaded = await Promise.all(ids.map(async (id) => ({
            id,
            question: await DataService.getQuestion(id).catch(() => null),
            entry: progress[id] || {}
        })));
        const items = loaded.filter(x => x.question);

        // 计数与列表实际条数保持一致
        const badgeEl = document.getElementById(`review-count-${tab}`);
        if (badgeEl) badgeEl.textContent = String(items.length);

        const listEl = document.getElementById('review-list');
        if (!listEl) return;

        if (items.length === 0) {
            const emptyCopy = {
                mistakes: { title: '暂无易错题', desc: '做题时点击「易错」，题目会出现在这里。' },
                favorites: { title: '暂无收藏题目', desc: '做题时点击「收藏」，题目会出现在这里。' },
                todo: { title: '暂无待掌握题目', desc: '做题时标记掌握状态，未掌握的题目会出现在这里。' }
            }[tab];
            listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📗</div>
                    <h3>${emptyCopy.title}</h3>
                    <p>${emptyCopy.desc}</p>
                    <button type="button" class="btn btn-primary" onclick="App.showLibrary()">去题库刷题</button>
                </div>
            `;
            return;
        }

        listEl.innerHTML = items.map(({ id, question, entry }) => {
            const tags = [];
            if (entry.error_prone === true) tags.push('<span class="status-tag tag-mistake">易错</span>');
            if (StorageService.isFavorite(id)) tags.push('<span class="status-tag tag-favorite">收藏</span>');
            if (entry.mastery) {
                tags.push(`<span class="status-tag ${entry.mastery === 'mastered' ? 'tag-mastered' : 'tag-learning'}">${escapeHtml(this.masteryLabel(entry.mastery))}</span>`);
            }
            return `
                <div class="review-item">
                    <div class="review-item-body">
                        <div class="review-item-summary">${escapeHtml(this.plainSummary(question.stem || question.question || ''))}</div>
                        <div class="review-item-meta">
                            <span class="review-item-chapter">${escapeHtml(this.chapterLabel(question))}</span>
                            ${tags.join('')}
                        </div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="App.openQuestionFromList('${id}')">继续</button>
                </div>
            `;
        }).join('');
    }

    // ---- 笔记页 ----

    static renderNotes() {
        const main = document.getElementById('app-main');
        const annotations = StorageService.getAnnotations();
        const ids = Object.keys(annotations)
            .filter(id => annotations[id] && typeof annotations[id].content === 'string' && annotations[id].content.trim())
            .sort((a, b) => new Date(annotations[b].lastModified || 0) - new Date(annotations[a].lastModified || 0));

        const memo = StorageService.getLocalMemo();
        const memoId = '__memo__';

        let selected = AppState.selectedNoteId;
        if (selected !== memoId && !ids.includes(selected)) selected = ids[0] || memoId;
        AppState.selectedNoteId = selected;

        const listItems = ids.map(id => {
            const note = annotations[id];
            return `
                <button type="button" class="notes-item ${id === selected ? 'active' : ''}" onclick="App.selectNote('${id}')">
                    <div class="notes-item-title">题 ${escapeHtml(String(id))}</div>
                    <div class="notes-item-summary">${escapeHtml(this.plainSummary(note.content, 40))}</div>
                    <div class="notes-item-meta">${note.lastModified ? escapeHtml(this.formatDateTime(note.lastModified)) : ''}</div>
                </button>
            `;
        }).join('');

        let detailHtml;
        if (selected === memoId) {
            detailHtml = `
                <div class="notes-detail-header">
                    <h2 class="text-section-title">学习备忘</h2>
                </div>
                <textarea class="memo-textarea" id="memo-textarea"
                    placeholder="记录学习计划、待办事项…（支持纯文本）">${escapeHtml(memo.content)}</textarea>
                <div class="memo-footer">
                    <span class="memo-status" id="memo-status"></span>
                    <button type="button" class="btn btn-primary btn-sm" onclick="App.saveMemo()">保存备忘</button>
                </div>
            `;
        } else {
            const note = annotations[selected] || { content: '' };
            detailHtml = `
                <div class="notes-detail-header">
                    <div>
                        <h2 class="text-section-title">题 ${escapeHtml(String(selected))} 的批注</h2>
                        ${note.lastModified ? `<p class="text-helper">更新于 ${escapeHtml(this.formatDateTime(note.lastModified))}</p>` : ''}
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="App.openQuestionFromList('${selected}')">查看原题</button>
                </div>
                <div class="notes-detail-content">${renderMarkdown(note.content)}</div>
            `;
        }

        main.innerHTML = `
            <div class="home-content">
                <h1 class="text-page-title" style="margin-bottom: var(--spacing-xl);">笔记</h1>
                <div class="notes-layout">
                    <aside class="notes-list-panel">
                        ${ids.length === 0
                            ? '<p class="notes-empty-hint">在做题时点击「批注」为题目添加笔记</p>'
                            : `<div class="notes-list">${listItems}</div>`}
                        <div class="notes-memo-group">
                            <div class="notes-group-title">学习备忘</div>
                            <button type="button" class="notes-item ${selected === memoId ? 'active' : ''}" onclick="App.selectNote('${memoId}')">
                                <div class="notes-item-title">学习备忘</div>
                                <div class="notes-item-meta">${memo.savedAt ? escapeHtml(this.formatDateTime(memo.savedAt)) : '随手记录待办与计划'}</div>
                            </button>
                        </div>
                    </aside>
                    <section class="notes-detail-panel">${detailHtml}</section>
                </div>
            </div>
        `;
        App.bindMemoEditor();
    }

    // ---- 学习记录页 ----

    static heatmapLevel(count) {
        if (!count || count <= 0) return 0;
        if (count <= 2) return 1;
        if (count <= 5) return 2;
        if (count <= 9) return 3;
        return 4;
    }

    static renderHeatmap(daily) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const mondayOffset = (today.getDay() + 6) % 7; // 周一为一周开始
        const start = new Date(today);
        start.setDate(start.getDate() - mondayOffset - 77); // 最近 12 周（含本周）的起点周一

        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        let cells = '';
        for (let w = 0; w < 12; w++) {
            for (let d = 0; d < 7; d++) {
                const cur = new Date(start);
                cur.setDate(start.getDate() + w * 7 + d);
                if (cur > today) {
                    cells += '<span class="heatmap-cell future"></span>';
                    continue;
                }
                const key = fmt(cur);
                const count = daily[key] || 0;
                cells += `<span class="heatmap-cell hL${this.heatmapLevel(count)}" title="${key}：${count} 题"></span>`;
            }
        }

        return `
            <div class="heatmap-wrap">
                <div class="heatmap-weekdays" aria-hidden="true">
                    ${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span>${w}</span>`).join('')}
                </div>
                <div class="heatmap-grid">${cells}</div>
            </div>
            <div class="heatmap-legend">
                <span class="text-helper">少</span>
                ${[0, 1, 2, 3, 4].map(l => `<span class="heatmap-cell hL${l}"></span>`).join('')}
                <span class="text-helper">多</span>
            </div>
        `;
    }

    static renderRecords() {
        const main = document.getElementById('app-main');
        const { progress } = StorageService.getProgress();
        const entries = Object.values(progress || {}).filter(Boolean);

        const mastered = entries.filter(e => e.mastery === 'mastered').length;
        const mistakes = entries.filter(e => e.error_prone === true).length;
        const learning = entries.filter(e => e.mastery && e.mastery !== 'mastered').length;
        const answered = entries.filter(e => e.updated_at).length;

        // 按 updated_at 日期聚合每日作答数
        const daily = {};
        entries.forEach(e => {
            if (!e.updated_at) return;
            const d = new Date(e.updated_at);
            if (Number.isNaN(d.getTime())) return;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            daily[key] = (daily[key] || 0) + 1;
        });

        main.innerHTML = `
            <div class="home-content">
                <h1 class="text-page-title" style="margin-bottom: var(--spacing-xl);">学习记录</h1>
                ${answered > 0 ? `
                    <div class="records-stats">
                        <div class="stat-card">
                            <div class="stat-value">${mastered}</div>
                            <div class="stat-label">已掌握</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${learning}</div>
                            <div class="stat-label">学习中</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${mistakes}</div>
                            <div class="stat-label">易错题</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${answered}</div>
                            <div class="stat-label">总作答数</div>
                        </div>
                    </div>
                    <div class="card heatmap-card">
                        <h2 class="text-section-title">作答热力图</h2>
                        <p class="text-helper heatmap-caption">最近 12 周 · 按本地作答记录统计</p>
                        ${this.renderHeatmap(daily)}
                    </div>
                ` : `
                    <div class="empty-state">
                        <div class="empty-state-icon">📈</div>
                        <h3>还没有学习记录</h3>
                        <p>完成题目后，这里会展示真实的作答统计与热力图。</p>
                        <button type="button" class="btn btn-primary" onclick="App.showLibrary()">去题库刷题</button>
                    </div>
                `}
            </div>
        `;
    }

    // ---- 工具页 ----

    static renderTools() {
        const main = document.getElementById('app-main');
        const subjectOptions = (AppState.categories?.categories || [])
            .map(cat => `<option value="${escapeHtml(String(cat.id))}">${escapeHtml(cat.name)}</option>`)
            .join('');
        main.innerHTML = `
            <div class="home-content">
                <h1 class="text-page-title" style="margin-bottom: var(--spacing-xl);">工具</h1>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">智能组卷</h2>
                            <p>从本地题库中按范围随机抽题，立即开始作答。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" id="paper-toggle-btn" onclick="App.toggleToolPanel('paper-panel')">进入</button>
                    </div>
                    <div class="tool-panel hidden" id="paper-panel">
                        <div class="tool-controls">
                            <label>范围
                                <select id="paper-scope">
                                    <option value="all">全部题库</option>
                                    ${subjectOptions}
                                </select>
                            </label>
                            <label>题目数量
                                <input id="paper-count" type="number" min="5" max="50" value="20" />
                            </label>
                            <button type="button" class="btn btn-primary btn-sm" id="btn-generate-paper">生成试卷</button>
                        </div>
                        <div class="tool-result" id="paper-result"></div>
                    </div>
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">导出题目</h2>
                            <p>把题目与解析整理为可打印预览，或直接下载 HTML 文件。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" id="export-toggle-btn" onclick="App.toggleToolPanel('export-panel')">进入</button>
                    </div>
                    <div class="tool-panel hidden" id="export-panel">
                        <div class="tool-controls">
                            <label>范围
                                <select id="export-scope">
                                    <option value="favorites">收藏题</option>
                                    <option value="mistakes">易错题</option>
                                    <option value="mastered">已掌握</option>
                                    <option value="chapter">当前章节队列</option>
                                </select>
                            </label>
                            <label class="tool-check"><input type="checkbox" id="export-answers" /> 含答案</label>
                            <label class="tool-check"><input type="checkbox" id="export-expl" /> 含解析</label>
                            <button type="button" class="btn btn-primary btn-sm" id="btn-export-go">生成导出预览</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-export-download">下载 HTML 文件</button>
                        </div>
                        <p class="text-helper">预览窗口内可打印或另存 PDF；“下载 HTML 文件”会保存离线可看的单文件。</p>
                    </div>
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">进度备份</h2>
                            <p>下载做题进度、收藏、易错、批注与选题（不包含 AI 服务密钥）。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" onclick="App.downloadBackup()">下载备份</button>
                    </div>
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">恢复备份</h2>
                            <p>选择 daguan-progress-*.json 或 daguan-backup-*.json；解析失败不会改动现有数据。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('restore-input').click()">选择文件</button>
                    </div>
                    <input type="file" id="restore-input" accept=".json,application/json" class="hidden"
                        onchange="App.restoreBackup(this)">
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">合并旧浏览器记录</h2>
                            <p>先预览差异并下载当前记录备份，再按逐题修改时间合并进度、收藏、批注和学习位置。外观、快捷键与 AI 草稿不会迁移。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('migration-input').click()">选择旧备份</button>
                    </div>
                    <input type="file" id="migration-input" accept=".json,application/json" class="hidden" onchange="UIRenderer.previewLegacyBackup(this)">
                    <div class="tool-result" id="migration-preview" aria-live="polite"></div>
                    <div class="tool-controls hidden" id="migration-confirmation">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-migration-backup">下载当前记录备份</button>
                        <label class="tool-check"><input type="checkbox" id="migration-backup-saved" disabled /> 我已保存这份当前记录备份</label>
                        <button type="button" class="btn btn-primary btn-sm" id="btn-migration-apply" disabled>确认合并</button>
                        <button type="button" class="btn btn-text btn-sm" id="btn-migration-cancel">取消合并</button>
                    </div>
                </div>

                ${new URLSearchParams(location.search).get('browserPackage') === '1' ? `<div class="card tool-card"><div class="tool-row"><div class="tool-info"><h2 class="text-section-title">本地服务</h2><p>停止后，其他浏览器标签页将断开；下次启动浏览器包会重新连接或启动服务。</p></div><button type="button" class="btn btn-secondary" id="btn-stop-local-service">停止本地服务</button></div></div>` : ''}

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">官网同步</h2>
                            <p>读取官网进度或上传本地进度，全程先预览差异、确认后才写入。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" id="sync-toggle-btn" onclick="App.toggleToolPanel('sync-panel')">进入</button>
                    </div>
                    <div class="tool-panel hidden" id="sync-panel">
                        <div class="sync-status" id="sync-status">点击“检查状态”连接本地中控台。</div>
                        <div class="tool-controls">
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-status">检查状态</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-login">配置登录</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-pull">读取官网进度</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-push">上传本地进度</button>
                        </div>
                        <form class="tool-controls hidden" id="sync-login-form">
                            <label>登录码 / 账号
                                <input type="text" id="sync-login-user" placeholder="官网登录码或用户名" autocomplete="off" />
                            </label>
                            <label>密码（登录码方式可留空）
                                <input type="password" id="sync-login-pass" placeholder="账号密码方式时填写" autocomplete="off" />
                            </label>
                            <button type="submit" class="btn btn-primary btn-sm">保存登录配置</button>
                        </form>
                        <div class="tool-result" id="sync-result"></div>
                    </div>
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">使用教程</h2>
                            <p>三步上手本地大观园。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" id="tutorial-toggle-btn" onclick="App.toggleTutorial()">展开</button>
                    </div>
                    <div class="tutorial-panel hidden" id="tutorial-panel">
                        <ol>
                            <li>在「题库」选择科目与章节开始做题，答完可展开答案与解析，观看老师视频讲解。</li>
                            <li>用「收藏 / 易错 / 已掌握 / 批注」标记题目，在「复习」和「笔记」页集中回看。</li>
                            <li>在「工具」页定期下载备份；更换设备或清空浏览器前，先用「恢复备份」还原数据。</li>
                        </ol>
                    </div>
                </div>

                <div class="tool-status" id="tool-status" role="status"></div>
            </div>
        `;
        this.bindToolActions();
    }

    static bindToolActions() {
        document.getElementById('btn-generate-paper')?.addEventListener('click', () => App.generatePaper());
        document.getElementById('btn-export-go')?.addEventListener('click', () => App.exportQuestions());
        document.getElementById('btn-export-download')?.addEventListener('click', () => App.exportQuestions({ download: true }));
        document.getElementById('btn-sync-status')?.addEventListener('click', () => App.syncStatus());
        document.getElementById('btn-sync-login')?.addEventListener('click', () => App.syncOpenLogin());
        document.getElementById('sync-login-form')?.addEventListener('submit', (event) => App.syncLogin(event));
        document.getElementById('btn-sync-pull')?.addEventListener('click', () => App.syncPull());
        document.getElementById('btn-sync-push')?.addEventListener('click', () => App.syncPush());
        document.getElementById('migration-backup-saved')?.addEventListener('change', (event) => {
            const button = document.getElementById('btn-migration-apply');
            if (button) button.disabled = !event.target.checked;
        });
        document.getElementById('btn-migration-backup')?.addEventListener('click', () => UIRenderer.downloadMigrationBackup());
        document.getElementById('btn-migration-apply')?.addEventListener('click', () => UIRenderer.applyLegacyMigration());
        document.getElementById('btn-migration-cancel')?.addEventListener('click', () => UIRenderer.cancelLegacyMigration());
        document.getElementById('btn-stop-local-service')?.addEventListener('click', () => UIRenderer.stopLocalBrowserService());
    }

    static async stopLocalBrowserService() {
        if (!confirm('停止本地服务？其他浏览器窗口将断开，但已保存的学习记录会保留。')) return;
        const button = document.getElementById('btn-stop-local-service');
        if (button) button.disabled = true;
        try {
            const response = await fetch('./api/runtime/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            App.setToolStatus('本地服务正在完成当前写入并退出。重新启动浏览器包即可恢复。', 'success');
        } catch (error) {
            if (button) button.disabled = false;
            App.setToolStatus(`未能停止本地服务：${error.message || '连接失败'}`, 'error');
        }
    }

    static async previewLegacyBackup(input) {
        const file = input?.files?.[0];
        if (!file || !PreviewAccess.privateAllowed()) return;
        const output = document.getElementById('migration-preview');
        const confirmation = document.getElementById('migration-confirmation');
        confirmation?.classList.add('hidden');
        this.pendingLegacyMigration = null;
        const savedCheckbox = document.getElementById('migration-backup-saved');
        if (savedCheckbox) { savedCheckbox.checked = false; savedCheckbox.disabled = true; }
        const applyButton = document.getElementById('btn-migration-apply');
        if (applyButton) applyButton.disabled = true;
        if (output) output.textContent = '正在读取旧备份并比较当前记录…';
        try {
            if (!window.DaguanBackupMigration) throw new Error('迁移工具尚未加载，请刷新页面后重试');
            const source = window.DaguanBackupMigration.parseBackup(await file.text());
            const response = await fetch('./api/state', { cache: 'no-store' });
            if (!response.ok) throw new Error('无法读取当前本地学习记录');
            const target = await response.json();
            const preview = window.DaguanBackupMigration.merge(source, target);
            this.pendingLegacyMigration = { fileName: file.name, source, target, targetRevision: Number(target.revision) || 0, preview };
            const c = preview.counts;
            if (output) output.innerHTML = `<p><strong>${escapeHtml(file.name)}</strong>：将迁入进度 ${c.importedProgress} 项、收藏 ${c.importedFavorites} 项、批注 ${c.importedAnnotations} 项${c.importedPosition ? '，学习位置 1 项' : ''}。</p><p>当前端优先保留：进度 ${c.keptTargetProgress} 项，收藏 ${c.keptTargetFavorites} 项，批注 ${c.keptTargetAnnotations} 项。时间缺失或相同的冲突保留当前端。</p><p class="text-helper">外观、快捷键、AI 草稿及旧版选题不会导入。请先下载并保存当前记录备份。</p>`;
            confirmation?.classList.remove('hidden');
        } catch (error) {
            this.pendingLegacyMigration = null;
            if (output) output.textContent = `无法预览：${error.message || '备份格式无效'}。当前记录未改动。`;
        } finally {
            if (input) input.value = '';
        }
    }

    static downloadMigrationBackup() {
        const pending = this.pendingLegacyMigration;
        if (!pending) return;
        const payload = { ...pending.target, format: 'daguan-local-state', version: 3, saved_at: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        anchor.href = url;
        anchor.download = `daguan-before-migration-${date}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        const checkbox = document.getElementById('migration-backup-saved');
        if (checkbox) { checkbox.disabled = false; checkbox.checked = false; }
        const applyButton = document.getElementById('btn-migration-apply');
        if (applyButton) applyButton.disabled = true;
        App.setToolStatus(`已生成当前记录备份：${anchor.download}。确认文件已保存后再继续。`, 'success');
    }

    static async applyLegacyMigration() {
        if (!this.pendingLegacyMigration || !document.getElementById('migration-backup-saved')?.checked) return;
        if (!PreviewAccess.privateAllowed()) return;
        const pending = this.pendingLegacyMigration;
        const output = document.getElementById('migration-preview');
        const button = document.getElementById('btn-migration-apply');
        if (button) button.disabled = true;
        try {
            const latestResponse = await fetch('./api/state', { cache: 'no-store' });
            if (!latestResponse.ok) throw new Error('无法重新读取当前记录');
            const latest = await latestResponse.json();
            if ((Number(latest.revision) || 0) !== pending.targetRevision) {
                const preview = window.DaguanBackupMigration.merge(pending.source, latest);
                this.pendingLegacyMigration = { ...pending, target: latest, targetRevision: Number(latest.revision) || 0, preview };
                const c = preview.counts;
                if (output) output.innerHTML = `<p>当前记录在预览后发生了变化，已按最新状态重新计算：将迁入进度 ${c.importedProgress} 项、收藏 ${c.importedFavorites} 项、批注 ${c.importedAnnotations} 项${c.importedPosition ? '，学习位置 1 项' : ''}。</p><p>请再次下载当前记录备份、确认已保存，然后重新确认合并。</p>`;
                document.getElementById('migration-backup-saved').checked = false;
                document.getElementById('migration-backup-saved').disabled = true;
                if (document.getElementById('btn-migration-backup')) document.getElementById('btn-migration-backup').focus();
                return;
            }
            const result = pending.preview.state;
            const write = await fetch('./api/state', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'If-Match': String(pending.targetRevision) },
                body: JSON.stringify({ ...result, revision: pending.targetRevision }),
            });
            if (write.status === 409) throw new Error('当前记录刚刚被另一个窗口更新，请重新预览并备份');
            if (!write.ok) throw new Error(`合并写入失败（HTTP ${write.status}）`);
            const c = pending.preview.counts;
            this.pendingLegacyMigration = null;
            document.getElementById('migration-confirmation')?.classList.add('hidden');
            if (output) output.textContent = `合并完成：进度 ${c.importedProgress} 项、收藏 ${c.importedFavorites} 项、批注 ${c.importedAnnotations} 项${c.importedPosition ? '，学习位置 1 项' : ''}。其他窗口将自动刷新。`;
            await StateSync.hydrate();
            App.setToolStatus('旧浏览器学习记录已合并。', 'success');
        } catch (error) {
            if (output) output.textContent = `合并失败：${error.message || '未知错误'}。当前数据未被覆盖，请重新预览。`;
            App.setToolStatus('旧浏览器记录未合并。', 'error');
        } finally {
            if (button) button.disabled = !document.getElementById('migration-backup-saved')?.checked;
        }
    }

    static cancelLegacyMigration() {
        this.pendingLegacyMigration = null;
        document.getElementById('migration-confirmation')?.classList.add('hidden');
        const checkbox = document.getElementById('migration-backup-saved');
        if (checkbox) { checkbox.checked = false; checkbox.disabled = true; }
        const applyButton = document.getElementById('btn-migration-apply');
        if (applyButton) applyButton.disabled = true;
        const input = document.getElementById('migration-input');
        if (input) input.value = '';
        const output = document.getElementById('migration-preview');
        if (output) output.textContent = '已取消合并预览。当前记录未改动。';
        App.setToolStatus('已取消旧浏览器记录合并。', '');
    }
}

// ========== AI 服务（对接本地中控台 /api/ai/*：profileId + question + prompt，SSE） ==========
const AI_COMPOSE_PROMPTS = {
    full: '请对这道题进行可追踪的逐步解题，不要只给结论或一段连续推导。一、总体思路：先用 1、2、3……列出完整解题路线，说明每一步要解决什么问题，以及这些步骤之间的关系。二、逐步解题：按照总体思路逐步展开。每一步都必须明确写出：1. 这是总体思路中的第几步，本步的目标是什么；2. 本步使用的知识点名称；3. 这个知识点的具体内容，包括定义、定理、公式、适用条件或判断依据；4. 从题目中的什么信息知道要使用这个知识点；5. 题干、图像、条件、选项中的具体信息是什么；6. 由这些信息如何进行推导、计算或判断；7. 本步得到的结果是什么，以及它如何用于下一步。请严格区分题目直接给出的信息、根据题目推出的中间结论、上一步已经得到的结果、官方解析中提供但题干没有直接给出的内容。如果某个知识点不是从题干直接判断出来的，而是由前一步结果推出的，要明确说明这是由前一步结果得到的。三、最终答案：完成所有步骤后，再单独给出最终答案，并说明答案是如何由前面的步骤得到的。四、方法总结：最后说明这类题遇到时应该优先识别哪些信息、第一时间想到什么方法，以及本题的通用解题套路。只围绕以上结构回答，不省略关键依据，不把多个推理步骤合并成一句话。数学公式使用 LaTeX。',
    hint: '先不要直接跳到结论，给我一个解题提示。',
    pitfall: '请指出这道题最容易犯的错误。'
};

class AIService {
    // SSE 跨块解析：不完整的行保留到下一块；返回 {events, rest}
    static parseSseChunk(buffer, text) {
        let working = String(buffer || '') + String(text || '');
        const events = [];
        const rows = working.split(/\r?\n/);
        const rest = rows.pop() || '';
        for (const row of rows) {
            if (!row.startsWith('data:')) continue;
            const data = row.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try { events.push(JSON.parse(data)); } catch { /* 忽略 keep-alive 碎片 */ }
        }
        return { events, rest };
    }

    static async loadProfiles() {
        try {
            const response = await fetch('./api/ai/profiles', { cache: 'no-store' });
            const data = await response.json();
            AppState.aiProfiles = Array.isArray(data.profiles) ? data.profiles : [];
        } catch {
            AppState.aiProfiles = [];
        }
        const preferred = StorageService.getAIPreferences().profileId;
        AppState.aiProfileId = AppState.aiProfiles.find(item => item.id === preferred)?.id
            || AppState.aiProfiles.find(item => item.active)?.id
            || AppState.aiProfiles[0]?.id
            || '';
        return AppState.aiProfiles;
    }

    static activeProfile() {
        return AppState.aiProfiles?.find(item => item.id === AppState.aiProfileId) || null;
    }

    static selectProfile(profileId) {
        AppState.aiProfileId = profileId || '';
        StorageService.saveAIPreference('profileId', AppState.aiProfileId);
    }

    // 服务端固定 system 指令负责数学教学约束；客户端只送 prompt + 题目载荷。
    static async chatStream({ question, prompt, includePrivate = false, images = [], signal }) {
        if (!AppState.aiProfileId) throw new Error('请先在设置中选择或配置 AI 服务');
        const response = await fetch('./api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileId: AppState.aiProfileId,
                question: this.questionPayload(question),
                prompt: String(prompt || ''),
                includePrivate: includePrivate === true,
                images: Array.isArray(images) ? images : [],
            }),
            signal,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `AI 请求失败（HTTP ${response.status}）`);
        }
        return response;
    }

    static async stopRun(runId) {
        if (!runId) return;
        await fetch(`./api/ai/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }).catch(() => {});
    }

    static questionPayload(q) {
        const progress = StorageService.getProgress().progress[String(q?.id)] || {};
        const annotation = StorageService.getAnnotation(q?.id).content || '';
        return {
            id: q?.id,
            category_path: q?.category_path || UIRenderer.chapterLabel?.(q) || '',
            source: q?.source || '',
            type: q?.type || '',
            stem: q?.stem || q?.question || '',
            options: q?.options || [],
            answer: q?.answer || '',
            explanation: q?.explanation || '',
            userAnswer: AppState.answers?.[String(q?.id)] ? [...AppState.answers[String(q?.id)]].join(', ') : '',
            annotation,
            mastery: progress.mastery || 'not_started',
            errorProne: progress.error_prone === true,
            favorite: StorageService.isFavorite(q?.id),
        };
    }

    // 视觉档案才附带题目图片（≤4 张、每张 ≤2MB，dataURL）
    static async questionImages(q) {
        if (!q) return [];
        const source = `${q.stem || q.question || ''}\n${(q.options || []).map(o => o.content_md || '').join('\n')}\n${q.answer || ''}\n${q.explanation || ''}`;
        const refs = [...source.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1] || m[2]).filter(Boolean).slice(0, 4);
        const out = [];
        for (const ref of refs) {
            try {
                const response = await fetch(new URL(assetUrl(ref), location.href));
                if (!response.ok) continue;
                const blob = await response.blob();
                if (blob.size > 2 * 1024 * 1024) continue;
                const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(''); reader.readAsDataURL(blob); });
                if (data) out.push(data);
            } catch {}
        }
        return out;
    }

    // 按题隔离的聊天历史（保存在本地中控台，按 profile+question 分键）
    static async loadHistory(question) {
        if (!question || !AppState.aiProfileId) return [];
        try {
            const response = await fetch(`./api/ai/conversations/${encodeURIComponent(AppState.aiProfileId)}/${encodeURIComponent(String(question.id))}`, { cache: 'no-store' });
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.messages) ? data.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant')) : [];
        } catch { return []; }
    }
}

// ========== 应用控制器 ==========
class App {
    static async init() {
        console.log('大观园新版 - 初始化');

        AppState.shortcuts = { ...SHORTCUT_DEFAULTS };
        try { AppState.shortcuts = { ...AppState.shortcuts, ...(JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || '{}') || {}) }; } catch {}
        if (!AppState.shortcuts.answer || ['Space', 'Spacebar'].includes(AppState.shortcuts.answer)) AppState.shortcuts.answer = ' ';

        this.bindImageZoom();
        UIRenderer.applySavedAppearance();

        // 加载数据（目录/题目映射 + 搜索索引 + 视频映射）
        await Promise.all([
            DataService.loadAll(),
            DataService.loadSearchIndex(),
            DataService.loadVideoMappings()
        ]);

        // 绑定导航
        this.bindNavigation();
        this.bindKeyboardShortcuts();

        // 检查版本偏好
        const urlParams = new URLSearchParams(window.location.search);
        const uiParam = urlParams.get('ui');

        if (uiParam === 'old') {
            StorageService.saveVersionPreference('old');
            window.location.href = './legacy.html';
            return;
        } else if (uiParam === 'new') {
            StorageService.saveVersionPreference('new');
        }

        // 旧版草稿/外观键迁移（只填空白目标键，幂等）
        StorageService.migrateLegacyKeys();

        // 预览权限与共享学习数据（服务端为权威源；预览锁定时保持只读）
        await PreviewAccess.hydrate();
        await StateSync.hydrate();
        StateSync.connectEvents();
        AIService.loadProfiles();

        // 渲染首页
        this.showHome();

        // 从旧版切换而来：恢复同一道题（服务端 last-study；离线时回退 sessionStorage 旧版形状位置）
        if (urlParams.get('uiSwitch') === '1' && PreviewAccess.privateAllowed(false)) {
            let restored = await this.restoreFromServerPosition();
            if (!restored) restored = await this.restoreFromSessionPosition();
            if (restored && sessionStorage.getItem('daguan_switch_ai_open') === '1') {
                sessionStorage.removeItem('daguan_switch_ai_open');
                this.toggleAI();
            } else {
                sessionStorage.removeItem('daguan_switch_ai_open');
            }
        }

        // 绑定窗口事件
        window.addEventListener('resize', () => this.handleResize());

        console.log('初始化完成');
    }

    // 旧版切换过来后按服务端 last_study 打开同一道题；失败静默回到首页。
    static async restoreFromServerPosition() {
        try {
            const response = await fetch('./api/state', { cache: 'no-store' });
            if (!response.ok) return false;
            const remote = await response.json();
            const lastStudy = remote?.last_study;
            if (!lastStudy || lastStudy.category_id == null || lastStudy.question_id == null) return false;
            return await this.openResolvedPosition(lastStudy.category_id, lastStudy.question_id);
        } catch { return false; }
    }

    // 离线回退：旧版写在 sessionStorage 的位置（同标签页切换时可直接恢复同题）
    static async restoreFromSessionPosition() {
        try {
            const saved = JSON.parse(sessionStorage.getItem('daguan_learning_position_v2') || 'null');
            if (!saved || saved.view !== 'browse' || saved.cat == null) return false;
            const questionId = saved.question != null ? String(saved.question) : null;
            if (questionId == null) return false;
            return await this.openResolvedPosition(saved.cat, questionId);
        } catch { return false; }
    }

    static async openResolvedPosition(categoryId, questionId) {
        const resolved = resolveChapterForQuestion(categoryId, questionId);
        if (!resolved) return false;
        AppState.currentCategory = resolved.top;
        const index = DataService.chapterEntries(resolved.leaf).findIndex(q => String(q.id) === String(questionId));
        if (index < 0) return false;
        await App.enterChapterQuestions(resolved.leaf, index, questionId, App.preferredQuestionMode());
        return AppState.currentView === 'question';
    }

    static bindImageZoom() {
        document.addEventListener('click', event => {
            const image = event.target.closest?.('.question-content img');
            if (image) this.openImageZoom(image);
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const image = event.target.closest?.('.question-content img');
            if (!image) return;
            event.preventDefault();
            this.openImageZoom(image);
        });
    }

    static openImageZoom(source) {
        let dialog = document.getElementById('question-image-zoom');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'question-image-zoom';
            dialog.className = 'question-image-zoom';
            const header = document.createElement('div');
            header.className = 'image-zoom-header';
            const title = document.createElement('strong');
            title.textContent = '题目图片';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'btn btn-text';
            close.textContent = '关闭';
            close.addEventListener('click', () => dialog.close());
            header.append(title, close);
            const stage = document.createElement('div');
            stage.className = 'image-zoom-stage';
            const image = document.createElement('img');
            image.alt = '放大的题目图片';
            stage.append(image);
            dialog.append(header, stage);
            document.body.append(dialog);
        }
        dialog.querySelector('img').src = source.currentSrc || source.src;
        dialog.showModal();
    }

    static showShortcutHelp() {
        let dialog = document.getElementById('shortcut-help-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'shortcut-help-dialog';
            dialog.className = 'shortcut-help-dialog';
            document.body.append(dialog);
        }
        const fixed = [['/', '搜索题目'], ['M', '切换单题 / 多题'], ['J / K', '多题模式定位上一题 / 下一题'], ['G', '按题号跳转'], ['Alt + 1–4', '选择 A–D 选项']];
        dialog.innerHTML = `<div class="shortcut-help-head"><h2>快捷键</h2><button type="button" class="btn btn-text" data-close>关闭</button></div><dl>${fixed.map(([key, label]) => `<div><dt><kbd>${key}</kbd></dt><dd>${label}</dd></div>`).join('')}${Object.entries(SHORTCUT_LABELS).map(([action, label]) => `<div><dt><kbd>${escapeHtml(this.shortcutLabel(AppState.shortcuts[action]))}</kbd></dt><dd>${escapeHtml(label)}</dd></div>`).join('')}</dl><p class="text-helper">输入框、批注与 AI 编辑区聚焦时，练习快捷键会暂停。</p>`;
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, { once: true });
        if (!dialog.open) dialog.showModal();
    }

    static shortcutLabel(key) {
        if (!key) return '未设置';
        if (key === ' ') return '空格';
        return ({ ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' })[key] || String(key).toUpperCase();
    }

    static refreshShortcutHints(root = document) {
        const fixed = { mode: 'M', jump: 'G', multiPrev: 'K', multiNext: 'J' };
        root.querySelectorAll('[data-shortcut-hint]').forEach(button => {
            const action = button.dataset.shortcutHint;
            const keys = action === 'mastery'
                ? ['mastery1', 'mastery2', 'mastery3'].map(name => AppState.shortcuts[name]).filter(Boolean)
                : [fixed[action] || AppState.shortcuts[action]].filter(Boolean);
            let badge = button.querySelector(':scope > .button-shortcut');
            if (!keys.length) {
                badge?.remove();
                button.removeAttribute('aria-keyshortcuts');
                return;
            }
            if (!badge) {
                badge = document.createElement('kbd');
                badge.className = 'button-shortcut';
                badge.setAttribute('aria-hidden', 'true');
                button.appendChild(badge);
            }
            badge.textContent = keys.map(key => this.shortcutLabel(key)).join('·');
            button.setAttribute('aria-keyshortcuts', keys.map(key => key === ' ' ? 'Space' : key).join(' '));
        });
    }

    static promptJumpToQuestion() {
        if (AppState.currentView !== 'question') return;
        const value = prompt('跳转到题号或章节题序：');
        if (value) this.jumpByQuestionNumber(value);
    }

    static renderShortcutSettings() {
        const root = document.getElementById('shortcut-list');
        if (!root) return;
        root.innerHTML = Object.entries(SHORTCUT_LABELS).map(([action, label]) => `<label class="shortcut-row"><span>${escapeHtml(label)}</span><button type="button" class="shortcut-key" data-shortcut-action="${action}" aria-label="${escapeHtml(label)}快捷键">${escapeHtml(this.shortcutLabel(AppState.shortcuts[action]))}</button></label>`).join('');
        root.querySelectorAll('[data-shortcut-action]').forEach(button => {
            button.addEventListener('keydown', event => {
                event.preventDefault();
                if (['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
                const action = button.dataset.shortcutAction;
                const next = event.key === 'Unidentified' ? SHORTCUT_CODE_FALLBACK[event.code] || event.code : event.key;
                const duplicate = Object.entries(AppState.shortcuts).find(([name, value]) => name !== action && String(value).toLocaleLowerCase() === String(next).toLocaleLowerCase());
                if (duplicate || RESERVED_SHORTCUTS.has(String(next).toLocaleLowerCase())) {
                    const message = duplicate ? `按键 ${this.shortcutLabel(next)} 已被“${SHORTCUT_LABELS[duplicate[0]]}”占用。` : `按键 ${this.shortcutLabel(next)} 已由搜索或题目导航占用。`;
                    document.getElementById('shortcut-feedback').textContent = message;
                    return;
                }
                AppState.shortcuts[action] = next;
                localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(AppState.shortcuts));
                document.getElementById('shortcut-feedback').textContent = `已绑定：${SHORTCUT_LABELS[action]} → ${this.shortcutLabel(next)}`;
                this.renderShortcutSettings();
                root.querySelector(`[data-shortcut-action="${action}"]`)?.focus();
            });
        });
        const feedback = document.getElementById('shortcut-feedback');
        const conflicts = this.shortcutConflicts();
        if (feedback && !feedback.textContent && conflicts.length) feedback.textContent = `现有旧版配置有按键冲突：${conflicts.join('、')}。修改对应按键即可解决。`;
    }

    static shortcutConflicts() {
        const conflicts = [];
        const seen = new Map();
        for (const [action, value] of Object.entries(AppState.shortcuts)) {
            if (!value) continue;
            const normalized = String(value).toLocaleLowerCase();
            if (RESERVED_SHORTCUTS.has(normalized)) conflicts.push(`${SHORTCUT_LABELS[action]} 与固定键 ${this.shortcutLabel(value)}`);
            if (seen.has(normalized)) conflicts.push(`${SHORTCUT_LABELS[action]} 与 ${SHORTCUT_LABELS[seen.get(normalized)]}`);
            else seen.set(normalized, action);
        }
        return conflicts;
    }

    static resetShortcuts() {
        AppState.shortcuts = { ...SHORTCUT_DEFAULTS };
        localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(AppState.shortcuts));
        document.getElementById('shortcut-feedback').textContent = '已恢复旧版默认快捷键。';
        this.renderShortcutSettings();
    }

    static bindKeyboardShortcuts() {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && AppState.ui.navOpen) {
                event.preventDefault();
                this.toggleNav();
                document.getElementById('btn-toggle-nav')?.focus();
                return;
            }
            const target = event.target;
            const editing = target?.closest?.('input, textarea, select, [contenteditable="true"], .annotation-panel, .ai-panel, .shortcut-settings-card') || target?.isContentEditable;
            if (editing || event.ctrlKey || event.metaKey) return;
            const pressed = event.key && event.key !== 'Unidentified' ? event.key : SHORTCUT_CODE_FALLBACK[event.code] || event.code || '';
            if (pressed === '/' && !event.altKey && !event.shiftKey) { event.preventDefault(); this.openGlobalSearch(); return; }
            if (pressed.toLowerCase() === 'm' && !event.altKey && AppState.currentView === 'question') { event.preventDefault(); this.changeQuestionMode(AppState.questionMode === 'single' ? 'multi' : 'single'); return; }
            if (AppState.currentView !== 'question') return;
            if (AppState.questionMode === 'multi' && ['j', 'k'].includes(pressed.toLowerCase())) {
                event.preventDefault(); const delta = pressed.toLowerCase() === 'j' ? 1 : -1; this.goToChapterQuestion((AppState.questionOffset || 0) + AppState.currentQuestionIndex + delta); return;
            }
            if (pressed.toLowerCase() === 'g' && !event.altKey) {
                event.preventDefault(); this.promptJumpToQuestion(); return;
            }
            const q = AppState.questions[AppState.currentQuestionIndex];
            if (event.altKey && /^[1-4]$/.test(pressed)) {
                event.preventDefault(); const index = Number(pressed) - 1;
                if (AppState.questionMode === 'multi') this.selectQuestionOption(q?.id, index, document.querySelector(`#multi-question-${AppState.questionOffset + AppState.currentQuestionIndex} .option-item:nth-child(${index + 1})`));
                else this.selectOption(index);
                return;
            }
            const key = pressed === 'Space' || pressed === 'Spacebar' ? ' ' : pressed;
            const action = Object.entries(AppState.shortcuts).find(([, binding]) => binding && (String(binding) === key || String(binding).toLowerCase() === key.toLowerCase()))?.[0];
            if (!action) return;
            event.preventDefault();
            if (action === 'up') { this.previousQuestion(); return; }
            if (action === 'down') { this.nextQuestion(); return; }
            if (action === 'answer') { if (AppState.questionMode === 'multi') this.toggleCardAnswer(AppState.questionOffset + AppState.currentQuestionIndex, document.querySelector(`#multi-question-${AppState.questionOffset + AppState.currentQuestionIndex} .expand-answer-btn`)); else this.toggleAnswer(); return; }
            if (action.startsWith('mastery')) { this.setQuestionMastery(q?.id, ({ mastery1: 'not_started', mastery2: 'learning', mastery3: 'mastered' })[action]); return; }
            if (action === 'favorite') { this.toggleQuestionFavorite(q?.id); return; }
            if (action === 'error') { this.toggleQuestionMistake(q?.id); return; }
            if (action === 'ai') { this.toggleAI(); return; }
            if (action === 'note') { this.toggleAnnotation(); return; }
            if (action === 'help') { this.showShortcutHelp(); return; }
            if (action === 'escape') { if (AppState.ui.aiPanelOpen) this.toggleAI(); else if (AppState.ui.annotationPanelOpen) this.toggleAnnotation(); return; }
            if (action === 'focus') { document.body.classList.toggle('question-focus-mode'); return; }
            if (action === 'copy' && q) { navigator.clipboard?.writeText(`# 题号 ${q.id}\n\n${q.stem || ''}\n\n答案：${q.answer || ''}`).then(() => toast('已复制本题 Markdown')).catch(() => toast('复制失败')); }
        });
    }

    static bindNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                if (view) this.navigate(view);
            });
        });
    }

    static async navigate(view) {
        // 手机端抽屉导航：选择页面后自动关闭
        if (AppState.ui.navOpen) this.toggleNav();
        if (AppState.currentView === 'library') UIRenderer.saveDirectoryState();

        // 重复点击当前页面不重绘（复习页切标签由 showReview 直接刷新）
        if (AppState.currentView === view) return;

        // 离开做题/笔记页前保存未提交的编辑；失败留在当前页
        if (AppState.currentView === 'question' || AppState.currentView === 'notes') {
            try {
                if (AppState.currentView === 'question') {
                    const question = AppState.questions[AppState.currentQuestionIndex];
                    const input = document.getElementById('ai-input');
                    if (question && input) StorageService.saveAIDraft(question.id, input.value);
                    await this.flushAnnotationNow();
                }
                if (AppState.currentView === 'notes') await this.saveMemoNow();
                if (PreviewAccess.privateAllowed(false)) await StateSync.ensureFlushed();
            } catch (error) {
                toast(`内容尚未保存：${error.message || '保存失败，请重试'}`);
                return;
            }
            if (AppState.currentView === 'question') {
                // AI 生成中离开做题页：先确认，拒绝则留在原地继续生成
                if (AppState.aiBusy) {
                    if (!confirm('AI 正在生成。离开当前页面会结束本次生成，是否继续？')) {
                        toast('已留在当前页，AI 生成继续');
                        return;
                    }
                }
                this.abortAIStream();
            }
        }

        AppState.currentView = view;

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        switch (view) {
            case 'home':
                this.showHome();
                break;
            case 'library':
                this.showLibrary();
                break;
            case 'review':
                UIRenderer.renderReview(AppState.reviewTab || 'mistakes');
                break;
            case 'notes':
                UIRenderer.renderNotes();
                break;
            case 'records':
                UIRenderer.renderRecords();
                break;
            case 'tools':
                UIRenderer.renderTools();
                break;
            case 'settings':
                this.showSettings();
                break;
            default:
                this.showHome();
        }
    }

    static showHome() {
        AppState.currentView = 'home';
        UIRenderer.renderHome();
    }

    static normalizeSearchText(value) {
        return String(value || '').normalize('NFKC').toLocaleLowerCase()
            .replace(/\\(?:left|right)\b/g, '').replace(/\\(?:dfrac|tfrac)\b/g, '\\frac')
            .replace(/\\(?:cdot|times)\b/g, '*').replace(/\\(?:leq|le)\b/g, '<=')
            .replace(/\\(?:geq|ge)\b/g, '>=').replace(/\\(?:neq|ne)\b/g, '!=')
            .replace(/[×·]/g, '*').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
            .replace(/[{}\\$\s]/g, '').replace(/[，。；：、]/g, '');
    }

    static async openGlobalSearch() {
        if (AppState.currentView === 'question') {
            if (!await this.ensureSavedBeforeLeavingQuestion()) return;
        }
        if (AppState.currentView === 'question') {
            const q = AppState.questions[AppState.currentQuestionIndex];
            AppState.globalSearchReturn = q ? { categoryId: AppState.currentCategory?.id, questionId: String(q.id) } : null;
        } else if (AppState.currentView !== 'global-search') AppState.globalSearchReturn = { view: AppState.currentView };
        if (AppState.currentView !== 'global-search') AppState.globalSearchContext = {
            categoryId: ['library', 'question'].includes(AppState.currentView) ? AppState.currentCategory?.id || null : null,
            chapterId: AppState.currentView === 'question' ? AppState.currentChapter?.id || null : AppState.currentView === 'library' ? AppState.directoryNodeId || null : null,
        };
        if (AppState.globalSearchScope === 'chapter' && !AppState.globalSearchContext?.chapterId) AppState.globalSearchScope = 'all';
        if (AppState.globalSearchScope === 'subject' && !AppState.globalSearchContext?.categoryId) AppState.globalSearchScope = 'all';
        if (AppState.currentView === 'question') this.abortAIStream();
        AppState.currentView = 'global-search';
        AppState.globalSearchScrollTop = 0;
        this.renderGlobalSearch();
        requestAnimationFrame(() => document.getElementById('global-search-input')?.focus());
    }

    static renderGlobalSearch() {
        const main = document.getElementById('app-main');
        if (!main) return;
        const chapterScopeAllowed = !!AppState.globalSearchContext?.chapterId;
        main.innerHTML = `<section class="global-search-page"><div class="global-search-heading"><div><p class="eyebrow">题库 · 本机索引</p><h1>搜索题目</h1><p class="text-helper">搜索 6,342 道题的题号、题干、来源和章节路径。</p></div>${AppState.globalSearchReturn ? `<button class="btn btn-secondary" type="button" onclick="App.returnToGlobalSearchOrigin()">${AppState.globalSearchReturn.questionId ? '返回原题' : '返回上一页'}</button>` : ''}</div><div class="global-search-controls"><input id="global-search-input" type="search" autocomplete="off" placeholder="题号、关键词或公式，例如 x^2" value="${escapeHtml(AppState.globalSearchQuery)}"><select id="global-search-scope" aria-label="搜索范围"><option value="all" ${AppState.globalSearchScope === 'all' ? 'selected' : ''}>全部题库</option><option value="subject" ${AppState.globalSearchScope === 'subject' ? 'selected' : ''} ${AppState.globalSearchContext?.categoryId ? '' : 'disabled'}>当前科目</option><option value="chapter" ${AppState.globalSearchScope === 'chapter' ? 'selected' : ''} ${chapterScopeAllowed ? '' : 'disabled'}>当前章节</option></select><button class="btn btn-primary" type="button" id="global-search-submit">搜索</button></div><div id="global-search-results" aria-live="polite"></div></section>`;
        const input = document.getElementById('global-search-input');
        input.addEventListener('input', () => { AppState.globalSearchQuery = input.value; clearTimeout(this._globalSearchTimer); this._globalSearchTimer = setTimeout(() => this.updateGlobalSearchResults(), 120); });
        document.getElementById('global-search-scope').addEventListener('change', event => { AppState.globalSearchScope = event.target.value; this.updateGlobalSearchResults(); });
        document.getElementById('global-search-submit').addEventListener('click', () => this.updateGlobalSearchResults());
        input.addEventListener('keydown', event => { if (event.key === 'Enter') this.updateGlobalSearchResults(); });
        this.updateGlobalSearchResults();
        if (AppState.globalSearchScrollTop) document.getElementById('global-search-results').scrollTop = AppState.globalSearchScrollTop;
    }

    static updateGlobalSearchResults() {
        const host = document.getElementById('global-search-results');
        if (!host) return;
        const query = this.normalizeSearchText(AppState.globalSearchQuery.trim());
        if (!query) { host.innerHTML = '<p class="search-empty-hint">输入关键词开始搜索。可使用 x^2、\\frac{a}{b} 等常见公式写法。</p>'; return; }
        const searchCategory = (AppState.categories?.categories || []).find(item => String(item.id) === String(AppState.globalSearchContext?.categoryId));
        const searchChapter = searchCategory && UIRenderer.findNodeById(searchCategory, AppState.globalSearchContext?.chapterId);
        const currentPath = searchCategory && searchChapter ? UIRenderer.pathToNode(searchCategory, searchChapter.id).map(node => node.name || node.title).filter(Boolean).join(' / ') : '';
        const subjectName = searchCategory?.name || '';
        const rows = AppState.searchIndex || [];
        const matches = [];
        for (const row of rows) {
            const path = String(row.path || '');
            if (AppState.globalSearchScope === 'subject' && (!subjectName || (path !== subjectName && !path.startsWith(`${subjectName} /`)))) continue;
            if (AppState.globalSearchScope === 'chapter' && (!currentPath || (path !== currentPath && !path.startsWith(`${currentPath} /`)))) continue;
            const indexed = row._searchText || (row._searchText = this.normalizeSearchText(`${row.id} ${row.stem || ''} ${row.source || ''} ${path}`));
            if (indexed.includes(query)) matches.push(row);
        }
        AppState.globalSearchRows = matches;
        AppState.globalSearchLimit = 40;
        host.innerHTML = `<p class="search-result-summary">找到 ${matches.length} 道题${matches.length ? ' · 按题号排序' : ''}</p>${matches.length ? `<div class="global-search-results-list">${matches.slice(0, AppState.globalSearchLimit).map(row => `<button type="button" class="global-search-result" data-question-id="${escapeHtml(String(row.id))}"><span class="search-result-meta">题号 ${escapeHtml(String(row.id))} · ${escapeHtml(row.source || '未标注来源')}</span><span class="global-search-path">${escapeHtml(row.path || '')}</span>${renderSearchResultStem(row.stem || '')}</button>`).join('')}</div>${matches.length > AppState.globalSearchLimit ? '<button class="btn btn-secondary search-more" id="global-search-more">加载更多</button>' : ''}` : '<p class="search-empty-hint">没有找到匹配题目。</p>'}`;
        host.querySelectorAll('[data-question-id]').forEach(button => button.addEventListener('click', () => this.openGlobalSearchResult(button.dataset.questionId)));
        host.onscroll = () => { AppState.globalSearchScrollTop = host.scrollTop; };
        host.querySelector('#global-search-more')?.addEventListener('click', () => { AppState.globalSearchLimit += 40; this.renderGlobalSearchResultsOnly(); });
    }

    static renderGlobalSearchResultsOnly() {
        const host = document.getElementById('global-search-results');
        if (!host) return;
        const rows = AppState.globalSearchRows;
        host.innerHTML = `<p class="search-result-summary">找到 ${rows.length} 道题 · 已显示 ${Math.min(rows.length, AppState.globalSearchLimit)}</p><div class="global-search-results-list">${rows.slice(0, AppState.globalSearchLimit).map(row => `<button type="button" class="global-search-result" data-question-id="${escapeHtml(String(row.id))}"><span class="search-result-meta">题号 ${escapeHtml(String(row.id))} · ${escapeHtml(row.source || '未标注来源')}</span><span class="global-search-path">${escapeHtml(row.path || '')}</span>${renderSearchResultStem(row.stem || '')}</button>`).join('')}</div>${rows.length > AppState.globalSearchLimit ? '<button class="btn btn-secondary search-more" id="global-search-more">加载更多</button>' : ''}`;
        host.querySelectorAll('[data-question-id]').forEach(button => button.addEventListener('click', () => this.openGlobalSearchResult(button.dataset.questionId)));
        host.onscroll = () => { AppState.globalSearchScrollTop = host.scrollTop; };
        host.querySelector('#global-search-more')?.addEventListener('click', () => { AppState.globalSearchLimit += 40; this.renderGlobalSearchResultsOnly(); });
    }

    static async openGlobalSearchResult(questionId) {
        const row = (AppState.searchIndex || []).find(item => String(item.id) === String(questionId));
        if (!row) return;
        const category = (AppState.categories?.categories || []).find(item => row.path?.startsWith(item.name));
        const resolved = category && this.resolveSearchChapter(category, questionId);
        if (!resolved) { toast('题目章节暂时无法定位'); return; }
        AppState.currentCategory = resolved.top;
        const index = DataService.chapterEntries(resolved.leaf).findIndex(item => String(item.id) === String(questionId));
        if (index < 0) { toast('题目暂时无法加载'); return; }
        await this.enterChapterQuestions(resolved.leaf, index, questionId, 'single');
    }

    static resolveSearchChapter(top, questionId) {
        const visit = node => {
            if ((node.direct_questions || []).some(item => String(item.id) === String(questionId))) return node;
            for (const child of node.children || []) {
                const found = visit(child);
                if (found) return found;
            }
            if (!(node.children || []).length && (node.questions || []).some(item => String(item.id) === String(questionId))) return node;
            return null;
        };
        const chapter = visit(top);
        return chapter ? { top, leaf: chapter } : null;
    }

    static async returnToGlobalSearch() {
        if (AppState.currentView === 'question' && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.currentView = 'global-search';
        this.renderGlobalSearch();
        requestAnimationFrame(() => {
            const host = document.getElementById('global-search-results');
            if (host) host.scrollTop = AppState.globalSearchScrollTop;
            document.getElementById('global-search-input')?.focus();
        });
    }

    static async returnToGlobalSearchOrigin() {
        const target = AppState.globalSearchReturn;
        if (!target?.questionId) return;
        if (AppState.currentView === 'question' && !await this.ensureSavedBeforeLeavingQuestion()) return;
        const top = (AppState.categories?.categories || []).find(item => String(item.id) === String(target.categoryId));
        const resolved = top && this.resolveSearchChapter(top, target.questionId);
        if (!resolved) return;
        AppState.currentCategory = resolved.top;
        const index = DataService.chapterEntries(resolved.leaf).findIndex(item => String(item.id) === String(target.questionId));
        await this.enterChapterQuestions(resolved.leaf, Math.max(index, 0), target.questionId, 'single');
    }

    static showLibrary(categoryId = null) {
        if (AppState.currentView === 'library') UIRenderer.saveDirectoryState();
        const saved = UIRenderer.readDirectoryState();
        if (!categoryId) categoryId = AppState.currentCategory?.id || saved.lastCategory || AppState.categories?.categories?.[0]?.id;
        if (categoryId == null) return;
        AppState.currentCategory = UIRenderer.findCategoryById(categoryId);
        AppState.catalogExpandedId = String(AppState.currentCategory?.id ?? categoryId);
        AppState.currentView = 'library';
        UIRenderer.renderLibrary(categoryId);
    }

    static toggleCatalogSubject(subjectId) {
        if (String(AppState.catalogExpandedId) === String(subjectId)) AppState.catalogExpandedId = null;
        else AppState.catalogExpandedId = String(subjectId);
        UIRenderer.renderLibraryTree(AppState.currentCategory);
    }

    static async selectFirstLevel(subject, chapter) {
        AppState.currentCategory = subject;
        AppState.directoryNodeId = String(chapter.id);
        AppState.libraryScrollTop = 0;
        AppState.currentView = 'library';
        UIRenderer.saveDirectoryState();
        if (chapter.children?.length) {
            UIRenderer.renderLibrary(subject.id);
            this.openChapterPicker(subject.id, chapter.id);
        } else await this.showChapter(chapter);
    }

    static openChapterPicker(categoryId = null, nodeId = null) {
        const category = UIRenderer.findCategoryById(categoryId || AppState.currentCategory?.id || AppState.currentChapter?.id);
        if (!category) return;
        let path = [];
        if (nodeId != null) path = UIRenderer.pathToNode(category, nodeId) || [];
        else if (AppState.currentView === 'question' && AppState.currentChapter && String(AppState.currentCategory?.id) === String(category.id)) path = UIRenderer.pathToNode(category, AppState.currentChapter.id) || [];
        else if (AppState.directoryNodeId != null) path = UIRenderer.pathToNode(category, AppState.directoryNodeId) || [];
        else if (AppState.currentChapter && String(AppState.currentCategory?.id) === String(category.id)) path = UIRenderer.pathToNode(category, AppState.currentChapter.id) || [];
        AppState.currentCategory = category;
        AppState.chapterPickerPath = path.map(node => String(node.id));
        AppState.chapterPickerOpener = document.activeElement;
        if (!document.getElementById('chapter-picker')) {
            const host = document.createElement('div');
            host.id = 'chapter-picker';
            document.body.appendChild(host);
        }
        UIRenderer.renderChapterPicker();
        document.getElementById('chapter-picker')?.classList.add('open');
    }

    static closeChapterPicker() {
        document.getElementById('chapter-picker')?.classList.remove('open');
        const restore = AppState.chapterPickerOpener?.isConnected
            ? AppState.chapterPickerOpener
            : document.querySelector('[data-open-chapter-picker]');
        restore?.focus();
        AppState.chapterPickerOpener = null;
    }

    static async selectPickerNode(nodeId, depth) {
        AppState.chapterPickerPath = AppState.chapterPickerPath.slice(0, depth).concat(String(nodeId));
        const category = AppState.currentCategory;
        const path = UIRenderer.pathToNode(category, nodeId) || [];
        const node = path.at(-1);
        if (!node) return;
        if (node.children?.length) { UIRenderer.renderChapterPicker(); return; }
        this.closeChapterPicker();
        await this.showChapter(node);
    }

    static async startDirectFromPicker(nodeId) {
        const node = UIRenderer.findNodeById(AppState.currentCategory, nodeId);
        if (!node) return;
        this.closeChapterPicker();
        await this.showChapter(node, { directOnly: true });
    }

    static async changeChapterScope(scope) {
        if (!['all', 'core', 'real'].includes(scope) || scope === AppState.chapterScope) return;
        const previous = AppState.chapterScope;
        const current = AppState.questions?.[AppState.currentQuestionIndex];
        if (AppState.currentView === 'question' && AppState.currentChapter && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.chapterScope = scope;
        document.querySelectorAll('[data-chapter-scope]').forEach(button => {
            const active = button.dataset.chapterScope === scope;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        if (AppState.currentView === 'question' && AppState.currentChapter) {
            const original = UIRenderer.findNodeById(AppState.currentCategory, AppState.currentChapter.id);
            if (!original) return;
            const directOnly = AppState.currentChapter._directOnly === true;
            const queueChapter = await UIRenderer.filteredChapter(original, directOnly);
            if (!DataService.chapterEntries(queueChapter).length) {
                AppState.chapterScope = previous;
                document.querySelectorAll('[data-chapter-scope]').forEach(button => {
                    const active = button.dataset.chapterScope === previous;
                    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
                });
                toast('当前章节在该范围内没有题目，范围保持不变');
                return;
            }
            queueChapter._directOnly = directOnly;
            const entries = DataService.chapterEntries(queueChapter);
            const index = current ? entries.findIndex(entry => String(entry.id) === String(current.id)) : 0;
            const target = index >= 0 ? index : Math.min(AppState.questionOffset + AppState.currentQuestionIndex, entries.length - 1);
            await this.enterChapterQuestions(queueChapter, target, index >= 0 ? current?.id : null, AppState.questionMode);
        }
        const picker = document.getElementById('chapter-picker');
        if (picker?.classList.contains('open')) UIRenderer.renderChapterPicker();
    }

    static openDirectoryNode(nodeId) {
        const category = AppState.currentCategory;
        const node = category && UIRenderer.findNodeById(category, nodeId);
        if (!node) return;
        AppState.directoryNodeId = String(node.id);
        AppState.libraryScrollTop = 0;
        UIRenderer.saveDirectoryState();
        UIRenderer.renderLibrary(category.id);
    }

    static directoryUp() {
        const path = UIRenderer.pathToNode(AppState.currentCategory, AppState.directoryNodeId) || [];
        if (path.length > 1) this.openDirectoryNode(path[path.length - 2].id);
    }

    static async continueDirectoryNode(node) {
        const position = StorageService.getLearningPosition();
        if (!position || String(position.categoryId) !== String(AppState.currentCategory?.id) || String(position.chapterId) !== String(node.id)) return;
        AppState.currentChapter = node;
        const entries = DataService.chapterEntries(node);
        const index = position.questionId != null ? entries.findIndex(e => String(e.id) === String(position.questionId)) : Number(position.questionIndex) || 0;
        await this.enterChapterQuestions(node, Math.max(0, index), position.questionId, this.preferredQuestionMode());
    }

    static preferredQuestionMode() {
        try { return localStorage.getItem('daguan_new_question_mode_v1') === 'multi' ? 'multi' : 'single'; }
        catch { return 'single'; }
    }

    static async enterChapterQuestions(chapter, index = 0, questionId = null, mode = 'single') {
        const directOnly = chapter?._directOnly === true;
        chapter = await UIRenderer.filteredChapter(chapter, directOnly);
        chapter._directOnly = directOnly;
        const entries = DataService.chapterEntries(chapter);
        if (!entries.length) {
            toast('当前题库范围下没有可用题目');
            return;
        }
        AppState.currentChapter = chapter;
        AppState.chapterQuestionCount = entries.length;
        AppState.questionMode = mode === 'multi' ? 'multi' : 'single';
        AppState.currentView = 'question';
        try {
            if (AppState.questionMode === 'multi') {
                const start = Math.floor(index / 20) * 20;
                await UIRenderer.renderMultiRange(start, questionId);
            } else {
                const questions = await DataService.loadQuestionsForChapter(chapter);
                if (!questions.length) throw new Error('题目暂时无法加载');
                AppState.questions = questions; AppState.questionOffset = 0;
                const resolved = questionId == null ? index : questions.findIndex(q => String(q.id) === String(questionId));
                await UIRenderer.renderQuestion(Math.min(Math.max(resolved, 0), questions.length - 1));
            }
        } catch (error) {
            AppState.currentView = 'library';
            toast(`题目暂时无法加载：${error.message || '请重试'}`);
        }
    }

    static async changeQuestionMode(mode) {
        if (!['single', 'multi'].includes(mode) || !AppState.currentChapter) return;
        if (mode === AppState.questionMode && AppState.modeSwitchTarget == null) return;
        const token = ++AppState.modeSwitchToken;
        AppState.modeSwitchTarget = mode;
        if (mode === AppState.questionMode) { AppState.modeSwitchTarget = null; return; }
        const previousMode = AppState.questionMode;
        const current = AppState.questions[AppState.currentQuestionIndex];
        const id = current?.id;
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const index = id == null ? 0 : entries.findIndex(e => String(e.id) === String(id));
        const saved = await this.ensureSavedBeforeLeavingQuestion();
        if (!saved || token !== AppState.modeSwitchToken) {
            if (token === AppState.modeSwitchToken) AppState.modeSwitchTarget = null;
            return;
        }
        try {
            if (mode === 'multi') {
                AppState.questionMode = 'multi';
                await UIRenderer.renderMultiRange(Math.floor(Math.max(index, 0) / 20) * 20, id, token);
            } else {
                const questions = await DataService.loadQuestionsForChapter(AppState.currentChapter);
                if (token !== AppState.modeSwitchToken) return;
                if (!questions.length) throw new Error('题目暂时无法加载');
                AppState.questions = questions; AppState.questionOffset = 0;
                const targetIndex = id == null ? Math.max(index, 0) : questions.findIndex(q => String(q.id) === String(id));
                AppState.questionMode = 'single';
                await UIRenderer.renderQuestion(Math.max(0, targetIndex));
            }
            if (token !== AppState.modeSwitchToken) return;
            AppState.questionMode = mode;
            AppState.modeSwitchTarget = null;
            localStorage.setItem('daguan_new_question_mode_v1', mode);
            const selected = AppState.questions[AppState.currentQuestionIndex];
            if (selected) StorageService.saveLearningPosition(AppState.currentCategory.id, AppState.currentChapter.id, AppState.questionOffset + AppState.currentQuestionIndex, selected.id, mode);
        } catch (error) {
            if (token !== AppState.modeSwitchToken) return;
            AppState.questionMode = previousMode;
            AppState.modeSwitchTarget = null;
            toast(`切换模式失败，仍在${previousMode === 'single' ? '单题' : '多题'}模式：${error.message || '请重试'}`);
        }
    }

    static async goToChapterQuestion(index) {
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const target = Math.max(0, Math.min(entries.length - 1, Number(index) || 0));
        if (!await this.ensureSavedBeforeLeavingQuestion()) return;
        const segmentStart = Math.floor(target / 20) * 20;
        const previousQuestions = AppState.questions;
        const previousOffset = AppState.questionOffset;
        try {
            if (segmentStart !== previousOffset) await UIRenderer.renderMultiRange(segmentStart, entries[target].id);
            else {
                const local = target - segmentStart;
                AppState.currentQuestionIndex = local;
                document.querySelectorAll('.question-rail-item').forEach(button => button.classList.toggle('current', button.getAttribute('onclick') === `App.goToChapterQuestion(${target})`));
                document.querySelectorAll('.multi-question-card').forEach((card, index) => card.classList.toggle('active-question', index === local));
                document.getElementById(`multi-question-${target}`)?.scrollIntoView({ block: 'start' });
                const selected = AppState.questions[local];
                if (selected) StorageService.saveLearningPosition(AppState.currentCategory.id, AppState.currentChapter.id, target, selected.id, 'multi');
                if (AppState.ui.aiPanelOpen) UIRenderer.renderAIPanel();
                if (AppState.ui.annotationPanelOpen) UIRenderer.renderAnnotationPanel();
            }
        } catch (error) {
            AppState.questions = previousQuestions; AppState.questionOffset = previousOffset;
            toast(`这一段暂时无法加载：${error.message || '请重试'}`);
        }
    }

    static toggleQuestionDrawer() { document.querySelector('.multi-question-view')?.classList.toggle('question-drawer-open'); }

    static filterQuestionIndex(input) {
        AppState.questionRailQuery = String(input.value || '').trim();
        document.querySelectorAll('.question-rail-tools input').forEach(item => { if (item !== input) item.value = AppState.questionRailQuery; });
        this.filterQuestionRailItems();
    }

    static toggleQuestionRailFilter(filter) {
        AppState.questionRailFilter = AppState.questionRailFilter === filter ? '' : filter;
        document.querySelectorAll('[data-rail-filter]').forEach(button => {
            const active = button.dataset.railFilter === AppState.questionRailFilter;
            button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        });
        this.filterQuestionRailItems();
    }

    static filterQuestionRailItems() {
        const query = AppState.questionRailQuery.toLocaleLowerCase();
        const filter = AppState.questionRailFilter;
        document.querySelectorAll('.question-rail-item').forEach(button => {
            const visible = (!query || button.dataset.questionId.toLocaleLowerCase().includes(query) || button.dataset.questionNumber.includes(query)) && (!filter || (filter === 'favorite' ? button.classList.contains('favorite') : filter === 'error-prone' ? button.classList.contains('error-prone') : button.dataset.mastery === filter));
            button.hidden = !visible;
        });
    }

    static async jumpByQuestionNumber(value) {
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const list = entries.length ? entries : AppState.questions;
        const text = String(value || '').trim();
        let index = list.findIndex(entry => String(entry.id) === text);
        if (index < 0 && /^\d+$/.test(text)) index = Number(text) - 1;
        if (index < 0 || index >= list.length) return;
        if (AppState.questionMode === 'multi' && AppState.currentChapter) return this.goToChapterQuestion(index);
        if (!await this.ensureSavedBeforeLeavingQuestion()) return;
        if (AppState.currentChapter) {
            const questions = await DataService.loadQuestionsForChapter(AppState.currentChapter);
            const selected = list[index];
            index = questions.findIndex(question => String(question.id) === String(selected.id));
            if (index < 0) return;
            AppState.questions = questions;
            AppState.questionOffset = 0;
        }
        await UIRenderer.renderQuestion(index);
    }

    static toggleCardAnswer(globalIndex, button) {
        const card = document.getElementById(`multi-question-${globalIndex}`);
        const answer = card?.querySelector('.answer-section');
        if (!answer) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        answer.style.display = expanded ? 'block' : 'none';
        button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? '隐藏答案' : '显示答案';
    }

    static async toggleQuestionFavorite(id) {
        if (!PreviewAccess.privateAllowed()) return;
        const active = StorageService.toggleFavorite(id); StateSync.queueQuestion(id, { favorite: active });
        document.querySelectorAll(`[data-question-id="${CSS.escape(String(id))}"] .multi-card-actions .action-btn:first-child`).forEach(btn => btn.classList.toggle('active', active));
        document.querySelectorAll(`.question-rail-item[data-question-id="${CSS.escape(String(id))}"]`).forEach(btn => btn.classList.toggle('favorite', active));
        this.filterQuestionRailItems();
    }

    static async toggleQuestionMistake(id) {
        if (!PreviewAccess.privateAllowed()) return;
        const active = StorageService.toggleMistake(id); StateSync.queueQuestion(id, { error_prone: active });
        document.querySelectorAll(`[data-question-id="${CSS.escape(String(id))}"] .multi-card-actions .action-btn:nth-child(2)`).forEach(btn => btn.classList.toggle('active', active));
        document.querySelectorAll(`.question-rail-item[data-question-id="${CSS.escape(String(id))}"]`).forEach(btn => btn.classList.toggle('error-prone', active));
        this.filterQuestionRailItems();
    }

    static async openQuestionAI(id) {
        const index = AppState.questions.findIndex(q => String(q.id) === String(id)); if (index < 0) return;
        if (index !== AppState.currentQuestionIndex && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.currentQuestionIndex = index; AppState.ui.aiPanelOpen = true;
        const panel = document.getElementById('ai-panel'); panel?.classList.remove('closed');
        UIRenderer.renderAIPanel();
    }

    static async openQuestionAnnotation(id) {
        const index = AppState.questions.findIndex(q => String(q.id) === String(id)); if (index < 0) return;
        if (index !== AppState.currentQuestionIndex && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.currentQuestionIndex = index; AppState.ui.annotationPanelOpen = true;
        const panel = document.getElementById('annotation-panel'); panel?.classList.remove('closed');
        UIRenderer.renderAnnotationPanel();
    }

    static async openLibraryQuestion(questionId) {
        const question = await DataService.getQuestion(questionId);
        if (!question) { toast('题目暂时无法加载，请重试'); return; }
        const category = AppState.currentCategory;
        const chapter = category && UIRenderer.findNodeById(category, Number(question.category_id));
        AppState.currentChapter = chapter || category;
        if (chapter) {
            const index = DataService.chapterEntries(chapter).findIndex(item => String(item.id) === String(questionId));
            await this.enterChapterQuestions(chapter, Math.max(index, 0), questionId, this.preferredQuestionMode());
        } else {
            AppState.questions = [question]; AppState.questionOffset = 0; AppState.chapterQuestionCount = 1;
            AppState.questionMode = 'single'; AppState.currentView = 'question';
            await UIRenderer.renderQuestion(0);
        }
    }

    static toggleLibraryToc() {
        const sidebar = document.getElementById('library-sidebar');
        const overlay = document.getElementById('library-toc-overlay');
        if (!sidebar) return;
        const open = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open', open);
        if (overlay) overlay.classList.toggle('open', open);
    }

    static async showChapter(chapter, { directOnly = false } = {}) {
        if (AppState.currentView === 'question' && !await this.ensureSavedBeforeLeavingQuestion()) return false;
        if (AppState.currentCategory) {
            AppState.directoryNodeId = String(chapter.id);
            AppState.libraryScrollTop = 0;
            UIRenderer.saveDirectoryState();
        }
        const queueChapter = await UIRenderer.filteredChapter(chapter, directOnly);
        const entries = DataService.chapterEntries(queueChapter);
        queueChapter._directOnly = directOnly;
        if (!entries.length) {
            AppState.currentCategory = AppState.currentCategory || UIRenderer.findCategoryById(chapter.id);
            AppState.directoryNodeId = String(chapter.id);
            AppState.currentView = 'library';
            if (AppState.currentCategory) {
                UIRenderer.saveDirectoryState();
                UIRenderer.renderLibrary(AppState.currentCategory.id);
            }
            const content = document.getElementById('library-content');
            if (content && DataService.chapterEntries(chapter).length > 0) content.insertAdjacentHTML('beforeend', `<div class="empty-state filtered-empty" role="status"><h3>此章节当前范围没有题目</h3><p>目录题数是总数；本次练习按“${escapeHtml(AppState.chapterScope === 'all' ? '完整' : AppState.chapterScope === 'core' ? '严选' : '真题')}”和已有详细筛选显示。</p></div>`);
            return false;
        }

        // 从目录抽屉进入后自动收起（手机端）
        const sidebar = document.getElementById('library-sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            document.getElementById('library-toc-overlay')?.classList.remove('open');
        }

        await this.enterChapterQuestions(queueChapter, 0, null, this.preferredQuestionMode());
        return AppState.currentView === 'question';
    }

    static async resumeLearning() {
        const position = StorageService.getLearningPosition();
        if (!position) return;

        const category = UIRenderer.findCategoryById(position.categoryId);
        if (!category) return;

        const chapter = UIRenderer.findChapterById(category, position.chapterId);
        if (!chapter) return;

        AppState.currentCategory = category;
        AppState.currentChapter = chapter;
        const entries = DataService.chapterEntries(chapter);
        let index = Number.isInteger(position.questionIndex) ? position.questionIndex : 0;
        if (position.questionId != null) { const byId = entries.findIndex(e => String(e.id) === String(position.questionId)); if (byId >= 0) index = byId; }
        await this.enterChapterQuestions(chapter, Math.max(0, Math.min(index, entries.length - 1)), position.questionId, this.preferredQuestionMode());
    }

    static showReview(tab) {
        AppState.reviewTab = tab;
        this.navigate('review');
        UIRenderer.renderReview(tab);
    }

    // 从复习/笔记列表进入单题（不覆盖“继续学习”的章节位置）
    static async openQuestionFromList(id) {
        const question = await DataService.getQuestion(id);
        if (!question) {
            alert('未找到该题目，题库可能已更新');
            return;
        }
        AppState.currentCategory = null;
        AppState.currentChapter = null;
        AppState.questions = [question];
        AppState.currentQuestionIndex = 0;
        AppState.currentView = 'question';
        await UIRenderer.renderQuestion(0);
    }

    static async selectNote(id) {
        // 切换选中项前保存未提交的备忘编辑；失败留在当前选中项。
        if (AppState.memoDirty) {
            try {
                await this.saveMemoNow();
            } catch (error) {
                toast(`备忘尚未保存：${error.message || '保存失败，请重试'}`);
                return;
            }
        }
        AppState.selectedNoteId = id;
        UIRenderer.renderNotes();
    }

    static bindMemoEditor() {
        const textarea = document.getElementById('memo-textarea');
        if (!textarea) return;
        textarea.addEventListener('input', () => { AppState.memoDirty = true; });
    }

    static async saveMemoNow() {
        const textarea = document.getElementById('memo-textarea');
        if (!textarea || !AppState.memoDirty) return;
        const statusEl = document.getElementById('memo-status');
        const content = textarea.value;
        if (statusEl) { statusEl.textContent = '保存中…'; statusEl.className = 'memo-status saving'; }
        try {
            StorageService.saveLocalMemo(content);
            AppState.memoDirty = false;
            if (statusEl) { statusEl.textContent = '已保存'; statusEl.className = 'memo-status saved'; }
        } catch (error) {
            if (statusEl) { statusEl.textContent = '保存失败，请重试'; statusEl.className = 'memo-status error'; }
            throw new Error('备忘保存失败，请重试');
        }
    }

    static async saveMemo() {
        const textarea = document.getElementById('memo-textarea');
        if (!textarea) return;
        AppState.memoDirty = true;
        try {
            await this.saveMemoNow();
            setTimeout(() => {
                const statusEl = document.getElementById('memo-status');
                if (statusEl) { statusEl.textContent = ''; statusEl.className = 'memo-status'; }
            }, 2000);
        } catch { /* 状态已显示失败，内容保留在输入框 */ }
    }

    // ---- 工具页动作 ----

    static toggleToolPanel(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const hidden = panel.classList.toggle('hidden');
        const btn = document.getElementById(panelId.replace('-panel', '') === 'paper' ? 'paper-toggle-btn' : panelId.replace('-panel', '') + '-toggle-btn');
        if (btn) btn.textContent = hidden ? '进入' : '收起';
        if (!hidden && panelId === 'sync-panel') this.syncStatus();
    }

    static setToolStatus(message, kind = '') {
        const el = document.getElementById('tool-status');
        if (!el) return;
        el.textContent = message;
        el.className = `tool-status ${kind}`.trim();
    }

    // 按范围收集题目池（组卷/导出共用）
    static async collectQuestionsByScope(scope) {
        if (scope === 'all' || scope == null) {
            const ids = Object.keys(AppState.idIndex || {});
            const questions = [];
            for (const id of ids) {
                const q = await DataService.getQuestion(id).catch(() => null);
                if (q) questions.push(q);
            }
            return questions;
        }
        if (String(scope).startsWith('subject:')) {
            const category = UIRenderer.findCategoryById(String(scope).slice('subject:'.length));
            if (!category) return [];
            const ids = [];
            const walk = node => {
                for (const id of (AppState.catQuestions[String(node.id)] || [])) ids.push(id);
                for (const child of node.children || []) walk(child);
            };
            walk(category);
            const questions = [];
            for (const id of ids) {
                const q = await DataService.getQuestion(id).catch(() => null);
                if (q) questions.push(q);
            }
            return questions;
        }
        const { progress, favorites } = StorageService.getProgress();
        let ids = [];
        if (scope === 'favorites') ids = favorites.map(String);
        else if (scope === 'mistakes') ids = Object.keys(progress).filter(id => progress[id]?.error_prone === true);
        else if (scope === 'mastered') ids = Object.keys(progress).filter(id => progress[id]?.mastery === 'mastered');
        else if (scope === 'chapter') ids = (AppState.questions || []).map(q => String(q.id));
        const questions = [];
        for (const id of ids) {
            const q = await DataService.getQuestion(id).catch(() => null);
            if (q) questions.push(q);
        }
        return questions;
    }

    static async generatePaper() {
        const resultEl = document.getElementById('paper-result');
        const scope = document.getElementById('paper-scope')?.value || 'all';
        const count = Math.max(5, Math.min(50, Number(document.getElementById('paper-count')?.value || 20)));
        if (resultEl) resultEl.innerHTML = '<p class="text-helper">正在抽取题目…</p>';
        try {
            const pool = await this.collectQuestionsByScope(scope);
            if (pool.length < 1) {
                if (resultEl) resultEl.innerHTML = '<p class="text-helper">该范围内暂无题目，换个范围试试。</p>';
                return;
            }
            const picked = [];
            const used = new Set();
            while (picked.length < Math.min(count, pool.length)) {
                const idx = Math.floor(Math.random() * pool.length);
                if (used.has(idx)) continue;
                used.add(idx);
                picked.push(pool[idx]);
            }
            AppState.paper = picked;
            const scopeLabel = document.getElementById('paper-scope')?.selectedOptions?.[0]?.textContent || '全部题库';
            if (resultEl) {
                resultEl.innerHTML = `
                    <p><strong>试卷已生成</strong> · ${escapeHtml(scopeLabel)} · ${picked.length} 题</p>
                    <ol class="paper-list">${picked.map(q => `<li>#${escapeHtml(String(q.id))} ${escapeHtml(UIRenderer.plainSummary(q.stem || q.question || '', 46))}</li>`).join('')}</ol>
                    <div class="tool-controls">
                        <button type="button" class="btn btn-primary btn-sm" id="btn-paper-start">开始作答</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-paper-export">导出本卷</button>
                    </div>
                `;
                document.getElementById('btn-paper-start')?.addEventListener('click', () => App.startPaper());
                document.getElementById('btn-paper-export')?.addEventListener('click', () => App.exportQuestionList(picked, '智能组卷', { withAnswers: true, withExpl: true }));
            }
            this.setToolStatus(`已生成 ${picked.length} 题的练习卷`, 'success');
        } catch (error) {
            if (resultEl) resultEl.innerHTML = `<p class="text-helper">组卷失败：${escapeHtml(error.message || String(error))}</p>`;
        }
    }

    static async startPaper() {
        const paper = AppState.paper || [];
        if (!paper.length) { toast('请先生成试卷'); return; }
        AppState.currentCategory = null;
        AppState.currentChapter = null;
        AppState.questions = paper;
        AppState.currentQuestionIndex = 0;
        AppState.currentView = 'question';
        await UIRenderer.renderQuestion(0);
    }

    static async exportQuestions({ download = false } = {}) {
        const scope = document.getElementById('export-scope')?.value || 'favorites';
        const withAnswers = document.getElementById('export-answers')?.checked === true;
        const withExpl = document.getElementById('export-expl')?.checked === true && withAnswers;
        const labels = { favorites: '收藏题', mistakes: '易错题', mastered: '已掌握', chapter: '当前章节队列' };
        const questions = await this.collectQuestionsByScope(scope);
        if (!questions.length) {
            toast('这个范围里没有题目');
            return;
        }
        this.exportQuestionList(questions, labels[scope] || '导出', { withAnswers, withExpl, download });
    }

    // 真实导出：公式在主页用 renderMarkdown 预渲染；默认打开打印预览弹窗，download=true 时直接保存 HTML 文件
    static exportQuestionList(questions, title, { withAnswers = false, withExpl = false, download = false } = {}) {
        const win = download ? null : window.open('', '_blank', 'width=920,height=720');
        const items = questions.map((q, i) => {
            const parts = [`<h3>第 ${i + 1} 题 · #${escapeHtml(String(q.id))} · ${escapeHtml(q.source || '')}</h3>`];
            parts.push(`<div class="stem">${renderMarkdown(q.stem || q.question || '')}</div>`);
            if (Array.isArray(q.options) && q.options.length) {
                parts.push('<ol class="opts">' + q.options.map(o => `<li>${renderMarkdown(typeof o === 'object' ? (o.content_md || o.content || '') : o)}</li>`).join('') + '</ol>');
            }
            if (withAnswers) parts.push(`<p><strong>答案：</strong>${renderMarkdown(q.answer || '暂无')}</p>`);
            if (withExpl && q.explanation) parts.push(`<p><strong>解析：</strong>${renderMarkdown(q.explanation)}</p>`);
            return `<section class="q">${parts.join('')}</section>`;
        }).join('');
        const doc = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>大观园-${escapeHtml(title)}</title>
<link rel="stylesheet" href="${location.origin}/vendor/katex.min.css">
<style>body{font-family:Georgia,'Microsoft YaHei',serif;max-width:760px;margin:32px auto;padding:0 16px;color:#202124}h1{font-size:22px}.q{margin:24px 0;padding-bottom:12px;border-bottom:1px solid #e3e6ea}.opts{margin:8px 0 0 1.2em}.katex-display{overflow-x:auto}.toolbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #e3e6ea;display:flex;gap:12px;align-items:center}</style>
</head><body>
<div class="toolbar"><button onclick="window.print()">打印 / 另存 PDF</button><button id="btn-dl">下载 HTML 文件</button><span>${questions.length} 题 · ${escapeHtml(title)}</span></div>
<h1>大观园 · ${escapeHtml(title)}</h1>
${items}
<script>
document.getElementById('btn-dl').addEventListener('click', function () {
  var blob = new Blob(['<!DOCTYPE html>' + document.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daguan-export-' + new Date().toISOString().slice(0,10) + '.html';
  a.click();
});
<\/script></body></html>`;
        if (win) {
            win.document.write(doc);
            win.document.close();
            this.setToolStatus(`已生成导出预览：${questions.length} 题（${title}）`, 'success');
        } else {
            const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `daguan-export-${new Date().toISOString().slice(0, 10)}.html`;
            a.click();
            this.setToolStatus('弹窗被拦截，已直接下载 HTML 文件', 'success');
        }
    }

    // 备份格式与旧版一致（daguan-local-progress v3）：批注为 {markdown, updated_at, history}，
    // 不包含 AI 服务配置与密钥
    static buildBackupPayload() {
        const progress = StorageService.getProgress();
        const map = {};
        for (const [id, p] of Object.entries(progress.progress)) {
            if (p.mastery === 'mastered') map[id] = 'm';
            else if (p.error_prone === true) map[id] = 'f';
            else if (p.mastery === 'learning') map[id] = 'l';
        }
        let picked = [];
        try { picked = JSON.parse(localStorage.getItem('daguan_local_picked_v1') || '[]'); } catch {}
        return {
            format: 'daguan-local-progress',
            version: 3,
            v: 3,
            src: 'daguan-math',
            at: Date.now(),
            map,
            progress: progress.progress,
            favorites: progress.favorites,
            annotations: StorageService.normalizeAnnotationsForStorage(StorageService.readAnnotationsStorage()),
            picked: Array.isArray(picked) ? picked : [],
            last_study: (() => {
                const position = StorageService.getLearningPosition();
                return position?.chapterId != null && position?.questionId != null
                    ? { category_id: String(position.chapterId), question_id: String(position.questionId), mode: position.mode || 'single', updated_at: position.timestamp || null }
                    : null;
            })(),
        };
    }

    static downloadBackup() {
        if (!PreviewAccess.privateAllowed()) return;
        const payload = this.buildBackupPayload();
        const d = new Date();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `daguan-progress-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.setToolStatus(`已生成备份文件 daguan-progress-${dateStr}.json`, 'success');
    }

    // 解析备份文件：兼容旧版 daguan-progress（full/map 两种）与旧版新键 daguan-backup-* 格式。
    // 任何解析失败抛错，调用方保证不改动现有数据。
    static parseBackupText(text) {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('不是有效的备份 JSON');
        if (data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)) {
            return {
                kind: 'full',
                progress: data.progress,
                favorites: Array.isArray(data.favorites) ? data.favorites.map(String) : [],
                annotations: data.annotations && typeof data.annotations === 'object' && !Array.isArray(data.annotations) ? data.annotations : null,
                picked: Array.isArray(data.picked) ? data.picked.map(String) : null,
                aiPreferences: null, // 旧版新键备份里的 ai_preferences 可能含密钥，恢复时一律不读取
            };
        }
        const map = {};
        const favorites = [];
        const put = (id, code) => {
            const key = String(id);
            if (!key || code == null) return;
            if (code === 'm' || code === 'mastered') map[key] = 'mastered';
            else if (code === 'f' || code === 'forgot' || code === 'not_known' || code === 'error_prone') map[key] = 'error_prone';
            else if (code === 'l' || code === 'learning' || code === 'needs_practice') map[key] = 'learning';
        };
        if (data.map && typeof data.map === 'object' && !Array.isArray(data.map)) {
            for (const [id, v] of Object.entries(data.map)) put(id, v);
            if (Array.isArray(data.favorites)) data.favorites.forEach(id => favorites.push(String(id)));
            if (!Object.keys(map).length && !favorites.length) throw new Error('备份内容为空');
            return { kind: 'map', map, favorites, annotations: null, picked: Array.isArray(data.picked) ? data.picked.map(String) : null };
        }
        if (data.states && typeof data.states === 'object' && !Array.isArray(data.states)) {
            for (const [id, value] of Object.entries(data.states)) {
                if (!value || typeof value !== 'object') continue;
                put(id, value.mastery);
                if (value.favorite === true || value.favorited_at) favorites.push(String(id));
            }
            if (!Object.keys(map).length && !favorites.length) throw new Error('备份内容为空');
            return { kind: 'map', map, favorites, annotations: null, picked: null };
        }
        throw new Error('无法识别的备份格式（缺少进度数据）');
    }

    static async restoreBackup(input) {
        const file = input && input.files && input.files[0];
        if (!file) return;
        let parsed;
        try {
            parsed = this.parseBackupText(await file.text());
        } catch (err) {
            this.setToolStatus(`恢复失败：${err.message || '无法读取该 JSON 文件'}（当前数据未改动）`, 'error');
            input.value = '';
            return;
        }
        if (!confirm(`确定用 ${file.name} 覆盖当前的做题进度、收藏和批注吗？此操作不可撤销。`)) {
            input.value = '';
            return;
        }

        // 回滚快照：恢复过程中任何写入失败都可回滚；对账成功前保留
        const snapshot = {
            progress: localStorage.getItem(PROGRESS_KEY_SHARED),
            favorites: localStorage.getItem(FAVORITES_KEY_SHARED),
            annotations: localStorage.getItem('daguan_question_annotations_v1'),
            picked: localStorage.getItem('daguan_local_picked_v1'),
            saved_at: new Date().toISOString(),
        };
        const rollback = () => {
            if (snapshot.progress != null) localStorage.setItem(PROGRESS_KEY_SHARED, snapshot.progress);
            if (snapshot.favorites != null) localStorage.setItem(FAVORITES_KEY_SHARED, snapshot.favorites);
            if (snapshot.annotations != null) localStorage.setItem('daguan_question_annotations_v1', snapshot.annotations);
            if (snapshot.picked != null) localStorage.setItem('daguan_local_picked_v1', snapshot.picked);
        };

        const now = new Date().toISOString();
        try {
            if (parsed.kind === 'full') {
                // 写入旧版同形存储：进度纯映射 + 独立收藏键；批注统一 markdown 形状
                writeProgressStorage(parsed.progress, parsed.favorites);
                if (parsed.annotations) {
                    localStorage.setItem('daguan_question_annotations_v1', JSON.stringify(StorageService.normalizeAnnotationsForStorage(parsed.annotations)));
                }
                if (parsed.picked) {
                    localStorage.setItem('daguan_local_picked_v1', JSON.stringify(parsed.picked.map(String)));
                }
            } else {
                const current = StorageService.getProgress();
                const progress = { ...current.progress };
                for (const [id, mastery] of Object.entries(parsed.map)) {
                    const cur = progress[id] || {};
                    progress[id] = {
                        ...cur,
                        mastery: mastery === 'error_prone' ? 'learning' : mastery,
                        error_prone: mastery === 'error_prone' ? true : cur.error_prone === true,
                        seen: true,
                        updated_at: now,
                    };
                }
                const favorites = [...new Set([...current.favorites, ...parsed.favorites])];
                writeProgressStorage(progress, favorites);
            }
        } catch (err) {
            rollback();
            this.setToolStatus(`恢复失败：${err.message || '写入本地存储失败'}（已回滚，当前数据未变）`, 'error');
            input.value = '';
            return;
        }

        // 恢复结果以本地为准对账服务端；失败时保留待对账标记，刷新/重启后 hydrate 会继续推送且不用旧服务端数据覆盖
        StateSync.markRestorePending();
        let synced = false;
        if (StateSync.available && PreviewAccess.privateAllowed(false)) {
            synced = await StateSync.reconcileLocalToServer();
            if (synced) {
                StateSync.clearRestorePending();
                StateSync.clearRestoreRollback();
            }
        }
        if (AppState.currentView === 'records') UIRenderer.renderRecords();
        if (synced) {
            this.setToolStatus('恢复完成（本地与服务端已同步）', 'success');
        } else {
            this.setToolStatus('恢复完成：本地数据已更新；本地服务端暂未同步，恢复结果不会被覆盖，服务可用后自动补同步', 'success');
        }
        input.value = '';
    }

    // ---- 官网同步（真实流程：状态 → 登录 → 预览 → 确认写入） ----

    static async syncRequest(action, payload = {}) {
        const routes = {
            status: ['/integrations/cxyonly/status', 'GET'],
            login: ['/integrations/cxyonly/login', 'POST'],
            pullPreview: ['/integrations/cxyonly/pull/preview', 'POST'],
            pullApply: ['/integrations/cxyonly/pull/apply', 'POST'],
            pushPreview: ['/integrations/cxyonly/push/preview', 'POST'],
            pushApply: ['/integrations/cxyonly/push/apply', 'POST'],
        };
        const route = routes[action];
        if (!route) throw new Error(`未知同步操作：${action}`);
        const response = await fetch(`./api${route[0]}`, {
            method: route[1],
            cache: 'no-store',
            credentials: 'include',
            headers: route[1] === 'POST' ? { 'Content-Type': 'application/json' } : {},
            body: route[1] === 'POST' ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!response.ok) {
            const error = new Error(data?.error || `同步请求失败（HTTP ${response.status}）`);
            error.code = data?.code || '';
            throw error;
        }
        return data;
    }

    static syncResultHtml(html) {
        const el = document.getElementById('sync-result');
        if (el) el.innerHTML = html;
    }

    static async syncStatus() {
        const statusEl = document.getElementById('sync-status');
        if (!PreviewAccess.privateAllowed()) return;
        if (statusEl) statusEl.textContent = '正在检查本地中控台…';
        try {
            const status = await this.syncRequest('status');
            AppState.syncStatus = status;
            const line = status.authenticated
                ? (status.needsFirstSync ? '官网已配置，但还没导入过进度。可先「读取官网进度」。' : `官网已连接。${status.lastPullAt ? `上次同步：${String(status.lastPullAt).slice(0, 16).replace('T', ' ')}` : ''}`)
                : (status.configured ? '登录已失效，请重新配置。' : '尚未配置官网登录。点击「配置登录」填入登录码或账号。');
            if (statusEl) statusEl.textContent = line;
            document.getElementById('btn-sync-pull').disabled = !status.authenticated;
            document.getElementById('btn-sync-push').disabled = !status.authenticated;
        } catch (error) {
            if (statusEl) statusEl.textContent = `本地中控台未连接：${error.message}`;
        }
    }

    static syncOpenLogin() {
        if (!PreviewAccess.privateAllowed()) return;
        document.getElementById('sync-login-form')?.classList.remove('hidden');
    }

    static async syncLogin(event) {
        event.preventDefault();
        if (!PreviewAccess.privateAllowed()) return;
        const username = String(document.getElementById('sync-login-user')?.value || '').trim();
        const password = String(document.getElementById('sync-login-pass')?.value || '');
        if (!username) { this.syncResultHtml('<p class="text-helper">请输入登录码或用户名。</p>'); return; }
        this.syncResultHtml('<p class="text-helper">正在保存登录配置…</p>');
        try {
            const payload = password ? { username, password } : { code: username };
            await this.syncRequest('login', payload);
            this.syncResultHtml('<p class="text-helper">登录配置已保存。请重新「检查状态」。</p>');
            document.getElementById('sync-login-form')?.classList.add('hidden');
            await this.syncStatus();
        } catch (error) {
            this.syncResultHtml(`<p class="text-helper">登录失败：${escapeHtml(error.message || String(error))}</p>`);
        }
    }

    static async syncPull() {
        if (!PreviewAccess.privateAllowed()) return;
        this.syncResultHtml('<p class="text-helper">正在读取官网进度预览…</p>');
        try {
            const preview = await this.syncRequest('pullPreview');
            const summary = preview.summary || {};
            const changes = Array.isArray(summary.changes) ? summary.changes : [];
            AppState.syncPullPreviewId = preview.previewId || '';
            this.syncResultHtml(`
                <p><strong>官网进度预览</strong> · ${Number(summary.entries) || changes.length} 条</p>
                ${changes.length ? `<ol class="paper-list">${changes.slice(0, 20).map(change => `<li>#${escapeHtml(String(change.id ?? change.question_id ?? ''))} ${escapeHtml(change.field || change.summary || '状态更新')}</li>`).join('')}</ol>` : '<p class="text-helper">官网与本地一致，无需导入。</p>'}
                ${summary.unknownIds?.length ? `<p class="text-helper">未知题号 ${summary.unknownIds.length} 条（题库可能已更新，已保留报告）。</p>` : ''}
                ${preview.previewId ? '<button type="button" class="btn btn-primary btn-sm" id="btn-sync-pull-apply">应用到本地</button>' : ''}
            `);
            document.getElementById('btn-sync-pull-apply')?.addEventListener('click', () => App.syncPullApply());
        } catch (error) {
            if (error.code === 'PREVIEW_LOCKED') { PreviewAccess.openUnlockDialog(); return; }
            this.syncResultHtml(`<p class="text-helper">读取失败：${escapeHtml(error.message || String(error))}</p>`);
        }
    }

    static async syncPullApply() {
        try {
            const applied = await this.syncRequest('pullApply', { previewId: AppState.syncPullPreviewId });
            if (applied.state) {
                StorageService.saveProgress({
                    progress: StateSync.mergeProgress(StorageService.getProgress().progress, applied.state.progress || {}),
                    favorites: Array.isArray(applied.state.favorites) ? applied.state.favorites.map(String) : StorageService.getProgress().favorites,
                });
                if (applied.state.annotations && typeof applied.state.annotations === 'object') {
                    localStorage.setItem('daguan_question_annotations_v1', JSON.stringify(applied.state.annotations));
                }
                StateSync.revision = Number(applied.state.revision) || StateSync.revision;
            }
            this.syncResultHtml('<p class="text-helper">官网进度已导入本地。</p>');
            toast('官网进度已导入');
        } catch (error) {
            this.syncResultHtml(`<p class="text-helper">写入失败：${escapeHtml(error.message || String(error))}（本地数据未改动）</p>`);
        }
    }

    static async syncPush() {
        if (!PreviewAccess.privateAllowed()) return;
        this.syncResultHtml('<p class="text-helper">正在生成上传预览…</p>');
        try {
            const document_ = this.buildSyncDocument();
            const preview = await this.syncRequest('pushPreview', { document: document_ });
            const summary = preview.summary || {};
            const changes = Array.isArray(summary.changes) ? summary.changes : [];
            AppState.syncPushPreviewId = preview.previewId || '';
            this.syncResultHtml(`
                <p><strong>上传预览</strong> · ${Number(summary.entries) || changes.length} 条变化</p>
                ${changes.length ? `<ol class="paper-list">${changes.slice(0, 20).map(change => `<li>#${escapeHtml(String(change.id ?? change.question_id ?? ''))} ${escapeHtml(change.field || change.summary || '状态更新')}</li>`).join('')}</ol>` : '<p class="text-helper">没有需要上传的变化。</p>'}
                ${preview.previewId && changes.length ? '<button type="button" class="btn btn-primary btn-sm" id="btn-sync-push-apply">确认上传到官网</button>' : ''}
            `);
            document.getElementById('btn-sync-push-apply')?.addEventListener('click', () => App.syncPushApply());
        } catch (error) {
            if (error.code === 'PREVIEW_LOCKED') { PreviewAccess.openUnlockDialog(); return; }
            this.syncResultHtml(`<p class="text-helper">预览失败：${escapeHtml(error.message || String(error))}</p>`);
        }
    }

    static async syncPushApply() {
        try {
            await this.syncRequest('pushApply', { previewId: AppState.syncPushPreviewId });
            this.syncResultHtml('<p class="text-helper">本地进度已上传官网。</p>');
            toast('上传完成');
        } catch (error) {
            this.syncResultHtml(`<p class="text-helper">上传失败：${escapeHtml(error.message || String(error))}</p>`);
        }
    }

    // 官网同步文档：与旧版 buildSyncDocument 同构（mastery 映射 + 仅含有效条目）
    static buildSyncDocument() {
        const { progress, favorites } = StorageService.getProgress();
        const states = {};
        for (const [id, p] of Object.entries(progress)) {
            const mastery = p.mastery === 'mastered' ? 'mastered' : (p.mastery === 'learning' ? 'needs_practice' : 'not_started');
            const favorite = p.favorite === true || favorites.includes(String(id));
            if (mastery === 'not_started' && !favorite) continue;
            states[id] = { mastery, favorite, updated_at: p.updated_at ? new Date(timestampOf(p.updated_at)).toISOString() : new Date().toISOString() };
        }
        for (const id of favorites) {
            if (!states[id]) states[id] = { mastery: 'not_started', favorite: true, updated_at: new Date().toISOString() };
        }
        return { format: 'daguan-local-progress', version: 3, exported_at: new Date().toISOString(), states };
    }

    static toggleTutorial() {
        const panel = document.getElementById('tutorial-panel');
        const btn = document.getElementById('tutorial-toggle-btn');
        if (!panel) return;
        const hidden = panel.classList.toggle('hidden');
        if (btn) btn.textContent = hidden ? '展开' : '收起';
    }

    static showSettings() {
        const main = document.getElementById('app-main');
        const prefs = StorageService.getAIPreferences();
        const profiles = AppState.aiProfiles || [];
        const profileOptions = profiles.length
            ? profiles.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === AppState.aiProfileId ? 'selected' : ''}>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''}</option>`).join('')
            : '<option value="">未配置 AI</option>';

        main.innerHTML = `
            <div class="home-content">
                <h1 class="text-page-title" style="margin-bottom: var(--spacing-xl);">设置</h1>

                ${UIRenderer.renderThemeSettings()}

                <section class="card shortcut-settings-card" aria-labelledby="shortcut-settings-title">
                    <h2 class="text-section-title" id="shortcut-settings-title">快捷键</h2>
                    <p class="text-helper">单击按键后按下新键。快捷键与旧版共用本机配置；/、M、J、K、G 为固定搜索与导航键。</p>
                    <div id="shortcut-list" class="shortcut-list"></div><p id="shortcut-feedback" class="text-helper" aria-live="polite"></p>
                    <button type="button" class="btn btn-text" onclick="App.resetShortcuts()">恢复旧版默认键</button>
                </section>

                <div class="card" style="margin-bottom: var(--spacing-xl);">
                    <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">AI 服务</h2>
                    <p class="text-helper" style="margin-bottom: var(--spacing-l);">AI 服务档案统一保存在本地中控台，新旧两版共用；此处只选择使用哪一个，不录入密钥。</p>
                    <div style="display: flex; flex-direction: column; gap: var(--spacing-l);">
                        <div>
                            <label style="display: block; margin-bottom: var(--spacing-s); font-weight: 600;">使用的服务档案</label>
                            <select id="ai-profile-setting" style="width: 100%; padding: 10px; border: 1px solid var(--border-default); border-radius: 8px;" onchange="App.selectAIProfile(this.value)">${profileOptions}</select>
                        </div>
                        <details class="profile-form-details" id="ai-profile-form-new">
                            <summary class="btn btn-secondary" style="cursor: pointer; display: inline-flex;">新增 / 编辑服务档案</summary>
                            <div style="display: flex; flex-direction: column; gap: var(--spacing-l); margin-top: var(--spacing-l);">
                                <div>
                                    <label style="display: block; margin-bottom: var(--spacing-s); font-weight: 600;">档案名称</label>
                                    <input type="text" id="ai-profile-name-new" placeholder="例如：我的中转站" style="width: 100%; padding: 10px; border: 1px solid var(--border-default); border-radius: 8px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: var(--spacing-s); font-weight: 600;">Base URL</label>
                                    <input type="text" id="ai-profile-url-new" placeholder="OpenAI 兼容接口地址" style="width: 100%; padding: 10px; border: 1px solid var(--border-default); border-radius: 8px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: var(--spacing-s); font-weight: 600;">模型</label>
                                    <input type="text" id="ai-profile-model-new" placeholder="例如 gpt-4o-mini" style="width: 100%; padding: 10px; border: 1px solid var(--border-default); border-radius: 8px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: var(--spacing-s); font-weight: 600;">API Key（保存到本地中控台，不写入浏览器存储）</label>
                                    <input type="password" id="ai-profile-key-new" placeholder="留空表示沿用已保存的 Key" style="width: 100%; padding: 10px; border: 1px solid var(--border-default); border-radius: 8px;">
                                </div>
                                <div class="tool-controls">
                                    <button type="button" class="btn btn-primary" id="btn-ai-profile-save">保存档案</button>
                                    <button type="button" class="btn btn-secondary" id="btn-ai-profile-test">测试连接</button>
                                    <button type="button" class="btn btn-text" id="btn-ai-profile-delete">删除当前档案</button>
                                </div>
                                <p class="text-helper" id="ai-profile-feedback"></p>
                            </div>
                        </details>
                    </div>
                </div>

                <div class="card" style="margin-bottom: var(--spacing-xl);">
                    <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">访问与数据</h2>
                    <p class="text-helper" id="preview-status" style="margin-bottom: var(--spacing-l);"></p>
                    <div class="tool-controls">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-preview-unlock" onclick="PreviewAccess.openUnlockDialog()">输入访问 Token</button>
                        <button type="button" class="btn btn-text btn-sm" id="btn-preview-lock" onclick="PreviewAccess.lock()">锁定为只读预览</button>
                    </div>
                </div>

                <div class="card">
                    <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">版本切换</h2>
                    <p style="margin-bottom: var(--spacing-l); color: var(--text-secondary);">
                        当前使用新版 UI。切换前会自动保存进度、批注与草稿；旧版入口同样可达。
                    </p>
                    <button class="btn btn-secondary" id="btn-switch-legacy" onclick="App.switchToLegacy()">
                        切换到旧版
                    </button>
                </div>
            </div>
        `;
        PreviewAccess.applyUi();
        UIRenderer.bindThemeSettings();
        this.renderShortcutSettings();
        document.getElementById('btn-preview-lock').hidden = !PreviewAccess.mode || !PreviewAccess.unlocked;
        document.getElementById('btn-ai-profile-save')?.addEventListener('click', () => this.saveAIProfile());
        document.getElementById('btn-ai-profile-test')?.addEventListener('click', () => this.testAIProfile());
        document.getElementById('btn-ai-profile-delete')?.addEventListener('click', () => this.deleteAIProfile());
        const editing = profiles.find(item => item.id === AppState.aiProfileId);
        if (editing) {
            document.getElementById('ai-profile-name-new').value = editing.name || '';
            document.getElementById('ai-profile-url-new').value = editing.baseUrl || '';
            document.getElementById('ai-profile-model-new').value = editing.model || '';
        }
    }

    static async saveAIProfile() {
        if (!PreviewAccess.privateAllowed()) return;
        const feedback = document.getElementById('ai-profile-feedback');
        const existing = (AppState.aiProfiles || []).find(item => item.id === AppState.aiProfileId);
        const name = document.getElementById('ai-profile-name-new')?.value.trim();
        const baseUrl = document.getElementById('ai-profile-url-new')?.value.trim();
        const model = document.getElementById('ai-profile-model-new')?.value.trim();
        const key = document.getElementById('ai-profile-key-new')?.value;
        const body = { name, model, baseUrl };
        if (key) body.key = key;
        try {
            const response = await fetch(existing ? `./api/ai/profiles/${encodeURIComponent(existing.id)}` : './api/ai/profiles', {
                method: existing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '保存失败');
            AIService.selectProfile(data.profile.id);
            await AIService.loadProfiles();
            if (feedback) feedback.textContent = 'AI 服务档案已保存并启用。';
            this.showSettings();
        } catch (error) {
            if (feedback) feedback.textContent = `保存失败：${error.message || String(error)}`;
        }
    }

    static async testAIProfile() {
        const feedback = document.getElementById('ai-profile-feedback');
        if (!AppState.aiProfileId) { if (feedback) feedback.textContent = '请先保存档案，再测试。'; return; }
        if (feedback) feedback.textContent = '正在测试…';
        try {
            const response = await fetch(`./api/ai/profiles/${encodeURIComponent(AppState.aiProfileId)}/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'text' }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || data.message || '测试失败');
            if (feedback) feedback.textContent = `文本测试通过 · HTTP ${data.status} · ${data.latencyMs}ms · ${data.response || '无摘要'}`;
        } catch (error) {
            if (feedback) feedback.textContent = error.message || String(error);
        }
    }

    static async deleteAIProfile() {
        if (!PreviewAccess.privateAllowed()) return;
        const profile = AIService.activeProfile();
        if (!profile) { toast('当前没有可删除的档案'); return; }
        if (!confirm(`删除“${profile.name}”？历史记录默认保留。`)) return;
        const response = await fetch(`./api/ai/profiles/${encodeURIComponent(profile.id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clearHistory: false }),
        }).catch(() => null);
        if (!response || !response.ok) { toast('删除失败'); return; }
        AIService.selectProfile('');
        await AIService.loadProfiles();
        this.showSettings();
        toast('AI 服务已删除');
    }

    static async switchToLegacy() {
        await this.setUiVersion('old');
    }

    // 切换版本：保存先行、AI 生成先确认、全部必要写入完成后才导航；任何失败留在新版。
    static async setUiVersion(version) {
        const versions = window.DaguanVersions;
        if (!versions || AppState.switchingVersion) return;
        if (version === versions.current) return;
        if (AppState.aiBusy && !confirm('切换界面会结束当前 AI 生成。是否保存进度并切换？')) return;
        AppState.switchingVersion = true;
        try {
            const question = AppState.questions[AppState.currentQuestionIndex];
            const input = document.getElementById('ai-input');
            if (question && input) StorageService.saveAIDraft(question.id, input.value);
            if (PreviewAccess.privateAllowed(false)) {
                await this.flushAnnotationNow();
                await this.saveMemoNow();
                await StateSync.ensureFlushed();
            }
            // AI 生成中：确认后先结束生成再切换
            await this.stopAIStream();
            localStorage.setItem(versions.selectionKey, version);
            if (AppState.ui.aiPanelOpen) {
                try { sessionStorage.setItem('daguan_switch_ai_open', '1'); } catch {}
            }
            window.location.assign(versions.targetUrl(location.href, version, true));
        } catch (error) {
            toast(`未切换界面：${error.message || '保存失败，请重试'}`);
        } finally {
            AppState.switchingVersion = false;
        }
    }

    static async previousQuestion() {
        if (AppState.currentQuestionIndex > 0) {
            if (!await this.ensureSavedBeforeLeavingQuestion()) return;
            await UIRenderer.renderQuestion(AppState.currentQuestionIndex - 1);
        }
    }

    static async nextQuestion() {
        if (AppState.currentQuestionIndex < AppState.questions.length - 1) {
            if (!await this.ensureSavedBeforeLeavingQuestion()) return;
            await UIRenderer.renderQuestion(AppState.currentQuestionIndex + 1);
        }
    }

    // 切题前的保存先行：批注/AI 草稿/服务端队列清空后才渲染下一题；失败留在当前题。
    static async ensureSavedBeforeLeavingQuestion() {
        const question = AppState.questions[AppState.currentQuestionIndex];
        try {
            const input = document.getElementById('ai-input');
            if (question && input) StorageService.saveAIDraft(question.id, input.value);
            await this.flushAnnotationNow();
            await StateSync.ensureFlushed();
        } catch (error) {
            toast(`未切换题目：${error.message || '保存失败，请重试'}`);
            return false;
        }
        this.abortAIStream();
        return true;
    }

    static selectOption(index) {
        const question = AppState.questions[AppState.currentQuestionIndex];
        const options = document.querySelectorAll('.option-item');
        options.forEach((opt, idx) => {
            if (idx === index) {
                opt.classList.toggle('selected');
                if (question) {
                    const label = (typeof question.options?.[idx] === 'object' && question.options?.[idx]?.label) || String.fromCharCode(65 + idx);
                    if (!AppState.answers[String(question.id)]) AppState.answers[String(question.id)] = new Set();
                    if (opt.classList.contains('selected')) AppState.answers[String(question.id)].add(label);
                    else AppState.answers[String(question.id)].delete(label);
                }
            }
        });
    }

    static selectQuestionOption(questionId, index, optionEl) {
        const question = AppState.questions.find(item => String(item.id) === String(questionId));
        if (!question || !optionEl) return;
        const option = question.options?.[index];
        const label = (typeof option === 'object' && option?.label) || String.fromCharCode(65 + index);
        const key = String(question.id);
        if (!AppState.answers[key]) AppState.answers[key] = new Set();
        const selected = optionEl.classList.toggle('selected');
        if (selected) AppState.answers[key].add(label); else AppState.answers[key].delete(label);
    }

    static toggleAnswer() {
        const answerSection = document.getElementById('answer-section');
        const btn = document.getElementById('show-answer-btn');

        if (answerSection.style.display === 'none') {
            answerSection.style.display = 'block';
            btn.textContent = '隐藏答案';

            // 如果答案在屏幕外，滚动到答案位置
            setTimeout(() => {
                const rect = answerSection.getBoundingClientRect();
                if (rect.top > window.innerHeight || rect.bottom < 0) {
                    answerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        } else {
            answerSection.style.display = 'none';
            btn.textContent = '显示答案';
        }
        this.refreshShortcutHints(document.querySelector('.question-main') || document);
    }

    static toggleFavorite(questionId) {
        if (!PreviewAccess.privateAllowed()) return;
        const isFav = StorageService.toggleFavorite(questionId);
        const btn = event.currentTarget;
        btn.classList.toggle('active', isFav);
        StateSync.queueQuestion(questionId, { favorite: isFav });
    }

    static toggleMistake(questionId) {
        if (!PreviewAccess.privateAllowed()) return;
        const isMistake = StorageService.toggleMistake(questionId);
        const btn = event.currentTarget;
        btn.classList.toggle('active', isMistake);
        btn.textContent = isMistake ? '✓ 易错' : '易错';
        StateSync.queueQuestion(questionId, { error_prone: isMistake });
        this.refreshShortcutHints(document.querySelector('.question-main') || document);
    }

    static toggleMastered(questionId) {
        this.cycleMastery(questionId);
    }

    static cycleMastery(questionId) {
        if (!PreviewAccess.privateAllowed()) return;
        const value = StorageService.cycleMastery(questionId);
        StateSync.queueQuestion(questionId, { mastery: value });
        document.querySelectorAll(`[data-question-id="${CSS.escape(String(questionId))}"] .mastery-btn, .question-main .mastery-status-button`).forEach(btn => {
            btn.classList.remove('mastery-not_started', 'mastery-learning', 'mastery-mastered', 'active');
            btn.classList.add(`mastery-${value}`); btn.textContent = masteryLabel(value);
        });
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const globalIndex = entries.findIndex(entry => String(entry.id) === String(questionId));
        document.querySelectorAll(`.question-rail-item[data-question-id="${CSS.escape(String(questionId))}"]`).forEach(rail => {
            rail.classList.remove('mastery-not_started', 'mastery-learning', 'mastery-mastered');
            rail.dataset.mastery = value;
            if (value !== 'not_started') rail.classList.add(`mastery-${value}`);
            const favorite = StorageService.isFavorite(questionId), mistake = StorageService.isMistake(questionId);
            rail.setAttribute('aria-label', `第 ${globalIndex + 1} 题，题号 ${questionId}，${masteryLabel(value)}${favorite ? '，已收藏' : ''}${mistake ? '，易错' : ''}`);
        });
        this.filterQuestionRailItems();
        this.refreshShortcutHints(document.querySelector('.question-main') || document);
    }

    static setQuestionMastery(questionId, mastery) {
        if (!questionId || !PreviewAccess.privateAllowed()) return;
        const value = StorageService.setMastery(questionId, mastery);
        StateSync.queueQuestion(questionId, { mastery: value });
        document.querySelectorAll(`[data-question-id="${CSS.escape(String(questionId))}"] .mastery-btn, .question-main .mastery-status-button`).forEach(btn => {
            btn.classList.remove('mastery-not_started', 'mastery-learning', 'mastery-mastered', 'active');
            btn.classList.add(`mastery-${value}`); btn.textContent = masteryLabel(value);
        });
        document.querySelectorAll(`.question-rail-item[data-question-id="${CSS.escape(String(questionId))}"]`).forEach(rail => { rail.dataset.mastery = value; });
        this.filterQuestionRailItems();
        this.refreshShortcutHints(document.querySelector('.question-main') || document);
    }

    static toggleAI() {
        if (!PreviewAccess.privateAllowed()) return;
        const panel = document.getElementById('ai-panel');
        if (!panel) return;

        const isOpen = !panel.classList.contains('closed');
        panel.classList.toggle('closed', isOpen);
        AppState.ui.aiPanelOpen = !isOpen;

        if (!isOpen) {
            if (!AppState.aiProfiles) AIService.loadProfiles();
            UIRenderer.renderAIPanel();
        }
    }

    static toggleAnnotation() {
        if (!PreviewAccess.privateAllowed()) return;
        const panel = document.getElementById('annotation-panel');
        if (!panel) return;

        const isOpen = !panel.classList.contains('closed');
        panel.classList.toggle('closed', isOpen);
        AppState.ui.annotationPanelOpen = !isOpen;

        if (!isOpen) {
            UIRenderer.renderAnnotationPanel();
        }
    }

    static async sendAIPrompt(prompt) {
        const input = document.getElementById('ai-input');
        if (input) input.value = prompt;
        await this.sendAIMessage();
    }

    static selectAIProfile(profileId) {
        AIService.selectProfile(profileId);
        const question = AppState.questions[AppState.currentQuestionIndex];
        if (question) UIRenderer.renderAIHistory(question);
    }

    static aiBusyUi(busy) {
        AppState.aiBusy = busy;
        const stop = document.getElementById('ai-stop-btn');
        const send = document.getElementById('ai-send-btn');
        if (stop) stop.hidden = !busy;
        if (send) send.disabled = busy;
    }

    static async stopAIStream() {
        const controller = AppState.aiAbort;
        if (controller) { try { controller.abort(); } catch {} }
        if (AppState.aiRunId) await AIService.stopRun(AppState.aiRunId);
    }

    static abortAIStream() {
        // 切题/退出时的静默中止：保留草稿，不弹确认
        const controller = AppState.aiAbort;
        if (controller) { try { controller.abort(); } catch {} }
        if (AppState.aiRunId) AIService.stopRun(AppState.aiRunId);
        AppState.aiAbort = null;
        AppState.aiRunId = '';
        AppState.aiBusy = false;
    }

    static async sendAIMessage() {
        if (!PreviewAccess.privateAllowed()) return;
        const input = document.getElementById('ai-input');
        const messagesEl = document.getElementById('ai-messages');
        if (!input || !messagesEl || AppState.aiBusy) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        const content = input.value.trim();
        if (!question || !content) return;
        if (!AppState.aiProfileId) await AIService.loadProfiles();
        if (!AppState.aiProfileId) {
            toast('请先在设置中选择或配置 AI 服务');
            this.navigate('settings');
            return;
        }

        const userMsg = document.createElement('div');
        userMsg.className = 'ai-message user';
        userMsg.innerHTML = `<div class="ai-message-bubble">${escapeHtml(content)}</div>`;
        messagesEl.appendChild(userMsg);

        const aiMsg = document.createElement('div');
        aiMsg.className = 'ai-message assistant';
        aiMsg.innerHTML = '<div class="ai-message-bubble" id="ai-current-response">正在思考…</div>';
        messagesEl.appendChild(aiMsg);
        const responseEl = document.getElementById('ai-current-response');
        messagesEl.scrollTop = messagesEl.scrollHeight;

        input.value = '';
        StorageService.saveAIDraft(question.id, '');
        const questionId = String(question.id);

        const controller = new AbortController();
        AppState.aiAbort = controller;
        AppState.aiRunId = '';
        this.aiBusyUi(true);
        let answer = '';
        try {
            const includePrivate = document.getElementById('ai-include-private-new')?.checked === true;
            const profile = AIService.activeProfile();
            const images = profile?.capabilities?.vision === 'passed' ? await AIService.questionImages(question) : [];
            const response = await AIService.chatStream({ question, prompt: content, includePrivate, images, signal: controller.signal });
            AppState.aiRunId = response.headers.get('X-Daguan-Run-Id') || '';
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let paintTimer = 0;
            const paint = () => {
                paintTimer = 0;
                if (!responseEl || !responseEl.isConnected) return;
                responseEl.textContent = answer || '正在思考…';
                const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
                if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
            };
            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parsed = AIService.parseSseChunk('', buffer);
                buffer = parsed.rest;
                for (const evt of parsed.events) {
                    if (evt.type === 'started' && evt.runId) AppState.aiRunId = evt.runId;
                    if (evt.type === 'delta') { answer += evt.content || ''; if (!paintTimer) paintTimer = setTimeout(paint, 120); }
                    if (evt.type === 'error') throw new Error(evt.error || 'AI 生成失败');
                }
            }
            if (paintTimer) clearTimeout(paintTimer);
            if (String(AppState.questions[AppState.currentQuestionIndex]?.id) !== questionId) return;
            if (responseEl) {
                responseEl.removeAttribute('id');
                responseEl.innerHTML = renderMarkdown(answer);
            }
        } catch (error) {
            if (String(AppState.questions[AppState.currentQuestionIndex]?.id) !== questionId) return;
            const aborted = error?.name === 'AbortError';
            if (responseEl) {
                responseEl.removeAttribute('id');
                responseEl.innerHTML = aborted
                    ? `<div class="ai-error">已停止生成。${answer ? '<div class="ai-partial">' + renderMarkdown(answer) + '</div>' : ''}</div>`
                    : `<div class="ai-error"><div>AI 暂时没有完成回答：${escapeHtml(error.message || String(error))}</div><button class="ai-retry-btn" onclick="App.retryAIMessage()">${aborted ? '' : '重试'}</button></div>`;
                if (!aborted) {
                    const retryBtn = responseEl.querySelector('.ai-retry-btn');
                    if (retryBtn) retryBtn.addEventListener('click', () => {
                        input.value = content;
                        StorageService.saveAIDraft(question.id, content);
                        this.sendAIMessage();
                    });
                }
            }
        } finally {
            if (AppState.aiAbort === controller) AppState.aiAbort = null;
            AppState.aiRunId = '';
            this.aiBusyUi(false);
        }
    }

    static retryAIMessage() {
        const input = document.getElementById('ai-input');
        if (input && input.value.trim()) this.sendAIMessage();
    }

    static switchAnnotationTab(tab) {
        const tabs = document.querySelectorAll('.annotation-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

        const textarea = document.getElementById('annotation-textarea');
        const preview = document.getElementById('annotation-preview');

        if (tab === 'edit') {
            textarea.classList.remove('hidden');
            preview.classList.add('hidden');
        } else {
            textarea.classList.add('hidden');
            preview.classList.remove('hidden');
            this.updateAnnotationPreview();
        }
    }

    static updateAnnotationPreview() {
        const textarea = document.getElementById('annotation-textarea');
        const preview = document.getElementById('annotation-preview');
        if (!textarea || !preview) return;

        // 简单的 Markdown 渲染
        let html = textarea.value
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        html = '<p>' + html + '</p>';
        preview.innerHTML = html;

        // 渲染 KaTeX
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(preview, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
    }

    static async saveAnnotation() {
        const textarea = document.getElementById('annotation-textarea');
        const statusEl = document.getElementById('annotation-status');
        if (!textarea || !statusEl) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        if (!question) return;
        const content = textarea.value;

        statusEl.textContent = '保存中…';
        statusEl.className = 'annotation-status saving';

        try {
            StorageService.saveAnnotation(question.id, content);
            // 本机已写入 → 先记待同步；服务端确认成功后由 confirmAnnotation 清除
            const stamp = (StorageService.readAnnotationsStorage()[String(question.id)] || {}).updated_at || new Date().toISOString();
            if (PendingSync) {
                try { PendingSync.queueAnnotation(question.id, content, stamp); } catch {}
            }
            if (StateSync.available && PreviewAccess.privateAllowed(false)) {
                await StateSync.flushAnnotation(question.id, content);
            }
            AppState.annotationDirty = false;
            const stillPending = !!readPendingSync().annotations[String(question.id)];
            statusEl.textContent = stillPending ? '已保存到本地，联网后自动同步' : '已保存';
            statusEl.className = 'annotation-status saved';

            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.className = 'annotation-status';
            }, 2000);
        } catch (error) {
            statusEl.textContent = '保存失败，请重试';
            statusEl.className = 'annotation-status error';
            AppState.annotationDirty = true;
            StateSync.scheduleRetry();
            throw error;
        }
    }

    static async autoSaveAnnotation() {
        const textarea = document.getElementById('annotation-textarea');
        const statusEl = document.getElementById('annotation-status');
        if (!textarea) return;

        const question = AppState.questions[AppState.currentQuestionIndex];
        if (!question) return;
        const content = textarea.value;

        try {
            StorageService.saveAnnotation(question.id, content);
            AppState.annotationDirty = false;
            // 本机已写入 → 先记待同步；服务端确认成功后由 confirmAnnotation 清除
            const stamp = (StorageService.readAnnotationsStorage()[String(question.id)] || {}).updated_at || new Date().toISOString();
            if (PendingSync) {
                try { PendingSync.queueAnnotation(question.id, content, stamp); } catch {}
            }
            if (StateSync.available && PreviewAccess.privateAllowed(false)) {
                statusEl.textContent = '保存中…';
                statusEl.className = 'annotation-status saving';
                await StateSync.flushAnnotation(question.id, content);
            }
            if (statusEl) {
                const stillPending = !!readPendingSync().annotations[String(question.id)];
                statusEl.textContent = stillPending ? '已保存到本地，联网后自动同步' : '已自动保存';
                statusEl.className = 'annotation-status saved';
            }
        } catch (error) {
            AppState.annotationDirty = true;
            StateSync.scheduleRetry();
            if (statusEl) {
                statusEl.textContent = '保存失败，请重试';
                statusEl.className = 'annotation-status error';
            }
        }
    }

    // 等待挂起的批注写入完成（切题/切换版本前调用）；失败抛错。
    static async flushAnnotationNow() {
        if (!AppState.annotationDirty) return;
        await this.saveAnnotation();
    }

    static toggleFilterDrawer() {
        const drawer = document.getElementById('filter-drawer');
        const overlay = document.getElementById('filter-overlay');
        if (!drawer || !overlay) return;

        AppState.ui.filterDrawerOpen = !AppState.ui.filterDrawerOpen;
        drawer.classList.toggle('open', AppState.ui.filterDrawerOpen);
        overlay.classList.toggle('open', AppState.ui.filterDrawerOpen);
    }

    static resetFilters() {
        AppState.filters = {
            sources: [],
            years: [],
            types: [],
            lecturers: []
        };

        document.querySelectorAll('.filter-checkbox input').forEach(input => {
            input.checked = false;
        });
        UIRenderer.renderLibraryResults();
        UIRenderer.saveDirectoryState();
    }

    static clearLibrarySearch() {
        AppState.libraryQuery = '';
        AppState.libraryResultLimit = 40;
        const input = document.getElementById('search-input');
        if (input) input.value = '';
        this.resetFilters();
    }

    static applyFilters() {
        // 收集筛选条件
        const filters = {
            sources: [],
            years: [],
            types: [],
            lecturers: []
        };

        document.querySelectorAll('#filter-sources input:checked').forEach(input => {
            filters.sources.push(input.value);
        });

        document.querySelectorAll('#filter-years input:checked').forEach(input => {
            filters.years.push(input.value);
        });

        document.querySelectorAll('#filter-types input:checked').forEach(input => {
            filters.types.push(input.value);
        });

        document.querySelectorAll('#filter-lecturers input:checked').forEach(input => {
            filters.lecturers.push(input.value);
        });

        AppState.filters = filters;
        AppState.libraryResultLimit = 40;
        this.toggleFilterDrawer();
        UIRenderer.renderLibraryResults();
        UIRenderer.saveDirectoryState();
    }

    static handleSearch = this.debounce((query) => {
        AppState.libraryQuery = String(query || '');
        AppState.libraryResultLimit = 40;
        UIRenderer.renderLibraryResults();
        UIRenderer.saveDirectoryState();
    }, 250);

    static showMoreLibraryResults() {
        AppState.libraryResultLimit += 40;
        UIRenderer.renderLibraryResults();
        UIRenderer.saveDirectoryState();
    }

    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static handleResize() {
        const width = window.innerWidth;
        AppState.ui.navExpanded = width >= 1280;
        if (width >= 1024 && AppState.ui.navOpen) this.toggleNav();
    }

    static toggleNav() {
        AppState.ui.navOpen = !AppState.ui.navOpen;
        const nav = document.getElementById('app-nav');
        const overlay = document.querySelector('body > .nav-overlay');

        if (nav) nav.classList.toggle('open', AppState.ui.navOpen);
        if (overlay) overlay.classList.toggle('open', AppState.ui.navOpen);
        const button = document.getElementById('btn-toggle-nav');
        button?.setAttribute('aria-expanded', String(AppState.ui.navOpen));
        button?.setAttribute('aria-label', AppState.ui.navOpen ? '关闭导航' : '打开导航');
    }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// 待同步编辑的自动补写钩子：恢复网络、页面重新可见时立刻重试（不需要用户手动操作）
(function registerPendingRetryHooks() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('online', () => { StateSync.retryPending(); });
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') StateSync.refreshFromEvent();
        });
    }
})();

// 导出到全局
window.AppState = AppState;
window.DataService = DataService;
window.StorageService = StorageService;
window.AIService = AIService;
window.UIRenderer = UIRenderer;
window.App = App;
window.PreviewAccess = PreviewAccess;
window.StateSync = StateSync;
if (typeof window.addEventListener === 'function') window.addEventListener('daguan:state-changed', () => { void StateSync.refreshFromEvent(); });
window.AI_COMPOSE_PROMPTS = AI_COMPOSE_PROMPTS;
