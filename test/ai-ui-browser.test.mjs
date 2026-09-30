import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let playwright;try {playwright=createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');}catch{}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n>=12000?n:port();}
async function fixture(t){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'daguan-ai-ui-'));const n=await port();
 const service=spawn(process.execPath,[path.join(ROOT,'local-server/server.mjs')],{cwd:ROOT,env:{...process.env,PORT:String(n),DAGUAN_DATA_DIR:path.join(temp,'data'),DAGUAN_OPEN_BROWSER:'0'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(service.exitCode==null){service.send({type:'shutdown'});await Promise.race([once(service,'close'),new Promise(r=>setTimeout(r,3000))]);if(service.exitCode==null)service.kill();}await fs.rm(temp,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${n}`;
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.ok(healthy,'temporary service starts');return {base,temp};
}
const skip=!playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';

test('AI 配置真实交互：新增、模型、测试、Key 保留、流式设置和旧版共享', {skip,timeout:60000},async t=>{
 const {base}=await fixture(t);
 const chatCalls=[];
 const upstream=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'math-model'},{id:'vision-model'}]}));return;}
  let raw='';for await(const chunk of req) raw+=chunk;chatCalls.push(JSON.parse(raw));await new Promise(r=>setTimeout(r,350));res.end(JSON.stringify({choices:[{message:{content:'<think>秘密</think>测试通过'}}]}));
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{upstream.closeAllConnections();upstream.close(r);}));
 const browser=await playwright.chromium.launch({headless:true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? {executablePath:process.env.DAGUAN_CHROMIUM_EXECUTABLE} : {})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/state/events',route=>route.abort());await page.goto(base+'/index.html?ui=new');await page.waitForLoadState('networkidle');await page.waitForFunction('AppState.categories');
 await page.evaluate(()=>App.showSettings());
 const host=page.locator('#ai-services-settings');await host.getByRole('button',{name:'新增服务',exact:true}).click();
 const form=host.locator('form');await form.locator('[name=name]').fill('我的测试 API');await form.locator('[name=baseUrl]').fill(`http://127.0.0.1:${upstream.address().port}/v1`);await form.locator('[name=key]').fill('test-only-key');
 await form.getByRole('button',{name:'保存服务',exact:true}).click();await host.locator('[data-status]').filter({hasText:'服务已保存'}).waitFor();
 await form.locator('[name=baseUrl]').fill('file:///invalid-api');await form.getByRole('button',{name:'保存服务',exact:true}).click();await host.locator('[data-status]').filter({hasText:'只支持 HTTP'}).waitFor();
 assert.equal(await form.locator('[name=name]').inputValue(),'我的测试 API');assert.equal(await form.locator('[name=baseUrl]').inputValue(),'file:///invalid-api');
 await form.locator('[name=baseUrl]').fill(`http://127.0.0.1:${upstream.address().port}/v1`);
 await form.getByRole('button',{name:'获取模型列表',exact:true}).click();await host.locator('[data-status]').filter({hasText:'已获取 2 个模型'}).waitFor();
 assert.equal(await form.locator('datalist option').count(),2);
 await form.locator('[name=model]').fill('math-model');
 await form.getByRole('button',{name:'文本连接测试',exact:true}).click();await host.locator('[data-status]').filter({hasText:'请先保存当前配置'}).waitFor();await form.locator('[name=streaming]').uncheck();await form.getByRole('button',{name:'保存服务',exact:true}).click();await host.locator('[data-status]').filter({hasText:'服务已保存'}).waitFor();
 await form.getByRole('button',{name:'文本连接测试',exact:true}).click();await host.locator('[data-status]').filter({hasText:'文本连接测试通过'}).waitFor();
 await form.getByRole('button',{name:'图片能力测试',exact:true}).click();await host.locator('[data-status]').filter({hasText:'图片能力测试通过'}).waitFor();
 assert.doesNotMatch(await host.innerText(),/秘密|test-only-key/);
 await page.evaluate(async()=>{AppState.currentCategory=AppState.categories.categories.find(n=>UIRenderer.findNodeById(n,331));await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory,331));App.toggleAI();});
 assert.equal(await page.locator('#ai-streaming-new').isChecked(),false);
 await page.locator('#ai-input').fill('请讲解');await page.locator('#ai-send-btn').click();
 assert.equal(await page.locator('#ai-profile-select-new').isDisabled(),true);assert.equal(await page.locator('#ai-streaming-new').isDisabled(),true);
 await page.waitForFunction('!AppState.aiBusy');assert.equal(chatCalls.at(-1).stream,false);assert.doesNotMatch(await page.locator('#ai-messages').innerText(),/秘密/);
 if(!await page.locator('#ai-streaming-new').isVisible()) await page.locator('#ai-settings-btn').click();
 await page.locator('#ai-streaming-new').check();await page.waitForFunction('AIService.activeProfile().streaming === true');
 await page.evaluate(()=>App.showSettings());
 await host.getByRole('button',{name:'新增服务',exact:true}).click();assert.equal(await form.locator('[name=name]').inputValue(),'');
 await form.locator('[name=name]').fill('第二个服务');await form.locator('[name=baseUrl]').fill(`http://127.0.0.1:${upstream.address().port}/v1`);await form.locator('[name=model]').fill('vision-model');await form.getByRole('button',{name:'保存服务',exact:true}).click();await host.locator('[data-status]').filter({hasText:'服务已保存'}).waitFor();
 assert.equal((await(await fetch(base+'/api/ai/profiles')).json()).profiles.length,2);
 await page.goto(base+'/legacy.html?ui=old');await page.waitForLoadState('networkidle');await page.waitForSelector('#ai-services-settings .ai-service-item',{state:'attached'});
 await page.evaluate(()=>document.getElementById('dlg-appearance').showModal());
 const old=page.locator('#ai-services-settings');assert.equal(await old.locator('.ai-service-item').count(),2);
 await old.locator('.ai-service-item').filter({hasText:'我的测试 API'}).getByRole('button',{name:'编辑',exact:true}).click();
 assert.equal(await old.locator('[name=model]').inputValue(),'math-model');assert.equal(await old.locator('[name=streaming]').isChecked(),true);
 assert.equal(await old.locator('[name=key]').inputValue(),'');assert.equal(errors.length,0,errors.join('\n'));
});

test('单题和连续模式：长回答独立滚动，拖宽不丢草稿，批注与小屏没有外层空白', {skip,timeout:60000},async t=>{
 const {base}=await fixture(t);const browser=await playwright.chromium.launch({headless:true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? {executablePath:process.env.DAGUAN_CHROMIUM_EXECUTABLE} : {})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.route('**/api/state/events',route=>route.abort());await page.goto(base+'/index.html?ui=new');await page.waitForLoadState('networkidle');await page.waitForFunction('AppState.categories');
 await page.evaluate(async()=>{AppState.currentCategory=AppState.categories.categories.find(n=>UIRenderer.findNodeById(n,331));await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory,331));App.toggleAI();});
 await page.locator('#ai-input').fill('我的草稿');
 await page.evaluate(()=>{document.getElementById('ai-messages').innerHTML='<div class="ai-message assistant"><div class="ai-message-bubble">'+Array.from({length:100},(_,i)=>`<p>解题步骤 ${i}</p>`).join('')+renderMarkdown('$$'+Array.from({length:60},(_,i)=>'x_{'+i+'}').join('+')+'$$')+'</div></div>';});
 const handle=page.locator('.ai-panel-resize');await handle.focus();await handle.press('End');
 const maxWidth=await page.locator('#app-main').evaluate(e=>Math.round(e.getBoundingClientRect().width-360));assert.equal(Number(await handle.getAttribute('aria-valuenow')),maxWidth);assert.ok(maxWidth>620);
 const box=await handle.boundingBox();await page.mouse.move(box.x+3,box.y+50);await page.mouse.down();await page.mouse.move(box.x+103,box.y+50);await page.mouse.up();
 assert.equal(Number(await handle.getAttribute('aria-valuenow')),maxWidth-100);assert.equal(await page.locator('#ai-input').inputValue(),'我的草稿');
 const heights=await page.evaluate(()=>{const main=document.getElementById('app-main'),messages=document.getElementById('ai-messages');messages.scrollTop=messages.scrollHeight;main.scrollTop=main.scrollHeight;return {outer:main.scrollTop,message:messages.scrollTop,client:main.clientHeight,scroll:main.scrollHeight};});
 assert.equal(heights.outer,0);assert.ok(heights.message>1000);assert.ok(heights.scroll<=heights.client+2);
 await page.evaluate(()=>App.toggleAnnotation());assert.ok(await page.locator('#ai-input').isVisible());
 await page.evaluate(()=>App.toggleAnnotation());
 await page.evaluate(async()=>{await App.changeQuestionMode('multi');});
 await page.waitForSelector('.multi-question-view');await page.evaluate(()=>{const m=document.getElementById('ai-messages');m.innerHTML='<p>'+('长回答 '.repeat(3000))+'</p>';m.scrollTop=m.scrollHeight;});
 const multi=await page.evaluate(()=>{const m=document.getElementById('ai-messages');return {top:document.getElementById('ai-panel').getBoundingClientRect().top,content:document.getElementById('app-main').getBoundingClientRect().top,message:m.scrollTop,outer:document.getElementById('app-main').scrollTop};});
 assert.ok(Math.abs(multi.top-multi.content)<=2,JSON.stringify(multi));assert.ok(multi.message>0);
 await page.evaluate(async()=>{await App.changeQuestionMode('single');});assert.equal(await page.locator('#app-main').evaluate(e=>e.scrollTop),0);
 await page.setViewportSize({width:500,height:800});assert.equal(await page.locator('#ai-panel').evaluate(e=>Math.round(e.getBoundingClientRect().width)),500);
 assert.equal(await handle.isVisible(),false);
 await page.setViewportSize({width:1280,height:900});await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction('AppState.categories');
 await page.evaluate(async()=>{AppState.currentCategory=AppState.categories.categories.find(n=>UIRenderer.findNodeById(n,331));await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory,331));App.toggleAI();});
 assert.equal(Number(await page.locator('.ai-panel-resize').getAttribute('aria-valuenow')),maxWidth-100);
 await page.goto(base+'/legacy.html?ui=old&entry=chapters');await page.waitForLoadState('networkidle');
 await page.locator('[data-chapter-id="223"]').click();await page.locator('[data-chapter-id="321"]').click();
 await page.locator('[data-chapter-id="327"]').click();await page.locator('[data-chapter-id="331"]').click();await page.locator('#chapter-menu').waitFor({state:'hidden'});
 if (!await page.locator('#btn-single-ai').isVisible()) await page.locator('#mode-single').click();await page.locator('#btn-single-ai').click();
 await page.locator('#ai-prompt').fill('旧版草稿');const oldHandle=page.locator('#ai-resize-handle');await oldHandle.focus();await oldHandle.press('End');
 assert.equal(await oldHandle.getAttribute('aria-valuenow'),'620');assert.equal(await page.locator('#ai-prompt').inputValue(),'旧版草稿');
 const oldScroll=await page.evaluate(()=>{const msg=document.getElementById('ai-messages');msg.innerHTML='<div class="ai-message">'+('<p>旧版长回答</p>'.repeat(100))+'</div>';msg.scrollTop=msg.scrollHeight;const body=document.querySelector('.ai-drawer-body');body.scrollTop=body.scrollHeight;return {messages:msg.scrollTop,outer:body.scrollTop,height:body.clientHeight,scroll:body.scrollHeight};});
 assert.ok(oldScroll.messages>1000,JSON.stringify(oldScroll));assert.equal(oldScroll.outer,0);assert.ok(oldScroll.scroll<=oldScroll.height+2);
});

test('新版阅读：导航、展开、设置、段落跳转、草稿和流式阅读位置', {skip,timeout:60000},async t=>{
 const {base}=await fixture(t);
 const browser=await playwright.chromium.launch({headless:true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? {executablePath:process.env.DAGUAN_CHROMIUM_EXECUTABLE} : {})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1920,height:1080},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/state/events',route=>route.abort());await page.goto(base+'/index.html?ui=new');await page.waitForLoadState('networkidle');await page.waitForFunction('AppState.categories');
 await page.evaluate(async()=>{
  AppState.aiProfiles=[{id:'reading-fixture',name:'阅读测试',model:'数学模型',streaming:true}];AppState.aiProfileId='reading-fixture';
  AIService.loadHistory=async()=>[{role:'user',content:'请详细讲解这道题。'},{role:'assistant',content:'## 答案\n选 D。\n\n## 简短思路\n从线性无关的定义出发，验证每个向量都不能由其余向量表示。\n\n## 详细推导\n'+Array.from({length:45},(_,i)=>`### 第 ${i+1} 步\n明确知识点、适用条件与题干信息，再进行推导。\n\n`).join('')+'## 方法与易错点\n两两线性无关不能推出整体线性无关。'}];
  AppState.currentCategory=AppState.categories.categories.find(n=>UIRenderer.findNodeById(n,127));await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory,127),2);App.toggleAI();
 });
 await page.waitForSelector('#ai-section-nav button');
 assert.equal(await page.locator('#ai-section-nav button').count(),4);
 const input=page.locator('#ai-input');await input.fill('保留这份追问草稿');
 const originalWidth=await page.locator('.ai-panel-resize').getAttribute('aria-valuenow');
 await page.locator('#ai-expand-btn').click();
 const ratio=()=>page.evaluate(()=>document.getElementById('ai-panel').getBoundingClientRect().width/document.getElementById('app-main').getBoundingClientRect().width);
 const waitForExpanded=()=>page.waitForFunction(()=>Math.abs(document.getElementById('ai-panel').getBoundingClientRect().width/document.getElementById('app-main').getBoundingClientRect().width-.55)<.005);
 assert.ok(Math.abs(await ratio()-.55)<.005);
 await page.locator('#btn-toggle-nav').click();assert.equal(await page.locator('#app-nav').isVisible(),false);assert.ok(Math.abs(await ratio()-.55)<.005);
 assert.equal(await input.inputValue(),'保留这份追问草稿');
 const expandedHandle=page.locator('.ai-panel-resize');const expandedWidth=Number(await expandedHandle.getAttribute('aria-valuenow'));
 await expandedHandle.focus();await expandedHandle.press('ArrowLeft');assert.equal(Number(await expandedHandle.getAttribute('aria-valuenow')),expandedWidth+16);
 await expandedHandle.press('End');assert.ok(await ratio()>.7);assert.ok(await page.locator('#app-main').evaluate(e=>e.getBoundingClientRect().width)-Number(await expandedHandle.getAttribute('aria-valuenow'))>=359);
 assert.equal(await page.evaluate(()=>localStorage.getItem('daguan_ai_drawer_width_v1')),null);
 await page.locator('#ai-expand-btn').click();assert.equal(await page.locator('.ai-panel-resize').getAttribute('aria-valuenow'),originalWidth);
 await page.locator('#ai-expand-btn').click();
 await page.locator('#ai-section-nav button').filter({hasText:'简短思路'}).click();
 const readingTop=await page.locator('#ai-messages').evaluate(e=>e.scrollTop);
 await page.locator('#ai-expand-btn').click();assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),readingTop);
 await page.locator('#ai-settings-btn').click();assert.equal(await page.locator('#ai-profile-select-new').evaluate(e=>document.activeElement===e),true);
 await page.locator('#ai-include-private-new').check();assert.ok(await page.locator('#ai-private-status').isVisible());
 await page.locator('#ai-include-private-new').press('Escape');assert.equal(await page.locator('#ai-panel-settings').isVisible(),false);assert.equal(await page.locator('#ai-settings-btn').evaluate(e=>document.activeElement===e),true);
 await input.fill(Array.from({length:12},(_,i)=>'追问 '+i).join('\n'));
 const inputSize=await input.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,line:parseFloat(getComputedStyle(e).lineHeight)}));assert.ok(inputSize.height<inputSize.line*6);assert.ok(inputSize.scroll>inputSize.height);
 await input.fill('请详细讲解');
 await page.evaluate(()=>{
  AIService.chatStream=async()=>new Response(new ReadableStream({start(controller){window.readingStream=controller;}}),{headers:{'Content-Type':'text/event-stream'}});
  window.sendReadingDelta=content=>readingStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'delta',content})+'\n\n'));
  window.readingRequest=App.sendAIMessage();
 });
 await page.waitForFunction('!!window.readingStream');
 await page.evaluate(()=>sendReadingDelta('## 答案\nD\n\n## 详细推导\n'+('线性无关的定义与推导过程。 '.repeat(1500))));
 await page.waitForFunction(()=>document.getElementById('ai-current-response').textContent.includes('推导过程'));
 await page.waitForFunction(()=>{const m=document.getElementById('ai-messages');return m.scrollHeight-m.scrollTop-m.clientHeight<10;});
 await page.locator('#ai-messages').evaluate(e=>{e.scrollTop=120;});await page.waitForFunction('!document.getElementById("ai-panel").reading.follow');
 await page.evaluate(()=>sendReadingDelta('\n\n## 方法与易错点\n不要遗漏适用条件。'));
 await page.waitForFunction(()=>document.getElementById('ai-current-response').textContent.includes('不要遗漏'));
 assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),120);assert.ok(await page.locator('#ai-latest-btn').isVisible());
 // Width and navigation changes while generating keep the same DOM and stream.
 await page.locator('#ai-expand-btn').click();await page.locator('#btn-toggle-nav').click();assert.equal(await page.evaluate('AppState.aiBusy'),true);
 assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),120);
 await input.fill('生成中保留的追问');
 assert.equal(await page.evaluate(async()=>{const panel=document.getElementById('ai-panel');await App.changeQuestionMode('multi');return document.getElementById('ai-panel')===panel;}),true);
 assert.equal(await page.evaluate('AppState.aiBusy'),true);assert.equal(await input.inputValue(),'生成中保留的追问');assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),120);
 assert.equal(await page.evaluate(async()=>{const panel=document.getElementById('ai-panel');await App.changeQuestionMode('single');return document.getElementById('ai-panel')===panel;}),true);
 assert.equal(await page.evaluate('AppState.aiBusy'),true);assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),120);
 await page.evaluate(async()=>{readingStream.close();await readingRequest;});
 assert.equal(await page.locator('#ai-messages').evaluate(e=>e.scrollTop),120);
 assert.equal(await page.locator('#ai-section-nav button').count(),3);
 await page.evaluate(()=>{const panel=document.getElementById('ai-panel');panel.querySelector('.ai-message.assistant:last-child .ai-message-bubble').innerHTML='<p>没有标题的回答</p>';DaguanAIReading.refreshSections();});assert.equal(await page.locator('#ai-section-nav').isVisible(),false);
 await page.locator('#ai-latest-btn').click();assert.equal(await page.locator('#ai-latest-btn').isVisible(),false);
 // Stop and delayed paints must not replace the partial answer after cancellation.
 await input.fill('再讲一个步骤');await page.evaluate(()=>{window.readingRequest=App.sendAIMessage();});
 await page.waitForFunction('AppState.aiBusy');await page.waitForFunction('!!window.readingStream');
 await page.evaluate(()=>{sendReadingDelta('保留部分推导');readingStream.error(new DOMException('已停止','AbortError'));});
 await page.evaluate(async()=>{await readingRequest;});assert.match(await page.locator('#ai-messages').innerText(),/已停止生成.*保留部分推导/s);
 await page.evaluate(()=>new Promise(r=>setTimeout(r,180)));assert.match(await page.locator('#ai-messages').innerText(),/已停止生成/);
 const capture=async(name)=>{if(process.env.DAGUAN_AI_SCREENSHOT_DIR){await fs.mkdir(process.env.DAGUAN_AI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DAGUAN_AI_SCREENSHOT_DIR,name+'.png')});}};
 await page.evaluate(async()=>{await UIRenderer.renderAIHistory(AppState.questions[AppState.currentQuestionIndex]);document.getElementById('ai-messages').scrollTop=0;});
 await capture('reading-1920');await page.setViewportSize({width:1366,height:768});await waitForExpanded();await capture('reading-1366');
 await page.evaluate(()=>{document.documentElement.style.setProperty('--ui-font-scale','1.5');DaguanAIPanelLayout.update();});
 await page.locator('#btn-toggle-nav').click();await waitForExpanded();
 const fontLayout=await page.evaluate(()=>{const body=document.querySelector('#ai-panel .ai-message.assistant .ai-message-bubble'),heading=body.querySelector('h2'),panel=document.getElementById('ai-panel');return {body:parseFloat(getComputedStyle(body).fontSize),heading:parseFloat(getComputedStyle(heading).fontSize),overflow:panel.scrollWidth>panel.clientWidth,inputBottom:document.querySelector('.ai-input-area').getBoundingClientRect().bottom};});
 assert.equal(fontLayout.body,21);assert.ok(fontLayout.heading<=fontLayout.body*1.25+.1);assert.equal(fontLayout.overflow,false);assert.ok(fontLayout.inputBottom<=768);await capture('reading-large-font');
 await page.locator('#btn-toggle-nav').click();await page.evaluate(()=>{document.documentElement.style.removeProperty('--ui-font-scale');DaguanAIPanelLayout.update();});await waitForExpanded();
 await page.evaluate(async()=>App.changeQuestionMode('multi'));await page.waitForSelector('.multi-question-view');await waitForExpanded();await capture('reading-multi');
 await page.setViewportSize({width:1024,height:768});assert.equal(await page.locator('#ai-expand-btn').isDisabled(),true);
 await page.setViewportSize({width:500,height:800});assert.equal(await page.locator('#ai-panel').evaluate(e=>e.getBoundingClientRect().width),500);await capture('reading-small');
 await page.setViewportSize({width:1366,height:768});await page.locator('#btn-toggle-nav').click();await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#app-nav').isVisible(),false);
 assert.equal(errors.length,0,errors.join('\n'));
});

test('Electron 实际 preload：桌面顶栏不增加外层空白，消息和输入区均处于视口内', {skip:!playwright || process.platform!=='win32',timeout:60000},async t=>{
 const {base,temp}=await fixture(t);
 const resultFile=path.join(temp,'layout.json'),entry=path.join(temp,'electron-probe.cjs');
 await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(temp,'electron'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1320,height:860,webPreferences:{preload:${JSON.stringify(path.join(ROOT,'desktop/preload.cjs'))},contextIsolation:true,sandbox:true}});try{await win.loadURL(${JSON.stringify(base+'/index.html?ui=new')});for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript('!!window.AppState?.categories'))break;await new Promise(r=>setTimeout(r,100));}await win.webContents.executeJavaScript(\`(async()=>{AppState.currentCategory=AppState.categories.categories.find(n=>UIRenderer.findNodeById(n,331));await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory,331));App.toggleAI()})()\`);await new Promise(r=>setTimeout(r,300));const result=await win.webContents.executeJavaScript(\`(()=>{document.getElementById('ai-messages').innerHTML='<p>'+('长回答 '.repeat(4000))+'</p>';const m=document.getElementById('app-main');m.scrollTop=m.scrollHeight;const msg=document.getElementById('ai-messages');msg.scrollTop=msg.scrollHeight;return {viewport:innerHeight,appBottom:document.querySelector('.app-container').getBoundingClientRect().bottom,outerScroll:m.scrollHeight,outerHeight:m.clientHeight,outerTop:m.scrollTop,inputBottom:document.querySelector('.ai-input-area').getBoundingClientRect().bottom,messageTop:msg.scrollTop};})()\`);fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify(result));}catch(e){fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({error:e.message}));}app.exit();});`);
 const electronEnv={...process.env};delete electronEnv.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.join(ROOT,'node_modules/electron/dist/electron.exe'),[entry],{env:electronEnv,windowsHide:true,stdio:['ignore','ignore','pipe']});
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics+=chunk;});
 t.after(()=>{if(child.exitCode==null)child.kill();});await once(child,'close');assert.equal(child.exitCode,0,diagnostics.slice(-3000));const result=JSON.parse(await fs.readFile(resultFile,'utf8'));
 assert.equal(result.error,undefined);assert.ok(result.appBottom<=result.viewport+2,JSON.stringify(result));assert.ok(result.outerScroll<=result.outerHeight+2);assert.equal(result.outerTop,0);assert.ok(result.inputBottom<=result.viewport);assert.ok(result.messageTop>0);
});
