import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadApp() {
  const sandbox = {
    navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { pathname: '/index.html', href: 'http://127.0.0.1/index.html', replace: () => {} },
    document: { addEventListener: () => {}, documentElement: { dataset: {} }, createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, set textContent(v) {} }) },
    URL, setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: () => Promise.reject(new Error('no network in search tests')),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const web = new URL('../web/', import.meta.url);
  vm.runInContext(fs.readFileSync(new URL('ui-version.js', web), 'utf8'), sandbox, { filename: 'ui-version.js' });
  vm.runInContext(fs.readFileSync(new URL('app-new.js', web), 'utf8'), sandbox, { filename: 'app-new.js' });
  return sandbox;
}

test('全库搜索将常见分数、括号和关系符公式写法归一', () => {
  const { App } = loadApp();
  const normalize = App.normalizeSearchText;
  assert.equal(normalize('\\dfrac { x } { 2 }'), normalize('\\frac{x}{2}'));
  assert.equal(normalize('\\left( a \\leq b \\right)'), normalize('(a <= b)'));
  assert.equal(normalize('A × B'), normalize('A \\cdot B'));
});

test('全库搜索索引保留完整题库规模并可用路径、来源字段命中', () => {
  const { App } = loadApp();
  const rows = JSON.parse(fs.readFileSync(new URL('../web/data/search_index.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../web/data/manifest.json', import.meta.url), 'utf8'));
  assert.equal(rows.length, manifest.total);
  const normalize = App.normalizeSearchText;
  const query = normalize('第5章 数理统计部分');
  assert.ok(rows.some(row => normalize(row.path).includes(query)));
  const qid = String(rows.at(-1).id);
  assert.ok(rows.some(row => normalize(`${row.id} ${row.stem} ${row.source} ${row.path}`).includes(normalize(qid))));
});

test('快捷键保留旧版自定义键，同时识别其与新固定键或彼此之间的冲突', () => {
  const { App, AppState } = loadApp();
  AppState.shortcuts = { ...AppState.shortcuts, favorite: 'f', ai: 'g', note: 'f' };
  const conflicts = App.shortcutConflicts().join(' ');
  assert.match(conflicts, /固定键 G/);
  assert.match(conflicts, /打开题目批注 与 切换收藏/);
});
