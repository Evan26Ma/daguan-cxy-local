/**
 * 大观园新版应用 - 阶段 2 核心业务整合
 * 基于原生 JavaScript，整合题库浏览、做题、AI、批注等完整功能
 */

// ========== 离线缓存注册（与 app2.js 一致） ==========
if ("serviceWorker" in navigator && location.protocol !== "file:" && location.protocol !== "https:") {
    navigator.serviceWorker.register("./service-worker.js?v=147").catch(() => {});
}

// ========== 全局状态 ==========
const AppState = {
    currentView: 'home', // home, library, question, review, notes, records, history, tools, settings
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
    visitHistory: [],
    historyFilters: { query: '', category: '', from: '', to: '', mastery: '', favorite: '', mistake: '' },
    historyLimit: 50,
    shortcuts: {},
    videoMappings: null,
    paradiyuVideoMapping: null,
    explanationsV2: null,        // 按需加载的 v2 补写解析：题号 -> 解析对象
    explanationsV2Meta: null,
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
    directoryPathIds: [],
    catalogExpandedIds: null,
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
const RESERVED_SHORTCUTS = new Set(['/', 'g']);
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

// 题源两级分类（体系 / 书目）由 source-taxonomy.js 提供；脚本没加载时退回上面的粗分桶。
function sourceTaxonomy() {
    return (typeof window !== 'undefined' && window.DaguanSourceTaxonomy) || null;
}

function sourceKeySet(source) {
    const taxonomy = sourceTaxonomy();
    if (taxonomy) return taxonomy.keySet(source);
    return new Set([sourceGroup(source)]);
}

function sourceMatches(selected, source) {
    if (!Array.isArray(selected) || selected.length === 0) return true;
    const keys = sourceKeySet(source);
    return selected.some(value => keys.has(value));
}

function sourceLabel(source, limit = 3) {
    const taxonomy = sourceTaxonomy();
    if (taxonomy) return taxonomy.describe(source, limit);
    return sourceGroup(source);
}

function sourceMetaText(source) {
    const raw = String(source || '').trim();
    if (!raw) return '未标注来源';
    const label = sourceLabel(raw);
    return label && label !== raw ? `${label} · ${raw}` : raw;
}

function isRealExamQuestion(question) {
    return /历年真题/.test(String(question?.category_path || ''))
        || /(?:19|20)\d{2}\s*(?:年)?\s*(?:数学|数)[一二三]/.test(String(question?.source || ''));
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
const UI_FONT_SCALES = [1, 1.15, 1.3, 1.5];
function normalizeFontScale(value) {
    const scale = Number(value);
    return UI_FONT_SCALES.includes(scale) ? scale : 1;
}
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
    root.style.setProperty('--ui-font-scale', String(normalizeFontScale(data.fontScale)));
}

// ========== 数据层 ==========
const DataService = window.DaguanNewData.create({ AppState, fetch: (...args) => fetch(...args) });
const { StorageService, StateSync, PROGRESS_KEY_SHARED, FAVORITES_KEY_SHARED, PendingSync, ANNOTATION_KEY_SHARED, RESTORE_PENDING_KEY, RESTORE_ROLLBACK_KEY, normalizeProgressEntry, readProgressStorage, writeProgressStorage, readPendingSync, pendingAnnotationEntry, pendingQuestionEntry, hasPendingSync, timestampOf } = window.DaguanNewState.create({
    window, document, localStorage, sessionStorage, fetch: (...args) => fetch(...args), AppState,
    normalizeFontScale, resolveChapterForQuestion, toast,
    getAccess: () => PreviewAccess, getRenderer: () => UIRenderer, getApp: () => App,
});
const { AIService, AI_COMPOSE_PROMPTS, AIViews, AIController } = window.DaguanNewAI.create({
    window, document, fetch: (...args) => fetch(...args), location, AppState, StorageService,
    assetUrl, escapeHtml, renderMarkdown, toast, getAccess: () => PreviewAccess, getRenderer: () => UIRenderer, getApp: () => App,
});

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
        const unlock = document.getElementById('btn-preview-unlock');
        if (unlock) unlock.hidden = !this.mode || this.unlocked;
        const lock = document.getElementById('btn-preview-lock');
        if (lock) lock.hidden = !this.mode || !this.unlocked;
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

const safeRender = window.DaguanSafeRender.create({ assetUrl });
function renderMarkdown(text) { return safeRender.markdown(text); }

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
    static scopeQuestionIdsCache = new Map();
    static scopeQuestionIdsInflight = new Map();

    static async ensureScopeQuestionIds(scope) {
        if (scope === 'all') return null;
        if (this.scopeQuestionIdsCache.has(scope)) return this.scopeQuestionIdsCache.get(scope);
        if (this.scopeQuestionIdsInflight.has(scope)) return this.scopeQuestionIdsInflight.get(scope);
        const job = (async () => {
            const names = Object.keys(AppState.manifest?.shards || {});
            if (!names.length) throw new Error('题库分片尚未加载');
            const maps = await Promise.all(names.map(name => DataService.ensureShard(name)));
            const ids = new Set();
            for (const map of maps) for (const question of map.values()) {
                if (scope === 'core' ? question.is_core === true : isRealExamQuestion(question)) ids.add(String(question.id));
            }
            this.scopeQuestionIdsCache.set(scope, ids);
            return ids;
        })();
        this.scopeQuestionIdsInflight.set(scope, job);
        try { return await job; } finally { this.scopeQuestionIdsInflight.delete(scope); }
    }

    static scopeCountForNode(node, directOnly = false) {
        const entries = directOnly ? (node?.direct_questions || []) : (node?.questions || []);
        if (AppState.chapterScope === 'all' || !this.scopeQuestionIdsCache.has(AppState.chapterScope)) {
            return directOnly ? Number(node?.direct_count ?? entries.length) : Number(node?.question_count ?? entries.length);
        }
        const ids = this.scopeQuestionIdsCache.get(AppState.chapterScope);
        return entries.reduce((count, entry) => count + Number(ids.has(String(entry.id))), 0);
    }
    static lastPositionTrail() {
        const position = StorageService.getLearningPosition();
        const category = position && this.findCategoryById(position.categoryId);
        const trail = category && this.pathToNode(category, position.chapterId);
        const leaf = trail?.at(-1);
        if (!leaf || !DataService.chapterEntries(leaf).some(entry => String(entry.id) === String(position.questionId))) return null;
        return { position, trail };
    }
    static renderHome() {
        const main = document.getElementById('app-main');
        const progress = StorageService.getProgress();
        const position = StorageService.getLearningPosition();

        let continueSection = '';
        if (position) {
            const category = this.findCategoryById(position.categoryId);
            const chapter = category ? this.findChapterById(category, position.chapterId) : null;

            if (chapter && DataService.chapterEntries(chapter).some(entry => String(entry.id) === String(position.questionId))) {
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

        const showWelcome = localStorage.getItem('daguan_welcome_once_v2') !== '1';
        main.innerHTML = `
            <div class="home-content">
                ${showWelcome ? `<section class="guide-card-entry home-welcome" id="home-welcome"><div><p class="guide-kicker">第一次来？</p><strong>欢迎来到大观园</strong><p>先挑一章做题；需要时打开页面内教程，跟着步骤操作。</p></div><div class="guide-actions"><button class="btn btn-primary" onclick="App.showUserGuide()">开始看教程</button><button class="btn btn-text" onclick="document.getElementById('home-welcome')?.remove()">我先自己看看</button></div></section>` : ''}
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

                <section class="home-sync-card" aria-labelledby="home-sync-title">
                    <div><p class="guide-kicker">官网同步</p><h2 id="home-sync-title">本地刷题，按需同步进度</h2><p id="home-sync-status" role="status">学习记录自动保存在本机。正在检查官网连接…</p></div>
                    <div class="home-sync-actions"><button type="button" class="btn btn-primary" onclick="App.openSyncCenter()">同步进度</button><button type="button" class="btn btn-secondary" onclick="App.showUserGuide()">使用教程</button></div>
                </section>

                <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">科目浏览</h2>
                <div class="subject-grid">
                    ${this.renderSubjectCards()}
                </div>
            </div>
        `;
        if (showWelcome) localStorage.setItem('daguan_welcome_once_v2', '1');
        window.DaguanStudyReport?.mount(document.querySelector('.home-grid'));
        App.refreshHomeSyncStatus();
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

    static renderLibrary(categoryId, { selectedNodeId = null, resetScroll = false } = {}) {
        const category = this.findCategoryById(categoryId);
        if (!category) return;
        const saved = this.readDirectoryState().subjects[String(category.id)] || {};
        const savedNodeId = saved.nodeId ?? (Array.isArray(saved.pathIds) ? saved.pathIds.at(-1) : null);
        if (selectedNodeId != null && this.findNodeById(category, selectedNodeId)) AppState.directoryNodeId = String(selectedNodeId);
        else if (this.findNodeById(category, savedNodeId)) AppState.directoryNodeId = String(savedNodeId);
        else if (!AppState.directoryNodeId || !this.findNodeById(category, AppState.directoryNodeId)) AppState.directoryNodeId = String(category.id);
        AppState.libraryScrollTop = resetScroll ? 0 : Number(saved.scrollTop) || 0;
        AppState.libraryQuery = String(saved.query || '');
        AppState.libraryResultLimit = Number(saved.resultLimit) || 40;
        AppState.filters = saved.filters && typeof saved.filters === 'object' ? saved.filters : { sources: [], years: [], types: [], lecturers: [] };
        const active = this.findNodeById(category, AppState.directoryNodeId) || category;
        AppState.directoryPathIds = (this.pathToNode(category, active.id) || [category]).map(part => String(part.id));

        const main = document.getElementById('app-main');
        main.innerHTML = `
            <div class="library-layout catalog-page">
                <div class="library-main">
                    <div class="library-header">
                        <nav class="library-breadcrumb" id="library-breadcrumb" aria-label="当前目录路径"></nav>
                        <div class="library-title-row"><h1 id="library-node-title">${escapeHtml(active.name || active.title || category.name)}</h1></div>
                        ${StorageService.getLearningPosition() && !this.lastPositionTrail() ? '<p class="text-helper" role="status">上次学习的题目已不在当前题库，无法直达；可重新选择小节。</p>' : ''}
                        <div class="library-toolbar">
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
                        <div class="catalog-scopes" role="group" aria-label="题库范围">${this.scopeButtons()}</div>
                        <p class="catalog-scope-summary" id="catalog-scope-summary" role="status">${this.scopeSummaryText()}</p>
                    </div>
                    <div class="library-content" id="library-content"></div>
                </div>
            </div>

            <div class="filter-overlay" id="filter-overlay" onclick="App.toggleFilterDrawer()"></div>
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

        this.bindScopeButtons();
        this.renderFilterOptions();
        document.getElementById('search-input').value = AppState.libraryQuery;
        this.renderDirectoryNode(active);
        const filtering = AppState.libraryQuery.trim() || Object.values(AppState.filters || {}).some(values => Array.isArray(values) && values.length);
        if (filtering) this.renderLibraryResults();
        const content = document.getElementById('library-content');
        if (content) content.scrollTop = AppState.libraryScrollTop;
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
            const category = this.findCategoryById(categoryId);
            const path = category ? (this.pathToNode(category, AppState.directoryNodeId) || [category]) : [];
            saved.subjects[String(categoryId)] = {
                nodeId: String(AppState.directoryNodeId || categoryId),
                pathIds: path.map(node => String(node.id)),
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
            <fieldset class="font-scale-settings"><legend>界面字号</legend><p class="text-helper">放大题目、答案和界面文字；选择后自动保存，只影响这台设备的新版界面。</p><div class="font-scale-choices">${UI_FONT_SCALES.map(scale => `<button type="button" class="font-scale-choice" data-font-scale="${scale}" aria-pressed="${saved.fontScale === scale}">${Math.round(scale * 100)}%</button>`).join('')}</div></fieldset>
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
        document.querySelectorAll('[data-font-scale]').forEach(button => button.addEventListener('click', () => {
            AppState.appearanceDraft.fontScale = normalizeFontScale(button.dataset.fontScale);
            // 字号即时生效并保存；颜色仍按“应用/取消”的预览流程处理。
            StorageService.saveUIAppearance({ ...StorageService.getUIAppearance(), fontScale: AppState.appearanceDraft.fontScale });
            document.querySelectorAll('[data-font-scale]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
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
            AppState.appearanceDraft = { ...base, theme: base.id, fontScale: 1 };
            document.querySelectorAll('[data-appearance-color]').forEach(input => { input.value = base[input.dataset.appearanceColor]; });
            document.querySelectorAll('[data-theme-preset]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.themePreset === base.id)));
            document.querySelectorAll('[data-font-scale]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.fontScale === '1')));
            preview();
        });
    }

    // 级联目录模型：每一列只保留当前路径下的一层，节点 id 而非名称决定路径，
    // 因此同名章节也能各自保持选中态和恢复位置。
    static catalogColumns(category, activeNode = null) {
        const roots = AppState.categories?.categories || [];
        const activePath = activeNode ? (this.pathToNode(category, activeNode.id) || [category]) : [category];
        const columns = [];
        let nodes = roots;
        let parent = null;
        for (let depth = 0; ; depth += 1) {
            const selected = activePath[depth] || null;
            columns.push({
                depth,
                parent,
                nodes,
                selectedId: selected ? String(selected.id) : null,
                items: nodes.map(node => ({
                    node,
                    selected: !!selected && String(node.id) === String(selected.id),
                    hasChildren: !!(node.children || []).length,
                    questionCount: this.scopeCountForNode(node),
                    directCount: this.scopeCountForNode(node, true),
                })),
                directNode: parent && (parent.children || []).length && (parent.direct_questions || parent.questions || []).length ? parent : null,
            });
            if (!selected || !(selected.children || []).length) break;
            parent = selected;
            nodes = selected.children || [];
        }
        return columns;
    }

    static renderCatalogColumns(category, activeNode = null) {
        const host = document.getElementById('directory-columns');
        if (!host) return;
        const columns = this.catalogColumns(category, activeNode);
        const last = this.lastPositionTrail();
        const lastIds = new Set(last?.trail.map(node => String(node.id)) || []);
        host.innerHTML = columns.map(column => {
            const parentName = column.parent ? (column.parent.name || column.parent.title || '章节') : '科目';
            const items = column.items.map(({ node, selected, hasChildren, questionCount }) => {
                const name = node.name || node.title || '';
                const rootCategoryId = column.depth === 0 ? node.id : category.id;
                const onLastPath = lastIds.has(String(node.id));
                return `<div class="directory-column-row"><button type="button" class="directory-column-item${selected ? ' selected' : ''}${hasChildren ? ' has-children' : ''}" role="option" aria-selected="${selected}" aria-current="${selected ? 'page' : 'false'}" data-catalog-node="${escapeHtml(String(node.id))}" data-catalog-category="${escapeHtml(String(rootCategoryId))}" data-catalog-depth="${column.depth}" aria-label="${escapeHtml(name)}，当前范围 ${questionCount} 题"><span class="directory-column-name">${escapeHtml(name)}</span><small>${questionCount} 题</small>${hasChildren ? '<span class="directory-column-chevron" aria-hidden="true">›</span>' : '<span aria-hidden="true"></span>'}</button>${onLastPath ? `<button type="button" class="directory-resume" data-resume-last aria-label="回到上次做到的题号 ${escapeHtml(String(last.position.questionId))}">上次${String(node.id) === String(last.trail.at(-1).id) ? ` · 题号 ${escapeHtml(String(last.position.questionId))}` : ''} ↗</button>` : ''}</div>`;
            }).join('');
            const direct = column.directNode;
            const directCount = direct ? this.scopeCountForNode(direct, true) : 0;
            const directHtml = direct && directCount ? `<button type="button" class="directory-column-item directory-direct-item" data-cascade-direct="${escapeHtml(String(direct.id))}" data-catalog-category="${escapeHtml(String(category.id))}" aria-label="练习 ${escapeHtml(direct.name || direct.title || '')} 的本级直属题"><span class="directory-column-name"><strong>本级直属题</strong><small>只练习${escapeHtml(direct.name || direct.title || '')}</small></span><small>${directCount} 题</small><span aria-hidden="true">↗</span></button>` : '';
            return `<section class="directory-column" role="listbox" aria-label="${escapeHtml(parentName)}下级"><h2 class="directory-column-heading">${escapeHtml(parentName)}${column.depth ? ' · 下级' : ''}</h2><div class="directory-column-list">${items || '<p class="directory-column-empty">暂无下级章节</p>'}${directHtml}</div></section>`;
        }).join('');
        host.querySelectorAll('[data-catalog-node]').forEach(button => button.addEventListener('click', () => App.selectDirectoryItem(button.dataset.catalogCategory, button.dataset.catalogNode)));
        host.querySelectorAll('[data-cascade-direct]').forEach(button => button.addEventListener('click', () => App.startDirectDirectory(button.dataset.catalogCategory, button.dataset.cascadeDirect)));
        host.querySelectorAll('[data-resume-last]').forEach(button => button.addEventListener('click', () => App.resumeLearning()));
        const reveal = () => { host.scrollLeft = Math.max(0, host.scrollWidth - host.clientWidth); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal); else setTimeout(reveal, 0);
    }

    static renderDirectoryNode(node) {
        if (!node) return;
        const contentEl = document.getElementById('library-content');
        if (!contentEl) return;
        const category = AppState.currentCategory;
        const path = this.pathToNode(category, node.id) || [category, node];
        AppState.directoryPathIds = path.map(part => String(part.id));
        const crumbs = path.map((part, index) => `<button type="button" class="breadcrumb-part" data-node-id="${escapeHtml(String(part.id))}" aria-current="${index === path.length - 1 ? 'page' : 'false'}">${escapeHtml(part.name || part.title || '')}</button>`);
        const breadcrumbEl = document.getElementById('library-breadcrumb');
        breadcrumbEl.innerHTML = crumbs.join('<span aria-hidden="true">›</span>');
        document.querySelectorAll('.breadcrumb-part').forEach(button => button.addEventListener('click', () => App.openDirectoryNode(button.dataset.nodeId)));
        // 深层目录保持完整路径，只把当前末级滚入视野；用户仍可向左横向回看上级。
        breadcrumbEl.scrollLeft = Math.max(0, Number(breadcrumbEl.scrollWidth || 0) - Number(breadcrumbEl.clientWidth || 0));
        document.getElementById('library-node-title').textContent = node.name || node.title || '';
        const direct = node.direct_questions || node.questions || [];
        const position = StorageService.getLearningPosition();
        const positionIndex = position && String(position.categoryId) === String(category.id) && String(position.chapterId) === String(node.id)
            ? Math.max(0, Number(position.questionIndex) || 0) : -1;
        const isLeaf = !(node.children || []).length;
        const directTotal = this.scopeCountForNode(node, true);
        const locationText = positionIndex >= 0 ? `已到第 ${positionIndex + 1} 题 · 题号 ${escapeHtml(String(position.questionId || direct[positionIndex]?.id || ''))}` : '本机还没有此章节的学习位置';
        contentEl.innerHTML = `<section class="directory-cascade" aria-label="题库级联目录"><div class="directory-columns" id="directory-columns" tabindex="0" aria-label="横向章节目录"></div><div class="directory-selection-state" id="directory-selection-state" role="status"></div></section>`;
        this.renderCatalogColumns(category, node);
        const state = document.getElementById('directory-selection-state');
        if (state && isLeaf && directTotal === 0) state.innerHTML = AppState.chapterScope === 'all'
            ? `<div class="empty-state"><h3>此章节暂无题目</h3><p>该空节点可从目录定位，但没有可开始的题目。</p></div>`
            : `<div class="empty-state"><h3>此范围暂无题目</h3><p>可切换“完整 / 严选 / 真题”查看其他范围。</p></div>`;
        else if (state && isLeaf && directTotal) state.innerHTML = `<div class="directory-leaf-actions"><p>${locationText}；当前范围有 ${directTotal} 题，点击当前小节可开始练习。</p><button type="button" class="btn btn-primary" id="start-directory">按当前范围开始练习</button>${positionIndex >= 0 ? '<button type="button" class="btn btn-secondary" id="continue-directory">继续上次练习</button>' : ''}</div>`;
        else if (state && directTotal && (node.children || []).length) state.innerHTML = `<p class="directory-help">${escapeHtml(node.name || node.title || '')} 当前范围含 ${directTotal} 道直属题；可在最右列单独练习。</p>`;
        document.getElementById('start-directory')?.addEventListener('click', () => App.showChapter(node));
        document.getElementById('continue-directory')?.addEventListener('click', () => App.continueDirectoryNode(node));
        contentEl.onscroll = () => this.saveDirectoryState();
    }

    static renderChapterList(category) { this.renderDirectoryNode(category); }

    static scopeButtons() {
        return [['all', '完整'], ['core', '严选'], ['real', '真题']].map(([key, label]) => `<button type="button" class="catalog-scope${AppState.chapterScope === key ? ' active' : ''}" data-chapter-scope="${key}" aria-pressed="${AppState.chapterScope === key}">${label}</button>`).join('');
    }

    static scopeSummaryText() {
        const scope = AppState.chapterScope;
        const count = scope === 'all' ? Number(AppState.manifest?.total || 0) : this.scopeQuestionIdsCache.get(scope)?.size;
        const name = scope === 'core' ? '严选' : scope === 'real' ? '真题' : '完整';
        return `${name}范围 · 全库去重 ${count ?? '统计中'} 题；目录按章节关联统计`;
    }

    static bindScopeButtons() {
        document.querySelectorAll('[data-chapter-scope]').forEach(button => button.addEventListener('click', () => App.changeChapterScope(button.dataset.chapterScope)));
    }

    static bindChapterPickerTriggers() {
        document.querySelectorAll('[data-open-chapter-picker]').forEach(button => button.addEventListener('click', () => App.openChapterPicker()));
    }

    static chapterScopeMatch(question) {
        if (AppState.chapterScope === 'core' && !question?.is_core) return false;
        if (AppState.chapterScope === 'real' && !isRealExamQuestion(question)) return false;
        const filters = AppState.filters || {};
        if (filters.sources?.length && !sourceMatches(filters.sources, question?.source)) return false;
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
                const count = this.scopeCountForNode(node);
                return `<button type="button" class="chapter-picker-item${selected ? ' active' : ''}${hasBranch ? ' has-children' : ''}" role="option" aria-selected="${selected}" aria-expanded="${hasBranch ? selected : 'false'}" data-picker-id="${escapeHtml(String(node.id))}" data-picker-depth="${depth}"><span>${escapeHtml(node.name || node.title || '')}</span><small>${count} 题</small>${hasBranch ? '<span aria-hidden="true">›</span>' : ''}</button>`;
            }).join('')}${path.at(-1) && this.scopeCountForNode(path.at(-1), true) ? `<button type="button" class="chapter-picker-item direct-picker-item" data-picker-direct="${escapeHtml(String(path.at(-1).id))}" data-picker-depth="${depth}"><span>本级直属题</span><small>${this.scopeCountForNode(path.at(-1), true)} 题</small></button>` : ''}</div>`);
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
        host.innerHTML = `<div class="chapter-picker-backdrop" data-picker-close></div><section class="chapter-picker-dialog" role="dialog" aria-modal="true" aria-label="选择小节"><header><div><p>章节导航</p><h2>${escapeHtml(pathNodes.at(-1)?.name || '选择小节')}</h2></div><button type="button" class="btn btn-text" data-picker-close aria-label="关闭章节导航">关闭</button></header><div class="chapter-picker-controls">${this.scopeButtons()}</div><nav class="chapter-picker-path" aria-label="当前目录路径"><button type="button" data-picker-path="0">科目</button>${pathNodes.map((node, index) => `<span aria-hidden="true">›</span><button type="button" data-picker-path="${index + 1}" aria-current="${index === pathNodes.length - 1 ? 'page' : 'false'}">${escapeHtml(node.name || node.title || '')}</button>`).join('')}</nav><div class="chapter-picker-columns">${columns.join('')}</div><footer><button type="button" class="btn btn-secondary" data-picker-back ${backDisabled}>上一级</button><p class="chapter-picker-feedback" role="status" aria-live="polite">目录题数按当前范围统计；详细筛选进入章节后生效。</p></footer></section>`;
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

    /**
     * 搜索与筛选用全库口径：与目录摘要「全库去重 N 题」、以及旧版高级筛选保持一致。
     * 目录树仍按科目浏览，但一旦启用搜索或筛选，范围就是整库，
     * 这样筛选面板上的题量计数与实际结果数必然相等。
     */
    static libraryFilterRows() {
        return AppState.searchIndex || [];
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
        const matches = this.libraryFilterRows().filter(row => {
            const scopeIds = this.scopeQuestionIdsCache.get(AppState.chapterScope);
            if (AppState.chapterScope !== 'all' && !scopeIds?.has(String(row.id))) return false;
            if (query && !App.normalizeSearchText(`${row.id} ${row.stem || ''} ${row.source || ''} ${row.path || ''}`).includes(query)) return false;
            if (filters.sources.length && !sourceMatches(filters.sources, row.source)) return false;
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
                        <span class="search-result-meta">${escapeHtml(sourceMetaText(row.source))} · ${questionTypeLabel(row.type)} · 题号 ${row.id}</span>
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

    /**
     * 题目来源筛选：优先渲染「体系 → 书目」两级树（source-taxonomy.js），
     * 分类脚本缺失时退回旧的平铺粗分桶，保证老浏览器/离线壳仍可用。
     */
    static sourceFilterMarkup(rows, checkbox) {
        const selected = AppState.filters.sources || [];
        const taxonomy = sourceTaxonomy();
        if (!taxonomy) {
            const counts = new Map();
            for (const row of rows) {
                const group = sourceGroup(row.source);
                counts.set(group, (counts.get(group) || 0) + 1);
            }
            return [...counts].sort((a, b) => b[1] - a[1])
                .map(([group, count]) => checkbox(group, `${group}（${count}）`, selected.includes(group)))
                .join('');
        }
        const systemCounts = new Map();
        const bookCounts = new Map();
        for (const row of rows) {
            const result = taxonomy.classify(row.source);
            for (const id of new Set(result.systems)) systemCounts.set(id, (systemCounts.get(id) || 0) + 1);
            for (const id of new Set(result.books)) bookCounts.set(id, (bookCounts.get(id) || 0) + 1);
        }
        const options = taxonomy.options()
            .map(option => ({ ...option, count: systemCounts.get(option.system.id) || 0 }))
            .filter(option => option.count > 0)
            .sort((a, b) => b.count - a.count);
        return options.map(option => {
            const head = checkbox(option.key, `${option.system.emoji || ''} ${option.system.label}（${option.count}）`.trim(), selected.includes(option.key));
            const books = (option.books || [])
                .map(entry => ({ ...entry, count: bookCounts.get(entry.book.id) || 0 }))
                .filter(entry => entry.count > 0)
                .sort((a, b) => b.count - a.count);
            if (!books.length) return `<div class="filter-source-group">${head}</div>`;
            return `<div class="filter-source-group">${head}<div class="filter-source-books">${books
                .map(entry => checkbox(entry.key, `${entry.book.label}（${entry.count}）`, selected.includes(entry.key)))
                .join('')}</div></div>`;
        }).join('');
    }

    static renderFilterOptions() {
        const filterContent = document.getElementById('filter-content');
        if (!filterContent) return;

        const rows = this.libraryFilterRows();
        const years = [...new Set(rows.map(row => sourceYear(row.source)).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
        const types = [...new Set(rows.map(row => row.type).filter(Boolean))];
        const checkbox = (value, label, selected) => `<label class="filter-checkbox"><input type="checkbox" value="${escapeHtml(value)}" ${selected ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
        const sourceOptions = this.sourceFilterMarkup(rows, checkbox);

        filterContent.innerHTML = `
            <div class="filter-section">
                <h3>题目来源</h3>
                <div class="filter-options" id="filter-sources">${sourceOptions}</div>
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
                    ${['帕拉迪宇', '李艳芳', '没咋了', '喻老'].map(name => checkbox(name, name, AppState.filters.lecturers.includes(name))).join('')}
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
        window.DaguanStudyActivity?.beginSingle(question.id);

        AppState.currentQuestionIndex = questionIndex;

        const main = document.getElementById('app-main');
        const aiSnapshot = this.captureAIPanel();
        main.scrollTop = 0;
        const progress = StorageService.getProgress();
        const isFav = StorageService.isFavorite(question.id);
        const isMistake = StorageService.isMistake(question.id);
        const mastery = progress.progress[String(question.id)]?.mastery || 'not_started';
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
                        <div class="question-sequence" data-question-id="${escapeHtml(String(question.id))}">
                            <span>第 ${questionIndex + 1} 题 / 共 ${AppState.chapterQuestionCount || AppState.questions.length} 题</span>
                            ${this.renderQuestionStatusBadges(mastery, isMistake)}
                        </div>
                        ${AppState.globalSearchReturn ? '<button type="button" class="btn btn-secondary" onclick="App.returnToGlobalSearch()">返回搜索</button>' : ''}
                    </div>

                    ${AppState.currentCategory && AppState.currentChapter ? `<div class="mode-toolbar"><span>单题做题</span><div class="mode-toolbar-actions"><button type="button" class="mode-jump-button" data-shortcut-hint="jump" onclick="App.promptJumpToQuestion()">跳题</button><div class="mode-switch"><button type="button" class="active" aria-pressed="true">单题做题</button><button type="button" onclick="App.changeQuestionMode('multi')">连续做题</button></div></div></div>` : ''}

                    <div class="question-content" id="question-content">
                        <div class="question-wrapper" data-question-id="${escapeHtml(String(question.id))}">
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

                            ${this.renderQuestionContent(question, {
                                statusControls: this.renderQuestionStatusControls(question.id, mastery, isMistake)
                            })}
                        </div>
                    </div>

                    <div class="question-footer">
                        <div class="footer-nav">
                            <button class="btn btn-secondary" data-shortcut-hint="up"
                                onclick="App.previousQuestion()"
                                ${questionIndex === 0 && !App.adjacentQuestionSections(-1).length ? 'disabled' : ''}>
                                上一题
                            </button>
                            <button class="btn btn-secondary" id="show-answer-btn" data-shortcut-hint="answer"
                                onclick="App.toggleAnswer()">
                                显示答案
                            </button>
                            <button class="btn btn-secondary" data-shortcut-hint="down"
                                onclick="App.nextQuestion()"
                                ${questionIndex === AppState.questions.length - 1 && !App.adjacentQuestionSections(1).length && !AppState.currentChapter ? 'disabled' : ''}>
                                下一题
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
        if (AppState.currentCategory && AppState.currentChapter && !AppState.suspendLastStudy && !AppState.temporaryQuestionView) {
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
        if (!this.restoreAIPanel(aiSnapshot, question) && AppState.ui.aiPanelOpen) this.renderAIPanel();
    }

    static renderMultiQuestions(activeIndex = AppState.currentQuestionIndex) {
        window.DaguanStudyActivity?.beginFeed(AppState.questions.map(q => q.id));
        const main = document.getElementById('app-main');
        const aiSnapshot = this.captureAIPanel();
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
            const stem = this.renderQuestionContent(question, {
                multi: true,
                statusControls: this.renderQuestionStatusControls(id, mastery, mistake, false)
            })
                .replace(/ id="(?:question-options|answer-section)"/g, '');
            return `<article class="multi-question-card${active ? ' active-question' : ''}" id="multi-question-${globalIndex}" data-question-id="${escapeHtml(id)}">
                <header class="multi-question-head"><div><span class="multi-question-number">第 ${globalIndex + 1} 题</span>${this.renderQuestionStatusBadges(mastery, mistake)}<span class="multi-question-id">题号 ${escapeHtml(id)}</span><span class="multi-question-source">${escapeHtml(question.source || '')}${question.year ? ` · ${escapeHtml(question.year)}年` : ''}</span></div>
                <div class="multi-card-actions">
                  <button type="button" class="action-btn${favorite ? ' active' : ''}" onclick="App.toggleQuestionFavorite('${escapeHtml(id)}')">收藏</button>
                  <button type="button" class="action-btn" onclick="App.openQuestionAnnotation('${escapeHtml(id)}')">批注</button>
                  <button type="button" class="action-btn" onclick="App.openQuestionAI('${escapeHtml(id)}')">AI 辅助</button>
                </div></header>
                <div class="multi-question-reading">${stem}</div>
                <div class="multi-question-status"><button type="button" class="expand-answer-btn" aria-expanded="false" onclick="App.toggleCardAnswer(${globalIndex}, this)">显示答案</button></div>
            </article>`;
        }).join('');
        const pageStart = Math.floor(start / 20) * 20;
        const railTools = `<div class="question-rail-tools"><label class="sr-only">按题号定位</label><input type="search" inputmode="numeric" aria-label="按题号定位" placeholder="题号" value="${escapeHtml(AppState.questionRailQuery)}" oninput="App.filterQuestionIndex(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();App.jumpByQuestionNumber(this.value)}"><div class="question-rail-filters"><button type="button" data-rail-filter="favorite" aria-pressed="${AppState.questionRailFilter === 'favorite'}" class="${AppState.questionRailFilter === 'favorite' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('favorite')">收藏</button><button type="button" data-rail-filter="error-prone" aria-pressed="${AppState.questionRailFilter === 'error-prone'}" class="${AppState.questionRailFilter === 'error-prone' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('error-prone')">易错</button><button type="button" data-rail-filter="learning" aria-pressed="${AppState.questionRailFilter === 'learning'}" class="${AppState.questionRailFilter === 'learning' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('learning')">学习中</button><button type="button" data-rail-filter="mastered" aria-pressed="${AppState.questionRailFilter === 'mastered'}" class="${AppState.questionRailFilter === 'mastered' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('mastered')">已掌握</button><button type="button" data-rail-filter="not_started" aria-pressed="${AppState.questionRailFilter === 'not_started'}" class="${AppState.questionRailFilter === 'not_started' ? 'active' : ''}" onclick="App.toggleQuestionRailFilter('not_started')">未开始</button></div></div>`;
        main.innerHTML = `<div class="multi-question-view">
            <div class="question-header"><div class="breadcrumb-nav"><a href="#" onclick="App.showHome(); return false;">首页</a><span class="breadcrumb-sep">/</span><a href="#" onclick="App.showLibrary('${escapeHtml(AppState.currentCategory?.id || '')}'); return false;">${escapeHtml(AppState.currentCategory?.name || '题库')}</a><span class="breadcrumb-sep">/</span><span>${escapeHtml(AppState.currentChapter?.name || AppState.currentChapter?.title || '章节')}</span></div><div class="question-sequence">${total} 题 · 每段 20 题</div>${AppState.globalSearchReturn ? '<button type="button" class="btn btn-secondary" onclick="App.returnToGlobalSearch()">返回搜索</button>' : ''}</div>
            <div class="mode-toolbar"><span>连续做题 · 第 ${pageStart + 1}–${Math.min(pageStart + AppState.questions.length, total)} 题</span><div class="mode-toolbar-actions"><button type="button" class="mode-step-button" onclick="App.previousQuestion()">上一题</button><button type="button" class="mode-step-button" onclick="App.nextQuestion()">下一题</button><button type="button" class="mode-jump-button" onclick="App.promptJumpToQuestion()">跳题</button><div class="mode-switch"><button type="button" onclick="App.changeQuestionMode('single')">单题做题</button><button type="button" class="active" aria-pressed="true">连续做题</button></div><button type="button" class="mobile-question-index-btn" onclick="App.toggleQuestionDrawer()">题号目录</button></div></div>
            <div class="multi-reading-layout"><aside class="question-rail" aria-label="题号目录">${railTools}${rangeButtons}</aside><div class="multi-question-list">${cards}<div class="multi-page-nav"><button type="button" class="btn btn-secondary" ${start === 0 ? 'disabled' : ''} onclick="App.goToChapterQuestion(${Math.max(0, start - 1)})">上一段</button><button type="button" class="btn btn-secondary" ${start + AppState.questions.length >= total ? 'disabled' : ''} onclick="App.goToChapterQuestion(${Math.min(total - 1, start + AppState.questions.length)})">下一段</button></div></div></div>
            <div class="question-drawer-backdrop" onclick="App.toggleQuestionDrawer()"></div><aside class="question-drawer" aria-label="题号目录">${railTools}${rangeButtons}</aside>
            <div class="ai-panel closed" id="ai-panel"></div><div class="annotation-panel closed" id="annotation-panel"></div>
        </div>`;
        this.bindChapterPickerTriggers();
        App.refreshShortcutHints(main);
        this.renderKaTeX();
        AppState.currentQuestionIndex = Math.min(Math.max(0, activeIndex), AppState.questions.length - 1);
        App.filterQuestionRailItems();
        main.onscroll = () => {
            clearTimeout(this.multiScrollTimer);
            this.multiScrollTimer = setTimeout(() => {
                if (AppState.currentView !== 'question' || AppState.questionMode !== 'multi') return;
                const cards = [...main.querySelectorAll('.multi-question-card')];
                const top = main.getBoundingClientRect().top + 100;
                const active = cards.filter(card => card.getBoundingClientRect().top <= top).at(-1) || cards[0];
                const local = cards.indexOf(active);
                if (local < 0 || local === AppState.currentQuestionIndex) return;
                AppState.currentQuestionIndex = local;
                const question = AppState.questions[local];
                if (!question) return;
                StorageService.saveLearningPosition(AppState.currentCategory.id, AppState.currentChapter.id, AppState.questionOffset + local, question.id, 'multi');
                App.recordVisit(question.id, AppState.currentCategory.id, AppState.currentChapter.id);
                void StateSync.pushLastStudy(AppState.currentChapter.id, question.id, 'multi');
                main.querySelectorAll('.question-rail-item').forEach(button => button.classList.toggle('current', button.dataset.questionId === String(question.id)));
            }, 180);
        };
        const selected = AppState.questions[AppState.currentQuestionIndex];
        if (selected && AppState.currentCategory && AppState.currentChapter && !AppState.suspendLastStudy && !AppState.temporaryQuestionView) {
            StorageService.saveLearningPosition(AppState.currentCategory.id, AppState.currentChapter.id, start + AppState.currentQuestionIndex, selected.id, 'multi');
        }
        if (!this.restoreAIPanel(aiSnapshot, selected) && AppState.ui.aiPanelOpen) this.renderAIPanel();
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

    static renderQuestionStatusBadges(mastery, mistake) {
        const normalizedMastery = ['not_started', 'learning', 'mastered'].includes(mastery) ? mastery : 'not_started';
        return `<span class="question-status-badges" aria-label="题目状态">
            <span class="question-mastery-badge mastery-${normalizedMastery}">${masteryLabel(normalizedMastery)}</span>
            <span class="question-mistake-badge"${mistake ? '' : ' hidden'}>易错</span>
        </span>`;
    }

    static renderQuestionStatusControls(questionId, mastery, mistake, showShortcutHints = true) {
        const id = escapeHtml(String(questionId));
        const normalizedMastery = ['not_started', 'learning', 'mastered'].includes(mastery) ? mastery : 'not_started';
        const choices = [
            ['not_started', '未开始', 'mastery1'],
            ['learning', '学习中', 'mastery2'],
            ['mastered', '已掌握', 'mastery3']
        ];
        return `<div class="question-mastery-controls" role="group" aria-label="掌握程度">
            <span class="question-mastery-label">掌握程度</span>
            <div class="question-mastery-choices">${choices.map(([value, label, shortcut]) => `
                <button type="button" class="mastery-btn question-mastery-choice mastery-${value}${normalizedMastery === value ? ' active' : ''}"
                    data-mastery-choice="${value}" ${showShortcutHints ? `data-shortcut-hint="${shortcut}"` : ''} aria-label="掌握程度：${label}"
                    aria-pressed="${normalizedMastery === value}" onclick="App.setQuestionMastery('${id}', '${value}')">${label}</button>
            `).join('')}</div>
            <button type="button" class="mastery-btn question-mistake-toggle${mistake ? ' active' : ''}"
                ${showShortcutHints ? 'data-shortcut-hint="error"' : ''} aria-pressed="${mistake}" onclick="App.toggleQuestionMistake('${id}')">${mistake ? '✓ ' : ''}易错</button>
        </div>`;
    }

    static renderQuestionContent(question, { multi = false, statusControls = '' } = {}) {
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
                        <div class="option-item" role="button" tabindex="0" aria-pressed="false" data-correct="${correct ? '1' : '0'}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}" onclick="${multi ? `App.selectQuestionOption('${escapeHtml(question.id)}', ${idx}, this)` : `App.selectOption(${idx})`}">
                        <div class="option-label">${escapeHtml(label)}</div>
                        <div class="option-content">${renderMarkdown(content)}</div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        // 状态快捷操作放在题干与选项之后、答案解析之前，单题与多题共用同一位置。
        html += statusControls;

        html += `
            <div class="answer-section" id="answer-section" style="display: none;">
                <h3>答案</h3>
                <div class="answer-content">${renderMarkdown(question.answer || '暂无答案')}</div>

                <div class="explanation-v2" data-explanation-v2="${escapeHtml(String(question.id))}" data-explanation-answer="${escapeHtml(String(question.answer || ''))}" hidden></div>

                ${question.explanation ? `
                    <div class="explanation-section" data-original-explanation>
                        <h3>解析</h3>
                        <div class="explanation-content">${renderMarkdown(question.explanation)}</div>
                    </div>
                ` : ''}

                ${this.renderVideoLinks(question)}
            </div>
        `;

        return html;
    }

    // ---------- v2 精讲解析（web/data/explanations-v2.json，按需加载）----------
    // 安全约定：外层结构由本文件拼装；题目与模型产生的文本一律先过 renderMarkdown
    // （内部是 DOMPurify + marked + KaTeX）再注入，不直接拼原始字符串。
    static explanationV2Entry(id) {
        const table = AppState.explanationsV2;
        return table ? (table[String(id)] || null) : null;
    }

    static renderExplanationV2(entry, shownAnswer) {
        if (!entry) return '';
        const parts = [];
        const tags = [];
        if (entry.origin === 'img') tags.push('扫描题 · 已转写');
        if (entry.humanReviewed) tags.push('已人工复核');
        parts.push(`<div class="v2-head"><span class="v2-badge">精讲解析</span>${entry.difficulty ? `<span class="v2-difficulty">${escapeHtml(entry.difficulty)}</span>` : ''}${tags.map(tag => `<span class="v2-tag">${escapeHtml(tag)}</span>`).join('')}</div>`);

        if (entry.conflict) {
            const reviewed = entry.conflictVerdict === 'original_correct';
            const body = entry.conflictEvidence || entry.conflictNote || '';
            parts.push(`<div class="v2-conflict${reviewed ? ' reviewed' : ''}"><strong>${reviewed ? '已复核：题库原答案正确' : '与现有答案不一致'}</strong>${body ? `<div class="v2-conflict-body">${renderMarkdown(body)}</div>` : ''}</div>`);
        }

        if (entry.hint) parts.push(`<div class="v2-hint"><span class="v2-hint-tag">思路</span><div class="v2-hint-body">${renderMarkdown(entry.hint)}</div></div>`);

        const steps = Array.isArray(entry.steps) ? entry.steps : [];
        if (steps.length) {
            parts.push('<ol class="v2-steps">' + steps.map(step => `<li class="v2-step">
                    ${step.title ? `<div class="v2-step-title">${renderMarkdown(step.title)}</div>` : ''}
                    ${step.why ? `<div class="v2-why"><span class="v2-why-tag">为什么</span><div class="v2-why-body">${renderMarkdown(step.why)}</div></div>` : ''}
                    ${step.content ? `<div class="v2-step-body">${renderMarkdown(step.content)}</div>` : ''}
                </li>`).join('') + '</ol>');
        }

        // 答案区已经显示过原答案时不重复；文字题两者常常一致，图片题的扫描答案永远不等于转写答案。
        const finalAnswer = String(entry.answerFinal || '').trim();
        if (finalAnswer && finalAnswer !== String(shownAnswer || '').trim()) {
            parts.push(`<div class="v2-answer"><span class="v2-answer-tag">整理后的答案</span><div class="v2-answer-body">${renderMarkdown(entry.answerFinal)}</div></div>`);
        }

        const options = Array.isArray(entry.optionAnalysis) ? entry.optionAnalysis : [];
        if (options.length) {
            parts.push('<div class="v2-sub">选项逐项分析</div><ul class="v2-options">' + options.map(option => {
                const ok = /^(对|正确|√|true)/i.test(String(option.verdict || ''));
                return `<li class="v2-option${ok ? ' ok' : ''}"><span class="v2-option-key">${escapeHtml(option.key || '')}</span><span class="v2-option-verdict">${escapeHtml(option.verdict || '')}</span><span class="v2-option-reason">${renderMarkdown(option.reason || '')}</span></li>`;
            }).join('') + '</ul>');
        }

        const pitfalls = Array.isArray(entry.pitfalls) ? entry.pitfalls : [];
        if (pitfalls.length) parts.push('<div class="v2-sub">易错点</div><ul class="v2-pitfalls">' + pitfalls.map(item => `<li>${renderMarkdown(item)}</li>`).join('') + '</ul>');

        const chips = [];
        (entry.kps || []).forEach(kp => chips.push(`<span class="v2-chip">${escapeHtml(kp)}</span>`));
        (entry.methods || []).forEach(method => chips.push(`<span class="v2-chip v2-chip-method">${escapeHtml(method)}</span>`));
        if (chips.length) parts.push(`<div class="v2-sub">考点与方法</div><div class="v2-chips">${chips.join('')}</div>`);

        const details = [];
        if (entry.stemText) details.push(`<details class="v2-details"><summary>题目文字转写</summary><div>${renderMarkdown(entry.stemText)}</div></details>`);
        if (entry.explanationText) details.push(`<details class="v2-details"><summary>原始解析文字（扫描图转写）</summary><div>${renderMarkdown(entry.explanationText)}</div></details>`);
        if (details.length) parts.push(`<div class="v2-details-group">${details.join('')}</div>`);

        return parts.join('');
    }

    // 惰性填充：只有答案区真正展开时才拉取 v2 数据（约 4.4 MB），拉过一次后常驻内存。
    static async fillExplanationV2(root) {
        const host = root || document;
        const pending = [...host.querySelectorAll('[data-explanation-v2]')]
            .filter(slot => slot.dataset.explanationV2Filled !== '1');
        if (!pending.length) return;
        // 先打标记再 await，避免同一批插槽被并发调用重复拉取。
        pending.forEach(slot => { slot.dataset.explanationV2Filled = '1'; });
        try {
            await DataService.ensureExplanationsV2();
        } catch { return; }
        if (!AppState.explanationsV2) return;
        pending.forEach(slot => {
            const entry = this.explanationV2Entry(slot.dataset.explanationV2);
            if (!entry) return;
            slot.innerHTML = this.renderExplanationV2(entry, slot.dataset.explanationAnswer);
            slot.hidden = false;
            const original = slot.closest('.answer-section')?.querySelector('[data-original-explanation]');
            if (original) original.classList.add('explanation-original');
        });
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

    static captureAIPanel(...args) { return AIViews.captureAIPanel.apply(this, args); }
    static restoreAIPanel(...args) { return AIViews.restoreAIPanel.apply(this, args); }
    static renderAIPanel(...args) { return AIViews.renderAIPanel.apply(this, args); }
    static renderAIHistory(...args) { return AIViews.renderAIHistory.apply(this, args); }

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

    static renderHistory() {
        const main = document.getElementById('app-main');
        const filters = AppState.historyFilters;
        const option = (value, label, selected) => `<option value="${value}"${String(selected) === value ? ' selected' : ''}>${label}</option>`;
        main.innerHTML = `<div class="home-content history-page"><div class="history-heading"><div><p class="eyebrow">本机学习轨迹</p><h1 class="text-page-title">历史做题记录</h1><p class="text-helper">每题保留最近一次进入时间；旧记录的时间可能来自进度修改。</p></div><button type="button" class="btn btn-secondary" id="history-clear">清空历史</button></div>
            <div class="history-filters"><label>搜索题号或章节<input type="search" data-history-filter="query" value="${escapeHtml(filters.query)}" placeholder="题号、科目、小节"></label><label>科目<select data-history-filter="category">${option('', '全部科目', filters.category)}${(AppState.categories?.categories || []).map(cat => option(String(cat.id), escapeHtml(cat.name), filters.category)).join('')}</select></label><label>开始日期<input type="date" data-history-filter="from" value="${escapeHtml(filters.from)}"></label><label>结束日期<input type="date" data-history-filter="to" value="${escapeHtml(filters.to)}"></label><label>掌握度<select data-history-filter="mastery">${[['','全部'],['not_started','未开始'],['learning','学习中'],['mastered','已掌握']].map(([v,l]) => option(v,l,filters.mastery)).join('')}</select></label><label>收藏<select data-history-filter="favorite">${[['','全部'],['yes','已收藏'],['no','未收藏']].map(([v,l]) => option(v,l,filters.favorite)).join('')}</select></label><label>易错<select data-history-filter="mistake">${[['','全部'],['yes','易错'],['no','非易错']].map(([v,l]) => option(v,l,filters.mistake)).join('')}</select></label></div><div id="history-results" aria-live="polite"></div></div>`;
        main.querySelectorAll('[data-history-filter]').forEach(input => input.addEventListener(input.type === 'search' ? 'input' : 'change', () => {
            AppState.historyFilters[input.dataset.historyFilter] = input.value;
            AppState.historyLimit = 50;
            this.renderHistoryRows();
        }));
        main.querySelector('#history-clear')?.addEventListener('click', () => App.clearHistory());
        this.renderHistoryRows();
    }

    static renderHistoryRows() {
        const host = document.getElementById('history-results');
        if (!host) return;
        const rows = App.filteredHistory();
        const visible = rows.slice(0, AppState.historyLimit);
        host.innerHTML = `<p class="text-helper">共 ${rows.length} 道题${rows.length > visible.length ? ` · 已显示 ${visible.length} 道` : ''}</p>${visible.length ? `<div class="history-list">${visible.map(({ entry, location, progress }) => {
            const title = location ? location.path.map(node => node.name || node.title).filter(Boolean).join(' / ') : '当前题库中无法定位';
            const time = entry.visited_at ? this.formatDateTime(entry.visited_at) : '时间未知';
            return `<article class="history-row"><div><strong>题号 ${escapeHtml(entry.question_id)}</strong><p>${escapeHtml(title)}</p><small>${escapeHtml(time)}${entry.time_kind === 'legacy' ? ' · 旧记录时间' : ''} · ${escapeHtml(masteryLabel(progress.mastery || 'not_started'))}${StorageService.isFavorite(entry.question_id) ? ' · 已收藏' : ''}${progress.error_prone ? ' · 易错' : ''}</small></div><div class="history-actions"><button type="button" class="btn btn-primary btn-sm" data-history-open="${escapeHtml(entry.question_id)}"${location ? '' : ' disabled'}>回到这题</button><button type="button" class="btn btn-text btn-sm" data-history-delete="${escapeHtml(entry.question_id)}">删除</button></div></article>`;
        }).join('')}</div>${rows.length > visible.length ? '<button type="button" class="btn btn-secondary" id="history-more">加载更多</button>' : ''}` : '<div class="empty-state"><h3>没有符合条件的历史题目</h3><p>进入题目后会记录在这里。</p></div>'}`;
        host.querySelectorAll('[data-history-open]').forEach(button => button.addEventListener('click', () => App.openHistoryQuestion(button.dataset.historyOpen)));
        host.querySelectorAll('[data-history-delete]').forEach(button => button.addEventListener('click', () => App.deleteHistoryQuestion(button.dataset.historyDelete)));
        host.querySelector('#history-more')?.addEventListener('click', () => { AppState.historyLimit += 50; this.renderHistoryRows(); });
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

                <div class="card tool-card" id="tool-backup-card">
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
                            <p>先检查本地和官网两边变化，确认后再同步。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" id="sync-toggle-btn" onclick="App.openSyncCenter()">打开同步向导</button>
                    </div>
                    <div class="tool-panel sync-wizard hidden" id="sync-panel">
                        <nav class="guide-step-nav" aria-label="官网同步步骤"><button type="button" data-guide-nav="sync" data-step="1">1 登录</button><button type="button" data-guide-nav="sync" data-step="2">2 只读检查</button><button type="button" data-guide-nav="sync" data-step="3">3 核对变化</button><button type="button" data-guide-nav="sync" data-step="4">4 确认写入</button></nav><p class="guide-step-live" id="sync-step-live" aria-live="polite"></p><button type="button" class="btn btn-text btn-sm" id="sync-restart">从头再看</button>
                        <section data-guide-panel="sync" data-step="1" class="guide-panel"><h3>连接官网账号</h3><p>输入官网登录码；如果使用账号密码，请同时填写密码。先验证登录，后续检查只会读取数据。</p>
                        <div class="sync-status" id="sync-status">正在检查官网连接…</div>
                        <div class="tool-controls">
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-status">检查状态</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-login">配置登录</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="App.showUserGuide()">同步教程</button>
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
                        </section><section data-guide-panel="sync" data-step="2" class="guide-panel"><h3>只读检查两边进度</h3><p>这一步读取本地和官网进度，不会写入。首次同步会先保留快照；日常同步也会先预览冲突。</p>
                        <div class="tool-controls"><button type="button" class="btn btn-primary btn-sm" id="btn-sync-preview" disabled>检查同步内容</button></div></section><section data-guide-panel="sync" data-step="3" class="guide-panel"><h3>核对变化和冲突</h3><p>先看更新方向和题号。冲突可以选择保留较新状态、以官网为准或以本地为准；更改选择会重新检查。</p>
                        <div class="sync-flow-card" id="sync-flow-card" data-state="idle" aria-live="polite"><strong id="sync-summary">还没有检查同步内容</strong><p id="sync-summary-note">检查会读取官网和本地进度，确认前不会修改学习进度。</p></div>
                        <div id="sync-conflict-wrap" hidden><label for="sync-conflict-winner">冲突处理</label><select id="sync-conflict-winner"><option value="latest">保留更新时间较新的状态</option><option value="remote">以官网为准</option><option value="local">以本地为准</option></select></div>
                        <details id="sync-detail" hidden><summary>查看变化题号</summary><div id="sync-detail-content"></div></details>
                        <button type="button" class="btn btn-primary" id="sync-review-next" disabled>已核对，下一步</button></section><section data-guide-panel="sync" data-step="4" class="guide-panel"><h3>由你确认写入</h3><p>点击下方按钮才会应用本次预览。备份与冲突处理仍由现有同步流程执行；失败后重新检查再确认。</p><button type="button" class="btn btn-primary btn-sm" id="btn-sync-apply" hidden disabled>确认同步</button></section><div class="tool-result" id="sync-result" role="status"></div>
                    </div>
                </div>

                <div class="card tool-card">
                    <div class="tool-row">
                        <div class="tool-info">
                            <h2 class="text-section-title">使用教程</h2>
                            <p>了解本地学习、备份与官网同步。</p>
                        </div>
                        <button type="button" class="btn btn-secondary" onclick="App.showUserGuide()">打开使用教程</button>
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
        document.getElementById('btn-sync-preview')?.addEventListener('click', () => App.syncReconcilePreview());
        document.getElementById('btn-sync-apply')?.addEventListener('click', () => App.syncReconcileApply());
        document.getElementById('sync-conflict-winner')?.addEventListener('change', () => App.syncReconcilePreview());
        document.querySelectorAll('[data-guide-nav="sync"]').forEach(button => button.addEventListener('click', () => App.selectGuideStep('sync', button.dataset.step, 4)));
        document.getElementById('sync-restart')?.addEventListener('click', () => App.selectGuideStep('sync', 1, 4));
        document.getElementById('sync-review-next')?.addEventListener('click', () => App.selectGuideStep('sync', 4, 4));
        App.selectGuideStep('sync', App.guideStep('sync', 4), 4);
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
// ========== 应用控制器 ==========
class App {
    static syncTitlebarInset() {
        const root = document.documentElement;
        const overlay = navigator.windowControlsOverlay;
        let titlebarHeight = 0;
        try {
            if (overlay?.visible && typeof overlay.getTitlebarAreaRect === 'function') {
                titlebarHeight = Math.max(0, Number(overlay.getTitlebarAreaRect().height) || 0);
            }
        } catch {}

        const inset = titlebarHeight > 0 && !document.getElementById('daguan-desktop-bar') ? titlebarHeight : 0;
        root.classList?.toggle('native-titlebar-content-inset', inset > 0);
        root.style?.setProperty('--native-titlebar-inset', `${inset}px`);
        return inset;
    }

    static watchTitlebarInset() {
        this.syncTitlebarInset();
        const overlay = navigator.windowControlsOverlay;
        overlay?.addEventListener?.('geometrychange', () => this.syncTitlebarInset());
        if (typeof MutationObserver === 'function' && document.body) {
            const observer = new MutationObserver(() => this.syncTitlebarInset());
            observer.observe(document.body, { childList: true });
        }
    }

    static async init() {
        console.log('大观园新版 - 初始化');
        this.watchTitlebarInset();

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
        try { AppState.ui.navExpanded = localStorage.getItem('daguan_new_nav_hidden') !== '1'; } catch {}
        this.syncNav();

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
        const fixed = [['/', '搜索题目'], ['G', '单题做题时按题号跳转'], ['Alt + 1–4', '单题做题时选择 A–D 选项']];
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
        const fixed = { jump: 'G' };
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
            if (AppState.currentView !== 'question' || AppState.questionMode !== 'single') return;
            if (pressed.toLowerCase() === 'g' && !event.altKey) {
                event.preventDefault(); this.promptJumpToQuestion(); return;
            }
            const q = AppState.questions[AppState.currentQuestionIndex];
            if (event.altKey && /^[1-4]$/.test(pressed)) {
                event.preventDefault(); const index = Number(pressed) - 1;
                this.selectOption(index);
                return;
            }
            const key = pressed === 'Space' || pressed === 'Spacebar' ? ' ' : pressed;
            const action = Object.entries(AppState.shortcuts).find(([, binding]) => binding && (String(binding) === key || String(binding).toLowerCase() === key.toLowerCase()))?.[0];
            if (!action) return;
            event.preventDefault();
            if (action === 'up') { this.previousQuestion(); return; }
            if (action === 'down') { this.nextQuestion(); return; }
            if (action === 'answer') { this.toggleAnswer(); return; }
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

    static historyLocation(questionId, entry = null) {
        if (!AppState.historyLocationCache) {
            const locations = new Map();
            const walk = (node, top, path) => {
                const trail = [...path, node];
                const entries = node.direct_questions || (!(node.children || []).length ? node.questions : []) || [];
                entries.forEach(item => {
                    const id = String(item.id);
                    if (!locations.has(id)) locations.set(id, []);
                    locations.get(id).push({ top, leaf: node, path: trail });
                });
                (node.children || []).forEach(child => walk(child, top, trail));
            };
            (AppState.categories?.categories || []).forEach(top => walk(top, top, []));
            AppState.historyLocationCache = locations;
        }
        const candidates = AppState.historyLocationCache.get(String(questionId)) || [];
        if (entry?.chapter_id != null) {
            return candidates.find(item => String(item.leaf.id) === String(entry.chapter_id)
                && (entry.category_id == null || String(item.top.id) === String(entry.category_id))) || null;
        }
        if (entry?.category_id != null) return candidates.find(item => String(item.top.id) === String(entry.category_id)) || null;
        return candidates[0] || null;
    }

    static recordVisit(questionId, categoryId = null, chapterId = null) {
        if (questionId == null) return;
        void window.DaguanVisitHistory?.visit(questionId, categoryId, chapterId);
    }

    static filteredHistory() {
        const filters = AppState.historyFilters;
        const query = filters.query.trim().toLocaleLowerCase();
        const progress = StorageService.getProgress().progress;
        return AppState.visitHistory.map(entry => ({ entry, location: this.historyLocation(entry.question_id, entry), progress: progress[String(entry.question_id)] || {} }))
            .filter(({ entry, location, progress: row }) => {
                const path = location?.path.map(node => node.name || node.title).join(' / ') || '';
                if (query && !`${entry.question_id} ${path}`.toLocaleLowerCase().includes(query)) return false;
                if (filters.category && String(location?.top.id) !== filters.category) return false;
                const date = entry.visited_at ? new Date(entry.visited_at) : null;
                const day = date && Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
                if (filters.from && (!day || day < filters.from)) return false;
                if (filters.to && (!day || day > filters.to)) return false;
                if (filters.mastery && (row.mastery || 'not_started') !== filters.mastery) return false;
                if (filters.favorite && StorageService.isFavorite(entry.question_id) !== (filters.favorite === 'yes')) return false;
                if (filters.mistake && (row.error_prone === true) !== (filters.mistake === 'yes')) return false;
                return true;
            });
    }

    static async showHistory() {
        AppState.currentView = 'history';
        try { AppState.visitHistory = await window.DaguanVisitHistory.list(); }
        catch (error) { toast(error.message || '做题历史暂时无法读取'); AppState.visitHistory = []; }
        if (AppState.currentView === 'history') UIRenderer.renderHistory();
    }

    static async openHistoryQuestion(id) {
        const entry = AppState.visitHistory.find(item => String(item.question_id) === String(id));
        const location = this.historyLocation(id, entry);
        if (!location) { toast('当前题库中无法定位这道题'); return; }
        const index = DataService.chapterEntries(location.leaf).findIndex(entry => String(entry.id) === String(id));
        if (index < 0) { toast('当前章节中没有这道题'); return; }
        AppState.currentCategory = location.top;
        await this.enterChapterQuestions(location.leaf, index, id, this.preferredQuestionMode(), { ignoreFilters: true });
    }

    static async deleteHistoryQuestion(id) {
        try {
            await window.DaguanVisitHistory.remove(id);
            AppState.visitHistory = AppState.visitHistory.filter(entry => String(entry.question_id) !== String(id));
            UIRenderer.renderHistoryRows();
        } catch (error) { toast(error.message || '删除失败'); }
    }

    static async clearHistory() {
        if (!confirm('确定清空做题历史吗？掌握度、收藏和最近学习位置会保留。')) return;
        try { await window.DaguanVisitHistory.clear(); AppState.visitHistory = []; UIRenderer.renderHistoryRows(); }
        catch (error) { toast(error.message || '清空失败'); }
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
            case 'history':
                await this.showHistory();
                break;
            case 'tools':
                UIRenderer.renderTools();
                break;
            case 'settings':
                this.showSettings();
                break;
            case 'remote-guide':
                this.showRemoteGuide();
                break;
            case 'usage-guide':
                this.renderUsageGuide();
                break;
            default:
                this.showHome();
        }
    }

    static showHome() {
        AppState.currentView = 'home';
        UIRenderer.renderHome();
    }

    static showUserGuide() {
        void this.navigate('usage-guide');
    }

    static guideStep(key, count) {
        const value = Number(localStorage.getItem(`daguan_guide_${key}_step_v1`));
        return Number.isInteger(value) && value >= 1 && value <= count ? value : 1;
    }

    static selectGuideStep(key, step, count) {
        const next = Math.max(1, Math.min(count, Number(step) || 1));
        localStorage.setItem(`daguan_guide_${key}_step_v1`, String(next));
        (document.querySelectorAll?.(`[data-guide-panel="${key}"]`) || []).forEach(panel => { panel.hidden = Number(panel.dataset.step) !== next; });
        (document.querySelectorAll?.(`[data-guide-nav="${key}"]`) || []).forEach(button => {
            button.setAttribute('aria-current', Number(button.dataset.step) === next ? 'step' : 'false');
        });
        document.getElementById(`${key}-step-live`)?.replaceChildren(document.createTextNode(`第 ${next} 步，共 ${count} 步`));
    }

    static async guideJump(view, selector) {
        await this.navigate(view);
        const target = document.querySelector(selector);
        if (!target) return;
        target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
        target.classList.add('guide-target');
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        setTimeout(() => { target.classList.remove('guide-target'); if (!hadTabIndex) target.removeAttribute('tabindex'); }, 3500);
    }

    static renderUsageGuide() {
        const main = document.getElementById('app-main');
        main.innerHTML = `<div class="guide-page"><div class="guide-page-head"><div><p class="guide-kicker">使用教程</p><h1>挑一件事，跟着做</h1><p>每一步都能直接前往对应页面。进度只保存在这台设备上。</p></div><button class="btn btn-text" id="usage-restart">从头再看</button></div>
          <nav class="guide-step-nav" aria-label="教程任务"><button type="button" data-guide-nav="usage" data-step="1">1 选题做题</button><button type="button" data-guide-nav="usage" data-step="2">2 复习与批注</button><button type="button" data-guide-nav="usage" data-step="3">3 备份与同步</button></nav><p class="guide-step-live" id="usage-step-live" aria-live="polite"></p>
          <section class="guide-panel" data-guide-panel="usage" data-step="1"><span class="guide-panel-number">任务一</span><h2>找到一章，开始练习</h2><p>进入「题库」，选科目后依次点章节和小节。末级小节会打开题目；有直属题的章节也能直接做。</p><div class="guide-callout">在题目页可切换「单题做题 / 连续做题」。连续做题每段显示 20 题，向下翻页继续。</div><button class="btn btn-primary" data-guide-jump="library" data-target="#library-content">去题库选题</button></section>
          <section class="guide-panel" data-guide-panel="usage" data-step="2"><span class="guide-panel-number">任务二</span><h2>留下标记，下次接着学</h2><p>做题时收藏、标记易错或已掌握，并在题目下方写批注；「复习」按标记集中回看，「笔记」汇总你的记录。</p><div class="guide-actions"><button class="btn btn-primary" data-guide-jump="review" data-target=".review-tabs">去复习</button><button class="btn btn-secondary" data-guide-jump="notes" data-target=".notes-list-panel">看笔记</button></div></section>
          <section class="guide-panel" data-guide-panel="usage" data-step="3"><span class="guide-panel-number">任务三</span><h2>先备份，再核对同步</h2><p>在「工具」下载本地备份并妥善保存。官网同步先登录、只读检查，再核对变化；只有你点击确认后才写入。</p><div class="guide-callout">官网同步覆盖掌握状态、收藏和最近学习位置。易错标记、批注、AI 密钥及聊天记录不会上传官网。</div><div class="guide-actions"><button class="btn btn-primary" id="usage-open-sync">打开同步向导</button><button class="btn btn-secondary" data-guide-jump="tools" data-target="#tool-backup-card">去工具页备份</button></div></section></div>`;
        main.querySelectorAll('[data-guide-nav="usage"]').forEach(button => button.onclick = () => this.selectGuideStep('usage', button.dataset.step, 3));
        main.querySelectorAll('[data-guide-jump]').forEach(button => button.onclick = () => void this.guideJump(button.dataset.guideJump, button.dataset.target));
        document.getElementById('usage-restart').onclick = () => this.selectGuideStep('usage', 1, 3);
        document.getElementById('usage-open-sync').onclick = () => void this.openSyncCenter();
        this.selectGuideStep('usage', this.guideStep('usage', 3), 3);
    }

    static async refreshHomeSyncStatus() {
        const label = document.getElementById('home-sync-status');
        if (!label) return;
        if (!PreviewAccess.privateAllowed(false)) {
            label.textContent = '只读预览模式下，登录和同步需要先解锁。';
            return;
        }
        try {
            const status = await this.syncRequest('status');
            if (!label.isConnected) return;
            label.textContent = !status.authenticated
                ? (status.configured ? '官网登录已失效，请重新配置。' : '首次使用需配置官网登录，之后每次先检查再确认。')
                : status.needsFirstSync ? '官网进度尚未导入本地，点击“同步进度”开始。'
                    : status.lastPullAt ? `已连接官网 · 上次同步 ${String(status.lastPullAt).slice(0, 16).replace('T', ' ')}` : '官网已连接，点击“同步进度”检查两边变化。';
        } catch {
            if (label.isConnected) label.textContent = '暂时无法检查官网连接；本地学习记录仍可使用。';
        }
    }

    static async openSyncCenter() {
        if (!PreviewAccess.privateAllowed()) return;
        await this.navigate('tools');
        const panel = document.getElementById('sync-panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) this.toggleToolPanel('sync-panel');
        document.getElementById('sync-toggle-btn')?.scrollIntoView({ block: 'center' });
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
        await this.enterChapterQuestions(resolved.leaf, index, questionId, 'single', { preserveLastStudy: true, ignoreFilters: true });
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
        const category = [categoryId, AppState.currentCategory?.id, saved.lastCategory, AppState.categories?.categories?.[0]?.id]
            .map(id => id == null ? null : UIRenderer.findCategoryById(id))
            .find(Boolean);
        if (!category) return;
        AppState.currentCategory = category;
        AppState.directoryPathIds = [];
        AppState.currentView = 'library';
        UIRenderer.renderLibrary(category.id);
    }

    static selectCatalogNode(categoryId, nodeId) {
        const category = UIRenderer.findCategoryById(categoryId);
        const node = category && UIRenderer.findNodeById(category, nodeId);
        if (!category || !node) return;
        if (AppState.currentView === 'library') UIRenderer.saveDirectoryState();
        const path = UIRenderer.pathToNode(category, node.id) || [category];
        AppState.currentCategory = category;
        AppState.directoryNodeId = String(node.id);
        AppState.directoryPathIds = path.map(part => String(part.id));
        AppState.libraryScrollTop = 0;
        AppState.currentView = 'library';
        UIRenderer.renderLibrary(category.id, { selectedNodeId: node.id, resetScroll: true });
    }

    // 级联列中的节点动作：有下级时只推进路径；叶子有题直接进入练习，空叶子停留并显示空状态。
    static selectDirectoryItem(categoryId, nodeId) {
        const category = UIRenderer.findCategoryById(categoryId);
        const node = category && UIRenderer.findNodeById(category, nodeId);
        if (!category || !node) return;
        if ((node.children || []).length) {
            this.selectCatalogNode(category.id, node.id);
            return;
        }
        if ((node.direct_questions || node.questions || []).length) {
            AppState.currentCategory = category;
            void this.showChapter(node);
            return;
        }
        this.selectCatalogNode(category.id, node.id);
    }

    static startDirectDirectory(categoryId, nodeId) {
        const category = UIRenderer.findCategoryById(categoryId);
        const node = category && UIRenderer.findNodeById(category, nodeId);
        if (!category || !node) return;
        AppState.currentCategory = category;
        void this.showChapter(node, { directOnly: true });
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
        if (!['all', 'core', 'real'].includes(scope)) return;
        const token = (this.chapterScopeToken || 0) + 1;
        this.chapterScopeToken = token;
        const summary = document.getElementById('catalog-scope-summary');
        if (scope === AppState.chapterScope) {
            if (summary) summary.textContent = UIRenderer.scopeSummaryText();
            return;
        }
        const previous = AppState.chapterScope;
        const current = AppState.questions?.[AppState.currentQuestionIndex];
        if (AppState.currentView === 'question' && AppState.currentChapter && !await this.ensureSavedBeforeLeavingQuestion()) return;
        if (summary) summary.textContent = `正在统计${scope === 'core' ? '严选' : scope === 'real' ? '真题' : '完整'}题数…`;
        try {
            await UIRenderer.ensureScopeQuestionIds(scope);
        } catch (error) {
            if (token === this.chapterScopeToken) {
                if (summary) summary.textContent = UIRenderer.scopeSummaryText();
                toast(`题库范围暂时无法加载：${error.message || '请重试'}`);
            }
            return;
        }
        if (token !== this.chapterScopeToken) return;
        AppState.chapterScope = scope;
        if (summary) summary.textContent = UIRenderer.scopeSummaryText();
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
        if (AppState.currentView === 'library') {
            const filtering = String(AppState.libraryQuery || '').trim()
                || Object.values(AppState.filters || {}).some(values => Array.isArray(values) && values.length > 0);
            if (filtering) UIRenderer.renderLibraryResults();
            else {
                const node = UIRenderer.findNodeById(AppState.currentCategory, AppState.directoryNodeId) || AppState.currentCategory;
                UIRenderer.renderDirectoryNode(node);
            }
        }
        const picker = document.getElementById('chapter-picker');
        if (picker?.classList.contains('open')) UIRenderer.renderChapterPicker();
    }

    static openDirectoryNode(nodeId) {
        const category = AppState.currentCategory;
        const node = category && UIRenderer.findNodeById(category, nodeId);
        if (!node) return;
        UIRenderer.saveDirectoryState();
        const path = UIRenderer.pathToNode(category, node.id) || [category];
        AppState.directoryNodeId = String(node.id);
        AppState.directoryPathIds = path.map(part => String(part.id));
        AppState.libraryScrollTop = 0;
        UIRenderer.renderLibrary(category.id, { selectedNodeId: node.id, resetScroll: true });
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
        await this.enterChapterQuestions(node, Math.max(0, index), position.questionId, this.preferredQuestionMode(), { ignoreFilters: true });
    }

    static preferredQuestionMode() {
        try { return localStorage.getItem('daguan_new_question_mode_v1') === 'multi' ? 'multi' : 'single'; }
        catch { return 'single'; }
    }

    static async enterChapterQuestions(chapter, index = 0, questionId = null, mode = 'single', { preserveLastStudy = false, ignoreFilters = false } = {}) {
        const directOnly = chapter?._directOnly === true;
        chapter = ignoreFilters
            ? { ...chapter, direct_questions: directOnly ? (chapter.direct_questions || []) : (chapter.direct_questions || chapter.questions || []), children: [] }
            : await UIRenderer.filteredChapter(chapter, directOnly);
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
        AppState.suspendLastStudy = preserveLastStudy;
        AppState.temporaryQuestionView = preserveLastStudy;
        try {
            if (AppState.questionMode === 'multi') {
                const start = Math.floor(index / 20) * 20;
                await UIRenderer.renderMultiRange(start, questionId ?? entries[index]?.id);
            } else {
                const questions = await DataService.loadQuestionsForChapter(chapter);
                if (!questions.length) throw new Error('题目暂时无法加载');
                AppState.questions = questions; AppState.questionOffset = 0;
                const resolved = questionId == null ? index : questions.findIndex(q => String(q.id) === String(questionId));
                await UIRenderer.renderQuestion(Math.min(Math.max(resolved, 0), questions.length - 1));
            }
            const selected = AppState.questions[AppState.currentQuestionIndex];
            if (selected) {
                this.recordVisit(selected.id, AppState.currentCategory?.id, chapter.id);
                if (AppState.questionMode === 'multi' && !preserveLastStudy) void StateSync.pushLastStudy(chapter.id, selected.id, 'multi');
            }
        } catch (error) {
            AppState.currentView = 'library';
            toast(`题目暂时无法加载：${error.message || '请重试'}`);
        } finally {
            AppState.suspendLastStudy = false;
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
        const saved = await this.ensureSavedBeforeLeavingQuestion({ stopAI: false });
        if (!saved || token !== AppState.modeSwitchToken) {
            if (token === AppState.modeSwitchToken) AppState.modeSwitchTarget = null;
            return;
        }
        AppState.temporaryQuestionView = false;
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
            toast(`切换模式失败，仍在${previousMode === 'single' ? '单题做题' : '连续做题'}模式：${error.message || '请重试'}`);
        }
    }

    static async goToChapterQuestion(index) {
        const entries = DataService.chapterEntries(AppState.currentChapter);
        const target = Math.max(0, Math.min(entries.length - 1, Number(index) || 0));
        if (!await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.temporaryQuestionView = false;
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
            const selected = AppState.questions[AppState.currentQuestionIndex];
            if (selected) { this.recordVisit(selected.id, AppState.currentCategory?.id, AppState.currentChapter?.id); void StateSync.pushLastStudy(AppState.currentChapter.id, selected.id, 'multi'); }
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
        AppState.temporaryQuestionView = false;
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
        this.recordVisit(AppState.questions[AppState.currentQuestionIndex]?.id, AppState.currentCategory?.id, AppState.currentChapter?.id);
    }

    static toggleCardAnswer(globalIndex, button) {
        const card = document.getElementById(`multi-question-${globalIndex}`);
        const answer = card?.querySelector('.answer-section');
        if (!answer) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        if (expanded && PreviewAccess.privateAllowed(false)) window.DaguanStudyActivity?.reveal(card.dataset.questionId);
        answer.style.display = expanded ? 'block' : 'none';
        if (expanded) UIRenderer.fillExplanationV2(card);
        button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? '隐藏答案' : '显示答案';
    }

    static async toggleQuestionFavorite(id) {
        if (!PreviewAccess.privateAllowed()) return;
        const active = StorageService.toggleFavorite(id); StateSync.queueQuestion(id, { favorite: active });
        if (active) window.DaguanStudyActivity?.favorite(id, 'manual', this.studyChapterDetails());
        document.querySelectorAll(`[data-question-id="${CSS.escape(String(id))}"] .multi-card-actions .action-btn:first-child`).forEach(btn => btn.classList.toggle('active', active));
        document.querySelectorAll(`.question-rail-item[data-question-id="${CSS.escape(String(id))}"]`).forEach(btn => btn.classList.toggle('favorite', active));
        this.filterQuestionRailItems();
    }

    static async toggleQuestionMistake(id) {
        if (!PreviewAccess.privateAllowed()) return;
        const active = StorageService.toggleMistake(id); StateSync.queueQuestion(id, { error_prone: active });
        this.updateQuestionStateUI(id);
    }

    static async openQuestionAI(id) {
        const index = AppState.questions.findIndex(q => String(q.id) === String(id)); if (index < 0) return;
        if (index !== AppState.currentQuestionIndex && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.currentQuestionIndex = index; AppState.ui.aiPanelOpen = true;
        this.recordVisit(id, AppState.currentCategory?.id, AppState.currentChapter?.id);
        const panel = document.getElementById('ai-panel'); panel?.classList.remove('closed');
        UIRenderer.renderAIPanel();
    }

    static async openQuestionAnnotation(id) {
        const index = AppState.questions.findIndex(q => String(q.id) === String(id)); if (index < 0) return;
        if (index !== AppState.currentQuestionIndex && !await this.ensureSavedBeforeLeavingQuestion()) return;
        AppState.currentQuestionIndex = index; AppState.ui.annotationPanelOpen = true;
        this.recordVisit(id, AppState.currentCategory?.id, AppState.currentChapter?.id);
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
            const queueChapter = await UIRenderer.filteredChapter(chapter);
            const index = DataService.chapterEntries(queueChapter).findIndex(item => String(item.id) === String(questionId));
            if (index >= 0) await this.enterChapterQuestions(queueChapter, index, questionId, this.preferredQuestionMode());
            else toast('这道题不在当前范围中，请切换题库范围');
        } else {
            AppState.questions = [question]; AppState.questionOffset = 0; AppState.chapterQuestionCount = 1;
            AppState.questionMode = 'single'; AppState.currentView = 'question';
            await UIRenderer.renderQuestion(0);
            this.recordVisit(question.id);
        }
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
            if (content && DataService.chapterEntries(chapter).length > 0) content.insertAdjacentHTML('beforeend', `<div class="empty-state filtered-empty" role="status"><h3>此章节当前条件没有题目</h3><p>目录题数按当前范围统计；详细筛选也会影响本次练习。可调整“${escapeHtml(AppState.chapterScope === 'all' ? '完整' : AppState.chapterScope === 'core' ? '严选' : '真题')}”范围或筛选条件。</p></div>`);
            return false;
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
        await this.enterChapterQuestions(chapter, Math.max(0, Math.min(index, entries.length - 1)), position.questionId, this.preferredQuestionMode(), { ignoreFilters: true });
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
        this.recordVisit(question.id);
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
        this.recordVisit(paper[0].id);
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
            if (withExpl) {
                const v2 = UIRenderer.explanationV2Entry(q.id);
                if (v2) parts.push(`<div class="expl"><strong>精讲解析：</strong>${UIRenderer.renderExplanationV2(v2, q.answer)}</div>`);
                else if (q.explanation) parts.push(`<p><strong>解析：</strong>${renderMarkdown(q.explanation)}</p>`);
            }
            return `<section class="q">${parts.join('')}</section>`;
        }).join('');
        const doc = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>大观园-${escapeHtml(title)}</title>
<link rel="stylesheet" href="${location.origin}/vendor/katex.min.css">
<style>body{font-family:Georgia,'Microsoft YaHei',serif;max-width:760px;margin:32px auto;padding:0 16px;color:#202124}h1{font-size:22px}.q{margin:24px 0;padding-bottom:12px;border-bottom:1px solid #e3e6ea}.opts{margin:8px 0 0 1.2em}.katex-display{overflow-x:auto}.toolbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #e3e6ea;display:flex;gap:12px;align-items:center}.v2-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.v2-badge{background:#C83F32;color:#fff;font-size:13px;font-weight:600;padding:2px 10px;border-radius:999px}.v2-difficulty,.v2-tag{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid #dfe3e8;color:#5f6368}.v2-difficulty{border-color:#C83F32;color:#C83F32}.v2-hint,.v2-answer,.v2-why{padding:10px 12px;margin:10px 0;background:#f6f7f9;border-left:3px solid #C83F32;border-radius:8px}.v2-hint-tag,.v2-why-tag,.v2-answer-tag{font-weight:600;color:#C83F32;margin-right:8px}.v2-steps{list-style:none;counter-reset:v2step;margin:0;padding:0}.v2-step{counter-increment:v2step;padding:0 0 16px 34px;position:relative;border-left:1px solid #dfe3e8;margin-left:12px}.v2-step:last-child{border-left-color:transparent}.v2-step::before{content:counter(v2step);position:absolute;left:-12px;top:-2px;width:24px;height:24px;border-radius:50%;background:#C83F32;color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center}.v2-step-title{font-weight:600;margin-bottom:6px}.v2-sub{font-weight:600;color:#5f6368;font-size:14px;margin:14px 0 6px}.v2-options{list-style:none;padding:0;margin:0}.v2-option{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px dashed #dfe3e8}.v2-option-key{font-weight:600}.v2-option-verdict{font-size:12px;padding:1px 8px;border-radius:999px;background:#f6f7f9;color:#5f6368}.v2-option.ok .v2-option-verdict{background:rgba(200,63,50,.1);color:#C83F32}.v2-chips{display:flex;flex-wrap:wrap;gap:6px}.v2-chip{font-size:12px;padding:2px 9px;border-radius:999px;background:#f6f7f9;border:1px solid #dfe3e8;color:#5f6368}.v2-conflict{padding:10px 12px;margin:10px 0;border-radius:8px;background:rgba(214,138,0,.1);border-left:3px solid #d68a00}.v2-conflict.reviewed{background:#f6f7f9;border-left-color:#dfe3e8;color:#5f6368}.v2-conflict-body{margin-top:4px;color:#5f6368}.v2-details{border:1px solid #dfe3e8;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px}.v2-details>summary{cursor:pointer;color:#5f6368}</style>
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
    static buildBackupPayload(visitHistory = []) {
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
            visit_history: visitHistory,
            last_study: (() => {
                const position = StorageService.getLearningPosition();
                return position?.chapterId != null && position?.questionId != null
                    ? { category_id: String(position.chapterId), question_id: String(position.questionId), mode: position.mode || 'single', updated_at: position.timestamp || null }
                    : null;
            })(),
        };
    }

    static async downloadBackup() {
        if (!PreviewAccess.privateAllowed()) return;
        let visits;
        try { visits = await window.DaguanVisitHistory.list(); }
        catch (error) { this.setToolStatus(`备份未开始：${error.message || '无法读取做题历史'}`, 'error'); return; }
        const payload = this.buildBackupPayload(visits);
        try { payload.study_activity = await window.DaguanStudyActivity?.export(); }
        catch (error) { this.setToolStatus(`备份未开始：${error.message}`, 'error'); return; }
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
                visitHistory: Array.isArray(data.visit_history) ? data.visit_history : [],
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
            return { kind: 'map', map, favorites, annotations: null, picked: Array.isArray(data.picked) ? data.picked.map(String) : null, visitHistory: Array.isArray(data.visit_history) ? data.visit_history : [] };
        }
        if (data.states && typeof data.states === 'object' && !Array.isArray(data.states)) {
            for (const [id, value] of Object.entries(data.states)) {
                if (!value || typeof value !== 'object') continue;
                put(id, value.mastery);
                if (value.favorite === true || value.favorited_at) favorites.push(String(id));
            }
            if (!Object.keys(map).length && !favorites.length) throw new Error('备份内容为空');
            return { kind: 'map', map, favorites, annotations: null, picked: null, visitHistory: Array.isArray(data.visit_history) ? data.visit_history : [] };
        }
        throw new Error('无法识别的备份格式（缺少进度数据）');
    }

    static async restoreBackup(input) {
        const file = input && input.files && input.files[0];
        if (!file) return;
        let parsed, studyBackup;
        try {
            const text = await file.text();
            parsed = this.parseBackupText(text);
            studyBackup = JSON.parse(text).study_activity;
            window.DaguanStudyActivity?.validateBackup(studyBackup);
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
        if (parsed.visitHistory.length) {
            try { await window.DaguanVisitHistory.merge(parsed.visitHistory); }
            catch (error) { this.setToolStatus(`进度已恢复，但做题历史导入失败：${error.message || '请重试'}`, 'error'); input.value = ''; return; }
        }
        try { await window.DaguanStudyActivity?.restore(studyBackup, parsed.progress || Object.fromEntries(Object.entries(parsed.map || {}).map(([id, mastery]) => [id, { mastery }]))); }
        catch (error) { this.setToolStatus(`进度已恢复，但战报恢复失败：${error.message}`, 'error'); input.value = ''; return; }
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
            reconcilePreview: ['/integrations/cxyonly/reconcile/preview', 'POST'],
            reconcileApply: ['/integrations/cxyonly/reconcile/apply', 'POST'],
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
            error.status = response.status;
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
            if (document.getElementById('sync-panel') && !document.getElementById('sync-panel').classList.contains('hidden')) {
                const savedStep = this.guideStep('sync', 4);
                this.selectGuideStep('sync', status.authenticated ? (AppState.syncReconcilePreview?.previewId ? savedStep : 2) : 1, 4);
            }
            const line = status.authenticated
                ? (status.needsFirstSync ? '官网已配置，但还没导入过进度。可先「读取官网进度」。' : `官网已连接。${status.lastPullAt ? `上次同步：${String(status.lastPullAt).slice(0, 16).replace('T', ' ')}` : ''}`)
                : (status.configured ? '登录已失效，请重新配置。' : '尚未配置官网登录。点击「配置登录」填入登录码或账号。');
            if (statusEl) statusEl.textContent = line;
            document.getElementById('btn-sync-preview').disabled = !status.authenticated;
            if (!status.authenticated) {
                document.getElementById('sync-login-form')?.classList.remove('hidden');
                this.syncResetPreview();
            } else {
                document.getElementById('sync-login-form')?.classList.add('hidden');
            }
        } catch (error) {
            if (statusEl) statusEl.textContent = `本地中控台未连接：${error.message}`;
            this.syncResultHtml(`<p>连接检查失败：${escapeHtml(error.message || String(error))}。请确认大观园正在运行后重试。</p>`);
            this.selectGuideStep('sync', 1, 4);
            const preview = document.getElementById('btn-sync-preview');
            if (preview) preview.disabled = true;
            this.syncResetPreview();
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
            this.selectGuideStep('sync', 2, 4);
        } catch (error) {
            this.syncResultHtml(`<p class="text-helper">登录失败：${escapeHtml(error.message || String(error))}</p>`);
        }
    }

    static syncResetPreview() {
        AppState.syncReconcilePreview = null;
        const apply = document.getElementById('btn-sync-apply');
        if (apply) { apply.hidden = true; apply.disabled = true; }
        const detail = document.getElementById('sync-detail');
        if (detail) detail.hidden = true;
        const conflict = document.getElementById('sync-conflict-wrap');
        if (conflict) conflict.hidden = true;
        const next = document.getElementById('sync-review-next');
        if (next) next.disabled = true;
    }

    static async syncReconcilePreview() {
        if (!PreviewAccess.privateAllowed()) return;
        const check = document.getElementById('btn-sync-preview');
        const summary = document.getElementById('sync-summary');
        const note = document.getElementById('sync-summary-note');
        const card = document.getElementById('sync-flow-card');
        this.syncResetPreview();
        if (check) { check.disabled = true; check.textContent = '正在检查…'; }
        if (card) card.dataset.state = 'checking';
        if (summary) summary.textContent = '正在检查本地和官网进度…';
        if (note) note.textContent = '确认之前不会修改学习进度。';
        try {
            if (!StateSync.available) await StateSync.hydrate();
            if (!StateSync.available) throw new Error('本地服务尚未连接，请稍后重试。');
            await StateSync.ensureFlushed();
            if (hasPendingSync() && !await StateSync.retryPending()) throw new Error('本地编辑尚未保存，请稍后重试。');
            const winner = document.getElementById('sync-conflict-winner')?.value || 'latest';
            const preview = await this.syncRequest('reconcilePreview', { winner });
            AppState.syncReconcilePreview = preview;
            const s = preview.summary || {};
            const toLocal = Number(s.remoteQuestionCount) || 0;
            const toOfficial = Number(s.localQuestionCount) || 0;
            const conflicts = Number(s.conflictQuestionCount) || 0;
            if (card) card.dataset.state = toLocal || toOfficial ? 'ready' : 'no_changes';
            if (summary) summary.textContent = `官网将更新本地 ${toLocal} 道题；本地将上传官网 ${toOfficial} 道题。`;
            if (note) note.textContent = preview.firstRepair ? '首次同步以官网进度为准；请核对变化后确认。' : toOfficial ? `官网写入可能计入今日刷题数 ${preview.activityImpact?.possibleTodayWrites || 0} 项。` : '这次不会修改官网。';
            const apply = document.getElementById('btn-sync-apply');
            if (apply) { apply.hidden = !(toLocal || toOfficial || preview.firstRepair); apply.disabled = apply.hidden; apply.textContent = toLocal && toOfficial ? '确认同步两边进度' : toOfficial ? '确认上传官网' : '确认更新本地'; }
            const conflict = document.getElementById('sync-conflict-wrap');
            if (conflict) conflict.hidden = preview.firstRepair || !conflicts;
            const changes = [...(preview.localChanges || []).map(item => ({ ...item, direction: '官网 → 本地' })), ...(preview.remoteOperations || []).map(item => ({ ...item, direction: '本地 → 官网' }))];
            const detail = document.getElementById('sync-detail');
            const content = document.getElementById('sync-detail-content');
            if (content) content.innerHTML = changes.slice(0, 100).map(item => `<div>${escapeHtml(item.direction)} · #${escapeHtml(String(item.questionId ?? item.question_id ?? ''))}</div>`).join('') + (changes.length > 100 ? `<p>另有 ${changes.length - 100} 项变化。</p>` : '');
            if (detail) detail.hidden = !changes.length;
            this.syncResultHtml(`<p>冲突 ${conflicts} 道题；未知题号 ${(preview.unknownIds || []).length} 项。同步前会保留本地及官网快照。</p>`);
            const next = document.getElementById('sync-review-next');
            if (next) next.disabled = !apply || apply.hidden;
            this.selectGuideStep('sync', 3, 4);
        } catch (error) {
            if (card) card.dataset.state = 'error';
            if (summary) summary.textContent = '检查失败';
            if (note) note.textContent = error.message || String(error);
            this.syncResultHtml(`<p>只读检查失败：${escapeHtml(error.message || String(error))}。请检查官网登录与本地连接后重试。</p>`);
        } finally {
            if (check) { check.disabled = false; check.textContent = '重新检查同步内容'; }
        }
    }

    static async syncReconcileApply() {
        if (!PreviewAccess.privateAllowed()) return;
        const preview = AppState.syncReconcilePreview;
        if (!preview?.previewId) { this.syncReconcilePreview(); return; }
        const count = Number(preview.summary?.localQuestionCount) || 0;
        if (count && !confirm(`本地有 ${count} 道题将上传到官网。确认同步吗？`)) return;
        const apply = document.getElementById('btn-sync-apply');
        const check = document.getElementById('btn-sync-preview');
        const card = document.getElementById('sync-flow-card');
        if (apply) apply.disabled = true;
        if (check) check.disabled = true;
        if (card) card.dataset.state = 'syncing';
        document.getElementById('sync-summary').textContent = '正在同步进度…';
        try {
            const result = await this.syncRequest('reconcileApply', { previewId: preview.previewId, winner: preview.winner || 'latest' });
            this.syncResetPreview();
            if (result.state) {
                StorageService.saveProgress({ progress: result.state.progress || {}, favorites: (result.state.favorites || []).map(String) });
                if (Array.isArray(result.state.picked)) localStorage.setItem('daguan_local_picked_v1', JSON.stringify(result.state.picked.map(String)));
                StateSync.revision = Number(result.state.revision) || StateSync.revision;
                StateSync.absorbLastStudy(result.state.last_study || null);
            }
            const partial = result.failed || result.unknownIds?.length || !result.verified;
            if (card) card.dataset.state = partial ? 'partial' : 'success';
            document.getElementById('sync-summary').textContent = partial ? '同步未完全完成' : '两边进度已同步';
            document.getElementById('sync-summary-note').textContent = partial ? '失败项已保留，请重新检查后继续。' : `本地更新 ${result.appliedLocal || 0} 项，官网更新 ${result.succeeded || 0} 项。`;
            this.syncResultHtml(`<p>官网成功 ${result.succeeded || 0} 项；失败 ${result.failed || 0} 项；未知题号 ${(result.unknownIds || []).length} 项；官网校验${result.verified ? '成功' : '未完成'}。</p>`);
            if (!partial) this.celebrateGuide(document.getElementById('sync-result'));
        } catch (error) {
            this.syncResetPreview();
            if (card) card.dataset.state = 'error';
            document.getElementById('sync-summary').textContent = '同步未完成';
            document.getElementById('sync-summary-note').textContent = error.status === 409 || error.code === 'STATE_CONFLICT' || error.code === 'PREVIEW_STRATEGY_CHANGED' ? '预览后进度发生变化，请重新检查并确认。' : `请重新检查同步内容：${error.message || String(error)}`;
            this.syncResultHtml(`<p>同步未完成：${escapeHtml(error.message || String(error))}。请重新检查并确认。</p>`);
            this.selectGuideStep('sync', 3, 4);
        } finally {
            if (check) check.disabled = false;
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

                ${window.daguanDesktop?.remoteAccess ? `<section class="card" style="margin-bottom:var(--spacing-xl)" aria-labelledby="remote-title">
                    <h2 class="text-section-title" id="remote-title">外网浏览器访问</h2>
                    <p class="text-helper">供你在自己的手机或电脑使用同一份学习记录。关闭窗口留在托盘时继续连接；退出大观园即断开。外网仅可学习，不能管理此处设置。</p>
                    <p id="remote-status" class="text-helper" aria-live="polite">正在读取连接状态…</p>
                    <div class="tool-controls"><input id="remote-password" type="password" autocomplete="new-password" placeholder="新访问密码，至少 12 位" aria-label="新访问密码"><input id="remote-old-password" type="password" autocomplete="current-password" placeholder="修改时输入原密码" aria-label="原密码"><button class="btn btn-secondary" id="remote-save-password" type="button">设置 / 修改密码</button><button class="btn btn-text" id="remote-revoke" type="button">撤销全部登录</button></div>
                    <div class="tool-controls" style="margin-top:var(--spacing-m)"><button class="btn btn-primary" id="remote-quick" type="button">开启临时地址</button><button class="btn btn-secondary" id="remote-stop" type="button">断开连接</button><button class="btn btn-text" id="remote-download" type="button">下载 cloudflared</button></div>
                    <div class="tool-controls" style="margin-top:var(--spacing-s)"><a id="remote-url" target="_blank" rel="noopener noreferrer" hidden></a><button class="btn btn-text" id="remote-copy" type="button" style="display:none" hidden>复制地址</button></div>
                    <div class="guide-card-entry"><div><strong>想用自己的固定网址？</strong><p>打开页面内向导，按四步接入域名、准备令牌并检查结果。</p></div><button class="btn btn-secondary" type="button" id="remote-open-guide">配置固定域名</button></div><p id="remote-feedback" class="text-helper" role="status"></p>
                </section>` : ''}

                ${UIRenderer.renderThemeSettings()}

                <section class="card shortcut-settings-card" aria-labelledby="shortcut-settings-title">
                    <h2 class="text-section-title" id="shortcut-settings-title">快捷键</h2>
                    <p class="text-helper">单击按键后按下新键。做题快捷键仅在单题做题时生效；/ 为全局搜索键，G 为单题跳题键。</p>
                    <div id="shortcut-list" class="shortcut-list"></div><p id="shortcut-feedback" class="text-helper" aria-live="polite"></p>
                    <button type="button" class="btn btn-text" onclick="App.resetShortcuts()">恢复旧版默认键</button>
                </section>

                <section class="card" id="ai-services-settings"></section>

                <div class="card" style="margin-bottom: var(--spacing-xl);">
                    <h2 class="text-section-title" style="margin-bottom: var(--spacing-l);">访问与数据</h2>
                    <p class="text-helper" id="preview-status" style="margin-bottom: var(--spacing-l);"></p>
                    <div class="tool-controls">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-preview-unlock" onclick="PreviewAccess.openUnlockDialog()">输入访问 Token</button>
                        <button type="button" class="btn btn-text btn-sm" id="btn-preview-lock" onclick="PreviewAccess.lock()">锁定为只读预览</button>
                    </div>
                </div>

            </div>
        `;
        PreviewAccess.applyUi();
        UIRenderer.bindThemeSettings();
        this.renderShortcutSettings();
        if (window.daguanDesktop?.remoteAccess) this.bindRemoteSettings();
        window.DaguanAISettings?.mount(document.getElementById('ai-services-settings'), {
            selectedId: () => AppState.aiProfileId,
            busy: () => AppState.aiBusy,
            allowed: () => PreviewAccess.privateAllowed(),
            select: id => this.selectAIProfile(id),
            changed: profiles => { AppState.aiProfiles = profiles; if (!profiles.some(p => p.id === AppState.aiProfileId)) AIService.selectProfile(profiles[0]?.id || ''); },
        });
    }

    static bindRemoteSettings() {
        const api = window.daguanDesktop.remoteAccess;
        const byId = id => document.getElementById(id);
        let startedQuickHere = false, wasQuickConnected = false;
        const render = status => {
            const node = byId('remote-status'); if (!node) return;
            const labels = { off: '未连接', quick: '临时地址', named: '固定地址' };
            node.textContent = `${labels[status.mode] || '未连接'} · ${status.state === 'connected' ? '公网登录页已验证' : status.state === 'connecting' ? (status.phase || '连接中') : status.state === 'error' ? '连接失败' : '已断开'}${status.hostname ? ` · ${status.hostname}` : ''}${status.binary ? '' : ' · 未找到 cloudflared'}${status.serviceOnline ? '' : ' · 本地学习服务暂不可用'}`;
            const link = byId('remote-url'), copy = byId('remote-copy');
            const verified = status.state === 'connected';
            if (link) { link.hidden = !verified; link.href = verified ? status.url : '#'; link.textContent = verified ? status.url : ''; }
            if (copy) { copy.hidden = !verified; copy.style.display = verified ? '' : 'none'; }
            if (status.error && byId('remote-feedback')) byId('remote-feedback').textContent = `${status.phase || '连接失败'}：${status.error}`;
            if (verified && status.mode === 'quick' && startedQuickHere && !wasQuickConnected) this.celebrateGuide(byId('remote-status'));
            wasQuickConnected = verified && status.mode === 'quick';
        };
        const invoke = async (action, input) => {
            const feedback = byId('remote-feedback'); feedback.textContent = '处理中…';
            try { const result = await api(action, input); render(result); feedback.textContent = result.operationError || (action === 'download' ? 'cloudflared 已下载并校验。' : result.error || (result.state === 'connecting' ? '连接中，正在验证公网登录页…' : '操作完成。')); }
            catch (error) { feedback.textContent = error.message || String(error); }
        };
        byId('remote-save-password').onclick = () => { const password = byId('remote-password').value, oldPassword = byId('remote-old-password').value; byId('remote-password').value = ''; byId('remote-old-password').value = ''; void invoke('password', { password, oldPassword }); };
        byId('remote-revoke').onclick = () => void invoke('revoke');
        byId('remote-quick').onclick = () => { startedQuickHere = true; void invoke('quick:start'); };
        byId('remote-stop').onclick = () => void invoke('stop');
        byId('remote-download').onclick = () => void invoke('download');
        byId('remote-open-guide').onclick = () => void this.navigate('remote-guide');
        byId('remote-copy').onclick = () => { const url = byId('remote-url')?.href; if (url) void navigator.clipboard.writeText(url).then(() => { byId('remote-feedback').textContent = '地址已复制。'; }); };
        void api('status').then(render);
        const timer = setInterval(() => { if (!byId('remote-status')) { clearInterval(timer); return; } void api('status').then(render); }, 3000);
    }

    static showRemoteGuide() {
        const main = document.getElementById('app-main');
        main.innerHTML = `<div class="guide-page remote-guide"><div class="guide-page-head"><div><p class="guide-kicker">外网访问 · 固定网址</p><h1>用自己的域名访问大观园</h1><p>电脑和大观园运行时，才能从外面打开。域名需要你自己购买并接入 Cloudflare。</p></div><button class="btn btn-text" id="remote-guide-restart">从头再看</button></div>
          <nav class="guide-step-nav" aria-label="固定域名配置步骤"><button type="button" data-guide-nav="remote" data-step="1">1 接入域名</button><button type="button" data-guide-nav="remote" data-step="2">2 准备令牌</button><button type="button" data-guide-nav="remote" data-step="3">3 创建并检查</button><button type="button" data-guide-nav="remote" data-step="4">4 取得地址</button></nav><p class="guide-step-live" id="remote-step-live" aria-live="polite"></p>
          <section class="guide-panel" data-guide-panel="remote" data-step="1"><span class="guide-panel-number">第一步 · 由你在 Cloudflare 完成</span><h2>让 Cloudflare 管理你的域名</h2><p>购买域名后，打开 Cloudflare 控制台，添加这个域名。按控制台显示的两个名称服务器，到域名购买平台修改 NS。Cloudflare 显示「活动」后再继续。</p><div class="guide-diagram" role="img" aria-label="域名购买平台将名称服务器指向 Cloudflare，Cloudflare 再连接本机大观园"><span>域名购买平台<br><small>修改 NS</small></span><b aria-hidden="true">→</b><span>Cloudflare<br><small>域名状态：活动</small></span><b aria-hidden="true">→</b><span>大观园<br><small>下一步连接</small></span></div><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">打开 Cloudflare 控制台 ↗</a><label class="guide-check"><input id="remote-domain-ready" type="checkbox">我已经看到域名状态为「活动」</label><button class="btn btn-primary" id="remote-domain-next" type="button">下一步：准备令牌</button></section>
          <section class="guide-panel" data-guide-panel="remote" data-step="2"><span class="guide-panel-number">第二步 · 复制所需信息</span><h2>准备三个 ID 和一个限权令牌</h2><ol class="guide-list"><li>从 Cloudflare 账户首页复制 <strong>Account ID</strong>。</li><li>打开你的域名，在概览页复制 <strong>Zone ID</strong>。</li><li>在「我的个人资料 → API 令牌」创建自定义令牌，只授予 <strong>Account · Cloudflare Tunnel · Edit</strong> 和 <strong>Zone · DNS · Edit</strong>，区域资源限定为这一个域名。</li></ol><div class="guide-diagram guide-diagram-stacked"><span>账户首页 <strong>Account ID</strong></span><span>域名概览 <strong>Zone ID</strong></span><span>API 令牌 <strong>仅本次使用</strong></span></div><p class="guide-callout">API 令牌只在创建时发送给 Cloudflare，不会长期保存在本机。请勿使用 Global API Key。</p><button class="btn btn-primary" data-remote-next="3" type="button">下一步：填写并创建</button></section>
          <section class="guide-panel" data-guide-panel="remote" data-step="3"><span class="guide-panel-number">第三步 · 大观园执行</span><h2>创建并检查固定地址</h2><p>先在设置页设置至少 12 位外网访问密码；若未安装 cloudflared，可在下方下载。填写后点击创建，下方会显示 Tunnel、路由、DNS 和公网登录页的真实阶段。</p><div class="guide-diagram remote-stage-diagram" aria-label="真实创建阶段"><span data-remote-phase="tunnel">创建 Tunnel</span><span data-remote-phase="route">设置路由</span><span data-remote-phase="dns">添加 DNS</span><span data-remote-phase="probe">验证公网登录页</span></div><div class="remote-form-grid"><label>你接入的域名<input id="remote-zone" type="text" placeholder="example.com" autocomplete="off"></label><label>想用的子域名<input id="remote-subdomain" type="text" placeholder="study" autocomplete="off"></label><label>Account ID<input id="remote-account-id" type="text" placeholder="从账户首页复制" autocomplete="off"></label><label>Zone ID<input id="remote-zone-id" type="text" placeholder="从域名概览复制" autocomplete="off"></label><label class="remote-token-field">限权 API 令牌<input id="remote-api-token" type="password" placeholder="本次创建后不保存" autocomplete="off"></label></div><div class="guide-actions"><button class="btn btn-primary" id="remote-named-setup" type="button">创建固定地址</button><button class="btn btn-secondary" id="remote-guide-download" type="button">下载 cloudflared</button><button class="btn btn-text" id="remote-guide-settings" type="button">去设置访问密码</button><button class="btn btn-secondary" id="remote-recheck" type="button">重新检查状态</button></div><div class="guide-stage" id="remote-stage" role="status" aria-live="polite">等待创建</div><p class="text-helper" id="remote-guide-error" role="alert"></p></section>
          <section class="guide-panel" data-guide-panel="remote" data-step="4"><span class="guide-panel-number">第四步 · 管理连接</span><h2>你的固定地址</h2><div class="guide-diagram" role="img" aria-label="你的其他设备通过固定域名和 Cloudflare 连接本机安全网关"><span>手机或另一台电脑</span><b aria-hidden="true">→</b><span>你的固定域名</span><b aria-hidden="true">→</b><span>本机安全网关</span></div><div class="guide-stage" id="remote-result" role="status" aria-live="polite">正在检查已保存的配置…</div><div class="guide-actions"><a class="btn btn-primary" id="remote-named-url" target="_blank" rel="noopener noreferrer" hidden>打开地址</a><button class="btn btn-secondary" id="remote-named-copy" type="button" hidden>复制地址</button><button class="btn btn-secondary" id="remote-named-enable" type="button">连接 / 恢复</button><button class="btn btn-text" id="remote-named-disable" type="button">停用</button></div><p class="text-helper">停用只断开这台电脑，Cloudflare 上的 Tunnel 和 DNS 保留。临时地址与固定地址一次只能运行一种。</p></section></div>`;
        const byId = id => document.getElementById(id);
        const api = window.daguanDesktop?.remoteAccess;
        let startedHere = false, previousConnected = false;
        let firstOpen = localStorage.getItem('daguan_guide_remote_step_v1') === null;
        const render = status => {
            if (!byId('remote-result')) return;
            const configured = Boolean(status.configured);
            const connected = status.mode === 'named' && status.state === 'connected';
            byId('remote-named-setup').disabled = configured;
            byId('remote-named-enable').disabled = !configured || connected;
            byId('remote-named-disable').disabled = !configured || !status.enabled;
            byId('remote-stage').textContent = status.phase || (status.state === 'error' ? '连接失败' : '等待创建');
            const phase = /Tunnel/.test(status.phase) ? 'tunnel' : /路由/.test(status.phase) ? 'route' : /DNS/.test(status.phase) ? 'dns' : /公网|Cloudflare/.test(status.phase) ? 'probe' : '';
            main.querySelectorAll('[data-remote-phase]').forEach(item => { item.dataset.active = String(item.dataset.remotePhase === phase); });
            if (status.error) byId('remote-guide-error').textContent = `${status.phase || '失败'}：${status.error}。检查令牌权限、DNS 冲突或网络后重试；如果配置已保存，请使用「连接 / 恢复」。`;
            else if (connected) byId('remote-guide-error').textContent = '';
            byId('remote-result').textContent = !configured ? '还没有固定域名配置。请从第一步开始。' : connected ? `公网登录页已验证：${status.url}` : `${status.hostname} · ${status.phase || (status.enabled ? '正在连接' : '已停用')}。地址尚未验证可访问。`;
            byId('remote-named-url').hidden = !connected;
            byId('remote-named-copy').hidden = !connected;
            if (connected) byId('remote-named-url').href = status.url;
            if (configured && firstOpen && !startedHere) { this.selectGuideStep('remote', 4, 4); firstOpen = false; }
            if (connected && !previousConnected && startedHere) {
                this.selectGuideStep('remote', 4, 4);
                this.celebrateGuide(byId('remote-result'));
            }
            previousConnected = connected;
        };
        const refresh = async () => { try { render(await api('status')); } catch (error) { byId('remote-guide-error').textContent = error.message || String(error); } };
        const invoke = async (action, input) => {
            startedHere = true;
            byId('remote-guide-error').textContent = '';
            try { const result = await api(action, input); render(result); await refresh(); if (result.operationError) byId('remote-guide-error').textContent = `${result.phase || '操作失败'}：${result.operationError}`; else if (action === 'download') byId('remote-stage').textContent = 'cloudflared 已下载并校验，可以继续创建。'; }
            catch (error) { byId('remote-guide-error').textContent = `${error.message || String(error)}。请检查当前阶段后重试。`; await refresh(); }
        };
        main.querySelectorAll('[data-guide-nav="remote"]').forEach(button => button.onclick = () => this.selectGuideStep('remote', button.dataset.step, 4));
        main.querySelectorAll('[data-remote-next]').forEach(button => button.onclick = () => this.selectGuideStep('remote', button.dataset.remoteNext, 4));
        byId('remote-guide-restart').onclick = () => { firstOpen = false; this.selectGuideStep('remote', 1, 4); };
        byId('remote-domain-next').onclick = () => { if (!byId('remote-domain-ready').checked) { byId('remote-domain-ready').focus(); return; } this.selectGuideStep('remote', 2, 4); };
        byId('remote-named-setup').onclick = () => {
            const input = { zone: byId('remote-zone').value.trim(), subdomain: byId('remote-subdomain').value.trim(), accountId: byId('remote-account-id').value.trim(), zoneId: byId('remote-zone-id').value.trim(), apiToken: byId('remote-api-token').value };
            if (Object.values(input).some(value => !value)) { byId('remote-guide-error').textContent = '请填写域名、子域名、两个 ID 和限权令牌。'; return; }
            byId('remote-api-token').value = '';
            byId('remote-named-setup').disabled = true;
            void invoke('named:setup', input);
        };
        byId('remote-recheck').onclick = () => void refresh();
        byId('remote-guide-download').onclick = () => void invoke('download');
        byId('remote-guide-settings').onclick = () => void this.navigate('settings');
        byId('remote-named-enable').onclick = () => void invoke('named:enable');
        byId('remote-named-disable').onclick = () => void invoke('named:disable');
        byId('remote-named-copy').onclick = () => { const url = byId('remote-named-url').href; void navigator.clipboard.writeText(url).then(() => { byId('remote-result').textContent = `已复制：${url}`; }); };
        this.selectGuideStep('remote', this.guideStep('remote', 4), 4);
        if (api) void refresh();
        const timer = setInterval(() => { if (!byId('remote-result')) { clearInterval(timer); return; } void refresh(); }, 1500);
    }

    static celebrateGuide(target) {
        if (!target?.classList || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        target.classList.add('guide-celebrate');
        setTimeout(() => target.classList.remove('guide-celebrate'), 1900);
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
        document.querySelectorAll('.topbar-version-switch').forEach(button => { button.disabled = true; });
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
            document.querySelectorAll('.topbar-version-switch').forEach(button => { button.disabled = false; });
        }
    }

    static async previousQuestion() {
        return this.stepQuestion(-1);
    }

    static async nextQuestion() {
        return this.stepQuestion(1);
    }

    static adjacentQuestionSections(delta) {
        if (!AppState.currentCategory || !AppState.currentChapter || AppState.temporaryQuestionView) return [];
        const sections = [];
        const visit = node => {
            const children = node.children || [];
            if (children.length) {
                if (node.direct_questions?.length) sections.push({ ...node, _directOnly: true });
                children.forEach(visit);
            } else if (DataService.chapterEntries(node).length) sections.push(node);
        };
        visit(AppState.currentCategory);
        const index = sections.findIndex(node => String(node.id) === String(AppState.currentChapter.id));
        if (index < 0) return [];
        return delta > 0 ? sections.slice(index + 1) : sections.slice(0, index).reverse();
    }

    static async stepQuestion(delta) {
        if (AppState.questionStepping || !AppState.questions.length) return;
        AppState.questionStepping = true;
        try {
            const index = AppState.currentQuestionIndex + (AppState.questionMode === 'multi' ? AppState.questionOffset : 0);
            const count = AppState.questionMode === 'multi' ? DataService.chapterEntries(AppState.currentChapter).length : AppState.questions.length;
            const target = index + delta;
            if (target >= 0 && target < count) {
                if (AppState.questionMode === 'multi') return await this.goToChapterQuestion(target);
                if (!await this.ensureSavedBeforeLeavingQuestion()) return;
                AppState.temporaryQuestionView = false;
                await UIRenderer.renderQuestion(target);
                this.recordVisit(AppState.questions[AppState.currentQuestionIndex]?.id, AppState.currentCategory?.id, AppState.currentChapter?.id);
                return;
            }
            const candidates = this.adjacentQuestionSections(delta);
            if (!AppState.currentChapter || AppState.temporaryQuestionView) return;
            if (!await this.ensureSavedBeforeLeavingQuestion()) return;
            const completed = AppState.currentChapter;
            for (const node of candidates) {
                const chapter = await UIRenderer.filteredChapter(node, node._directOnly === true);
                chapter._directOnly = node._directOnly === true;
                const entries = DataService.chapterEntries(chapter);
                if (!entries.length) continue;
                const previous = {
                    currentChapter: AppState.currentChapter, questions: AppState.questions,
                    currentQuestionIndex: AppState.currentQuestionIndex, questionOffset: AppState.questionOffset,
                    chapterQuestionCount: AppState.chapterQuestionCount, questionMode: AppState.questionMode,
                };
                await this.enterChapterQuestions(chapter, delta > 0 ? 0 : entries.length - 1, null, AppState.questionMode);
                if (AppState.currentView !== 'question') {
                    Object.assign(AppState, previous, { currentView: 'question' });
                    if (AppState.questionMode === 'multi') await UIRenderer.renderMultiRange(previous.questionOffset, previous.questions[previous.currentQuestionIndex]?.id);
                    else await UIRenderer.renderQuestion(previous.currentQuestionIndex);
                    return;
                }
                if (delta > 0) window.DaguanSectionCelebration?.show(completed.name || completed.title, completed.id);
                return;
            }
            if (delta > 0) window.DaguanSectionCelebration?.show(completed.name || completed.title, completed.id);
            else toast('已经是当前范围的第一节');
        } catch (error) {
            toast(`切换小节失败：${error.message || '请重试'}`);
        } finally {
            AppState.questionStepping = false;
        }
    }

    // 切题前的保存先行：批注/AI 草稿/服务端队列清空后才渲染下一题；失败留在当前题。
    static async ensureSavedBeforeLeavingQuestion({ stopAI = true } = {}) {
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
        if (stopAI) this.abortAIStream();
        return true;
    }

    static selectOption(index) {
        const question = AppState.questions[AppState.currentQuestionIndex];
        const root = document.querySelector('.question-wrapper');
        if (question && root) this.selectQuestionOption(question.id, index, root.querySelectorAll('.option-item')[index]);
    }

    static selectQuestionOption(questionId, index, optionEl) {
        const question = AppState.questions.find(item => String(item.id) === String(questionId));
        if (!question || !optionEl) return;
        if (!question.options?.[index]) return;
        const label = ChoiceGrading.label(question, index);
        const key = String(question.id);
        if (!AppState.answers[key]) AppState.answers[key] = new Set();
        const root = optionEl.closest('[data-question-id]');
        if (ChoiceGrading.answer(question)) {
            const previous = AppState.answers[key];
            const unchanged = previous.size === 1 && previous.has(label);
            AppState.answers[key] = new Set([label]);
            const ok = ChoiceGrading.grade(question, AppState.answers[key]);
            if (!unchanged && PreviewAccess.privateAllowed(false)) {
                window.DaguanStudyActivity?.answer(key, ok, true, this.studyChapterDetails());
                if (!ok && !StorageService.isFavorite(key)) window.DaguanStudyActivity?.favorite(key, 'automatic', this.studyChapterDetails());
            }
            if (PreviewAccess.privateAllowed(false)) window.DaguanStudyActivity?.reveal(key);
            root.querySelectorAll('.option-item').forEach((item, i) => {
                const optionLabel = ChoiceGrading.label(question, i);
                const selected = optionLabel === label;
                const correct = optionLabel === ChoiceGrading.answer(question);
                item.classList.toggle('selected', selected);
                item.classList.toggle('correct', correct);
                item.classList.toggle('incorrect', selected && !correct);
                item.setAttribute('aria-pressed', String(selected));
                item.querySelector('.choice-option-tag')?.remove();
                if (correct || selected) {
                    const tag = document.createElement('span'); tag.className = 'choice-option-tag';
                    tag.textContent = correct ? '正确答案' : '你的选择'; item.appendChild(tag);
                }
            });
            ChoiceGrading.feedback(root.querySelector('.question-options'), ok);
            const answer = root.querySelector('.answer-section');
            if (answer) { answer.style.display = 'block'; UIRenderer.fillExplanationV2(answer); }
            const button = root.querySelector('.expand-answer-btn') || document.getElementById('show-answer-btn');
            if (button) { button.textContent = '隐藏答案'; button.setAttribute('aria-expanded', 'true'); }
            if (!unchanged && PreviewAccess.privateAllowed(false)) {
                const { data, entry } = StorageService._entry(key);
                const patch = ChoiceGrading.patch(ok, entry, StorageService.isFavorite(key));
                try {
                    StorageService._write(data, key, { ...entry, ...patch });
                    StateSync.queueQuestion(key, patch);
                    if (!StateSync.available) toast('作答状态尚未同步，已保留在本机，将自动重试');
                    this.updateQuestionStateUI(key);
                } catch { toast('作答状态保存失败，请重试；判题结果仍可查看'); }
            }
            return;
        }
        if (question.type !== 'multiple_choice') {
            if (PreviewAccess.privateAllowed(false)) window.DaguanStudyActivity?.study(key, this.studyChapterDetails());
            AppState.answers[key] = new Set([label]);
            root.querySelectorAll('.option-item').forEach((item, i) => {
                const selected = i === index; item.classList.toggle('selected', selected);
                item.setAttribute('aria-pressed', String(selected));
            });
            return;
        }
        const selected = optionEl.classList.toggle('selected');
        if (selected && PreviewAccess.privateAllowed(false)) window.DaguanStudyActivity?.study(key, this.studyChapterDetails());
        if (selected) AppState.answers[key].add(label); else AppState.answers[key].delete(label);
    }

    static toggleAnswer() {
        const answerSection = document.getElementById('answer-section');
        const btn = document.getElementById('show-answer-btn');

        if (answerSection.style.display === 'none') {
            if (PreviewAccess.privateAllowed(false)) window.DaguanStudyActivity?.reveal(AppState.questions[AppState.currentQuestionIndex]?.id);
            answerSection.style.display = 'block';
            UIRenderer.fillExplanationV2(answerSection);
            btn.textContent = '隐藏答案';

            // Only move the question's scroller. scrollIntoView also scrolls
            // overflow:hidden ancestors, pulling the footer up and exposing blank space.
            setTimeout(() => {
                const content = answerSection.closest('.question-content');
                if (!content || !answerSection.isConnected || answerSection.style.display === 'none') return;
                const rect = answerSection.getBoundingClientRect();
                const viewport = content.getBoundingClientRect();
                if (rect.top >= viewport.bottom || rect.bottom <= viewport.top) {
                    content.scrollTo({ top: content.scrollTop + rect.top - viewport.top,
                        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
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
        if (isFav) window.DaguanStudyActivity?.favorite(questionId, 'manual', this.studyChapterDetails());
        const btn = event.currentTarget;
        btn.classList.toggle('active', isFav);
        StateSync.queueQuestion(questionId, { favorite: isFav });
    }

    static toggleMistake(questionId) {
        return this.toggleQuestionMistake(questionId);
    }

    static toggleMastered(questionId) {
        this.cycleMastery(questionId);
    }

    static cycleMastery(questionId) {
        if (!PreviewAccess.privateAllowed()) return;
        const value = StorageService.cycleMastery(questionId);
        if (['learning', 'mastered'].includes(value)) window.DaguanStudyActivity?.study(questionId, this.studyChapterDetails());
        StateSync.queueQuestion(questionId, { mastery: value });
        this.updateQuestionStateUI(questionId);
    }

    static setQuestionMastery(questionId, mastery) {
        if (!questionId || !PreviewAccess.privateAllowed()) return;
        const value = StorageService.setMastery(questionId, mastery);
        if (['learning', 'mastered'].includes(value)) window.DaguanStudyActivity?.study(questionId, this.studyChapterDetails());
        StateSync.queueQuestion(questionId, { mastery: value });
        this.updateQuestionStateUI(questionId);
    }

    static studyChapterDetails() {
        return { chapter_id: AppState.currentChapter?.id, chapter_name: AppState.currentChapter?.name || AppState.currentChapter?.title || '未分类' };
    }

    static updateQuestionStateUI(questionId) {
        const id = String(questionId);
        const safeId = CSS.escape(id);
        const progress = StorageService.getProgress().progress[id] || {};
        const mastery = ['not_started', 'learning', 'mastered'].includes(progress.mastery) ? progress.mastery : 'not_started';
        const mistake = progress.error_prone === true;

        document.querySelectorAll(`[data-question-id="${safeId}"]`).forEach(questionRoot => {
            questionRoot.querySelectorAll('.question-mastery-choice').forEach(button => {
                const selected = button.dataset.masteryChoice === mastery;
                button.classList.remove('mastery-not_started', 'mastery-learning', 'mastery-mastered');
                button.classList.add(`mastery-${button.dataset.masteryChoice}`);
                button.classList.toggle('active', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
            questionRoot.querySelectorAll('.question-mastery-badge').forEach(badge => {
                badge.classList.remove('mastery-not_started', 'mastery-learning', 'mastery-mastered');
                badge.classList.add(`mastery-${mastery}`);
                badge.textContent = masteryLabel(mastery);
            });
            questionRoot.querySelectorAll('.question-mistake-badge').forEach(badge => { badge.hidden = !mistake; });
            questionRoot.querySelectorAll('.question-mistake-toggle').forEach(button => {
                button.classList.toggle('active', mistake);
                button.setAttribute('aria-pressed', String(mistake));
                button.textContent = `${mistake ? '✓ ' : ''}易错`;
            });
        });

        const favorite = StorageService.isFavorite(id);
        document.querySelectorAll(`[data-question-id="${safeId}"] .action-btn[data-shortcut-hint="favorite"], [data-question-id="${safeId}"] .multi-card-actions .action-btn:first-child`).forEach(button => {
            button.classList.toggle('active', favorite);
            button.setAttribute('aria-pressed', String(favorite));
        });
        document.querySelectorAll(`.question-rail-item[data-question-id="${safeId}"]`).forEach(rail => {
            rail.classList.toggle('favorite', favorite);
            rail.dataset.mastery = mastery;
            rail.classList.remove('not_started', 'learning', 'mastered', 'mastery-not_started', 'mastery-learning', 'mastery-mastered');
            if (mastery !== 'not_started') rail.classList.add(mastery);
            rail.classList.toggle('error-prone', mistake);
            const questionNumber = Number(rail.dataset.questionNumber) || 0;
            rail.setAttribute('aria-label', `第 ${questionNumber} 题，题号 ${id}，${masteryLabel(mastery)}${favorite ? '，已收藏' : ''}${mistake ? '，易错' : ''}`);
        });
        this.filterQuestionRailItems();
        this.refreshShortcutHints(document.querySelector('.question-main') || document.querySelector('.multi-question-view') || document);
    }

    static toggleAI() {
        if (!PreviewAccess.privateAllowed()) return;
        const panel = document.getElementById('ai-panel');
        if (!panel) return;

        const isOpen = !panel.classList.contains('closed');
        panel.classList.toggle('closed', isOpen);
        AppState.ui.aiPanelOpen = !isOpen;
        window.DaguanAIPanelLayout?.update();

        if (!isOpen) {
            if (!AppState.aiProfiles) AIService.loadProfiles();
            if (!panel.querySelector('#ai-input')) UIRenderer.renderAIPanel();
            else window.DaguanAIPanelLayout?.update();
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

    static sendAIPrompt(...args) { return AIController.sendAIPrompt.apply(this, args); }
    static selectAIProfile(...args) { return AIController.selectAIProfile.apply(this, args); }
    static aiBusyUi(...args) { return AIController.aiBusyUi.apply(this, args); }
    static stopAIStream(...args) { return AIController.stopAIStream.apply(this, args); }
    static abortAIStream(...args) { return AIController.abortAIStream.apply(this, args); }
    static sendAIMessage(...args) { return AIController.sendAIMessage.apply(this, args); }
    static retryAIMessage(...args) { return AIController.retryAIMessage.apply(this, args); }

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

        preview.innerHTML = renderMarkdown(textarea.value);
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
        if (width >= 1024) AppState.ui.navOpen = false;
        this.syncNav();
    }

    static toggleNav() {
        if (window.innerWidth >= 1024) {
            AppState.ui.navExpanded = !AppState.ui.navExpanded;
            try { localStorage.setItem('daguan_new_nav_hidden', AppState.ui.navExpanded ? '0' : '1'); } catch {}
        } else AppState.ui.navOpen = !AppState.ui.navOpen;
        this.syncNav();
    }

    static syncNav() {
        const nav = document.getElementById('app-nav');
        const overlay = document.querySelector('body > .nav-overlay');
        const desktop = window.innerWidth >= 1024;
        const visible = desktop ? AppState.ui.navExpanded : AppState.ui.navOpen;
        if (nav) nav.classList.toggle('open', AppState.ui.navOpen);
        document.body.classList.toggle('desktop-nav-hidden', desktop && !visible);
        if (overlay) overlay.classList.toggle('open', AppState.ui.navOpen);
        const button = document.getElementById('btn-toggle-nav');
        button?.setAttribute('aria-expanded', String(visible));
        button?.setAttribute('aria-label', visible ? '收起导航' : '展开导航');
        window.DaguanAIPanelLayout?.update();
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
