import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unusedHttpPort } from './http-fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function serviceFixture(t, { corrupt = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-safety-'));
  const port = await unusedHttpPort();
  if (corrupt) await fs.writeFile(path.join(dir, 'state.json'), '{broken');
  const child = spawn(process.execPath, ['local-server/server.mjs'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, DAGUAN_DATA_DIR: dir, PORT: String(port), DAGUAN_OPEN_BROWSER: '0', DAGUAN_AUTO_UPDATE_BANK: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode == null) {
      if (child.connected) child.send({ type: 'shutdown' });
      const timer = setTimeout(() => child.kill(), 3000);
      await closed;
      clearTimeout(timer);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  if (!corrupt) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode != null) throw new Error(output);
      try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('Fixture did not become ready: ' + output);
  }
  return { base, dir, child, closed, output: () => output };
}
