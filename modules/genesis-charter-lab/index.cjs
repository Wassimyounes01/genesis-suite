'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASELINE_CHARTERS = Object.freeze({
  planner: 'State the outcome, acceptance checks, constraints and dependencies. Choose proportional bounded work and reserve independent verification.',
  worker: 'Execute the supplied task contract within its scope. Preserve interfaces, state assumptions, report evidence and keep unknowns unknown.',
});
const EVALUATOR_RULES = Object.freeze({
  minimumTrainingTasks: 3,
  minimumHoldoutTasks: 1,
  allowedMetrics: Object.freeze(['quality', 'tokens']),
  requireZeroRegressions: true,
  authorityMutableByCandidate: false,
});
const LIMITS = Object.freeze({ maxCandidates: 100, maxPreregistrations: 2000, maxEvidence: 2000, maxHistory: 2000, maxStateBytes: 1024 * 1024, maxIdLength: 120 });
const MAX_METRIC = 1_000_000_000;
const MAX_COUNTER = 1_000_000;

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function validId(value) { return nonEmpty(value) && value.length <= LIMITS.maxIdLength && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(role, text) { return crypto.createHash('sha256').update(`${role}\n${text}`).digest('hex'); }
function evidenceDigest(input = {}) {
  const payload = {
    candidateHash: input.candidateHash,
    baselineHash: input.baselineHash,
    taskId: input.taskId,
    split: input.split,
    baselineScore: input.baselineScore,
    candidateScore: input.candidateScore,
    regressions: input.regressions,
    baselineTokens: input.baselineTokens ?? null,
    candidateTokens: input.candidateTokens ?? null,
    artifactId: input.artifactId,
    currentHash: input.currentHash,
    measuredAt: input.measuredAt ?? null,
    metric: input.metric ?? null,
    minimumRelativeGain: input.minimumRelativeGain ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function nowIso(clock) { return new Date(clock()).toISOString(); }
function stateFile(dir) { return path.join(dir, 'charter-lab-state.json'); }
function initialState() { return { schemaVersion: 1, candidates: {}, preregistrations: [], evidence: [], active: {}, history: [] }; }

function validateState(value) {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.candidates) || !Array.isArray(value.preregistrations) || !Array.isArray(value.evidence) || !isObject(value.active) || !Array.isArray(value.history)) throw new Error('invalid charter lab state');
  for (const candidate of Object.values(value.candidates)) {
    if (!isObject(candidate) || !Object.hasOwn(BASELINE_CHARTERS, candidate.role) || !nonEmpty(candidate.text) || candidate.text.length > 3200 || candidate.hash !== hash(candidate.role, candidate.text) || candidate.version !== candidate.hash || !['staged', 'promoted'].includes(candidate.status)) throw new Error('candidate integrity check failed');
  }
  for (const [role, candidateHash] of Object.entries(value.active)) {
    if (!Object.hasOwn(BASELINE_CHARTERS, role) || !nonEmpty(candidateHash) || !value.candidates[candidateHash] || value.candidates[candidateHash].role !== role || value.candidates[candidateHash].status !== 'promoted') throw new Error('active role pointer is invalid');
  }
  return value;
}

function createCharterLab(options = {}) {
  if (!nonEmpty(options.stateDir)) throw new TypeError('stateDir is required');
  const dir = path.resolve(options.stateDir);
  const verifyEvidence = options.verifyEvidence;
  const evidenceFreshnessMs = options.evidenceFreshnessMs == null ? 24 * 60 * 60 * 1000 : Number(options.evidenceFreshnessMs);
  if (!Number.isInteger(evidenceFreshnessMs) || evidenceFreshnessMs <= 0 || evidenceFreshnessMs > 30 * 24 * 60 * 60 * 1000) throw new RangeError('evidenceFreshnessMs must be a positive integer <= 30 days');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const file = stateFile(dir);
  fs.mkdirSync(dir, { recursive: true });
  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (Buffer.byteLength(raw) > LIMITS.maxStateBytes) throw new Error('charter state size limit exceeded');
      const state = validateState(JSON.parse(raw));
      if (Object.keys(state.candidates).length > LIMITS.maxCandidates || state.preregistrations.length > LIMITS.maxPreregistrations || state.evidence.length > LIMITS.maxEvidence || state.history.length > LIMITS.maxHistory) throw new Error('charter state entry limit exceeded');
      return state;
    }
    catch (err) { if (err.code === 'ENOENT') return initialState(); throw err; }
  }
  function save(state) {
    validateState(state);
    if (Object.keys(state.candidates).length > LIMITS.maxCandidates || state.preregistrations.length > LIMITS.maxPreregistrations || state.evidence.length > LIMITS.maxEvidence || state.history.length > LIMITS.maxHistory) throw new Error('charter state entry limit exceeded');
    const temp = `${file}.${process.pid}.tmp`;
    const data = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(data) > LIMITS.maxStateBytes) throw new Error('charter state size limit exceeded');
    fs.writeFileSync(temp, data, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  }
  function mutate(fn) { const state = load(); const result = fn(state); save(state); return result; }
  function getCandidate(state, candidateHash) {
    const candidate = state.candidates[candidateHash];
    if (!candidate) throw new Error('unknown candidate hash');
    return candidate;
  }
  function stage(input) {
    if (!isObject(input) || !Object.hasOwn(input, 'role') || !Object.hasOwn(input, 'text') || !Object.hasOwn(input, 'rationale') || !Object.hasOwn(BASELINE_CHARTERS, input.role) || !nonEmpty(input.text) || !nonEmpty(input.rationale)) throw new TypeError('role, text and rationale are required');
    const text = input.text.trim();
    if (text.length > 3200) throw new RangeError('charter text exceeds 3200 characters');
    return mutate(state => {
      const candidateHash = hash(input.role, text);
      const existing = state.candidates[candidateHash];
      if (existing) return clone(existing);
      const candidate = { role: input.role, text, hash: candidateHash, version: candidateHash, baselineHash: active(state, input.role).version, rationale: input.rationale.trim().slice(0, 500), stagedAt: nowIso(clock), status: 'staged' };
      state.candidates[candidateHash] = candidate;
      return clone(candidate);
    });
  }
  function active(state, role) {
    const current = state.active[role];
    if (!current) return { version: hash(role, BASELINE_CHARTERS[role]), text: BASELINE_CHARTERS[role], source: 'baseline' };
    return { ...getCandidate(state, current), version: current, source: 'promoted' };
  }
  function preregister(input) {
    if (!isObject(input) || !['candidateHash', 'metric', 'minimumRelativeGain', 'taskId', 'split'].every(key => Object.hasOwn(input, key)) || !validId(input.taskId) || !nonEmpty(input.candidateHash) || !EVALUATOR_RULES.allowedMetrics.includes(input.metric) || !Number.isFinite(input.minimumRelativeGain) || input.minimumRelativeGain <= 0 || input.minimumRelativeGain > 1 || !['train', 'holdout'].includes(input.split)) throw new TypeError('candidateHash, metric, positive gain, bounded taskId and split are required');
    return mutate(state => {
      const candidate = getCandidate(state, input.candidateHash);
      if (candidate.status !== 'staged') throw new Error('only staged candidates can be preregistered');
      if (candidate.baselineHash !== active(state, candidate.role).version) throw new Error('candidate baseline changed; restage before preregistration');
      if (state.preregistrations.some(item => item.candidateHash === input.candidateHash && item.taskId === input.taskId)) throw new Error('task already preregistered for candidate');
      const receipt = { candidateHash: input.candidateHash, baselineHash: candidate.baselineHash, metric: input.metric, minimumRelativeGain: input.minimumRelativeGain, taskId: input.taskId, split: input.split, registeredAt: nowIso(clock) };
      state.preregistrations.push(receipt); return clone(receipt);
    });
  }
  function recordEvidence(input) {
    if (typeof verifyEvidence !== 'function') throw new Error('injected evidence verifier callback is required; no evidence is accepted by default');
    if (!isObject(input) || !['candidateHash', 'taskId', 'split', 'artifactId', 'currentHash', 'proofDigest', 'measuredAt', 'baselineScore', 'candidateScore', 'regressions'].every(key => Object.hasOwn(input, key)) || !nonEmpty(input.candidateHash) || !validId(input.taskId) || !nonEmpty(input.artifactId) || input.artifactId.length > LIMITS.maxIdLength || !nonEmpty(input.currentHash) || input.currentHash.length > LIMITS.maxIdLength || !/^[a-f0-9]{64}$/i.test(input.proofDigest) || !nonEmpty(input.measuredAt) || !['train', 'holdout'].includes(input.split) || !Number.isFinite(input.baselineScore) || input.baselineScore < 0 || input.baselineScore > MAX_METRIC || !Number.isFinite(input.candidateScore) || input.candidateScore < 0 || input.candidateScore > MAX_METRIC || !Number.isInteger(input.regressions) || input.regressions < 0 || input.regressions > MAX_COUNTER) throw new TypeError('artifact, current, 64-character proof digest, measuredAt, bounded non-negative paired scores, split, taskId and bounded regressions are required');
    return mutate(state => {
      const candidate = getCandidate(state, input.candidateHash);
      const registration = state.preregistrations.find(item => item.candidateHash === input.candidateHash && item.taskId === input.taskId && item.split === input.split);
      if (!registration) throw new Error('evidence must reference a preregistered task');
      if (state.evidence.some(item => item.candidateHash === input.candidateHash && item.taskId === input.taskId)) throw new Error('evidence task already recorded');
      const measuredMs = Date.parse(input.measuredAt), currentMs = clock();
      const registeredMs = Date.parse(registration.registeredAt);
      if (!Number.isFinite(measuredMs) || !Number.isFinite(registeredMs) || !Number.isFinite(currentMs) || measuredMs < registeredMs || measuredMs > currentMs + 1000 || currentMs - measuredMs > evidenceFreshnessMs) throw new Error('measuredAt is outside the preregistration or evidence freshness window');
      const evidence = { candidateHash: input.candidateHash, baselineHash: candidate.baselineHash, taskId: input.taskId, split: input.split, metric: registration.metric, minimumRelativeGain: registration.minimumRelativeGain, artifactId: input.artifactId, currentHash: input.currentHash, proofDigest: input.proofDigest, measuredAt: new Date(measuredMs).toISOString(), baselineScore: input.baselineScore, candidateScore: input.candidateScore, regressions: input.regressions, registeredAt: registration.registeredAt, recordedAt: nowIso(clock) };
      if (registration.metric === 'tokens') {
        if (!Number.isFinite(input.baselineTokens) || !Number.isFinite(input.candidateTokens) || !Number.isInteger(input.baselineTokens) || !Number.isInteger(input.candidateTokens) || input.baselineTokens <= 0 || input.candidateTokens <= 0 || input.baselineTokens > MAX_COUNTER || input.candidateTokens > MAX_COUNTER) throw new TypeError('measured bounded positive token counts are required; unknown is not zero');
        evidence.baselineTokens = input.baselineTokens; evidence.candidateTokens = input.candidateTokens;
      }
      if (input.proofDigest !== evidenceDigest(evidence)) throw new Error('proofDigest does not match the exact evidence binding');
      const verification = verifyEvidence(clone(evidence));
      if (!isObject(verification) || verification.ok !== true || verification.proofDigest !== evidence.proofDigest || verification.artifactId !== evidence.artifactId || verification.currentHash !== evidence.currentHash || verification.independentReview !== true) throw new Error('evidence verifier did not return matching independent proof');
      evidence.verification = { proofDigest: verification.proofDigest, artifactId: verification.artifactId, currentHash: verification.currentHash, independentReview: true };
      state.evidence.push(evidence); return clone(evidence);
    });
  }
  function benefit(registration, evidence) {
    if (evidence.regressions !== 0 || evidence.candidateScore < evidence.baselineScore) return -Infinity;
    if (registration.metric === 'quality') return (evidence.candidateScore - evidence.baselineScore) / Math.max(1, Math.abs(evidence.baselineScore));
    if (!(evidence.candidateTokens < evidence.baselineTokens)) return -Infinity;
    return (evidence.baselineTokens - evidence.candidateTokens) / evidence.baselineTokens;
  }
  function promote(input) {
    if (!isObject(input) || !nonEmpty(input.candidateHash)) throw new TypeError('candidateHash is required');
    if (typeof verifyEvidence !== 'function') throw new Error('injected evidence verifier callback is required; no evidence is accepted by default');
    return mutate(state => {
      const candidate = getCandidate(state, input.candidateHash);
      if (candidate.status !== 'staged') throw new Error('candidate is not staged');
      if (candidate.baselineHash !== active(state, candidate.role).version) throw new Error('candidate baseline changed; rerun staging');
      const evidence = state.evidence.filter(item => item.candidateHash === candidate.hash && item.baselineHash === candidate.baselineHash);
      const ids = new Set();
      for (const item of evidence) { if (ids.has(item.taskId)) throw new Error('distinct benchmark task ids are required'); ids.add(item.taskId); }
      const train = evidence.filter(item => item.split === 'train');
      const holdout = evidence.filter(item => item.split === 'holdout');
      if (train.length < EVALUATOR_RULES.minimumTrainingTasks || holdout.length < EVALUATOR_RULES.minimumHoldoutTasks) throw new Error('three training tasks and one separate held-out task are required');
      for (const item of evidence) {
        const recordedAt = Date.parse(item.recordedAt), measuredAt = Date.parse(item.measuredAt);
        const currentAt = clock();
        if (!Number.isFinite(recordedAt) || !Number.isFinite(currentAt) || currentAt < recordedAt || currentAt - recordedAt > evidenceFreshnessMs) throw new Error(`evidence is stale for ${item.taskId}`);
        if (!Number.isFinite(measuredAt) || currentAt < measuredAt || currentAt - measuredAt > evidenceFreshnessMs) throw new Error(`measurement is stale for ${item.taskId}`);
        if (item.proofDigest !== evidenceDigest(item)) throw new Error(`proof digest mismatch for ${item.taskId}`);
        const verification = verifyEvidence(clone(item));
        if (!isObject(verification) || verification.ok !== true || verification.proofDigest !== item.proofDigest || verification.artifactId !== item.artifactId || verification.currentHash !== item.currentHash || verification.independentReview !== true) throw new Error(`independent proof no longer verifies for ${item.taskId}`);
        const registration = state.preregistrations.find(ref => ref.candidateHash === candidate.hash && ref.taskId === item.taskId && ref.split === item.split);
        if (!registration || benefit(registration, item) < registration.minimumRelativeGain) throw new Error(`measured benefit missing for ${item.taskId}`);
      }
      candidate.status = 'promoted'; candidate.promotedAt = nowIso(clock); state.active[candidate.role] = candidate.hash;
      state.history.push({ action: 'promote', role: candidate.role, from: candidate.baselineHash, to: candidate.hash, at: candidate.promotedAt, evidence: evidence.map(item => item.taskId) });
      return { role: candidate.role, version: candidate.hash, status: 'promoted', evidence: evidence.length, note: 'Charter workflow feedback is not model-weight training.' };
    });
  }
  function rollback(input) {
    if (!isObject(input) || !Object.hasOwn(input, 'role') || !Object.hasOwn(BASELINE_CHARTERS, input.role) || !nonEmpty(input.reason)) throw new TypeError('known role and non-empty reason are required');
    return mutate(state => {
      const current = active(state, input.role);
      const target = input.version || [...state.history].reverse().find(item => item.role === input.role && item.action === 'promote' && item.to === current.version)?.from || hash(input.role, BASELINE_CHARTERS[input.role]);
      const known = target === hash(input.role, BASELINE_CHARTERS[input.role]) || (state.candidates[target] && state.candidates[target].role === input.role && state.candidates[target].status === 'promoted');
      if (!known) throw new Error('rollback target must be a prior promoted version or baseline');
      if (target === hash(input.role, BASELINE_CHARTERS[input.role])) delete state.active[input.role]; else state.active[input.role] = target;
      const receipt = { action: 'rollback', role: input.role, from: current.version, to: target, reason: input.reason.trim().slice(0, 500), at: nowIso(clock) };
      state.history.push(receipt); return clone({ role: input.role, version: target, status: 'rolled-back' });
    });
  }
  function get(role) { if (!Object.hasOwn(BASELINE_CHARTERS, role)) throw new Error('unknown role'); const state = load(); return clone(active(state, role)); }
  function snapshot() { return clone(load()); }
  return Object.freeze({ stage, preregister, recordEvidence, promote, rollback, get, snapshot, evidenceDigest, BASELINE_CHARTERS, EVALUATOR_RULES, evidenceFreshnessMs });
}

module.exports = { BASELINE_CHARTERS, EVALUATOR_RULES, LIMITS, evidenceDigest, createCharterLab };
