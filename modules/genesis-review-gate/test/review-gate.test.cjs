'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewArtifact, validateReviewResult } = require('../index.cjs');
const finding = { id: 'missing-check', severity: 'high', title: 'Missing check', description: 'A check is absent', evidence: 'line 3' };
const adapter = (refute = () => ({ status: 'refuted', reason: 'The check is covered by the validated contract.' })) => ({
  find: async () => ({ provider: { name: 'fixture', model: 'fixture-1' }, findings: [finding] }),
  refute: async ({ finding: item }) => refute(item),
});

test('accepts a fully refuted bounded review', async () => {
  const result = await reviewArtifact({ artifactId: 'fixture-1', artifact: { code: 'ok' } }, adapter());
  assert.equal(result.status, 'complete');
  assert.equal(result.findings[0].refutation.status, 'refuted');
  assert.equal(validateReviewResult(result), null);
});
test('keeps provider failure incomplete', async () => {
  const result = await reviewArtifact({ artifact: 'x' }, { find: async () => { throw new Error('provider offline'); }, refute() {} });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'provider');
});
test('keeps partial or unresolved findings incomplete', async () => {
  const result = await reviewArtifact({ artifact: 'x' }, adapter(() => ({ status: 'unresolved', reason: '' })));
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'partial'); assert.equal(result.findings.length, 1); assert.equal(result.findings[0].refutation, null);
});
test('rejects unknown keys in the complete result schema', () => {
  assert.match(validateReviewResult({ status: 'complete', artifactId: 'a', findings: [], provider: { name: 'x', model: 'y' }, errors: [], extra: true }), /unknown/);
  assert.match(validateReviewResult({ status: 'complete', artifactId: 'a', findings: [], provider: { name: null, model: null }, errors: [] }), /provider/);
});
test('enforces one shared overall deadline', async () => {
  const result = await reviewArtifact({ artifact: 'x' }, { find: async () => ({ provider: { name: 'fixture', model: 'fixture-1' }, findings: [finding] }), refute: async () => new Promise(resolve => setTimeout(() => resolve({ status: 'refuted', reason: 'late' }), 50)) }, { deadlineMs: 5 });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'timeout');
});
test('oversized artifact is incomplete', async () => {
  const result = await reviewArtifact({ artifact: 'x'.repeat(100) }, adapter(), { maxInputBytes: 10 });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'oversized');
});
test('malformed finder output is partial and never reported complete', async () => {
  const result = await reviewArtifact({ artifact: 'x' }, { find: async () => ({ provider: { name: 'fixture', model: 'fixture-1', extra: true }, findings: [] }), refute: async () => ({ status: 'refuted', reason: 'unused' }) });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'partial');
});
test('null finder output is a bounded partial error', async () => {
  const result = await reviewArtifact({ artifact: 'x' }, { find: async () => null, refute: async () => ({ status: 'refuted', reason: 'unused' }) });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'partial');
});
test('deadline aborts the injected adapter signal', async () => {
  let signal;
  const result = await reviewArtifact({ artifact: 'x' }, { find: async args => { signal = args.signal; return new Promise(() => {}); }, refute: async () => ({ status: 'refuted', reason: 'unused' }) }, { deadlineMs: 5 });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'timeout'); assert.equal(signal.aborted, true);
});
test('pre-aborted caller signal prevents any adapter invocation', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const result = await reviewArtifact({ artifact: 'x' }, { find: async () => { calls++; return { provider: { name: 'x', model: 'y' }, findings: [] }; }, refute: async () => { calls++; return { status: 'refuted', reason: 'unused' }; } }, { signal: controller.signal });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'aborted'); assert.equal(calls, 0);
});
test('caller abort propagates to the provider and cleans up', async () => {
  const controller = new AbortController(); let observed;
  const promise = reviewArtifact({ artifact: 'x' }, { find: async ({ signal }) => { observed = signal; return new Promise(() => {}); }, refute: async () => ({ status: 'refuted', reason: 'unused' }) }, { signal: controller.signal, deadlineMs: 1000 });
  setTimeout(() => controller.abort(), 5);
  const result = await promise;
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'aborted'); assert.equal(observed.aborted, true);
});
test('synchronous abort inside finder cannot become a complete review', async () => {
  const controller = new AbortController(); let refutations = 0;
  const result = await reviewArtifact({ artifact: 'x' }, { find: ({ }) => { controller.abort(); return { provider: { name: 'fixture', model: 'fixture-1' }, findings: [] }; }, refute: async () => { refutations++; return { status: 'refuted', reason: 'unused' }; } }, { signal: controller.signal });
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'aborted'); assert.equal(refutations, 0);
});
test('synchronous abort with rejected finder promise does not emit unhandled rejection', async () => {
  const controller = new AbortController(); let unhandled = false;
  const handler = () => { unhandled = true; };
  process.on('unhandledRejection', handler);
  const result = await reviewArtifact({ artifact: 'x' }, { find: () => { controller.abort(); return Promise.reject(new Error('adapter aborted')); }, refute: async () => ({ status: 'refuted', reason: 'unused' }) }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  process.removeListener('unhandledRejection', handler);
  assert.equal(result.status, 'incomplete'); assert.equal(result.errors[0].code, 'aborted'); assert.equal(unhandled, false);
});
