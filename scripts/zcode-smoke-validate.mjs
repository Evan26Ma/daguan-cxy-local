import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const entrypoints = fs.readFileSync('reports/entrypoints.md', 'utf8');
const checks = fs.readFileSync('reports/checks.md', 'utf8');
for (const value of [pkg.name, pkg.version, pkg.scripts.start, pkg.scripts['desktop:start']]) {
  assert.ok(entrypoints.includes(value), `Entrypoint report missing ${value}`);
}
for (const key of ['test', 'verify', 'package:desktop:windows']) {
  assert.ok(checks.includes(pkg.scripts[key]), `Check report missing scripts.${key}`);
}
assert.ok(entrypoints.includes('Source: package.json'));
assert.ok(checks.includes('Source: package.json'));
console.log('Two ZCode worker reports match package.json; final smoke validation passed.');
