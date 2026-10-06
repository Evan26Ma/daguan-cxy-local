import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// 原生解析（native_solution）：题库自带 MinerU 排版片段，只经 safeRender.html（raw 清洗）
// 注入，优先于按需加载的 v2 精讲解析；导出里同样优先且不再回退 v2。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 合成用的原生片段：MathML 分数/矩阵与内嵌 data:PNG 必须保留，
// 脚本、样式、事件、data 动作和远程图片必须被清掉（外链 href 属 DOMPurify 允许的安全协议）。
const NATIVE_HTML = [
  '<p>原解析：分数与矩阵</p>',
  '<math display="block"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',
  '<math><mtable><mtr><mtd>a</mtd><mtd>b</mtd></mtr></mtable></math>',
  '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC" alt="配图">',
  '<script>window.__nativeXss = 1;<\/script>',
  '<style>.x{color:red}</style>',
  '<img src="https://evil.example/remote.png" alt="remote">',
  '<div onclick="window.__nativeClick = 1" data-app-action="unlock" style="color:red" class="leak">动作</div>',
].join('');

let playwright;
try {
  playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
} catch {}
const skip = !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// 隔离夹具：只读托管仓库 web/，全程不落盘用户数据；每个用例独立临时目录与全新浏览器 profile。
// 页面数据来自 web/data 的静态分片，测试不依赖会写用户数据目录的本地服务。
async function fixture(t) {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'daguan-native-'));
  const webRoot = path.join(ROOT, 'web');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (pathname.startsWith('/api/')) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{}');
      return;
    }
    const file = path.join(webRoot, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(webRoot)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(temp, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, temp };
}

async function openPage(t, base) {
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
  return { page, errors };
}

test('safeRender.html 保留原生 MathML 与 data: 图片并剔除脚本、样式、事件和远程图片', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const { page, errors } = await openPage(t, base);

  const out = await page.evaluate(markup => window.DaguanSafeRender.create({ assetUrl: value => value }).html(markup), NATIVE_HTML);

  // 原生排版必须存活：分数、矩阵、内嵌 PNG。
  assert.match(out, /<mfrac>/, '分数 MathML 被清洗掉了');
  assert.match(out, /<mtable>/, '矩阵 MathML 被清洗掉了');
  assert.match(out, /src="data:image\/png;base64,iVBORw0KGgo/, 'data:PNG 图片被清洗掉了');

  // 可信来源的排版文本保留，危险内容全部剔除。
  assert.match(out, /原解析：分数与矩阵/);
  assert.doesNotMatch(out, /<script/i, '脚本未被剔除');
  assert.doesNotMatch(out, /<style/i, '样式标签未被剔除');
  assert.doesNotMatch(out, /onclick/i, '内联事件未被剔除');
  assert.doesNotMatch(out, /data-app-action/i, 'data 动作未被剔除');
  assert.doesNotMatch(out, /style=/i, '原始模式仍保留了内联样式');
  assert.doesNotMatch(out, /evil\.example\/remote\.png/, '远程图片 URL 未被剔除');
  assert.doesNotMatch(out, /window\.__native/, '脚本内容未被剔除');

  // 真正注入 DOM 也不能执行脚本或触发动作。
  const executed = await page.evaluate(markup => {
    const host = document.createElement('div');
    host.innerHTML = window.DaguanSafeRender.create({ assetUrl: value => value }).html(markup);
    document.body.appendChild(host);
    return { xss: window.__nativeXss ?? null, click: window.__nativeClick ?? null, scripts: host.querySelectorAll('script').length };
  }, NATIVE_HTML);
  assert.equal(executed.xss, null, '脚本在页面里执行了');
  assert.equal(executed.click, null, '点击动作被注入');
  assert.equal(executed.scripts, 0, 'DOM 里仍残留 script 节点');

  assert.equal(errors.length, 0, errors.join('\n'));
});

// 真实 MinerU MathML：<semantics> 携带 annotation[encoding=application/x-tex] 原始 TeX。
// DOMPurify 默认只丢 annotation 标签、留下其中的 TeX 文本，会与公式重复；本轮在 raw 清洗里
// 连同 annotation/annotation-xml 的内容一起丢弃，同时保留原生结构排版。
const SEMANTIC_HTML = [
  '<p>原解析：矩阵与同余</p>',
  '<math display="block"><semantics>',
  '<mrow><mi>A</mi><mo>=</mo><mfenced open="[" close="]"><mtable>',
  '<mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr>',
  '<mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr>',
  '</mtable></mfenced></mrow>',
  '<annotation encoding="application/x-tex">A=\\begin{bmatrix}0&amp;1\\\\1&amp;0\\end{bmatrix}</annotation>',
  '</semantics></math>',
  '<math><semantics><mrow><mi>x</mi><mo>≡</mo><mn>2</mn></mrow>',
  '<annotation encoding="application/x-tex">x \\equiv 2</annotation></semantics></math>',
].join('');

// 注入型 annotation-xml：内容一旦被执行即证明清洗漏洞。
const UNSAFE_ANNOTATION = [
  '<math><semantics>',
  '<annotation-xml encoding="text/html"><img src="x" onerror="window.__annXss = 1">',
  '<script>window.__annXss = 2;<\/script></annotation-xml>',
  '<annotation encoding="application/x-tex">x</annotation>',
  '</semantics></math>',
].join('');

test('safeRender.html 丢弃 annotation/annotation-xml 内容且原生矩阵布局不塌陷', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const { page, errors } = await openPage(t, base);

  const out = await page.evaluate(markup => window.DaguanSafeRender.create({ assetUrl: value => value }).html(markup), SEMANTIC_HTML);

  // 原生结构保留，原始 TeX 源码不得泄漏。
  assert.match(out, /<mtable>/, '矩阵原生结构被清洗掉了');
  assert.ok(out.split('<mtd>').length - 1 >= 4, '矩阵单元格缺失');
  assert.doesNotMatch(out, /annotation/i, 'annotation/annotation-xml 标签未被剔除');
  assert.doesNotMatch(out, /begin\{bmatrix\}/, 'annotation 中的原始 TeX 泄漏');
  assert.doesNotMatch(out, /x \\equiv 2|equiv 2/, '行内 annotation 的原始 TeX 泄漏');
  assert.doesNotMatch(out, /application\/x-tex/, 'annotation encoding 文本泄漏');

  // 注入 DOM 后：annotation-xml 载荷不执行，矩阵 2x2 单元格按行列排布。
  const measured = await page.evaluate(({ markup, unsafe }) => {
    const renderer = window.DaguanSafeRender.create({ assetUrl: value => value });
    const host = document.createElement('div');
    host.className = 'native-solution';
    host.innerHTML = renderer.html(markup);
    document.getElementById('app-main').appendChild(host);
    const cellNodes = [...host.querySelectorAll('mtd')];
    const cells = cellNodes.map(cell => cell.getBoundingClientRect());
    const danger = document.createElement('div');
    danger.innerHTML = renderer.html(unsafe);
    document.getElementById('app-main').appendChild(danger);
    const rowTops = new Set(cells.map(r => Math.round(r.top)));
    const colLefts = new Set(cells.map(r => Math.round(r.left)));
    return {
      cellCount: cells.length,
      cellPadding: cellNodes.map(n => { const s = getComputedStyle(n); return parseFloat(s.paddingLeft) + parseFloat(s.paddingRight); }),
      rowTops: [...rowTops],
      colLefts: [...colLefts],
      srcTex: /begin\{bmatrix\}/.test(host.textContent),
      annotationNodes: host.querySelectorAll('annotation, annotation-xml').length,
      dangerNodes: danger.querySelectorAll('script, img, annotation-xml').length,
      xss: window.__annXss ?? null,
    };
  }, { markup: SEMANTIC_HTML, unsafe: UNSAFE_ANNOTATION });

  assert.equal(measured.cellCount, 4, '矩阵 2x2 单元格未保留');
  assert.ok(measured.cellPadding.every(p => p > 0), '全局 reset 不得挤掉原生矩阵列间距');
  assert.equal(measured.annotationNodes, 0, 'DOM 里仍残留 annotation 节点');
  assert.equal(measured.srcTex, false, 'DOM 文本里出现原始 TeX 源码');
  // 2 行 2 列：单元格应落在两个不同的 top 与两个不同的 left 上。
  assert.equal(measured.rowTops.length, 2, `矩阵未按两行排布：${measured.rowTops}`);
  assert.equal(measured.colLefts.length, 2, `矩阵未按两列排布：${measured.colLefts}`);
  assert.equal(measured.dangerNodes, 0, '危险 annotation-xml 载荷未剔除');
  assert.equal(measured.xss, null, 'annotation-xml 注入载荷被执行');

  assert.equal(errors.length, 0, errors.join('\n'));
});

// 真实 q2444 混排摘录（逐字取自输入报告 reports/native-mixed-tex-fixture-20261004.json）：题干既保留
// 原生 MathML（<semantics> + annotation），又夹杂 MinerU 未转成 MathML 的独立定界 TeX
// （<span class="math display">$$...$$</span>，含 \xlongequal）。html() 需在保留原生排版的同时，
// 只把文本节点里的定界 TeX 渲染成可见 KaTeX，且不泄漏原始源码，也不执行注入的动作/样式。
// 下面的 display 片段是报告原文，不得改写其中的数学内容。
const MIXED_DISPLAY_TEX = String.raw`<span class="math display">$$
\left. \frac {\partial f}{\partial y} \right| _ {(0, 0)} = \lim _ {y
\rightarrow 0} \frac {f (0 , y) - f (0 , 0)}{y - 0} = \lim _ {y
\rightarrow 0} \frac {1 - \cos y}{y} \xlongequal {1 - \cos y \sim \frac
{y ^ {2}}{2}} \lim _ {y \rightarrow 0} \frac {\frac {y ^ {2}}{2}}{y} =
0.
$$</span>`;

// code/pre 里的 TeX 属于字面代码，必须原样保留、绝不交给 KaTeX。
const MIXED_CODE_TEX = String.raw`\[ \text{code raw} \] $$ code raw $$`;

const MIXED_HTML = [
  '<p>答案 A.</p>',
  '<p>解 由',
  '<math display="inline" xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>f</mi><mo form="prefix" stretchy="false">(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo form="postfix" stretchy="false">)</mo></mrow><annotation encoding="application/x-tex">f(x,y)</annotation></semantics></math>',
  '的表达式可知.</p>',
  '<p>' + MIXED_DISPLAY_TEX + '</p>',
  '<p>又 <span class="math inline">$x \\equiv 2$</span> 成立。</p>',
  String.raw`<p>另 \[ a^2 + b^2 = c^2 \] 与 \( \alpha + \beta \) 均成立。</p>`,
  String.raw`<p>$\lim_{x\to0}\frac{f(x)-f(0)}{x}
\xlongequal{f(0)=0}\lim_{x\to0}\frac{f(x)}{x}$</p>`,
  String.raw`<p>$n\pi\leqslant x &amp;lt; (n+1)\pi$</p>`,
  String.raw`<p>价格为 \$5，折扣 \$1.5 保留字面量。</p>`,
  '<pre><code>' + MIXED_CODE_TEX + '</code></pre>',
  '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC" alt="配图">',
  '<div onclick="window.__mixedClick = 1" data-app-action="unlock" style="color:red" class="leak">动作</div>',
].join('');

test('safeRender.html 渲染文本节点里的独立定界 TeX 且不改动原生 MathML', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const { page, errors } = await openPage(t, base);

  const measured = await page.evaluate(({ markup, codeTex }) => {
    const host = document.createElement('div');
    host.className = 'native-solution';
    host.innerHTML = window.DaguanSafeRender.create({ assetUrl: value => value }).html(markup);
    document.getElementById('app-main').appendChild(host);
    const mathNodes = [...host.querySelectorAll('math')];
    const katexNodes = [...host.querySelectorAll('.katex')];
    const displayNodes = [...host.querySelectorAll('.katex-display')];
    const box = node => { const rect = node.getBoundingClientRect(); return { w: rect.width, h: rect.height }; };
    // 泄漏检查只看渲染出来的散文，排除被有意保留的 code/pre 与脚本/样式。
    const prose = host.cloneNode(true);
    prose.querySelectorAll('pre, code, script, style').forEach(node => node.remove());
    const proseText = prose.textContent;
    return {
      // KaTeX 生成的 MathML 包裹在 .katex 里；MinerU 原生 MathML 不属于任何 .katex。
      nativeMath: mathNodes.filter(node => !node.closest('.katex')).length,
      mfrac: host.querySelectorAll('mfrac').length,
      katex: katexNodes.length,
      displayKatex: displayNodes.length,
      katexBoxes: katexNodes.map(box),
      displayBoxes: displayNodes.map(box),
      katexErrors: host.querySelectorAll('.katex-error').length,
      annotation: host.querySelectorAll('annotation, annotation-xml').length,
      script: host.querySelectorAll('script').length,
      dataImage: host.querySelectorAll('img[src^="data:image/png"]').length,
      // KaTeX 生成的排版会带自己的内联样式；这里只查用户注入的样式是否被清掉。
      userStyle: /color:\s*red/i.test(host.innerHTML),
      userClass: host.querySelectorAll('.leak').length,
      dataAction: host.querySelectorAll('[data-app-action]').length,
      onclick: typeof host.innerHTML === 'string' ? /onclick/i.test(host.innerHTML) : true,
      leaksRawTex: /\\frac|\\partial|\$\$|\\equiv|\\\[|\\\(/.test(proseText),
      escapedDollar: proseText.includes('\\$5'),
      codeKatex: host.querySelectorAll('pre .katex, code .katex').length,
      codeText: [...host.querySelectorAll('pre, code')].map(node => node.textContent).join('|'),
      codeTexPreserved: [...host.querySelectorAll('pre, code')].some(node => node.textContent.includes(codeTex)),
      click: window.__mixedClick ?? null,
    };
  }, { markup: MIXED_HTML, codeTex: MIXED_CODE_TEX });

  // 原生 MathML 只出现一次，且未被 KaTeX 或重复内容顶替。
  assert.equal(measured.nativeMath, 1, `原生 MathML 数量异常：${measured.nativeMath}`);
  assert.ok(measured.mfrac >= 1, '原生/KaTeX 分数排版缺失');
  // $$...$$（真实 q2444 的 y 偏导，含 \xlongequal）、$...$、\[...\]、\(...\) 都渲染成 KaTeX。
  assert.ok(measured.katex >= 6, `独立定界 TeX、跨行公式或转义不等式未渲染为 KaTeX：${measured.katex}`);
  assert.ok(measured.displayKatex >= 2, 'display 公式未生成 katex-display');
  assert.equal(measured.katexErrors, 0, '存在 KaTeX 解析错误（如 \\xlongequal 未渲染）');
  // 生成的 KaTeX HTML 必须真正可见（有宽高），而不是只有 class 计数。
  assert.ok(measured.katexBoxes.length > 0, '未生成任何 KaTeX 盒');
  assert.ok(measured.katexBoxes.every(b => b.w > 0 && b.h > 0), `存在零尺寸 KaTeX：${JSON.stringify(measured.katexBoxes)}`);
  assert.ok(measured.displayBoxes.length >= 2, `display 公式数量异常：${measured.displayBoxes.length}`);
  assert.ok(measured.displayBoxes.every(b => b.w > 0 && b.h > 0), `display 公式尺寸异常：${JSON.stringify(measured.displayBoxes)}`);
  assert.equal(measured.leaksRawTex, false, '页面散文里残留原始 TeX 源码或定界符');
  assert.equal(measured.escapedDollar, true, '转义美元文本未按字面量保留');
  // code/pre 中的 TeX 属字面代码：必须原样保留，且不得被渲染成 KaTeX。
  assert.equal(measured.codeKatex, 0, 'code/pre 中的 TeX 被错误渲染');
  assert.equal(measured.codeTexPreserved, true, `code/pre 中的 TeX 未原样保留：${measured.codeText}`);
  // annotation 内容、脚本与注入动作/样式全部剔除。
  assert.equal(measured.annotation, 0, 'annotation/annotation-xml 节点残留');
  assert.equal(measured.script, 0, '脚本节点残留');
  assert.equal(measured.userStyle, false, '用户注入的内联样式残留');
  assert.equal(measured.userClass, 0, '用户注入的 class 残留');
  assert.equal(measured.dataAction, 0, 'data 动作残留');
  assert.equal(measured.onclick, false, '内联事件残留');
  // data: 图片保留。
  assert.equal(measured.dataImage, 1, 'data:PNG 图片被清洗掉了');
  assert.equal(measured.click, null, '注入的点击动作被执行');

  assert.equal(errors.length, 0, errors.join('\n'));
});

test('#129 克隆题带 native_solution 时优先原生解析、不渲染 v2 插槽也不拉取 v2 数据', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const { page, errors } = await openPage(t, base);

  assert.equal(await page.evaluate(() => AppState.explanationsV2), null, '首屏不应加载 v2 数据');

  const requested = [];
  page.on('request', request => {
    if (request.url().includes('explanations-v2.json')) requested.push(request.url());
  });

  const info = await page.evaluate(async markup => {
    const original = await DataService.getQuestion(129);
    if (!original) return { missing: true };
    // 同一 id（129）在 v2 表里存在条目；克隆题额外带上原生解析。
    const clone = { ...original, id: 129, native_solution: { html: markup, text: 'native', source: { document: '线代讲义', label: '例3' } } };
    const host = document.createElement('div');
    host.innerHTML = UIRenderer.renderQuestionContent(clone, { statusControls: '' });
    document.getElementById('app-main').appendChild(host);
    const answer = host.querySelector('.answer-section');
    answer.style.display = 'block';
    await UIRenderer.fillExplanationV2(host);
    const native = host.querySelector('[data-native-solution]');
    return {
      hasNative: Boolean(native),
      fraction: Boolean(native?.querySelector('mfrac')),
      image: Boolean(native?.querySelector('img[src^="data:image/png"]')),
      script: native ? native.querySelectorAll('script').length : -1,
      source: native?.querySelector('.native-solution-source')?.textContent ?? '',
      v2Slot: host.querySelectorAll('[data-explanation-v2]').length,
      v2Content: host.querySelectorAll('.v2-badge, .v2-step').length,
      explanationsV2: AppState.explanationsV2,
      v2FilledFlag: Boolean(host.querySelector('[data-explanation-v2][data-explanation-v2-filled="1"]')),
    };
  }, NATIVE_HTML);

  assert.ok(!info.missing, '#129 不在题库中');
  assert.equal(info.hasNative, true, '原生解析区未渲染');
  assert.equal(info.fraction, true, '原生分数 MathML 未保留');
  assert.equal(info.image, true, '原生 data:PNG 未保留');
  assert.equal(info.script, 0, '原生解析里残留脚本');
  assert.match(info.source, /资料解析 · 线代讲义\/例3/, '缺少原生解析出处标注');
  assert.equal(info.v2Slot, 0, '原生解析题不应渲染 v2 插槽');
  assert.equal(info.v2Content, 0, '原生解析题不应渲染 v2 内容');
  assert.equal(info.explanationsV2, null, '不应因原生解析题触发 v2 加载');
  assert.equal(info.v2FilledFlag, false);
  assert.equal(requested.length, 0, `原生解析题不应请求 v2 数据，实际 ${requested.length} 次`);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('#129 无原生字段时照常加载并渲染 v2；导出对原生题输出净化解析且不再回退 v2', { skip, timeout: 90000 }, async t => {
  const { base } = await fixture(t);
  const { page, errors } = await openPage(t, base);

  // 无 native_solution 的真 #129：仍按 v2 路径渲染。
  const real = await page.evaluate(async () => {
    const loaded = await DataService.getQuestion(129);
    const question = loaded && { ...loaded };
    if (question) delete question.native_solution;
    if (!question) return { missing: true };
    const host = document.createElement('div');
    host.innerHTML = UIRenderer.renderQuestionContent(question, { statusControls: '' });
    document.getElementById('app-main').appendChild(host);
    const answer = host.querySelector('.answer-section');
    answer.style.display = 'block';
    await UIRenderer.fillExplanationV2(host);
    const slot = host.querySelector('.explanation-v2');
    return {
      hasNativeField: Boolean(question.native_solution),
      hasNativeSection: Boolean(host.querySelector('[data-native-solution]')),
      slotCount: host.querySelectorAll('[data-explanation-v2]').length,
      hidden: slot?.hidden,
      badge: slot?.querySelector('.v2-badge')?.textContent ?? '',
      steps: slot?.querySelectorAll('.v2-step').length ?? 0,
      explanationsV2Loaded: Boolean(AppState.explanationsV2),
    };
  });

  assert.ok(!real.missing, '#129 不在题库中');
  assert.equal(real.hasNativeField, false, '真实 #129 不应带 native_solution');
  assert.equal(real.hasNativeSection, false, '无原生字段不应渲染原生解析区');
  assert.equal(real.slotCount, 1, '无原生字段应渲染 v2 插槽');
  assert.equal(real.hidden, false, 'v2 精讲解析未显示');
  assert.equal(real.badge, '精讲解析', 'v2 徽标缺失');
  assert.ok(real.steps >= 2, `#129 只渲染出 ${real.steps} 步`);
  assert.equal(real.explanationsV2Loaded, true, 'v2 数据应已被加载');

  // 导出：原生题走净化后的原生解析，且不再回退 v2；无原生字段的 #129 走 v2。
  const exported = await page.evaluate(async markup => {
    const loaded = await DataService.getQuestion(129);
    const original = { ...loaded };
    delete original.native_solution;
    const nativeClone = { ...original, id: 129, native_solution: { html: markup, text: 'native', source: { document: '线代讲义', label: '例3' } } };
    await DataService.ensureExplanationsV2();
    let doc = null;
    const realOpen = window.open;
    window.open = () => ({ document: { write: html => { doc = html; }, close() {} } });
    try {
      App.exportQuestionList([nativeClone], '原生导出', { withAnswers: true, withExpl: true });
      const nativeDoc = doc;
      doc = null;
      App.exportQuestionList([original], 'v2导出', { withAnswers: true, withExpl: true });
      return { nativeDoc, v2Doc: doc };
    } finally { window.open = realOpen; }
  }, NATIVE_HTML);

  assert.ok(exported.nativeDoc, '原生题导出文档为空');
  assert.match(exported.nativeDoc, /native-solution/, '原生题导出缺少原生解析容器');
  assert.match(exported.nativeDoc, /<mfrac>/, '原生题导出丢失 MathML 分数');
  assert.match(exported.nativeDoc, /src="data:image\/png;base64,iVBORw0KGgo/, '原生题导出丢失 data:PNG');
  assert.doesNotMatch(exported.nativeDoc, /window\.__native/, '原生题导出残留脚本内容');
  assert.doesNotMatch(exported.nativeDoc, /evil\.example/, '原生题导出残留远程图片');
  // 导出模板的 <style> 里本就带 .v2-badge 样式，这里只查是否真的渲染出 v2 内容。
  assert.doesNotMatch(exported.nativeDoc, /<span class="v2-badge">/, '原生题导出不应回退 v2 解析');
  assert.doesNotMatch(exported.nativeDoc, /class="v2-step"/, '原生题导出不应带回退 v2 的步骤');

  assert.ok(exported.v2Doc, '无原生字段导出文档为空');
  assert.match(exported.v2Doc, /精讲解析/, '无原生字段导出应包含 v2 精讲解析');
  assert.match(exported.v2Doc, /v2-step/, '无原生字段导出缺少 v2 步骤');

  assert.equal(errors.length, 0, errors.join('\n'));
});
