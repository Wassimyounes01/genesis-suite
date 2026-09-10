'use strict';

const crypto = require('node:crypto');

const DEFAULTS = Object.freeze({
  deadlineMs: 10_000,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 256 * 1024,
  maxFindings: 100,
});
const HARD_LIMITS = Object.freeze({ deadlineMs: 120_000, maxInputBytes: 4 * 1024 * 1024, maxOutputBytes: 4 * 1024 * 1024, maxFindings: 1_000, artifactId: 120, providerField: 200, textField: 4_000 });

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function bytes(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_) { return Infinity; }
  return Buffer.byteLength(encoded === undefined ? String(value) : encoded);
}
function error(code, message, details = {}) { return { code, message, ...details }; }
function safeMessage(value) { return String(value || 'review provider failed').slice(0, 500); }
function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const ok = Array.isArray(value) ? value.every(item => isJsonValue(item, seen)) : isObject(value) && Object.values(value).every(item => isJsonValue(item, seen));
  seen.delete(value); return ok;
}

function validateFinding(value, path = 'finding') {
  const allowed = ['id', 'severity', 'title', 'description', 'evidence'];
  if (!exactKeys(value, allowed)) return `${path} must have exactly ${allowed.join(', ')}`;
  if (!nonEmptyString(value.id) || value.id.length > 100 || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value.id)) return `${path}.id is invalid`;
  if (!['critical', 'high', 'medium', 'low', 'info'].includes(value.severity)) return `${path}.severity is invalid`;
  for (const key of ['title', 'description', 'evidence']) if (!nonEmptyString(value[key]) || value[key].length > HARD_LIMITS.textField) return `${path}.${key} must be bounded and non-empty`;
  return null;
}

function validateFinderResponse(value) {
  if (!exactKeys(value, ['provider', 'findings'])) return 'finder response has unknown or missing keys';
  if (!isObject(value.provider) || !exactKeys(value.provider, ['name', 'model'])) return 'provider must contain exactly name and model';
  if (!nonEmptyString(value.provider.name) || !nonEmptyString(value.provider.model) || value.provider.name.length > HARD_LIMITS.providerField || value.provider.model.length > HARD_LIMITS.providerField) return 'provider name and model are required and bounded';
  if (!Array.isArray(value.findings)) return 'findings must be an array';
  const ids = new Set();
  for (let i = 0; i < value.findings.length; i++) {
    const message = validateFinding(value.findings[i], `findings[${i}]`);
    if (message) return message;
    if (ids.has(value.findings[i].id)) return 'finding ids must be unique';
    ids.add(value.findings[i].id);
  }
  return null;
}

function validateRefutation(value) {
  if (!exactKeys(value, ['status', 'reason'])) return 'refutation must contain exactly status and reason';
  if (value.status !== 'refuted' || !nonEmptyString(value.reason)) return 'refutation requires status refuted and a non-empty reason';
  return null;
}

function validateReviewResult(value) {
  const allowed = ['status', 'artifactId', 'findings', 'provider', 'errors'];
  if (!exactKeys(value, allowed)) return 'review result has unknown or missing keys';
  if (!['complete', 'incomplete'].includes(value.status) || !nonEmptyString(value.artifactId) || value.artifactId.length > HARD_LIMITS.artifactId) return 'status or artifactId is invalid';
  if (!Array.isArray(value.findings) || !Array.isArray(value.errors)) return 'findings and errors must be arrays';
  if (value.findings.length > HARD_LIMITS.maxFindings || value.errors.length > 20) return 'findings or errors exceed public bounds';
  if (!isObject(value.provider) || !exactKeys(value.provider, ['name', 'model']) || !nonEmptyString(value.provider.name) || !nonEmptyString(value.provider.model) || value.provider.name.length > HARD_LIMITS.providerField || value.provider.model.length > HARD_LIMITS.providerField) return 'provider is invalid';
  for (let i = 0; i < value.findings.length; i++) {
    const item = value.findings[i];
    if (!exactKeys(item, ['finding', 'refutation'])) return `findings[${i}] has unknown or missing keys`;
    const findingError = validateFinding(item.finding, `findings[${i}].finding`);
    if (findingError) return findingError;
    if (item.refutation === null) {
      if (value.status === 'complete') return `findings[${i}] cannot omit a refutation in a complete result`;
    } else {
      const refutationError = validateRefutation(item.refutation);
      if (refutationError) return `findings[${i}].${refutationError}`;
    }
  }
  if (value.status === 'complete' && value.errors.length !== 0) return 'complete result cannot contain errors';
  for (const item of value.errors) {
    if (!exactKeys(item, ['code', 'message']) || !['provider', 'partial', 'timeout', 'oversized', 'aborted'].includes(item.code) || !nonEmptyString(item.message) || item.message.length > 500) return 'errors must contain a known code and bounded non-empty message';
  }
  return null;
}

function makeArtifactId(artifact) {
  let serialized;
  try { serialized = JSON.stringify(artifact); } catch (_) { serialized = '[unserializable-artifact]'; }
  return crypto.createHash('sha256').update(serialized === undefined ? String(artifact) : serialized).digest('hex').slice(0, 24);
}

function withDeadline(promise, deadlineAt, signal) {
  const remaining = Math.max(0, deadlineAt - Date.now());
  if (remaining <= 0) return Promise.reject(Object.assign(new Error('review deadline exceeded'), { code: 'timeout' }));
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('review was cancelled'), { code: 'aborted' }));
  let timer, onAbort;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('review deadline exceeded'), { code: 'timeout' })), remaining); });
  const cancelled = signal ? new Promise((_, reject) => { onAbort = () => reject(Object.assign(new Error('review was cancelled'), { code: 'aborted' })); signal.addEventListener('abort', onAbort, { once: true }); }) : null;
  return Promise.race(cancelled ? [Promise.resolve(promise), timeout, cancelled] : [Promise.resolve(promise), timeout]).finally(() => { clearTimeout(timer); if (signal && onAbort) signal.removeEventListener('abort', onAbort); });
}

function normalizeFailure(err) {
  if (err && err.code === 'timeout') return error('timeout', 'review deadline exceeded');
  if (err && err.code === 'aborted') return error('aborted', 'review was cancelled');
  if (err && err.code === 'oversized') return error('oversized', safeMessage(err.message));
  return error('provider', safeMessage(err && err.message));
}

/** Run a bounded two-stage review using an injected adapter. */
async function reviewArtifact(input, adapter, options = {}) {
  const limits = { ...DEFAULTS, ...options };
  const artifact = isObject(input) && Object.hasOwn(input, 'artifact') ? input.artifact : input;
  const artifactId = isObject(input) && nonEmptyString(input.artifactId) ? input.artifactId : makeArtifactId(artifact);
  const errors = [];
  let cleanup = () => {};
  const safeProvider = provider => isObject(provider) && nonEmptyString(provider.name) && nonEmptyString(provider.model) ? { name: provider.name.slice(0, HARD_LIMITS.providerField), model: provider.model.slice(0, HARD_LIMITS.providerField) } : { name: 'unknown', model: 'unknown' };
  const incomplete = (provider = { name: 'unknown', model: 'unknown' }, findings = []) => { cleanup(); return { status: 'incomplete', artifactId: String(artifactId).slice(0, HARD_LIMITS.artifactId), findings: findings.slice(0, HARD_LIMITS.maxFindings), provider: safeProvider(provider), errors: errors.slice(0, 20) }; };
  if (String(artifactId).length > HARD_LIMITS.artifactId) { errors.push(error('partial', 'artifactId exceeds public bounds')); return incomplete(); }
  if (!isObject(adapter) || typeof adapter.find !== 'function' || typeof adapter.refute !== 'function') {
    errors.push(error('provider', 'adapter must provide find() and refute() functions')); return incomplete();
  }
  if (!isJsonValue(artifact)) { errors.push(error('partial', 'artifact must be finite JSON data')); return incomplete(); }
  if (!Number.isInteger(limits.deadlineMs) || limits.deadlineMs <= 0 || limits.deadlineMs > HARD_LIMITS.deadlineMs || !Number.isInteger(limits.maxInputBytes) || limits.maxInputBytes <= 0 || limits.maxInputBytes > HARD_LIMITS.maxInputBytes || !Number.isInteger(limits.maxOutputBytes) || limits.maxOutputBytes <= 0 || limits.maxOutputBytes > HARD_LIMITS.maxOutputBytes || !Number.isInteger(limits.maxFindings) || limits.maxFindings < 0 || limits.maxFindings > HARD_LIMITS.maxFindings) { errors.push(error('partial', 'review limits are invalid or exceed hard bounds')); return incomplete(); }
  if (bytes(artifact) > limits.maxInputBytes) { errors.push(error('oversized', 'review artifact exceeds maxInputBytes')); return incomplete(); }
  const deadlineAt = Date.now() + limits.deadlineMs;
  const controller = new AbortController();
  if (options.signal) {
    if (typeof options.signal.addEventListener !== 'function' || typeof options.signal.removeEventListener !== 'function') { errors.push(error('partial', 'signal must be an AbortSignal-like object')); return incomplete(); }
    if (options.signal.aborted) { errors.push(error('aborted', 'review was cancelled before provider dispatch')); return incomplete(); }
    const onAbort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener('abort', onAbort, { once: true });
    cleanup = () => options.signal.removeEventListener('abort', onAbort);
  }
  const call = (fn, payload) => {
    if (controller.signal.aborted) return Promise.reject(Object.assign(new Error('review was cancelled'), { code: 'aborted' }));
    if (Date.now() >= deadlineAt) return Promise.reject(Object.assign(new Error('review deadline exceeded'), { code: 'timeout' }));
    let result;
    try { result = fn(payload); } catch (err) { return Promise.reject(err); }
    const observed = Promise.resolve(result);
    // The adapter may synchronously abort and return a rejected promise. Attach a
    // handler before the early-abort branch so cancellation never creates an
    // unhandled rejection while the gate is returning its bounded receipt.
    observed.catch(() => {});
    if (controller.signal.aborted) return Promise.reject(Object.assign(new Error('review was cancelled'), { code: 'aborted' }));
    return withDeadline(observed, deadlineAt, controller.signal).catch(err => {
      if (err && err.code === 'timeout') controller.abort();
      throw err;
    });
  };
  let found;
  try { found = await call(adapter.find, { artifact, artifactId, deadlineAt, signal: controller.signal }); }
  catch (err) { errors.push(normalizeFailure(err)); return incomplete(); }
  if (controller.signal.aborted) { errors.push(error('aborted', 'review was cancelled')); return incomplete(); }
  if (!isJsonValue(found)) { errors.push(error('partial', 'finder response must be finite JSON data')); return incomplete(); }
  if (bytes(found) > limits.maxOutputBytes) { errors.push(error('oversized', 'finder response exceeds maxOutputBytes')); return incomplete(); }
  const finderError = validateFinderResponse(found);
  if (finderError || found.findings.length > limits.maxFindings) {
    errors.push(error(finderError ? 'partial' : 'oversized', finderError || 'finding count exceeds maxFindings'));
    const preserved = [];
    const ids = new Set();
    for (const item of Array.isArray(found?.findings) ? found.findings : []) {
      if (preserved.length >= limits.maxFindings) break;
      if (!validateFinding(item) && !ids.has(item.id)) { ids.add(item.id); preserved.push({ finding: item, refutation: null }); }
    }
    return incomplete(found && found.provider, preserved);
  }
  const reviewed = [];
  for (const finding of found.findings) {
    let refutation;
    try { refutation = await call(adapter.refute, { artifact, artifactId, finding, deadlineAt, signal: controller.signal }); }
    catch (err) { errors.push(normalizeFailure(err)); return incomplete(found.provider, [...reviewed, { finding, refutation: null }]); }
    if (controller.signal.aborted) { errors.push(error('aborted', 'review was cancelled')); return incomplete(found.provider, [...reviewed, { finding, refutation: null }]); }
    if (!isJsonValue(refutation)) { errors.push(error('partial', `refutation for ${finding.id} must be finite JSON data`)); return incomplete(found.provider, [...reviewed, { finding, refutation: null }]); }
    if (bytes(refutation) > limits.maxOutputBytes) { errors.push(error('oversized', `refutation for ${finding.id} exceeds maxOutputBytes`)); return incomplete(found.provider, [...reviewed, { finding, refutation: null }]); }
    const refutationError = validateRefutation(refutation);
    if (refutationError) { errors.push(error('partial', `finding ${finding.id} unresolved: ${refutationError}`)); return incomplete(found.provider, [...reviewed, { finding, refutation: null }]); }
    reviewed.push({ finding, refutation });
  }
  if (controller.signal.aborted) { errors.push(error('aborted', 'review was cancelled')); return incomplete(found.provider, reviewed); }
  const result = { status: 'complete', artifactId, findings: reviewed, provider: found.provider, errors };
  const resultError = validateReviewResult(result);
  if (resultError) return { ...incomplete(found.provider), errors: [error('partial', resultError)] };
  cleanup();
  return result;
}

function createReviewGate(options = {}) { return Object.freeze({ review: (input, adapter) => reviewArtifact(input, adapter, options) }); }

module.exports = { DEFAULTS, HARD_LIMITS, createReviewGate, reviewArtifact, validateFinding, validateFinderResponse, validateRefutation, validateReviewResult };
