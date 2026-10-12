#!/usr/bin/env node
// Source files remain untouched. Xcode: node "$SRCROOT/scripts/prepare-web.mjs".
import { access, mkdir, readFile, readdir, lstat, copyFile, writeFile, realpath, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeData = ['manifest.json', 'categories.json', 'category_questions.json', 'id_index.json', 'search_index.json', 'explanations-v2.json', 'lecture-video-mappings.json', 'paradiyu-linear-video.json'];
const forbidden = /(?:\.bak|(?:^|\/)(?:\.git|\.env[^/]*|private|dev|test|node_modules|local_question_banks)(?:\/|$))/i;
const assetExtensions = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i;
function safePath(value) {
  if (!value || isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '..' || part === '.') || forbidden.test(value)) throw new Error(`Unsafe resource path: ${value}`);
  return value;
}
function replaceOnce(text, before, after, label) {
  if (text.split(before).length !== 2) throw new Error(`Upstream changed: ${label}`);
  return text.replace(before, after);
}
export function transform(file, text) {
  if (file === 'index.html') {
    text = replaceOnce(text, '<html lang="zh-CN" data-app-version="new">', '<html lang="zh-CN" data-app-version="new" data-platform="ios">', 'platform root');
    text = replaceOnce(text, '  <script src="./ui-version.js?v=106"></script>', '  <link rel="stylesheet" href="./ios/platform.css" />\n  <script src="./ui-version.js?v=106"></script>', 'platform CSS');
    // These desktop bootstrap modules are not reachable on iPad.
    text = text.replace(/^.*(?:desktop-storage\.(?:js|css)|browser-retirement\.(?:js|css)|remote-access\.js|data-bank-client\.js|manifest\.webmanifest).*\r?\n/gm, '');
  }
  if (file === 'ui-bootstrap.js') {
    text = replaceOnce(text, '  clearCachesIfRequested();', '  // iOS has no Service Worker and always starts the supported new interface.', 'disable cache purge');
    text = replaceOnce(text, '    const requestedUi = params.get("ui");', '    const requestedUi = "new";', 'new UI only');
  }
  if (file === 'safe-render.js') {
    // A narrow protocol exception: the existing hook still rejects SVG external refs,
    // actions and foreign hosts. DOMPurify's URI default rejects custom schemes.
    text = replaceOnce(text, "        ALLOW_UNKNOWN_PROTOCOLS: false,", "        ALLOW_UNKNOWN_PROTOCOLS: false,\n        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|daguan:\\/\\/app\\/|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,", 'allow same-host daguan assets');
    text = replaceOnce(text, "          if (local || /^data:image", "          if ((local && (url.protocol !== 'daguan:' || root.DaguanIOS.isAssetURL(mapped))) || /^data:image", 'daguan asset hook');
  }
  if (file === 'app-new.js') {
    text = replaceOnce(text, 'if ("serviceWorker" in navigator && location.protocol !== "file:" && location.protocol !== "https:") {', 'if (false) { // iOS bundle resources are served by WKURLSchemeHandler', 'disable Service Worker');
    text = replaceOnce(text, '    static downloadMigrationBackup() {', '    static async downloadMigrationBackup() {', 'migration async export');
    const migrationStart = text.indexOf('        const url = URL.createObjectURL(blob);', text.indexOf('static async downloadMigrationBackup()'));
    const migrationEnd = text.indexOf("        const checkbox = document.getElementById('migration-backup-saved');", migrationStart);
    if (migrationStart < 0 || migrationEnd < 0) throw new Error('Upstream changed: migration Blob export');
    text = text.slice(0, migrationStart) + "        const date = new Date().toISOString().slice(0, 10);\n        const anchor = { download: `daguan-before-migration-${date}.json` };\n        try { await window.DaguanIOS.exportBlob(blob, anchor.download); }\n        catch { App.setToolStatus('分享未打开，请重试；当前记录未改动。', 'error'); return; }\n" + text.slice(migrationEnd);
    text = replaceOnce(text, '已生成当前记录备份：${anchor.download}。确认文件已保存后再继续。', '已打开当前记录备份分享：${anchor.download}。请在系统界面保存到“文件”，确认后再继续。', 'migration save wording');
    const start = text.indexOf('        const url = URL.createObjectURL(blob);', text.indexOf('static async downloadBackup()'));
    const end = text.indexOf('\n    }', start);
    if (start < 0 || end < 0) throw new Error('Upstream changed: backup Blob export');
    text = text.slice(0, start) + "        try {\n            await window.DaguanIOS.exportBlob(blob, `daguan-progress-${dateStr}.json`);\n            this.setToolStatus('已打开备份分享，请选择保存到“文件”。', 'success');\n        } catch { this.setToolStatus('备份分享未打开，请重试。', 'error'); }" + text.slice(end);
    text = replaceOnce(text, '    static async refreshHomeSyncStatus() {', '    static async refreshHomeSyncStatus() {\n        return; // Official sync is unavailable on iPad.', 'no background official sync');
  }
  return text;
}

export async function prepareWeb({ source = join(project, 'web'), out = join(project, 'ios/Resources/Web'), bridgeSource = join(project, 'ios/Web'), replaceGenerated = false } = {}) {
  source = resolve(source); out = resolve(out); bridgeSource = resolve(bridgeSource);
  await mkdir(out, { recursive: true });
  const sourceReal = await realpath(source), outReal = await realpath(out);
  const relation = relative(sourceReal, outReal);
  const reverseRelation = relative(outReal, sourceReal);
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation)) || (!reverseRelation.startsWith('..') && !isAbsolute(reverseRelation))) throw new Error('Output must be separate from source web tree');
  const children = await readdir(out);
  if (children.length) {
    if (!replaceGenerated) throw new Error('Output must be empty; use --replace-generated only for owned generated resources');
    const manifestPath = join(out, 'resource-manifest.json');
    const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (previous.generator !== 'daguan-ios-prepare-web-v1' || !Array.isArray(previous.files)) throw new Error('Refusing to replace unowned output');
    // Check the entire tree before removing anything. Unknown files are never deleted.
    const known = new Set(['resource-manifest.json', ...previous.files.map(entry => safePath(entry.path))]);
    async function check(directory = '') {
      for (const item of await readdir(join(out, directory), { withFileTypes: true })) {
        const name = directory ? `${directory}/${item.name}` : item.name;
        if (item.isSymbolicLink()) throw new Error(`Refusing symlink in output: ${name}`);
        if (item.isDirectory()) await check(name);
        else if (!known.has(name)) throw new Error(`Refusing unknown output file: ${name}`);
      }
    }
    await check();
    for (const name of children) await rm(join(out, name), { recursive: true });
  }
  const files = new Set(['index.html', ...runtimeData.map(file => `data/${file}`)]);
  const transformed = new Set();
  const sourceTexts = new Map();
  async function readSource(file) {
    safePath(file);
    const absolute = join(source, file), stat = await lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Not an ordinary resource: ${file}`);
    return readFile(absolute);
  }
  const originalIndex = (await readSource('index.html')).toString('utf8');
  const index = transform('index.html', originalIndex); sourceTexts.set('index.html', index); transformed.add('index.html');
  for (const match of index.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"?#]+)[^"]*"/g)) {
    const name = match[1].replace(/^\.\//, '');
    if (name.startsWith('ios/')) continue;
    if (/^[a-z]+:/.test(name)) throw new Error(`External page dependency: ${name}`);
    files.add(safePath(name));
  }
  // Preserve product asset and font bytes, not backups, developer files or user banks.
  async function assets(directory) {
    for (const entry of (await readdir(join(source, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = directory + '/' + entry.name;
      if (forbidden.test(name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlink resource: ${name}`);
      if (entry.isDirectory()) await assets(name);
      else if (assetExtensions.test(entry.name)) files.add(safePath(name));
    }
  }
  await assets('assets'); await assets('data/assets'); await assets('vendor/fonts');
  files.add('vendor/DOMPurify-LICENSE');
  const dataManifest = JSON.parse((await readSource('data/manifest.json')).toString('utf8'));
  for (const metadata of Object.values(dataManifest.shards || {})) files.add(safePath('data/' + metadata.file));
  // Overlay retained for diagnostics and future native content parity, never private state.
  for (const name of ['native-solutions.json']) { await access(join(source, 'data', name)); files.add('data/' + name); }
  for (const file of [...files].filter(file => /\.(?:js|css|html)$/.test(file))) {
    if (file === 'index.html') continue;
    const text = (await readSource(file)).toString('utf8');
    const copy = transform(file, text); sourceTexts.set(file, copy);
    if (copy !== text) transformed.add(file);
    if (file.endsWith('.css')) for (const match of copy.matchAll(/url\(\s*["']?([^)'"\s]+)/g)) {
      if (match[1].startsWith('data:')) continue;
      const name = relative(source, resolve(dirname(join(source, file)), match[1].split(/[?#]/)[0])).replaceAll('\\', '/');
      files.add(safePath(name));
    }
  }
  const missing = new Map(), potential = new Map();
  const record = (map, path, qid, sourceFile, reference) => {
    let entry = map.get(path); if (!entry) { entry = { path, qids: new Set(), files: new Set(), references: new Set() }; map.set(path, entry); }
    if (qid != null) entry.qids.add(String(qid)); entry.files.add(sourceFile); entry.references.add(reference);
  };
  function inspect(value, qid, sourceFile) {
    if (typeof value === 'string') {
      const text = value.replaceAll('\\/', '/');
      for (const match of text.matchAll(/(?:assets\/|question-assets\/)([a-f0-9]{64})(?:\.(png|jpe?g|gif|webp|svg))?/gi)) {
        const path = `data/assets/${match[1]}.${(match[2] || 'png').toLowerCase().replace(/^jpg$/, 'jpeg')}`;
        if (!files.has(path)) record(missing, path, qid, sourceFile, match[0]);
      }
      for (const match of text.matchAll(/(?:https?:[^\s<>"')]*|(?:src\s*=\s*["'])([^"']+)|!\[[^\]]*\]\(([^)]+)\))/gi)) {
        const ref = match[1] || match[2] || match[0];
        if (/question-assets\/|(?:^|\/)assets\/[a-f0-9]{64}|^data:|bilibili\.com/i.test(ref)) continue;
        if (/\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)|missingimg/i.test(ref)) record(potential, ref, qid, sourceFile, ref);
      }
    } else if (Array.isArray(value)) value.forEach(item => inspect(item, item?.id ?? qid, sourceFile));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) inspect(item, /^\d+$/.test(key) ? key : value.id ?? qid, sourceFile);
  }
  for (const file of [...files].filter(name => name.endsWith('.json'))) inspect(JSON.parse((await readSource(file)).toString('utf8')), null, file);
  const serialize = map => [...map.values()].sort((a, b) => a.path < b.path ? -1 : 1).map(entry => ({ path: entry.path, qids: [...entry.qids].sort(), files: [...entry.files].sort(), references: [...entry.references].sort() }));
  const missingReport = { version: 1, completeOffline: missing.size === 0 && potential.size === 0, missingCount: missing.size, potentialCount: potential.size, missingAssets: serialize(missing), potentiallyUnresolvedReferences: serialize(potential), note: 'Bundled assets only. Missing images use assets/missing-image.svg. Potential references require review; no asset credentials were read or requested.' };
  const entries = [];
  for (const file of [...files].sort()) {
    const content = sourceTexts.has(file) ? Buffer.from(sourceTexts.get(file)) : await readSource(file);
    const target = join(out, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
    entries.push({ path: file, size: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  for (const name of ['bridge.js', 'platform.css']) {
    const stat = await lstat(join(bridgeSource, name)); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid bridge source');
    const content = await readFile(join(bridgeSource, name)); await mkdir(join(out, 'ios'), { recursive: true }); await copyFile(join(bridgeSource, name), join(out, 'ios', name));
    entries.push({ path: `ios/${name}`, size: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const reportBytes = Buffer.from(JSON.stringify(missingReport, null, 2) + '\n');
  await writeFile(join(out, 'missing-assets.json'), reportBytes);
  entries.push({ path: 'missing-assets.json', size: reportBytes.length, sha256: createHash('sha256').update(reportBytes).digest('hex') });
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest = { version: 1, generator: 'daguan-ios-prepare-web-v1', entry: 'index.html', origin: 'daguan://app', bridge: 'ios/bridge.js', bridgeInjection: 'document-start-after-kv-main-frame-only', transformed: [...transformed].sort(), files: entries, completeOffline: missingReport.completeOffline };
  await writeFile(join(out, 'resource-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { out, fileCount: entries.length, missingCount: missing.size, potentialCount: potential.size, transformed: manifest.transformed };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--replace-generated') { options.replaceGenerated = true; continue; }
    const key = { '--source': 'source', '--out': 'out', '--bridge-source': 'bridgeSource' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) throw new Error('Usage: prepare-web.mjs [--source web] [--out output] [--bridge-source ios/Web] [--replace-generated]');
    options[key] = process.argv[++i];
  }
  console.log(JSON.stringify(await prepareWeb(options), null, 2));
}
