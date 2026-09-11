'use strict';

// Original, portable analysis of supplied observations. No IO or route selection.
const MAX_ATTEMPTS = 10000;
const METRICS = ['latencyMs', 'inputTokens', 'outputTokens', 'totalTokens', 'costUsd'];
const IDENTITY = ['taskId', 'taskType', 'contractId', 'contractVersion', 'route'];
const PHASES = ['initial', 'retry', 'rework', 'overhead'];
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 256 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be a nonempty, trimmed identifier (at most 256 characters)`);
  }
  return value;
}

function measurement(value, label, integer = false) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} must be a nonnegative ${integer ? 'safe integer' : 'finite number'} or null`);
  }
  return value;
}

function safeSum(values, label) {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`${label} aggregate exceeds the safe numeric range`);
    }
  }
  return total;
}

function summarizeMeasurements(attempts) {
  return Object.fromEntries(METRICS.map(name => {
    const known = attempts.map(attempt => attempt.metrics[name]).filter(value => value !== null);
    const observedTotal = known.length ? safeSum(known, name) : null;
    return [name, {
      total: attempts.length && attempts.every(attempt => attempt.historyComplete) && known.length === attempts.length ? observedTotal : null,
      observedTotal,
      knownCount: known.length,
      missingCount: attempts.length - known.length
    }];
  }));
}

function normalizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length > MAX_ATTEMPTS) {
    throw new TypeError(`attempts must be an array of at most ${MAX_ATTEMPTS} observations`);
  }
  const seen = new Set();
  return attempts.map((input, index) => {
    record(input, `attempts[${index}]`);
    const attempt = {};
    for (const name of ['attemptId', 'runId', ...IDENTITY]) {
      attempt[name] = identifier(input[name], `attempts[${index}].${name}`);
    }
    if (seen.has(attempt.attemptId)) throw new TypeError(`duplicate attemptId: ${attempt.attemptId}`);
    seen.add(attempt.attemptId);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || input.sequence > MAX_ATTEMPTS) {
      throw new TypeError('sequence must be a positive bounded integer');
    }
    if (!['passed', 'failed'].includes(input.status)) throw new TypeError('status must be passed or failed');
    if (!PHASES.includes(input.phase)) throw new TypeError(`phase must be one of ${PHASES.join(', ')}`);
    attempt.sequence = input.sequence;
    attempt.status = input.status;
    attempt.phase = input.phase;
    if (input.historyComplete !== undefined && typeof input.historyComplete !== 'boolean') {
      throw new TypeError('historyComplete must be a boolean when supplied');
    }
    attempt.historyComplete = input.historyComplete === true;
    const usage = input.usage === undefined || input.usage === null ? {} : input.usage;
    record(usage, 'usage');
    attempt.metrics = { latencyMs: measurement(input.latencyMs, 'latencyMs') };
    for (const name of METRICS.slice(1)) {
      attempt.metrics[name] = measurement(usage[name], `usage.${name}`, name.endsWith('Tokens'));
    }
    return attempt;
  }).sort((a, b) => compareText(a.runId, b.runId) || a.sequence - b.sequence);
}

function summarizeRun(attempts) {
  const first = attempts[0];
  const executionAttempts = attempts.filter(attempt => attempt.phase !== 'overhead');
  if (!executionAttempts.length) throw new TypeError(`run ${first.runId} needs an execution observation`);
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (IDENTITY.some(name => attempt[name] !== first[name])) {
      throw new TypeError(`inconsistent identity in run: ${first.runId}`);
    }
    if (attempt.historyComplete !== first.historyComplete) throw new TypeError(`inconsistent historyComplete in run: ${first.runId}`);
    // Reject gaps and repeated positions: omitting a retry must not look cheaper.
    if (attempt.sequence !== index + 1) {
      throw new TypeError(`run ${first.runId} sequences must be unique and contiguous from 1`);
    }
  }
  return {
    runId: first.runId,
    ...Object.fromEntries(IDENTITY.map(name => [name, first[name]])),
    status: executionAttempts[executionAttempts.length - 1].status,
    historyComplete: first.historyComplete,
    observationCount: attempts.length,
    attemptCount: first.historyComplete ? executionAttempts.length : null,
    recordedPassedAttempts: executionAttempts.filter(attempt => attempt.status === 'passed').length,
    recordedFailedAttempts: executionAttempts.filter(attempt => attempt.status === 'failed').length,
    recordedPhases: Object.fromEntries(PHASES.map(phase => [phase, attempts.filter(attempt => attempt.phase === phase).length])),
    metrics: summarizeMeasurements(attempts)
  };
}

function difference(baseline, candidate) {
  if (baseline === null || candidate === null) {
    return { baseline, candidate, candidateMinusBaseline: null, savingsPercent: null };
  }
  const percent = baseline > 0 ? (1 - candidate / baseline) * 100 : null;
  return {
    baseline, candidate,
    candidateMinusBaseline: candidate - baseline,
    savingsPercent: Number.isFinite(percent) ? percent : null
  };
}

function comparePairedRuns(runs, baselineRoute, candidateRoute) {
  const pairFields = ['taskId', 'taskType', 'contractId', 'contractVersion'];
  const candidates = new Map();
  for (const run of runs) {
    if (![baselineRoute, candidateRoute].includes(run.route)) continue;
    const key = JSON.stringify(pairFields.map(name => run[name]));
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(run);
  }
  const pairs = [];
  const excluded = [];
  for (const [key, matches] of [...candidates].sort((a, b) => compareText(a[0], b[0]))) {
    const identity = Object.fromEntries(pairFields.map((name, index) => [name, JSON.parse(key)[index]]));
    const baseline = matches.filter(run => run.route === baselineRoute);
    const candidate = matches.filter(run => run.route === candidateRoute);
    let reason = null;
    if (!baseline.length || !candidate.length) reason = 'unpaired';
    else if (baseline.length !== 1 || candidate.length !== 1) reason = 'ambiguous-runs';
    else if (baseline[0].status !== 'passed' || candidate[0].status !== 'passed') reason = 'nonpassing';
    else if (!baseline[0].historyComplete || !candidate[0].historyComplete) reason = 'incomplete-history';
    if (reason) {
      excluded.push({ ...identity, reason, runIds: matches.map(run => run.runId).sort(compareText) });
      continue;
    }
    pairs.push({
      ...identity,
      baselineRunId: baseline[0].runId,
      candidateRunId: candidate[0].runId,
      metrics: Object.fromEntries(METRICS.map(name => [name,
        difference(baseline[0].metrics[name].total, candidate[0].metrics[name].total)
      ]))
    });
  }
  const metrics = Object.fromEntries(METRICS.map(name => {
    const measured = pairs.filter(pair => pair.metrics[name].baseline !== null && pair.metrics[name].candidate !== null);
    return [name, {
      comparablePairCount: measured.length,
      unknownPairCount: pairs.length - measured.length,
      ...difference(
        measured.length ? safeSum(measured.map(pair => pair.metrics[name].baseline), name) : null,
        measured.length ? safeSum(measured.map(pair => pair.metrics[name].candidate), name) : null
      )
    }];
  }));
  return { baselineRoute, candidateRoute, pairedPassingRuns: pairs.length, pairs, excluded, metrics };
}

/**
 * Analyze explicitly supplied attempt records (no mutation or inferred usage).
 * Each record requires attemptId, runId, taskId, taskType, contractId,
 * contractVersion, route, sequence (contiguous from 1), phase, and status.
 * phase: initial|retry|rework|overhead; status: passed|failed against the contract.
 * latencyMs and usage.{inputTokens,outputTokens,totalTokens,costUsd} may be null.
 * historyComplete must explicitly be true on every observation in a run before
 * total metrics, attempt counts or comparisons are available. Default: false.
 * Include all retries, rework and coordinator overhead as separate observations.
 * A run uses one route/strategy label; its last non-overhead observation supplies
 * its outcome. Overhead contributes metrics but cannot make a failing run pass.
 * Optional baselineRoute and candidateRoute enable exact task/contract pairing.
 * Results describe supplied evidence; required planner/reviewer routes stay external.
 */
function analyzeRoutingMetrics(input, options = {}) {
  record(options, 'options');
  const hasBaseline = options.baselineRoute !== undefined;
  const hasCandidate = options.candidateRoute !== undefined;
  if (hasBaseline !== hasCandidate) throw new TypeError('baselineRoute and candidateRoute are required together');
  if (hasBaseline) {
    identifier(options.baselineRoute, 'baselineRoute');
    identifier(options.candidateRoute, 'candidateRoute');
    if (options.baselineRoute === options.candidateRoute) throw new TypeError('comparison routes must differ');
  }
  const attempts = normalizeAttempts(input);
  const attemptsByRun = new Map();
  for (const attempt of attempts) {
    if (!attemptsByRun.has(attempt.runId)) attemptsByRun.set(attempt.runId, []);
    attemptsByRun.get(attempt.runId).push(attempt);
  }
  const runs = [...attemptsByRun.values()].map(summarizeRun);
  const byGroup = new Map();
  for (const attempt of attempts) {
    const key = JSON.stringify([attempt.taskType, attempt.route]);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(attempt);
  }
  const runsByGroup = new Map();
  for (const run of runs) {
    const key = JSON.stringify([run.taskType, run.route]);
    if (!runsByGroup.has(key)) runsByGroup.set(key, []);
    runsByGroup.get(key).push(run);
  }
  const groups = [...byGroup].sort((a, b) => compareText(a[0], b[0])).map(([key, observations]) => {
    const groupRuns = runsByGroup.get(key);
    return {
      taskType: observations[0].taskType, route: observations[0].route,
      runCount: groupRuns.length, observationCount: observations.length,
      historyComplete: groupRuns.every(run => run.historyComplete),
      attemptCount: groupRuns.every(run => run.historyComplete) ? observations.filter(attempt => attempt.phase !== 'overhead').length : null,
      successfulRuns: groupRuns.filter(run => run.status === 'passed').length,
      failedRuns: groupRuns.filter(run => run.status === 'failed').length,
      recordedPassedAttempts: observations.filter(attempt => attempt.phase !== 'overhead' && attempt.status === 'passed').length,
      recordedFailedAttempts: observations.filter(attempt => attempt.phase !== 'overhead' && attempt.status === 'failed').length,
      metrics: summarizeMeasurements(observations)
    };
  });
  return {
    schemaVersion: 1,
    observationCount: attempts.length,
    runs, groups,
    comparison: hasBaseline ? comparePairedRuns(runs, options.baselineRoute, options.candidateRoute) : null,
    routingPolicyChanged: false
  };
}

module.exports = { analyzeRoutingMetrics, MAX_ATTEMPTS };
