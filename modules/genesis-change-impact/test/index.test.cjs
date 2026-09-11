'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeChangeImpact, normalizeRepoPath, MAX_ENTRIES, MAX_EDGES } = require('../index.cjs');

const entry = (path, kind = 'file', dependsOn = [], extra = {}) => ({ path, kind, dependsOn, ...extra });
const manifest = entries => ({ schemaVersion: 1, entries });
const now = '2026-09-11T12:00:00.000Z';

test('finds transitive consumers, tests, docs and downloads through an explicit manifest', () => {
  const graph = manifest([
    entry('lib/core.cjs'), entry('app/main.cjs', 'consumer', ['lib/core.cjs']),
    entry('test/main.test.cjs', 'test', ['app/main.cjs']),
    entry('docs/api.md', 'doc', ['lib/core.cjs']),
    entry('downloads/tool.zip', 'download', ['app/main.cjs', 'docs/api.md']),
    entry('unrelated.cjs')
  ]);
  const before = structuredClone(graph);
  const result = analyzeChangeImpact(graph, ['lib\\core.cjs', './lib/core.cjs']);
  assert.deepEqual(result.changedPaths, ['lib/core.cjs']);
  assert.deepEqual(result.affected.consumer, ['app/main.cjs']);
  assert.deepEqual(result.affected.test, ['test/main.test.cjs']);
  assert.deepEqual(result.affected.doc, ['docs/api.md']);
  assert.deepEqual(result.affected.download, ['downloads/tool.zip']);
  assert.deepEqual(result.impacted.find(item => item.path === 'test/main.test.cjs'), {
    path: 'test/main.test.cjs', kind: 'test', distance: 2, via: 'app/main.cjs'
  });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.scope, 'explicit-manifest-only');
  assert.deepEqual(graph, before);
  assert.deepEqual(analyzeChangeImpact(manifest([...graph.entries].reverse()), ['lib/core.cjs']), result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('cycles and self references terminate with one result per entry', () => {
  const result = analyzeChangeImpact(manifest([
    entry('a', 'file', ['c']), entry('b', 'consumer', ['a']),
    entry('c', 'test', ['b', 'c']), entry('d', 'download', ['c'])
  ]), ['a']);
  assert.deepEqual(result.impacted.map(item => item.path), ['a', 'b', 'c', 'd']);
  assert.deepEqual(result.impacted.map(item => item.distance), [0, 1, 2, 3]);
});

test('only traverses reverse dependencies and makes unmatched changes explicit', () => {
  const graph = manifest([entry('a'), entry('b', 'test', ['a'])]);
  const result = analyzeChangeImpact(graph, ['b', 'missing.cjs', 'A']);
  assert.deepEqual(result.impacted.map(item => item.path), ['b']);
  assert.deepEqual(result.gaps, [
    { type: 'unmatched-change', path: 'A' }, { type: 'unmatched-change', path: 'missing.cjs' }
  ]);
  assert.equal(result.coverageComplete, false);
  assert.deepEqual(analyzeChangeImpact(graph, []).impacted, []);
});

test('normalizes only exact relative paths and rejects traversal and absolutes', () => {
  assert.equal(normalizeRepoPath('.\\lib//core.cjs'), 'lib/core.cjs');
  for (const path of ['../a', 'a/../b', 'a\\..\\b', '/tmp/a', '\\root\\a', '\\\\server\\a', 'C:\\a', 'C:a',
    '.', './', '', 'a/', 'a\\', 'file:*', 'a\0b', ' a', 'a ', 'src/*.cjs']) {
    assert.throws(() => normalizeRepoPath(path), TypeError, path);
  }
  assert.throws(() => analyzeChangeImpact(manifest([entry('a')]), ['../a']), /traversal/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', ['C:\\x'])]), ['a']), TypeError);
});

test('rejects duplicate normalized entries and dependencies, missing nodes and bad kinds', () => {
  assert.throws(() => analyzeChangeImpact(manifest([entry('a'), entry('./a')]), []), /duplicate normalized entry/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a'), entry('b', 'test', ['a', './a'])]), []), /duplicate normalized dependency/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', ['missing'])]), []), /undeclared dependency/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'wildcard')]), []), /entry.kind/);
  assert.throws(() => analyzeChangeImpact({ schemaVersion: 2, entries: [] }, []), /schemaVersion/);
  assert.throws(() => analyzeChangeImpact(manifest([{ path: 'a', kind: 'file' }]), []), /explicit array/);
});

test('detects expired and mismatched evidence, with unknown verification kept explicit', () => {
  const digest = 'a'.repeat(64);
  const graph = manifest([
    entry('source'),
    entry('expired', 'test', ['source'], { evidence: { expiresAt: now } }),
    entry('changed', 'doc', ['source'], { sha256: 'b'.repeat(64), evidence: { artifactSha256: digest } }),
    entry('unchecked', 'download', ['source'], { evidence: { artifactSha256: digest } }),
    entry('fresh', 'test', ['source'], { sha256: digest.toUpperCase(), evidence: { artifactSha256: digest, expiresAt: '2026-09-12T00:00:00Z' } }),
    entry('outside', 'test', [], { evidence: { expiresAt: '2020-01-01T00:00:00Z' } })
  ]);
  assert.deepEqual(analyzeChangeImpact(graph, ['source'], { now }).gaps, [
    { type: 'evidence-hash-mismatch', path: 'changed' },
    { type: 'evidence-expired', path: 'expired', expiresAt: now },
    { type: 'evidence-hash-unchecked', path: 'unchecked' }
  ]);
  const withoutClock = analyzeChangeImpact(graph, ['fresh']);
  assert.deepEqual(withoutClock.gaps, [{ type: 'evidence-expiry-unchecked', path: 'fresh', expiresAt: '2026-09-12T00:00:00Z' }]);
  assert.equal(analyzeChangeImpact(graph, ['fresh'], { now }).coverageComplete, true);
});

test('rejects invalid timestamps, hashes and unbounded manifests', () => {
  for (const expiresAt of ['2026-02-31T12:00:00Z', 'yesterday', '2026-09-11', '2026-09-11T25:00:00Z']) {
    assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', [], { evidence: { expiresAt } })]), []), /timestamp/);
  }
  assert.throws(() => analyzeChangeImpact(manifest([entry('a')]), [], { now: Date.now() }), /ISO UTC/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', [], { sha256: 'bad' })]), []), /SHA-256/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', [], { evidence: {} })]), []), /requires/);
  assert.throws(() => analyzeChangeImpact(manifest(new Array(MAX_ENTRIES + 1)), []), /at most/);
  assert.throws(() => analyzeChangeImpact(manifest([]), new Array(MAX_ENTRIES + 1)), /at most/);
  assert.throws(() => analyzeChangeImpact(manifest([entry('a', 'file', new Array(MAX_EDGES + 1).fill('a'))]), []), /edges/);
});

test('handles deep chains without recursion and gives deterministic shortest explanations', () => {
  const entries = Array.from({ length: 6000 }, (_, index) => entry(`node-${index}`, 'file', index ? [`node-${index - 1}`] : []));
  const result = analyzeChangeImpact(manifest(entries), ['node-0', 'node-3000']);
  assert.equal(result.impacted.length, 6000);
  assert.equal(result.impacted.find(item => item.path === 'node-5999').distance, 2999);
  assert.deepEqual(analyzeChangeImpact(manifest([...entries].reverse()), ['node-3000', 'node-0']), result);
});
