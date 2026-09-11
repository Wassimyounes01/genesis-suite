'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeRoutingMetrics, MAX_ATTEMPTS } = require('../index.cjs');

const routes = { baselineRoute: 'astra-required', candidateRoute: 'worker-strategy' };
function attempt(overrides = {}) {
  return {
    attemptId: 'a1', runId: 'baseline', taskId: 'task-1', taskType: 'implementation',
    contractId: 'focused-tests', contractVersion: 'v1', route: routes.baselineRoute,
    sequence: 1, phase: 'initial', status: 'passed', historyComplete: true,
    latencyMs: 100, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, costUsd: 1 },
    ...overrides
  };
}
function candidate(overrides = {}) {
  return attempt({ attemptId: 'c1', runId: 'candidate', route: routes.candidateRoute, ...overrides });
}

test('includes failed attempts, retries, rework and overhead in passing paired totals', () => {
  const data = [
    attempt({ status: 'failed', latencyMs: 100, usage: { costUsd: 2 } }),
    attempt({ attemptId: 'a2', sequence: 2, phase: 'retry', status: 'passed', latencyMs: 200, usage: { costUsd: 3 } }),
    attempt({ attemptId: 'a3', sequence: 3, phase: 'rework', latencyMs: 50, usage: { costUsd: 1 } }),
    attempt({ attemptId: 'a4', sequence: 4, phase: 'overhead', latencyMs: 10, usage: { costUsd: 0.5 } }),
    candidate({ latencyMs: 180, usage: { costUsd: 3.25 } })
  ];
  const before = structuredClone(data);
  const result = analyzeRoutingMetrics(data, routes);
  const run = result.runs.find(value => value.runId === 'baseline');
  assert.equal(run.metrics.latencyMs.total, 360);
  assert.equal(run.metrics.costUsd.total, 6.5);
  assert.equal(run.attemptCount, 3);
  assert.equal(run.observationCount, 4);
  assert.equal(run.recordedFailedAttempts, 1);
  assert.deepEqual(run.recordedPhases, { initial: 1, retry: 1, rework: 1, overhead: 1 });
  assert.equal(result.comparison.metrics.costUsd.savingsPercent, 50);
  assert.equal(result.comparison.metrics.latencyMs.savingsPercent, 50);
  assert.equal(result.comparison.metrics.inputTokens.baseline, null);
  assert.equal(result.routingPolicyChanged, false);
  assert.deepEqual(data, before);
  assert.deepEqual(analyzeRoutingMetrics([...data].reverse(), routes), result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('keeps unknown usage null and separates observed subtotal from a complete total', () => {
  const result = analyzeRoutingMetrics([
    attempt({ usage: { costUsd: 2 } }),
    attempt({ attemptId: 'a2', sequence: 2, phase: 'retry', usage: null, latencyMs: null }),
    candidate({ usage: { costUsd: 1 } })
  ], routes);
  const run = result.runs[0];
  assert.deepEqual(run.metrics.costUsd, { total: null, observedTotal: 2, knownCount: 1, missingCount: 1 });
  assert.equal(run.metrics.totalTokens.total, null);
  assert.equal(run.metrics.totalTokens.observedTotal, null);
  assert.equal(result.comparison.metrics.costUsd.comparablePairCount, 0);
  assert.equal(result.comparison.metrics.costUsd.unknownPairCount, 1);
  assert.equal(result.comparison.metrics.costUsd.savingsPercent, null);
});

test('incomplete runtime history cannot claim attempt counts, full costs or comparisons', () => {
  const result = analyzeRoutingMetrics([
    attempt({ historyComplete: undefined, latencyMs: 500 }), candidate()
  ], routes);
  assert.equal(result.runs[0].historyComplete, false);
  assert.equal(result.runs[0].observationCount, 1);
  assert.equal(result.runs[0].attemptCount, null);
  assert.equal(result.runs[0].metrics.latencyMs.total, null);
  assert.equal(result.runs[0].metrics.latencyMs.observedTotal, 500);
  assert.equal(result.groups.find(group => group.route === routes.baselineRoute).attemptCount, null);
  assert.equal(result.comparison.excluded[0].reason, 'incomplete-history');
});

test('compares only exact task, type, contract and version pairs that both pass', () => {
  const cases = [
    { taskId: 'different-task' }, { taskType: 'review' },
    { contractId: 'different-contract' }, { contractVersion: 'v2' }
  ];
  for (const different of cases) {
    const result = analyzeRoutingMetrics([attempt(), candidate(different)], routes);
    assert.equal(result.comparison.pairs.length, 0);
    assert.equal(result.comparison.excluded.length, 2);
    assert.ok(result.comparison.excluded.every(item => item.reason === 'unpaired'));
    assert.equal(result.comparison.metrics.costUsd.savingsPercent, null);
  }
  const failed = analyzeRoutingMetrics([attempt(), candidate({ status: 'failed', usage: { costUsd: 0 } })], routes);
  assert.equal(failed.comparison.excluded[0].reason, 'nonpassing');
  assert.equal(failed.groups.find(group => group.route === routes.candidateRoute).failedRuns, 1);
  assert.equal(failed.comparison.metrics.costUsd.baseline, null);
});

test('rejects ambiguous paired repeats instead of selecting the cheapest or latest run', () => {
  const result = analyzeRoutingMetrics([
    attempt(), candidate(), candidate({ attemptId: 'c2', runId: 'candidate-repeat', usage: { costUsd: 0 } })
  ], routes);
  assert.equal(result.comparison.excluded[0].reason, 'ambiguous-runs');
  assert.equal(result.comparison.pairs.length, 0);
});

test('overhead cannot turn a failed quality result into a passing run', () => {
  const result = analyzeRoutingMetrics([
    attempt(), candidate({ status: 'failed' }),
    candidate({ attemptId: 'c2', sequence: 2, phase: 'overhead', status: 'passed' })
  ], routes);
  assert.equal(result.comparison.excluded[0].reason, 'nonpassing');
  assert.throws(() => analyzeRoutingMetrics([attempt({ phase: 'overhead' })]), /execution observation/);
});

test('rejects duplicate identities, missing attempts and inconsistent run identity', () => {
  assert.throws(() => analyzeRoutingMetrics([attempt(), attempt()]), /duplicate attemptId/);
  assert.throws(() => analyzeRoutingMetrics([attempt(), attempt({ attemptId: 'a2' })]), /unique and contiguous/);
  assert.throws(() => analyzeRoutingMetrics([attempt({ sequence: 2 })]), /unique and contiguous/);
  assert.throws(() => analyzeRoutingMetrics([attempt(), attempt({ attemptId: 'a2', sequence: 3 })]), /unique and contiguous/);
  assert.throws(() => analyzeRoutingMetrics([attempt(), attempt({ attemptId: 'a2', sequence: 2, route: 'other' })]), /inconsistent identity/);
  assert.throws(() => analyzeRoutingMetrics([attempt(), attempt({ attemptId: 'a2', sequence: 2, historyComplete: false })]), /inconsistent historyComplete/);
});

test('guards invalid numbers, invalid schemas, bounds and aggregate overflow', () => {
  for (const value of [-1, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => analyzeRoutingMetrics([attempt({ latencyMs: value })]), /latencyMs/);
    assert.throws(() => analyzeRoutingMetrics([attempt({ usage: { costUsd: value } })]), /costUsd/);
  }
  assert.throws(() => analyzeRoutingMetrics([attempt({ usage: { inputTokens: 0.5 } })]), /safe integer/);
  for (const overrides of [{ taskId: '' }, { phase: 'unknown' }, { status: 'pending' }, { sequence: 0 }, { usage: [] }, { historyComplete: 'true' }]) {
    assert.throws(() => analyzeRoutingMetrics([attempt(overrides)]), TypeError);
  }
  assert.throws(() => analyzeRoutingMetrics(new Array(MAX_ATTEMPTS + 1)), /at most/);
  assert.throws(() => analyzeRoutingMetrics([attempt(), candidate()], { baselineRoute: 'a' }), /required together/);
  assert.throws(() => analyzeRoutingMetrics([], { baselineRoute: 'a', candidateRoute: 'a' }), /differ/);
  assert.throws(() => analyzeRoutingMetrics([
    attempt({ latencyMs: Number.MAX_SAFE_INTEGER }),
    attempt({ attemptId: 'a2', sequence: 2, latencyMs: 1 })
  ]), /aggregate exceeds/);
});

test('zero baselines and extreme ratios never produce infinity or invented savings', () => {
  for (const cost of [0, Number.MIN_VALUE]) {
    const report = analyzeRoutingMetrics([attempt({ usage: { costUsd: cost } }), candidate()], routes);
    assert.equal(report.comparison.metrics.costUsd.savingsPercent, null);
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  }
  assert.deepEqual(analyzeRoutingMetrics([]).runs, []);
  assert.equal(analyzeRoutingMetrics([]).comparison, null);
});

test('paired aggregate excludes unpaired and failed costs while groups retain them', () => {
  const result = analyzeRoutingMetrics([
    attempt({ usage: { costUsd: 10 } }), candidate({ usage: { costUsd: 5 } }),
    attempt({ attemptId: 'unpaired', runId: 'unpaired', taskId: 'other', usage: { costUsd: 1000 } }),
    attempt({ attemptId: 'bad-base', runId: 'bad-base', taskId: 'bad', usage: { costUsd: 20 } }),
    candidate({ attemptId: 'bad-candidate', runId: 'bad-candidate', taskId: 'bad', status: 'failed', usage: { costUsd: 0 } })
  ], routes);
  assert.equal(result.comparison.metrics.costUsd.baseline, 10);
  assert.equal(result.comparison.metrics.costUsd.candidate, 5);
  assert.equal(result.comparison.metrics.costUsd.comparablePairCount, 1);
  assert.equal(result.groups.find(group => group.route === routes.baselineRoute).metrics.costUsd.total, 1030);
});
