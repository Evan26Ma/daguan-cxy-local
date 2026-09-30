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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try { playwright = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright'); } catch {}

test('选择 150% 字号后，目录切换、进入题目和刷新均保留字号', {
  skip: !playwright && 'Install Playwright or set DAGUAN_PLAYWRIGHT_MODULE', timeout: 45000,
}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-font-scale-'));
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const service = spawn(process.execPath, [path.join(ROOT, 'local-server/server.mjs')], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, PORT: String(port), DAGUAN_DATA_DIR: temp, DAGUAN_OPEN_BROWSER: '0' },
  });
  t.after(async () => {
    if (service.exitCode == null) {
      service.send({ type: 'shutdown' });
      await Promise.race([once(service, 'close'), new Promise(r => setTimeout(r, 3000))]);
      if (service.exitCode == null) { service.kill(); await once(service, 'close'); }
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  let owner;
  for (let i = 0; i < 100; i++) {
    try {
      owner = JSON.parse(await fs.readFile(path.join(temp, '.service-instance.json'), 'utf8'));
      if ((await fetch(`http://127.0.0.1:${owner.port}/api/health`)).ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(owner?.port, 'isolated service starts');
  const browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${owner.port}/index.html?ui=new`);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.AppState?.categories);
  await page.evaluate(() => App.showSettings());
  const savedBrand = await page.evaluate(() => StorageService.getUIAppearance().brand);
  await page.locator('[data-appearance-color="brand"]').fill('#123456');
  await page.locator('[data-font-scale="1.5"]').click();
  const scale = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-font-scale'));
  assert.equal(await scale(), '1.5');
  assert.equal(await page.evaluate(() => StorageService.getUIAppearance().brand), savedBrand,
    '保存字号不会顺带保存尚未应用的颜色预览');
  await page.locator('#appearance-cancel').click();
  assert.equal(await scale(), '1.5', '取消颜色预览不会撤销已保存的字号');
  await page.evaluate(() => {
    const category = AppState.categories.categories.find(n => UIRenderer.findNodeById(n, 331));
    App.selectDirectoryItem(category.id, 321);
  });
  assert.equal(await scale(), '1.5', '点击目录章节不能把字号恢复成 100%');
  await page.evaluate(async () => {
    await App.enterChapterQuestions(UIRenderer.findNodeById(AppState.currentCategory, 331));
  });
  assert.equal(await scale(), '1.5');
  await page.reload();
  await page.waitForFunction(() => window.AppState?.categories);
  assert.equal(await scale(), '1.5', '刷新后继续使用所选字号');
});
