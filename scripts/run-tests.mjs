import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
// Windows development keeps all test profiles, downloads and temp data off C:.
if (process.platform === 'win32') {
  const tmp = process.env.DAGUAN_TEST_TMP || 'F:\\AI\\tmp';
  await fs.mkdir(tmp, { recursive: true });
  process.env.TEMP = process.env.TMP = tmp;
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(tmp, 'playwright-browsers');
}
// A test run must never inherit a real user's data directory.
delete process.env.DAGUAN_DATA_DIR;
const { chromium } = createRequire(import.meta.url)(process.env.DAGUAN_PLAYWRIGHT_MODULE || 'playwright');
try {
  const browser = await chromium.launch({ headless: true, ...(process.env.DAGUAN_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAGUAN_CHROMIUM_EXECUTABLE } : {}) });
  await browser.close();
} catch (cause) {
  throw new Error('Browser tests are required. Install Chromium with PLAYWRIGHT_BROWSERS_PATH set to the test cache directory, then run: npx playwright install chromium', { cause });
}
const files = (await fs.readdir(new URL('../test/', import.meta.url))).filter(name => /\.test\.(?:mjs|cjs)$/.test(name)).sort().map(name => `test/${name}`);
files.push('sync-extension/test/protocol.test.js');
const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
