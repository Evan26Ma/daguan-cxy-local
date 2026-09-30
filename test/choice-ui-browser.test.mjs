import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let playwright;try{playwright=createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE||'playwright');}catch{}
const skip=!playwright && 'Playwright unavailable';
const question={id:32,type:'single_choice',stem:'自动判题回归题',answer:'B',explanation:'正确答案为 B。',options:[{label:'A',content_md:'错误项'},{label:'B',content_md:'正确项'}],correct_labels:['B']};
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'daguan-choice-'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const service=spawn(process.execPath,[path.join(ROOT,'local-server/server.mjs')],{cwd:ROOT,env:{...process.env,PORT:String(port),DAGUAN_DATA_DIR:path.join(dir,'data'),DAGUAN_OPEN_BROWSER:'0'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(service.exitCode==null){service.send({type:'shutdown'});await Promise.race([once(service,'close'),new Promise(r=>setTimeout(r,3000))]);if(service.exitCode==null)service.kill();}await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const browser=await playwright.chromium.launch({headless:true,...(process.env.DAGUAN_CHROMIUM_EXECUTABLE?{executablePath:process.env.DAGUAN_CHROMIUM_EXECUTABLE}:{})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/state/events',r=>r.abort());
 return {page,base,errors};
}
async function setup(page,base,ui,mode){
 if(page.url().startsWith(base)) await page.evaluate(ui=>localStorage.setItem('daguan_ui_version_v1',ui==='old'?'old':'new'),ui);
 if(ui==='old'){
  const source=await fs.readFile(path.join(ROOT,'web/app-legacy.js'),'utf8');
  await page.route('**/app-legacy.js*',route=>route.fulfill({contentType:'application/javascript',body:source.replace('window.DaguanDesktopSwitch = setUiVersion;', 'window.__choiceTest={state,renderSingle,renderFeed,setMode,setView,applyMode,flushQuestionSync,lockPreview:()=>{previewMode=true;previewUnlocked=false}}; window.DaguanDesktopSwitch = setUiVersion;')}));
 }
 await page.goto(base+(ui==='old'?'/legacy.html?ui=old':'/index.html?ui=new'));await page.waitForLoadState('networkidle');
 await page.waitForFunction(ui==='old'?'window.__choiceTest':'window.AppState && AppState.categories');
 await page.evaluate(async({q,ui,mode})=>{
  if(ui==='old'){
   const h=window.__choiceTest;h.state.queue=[q];h.state.index=0;h.state.selected=new Set();h.state.showAnswer=false;h.state.cardUI.clear();h.setView('browse');
   h.applyMode(mode==='single'?'single':'list');if(mode==='single')h.renderSingle();else h.renderFeed(true);
  }else{
   AppState.questions=[q];AppState.currentQuestionIndex=0;AppState.currentView='question';AppState.answers={};AppState.currentCategory=null;AppState.currentChapter=null;AppState.questionMode=mode;
   if(mode==='single')await UIRenderer.renderQuestion(0);else UIRenderer.renderMultiQuestions(0);
  }
 },{q:question,ui,mode});
}
async function waitState(page,predicate){
 for(let i=0;i<100;i++){const s=await page.evaluate(async()=>await(await fetch('./api/state')).json());if(predicate(s))return s;await page.waitForTimeout(100);}throw new Error('State did not synchronize');
}
for(const ui of ['new','old'])for(const mode of ['single','multi'])test(`${ui} ${mode}: 自动展开、改选、收藏易错与重复点击`,{skip,timeout:45000},async t=>{
 const {page,base,errors}=await fixture(t);await setup(page,base,ui,mode);
 const options=page.locator(ui==='new'?'.option-item':mode==='single'?'#q-options .opt':'.q-card .opt');
 const root=ui==='new'?page.locator(mode==='single'?'.question-wrapper':'.multi-question-card'):page.locator(mode==='single'?'#q-options':'.q-card');
 await options.nth(0).click();await root.locator('.choice-feedback').filter({hasText:'回答错误'}).waitFor();
 assert.equal(await options.locator('.choice-option-tag').filter({hasText:'正确答案'}).count(),1);
 assert.equal(await options.locator('.choice-option-tag').filter({hasText:'你的选择'}).count(),1);
 assert.equal(await page.locator(ui==='new'?'.answer-section':mode==='single'?'#answer-box':'#q-feed .q-card .answer-box').isVisible(),true);
 await waitState(page,s=>s.progress?.['32']?.last_ok===false && s.progress['32'].favorite===true);
 let s=await page.evaluate(async()=>await(await fetch('./api/state')).json());assert.ok(s.progress['32'],JSON.stringify(s));assert.equal(s.progress['32'].mastery,'learning');assert.equal(s.progress['32'].error_prone,true);
 await options.nth(1).click();await root.locator('.choice-feedback').filter({hasText:'回答正确'}).waitFor();
 assert.equal(await options.filter({has:page.locator('.choice-option-tag')}).count(),1);
 await waitState(page,s=>s.progress?.['32']?.last_ok===true);
 s=await page.evaluate(async()=>await(await fetch('./api/state')).json());assert.equal(s.progress['32'].mastery,'mastered');assert.equal(s.progress['32'].favorite,true);assert.equal(s.progress['32'].error_prone,true);
 const at=s.progress['32'].last_practiced_at;await options.nth(1).click();await page.waitForTimeout(500);s=await page.evaluate(async()=>await(await fetch('./api/state')).json());assert.equal(s.progress['32'].last_practiced_at,at);
 await options.nth(0).click();await waitState(page,s=>s.progress?.['32']?.mastery==='learning');
 assert.deepEqual(errors,[]);
});

for(const ui of ['new','old'])for(const failure of [500,409])test(`${ui}: 失败或版本冲突重试保留快速改选的最新结果 (${failure})`,{skip,timeout:45000},async t=>{
 const {page,base,errors}=await fixture(t);await setup(page,base,ui,'single');await page.waitForTimeout(600);
 const current=await page.evaluate(async()=>await(await fetch('./api/state')).json());
 let arrived,release;const arrival=new Promise(r=>arrived=r);const gate=new Promise(r=>release=r);let first=true;
 t.after(()=>release());
 await page.route('**/api/state/questions/32',async route=>{
  const body=route.request().postDataJSON();
  if(first && body.last_ok===false){first=false;arrived();await gate;await route.fulfill({status:failure,contentType:'application/json',body:JSON.stringify(failure===409?{current}:{error:'mock offline'})});}
  else await route.continue();
 });
 const options=page.locator(ui==='new'?'.option-item':'#q-options .opt');
 await options.nth(0).click();await arrival;
 await options.nth(1).click();release();
 const saved=await waitState(page,s=>s.progress?.['32']?.last_ok===true);
 assert.equal(saved.progress['32'].mastery,'mastered');assert.equal(saved.progress['32'].favorite,true);assert.equal(saved.progress['32'].error_prone,true);
 assert.equal(await page.locator('.choice-feedback:visible').textContent(),'回答正确');
 await setup(page,base,ui==='new'?'old':'new','single');
 const cached=await page.evaluate(ui=>ui==='new'?StorageService.getProgress().progress['32']:window.__choiceTest.state.progress['32'],ui==='new'?'old':'new');
 assert.equal(cached.mastery,'mastered');assert.equal(cached.favorite,true);assert.equal(cached.error_prone,true);
 assert.deepEqual(errors,[]);
});

for(const ui of ['new','old'])test(`${ui}: 预览只显示判题，不写私人状态`,{skip,timeout:30000},async t=>{
 const {page,base,errors}=await fixture(t);await setup(page,base,ui,'single');await page.waitForTimeout(600);
 await page.evaluate(ui=>{if(ui==='new'){PreviewAccess.mode=true;PreviewAccess.unlocked=false;}else window.__choiceTest.lockPreview();},ui);
 let writes=0;page.on('request',r=>{if(r.method()==='PATCH' && r.url().endsWith('/api/state/questions/32'))writes++;});
 await page.locator(ui==='new'?'.option-item':'#q-options .opt').nth(0).click();
 assert.equal(await page.locator('.choice-feedback:visible').textContent(),'回答错误，请查看答案与解析');
 await page.waitForTimeout(500);assert.equal(writes,0);assert.deepEqual(errors,[]);
});

for(const ui of ['new','old'])test(`${ui}: 离线作答刷新后恢复并自动补同步`,{skip,timeout:45000},async t=>{
 const {page,base,errors}=await fixture(t);await setup(page,base,ui,'single');await page.waitForTimeout(600);
 const pattern='**/api/state/questions/32';await page.route(pattern,r=>r.abort());
 await page.locator(ui==='new'?'.option-item':'#q-options .opt').nth(0).click();await page.waitForTimeout(1100);
 await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(ui==='new'?'window.AppState && AppState.categories':'window.__choiceTest');
 const cached=await page.evaluate(ui=>ui==='new'?StorageService.getProgress().progress['32']:window.__choiceTest.state.progress['32'],ui);
 assert.equal(cached.last_ok,false);assert.equal(cached.favorite,true);assert.equal(cached.error_prone,true);
 await page.unroute(pattern);
 const saved=await waitState(page,s=>s.progress?.['32']?.last_ok===false);
 assert.equal(saved.progress['32'].mastery,'learning');assert.equal(saved.progress['32'].favorite,true);assert.equal(saved.progress['32'].error_prone,true);
 assert.deepEqual(errors,[]);
});

for(const ui of ['new','old'])test(`${ui}: 无可靠答案不自动判错，多选保持原有行为`,{skip,timeout:30000},async t=>{
 const {page,base,errors}=await fixture(t);await setup(page,base,ui,'single');await page.waitForTimeout(600);
 const options=page.locator(ui==='new'?'.option-item':'#q-options .opt');
 await page.evaluate(async ui=>{
  if(ui==='new'){AppState.questions[0].correct_labels=['C'];await UIRenderer.renderQuestion(0);}
  else{window.__choiceTest.state.queue[0].correct_labels=['C'];window.__choiceTest.renderSingle();}
 },ui);
 await options.nth(0).click();await options.nth(1).click();assert.equal(await options.locator('.choice-option-tag').count(),0);
 await page.waitForTimeout(500);const saved=await page.evaluate(async()=>await(await fetch('./api/state')).json());
 assert.notEqual(saved.progress['32']?.answered,true);assert.notEqual(saved.progress['32']?.error_prone,true);
 await page.evaluate(async ui=>{
  if(ui==='new'){AppState.questions[0].type='multiple_choice';AppState.questions[0].correct_labels=['A','B'];AppState.answers={};await UIRenderer.renderQuestion(0);}
  else{const h=window.__choiceTest;h.state.queue[0].type='multiple_choice';h.state.queue[0].correct_labels=['A','B'];h.state.selected=new Set();h.state.showAnswer=false;h.renderSingle();}
 },ui);
 await options.nth(0).click();await options.nth(1).click();assert.equal(await options.locator('.choice-option-tag').count(),0);
 assert.equal(await options.evaluateAll(items=>items.filter(item=>item.classList.contains('selected')).length),2);
 assert.equal(await page.locator('.choice-feedback:visible').count(),0);assert.deepEqual(errors,[]);
});
