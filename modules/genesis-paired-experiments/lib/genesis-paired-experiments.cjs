'use strict';

// Original, deterministic experiment accounting. This validates supplied records;
// it does not authenticate a provider, run a model, grade work or award approval.
const crypto = require('node:crypto');
const { types } = require('node:util');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const SHA = /^[a-f0-9]{64}$/;
const VARIANTS = ['baseline', 'candidate'];

function plain(value, label) {
  if (types.isProxy(value) || !value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: plain object required`);
  return value;
}
function canonical(value, depth = 0) {
  if (types.isProxy(value)) throw new TypeError('JSON proxies are unsupported');
  if (depth > 12) throw new RangeError('JSON nesting limit exceeded');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (value.length > 24000) throw new RangeError('JSON string limit exceeded');
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000) throw new RangeError('ordinary bounded JSON array required');
    const values = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !own(descriptor, 'value')) throw new TypeError('dense JSON arrays without accessors required');
      values.push(canonical(descriptor.value, depth + 1));
    }
    return '[' + values.join(',') + ']';
  }
  plain(value, 'JSON');
  const keys = Object.keys(value).sort();
  if (keys.length > 100) throw new RangeError('JSON object limit exceeded');
  return '{' + keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) throw new TypeError('JSON accessors are unsupported');
    return JSON.stringify(key) + ':' + canonical(descriptor.value, depth + 1);
  }).join(',') + '}';
}
function hash(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function decode(serialized) {
  return JSON.parse(serialized, (_key,value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.assign(Object.create(null),value) : value);
}
function id(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value)) throw new TypeError(`${label}: invalid identifier`);
  return value;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`${label}: SHA-256 required`);
  return value;
}
function count(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError(`${label}: bounded nonnegative integer required`);
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError(`${label}: canonical UTC timestamp required`);
  return Date.parse(value);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label}: duplicates`);
}
function sum(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('aggregate exceeds safe integer range');
  return total;
}
function totalOrUnknown(values) { return values.length && values.every(v => v !== null) ? sum(values) : null; }

function preregisterExperiment(input) {
  plain(input, 'spec');
  // Clone immediately so later caller mutations cannot alter the registered spec.
  const serialized = canonical(input);
  if (serialized.length > 64000) throw new RangeError('experiment spec exceeds 64000 characters');
  const spec = decode(serialized);
  if (spec.schema !== 'genesis-paired-experiment-v1') throw new TypeError('unsupported experiment schema');
  id(spec.id, 'experiment id');
  timestamp(spec.createdAt, 'createdAt');
  plain(spec.worker, 'worker');
  id(spec.worker.route, 'worker route');
  id(spec.worker.requestedModel, 'requested model');
  plain(spec.worker.config, 'worker config');
  if (!['diagnostic', 'representative'].includes(spec.scope)) throw new TypeError('explicit experiment scope required');
  if (spec.qualityMetric === undefined) spec.qualityMetric = 'normalized-score';
  if (!['normalized-score','full-contract-pass-rate'].includes(spec.qualityMetric)) throw new TypeError('unsupported quality metric');
  if (!Array.isArray(spec.cases) || spec.cases.length < 2 || spec.cases.length > 50) throw new TypeError('2–50 cases required');
  for (const item of spec.cases) {
    plain(item, 'case');
    id(item.id, 'case id');
    if (!['training', 'holdout'].includes(item.split)) throw new TypeError('explicit case split required');
    sha(item.contractSha256, 'contract hash');
    sha(item.sourceSha256, 'source hash');
    sha(item.rubricSha256, 'rubric hash');
    plain(item.promptSha256, 'prompt hashes');
    VARIANTS.forEach(variant => sha(item.promptSha256[variant], 'prompt hash'));
    if (count(item.maxScore, 'maxScore', 1000) === 0) throw new TypeError('maxScore must be positive');
  }
  unique(spec.cases.map(item => item.id), 'case ids');
  if (!spec.cases.some(item => item.split === 'holdout')) throw new TypeError('a holdout case is required');
  if (count(spec.maxAttemptsPerRun, 'attempt limit', 5) === 0) throw new TypeError('attempt limit must be positive');
  plain(spec.targets, 'targets');
  if (typeof spec.targets.qualityMultiplier !== 'number' || !Number.isFinite(spec.targets.qualityMultiplier) || spec.targets.qualityMultiplier < 1 || spec.targets.qualityMultiplier > 10) throw new TypeError('quality target must be between 1 and 10');
  if (typeof spec.targets.tokenReduction !== 'number' || !Number.isFinite(spec.targets.tokenReduction) || spec.targets.tokenReduction < 0 || spec.targets.tokenReduction >= 1) throw new TypeError('token reduction must be between 0 and 1');
  return { schema: 'genesis-experiment-registration-v1', spec, sha256: hash(spec) };
}

function normalizeCodexUsage(raw) {
  if (raw === null || raw === undefined) return { inputTokens: null, cachedInputTokens: null, outputTokens: null, totalTokens: null, costUsd: null };
  raw = decode(canonical(raw));
  plain(raw, 'provider usage');
  const inputTokens = own(raw, 'input_tokens') ? count(raw.input_tokens, 'input tokens') : null;
  const outputTokens = own(raw, 'output_tokens') ? count(raw.output_tokens, 'output tokens') : null;
  const cachedInputTokens = own(raw, 'cached_input_tokens') ? count(raw.cached_input_tokens, 'cached input tokens') : null;
  if (cachedInputTokens !== null && inputTokens !== null && cachedInputTokens > inputTokens) throw new TypeError('cached tokens exceed input tokens');
  return { inputTokens, cachedInputTokens, outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? sum([inputTokens, outputTokens]) : null,
    costUsd: null };
}

function analyzeExperiment(input) {
  const serialized = canonical(input);
  if (serialized.length > 2000000) throw new RangeError('experiment observations exceed bound');
  const { registration, runs, grades, overheadTokens = null } = decode(serialized);
  plain(registration, 'registration');
  if (registration.schema !== 'genesis-experiment-registration-v1') throw new TypeError('unsupported registration');
  const checked = preregisterExperiment(registration.spec);
  if (registration.sha256 !== checked.sha256) throw new TypeError('registered spec changed');
  const spec = checked.spec;
  if (!Array.isArray(runs) || runs.length > spec.cases.length * 2 || !Array.isArray(grades) || grades.length > runs.length) throw new TypeError('bounded runs and grades required');
  if (overheadTokens !== null) {
    plain(overheadTokens, 'overhead tokens');
    VARIANTS.forEach(variant => count(overheadTokens[variant], 'overhead token total'));
  }
  const cases = new Map(spec.cases.map(item => [item.id, item]));
  const runMap = new Map();
  const warnings = new Set(['Supplied records are not authenticated execution or review evidence.', 'Results apply to this experiment; they do not establish general task quality or monetary savings.']);
  for (const run of runs) {
    plain(run, 'run');
    const item = cases.get(run.caseId);
    if (!item || !VARIANTS.includes(run.variant)) throw new TypeError('unknown case or variant');
    const key = `${run.caseId}:${run.variant}`;
    if (runMap.has(key)) throw new TypeError('duplicate paired run');
    if (run.registrationSha256 !== registration.sha256 || run.promptSha256 !== item.promptSha256[run.variant] || run.sourceSha256 !== item.sourceSha256 || hash(run.worker) !== hash(spec.worker)) throw new TypeError('run contract, prompt, source or requested worker mismatch');
    if (timestamp(run.startedAt, 'run start') <= Date.parse(spec.createdAt)) throw new TypeError('run must start after preregistration');
    if (!Array.isArray(run.attempts) || !run.attempts.length || run.attempts.length > spec.maxAttemptsPerRun) throw new TypeError('invalid attempt history');
    if (typeof run.historyComplete !== 'boolean') throw new TypeError('explicit history completeness required');
    const tokens = [], latencies = [];
    const actualModels = [];
    for (let index = 0; index < run.attempts.length; index++) {
      const attempt = run.attempts[index];
      plain(attempt, 'attempt');
      if (attempt.sequence !== index + 1) throw new TypeError('attempt sequences must be contiguous from 1');
      if (!['passed', 'failed'].includes(attempt.status)) throw new TypeError('invalid execution status');
      if (index < run.attempts.length - 1 && attempt.status === 'passed') throw new TypeError('no unregistered retries after success');
      if (attempt.actualModel !== null) id(attempt.actualModel, 'actual model');
      actualModels.push(attempt.actualModel);
      const usage = normalizeCodexUsage(attempt.usage);
      if (attempt.usageComplete !== undefined && typeof attempt.usageComplete !== 'boolean') throw new TypeError('usageComplete must be boolean when supplied');
      tokens.push(attempt.usageComplete === false ? null : usage.totalTokens);
      latencies.push(attempt.elapsedMs === null ? null : count(attempt.elapsedMs, 'elapsedMs'));
      if (attempt.status === 'passed') sha(attempt.outputSha256, 'output hash');
    }
    if (actualModels.includes(null)) warnings.add('Actual provider model identity is unknown for at least one attempt; only the requested route and configuration are matched.');
    runMap.set(key, { run, last: run.attempts.at(-1), totalTokens: run.historyComplete ? totalOrUnknown(tokens) : null,
      observedTokens: totalOrUnknown(tokens), elapsedMs: run.historyComplete ? totalOrUnknown(latencies) : null,
      actualModels, score: null });
  }
  const gradeKeys = new Set();
  for (const grade of grades) {
    plain(grade, 'grade');
    const key = `${grade.caseId}:${grade.variant}`;
    const observation = runMap.get(key);
    const item = cases.get(grade.caseId);
    if (!observation || gradeKeys.has(key)) throw new TypeError('grade without unique run');
    gradeKeys.add(key);
    if (grade.rubricSha256 !== item.rubricSha256 || grade.registrationSha256 !== registration.sha256) throw new TypeError('grade contract mismatch');
    if (grade.independent !== true || grade.blinded !== true) throw new TypeError('independent blinded grading declaration required');
    id(grade.reviewerId, 'reviewer id');
    sha(grade.evidenceSha256, 'review evidence hash');
    count(grade.score, 'score', item.maxScore);
    if (observation.last.status !== 'passed' || grade.outputSha256 !== observation.last.outputSha256) throw new TypeError('grade must bind successful output bytes');
    observation.score = grade.score;
  }
  const pairs = spec.cases.map(item => {
    const observations = Object.fromEntries(VARIANTS.map(variant => {
      const observation = runMap.get(`${item.id}:${variant}`);
      if (!observation) return [variant, { present: false, score: null, tokens: null, actualModels: [] }];
      return [variant, { present: true, historyComplete: observation.run.historyComplete,
        score: observation.run.historyComplete && observation.last.status === 'failed' ? 0 : observation.score,
        tokens: observation.totalTokens, elapsedMs: observation.elapsedMs,
        recordedAttempts: observation.run.attempts.length, actualModels: observation.actualModels }];
    }));
    const actual = VARIANTS.flatMap(variant => observations[variant].actualModels);
    const knownModels = new Set(actual.filter(model => model !== null));
    return { caseId: item.id, split: item.split, maxScore: item.maxScore, ...observations,
      sameActualModel: knownModels.size > 1 ? false : actual.length && actual.every(model => model !== null) ? true : null };
  });
  const complete = pairs.every(pair => VARIANTS.every(variant => pair[variant].present && pair[variant].historyComplete && pair[variant].score !== null));
  const quality = Object.fromEntries(VARIANTS.map(variant => [variant, {
    score: complete ? sum(pairs.map(pair => pair[variant].score)) : null,
    observedScore: sum(pairs.map(pair => pair[variant].score ?? 0)),
    gradedCases: pairs.filter(pair => pair[variant].score !== null).length,
    maxScore: sum(spec.cases.map(item => item.maxScore))
  }]));
  const workerTokens = Object.fromEntries(VARIANTS.map(variant => [variant, totalOrUnknown(pairs.map(pair => pair[variant].tokens))]));
  const actualModelMismatch = pairs.some(pair => pair.sameActualModel === false);
  if (actualModelMismatch) warnings.add('Observed actual models differ within a pair; targets are not evaluated as comparable.');
  const scoreMultiplier = complete && quality.baseline.score > 0 ? quality.candidate.score / quality.baseline.score : null;
  const passedCases = Object.fromEntries(VARIANTS.map(variant => [variant, complete ? pairs.filter(pair=>pair[variant].score===pair.maxScore).length : null]));
  const passRateMultiplier = complete && passedCases.baseline > 0 ? passedCases.candidate / passedCases.baseline : null;
  const qualityMultiplier = spec.qualityMetric === 'full-contract-pass-rate' ? passRateMultiplier : scoreMultiplier;
  const tokenReduction = workerTokens.baseline > 0 && workerTokens.candidate !== null ? 1 - workerTokens.candidate / workerTokens.baseline : null;
  const totalTokens = Object.fromEntries(VARIANTS.map(variant => [variant,
    overheadTokens !== null && workerTokens[variant] !== null ? sum([workerTokens[variant], overheadTokens[variant]]) : null]));
  const wholePipelineReduction = totalTokens.baseline > 0 && totalTokens.candidate !== null ? 1 - totalTokens.candidate / totalTokens.baseline : null;
  const regressions = pairs.filter(pair => pair.baseline.score !== null && pair.candidate.score !== null && pair.candidate.score < pair.baseline.score).map(pair => pair.caseId);
  const splits = Object.fromEntries(['training', 'holdout'].map(split => {
    const subset = pairs.filter(pair => pair.split === split);
    return [split, { cases: subset.length, scores: Object.fromEntries(VARIANTS.map(variant => [variant, totalOrUnknown(subset.map(pair => pair[variant].score))])) }];
  }));
  return { schema: 'genesis-paired-analysis-v1', experimentId: spec.id, registrationSha256: registration.sha256,
    scope: spec.scope, complete, pairs, quality, qualityMetric:spec.qualityMetric, qualityMultiplier, scoreMultiplier, passedCases, passRateMultiplier, regressions, splits, workerTokens, workerTokenReduction: tokenReduction,
    totalTokens, wholePipelineTokenReduction: wholePipelineReduction, monetarySavings: null,
    targets: {
      quality: complete && !actualModelMismatch && qualityMultiplier !== null ? !regressions.length && qualityMultiplier >= spec.targets.qualityMultiplier : null,
      workerTokens: complete && !actualModelMismatch && tokenReduction !== null ? tokenReduction >= spec.targets.tokenReduction : null,
      wholePipeline: complete && !actualModelMismatch && qualityMultiplier !== null && wholePipelineReduction !== null ? !regressions.length && qualityMultiplier >= spec.targets.qualityMultiplier && wholePipelineReduction >= spec.targets.tokenReduction : null
    },
    warnings: [...warnings], executionAuthorityGranted: false, routingPolicyChanged: false };
}

module.exports = { preregisterExperiment, analyzeExperiment, normalizeCodexUsage, hash };
