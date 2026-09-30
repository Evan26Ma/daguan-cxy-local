import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudyActivity, studyDay, summarizeStudy } from '../local-server/study-activity.mjs';

let serial = 0;
const event = (id, type, at, details = {}) => ({ event_id: `event-${String(++serial).padStart(8, '0')}`, question_id: String(id), type, at, chapter_id: 'chapter', chapter_name: '极限', reliable: true, answer_seen: false, correct: true, ...details });
const snapshot = (events, baseline = {}) => ({ version: 1, started_at: '2026-01-01T00:00:00Z', baseline, events: Object.fromEntries(events.map((e, order) => [e.event_id, { ...e, order }])) });
const options = { days: 3, timeZone: 'Asia/Hong_Kong', now: Date.parse('2026-09-30T12:00:00Z') };

test('学习日以本地04:00分日，跨月跨年和DST使用日历日期', () => {
  assert.equal(studyDay('2026-09-29T19:59:59Z', 'Asia/Hong_Kong'), '2026-09-29');
  assert.equal(studyDay('2026-09-29T20:00:00Z', 'Asia/Hong_Kong'), '2026-09-30');
  assert.equal(studyDay('2026-01-01T02:00:00Z', 'UTC'), '2025-12-31');
  assert.equal(studyDay('2026-03-01T03:59:00Z', 'UTC'), '2026-02-28');
  assert.equal(studyDay('2026-03-08T07:30:00Z', 'America/New_York'), '2026-03-07');
  assert.equal(studyDay('2026-03-08T08:00:00Z', 'America/New_York'), '2026-03-08');
  assert.equal(summarizeStudy(snapshot([]), { ...options, days: 365 }).daily.length, 365);
  assert.equal(summarizeStudy(snapshot([]), options).start, '2026-09-28');
  assert.throws(() => studyDay(Date.now(), 'invalid'), /时区/);
  assert.throws(() => summarizeStudy(snapshot([]), { ...options, days: 2 }), /范围/);
});

test('学习量按范围去重，新题与复习互斥；浏览、收藏与答案不算学习', () => {
  const events = [event(1, 'study', '2026-09-27T08:00:00Z'), event(1, 'study', '2026-09-30T08:00:00Z'),
    event(2, 'study', '2026-09-29T08:00:00Z'), event(2, 'study', '2026-09-30T08:00:00Z'),
    event(3, 'favorite', '2026-09-30T08:00:00Z', { source: 'manual' }), event(4, 'reveal', '2026-09-30T08:00:00Z'),
    event(5, 'study', '2026-09-30T08:00:00Z')];
  const s = summarizeStudy(snapshot(events, { 5: {} }), options);
  assert.equal(s.metrics.learned, 3); assert.equal(s.metrics.newQuestions, 1); assert.equal(s.metrics.reviewed, 2);
  assert.equal(s.daily.at(-1).count, 3);
});

test('一遍过排除旧题、提前看答案、改答案和不可靠题型', () => {
  const at = '2026-09-30T08:00:00Z';
  const events = [event(1, 'answer', at), event(2, 'answer', at, { correct: false }),
    event(2, 'reveal', at), event(2, 'answer', at, { answer_seen: true }),
    event(3, 'reveal', at), event(3, 'answer', at), event(4, 'answer', at, { reliable: false }), event(5, 'answer', at)];
  const s = summarizeStudy(snapshot(events, { 5: {} }), options);
  assert.equal(s.metrics.firstPass, 1); assert.equal(s.metrics.conquered, 0);
  assert.equal(s.chapters[0].sample, 2); assert.equal(s.chapters[0].correct, 1);
});

test('错题独立重做才计攻克；反复切状态不刷新一遍过或累计成就', () => {
  const events = [event(1, 'answer', '2026-09-28T08:00:00Z', { correct: false }),
    event(1, 'answer', '2026-09-29T08:00:00Z', { answer_seen: true }),
    event(1, 'study', '2026-09-29T09:00:00Z'), event(1, 'answer', '2026-09-30T08:00:00Z'), event(1, 'answer', '2026-09-30T09:00:00Z')];
  const s = summarizeStudy(snapshot(events), options);
  assert.equal(s.metrics.firstPass, 0); assert.equal(s.metrics.conquered, 1);
  assert.equal(s.achievements.newQuestions, 1); assert.equal(s.achievements.conquered, 1);
  const nextDay = summarizeStudy(snapshot([...events, event(1, 'answer', '2026-10-01T08:00:00Z')]),
    { ...options, days: 1, now: Date.parse('2026-10-01T12:00:00Z') });
  assert.equal(nextDay.metrics.conquered, 0, '已攻克题再次答对不能凭空新增一次攻克');
  assert.equal(nextDay.achievements.conquered, 1);
});

test('新增收藏来源分为手动、自动、两者都有，重复收藏不重复计数', () => {
  const at = '2026-09-30T08:00:00Z';
  const events = [event(1, 'favorite', at, { source: 'manual' }), event(1, 'favorite', at, { source: 'automatic' }),
    event(1, 'favorite', at, { source: 'manual' }), event(2, 'favorite', at, { source: 'automatic' }), event(3, 'favorite', at, { source: 'manual' })];
  const s = summarizeStudy(snapshot(events), options);
  assert.equal(s.metrics.favorites, 3); assert.deepEqual(s.favoriteSources, { manual: 1, automatic: 1, both: 1 });
});

test('连续学习允许今天尚未学习，章节至少5个首答样本才提示薄弱', () => {
  const events = Array.from({ length: 5 }, (_, i) => event(i + 1, 'answer', '2026-09-29T08:00:00Z', { correct: i === 0 }));
  events.push(event(6, 'study', '2026-09-28T08:00:00Z'));
  const s = summarizeStudy(snapshot(events), options);
  assert.equal(s.achievements.currentStreak, 2); assert.equal(s.achievements.longestStreak, 2);
  assert.equal(s.achievements.bestDay, 5); assert.equal(s.chapters[0].weak, true);
  assert.equal(summarizeStudy(snapshot(events.slice(0, 4)), options).chapters[0].weak, false);
});

test('独占服务内串行写入；重复提交、并发和跨年备份合并不丢事件', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-study-unit-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const store = createStudyActivity(temp, async () => ({ progress: { 99: { mastery: 'mastered' } } }));
  await store.ensure();
  const first = event(1, 'answer', '2025-12-31T08:00:00Z'), second = event(2, 'answer', '2026-09-30T08:00:00Z');
  await Promise.all([store.append([first]), store.append([first, second])]);
  const exported = await store.export();
  assert.equal(Object.keys(exported.events).length, 2); assert.ok(exported.baseline['99']);
  await store.merge(exported); await store.merge(exported);
  assert.equal(Object.keys((await store.export()).events).length, 2);
  assert.equal((await store.summary(options)).metrics.newQuestions, 1);
  await store.observeImport({ progress: { 1: { mastery: 'mastered' }, 7: { mastery: 'learning' } } });
  assert.ok((await store.export()).baseline['7']); assert.equal((await store.export()).baseline['1'], undefined);
  await assert.rejects(store.append([{ ...second, event_id: 'bad' }]), /格式/);
  await fs.writeFile(path.join(temp, 'study-activity.json'), '{bad');
  await assert.rejects(store.export());
  assert.equal(await fs.readFile(path.join(temp, 'study-activity.json'), 'utf8'), '{bad');
});

test('完整事件备份恢复原首次学习，旧备份基线不生成活动或覆盖已知事件', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-study-restore-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const store = createStudyActivity(temp, async () => ({ progress: {} }));
  await store.ensure(); await store.observeImport({ progress: { 1: { answered: true } } });
  await store.merge(snapshot([event(1, 'answer', '2026-09-30T08:00:00Z')]));
  assert.equal((await store.summary(options)).metrics.firstPass, 1);
  await store.merge({ ...snapshot([], { 1: {}, 2: {} }), importedBaseline: true });
  assert.equal((await store.summary(options)).metrics.firstPass, 1);
  assert.ok((await store.export()).baseline['2']);
});
