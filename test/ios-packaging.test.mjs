import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { prepareWeb, transform } from '../ios/scripts/prepare-web.mjs';
const project = fileURLToPath(new URL('..', import.meta.url));
const tmp = process.platform === 'win32' ? 'F:/AI/tmp' : process.env.DAGUAN_TEST_TMP || '/tmp';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('actual bundle preserves all product assets, reports overlay missing qids and hashes deterministic transformed resources', { timeout: 120000 }, async () => {
  await mkdir(tmp, { recursive: true }); const sandbox = await mkdtemp(join(tmp, 'daguan-ios-packaging-'));
  try {
    const out = join(sandbox, 'Web'); const result = await prepareWeb({ out });
    const manifestBytes = await readFile(join(out, 'resource-manifest.json')); const manifest = JSON.parse(manifestBytes);
    assert.deepEqual(result.transformed, ['app-new.js', 'index.html', 'safe-render.js', 'ui-bootstrap.js']);
    assert.equal(manifest.bridge, 'ios/bridge.js');
    for (const entry of manifest.files) {
      const bytes = await readFile(join(out, entry.path)); assert.equal(hash(bytes), entry.sha256, entry.path); assert.equal(bytes.length, entry.size);
      assert.doesNotMatch(entry.path, /\.bak|legacy|landing\.html|app2|service-worker|local_question_banks|annotations\.json|retired-video|unmatched-audit|remote-access|data-bank-client/);
    }
    const dataAssets = await readdir(join(project, 'web/data/assets'));
    for (const name of dataAssets) assert.equal(hash(await readFile(join(out, 'data/assets', name))), hash(await readFile(join(project, 'web/data/assets', name))), name);
    const report = JSON.parse(await readFile(join(out, 'missing-assets.json')));
    assert.equal(report.completeOffline, false); assert.equal(report.missingCount, report.missingAssets.length);
    assert.ok(report.missingCount >= 41); assert.ok(report.missingAssets.every(item => item.qids.length && item.files.length));
    assert.ok(manifest.files.some(item => item.path === 'data/native-solutions.json')); // Synthetic overlay case below verifies scanning even when current overlay assets are complete.
    const index = await readFile(join(out, 'index.html'), 'utf8'); assert.match(index, /ios\/platform\.css/); assert.doesNotMatch(index, /src="[^\"]*bridge\.js|desktop-storage|browser-retirement|remote-access|data-bank-client|manifest\.webmanifest/);
    for (const file of ['app-new.js', 'safe-render.js', 'ui-bootstrap.js', 'ios/bridge.js']) new vm.Script(await readFile(join(out, file), 'utf8'), { filename: file });
    const app = await readFile(join(out, 'app-new.js'), 'utf8'); assert.match(app, /await window\.DaguanIOS\.exportBlob/); assert.match(app, /id="restore-input" accept="\.json,application\/json"/); assert.match(app, /已打开备份分享/);
    await assert.rejects(prepareWeb({ out }), /Output must be empty/);
    await prepareWeb({ out, replaceGenerated: true }); assert.equal(await readFile(join(out, 'resource-manifest.json'), 'utf8'), manifestBytes.toString());
    await writeFile(join(out, 'personal-records.json'), '{"keep":true}');
    await assert.rejects(prepareWeb({ out, replaceGenerated: true }), /unknown output file/); assert.equal(await readFile(join(out, 'personal-records.json'), 'utf8'), '{"keep":true}');
    const unowned = join(sandbox, 'unowned'); await mkdir(unowned); await writeFile(join(unowned, 'keep.txt'), 'keep'); await assert.rejects(prepareWeb({ out: unowned, replaceGenerated: true })); assert.equal(await readFile(join(unowned, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(prepareWeb({ out: join(project, 'web') }), /separate from source/);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('overlay scanner preserves unresolved image references and qids without reading credentials/private data', { timeout: 120000 }, async () => {
  const sandbox = await mkdtemp(join(tmp, 'daguan-ios-overlay-'));
  try {
    // A tiny input uses the real reviewed transformations but no giant snapshots.
    const source = join(sandbox, 'source'); await mkdir(join(source, 'data/assets'), { recursive: true }); await mkdir(join(source, 'assets')); await mkdir(join(source, 'vendor/fonts'), { recursive: true });
    await writeFile(join(source, 'index.html'), '<html lang="zh-CN" data-app-version="new">\n  <script src="./ui-version.js?v=106"></script>\n</html>'); await writeFile(join(source, 'ui-version.js'), ''); await writeFile(join(source, 'vendor/DOMPurify-LICENSE'), 'license');
    for (const name of ['categories', 'category_questions', 'id_index', 'search_index', 'lecture-video-mappings', 'paradiyu-linear-video']) await writeFile(join(source, `data/${name}.json`), '{}');
    await mkdir(join(source, 'data/shards')); const absent = 'a'.repeat(64);
    await writeFile(join(source, 'data/manifest.json'), JSON.stringify({ shards: { sample: { file: 'shards/sample.json' } } }));
    await writeFile(join(source, 'data/shards/sample.json'), JSON.stringify([{ id: 17, stem: `![](assets/${absent}.webp)` }]));
    await writeFile(join(source, 'data/native-solutions.json'), JSON.stringify({ solutions: { 17: { html: `<img src="assets/${absent}.webp">` } } }));
    await writeFile(join(source, 'data/explanations-v2.json'), JSON.stringify({ explanations: { 42: { steps: [{ content: '<img src="https://example.test/missingimg.png">' }] } } }));
    await writeFile(join(source, '.env'), 'MUST_NOT_READ'); await writeFile(join(source, 'data/private.json'), '{"secret":"MUST_NOT_READ"}'); await writeFile(join(source, 'data/assets/example.png.bak'), 'MUST_NOT_COPY');
    const out = join(sandbox, 'out'); await prepareWeb({ source, out }); const report = JSON.parse(await readFile(join(out, 'missing-assets.json')));
    assert.equal(report.missingCount, 1); assert.deepEqual(report.missingAssets[0].qids, ['17']); assert.equal(report.potentialCount, 1); assert.deepEqual(report.potentiallyUnresolvedReferences[0].qids, ['42']);
    const manifest = await readFile(join(out, 'resource-manifest.json'), 'utf8'); assert.doesNotMatch(manifest, /private|\.env|\.bak/);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('reviewed transformations fail closed after upstream changes', async () => {
  assert.throws(() => transform('safe-render.js', 'different upstream'), /Upstream changed/);
  assert.throws(() => transform('app-new.js', 'different upstream'), /Upstream changed/);
});
