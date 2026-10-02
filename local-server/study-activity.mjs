import fs from 'node:fs/promises';
import path from 'node:path';

export const STUDY_RANGES = [1, 3, 7, 30, 365];
const learned = p => !!p && !!(p.seen || p.answered || p.last_practiced_at || ['learning', 'mastered', 'forgot'].includes(p.mastery));
const fail = message => Object.assign(new Error(message), { status: 400 });

export function normalizeStudyEvent(raw) {
  if (!raw || !/^[\w-]{8,100}$/.test(raw.event_id || '') || !/^\d+$/.test(String(raw.question_id || '')) ||
      !['study', 'answer', 'reveal', 'favorite'].includes(raw.type)) throw fail('学习事件格式无效');
  const time = Date.parse(raw.at);
  if (!Number.isFinite(time) || time > Date.now() + 60000) throw fail('学习事件时间无效');
  if (raw.type === 'answer' && typeof raw.correct !== 'boolean') throw fail('作答结果无效');
  if (raw.type === 'favorite' && !['manual', 'automatic'].includes(raw.source)) throw fail('收藏来源无效');
  return { event_id: raw.event_id, question_id: String(raw.question_id), at: new Date(time).toISOString(),
    type: raw.type, chapter_id: raw.chapter_id == null ? null : String(raw.chapter_id),
    chapter_name: String(raw.chapter_name || '未分类').slice(0, 200),
    session_id: String(raw.session_id || '').slice(0, 100), correct: raw.correct === true,
    reliable: raw.reliable === true, answer_seen: raw.answer_seen === true, source: raw.source || null };
}

// Subtract a calendar day before 04:00, rather than 24 hours (DST days vary).
export function studyDay(at, timeZone = 'Asia/Hong_Kong') {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  } catch { throw fail('时区或日期无效'); }
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  if (Number(values.hour) < 4) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
const shiftDay = (key, offset) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

export function summarizeStudy(data, { days = 1, timeZone = 'Asia/Hong_Kong', now = Date.now(), onStudy } = {}) {
  days = Number(days);
  if (!STUDY_RANGES.includes(days)) throw fail('统计范围无效');
  const today = studyDay(now, timeZone), start = shiftDay(today, 1 - days);
  const inRange = day => day >= start && day <= today;
  const questions = new Map(), daily = new Map(), favorites = new Map(), chapters = new Map();
  const range = { learned: new Set(), newQuestions: new Set(), firstPass: new Set(), conquered: new Set() };
  const allNew = new Set(), allConquered = new Set();
  const events = Object.values(data.events || {}).sort((a, b) => a.at.localeCompare(b.at) || (a.order || 0) - (b.order || 0) || a.event_id.localeCompare(b.event_id));
  for (const e of events) {
    if (Date.parse(e.at) > Number(now)) continue;
    const id = e.question_id, day = studyDay(e.at, timeZone);
    let q = questions.get(id);
    if (!q) { q = { old: !!data.baseline?.[id], first: null, revealed: false, attempted: false, failed: false }; questions.set(id, q); }
    if (e.type === 'reveal') { q.revealed = true; continue; }
    if (e.type === 'favorite') {
      if (inRange(day)) { const sources = favorites.get(id) || new Set(); sources.add(e.source); favorites.set(id, sources); }
      continue;
    }
    if (!['study', 'answer'].includes(e.type)) continue;
    const dayIds = daily.get(day) || new Set(); dayIds.add(id); daily.set(day, dayIds);
    const first = !q.first && !q.old;
    if (!q.first) { q.first = day; if (!q.old) allNew.add(id); }
    const independent = e.type === 'answer' && e.reliable && !e.answer_seen;
    if (!q.old && !q.attempted && independent && !q.revealed) {
      if (inRange(day)) {
        const key = e.chapter_id || 'unknown';
        const c = chapters.get(key) || { id: key, name: e.chapter_name, sample: 0, correct: 0 };
        c.sample++; if (e.correct) c.correct++; chapters.set(key, c);
        if (first && e.correct) range.firstPass.add(id);
      }
    }
    const conquered = independent && e.correct && q.failed;
    if (conquered) { allConquered.add(id); if (inRange(day)) range.conquered.add(id); }
    // The journal and home report share the same classification of learning events.
    onStudy?.({ event: e, day, isNew: !q.old && q.first === day, conquered,
      newCount: allNew.size, conqueredCount: allConquered.size });
    if (independent && e.correct) q.failed = false;
    if (e.type === 'answer' && e.reliable && !e.correct) q.failed = true;
    if (e.type === 'answer' && e.reliable) q.attempted = true;
    if (inRange(day)) { range.learned.add(id); if (!q.old && inRange(q.first)) range.newQuestions.add(id); }
  }
  const active = [...daily.keys()].filter(key => key <= today).sort();
  let longest = 0, run = 0, previous = null;
  for (const key of active) { run = previous && shiftDay(previous, 1) === key ? run + 1 : 1; longest = Math.max(longest, run); previous = key; }
  let cursor = daily.has(today) ? today : shiftDay(today, -1), streak = 0;
  while (daily.has(cursor)) { streak++; cursor = shiftDay(cursor, -1); }
  const sources = { manual: 0, automatic: 0, both: 0 };
  for (const s of favorites.values()) sources[s.size > 1 ? 'both' : [...s][0]]++;
  return { days, timeZone, today, start, started_at: data.started_at,
    metrics: { learned: range.learned.size, newQuestions: range.newQuestions.size,
      reviewed: range.learned.size - range.newQuestions.size, firstPass: range.firstPass.size,
      favorites: favorites.size, conquered: range.conquered.size }, favoriteSources: sources,
    daily: Array.from({ length: days }, (_, i) => { const day = shiftDay(start, i); return { day, count: daily.get(day)?.size || 0 }; }),
    chapters: [...chapters.values()].map(c => ({ ...c, rate: c.correct / c.sample, weak: c.sample >= 5 && c.correct / c.sample < .6 })).sort((a, b) => a.rate - b.rate),
    achievements: { newQuestions: allNew.size, conquered: allConquered.size, activeDays: active.length,
      currentStreak: streak, longestStreak: longest, bestDay: Math.max(0, ...[...daily.values()].map(s => s.size)),
      newMilestones: [10, 50, 100, 500, 1000].map(target => ({ target, reached: allNew.size >= target })),
      conqueredMilestones: [1, 10, 50, 100].map(target => ({ target, reached: allConquered.size >= target })) } };
}

export function summarizeJournal(data, { end, timeZone = 'Asia/Hong_Kong', now = Date.now() } = {}) {
  const today = studyDay(now, timeZone);
  end ||= today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(end)) ||
      new Date(end).toISOString().slice(0, 10) !== end || end > today) throw fail('手账日期无效');
  const start = shiftDay(end, -6);
  const daily = Array.from({ length: 7 }, (_, i) => ({ day: shiftDay(start, i), ids: new Set(), fresh: new Set(), fixed: new Set(), groups: [] }));
  const byDay = new Map(daily.map(d => [d.day, d]));
  const active = new Set();
  const badges = [
    { id: 'start', name: '提笔出发', description: '完成第一次有效练习', target: 1, kind: 'active', earnedOn: null },
    { id: 'comeback', name: '迎难再来', description: '第一次独立重做答对旧错题', target: 1, kind: 'conquered', earnedOn: null },
    ...[[50, '积少成多'], [100, '百题成章'], [500, '步履不停'], [1000, '千题留痕']].map(([target, name]) =>
      ({ id: `new-${target}`, name, description: `累计学习 ${target} 道不同新题`, target, kind: 'new', earnedOn: null })),
    { id: 'active-7', name: '常来常新', description: '累计在 7 个学习日练习，无需连续', target: 7, kind: 'active', earnedOn: null },
    { id: 'conquered-10', name: '越过难关', description: '独立重做答对 10 道不同旧错题', target: 10, kind: 'conquered', earnedOn: null },
  ];
  let earliest = studyDay(data.started_at, timeZone);
  const summary = summarizeStudy(data, { days: 7, timeZone, now, onStudy(fact) {
    const { event: e, day, isNew, conquered, newCount, conqueredCount } = fact;
    if (day < earliest) earliest = day;
    active.add(day);
    for (const badge of badges) {
      badge.value = badge.kind === 'new' ? newCount : badge.kind === 'conquered' ? conqueredCount : active.size;
      if (!badge.earnedOn && badge.value >= badge.target) badge.earnedOn = day;
    }
    const d = byDay.get(day);
    if (!d) return;
    d.ids.add(e.question_id);
    if (isNew) d.fresh.add(e.question_id);
    if (conquered) d.fixed.add(e.question_id);
    let group = d.groups.at(-1);
    // Contiguous chapter activity is a practice segment, not a claim of time spent.
    if (!group || group.chapter_id !== e.chapter_id || Date.parse(e.at) - Date.parse(group.last_at) > 30 * 60000) {
      group = { chapter_id: e.chapter_id, chapter_name: e.chapter_name, at: e.at, last_at: e.at, questions: new Map() };
      d.groups.push(group);
    }
    group.last_at = e.at;
    const previous = group.questions.get(e.question_id);
    group.questions.set(e.question_id, { question_id: e.question_id, isNew, conquered: conquered || previous?.conquered || false,
      result: e.type === 'answer' ? e.reliable ? (e.answer_seen ? '参考答案后作答' : e.correct ? '答对' : '待巩固') : '已作答（未自动判分）' : previous?.result || '已标记学习' });
  } });
  return { today, start, end, earliest, timeZone, started_at: data.started_at, achievements: summary.achievements,
    badges: badges.map(b => ({ ...b, value: b.value || 0 })),
    daily: daily.map(d => ({ day: d.day, count: d.ids.size, newQuestions: d.fresh.size, reviewed: d.ids.size - d.fresh.size,
      conquered: d.fixed.size, groups: d.groups.map(g => ({ ...g, questions: [...g.questions.values()] })) })) };
}

export function createStudyActivity(dataDir, readState) {
  const file = path.join(dataDir, 'study-activity.json');
  let queue = Promise.resolve();
  const locked = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function save(data) {
    data.revision = (data.revision || 0) + 1;
    await fs.mkdir(dataDir, { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(temp, file);
  }
  const baselineOf = p => ({ failed: p.last_ok === false || p.error_prone === true });
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version !== 1 || !data.events || !data.baseline || !Number.isFinite(Date.parse(data.started_at))) throw new Error('学习战报文件损坏，请从备份恢复');
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const state = await readState();
      const data = { version: 1, started_at: new Date().toISOString(), baseline: {}, events: {} };
      for (const [id, p] of Object.entries(state.progress || {})) if (learned(p)) data.baseline[id] = baselineOf(p);
      await save(data); return data;
    }
  }
  return {
    ensure: () => locked(read),
    export: () => locked(read),
    summary: options => locked(async () => summarizeStudy(await read(), options)),
    journal: options => locked(async () => summarizeJournal(await read(), options)),
    append: input => locked(async () => {
      if (!Array.isArray(input) || input.length > 1000) throw fail('学习事件批次无效');
      const events = input.map(normalizeStudyEvent), data = await read();
      let order = Object.keys(data.events).length;
      for (const e of events) if (!data.events[e.event_id]) data.events[e.event_id] = { ...e, order: ++order };
      await save(data); return events.map(e => e.event_id);
    }),
    observeImport: state => locked(async () => {
      const data = await read(), known = new Set(Object.values(data.events).filter(e => ['study', 'answer'].includes(e.type)).map(e => e.question_id));
      for (const [id, p] of Object.entries(state.progress || {})) if (learned(p) && !known.has(id) && !data.baseline[id]) data.baseline[id] = baselineOf(p);
      await save(data);
    }),
    merge: input => locked(async () => {
      if (!input || input.version !== 1 || !input.events || !input.baseline || !Number.isFinite(Date.parse(input.started_at))) throw fail('学习战报备份无效');
      const events = Object.values(input.events).map(normalizeStudyEvent), data = await read();
      if (input.started_at < data.started_at) data.started_at = input.started_at;
      const known = new Set(Object.values(data.events).filter(e => ['study', 'answer'].includes(e.type)).map(e => e.question_id));
      for (const [id, p] of Object.entries(input.baseline)) if (/^\d+$/.test(id) && (!input.importedBaseline || !known.has(id))) data.baseline[id] = { failed: p?.failed === true || data.baseline[id]?.failed === true };
      const incomingKnown = new Set(events.filter(e => ['study', 'answer'].includes(e.type)).map(e => e.question_id));
      // Bulk restore may have just marked these imported questions as legacy. A
      // complete event backup restores their actual first-study history instead.
      for (const id of incomingKnown) if (!input.baseline[id] && !Object.values(data.events).some(e => e.question_id === id && ['study', 'answer'].includes(e.type))) delete data.baseline[id];
      let order = Object.keys(data.events).length;
      for (const e of events) if (!data.events[e.event_id]) data.events[e.event_id] = { ...e, order: ++order };
      await save(data);
      return { count: Object.keys(data.events).length };
    }),
  };
}
