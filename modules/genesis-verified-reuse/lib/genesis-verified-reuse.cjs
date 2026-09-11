'use strict';
// Read-only admission and lookup. Callers own persistence, execution, and fresh task review.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { types } = require('node:util');
const { collectEvidence } = require('./genesis-evidence-collector.cjs');

const SCHEMA = 'genesis-verified-reuse-v1';
const RECEIPT_SCHEMA = 'genesis-readonly-draft-v1';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 64;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Public APIs snapshot the whole input before consulting any configuration or
// filesystem path. This rejects executable getters/proxies even in unused fields.
function snapshot(value, depth = 0, budget = { nodes: 0, chars: 0 }) {
  if (++budget.nodes > 32768 || depth > 32) fail('Input exceeds bounded data limits');
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.chars += value.length;
    if (budget.chars > 2 * 1024 * 1024) fail('Input exceeds bounded data limits');
    return value;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Nonfinite input value'); return value; }
  if (typeof value !== 'object' || types.isProxy(value)) fail('Plain data without proxies required');
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype && proto !== null) fail('Arrays cannot inherit configuration');
    const length = descriptors.length.value;
    if (length > 4096 || keys.length !== length + 1) fail('Dense bounded data arrays required');
    const result = [];
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(descriptors, index)) fail('Array accessors or holes are not permitted');
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Array accessors or holes are not permitted');
      result.push(snapshot(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  if (proto !== Object.prototype && proto !== null) fail('Records cannot inherit configuration');
  if (keys.length > 4096) fail('Record exceeds bounded data limits');
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) fail('Record accessors or symbols are not permitted');
    Object.defineProperty(result, key, { value: snapshot(descriptor.value, depth + 1, budget), enumerable: true, configurable: true, writable: true });
  }
  return result;
}
function serialize(value, depth = 0) {
  if (depth > 32) fail('JSON nesting exceeds limit');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Nonfinite JSON value'); return JSON.stringify(value); }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length > 4096 || Object.keys(value).length !== value.length) fail('Invalid JSON array');
    return '[' + value.map(item => serialize(item, depth + 1)).join(',') + ']';
  }
  if (!object(value)) fail('Plain JSON values required');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + serialize(value[key], depth + 1)).join(',') + '}';
}
function canonical(value) { return serialize(snapshot(value)); }
function jsonObject(value, label, nonempty = true) {
  if (!object(value) || (nonempty && !Object.keys(value).length)) fail(label + ' requires an explicit object');
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized) > 128 * 1024) fail(label + ' exceeds limit');
  return snapshot(JSON.parse(serialized));
}
function string(value, label, limit = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(label + ' required');
  return value;
}
function utc(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail(label + ' requires canonical UTC time');
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms < 0 || new Date(ms).toISOString() !== value) fail(label + ' invalid');
  return ms;
}
function nowMs(value) {
  if (value === undefined) return Date.now();
  if (typeof value === 'string') return utc(value, 'now');
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) fail('now invalid');
  return value;
}
function resolveRoot(value) {
  string(value, 'root');
  if (!path.isAbsolute(value)) fail('root must be absolute');
  const root = fs.realpathSync(value);
  if (!fs.statSync(root).isDirectory()) fail('root must be directory');
  return root;
}
function proofPath(value) {
  string(value, 'proof path', 1024);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || /[\\:\x00-\x1f]/.test(value)) fail('Invalid proof path');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) fail('Invalid proof path');
  if (/(^|\/)(\.git(?:\/|$)|\.env(?:\.|\/|$))|secret|credential/i.test(value)) fail('Protected proof path');
  return value;
}
function proof(value) {
  if (!object(value) || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('Proof requires SHA-256');
  return { path: proofPath(value.path), sha256: value.sha256 };
}
function inside(root, file) {
  const local = path.relative(root, file);
  if (!local || local === '..' || local.startsWith('..' + path.sep) || path.isAbsolute(local)) fail('Proof escapes root');
}
function inspectPath(root, relative) {
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) fail('Proof aliases and junctions are not permitted');
  }
  const real = fs.realpathSync(cursor);
  inside(root, real);
  return { file: real, stat: fs.lstatSync(real) };
}
function readChecked(root, expected) {
  const p = proof(expected), before = inspectPath(root, p.path);
  const fd = fs.openSync(before.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes, acceptedStat;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink > 1 || stat.size < 1 || stat.size > MAX_BYTES || stat.dev !== before.stat.dev || stat.ino !== before.stat.ino) fail('Proof must be a bounded nonempty unaliased file');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, count;
    while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
    const after = fs.fstatSync(fd);
    if (size > MAX_BYTES || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail('Proof changed during read');
    bytes = buffer.subarray(0, size);
    acceptedStat = after;
  } finally { fs.closeSync(fd); }
  const current = inspectPath(root, p.path);
  if (current.file !== before.file || current.stat.dev !== acceptedStat.dev || current.stat.ino !== acceptedStat.ino || current.stat.size !== acceptedStat.size || current.stat.mtimeMs !== acceptedStat.mtimeMs || current.stat.ctimeMs !== acceptedStat.ctimeMs || sha(bytes) !== p.sha256) fail('Proof missing, changed, or stale: ' + p.path);
  return bytes;
}
function proofList(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ITEMS) fail(label + ' requires 1..' + MAX_ITEMS + ' proofs');
  const result = value.map(proof).sort((a, b) => a.path.localeCompare(b.path));
  const paths = result.map(p => pathKey(p.path));
  if (new Set(paths).size !== paths.length) fail(label + ' contains duplicate paths');
  return result;
}
function normalizeRequest(value) {
  if (!object(value)) fail('request required');
  const allowed = new Set(['objective', 'contract', 'sources', 'worker', 'role', 'policies', 'outputSchema', 'operation', 'dependencyMode', 'freshness', 'context', 'liveDependent', 'dynamic']);
  if (Object.keys(value).some(key => !allowed.has(key))) fail('Unbound request field: put all additional worker inputs in context');
  if (value.operation !== 'read-only-draft') fail('Only read-only draft operations are cacheable');
  if (value.dependencyMode !== 'static' || (value.liveDependent !== undefined && value.liveDependent !== false) || (value.dynamic !== undefined && value.dynamic !== false)) fail('Dynamic, live, or unspecified dependencies are not cacheable');
  const worker = jsonObject(value.worker, 'worker');
  string(worker.provider, 'worker.provider', 160);
  string(worker.model, 'worker.model', 160);
  jsonObject(worker.config, 'worker.config', false);
  if (worker.model.toLowerCase() === 'auto' && !Object.hasOwn(worker, 'actualModel')) fail('Auto route requires explicit actualModel; use null when unknown');
  if (Object.hasOwn(worker, 'actualModel') && worker.actualModel !== null) string(worker.actualModel, 'worker.actualModel', 160);
  const freshness = jsonObject(value.freshness, 'freshness');
  if (!Number.isSafeInteger(freshness.ttlMs) || freshness.ttlMs <= 0 || freshness.ttlMs > 7 * 24 * 60 * 60 * 1000) fail('freshness.ttlMs must be between 1 ms and 7 days');
  return {
    objective: string(value.objective, 'objective', 64 * 1024),
    contract: jsonObject(value.contract, 'contract'),
    sources: proofList(value.sources, 'sources'),
    worker, role: proof(value.role), policies: proofList(value.policies, 'policies'),
    outputSchema: jsonObject(value.outputSchema, 'outputSchema'),
    operation: value.operation, dependencyMode: value.dependencyMode, freshness,
    // Additional task context must be explicit: ignored fields cannot masquerade as part of the contract.
    context: value.context === undefined ? null : jsonObject(value.context, 'context', false)
  };
}
function inputsOf(request) { return [...request.sources, request.role, ...request.policies]; }
function fingerprintData(input) {
  const root = resolveRoot(input.root), request = normalizeRequest(input.request);
  for (const p of inputsOf(request)) readChecked(root, p);
  const rootHash = sha(process.platform === 'win32' ? root.toLowerCase() : root);
  const fingerprint = sha(canonical({ schema: SCHEMA, rootHash, request }));
  return { root, rootHash, request, fingerprint };
}
function buildFingerprint(input = {}) {
  try { const data = fingerprintData(snapshot(input)); return { ok: true, fingerprint: data.fingerprint, rootHash: data.rootHash, request: data.request }; }
  catch (error) { return { ok: false, reason: error.message, fingerprint: null }; }
}
function readJson(root, ref) {
  return snapshot(JSON.parse(readChecked(root, ref).toString('utf8').replace(/^\uFEFF/, '')));
}
function same(a, b) { return canonical(a) === canonical(b); }
function validatePriorEvidence(root, receipt, output) {
  if (receipt.verification === undefined) return { kind: 'candidate', checked: false, review: null };
  const prior = receipt.verification;
  if (!object(prior) || !Array.isArray(prior.criteria) || !prior.criteria.length || prior.criteria.length > MAX_ITEMS || new Set(prior.criteria).size !== prior.criteria.length) fail('Invalid prior verification criteria');
  prior.criteria.forEach(c => string(c, 'criterion'));
  const checks = proofList(prior.checks, 'prior checks'), review = proof(prior.review);
  for (const p of [...checks, review]) readChecked(root, p);
  const evidence = collectEvidence({ root, planId: receipt.planId, taskId: receipt.taskId, worker: receipt.workerId, criteria: prior.criteria,
    artifactPaths: [output.path], checkPaths: checks.map(p => p.path), reviewPath: review.path,
    requiredReviewer: { model: 'gpt-6-astra', effort: 'ultra' } });
  if (!evidence.ok) fail('Prior verification invalid: ' + evidence.failures.join('; '));
  // Revalidate the exact supplied receipt hashes, not merely whatever now occupies the paths.
  for (const p of [...checks, review]) readChecked(root, p);
  return { kind: 'verified-artifact', checked: true, review: { ...review }, checks, criteria: [...prior.criteria],
    basis: 'Current persisted coordinator-attested receipts; not cryptographic reviewer authentication.' };
}
function validateCandidate(input) {
  const data = fingerprintData(input), now = nowMs(input.now);
  const output = proof(input.output), receiptRef = proof(input.receipt);
  const outputKey = pathKey(output.path), receiptKey = pathKey(receiptRef.path);
  if (outputKey === receiptKey || inputsOf(data.request).some(p => pathKey(p.path) === outputKey || pathKey(p.path) === receiptKey)) fail('Output and receipt must be separate from each other and inputs');
  const receipt = readJson(data.root, receiptRef);
  if (!object(receipt) || receipt.schema !== RECEIPT_SCHEMA || receipt.status !== 'draft' || receipt.operation !== 'read-only-draft' || receipt.fingerprint !== data.fingerprint) fail('Draft receipt contract mismatch');
  for (const key of ['planId', 'taskId', 'workerId']) string(receipt[key], key, 160);
  if (!same(receipt.worker, data.request.worker) || !same(proof(receipt.output), output)) fail('Draft receipt worker or output mismatch');
  const created = utc(receipt.createdAt, 'createdAt'), expires = utc(receipt.expiresAt, 'expiresAt');
  if (created > now || expires <= created || expires <= now || expires - created > data.request.freshness.ttlMs) fail('Draft expired, future-dated, or outside freshness contract');
  const outputBytes = readChecked(data.root, output);
  // Worker drafts are text; invalid UTF-8 must not silently become different reused output.
  const text = outputBytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(outputBytes)) fail('Draft output must be UTF-8 text');
  const priorEvidence = validatePriorEvidence(data.root, receipt, output);
  for (const p of [...inputsOf(data.request), output, receiptRef]) readChecked(data.root, p);
  const record = { schema: SCHEMA, fingerprint: data.fingerprint, rootHash: data.rootHash, request: data.request,
    output, receipt: receiptRef, sourceTask: { planId: receipt.planId, taskId: receipt.taskId, workerId: receipt.workerId },
    createdAt: receipt.createdAt, expiresAt: receipt.expiresAt, priorEvidence };
  return { record, text };
}
function admitCandidate(input = {}) {
  try { return { ok: true, record: validateCandidate(snapshot(input)).record, status: 'draft', accepted: false, needsFreshReview: true }; }
  catch (error) { return { ok: false, reason: error.message, record: null, accepted: false }; }
}
function miss(reason) {
  return { hit: false, status: 'miss', reason, accepted: false, needsFreshReview: true, tokensSaved: null, costSaved: null };
}
function decideReuse(input = {}) {
  try {
    input = snapshot(input);
    if (!object(input.record) || input.record.schema !== SCHEMA) return miss('Valid admitted record required');
    if (!object(input.target)) return miss('Explicit target task required');
    const target = { planId: string(input.target.planId, 'target.planId', 160), taskId: string(input.target.taskId, 'target.taskId', 160) };
    const checked = validateCandidate({ root: input.root, request: input.request, output: input.record.output, receipt: input.record.receipt, now: input.now });
    // Stored metadata is untrusted; equality covers task identities, expiry and any prior receipts.
    if (!same(input.record, checked.record)) return miss('Stored cache record differs from current persisted evidence');
    if (target.planId === checked.record.sourceTask.planId && target.taskId === checked.record.sourceTask.taskId) return miss('Source and target must be distinct tasks');
    return { hit: true, status: 'draft', fingerprint: checked.record.fingerprint, text: checked.text,
      output: checked.record.output, sourceTask: checked.record.sourceTask, target,
      priorEvidence: checked.record.priorEvidence, accepted: false, needsFreshReview: true,
      execution: 'none', externalEffectsReplayed: false, tokensSaved: null, costSaved: null,
      workerIdentityBasis: 'Declared provider route and config; actual model is known only when exposed in worker.actualModel.',
      usageBasis: 'A validated reuse opportunity is not a measured provider call or token/cost saving.',
      filesystemBasis: 'Current bounded reads in a stable caller-owned tree; not an OS sandbox against concurrent writers.' };
  } catch (error) { return miss(error.message); }
}

module.exports = { buildFingerprint, admitCandidate, decideReuse, canonical, SCHEMA, RECEIPT_SCHEMA };
