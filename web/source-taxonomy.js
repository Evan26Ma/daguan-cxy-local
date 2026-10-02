/*!
 * 大观园题库 · 题源分类（体系 / 书目 两级）
 *
 * 题库分片里的 `source` 字段是人工录入的自由文本，例如：
 *   「🫚真题同源 150；26 版 660 数一二三第 95 题（重点）」
 *   「900 第三章数二 A 类 26」
 *   「2000数一（8）；🐙30例16.20；880基础选择4；🖐️强化严选第七章8」
 *
 * 本文件把这串自由文本拆成「体系（老师 / 题库品牌）」+「书目（具体一本书）」两级标签，
 * 供新版界面（app-new.js）和旧版界面（app-legacy.js）共用。
 *
 * 设计约定：
 *  - 纯函数，无副作用，不发起网络请求；可在浏览器 <script> 与 node vm 里直接运行。
 *  - 一条 source 可命中多个体系 / 书目（多来源题），筛选语义是「交集非空」。
 *  - 体系与书目的 id 稳定，界面里用 `sys:<id>` / `book:<id>` 作为筛选值。
 *  - 旧版界面历史上用的 8 个粗桶名（sourceGroup）仍保留为兼容键，见 legacyGroup()。
 *  - **源文本里没有明写老师时不猜老师**，改用「书名自成体系」（880/660/900/108考点/1800题/
 *    复习全书/魔法练习册 都是这样处理的），避免把书错挂到某位老师名下。
 */
(function (root) {
    'use strict';

    // ---------------------------------------------------------------- 体系（一级）

    const SYSTEMS = [
        { id: 'exam', label: '历年真题', emoji: '📄' },
        { id: 'jiang', label: '姜晓千', emoji: '🫚' },
        { id: 'zhangyu', label: '张宇', emoji: '🐙' },
        { id: 'wuzhongxiang', label: '武忠祥', emoji: '🖐️' },
        { id: 'liyongle', label: '李永乐', emoji: '📘' },
        { id: 'lizhengyuan', label: '李正元', emoji: '📙' },
        { id: 'meizhale', label: '没咋了', emoji: '🎓' },
        { id: 't880', label: '880题', emoji: '8️⃣' },
        { id: 't660', label: '660题', emoji: '6️⃣' },
        { id: 't900', label: '900题', emoji: '9️⃣' },
        { id: 't1800', label: '1800题', emoji: '1️⃣' },
        { id: 'kd108', label: '108考点', emoji: '🔢' },
        { id: 'quanshu', label: '复习全书', emoji: '📕' },
        { id: 'magic', label: '魔法练习册', emoji: '🪄' },
        { id: 'mock', label: '模拟卷', emoji: '📝' },
        { id: 'contest', label: '竞赛题', emoji: '🏆' },
        { id: 'other', label: '其他来源', emoji: '❓' },
    ];

    // ---------------------------------------------------------------- 书目（二级）

    const BOOKS = [
        { id: 'exam_national', system: 'exam', label: '统考真题' },
        { id: 'exam_school', system: 'exam', label: '院校真题' },

        { id: 'jiang_150', system: 'jiang', label: '真题同源150' },
        { id: 'jiang_basic', system: 'jiang', label: '基础例题' },
        { id: 'jiang_strong', system: 'jiang', label: '强化例题' },
        { id: 'jiang_other', system: 'jiang', label: '姜晓千讲义' },

        { id: 'zy_1000', system: 'zhangyu', label: '1000题' },
        { id: 'zy_30', system: 'zhangyu', label: '30讲' },
        { id: 'zy_other', system: 'zhangyu', label: '张宇讲义' },

        { id: 'wzx_basic', system: 'wuzhongxiang', label: '基础严选题' },
        { id: 'wzx_strong', system: 'wuzhongxiang', label: '强化严选题' },
        { id: 'wzx_other', system: 'wuzhongxiang', label: '严选题' },

        { id: 'lyl_line', system: 'liyongle', label: '线代辅导讲义' },
        { id: 'lyl_other', system: 'liyongle', label: '李永乐讲义' },

        { id: 'lzy_example', system: 'lizhengyuan', label: '李正元例题' },
        { id: 'lzy_other', system: 'lizhengyuan', label: '李正元讲义' },

        { id: 'mzl_prob', system: 'meizhale', label: '概率救命课' },

        { id: 'b880', system: 't880', label: '880题' },
        { id: 'b660', system: 't660', label: '660题' },
        { id: 'b900', system: 't900', label: '900题' },
        { id: 'b1800', system: 't1800', label: '1800题' },
        { id: 'b108', system: 'kd108', label: '108考点' },
        { id: 'bquanshu', system: 'quanshu', label: '复习全书（红皮）' },
        { id: 'bmagic', system: 'magic', label: '魔法练习册' },

        { id: 'mock_zhang8', system: 'mock', label: '张八卷' },
        { id: 'mock_li6', system: 'mock', label: '李六卷' },
        { id: 'mock_lyf', system: 'mock', label: 'LYF三套卷' },
        { id: 'mock_euclid', system: 'mock', label: 'Euclid 八月模考' },
        { id: 'mock_other', system: 'mock', label: '其他模拟卷' },

        { id: 'contest', system: 'contest', label: '竞赛题' },

        { id: 'other', system: 'other', label: '其他来源' },
    ];

    const SYSTEM_BY_ID = new Map(SYSTEMS.map(item => [item.id, item]));
    const BOOK_BY_ID = new Map(BOOKS.map(item => [item.id, item]));

    // ---------------------------------------------------------------- 匹配规则
    //
    // 顺序敏感：先判的规则先赢。要点：
    //  1. 竞赛题必须排在历年真题之前，否则「1996老北京竞赛」会被年份规则吞掉；
    //     「北京市大学生数学竞赛题」里带「大学」，也必须先被竞赛规则拦下。
    //  2. 线岱杨 / 郭伟强化 / 复习全书 里含「强化例题」「例」等词，必须排在姜晓千、李正元之前。
    //  3. 660 排在 108考点之前（`25版660数一二三第108题` 里的 108 不是 108考点）。
    //  4. Euclid 排在「其他模拟卷」之前（卷名里带「模考」）。
    //  5. 「郭伟模考」本质是模拟卷，排在「郭伟」隔离规则之前。

    const RULES = [
        // 竞赛题
        { system: 'contest', book: 'contest', re: /竞赛/ },
        // 郭伟的模考卷其实是模拟卷
        { system: 'mock', book: 'mock_other', re: /郭伟\s*模考/ },
        // 不属于常见系列的零散讲义，先隔离出来
        { system: 'other', book: 'other', re: /线岱杨|郭伟|超越135/ },
        // 复习全书（红皮）= 二李（李永乐 + 李正元）合著，不在两位老师之间选边，自成体系
        { system: 'quanshu', book: 'bquanshu', re: /复习全书/ },
        // 魔法练习册：源文本里只写了书名，没有老师
        { system: 'magic', book: 'bmagic', re: /魔法练习册/ },

        // 历年真题：院校真题（形如「浙江大学,2002年」「1995南京大学」「2021四川大学」）
        { system: 'exam', book: 'exam_school', re: /大学|学院/ },
        // 历年真题：统考真题（形如「1993数一」「2022 数学一真题」「2000数一（8）」「2011年数学三第2题」）
        { system: 'exam', book: 'exam_national', re: /(?:^|[^0-9])(?:19|20)\d{2}\s*年?\s*(?:数学)?\s*数?\s*[一二三]/ },
        { system: 'exam', book: 'exam_national', re: /^(?:19|20)\d{2}\s*年$/ },

        // 姜晓千
        { system: 'jiang', book: 'jiang_150', re: /真题同源/ },
        { system: 'jiang', book: 'jiang_strong', re: /强化例题/ },
        { system: 'jiang', book: 'jiang_basic', re: /基础例题/ },
        { system: 'jiang', book: 'jiang_other', re: /🫚/ },

        // 武忠祥
        { system: 'wuzhongxiang', book: 'wzx_basic', re: /基础严选/ },
        { system: 'wuzhongxiang', book: 'wzx_strong', re: /强化严选/ },
        { system: 'wuzhongxiang', book: 'wzx_other', re: /🖐|严选/ },

        // 没咋了
        { system: 'meizhale', book: 'mzl_prob', re: /没咋了|概率救命课/ },

        // 李正元
        { system: 'lizhengyuan', book: 'lzy_example', re: /李正元\s*例/ },
        { system: 'lizhengyuan', book: 'lzy_other', re: /李正元/ },

        // 李永乐
        { system: 'liyongle', book: 'lyl_line', re: /李永乐[^;；]*讲义/ },
        { system: 'liyongle', book: 'lyl_other', re: /李永乐/ },

        // 张宇：1000题（含「0.1w」「10.1w」写法，以及只在 1000 题里出现的来源图标）
        { system: 'zhangyu', book: 'zy_1000', re: /1000\s*题|0\.1w|10\.1w|(?<![0-9])1000(?![0-9])/ },
        { system: 'zhangyu', book: 'zy_1000', re: /[☀☏☎♣🎧👤♻♂😅][^;；]*(?:1000|0\.1w|10\.1w)|(?:1000|0\.1w|10\.1w)[^;；]*[☀☏☎♣🎧👤♻♂😅]/ },
        // 张宇：30讲系列（30例 / 30习题 / 30注例 / 线代9讲 / 题源1000题习题册）
        { system: 'zhangyu', book: 'zy_30', re: /(?<![0-9])30\s*(?:注)?\s*(?:例|习题|讲)|9\s*讲|题源1000题/ },
        { system: 'zhangyu', book: 'zy_other', re: /张宇|🐙/ },

        // 880 / 660 / 900 / 1800 / 108考点
        { system: 't660', book: 'b660', re: /660/ },
        { system: 't880', book: 'b880', re: /880/ },
        { system: 't900', book: 'b900', re: /(?<![0-9])900\s*题?(?![0-9])/ },
        { system: 't1800', book: 'b1800', re: /(?<![0-9])1800(?![0-9])/ },
        { system: 'kd108', book: 'b108', re: /108\s*考点/ },
        // 880 题里被截掉书名的章节残片，形如「第五章数二 A 类」
        { system: 't880', book: 'b880', re: /第[一二三四五六七八九十]+章\s*数[一二三]\s*[ABC]\s*[类组]|数[一二三]\s*第[一二三四五六七八九十]+章\s*[ABC]\s*[类组]/ },

        // 模拟卷
        { system: 'mock', book: 'mock_zhang8', re: /张八卷|八套卷/ },
        { system: 'mock', book: 'mock_li6', re: /李六卷|六套卷/ },
        { system: 'mock', book: 'mock_lyf', re: /LYF/i },
        { system: 'mock', book: 'mock_euclid', re: /Euclid/i },
        { system: 'mock', book: 'mock_other', re: /模拟|模考|第[一二三四五六七八九十]+套/ },
    ];

    const MARKER_RE = /[（(]\s*(?:重点|选做|经典题|版本二|仅数三)\s*[)）]/g;
    // 纯标记 token（分号切完之后只剩这些的，不携带任何来源信息，直接丢掉）
    const DROP_TOKEN_RE = /^(?:仅数三|版本二|经典题|重点|选做|\d{1,2})$/;

    // ---------------------------------------------------------------- 工具

    function systemKey(id) { return `sys:${id}`; }
    function bookKey(id) { return `book:${id}`; }

    /** 剥掉最外层的成对括号；只有「同时」以括号开头和结尾才剥，避免吃掉「复习全书（红）」的尾巴。 */
    function stripWrappingParens(text) {
        let value = text;
        while (/^[（(]/.test(value) && /[)）]$/.test(value)) {
            value = value.slice(1, -1).trim();
        }
        return value;
    }

    /** 拆成一个个来源 token（去掉包裹括号与题号前缀，如「(0) 900 第三章数二 B 类 41」）。 */
    function tokenize(source) {
        return String(source || '')
            .split(/[;；]/)
            .map(raw => stripWrappingParens(
                raw.trim().replace(/^[（(]\s*\d+\s*[.、)）]\s*/, '')
            ))
            .filter(token => token && !DROP_TOKEN_RE.test(token));
    }

    /** 旧版界面的 8 个粗桶，保留作为兼容筛选值。 */
    function legacyGroup(source) {
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

    function classifyToken(token) {
        for (const rule of RULES) {
            if (rule.re.test(token)) return { system: rule.system, book: rule.book };
        }
        return { system: 'other', book: 'other' };
    }

    /** 去掉「（重点）」「（选做）」这类人工标记，保留其余原文用于展示细节。 */
    function cleanToken(token) {
        return token.replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
    }

    /**
     * 把一条 source 归类。
     * @returns {{systems: string[], books: string[], keys: string[], parts: {system: string, book: string, systemLabel: string, bookLabel: string, token: string}[], legacy: string}}
     */
    function classify(source) {
        const parts = [];
        const seen = new Set();
        for (const token of tokenize(source)) {
            const hit = classifyToken(token);
            const text = cleanToken(token);
            const key = `${hit.system}|${hit.book}|${text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const system = SYSTEM_BY_ID.get(hit.system);
            const book = BOOK_BY_ID.get(hit.book);
            // 没归到任何系列时，把清洗后的原文当「书目」，让界面仍能显示「其他来源 · 25 版 强化 33」
            const bookLabel = hit.system === 'other'
                ? (text || (book ? book.label : hit.book))
                : (book ? book.label : hit.book);
            parts.push({
                system: hit.system,
                book: hit.book,
                systemLabel: system ? system.label : hit.system,
                bookLabel,
                token: text,
            });
        }
        const systems = [...new Set(parts.map(part => part.system))];
        const books = [...new Set(parts.map(part => part.book))];
        if (systems.length === 0) {
            systems.push('other');
            books.push('other');
        }
        return {
            systems,
            books,
            keys: [...systems.map(systemKey), ...books.map(bookKey)],
            parts,
            legacy: legacyGroup(source),
        };
    }

    /** 供筛选用的键集合：新两级键 + 旧粗桶名（兼容已保存的筛选条件）。 */
    function keySet(source) {
        const result = classify(source);
        const keys = new Set(result.keys);
        keys.add(result.legacy);
        return keys;
    }

    /** 已选筛选值与该题是否有交集；selected 为空表示不筛选。 */
    function matches(selected, source) {
        if (!Array.isArray(selected) || selected.length === 0) return true;
        const keys = keySet(source);
        return selected.some(value => keys.has(value));
    }

    /** 主体系（用于列表分组 / 排序），取第一个命中的体系。 */
    function primarySystem(source) {
        const result = classify(source);
        return result.systems[0] || 'other';
    }

    /** 拼「体系 · 书目」，避免重复（如「880题 · 880题」）或啰嗦（如「复习全书 · 复习全书（红皮）」）。 */
    function joinLabel(systemLabel, bookLabel) {
        if (!bookLabel || bookLabel === systemLabel) return systemLabel;
        if (bookLabel.indexOf(systemLabel) === 0) return bookLabel;
        return `${systemLabel} · ${bookLabel}`;
    }

    /** 人话标签，如「姜晓千 · 真题同源150」「张宇 · 1000题」「其他来源 · 25 版 强化 33」。 */
    function describe(source, limit = 3) {
        const result = classify(source);
        const labels = [];
        for (const part of result.parts) {
            const label = joinLabel(part.systemLabel, part.bookLabel);
            if (!labels.includes(label)) labels.push(label);
            if (labels.length >= limit) break;
        }
        return labels.join('；') || '其他来源';
    }

    /** 两级选项树（不含计数），供筛选面板渲染。 */
    function options() {
        return SYSTEMS
            .filter(system => system.id !== 'other')
            .map(system => ({
                system,
                key: systemKey(system.id),
                books: BOOKS.filter(book => book.system === system.id && book.id !== system.id)
                    .map(book => ({ book, key: bookKey(book.id) })),
            }))
            .concat([{ system: SYSTEM_BY_ID.get('other'), key: systemKey('other'), books: [] }]);
    }

    /** 把任意筛选值翻译成中文标签，用于「已选条件」提示。 */
    function labelOf(value) {
        const text = String(value || '');
        if (text.startsWith('sys:')) {
            const system = SYSTEM_BY_ID.get(text.slice(4));
            return system ? system.label : text;
        }
        if (text.startsWith('book:')) {
            const book = BOOK_BY_ID.get(text.slice(5));
            return book ? book.label : text;
        }
        return text;
    }

    const api = {
        SYSTEMS,
        BOOKS,
        systemKey,
        bookKey,
        tokenize,
        stripWrappingParens,
        legacyGroup,
        classify,
        keySet,
        matches,
        primarySystem,
        describe,
        options,
        labelOf,
    };

    root.DaguanSourceTaxonomy = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
