import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// 题库参考答案 v2 补写：数据在 web/data/explanations-v2.json（按需加载），
// 由 new-data.js 拉取、UIRenderer 渲染进题目卡片的 .explanation-v2 插槽。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const payload = JSON.parse(read('web/data/explanations-v2.json'));
const idIndex = JSON.parse(read('web/data/id_index.json'));
// 文本题干题与图片题干题各取一条做端到端验证。
const TEXT_ID = 129;
const IMAGE_ID = 6099;

const isBlank = value => value == null || (typeof value === 'string' && value.trim() === '');

// 一律在**原始字符串**上做检查：JSON.stringify 会把控制字符转义成 \u00xx 文本、
// 把每个反斜杠翻倍，拿序列化结果做正则匹配既会漏报也会误报（validate 脚本踩过同一个坑）。
function findMatch(node, regex, trail = '', transform) {
  if (typeof node === 'string') {
    const value = transform ? transform(node) : node;
    const found = regex.exec(value);
    return found ? `${trail} -> ${JSON.stringify(found[0])}` : null;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const found = findMatch(node[i], regex, `${trail}[${i}]`, transform);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const found = findMatch(node[key], regex, `${trail}.${key}`, transform);
      if (found) return found;
    }
  }
  return null;
}

// 前端只认 $ / $$；KaTeX 明确支持 \begin{aligned}，但 align 环境、行内 \tag
// 以及 \( \) / \[ \] 定界符都会渲染失败（已用 katex-render-check 实测确认）。
const FORBIDDEN = [
  ['控制字符', /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/],
  ['align 环境', /\\begin\{align\*?\}/],
  ['行内 \\tag（\tag 只能在 $$…$$ 里用）', /\\tag\{/, value => value.replace(/\$\$[\s\S]*?\$\$/g, ' ')],
  ['\\( \\) 或 \\[ \\] 定界符', /(?<!\\)\\[\[(]/],
];

test('v2 补写解析的数据契约', () => {
  assert.equal(payload.version, 2);
  assert.equal(payload.count, Object.keys(payload.explanations).length);
  assert.ok(payload.count > 1000, `题量异常：${payload.count}`);

  let steps = 0;
  for (const [id, entry] of Object.entries(payload.explanations)) {
    assert.ok(Object.hasOwn(idIndex, id), `#${id} 不在题库 id_index 里`);
    assert.match(String(entry.difficulty || ''), /^(基础|中等|较难)$/, `#${id} difficulty 非法`);
    assert.ok(!isBlank(entry.answerFinal), `#${id} 缺 answerFinal`);
    assert.ok(Array.isArray(entry.steps) && entry.steps.length >= 2, `#${id} 步骤少于 2 步`);
    for (const [i, step] of entry.steps.entries()) {
      // 「每步必须有 why」是这一版解析的核心卖点，缺了就等于退回原样。
      assert.ok(!isBlank(step.why), `#${id} 第 ${i + 1} 步缺 why`);
      assert.ok(!isBlank(step.content), `#${id} 第 ${i + 1} 步缺 content`);
      steps += 1;
    }
    for (const [label, regex, transform] of FORBIDDEN) {
      const found = findMatch(entry, regex, `#${id}`, transform);
      assert.equal(found, null, `${label}：${found}`);
    }
  }
  assert.ok(steps > 4000, `步骤总数异常：${steps}`);

  // 图片题干题必须带上视觉转写，否则学生仍然只能看扫描图。
  const image = payload.explanations[String(IMAGE_ID)];
  assert.ok(image, `缺少图片题干题 #${IMAGE_ID}`);
  assert.equal(image.origin, 'img');
  assert.ok(!isBlank(image.stemText) && !isBlank(image.explanationText), '图片题缺转写字段');
});

test('v2 解析按需加载、只在展开答案时进页面', () => {
  const html = read('web/index.html');
  const app = read('web/app-new.js');
  const data = read('web/new-data.js');
  const sw = read('web/service-worker.js');

  assert.match(html, /new-data\.js\?v=2/);
  const entry = html.match(/src="(\.\/app-new\.js\?v=\d+)"/)?.[1];
  assert.ok(entry); assert.ok(sw.includes(JSON.stringify(entry)));

  // 插槽 + 惰性填充必须成对存在，且填充要走 UIRenderer（App 与 UIRenderer 是两个类）。
  assert.match(app, /data-explanation-v2="\$\{escapeHtml\(String\(question\.id\)\)\}"/);
  assert.match(app, /static async fillExplanationV2\(root\)/);
  assert.match(app, /UIRenderer\.fillExplanationV2\(/);
  assert.doesNotMatch(app, /this\.fillExplanationV2\(/, 'App 里不能直接用 this 调 UIRenderer 的方法');

  assert.match(data, /'\.\/data\/explanations-v2\.json'/);
  assert.match(data, /static ensureExplanationsV2\(\)/);

  // 4.4 MB 的按需数据不得进启动路径，也不得进 Service Worker 预缓存。
  const loadAll = data.slice(data.indexOf('static async loadAll'), data.indexOf('static async loadCategories'));
  assert.doesNotMatch(loadAll, /explanations-v2/);
  assert.doesNotMatch(sw, /explanations-v2/);
  assert.match(sw, /pathname\.includes\("\/data\/"\)/);
});

let playwright;
try {
  playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
} catch {}
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function fixture(t) {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'daguan-v2-'));
  const port = await freePort();
  const service = spawn(process.execPath, [path.join(ROOT, 'local-server/server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: path.join(temp, 'data'), DAGUAN_OPEN_BROWSER: '0' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(async () => {
    if (service.exitCode == null) {
      service.send({ type: 'shutdown' });
      await Promise.race([once(service, 'close'), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (service.exitCode == null) service.kill();
    }
    await fsp.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy, '临时服务未能启动');
  return { base, temp };
}

test('精讲解析在真实页面里按需加载并渲染', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state/events', route => route.abort());
  await page.goto(`${base}/index.html?ui=new`);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction('typeof AppState !== "undefined" && AppState.categories');

  // 首屏不能拉这 4.4 MB。
  assert.equal(await page.evaluate(() => AppState.explanationsV2), null, '首屏不应加载 v2 数据');

  const requests = [];
  page.on('request', request => {
    if (request.url().includes('explanations-v2.json')) requests.push(request.url());
  });

  const probes = [
    { id: TEXT_ID, expectOriginTag: false },
    { id: IMAGE_ID, expectOriginTag: true },
  ];
  for (const { id, expectOriginTag } of probes) {
    const info = await page.evaluate(async questionId => {
      const question = await DataService.getQuestion(questionId);
      if (!question) return { missing: true };
      const host = document.createElement('div');
      host.innerHTML = UIRenderer.renderQuestionContent(question, { statusControls: '' });
      document.getElementById('app-main').appendChild(host);
      const answer = host.querySelector('.answer-section');
      answer.style.display = 'block';
      await UIRenderer.fillExplanationV2(host);
      const slot = host.querySelector('.explanation-v2');
      return {
        hidden: slot.hidden,
        text: slot.innerText,
        badge: slot.querySelector('.v2-badge')?.textContent ?? '',
        steps: slot.querySelectorAll('.v2-step').length,
        whys: slot.querySelectorAll('.v2-why').length,
        katex: slot.querySelectorAll('.katex').length,
        demotedOriginal: Boolean(host.querySelector('.explanation-original')),
        hasOriginal: Boolean(host.querySelector('[data-original-explanation]')),
      };
    }, id);

    assert.ok(!info.missing, `#${id} 不在题库中`);
    assert.equal(info.hidden, false, `#${id} 的精讲解析没有显示`);
    assert.equal(info.badge, '精讲解析');
    assert.ok(info.steps >= 2, `#${id} 只渲染出 ${info.steps} 步`);
    assert.equal(info.whys, info.steps, `#${id} 有步骤没有「为什么」`);
    assert.ok(info.katex > 0, `#${id} 公式没有渲染成 KaTeX`);
    assert.ok(info.text.length > 200, `#${id} 正文过短（${info.text.length} 字）`);
    if (expectOriginTag) assert.match(info.text, /扫描题 · 已转写/, `#${id} 缺少扫描题标注`);
    if (info.hasOriginal) assert.ok(info.demotedOriginal, `#${id} 原解析没有降级为对照材料`);
  }

  assert.equal(requests.length, 1, `v2 数据应只请求一次，实际 ${requests.length} 次`);
  assert.equal(errors.length, 0, errors.join('\n'));
});
