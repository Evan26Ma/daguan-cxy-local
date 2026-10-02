import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeJournal } from '../local-server/study-activity.mjs';
import { serviceFixture } from './runtime-fixture.mjs';

const options = { now: Date.parse('2026-10-03T12:00:00Z'), timeZone: 'Asia/Hong_Kong' };
let order = 0;
const event = (id, at, extra = {}) => ({ event_id: `journal-${++order}`, question_id: String(id), at,
  type: 'answer', correct: true, reliable: true, answer_seen: false, chapter_id: 'chapter', chapter_name: '积分', order, ...extra });
const data = events => ({ started_at: '2026-09-01T00:00:00Z', baseline: { 99: {} }, events: Object.fromEntries(events.map(e => [e.event_id, e])) });

test('手账按学习日去重，区分新题与复习，收藏与看答案不算练习', () => {
  const result = summarizeJournal(data([
    event(1, '2026-10-01T08:00:00Z', { correct: false }),
    event(1, '2026-10-02T08:00:00Z'), event(1, '2026-10-02T08:01:00Z'),
    event(2, '2026-10-02T19:59:00Z', { type: 'study' }),
    event(3, '2026-10-02T20:00:00Z', { type: 'study' }),
    event(99, '2026-10-02T08:02:00Z'),
    event(4, '2026-10-02T08:00:00Z', { type: 'favorite' }),
    event(5, '2026-10-02T08:00:00Z', { type: 'reveal' }),
  ]), options);
  const day = result.daily.find(d => d.day === '2026-10-02');
  assert.equal(day.count, 3); assert.equal(day.newQuestions, 1); assert.equal(day.reviewed, 2); assert.equal(day.conquered, 1);
  assert.equal(day.groups[0].questions.length, 2);
  assert.equal(result.daily.at(-1).count, 1);
  assert.equal(result.badges.find(b => b.id === 'comeback').earnedOn, '2026-10-02');
  assert.equal(result.badges.find(b => b.id === 'start').earnedOn, '2026-10-01');
});

test('印章按真实不同题目累计，回看过去七天不会撤销，旧进度不补填成就', () => {
  const events = Array.from({ length: 50 }, (_, i) => event(i + 1, '2026-10-03T08:00:00Z', { type: 'study' }));
  const result = summarizeJournal(data(events), { ...options, end: '2026-09-25' });
  assert.equal(result.daily.length, 7); assert.equal(result.daily.reduce((n, d) => n + d.count, 0), 0);
  assert.equal(result.badges.find(b => b.id === 'new-50').earnedOn, '2026-10-03');
  assert.equal(result.badges.find(b => b.id === 'comeback').earnedOn, null);
  assert.equal(summarizeJournal(data([]), options).badges.some(b => b.earnedOn), false);
  assert.throws(() => summarizeJournal(data([]), { ...options, end: '2026-02-31' }), /日期/);
  assert.throws(() => summarizeJournal(data([]), { ...options, end: '2026-10-04' }), /日期/);
});

test('不可靠或看答案后的作答不能获得错题印章，空白日仍有七天日历', () => {
  const result = summarizeJournal(data([
    event(1, '2026-10-01T08:00:00Z', { correct: false }),
    event(1, '2026-10-02T08:00:00Z', { answer_seen: true }),
    event(2, '2026-10-01T08:00:00Z', { correct: false }),
    event(2, '2026-10-02T08:00:00Z', { reliable: false }),
  ]), options);
  assert.equal(result.badges.find(b => b.id === 'comeback').earnedOn, null);
  assert.equal(result.daily.at(-1).count, 0);
});

test('手账 API 拒绝无效日期后仍能读取，不修改事件文件', async t => {
  const { base } = await serviceFixture(t);
  const before = await (await fetch(base + '/api/study-activity/export')).json();
  assert.equal((await fetch(base + '/api/study-activity/journal?end=bad')).status, 400);
  const response = await fetch(base + '/api/study-activity/journal');
  assert.equal(response.status, 200); assert.equal((await response.json()).daily.length, 7);
  assert.deepEqual(await (await fetch(base + '/api/study-activity/export')).json(), before);
});
