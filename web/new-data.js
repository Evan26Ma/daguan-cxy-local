(function(root) {
"use strict";
root.DaguanNewData = { create({ AppState, fetch }) {
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
        AppState.historyLocationCache = null;
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

    // v2 补写解析（约 4.4 MB）比其它数据文件大得多，因此不进启动关键路径：
    // 只有用户第一次展开某题答案时才按需拉取，拉过一次就常驻内存。
    static explanationsV2Inflight = null;

    static async loadExplanationsV2() {
        try {
            const response = await fetch('./data/explanations-v2.json');
            if (!response.ok) throw new Error('Failed to load explanations v2');
            const data = await response.json();
            AppState.explanationsV2 = (data && data.explanations) || {};
            AppState.explanationsV2Meta = {
                version: data?.version,
                count: data?.count,
                generated: data?.generated
            };
            return AppState.explanationsV2;
        } catch (error) {
            console.warn('Load explanations v2 error:', error);
            AppState.explanationsV2 = {};
            return AppState.explanationsV2;
        }
    }

    // 幂等：一个会话只发一次请求；失败也记成空表，不反复重试拖慢做题。
    static ensureExplanationsV2() {
        if (AppState.explanationsV2) return Promise.resolve(AppState.explanationsV2);
        if (!DataService.explanationsV2Inflight) {
            DataService.explanationsV2Inflight = this.loadExplanationsV2().catch(() => ({}));
        }
        return DataService.explanationsV2Inflight;
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

return DataService;
} };
})(window);
