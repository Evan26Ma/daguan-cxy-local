import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listenHttp } from './http-fixture.mjs';
import { createStore } from "../local-server/store.mjs";
import { createAiService, validateBaseUrl } from "../local-server/ai-service.mjs";

test("AI 地址策略拒绝凭据和公网 HTTP", async () => {
  await assert.rejects(() => validateBaseUrl("https://user:pass@example.com/v1"), /不能内嵌/);
  await assert.rejects(() => validateBaseUrl("http://example.com/v1"), /HTTPS/);
  assert.equal(await validateBaseUrl("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1");
});

test("AI 服务档案只返回掩码 Key，图形失败时降级安全 SVG", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "daguan-ai-"));
  const service = createAiService({ store: createStore(root) });
  const profile = await service.upsert({ name: "测试", baseUrl: "http://127.0.0.1:1234/v1", key: "sk-secret-key", model: "mock", active: true });
  assert.match(profile.keyHint, /••••/);
  assert.equal(profile.key, undefined);
  const rendered = await service.diagram({ kind: "polyline", points: [[0, 0], [1, 2]], title: "安全图" });
  assert.match(rendered.svg, /^<svg/);
  assert.doesNotMatch(rendered.svg, /script|foreignObject|onload/i);
  await fs.rm(root, { recursive: true, force: true });
});

import http from 'node:http';
import { createAnswerFilter, visibleAnswer } from '../local-server/ai-service.mjs';

async function aiFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-ai-chat-'));
  const store = createStore(root);
  const service = createAiService({store});
  const calls = [];
  let mode = 'auto';
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({data:[{id:'math-model'}]})); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls.push(body);
    if (mode === 'error') { res.writeHead(401); res.end('bad'); return; }
    if (!body.stream && mode !== 'sse') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({choices:[{message:{reasoning_content:'PRIVATE',content:'<think>PRIVATE</think>解题步骤 $x<2$'}}]})); return; }
    res.setHeader('Content-Type','text/event-stream');
    if (mode === 'stop') { res.write('data: {"choices":[{"delta":{"reasoning_content":"PRIVATE"}}]}\n\n'); return; }
    for (const content of ['<th','ink>PRIVATE','</thi','nk>解题','步骤 $x<2$']) {
      res.write(`data: ${JSON.stringify({choices:[{delta:{content,reasoning_content:'PRIVATE'}}]})}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 3));
    }
    res.end('data: [DONE]');
  });
  await listenHttp(upstream);
  const downstream=http.createServer((req,res)=>service.streamChat(req,res,{profileId:profile.id,question:{id:'q1',stem:'求解'},prompt:'讲解'}).catch(error=>{res.writeHead(400);res.end(error.message)}));
  const profile=await service.upsert({name:'测试服务',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,key:'test-only-key'});
  await listenHttp(downstream);
  t.after(async()=>{upstream.closeAllConnections();downstream.closeAllConnections();await Promise.all([new Promise(r=>upstream.close(r)),new Promise(r=>downstream.close(r))]);await fs.rm(root,{recursive:true,force:true});});
  return {store, service, profile, calls, setMode:value=>{mode=value;}, chat:()=>fetch(`http://127.0.0.1:${downstream.address().port}/chat`)};
}
function events(text) { return text.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))); }

test('思考过滤处理逐字符分块、嵌套与未闭合标签，保留数学正文', () => {
  const filter=createAnswerFilter();
  const input='<think>秘密<thinking>嵌套</thinking></think>推导 $x<2$，结果为 1';
  let answer='';for(const char of input) answer+=filter.push(char);
  answer+=filter.push('',true);
  assert.equal(answer,'推导 $x<2$，结果为 1');
  assert.equal(visibleAnswer('答案<think>未结束'),'答案');
  assert.equal(visibleAnswer('答案<thi'),'答案');
  assert.equal(visibleAnswer('a < b'),'a < b');
  assert.equal(visibleAnswer('$x<2$<think>秘密</think>推导'), '$x<2$推导');
});

test('无模型可保存并获取列表，旧档案默认流式，Key 留空保留', async t => {
  const f=await aiFixture(t);
  assert.equal(f.profile.streaming,true);
  assert.equal((await f.service.models(f.profile.id)).models[0],'math-model');
  await assert.rejects(()=>f.service.test(f.profile.id),/模型/);
  const saved=await f.service.upsert({id:f.profile.id,model:'math-model',streaming:false,key:''});
  assert.equal(saved.streaming,false);
  assert.equal(saved.key,undefined);
  const raw=await f.store.readAiProfiles();
  assert.equal(raw.profiles[0].key,'test-only-key');
});

test('流式与非流式使用正确上游开关，仅展示和保存正式答案', async t => {
  const f=await aiFixture(t);
  for (const streaming of [true,false]) {
    await f.service.upsert({id:f.profile.id,model:'math-model',streaming});
    const parsed=events(await (await f.chat()).text());
    assert.equal(f.calls.at(-1).stream,streaming);
    assert.equal(parsed.find(e=>e.type==='done').message.content,'解题步骤 $x<2$');
    assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE|think/);
    const deltas=parsed.filter(e=>e.type==='delta');
    if(!streaming) assert.equal(deltas.length,1);
    assert.equal(deltas.map(e=>e.content).join(''),'解题步骤 $x<2$');
  }
  const history=await f.service.conversation(f.profile.id,'q1');
  assert.equal(history.messages.at(-1).content,'解题步骤 $x<2$');
});

test('旧历史只在读取与回送时过滤，用户文本和原文件保留', async t => {
  const f=await aiFixture(t);
  await f.service.upsert({id:f.profile.id,model:'math-model'});
  const key=`${f.profile.id}--q1`;
  await f.store.writeAiHistory(key,{messages:[{role:'user',content:'解释 <think> 标签'},{role:'assistant',content:'<think>PRIVATE</think>旧推导'}]});
  const history=await f.service.conversation(f.profile.id,'q1');
  assert.equal(history.messages[1].content,'旧推导');
  assert.match((await f.store.readAiHistory(key)).messages[1].content,/PRIVATE/);
  await (await f.chat()).text();
  assert.equal(f.calls[0].messages[2].content,'旧推导');
  assert.equal(f.calls[0].messages[1].content,'解释 <think> 标签');
});

test('关闭流式时兼容误返 SSE 的上游，完整答案只发送一次', async t => {
  const f=await aiFixture(t); f.setMode('sse');
  await f.service.upsert({id:f.profile.id,model:'math-model',streaming:false});
  const parsed=events(await (await f.chat()).text());
  assert.equal(parsed.filter(e=>e.type==='delta').length,1);
  assert.equal(parsed.at(-1).type,'done');
});

test('上游失败和用户停止不保存成功历史', async t => {
  const f=await aiFixture(t);
  await f.service.upsert({id:f.profile.id,model:'math-model'});
  f.setMode('error');
  const parsed=events(await (await f.chat()).text());
  assert.equal(parsed.at(-1).type,'error');
  assert.equal((await f.service.conversation(f.profile.id,'q1')).messages.length,0);
  f.setMode('stop');
  const response=await f.chat(); const reader=response.body.getReader();
  const first=await reader.read(); const initial=events(new TextDecoder().decode(first.value));
  assert.equal(f.service.stop(initial.find(e=>e.type==='started').runId),true);
  let rest=''; while(true){const {done,value}=await reader.read();if(done)break;rest+=new TextDecoder().decode(value);}
  assert.equal(events(rest).at(-1).type,'error');
  assert.equal((await f.service.conversation(f.profile.id,'q1')).messages.length,0);
});
