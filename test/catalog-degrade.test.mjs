import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { unusedHttpPort } from './http-fixture.mjs';
import { serviceFixture } from './runtime-fixture.mjs';

// 镜像站不可用时的降级路径：题库刷新失败只应出现在提示里，不应该让整条同步链路
// 在读取本地/远端状态之前就失败。
async function degradedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daguan-catalog-degrade-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('daguan-catalog-degrade-')) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  });
  await fs.mkdir(path.join(root, 'web', 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'web', 'data', 'manifest.json'), JSON.stringify({ version: 'fixture', total: 1, shards: {} }));
  const closedPort = await unusedHttpPort();
  const fixture = await serviceFixture(t, {
    env: {
      DAGUAN_ROOT_DIR: root,
      DAGUAN_CATALOG_SOURCE: `http://127.0.0.1:${closedPort}/daguan-math`,
    },
  });
  return { ...fixture, closedPort };
}

test('题库镜像不可用时同步预览继续走到账号校验，而不是整体失败', { timeout: 30000 }, async t => {
  const { base, closedPort, output } = await degradedFixture(t);
  const response = await fetch(base + '/api/integrations/cxyonly/reconcile/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(String(payload.error), /尚未配置大观园登录/);
  assert.doesNotMatch(String(payload.error), /题库更新失败/);
  assert.doesNotMatch(output(), new RegExp(String(closedPort)));
});

test('题库刷新任务仍然如实报告失败状态', { timeout: 30000 }, async t => {
  const { base } = await degradedFixture(t);
  const started = await fetch(base + '/api/catalog/refresh', { method: 'POST' });
  assert.equal(started.status, 202);
  const task = await started.json();
  let current = task;
  for (let attempt = 0; attempt < 100 && current.status === 'running'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    current = await fetch(`${base}/api/catalog/refresh/${task.taskId}`).then(response => response.json());
  }
  assert.equal(current.status, 'failed');
  assert.match(String(current.error), /连接官网题库失败（ECONNREFUSED）/);
  assert.match(String(current.error), /已尝试 3 次/);
});
