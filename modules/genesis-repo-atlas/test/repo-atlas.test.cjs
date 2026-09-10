'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan, checkProvenance } = require('../index.cjs');

test('scan stays within explicit roots and skips symlink traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-atlas-test-'));
  fs.mkdirSync(path.join(root, 'child'));
  fs.writeFileSync(path.join(root, 'child', 'README.md'), 'fixture');
  try { fs.symlinkSync(path.join(root, 'child'), path.join(root, 'link'), 'junction'); } catch (_) { fs.symlinkSync(path.join(root, 'child'), path.join(root, 'link'), 'dir'); }
  const result = scan({ roots: [root], maxEntries: 20 });
  assert.equal(result.semanticCoverageClaim, false);
  assert.equal(result.coverage, 'bounded metadata census; no semantic-all-files claim');
  assert.equal(result.skippedSymlinks.length, 1);
  assert.equal(result.entries.some(item => item.path.includes('link/README.md')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bounded output truncates and output file must be contained', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-atlas-limit-'));
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(root, `file-${i}`), 'x');
  const output = path.join(root, 'atlas.jsonl');
  const result = scan({ roots: [root], maxEntries: 3, outputPath: output });
  assert.equal(result.truncated, true);
  assert.ok(fs.statSync(output).size > 0);
  assert.equal(fs.readFileSync(output, 'utf8').trim().split(/\r?\n/).length, 3);
  assert.throws(() => scan({ roots: [root], outputPath: path.join(os.tmpdir(), 'outside.jsonl') }), /contained/);
  assert.throws(() => scan({ roots: [root], maxEntries: NaN }), /finite integer/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('registry, pointer, and license provenance checks reject escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-atlas-provenance-'));
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ packages: [{ name: 'demo', path: 'package' }] }));
  fs.mkdirSync(path.join(root, 'package'));
  fs.writeFileSync(path.join(root, 'package', 'LICENSE'), 'MIT License');
  fs.writeFileSync(path.join(root, 'pointer.json'), JSON.stringify({ target: 'package' }));
  const valid = checkProvenance({ root, registryPath: 'registry.json', pointerPath: 'pointer.json', licenseFiles: ['package/LICENSE'] });
  assert.equal(valid.valid, true);
  const invalid = checkProvenance({ root, registryPath: 'registry.json', pointerPath: 'pointer.json', licenseFiles: ['../secret'] });
  assert.equal(invalid.valid, false);
  const missing = checkProvenance({ root, registryPath: 'missing.json', pointerPath: 'missing-pointer.json' });
  assert.equal(missing.valid, false);
  fs.writeFileSync(path.join(root, 'empty-registry.json'), '{}');
  assert.equal(checkProvenance({ root, registryPath: 'empty-registry.json' }).valid, false);
  fs.writeFileSync(path.join(root, 'missing-target-pointer.json'), JSON.stringify({ target: 'does-not-exist' }));
  assert.equal(checkProvenance({ root, pointerPath: 'missing-target-pointer.json' }).valid, false);
  fs.rmSync(root, { recursive: true, force: true });
});
