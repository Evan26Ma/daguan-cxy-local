import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { serviceFixture } from './runtime-fixture.mjs';
import { listenHttp } from './http-fixture.mjs';
import { replayableHistory, validateQuestionImages } from '../local-server/ai-context-policy.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aY0AAAAASUVORK5CYII=';

async function fixture(t) {
  const { base } = await serviceFixture(t);
  const calls = [];
  const marker = randomUUID();
  const upstream = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    calls.push(body);
    const content = JSON.stringify(body.messages.at(-1)).includes(marker) ? `私密回复 ${marker}` : '公开推导';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await listenHttp(upstream);
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const saved = await fetch(`${base}/api/ai/profiles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '隔离边界测试', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'fixture', streaming: false, capabilities: { vision: 'passed' } }),
  });
  assert.equal(saved.status, 200);
  const { profile } = await saved.json();
  const chat = payload => fetch(`${base}/api/ai/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: profile.id, question: { id: 'context-fixture', stem: '求函数的极限', annotation: marker }, prompt: '请讲解', ...payload }),
  });
  return { base, profile, calls, marker, chat };
}

test('AI HTTP 边界拒绝远程图片 URL、JSON、SVG 和伪造图片内容，上游不收到请求', async t => {
  const { chat, calls } = await fixture(t);
  for (const image of [
    'http://127.0.0.1/api/state',
    'https://example.invalid/track.png',
    `data:application/json;base64,${Buffer.from('{"progress":{}}').toString('base64')}`,
    `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
    `data:image/png;base64,${Buffer.from('{"progress":{}}').toString('base64')}`,
  ]) {
    const response = await chat({ images: [image] });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
  const accepted = await chat({ images: [png] });
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /"type":"done"/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messages.at(-1).content.filter(item => item.type === 'image_url'), [{ type: 'image_url', image_url: { url: png } }]);
});

test('AI 图片在解码前后限制数量、单图与总字节预算', () => {
  assert.deepEqual(validateQuestionImages(undefined), []);
  assert.deepEqual(validateQuestionImages([png]), [png]);
  assert.throws(() => validateQuestionImages(Array(5).fill(png)), /4 张/);
  assert.throws(() => validateQuestionImages([`data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`]), error => error.status === 413);
  const bytes = Buffer.alloc(2 * 1024 * 1024);
  Buffer.from(png.split(',')[1], 'base64').copy(bytes);
  const large = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.throws(() => validateQuestionImages(Array(4).fill(large)), error => error.status === 413 && /合计/.test(error.message));
});

test('关闭 AI 隐私选项后不再发送旧批注或受其影响的回复，本地历史仍保留', async t => {
  const { base, profile, marker, chat, calls } = await fixture(t);
  const first = await chat({ includePrivate: true });
  assert.match(await first.text(), /"type":"done"/);
  assert.match(JSON.stringify(calls[0]), new RegExp(marker));
  const second = await chat({ includePrivate: false });
  assert.match(await second.text(), /"type":"done"/);
  assert.doesNotMatch(JSON.stringify(calls[1]), new RegExp(marker));
  const third = await chat({ includePrivate: false, prompt: '接着上一轮公开推导讲解' });
  assert.match(await third.text(), /"type":"done"/);
  assert.doesNotMatch(JSON.stringify(calls[2]), new RegExp(marker));
  assert.ok(calls[2].messages.some(message => message.role === 'assistant' && message.content === '公开推导'));
  const history = await (await fetch(`${base}/api/ai/conversations/${profile.id}/context-fixture`)).json();
  assert.equal(history.messages.length, 6);
  assert.equal(history.messages[0].includePrivate, true);
  assert.equal(history.messages[2].includePrivate, false);
  assert.match(history.messages[0].content, new RegExp(marker));
});

test('旧版含私密上下文的历史不再外发，纯公开历史与本地记录保留', () => {
  const history = [
    { role: 'user', content: '公开提问' },
    { role: 'assistant', content: '公开回答' },
    { role: 'user', content: '题干\n\n本地批注：\n仅本地的批注\n\n本次请求：讲解' },
    { role: 'assistant', content: '旧私密回复' },
    { role: 'user', content: '旧公开提问' },
    { role: 'assistant', content: '仍可能受旧私密上下文影响' },
    { role: 'user', content: '新公开提问', includePrivate: false },
    { role: 'assistant', content: '新公开回复', includePrivate: false },
  ];
  const copy = structuredClone(history);
  assert.deepEqual(replayableHistory(history, false), [history[0], history[1], history[6], history[7]]);
  assert.deepEqual(replayableHistory(history, true), history);
  assert.deepEqual(history, copy);
});
