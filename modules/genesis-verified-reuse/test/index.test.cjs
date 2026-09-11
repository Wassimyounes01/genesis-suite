'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildFingerprint, admitCandidate, decideReuse, canonical, RECEIPT_SCHEMA } = require('../lib/genesis-verified-reuse.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-09-11T15:45:00.000Z');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-reuse-'));
  t.after(() => {
    // The fixture is the exact mkdtemp child of os.tmpdir; no computed external deletion.
    const absolute = path.resolve(root), temp = path.resolve(os.tmpdir());
    assert.equal(path.dirname(absolute), temp);
    assert.ok(path.basename(absolute).startsWith('verified-reuse-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const write = (name, value) => {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    return { path: name, sha256: sha(fs.readFileSync(full)) };
  };
  const source = write('input/source.cjs', 'module.exports = 42;\n');
  const role = write('policy/worker.md', 'Produce a read-only candidate.');
  const policy = write('policy/runtime.json', { reviewer: 'Astra Ultra', externalEffects: false });
  const request = { objective: 'Explain the exported value', contract: { acceptance: ['Correctly describes export'], format: 'text' },
    sources: [source], worker: { provider: 'fixture-provider', model: 'fixture-model', config: { effort: 'high', temperature: 0 } },
    role, policies: [policy], outputSchema: { type: 'string', version: 1 },
    operation: 'read-only-draft', dependencyMode: 'static', freshness: { ttlMs: 60000 }, context: { exactPrompt: 'Explain only this source.' } };
  const result = buildFingerprint({ root, request });
  assert.equal(result.ok, true, result.reason);
  const output = write('artifacts/draft.txt', 'The module exports the number 42.\n');
  const draft = { schema: RECEIPT_SCHEMA, status: 'draft', operation: 'read-only-draft', fingerprint: result.fingerprint,
    planId: 'source-plan', taskId: 'source-task', workerId: 'worker-1', worker: clone(request.worker), output,
    createdAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 59000).toISOString() };
  const receipt = write('evidence/draft.json', draft);
  const input = { root, request, output, receipt, now: NOW };
  const admitted = admitCandidate(input);
  assert.equal(admitted.ok, true, admitted.reason);
  return { root, write, request, output, draft, receipt, input, record: admitted.record,
    lookup: patch => decideReuse({ root, request, record: admitted.record, target: { planId: 'target-plan', taskId: 'target-task' }, now: NOW, ...patch }) };
}

test('same exact request reuses unchanged bytes as a fresh-review draft only', t => {
  const f = fixture(t), result = f.lookup();
  assert.equal(result.hit, true);
  assert.equal(result.text, fs.readFileSync(path.join(f.root, f.output.path), 'utf8'));
  assert.equal(result.status, 'draft');
  assert.equal(result.accepted, false);
  assert.equal(result.needsFreshReview, true);
  assert.equal(result.execution, 'none');
  assert.equal(result.externalEffectsReplayed, false);
  assert.equal(result.tokensSaved, null);
  assert.equal(result.costSaved, null);
  assert.equal(result.priorEvidence.checked, false);
  assert.equal(result.sourceTask.taskId, 'source-task');
  assert.equal(result.target.taskId, 'target-task');
  assert.equal(result.outcome, undefined);
});

test('pure lookup does not write or mutate request, record, or persisted receipts', t => {
  const f = fixture(t), before = canonical({ request: f.request, record: f.record });
  const stat = fs.statSync(path.join(f.root, f.receipt.path));
  const result = f.lookup();
  result.sourceTask.taskId = 'caller-change';
  assert.equal(canonical({ request: f.request, record: f.record }), before);
  assert.equal(fs.statSync(path.join(f.root, f.receipt.path)).mtimeMs, stat.mtimeMs);
  assert.equal(f.lookup().sourceTask.taskId, 'source-task');
});

test('canonical key ordering allows semantically identical object construction', t => {
  const f = fixture(t), request = clone(f.request);
  request.contract = { format: 'text', acceptance: ['Correctly describes export'] };
  assert.equal(f.lookup({ request }).hit, true);
});

for (const [label, change] of [
  ['objective', r => { r.objective += '.'; }],
  ['contract', r => { r.contract.acceptance.push('also explain type'); }],
  ['exact prompt', r => { r.context.exactPrompt += ' Include examples.'; }],
  ['worker model', r => { r.worker.model = 'other-model'; }],
  ['worker provider', r => { r.worker.provider = 'other-provider'; }],
  ['worker config', r => { r.worker.config.temperature = 1; }],
  ['output schema', r => { r.outputSchema.type = 'object'; }],
  ['freshness', r => { r.freshness.ttlMs = 30000; }]
]) test('changed ' + label + ' misses', t => {
  const f = fixture(t), request = clone(f.request); change(request);
  assert.equal(f.lookup({ request }).hit, false);
});

for (const [label, file] of [['source', 'input/source.cjs'], ['output', 'artifacts/draft.txt'], ['role', 'policy/worker.md'], ['policy', 'policy/runtime.json'], ['receipt', 'evidence/draft.json']]) {
  test('changed persisted ' + label + ' fails current-byte validation', t => {
    const f = fixture(t); f.write(file, 'stale replacement');
    assert.equal(f.lookup().hit, false);
  });
}

test('updated source hash also misses the old fingerprint', t => {
  const f = fixture(t), request = clone(f.request);
  request.sources = [f.write('input/source.cjs', 'module.exports = 7;')];
  assert.equal(f.lookup({ request }).hit, false);
});

for (const field of ['objective', 'contract', 'sources', 'worker', 'role', 'policies', 'outputSchema', 'freshness', 'operation', 'dependencyMode']) {
  test('missing ' + field + ' fails closed', t => {
    const f = fixture(t), request = clone(f.request); delete request[field];
    assert.equal(buildFingerprint({ root: f.root, request }).ok, false);
    assert.equal(f.lookup({ request }).hit, false);
  });
}

test('missing model, provider, config, and empty contract fail closed', t => {
  const f = fixture(t);
  for (const field of ['model', 'provider', 'config']) {
    const request = clone(f.request); delete request.worker[field];
    assert.equal(buildFingerprint({ root: f.root, request }).ok, false);
  }
  assert.equal(buildFingerprint({ root: f.root, request: { ...f.request, contract: {} } }).ok, false);
  assert.equal(buildFingerprint({ root: f.root, request: { ...f.request, sources: [] } }).ok, false);
});

test('missing root, missing hashes, and relative root fail closed', t => {
  const f = fixture(t);
  for (const root of [undefined, '', '.']) assert.equal(f.lookup({ root }).hit, false);
  for (const field of ['role', 'sources', 'policies']) {
    const request = clone(f.request);
    if (Array.isArray(request[field])) delete request[field][0].sha256;
    else delete request[field].sha256;
    assert.equal(f.lookup({ request }).hit, false);
  }
});

test('dynamic/live and unknown dependency modes fail closed by default', t => {
  const f = fixture(t);
  for (const patch of [{ dependencyMode: 'live' }, { dependencyMode: 'snapshot' }, { dependencyMode: null }, { liveDependent: true }, { dynamic: true }, { operation: 'deploy' }, { operation: 'send-email' }]) {
    assert.equal(f.lookup({ request: { ...f.request, ...patch } }).hit, false);
  }
});

test('unbound request fields are rejected rather than ignored', t => {
  const f = fixture(t);
  assert.equal(f.lookup({ request: { ...f.request, prompt: 'Actually perform another task' } }).hit, false);
});

test('caller-provided approval booleans cannot admit a missing receipt or grant acceptance', t => {
  const f = fixture(t);
  assert.equal(admitCandidate({ ...f.input, receipt: undefined, verified: true, reviewed: true, accepted: true }).ok, false);
  const record = { ...f.record, accepted: true, verified: true };
  assert.equal(f.lookup({ record }).hit, false);
  const receipt = f.write('evidence/draft.json', { ...f.draft, accepted: true, reviewed: true, verified: true, usage: { estimatedTokensSaved: 1000000 } });
  const result = admitCandidate({ ...f.input, receipt });
  assert.equal(result.ok, true);
  const reuse = f.lookup({ record: result.record });
  assert.equal(reuse.hit, true);
  assert.equal(reuse.accepted, false);
  assert.equal(reuse.priorEvidence.checked, false);
  assert.equal(reuse.tokensSaved, null);
});

test('same source evidence across duplicate targets remains a draft and grants no new outcomes', t => {
  const f = fixture(t);
  assert.equal(f.lookup({ target: { planId: 'source-plan', taskId: 'source-task' } }).hit, false);
  for (const taskId of ['other-task', 'other-task', 'third-task']) {
    const result = f.lookup({ target: { planId: 'source-plan', taskId } });
    assert.equal(result.hit, true);
    assert.equal(result.accepted, false);
    assert.equal(result.needsFreshReview, true);
    assert.equal(result.outcome, undefined);
    assert.equal(result.sourceTask.taskId, 'source-task');
  }
});

test('Auto route requires explicit unknown actual-model identity and cannot imply same-model measurements', t => {
  const f = fixture(t), request = clone(f.request);
  request.worker = { provider: 'cursor', model: 'auto', config: { mode: 'ask' } };
  assert.equal(buildFingerprint({ root: f.root, request }).ok, false);
  request.worker.actualModel = null;
  const fingerprint = buildFingerprint({ root: f.root, request });
  assert.equal(fingerprint.ok, true);
  const receipt = f.write('evidence/draft.json', { ...f.draft, fingerprint: fingerprint.fingerprint, worker: request.worker });
  const admitted = admitCandidate({ ...f.input, request, receipt });
  assert.equal(admitted.ok, true);
  const result = f.lookup({ request, record: admitted.record });
  assert.equal(result.hit, true);
  assert.match(result.workerIdentityBasis, /Declared provider route/);
  assert.equal(result.tokensSaved, null);
  assert.equal(result.costSaved, null);
  request.worker.actualModel = 'model-now-exposed';
  assert.equal(f.lookup({ request, record: admitted.record }).hit, false);
});

test('inherited request and record fields are rejected', t => {
  const f = fixture(t);
  const record = Object.assign(Object.create({ accepted: true }), f.record);
  const request = Object.assign(Object.create({ liveDependent: true }), f.request);
  assert.equal(f.lookup({ record }).hit, false);
  assert.equal(f.lookup({ request }).hit, false);
  assert.equal(f.lookup({ request: { ...f.request, dynamic: 'true' } }).hit, false);
});

test('record task, fingerprint, expiry, output, or prior evidence tampering misses', t => {
  const f = fixture(t);
  for (const edit of [r => { r.sourceTask.taskId = 'pretend'; }, r => { r.fingerprint = '0'.repeat(64); }, r => { r.expiresAt = new Date(NOW + 600000).toISOString(); }, r => { r.output.sha256 = '0'.repeat(64); }, r => { r.priorEvidence.checked = true; }]) {
    const record = clone(f.record); edit(record);
    assert.equal(f.lookup({ record }).hit, false);
  }
});

test('receipt binds actual source identity, worker, output, and fingerprint', t => {
  const f = fixture(t);
  for (const patch of [{ worker: { ...f.request.worker, model: 'other' } }, { output: { ...f.output, sha256: '0'.repeat(64) } }, { fingerprint: '0'.repeat(64) }, { taskId: '' }, { workerId: null }, { status: 'accepted' }, { operation: 'execute' }]) {
    const receipt = f.write('evidence/draft.json', { ...f.draft, ...patch });
    assert.equal(admitCandidate({ ...f.input, receipt }).ok, false);
  }
});

test('expiry is exclusive and malformed, excessive, future, and reversed times fail closed', t => {
  const f = fixture(t);
  assert.equal(f.lookup({ now: NOW + 59000 }).hit, false);
  assert.equal(f.lookup({ now: NOW + 58999 }).hit, true);
  for (const patch of [
    { createdAt: '2026-09-11' }, { createdAt: '2026-02-30T15:45:00.000Z' },
    { expiresAt: 'never' }, { expiresAt: null }, { expiresAt: '2026-09-11T15:46:00+00:00' },
    { createdAt: new Date(NOW + 1).toISOString() }, { expiresAt: new Date(NOW - 1001).toISOString() },
    { expiresAt: new Date(NOW + 60000).toISOString() }
  ]) {
    const receipt = f.write('evidence/draft.json', { ...f.draft, ...patch });
    assert.equal(admitCandidate({ ...f.input, receipt }).ok, false);
  }
});

test('malformed now and TTL do not silently become fresh', t => {
  const f = fixture(t);
  for (const now of [NaN, Infinity, -1, 1.5, null, 'now', '2026-02-30T15:45:00.000Z']) assert.equal(f.lookup({ now }).hit, false);
  for (const ttlMs of [NaN, Infinity, -1, 0, 0.5, '60000', 8 * 86400000]) {
    assert.equal(f.lookup({ request: { ...f.request, freshness: { ttlMs } } }).hit, false);
  }
});

test('duplicate and malformed proofs cannot create ambiguous source identities', t => {
  const f = fixture(t);
  assert.equal(f.lookup({ request: { ...f.request, sources: [f.request.sources[0], f.request.sources[0]] } }).hit, false);
  for (const badPath of ['../outside', '/tmp/outside', 'C:/private', 'a/../file', 'input\\source.cjs', './input/source.cjs', '.env', 'credentials.json', 'input/source.cjs:stream', 'input/source.cjs.', 'input//source.cjs', 'NUL']) {
    const request = { ...f.request, role: { path: badPath, sha256: f.request.role.sha256 } };
    assert.equal(f.lookup({ request }).hit, false, badPath);
  }
});

test('directory junctions cannot alias either internal or external proof paths', t => {
  const f = fixture(t), external = fixture(t);
  fs.symlinkSync(path.join(f.root, 'input'), path.join(f.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(external.root, path.join(f.root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const p of ['alias/source.cjs', 'outside/input/source.cjs']) {
    const request = { ...f.request, sources: [{ path: p, sha256: f.request.sources[0].sha256 }] };
    assert.equal(buildFingerprint({ root: f.root, request }).ok, false);
  }
});

test('hardlinks and copied records from a different root cannot be reused', t => {
  const f = fixture(t), other = fixture(t);
  assert.equal(f.lookup({ root: other.root }).hit, false);
  fs.linkSync(path.join(f.root, 'input/source.cjs'), path.join(f.root, 'linked.cjs'));
  assert.equal(f.lookup().hit, false);
});

test('missing, empty, oversized, malformed JSON, and invalid UTF-8 artifacts fail closed', t => {
  const f = fixture(t);
  for (const bytes of ['', 'x'.repeat(2 * 1024 * 1024 + 1), Buffer.from([0xff])]) {
    const output = f.write('artifacts/draft.txt', bytes);
    const receipt = f.write('evidence/draft.json', { ...f.draft, output });
    assert.equal(admitCandidate({ ...f.input, output, receipt }).ok, false);
  }
  const receipt = f.write('evidence/draft.json', '{broken-json');
  assert.equal(admitCandidate({ ...f.input, receipt }).ok, false);
  assert.equal(admitCandidate({ ...f.input, output: { path: 'missing.txt', sha256: sha('missing') } }).ok, false);
});

function addVerification(f, patches = {}) {
  const check = { schema: 'genesis-check-v1', planId: f.draft.planId, taskId: f.draft.taskId, criterion: 'Correctly describes export',
    command: 'node --test readonly-fixture.test.cjs', status: 'passed', exitCode: 0, checkedCount: 2, expectedCount: 2, artifacts: [f.output], ...patches.check };
  const checkProof = f.write('evidence/check.json', check);
  const review = { schema: 'genesis-review-v1', planId: f.draft.planId, taskId: f.draft.taskId, verdict: 'pass',
    reviewer: { agent: 'independent-reviewer', model: 'gpt-6-astra', effort: 'ultra' }, artifacts: [f.output], checks: [checkProof], ...patches.review };
  const reviewProof = f.write('evidence/review.json', review);
  const receipt = f.write('evidence/draft.json', { ...f.draft, verification: { criteria: ['Correctly describes export'], checks: [checkProof], review: reviewProof } });
  return admitCandidate({ ...f.input, receipt });
}

test('current persisted check and independent review identify a prior verified artifact without inheriting approval', t => {
  const f = fixture(t), admitted = addVerification(f);
  assert.equal(admitted.ok, true, admitted.reason);
  const result = f.lookup({ record: admitted.record });
  assert.equal(result.hit, true);
  assert.equal(result.priorEvidence.kind, 'verified-artifact');
  assert.equal(result.priorEvidence.checked, true);
  assert.equal(result.accepted, false);
  assert.equal(result.needsFreshReview, true);
  assert.equal(result.review, undefined);
  assert.equal(result.outcome, undefined);
});

for (const label of ['check', 'review']) test('changed prior ' + label + ' makes a verified artifact miss', t => {
  const f = fixture(t), admitted = addVerification(f);
  assert.equal(admitted.ok, true);
  f.write('evidence/' + label + '.json', '{}');
  assert.equal(f.lookup({ record: admitted.record }).hit, false);
});

test('unbound, empty, failed, self-reviewed, and wrong-model prior evidence cannot be treated as checked', t => {
  const f = fixture(t);
  for (const patches of [
    { check: { checkedCount: 0, expectedCount: 0 } }, { check: { exitCode: 1 } }, { check: { taskId: 'different' } },
    { check: { artifacts: [] } }, { check: { status: 'failed' } }, { review: { taskId: 'different' } },
    { review: { verdict: 'fail' } }, { review: { reviewer: { agent: f.draft.workerId, model: 'gpt-6-astra', effort: 'ultra' } } },
    { review: { reviewer: { agent: 'independent', model: 'other', effort: 'ultra' } } }, { review: { checks: [] } }
  ]) assert.equal(addVerification(f, patches).ok, false);
});

test('invalid JSON values and cyclic contracts fail deterministically without unsafe serialization', t => {
  const f = fixture(t);
  for (const contract of [{ value: undefined }, { value: NaN }, { value: () => true }, new Date(), { list: Array(1) }]) {
    assert.equal(buildFingerprint({ root: f.root, request: { ...f.request, contract } }).ok, false);
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(buildFingerprint({ root: f.root, request: { ...f.request, contract: cyclic } }).ok, false);
});

test('canonical rejects executable getters and proxies without invoking them', () => {
  let invoked = 0;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked++; return 1; } });
  assert.throws(() => canonical(getter), /accessors/);
  const handler = { get() { invoked++; return 1; }, ownKeys() { invoked++; return []; }, getPrototypeOf() { invoked++; return Object.prototype; } };
  assert.throws(() => canonical(new Proxy({}, handler)), /proxies/);
  assert.equal(invoked, 0);
});

test('every public API rejects top-level and nested accessors before reading files', t => {
  const f = fixture(t);
  let invoked = 0, reads = 0;
  const original = fs.realpathSync;
  fs.realpathSync = function (...args) { reads++; return original.apply(fs, args); };
  try {
    for (const api of [buildFingerprint, admitCandidate, decideReuse]) {
      for (const key of ['root', 'request', 'unused']) {
        const input = { ...f.input, record: f.record, target: { planId: 'target', taskId: 'target' } };
        Object.defineProperty(input, key, { enumerable: true, get() { invoked++; return f.input[key]; } });
        const result = api(input);
        assert.equal(result.ok === true || result.hit === true, false);
      }
      const input = { ...f.input, request: { ...f.request, contract: Object.defineProperty({}, 'criterion', { get() { invoked++; return 'ignored'; } }) }, record: f.record };
      const result = api(input);
      assert.equal(result.ok === true || result.hit === true, false);
    }
  } finally { fs.realpathSync = original; }
  assert.equal(invoked, 0);
  assert.equal(reads, 0);
});

test('public APIs reject nested proxies, sparse arrays, custom prototypes, and array getters', t => {
  const f = fixture(t);
  let invoked = 0;
  const handler = { get() { invoked++; throw Error('invoked'); }, getPrototypeOf() { invoked++; throw Error('invoked'); }, ownKeys() { invoked++; throw Error('invoked'); } };
  for (const api of [buildFingerprint, admitCandidate, decideReuse]) {
    for (const value of [new Proxy([], handler), Array(1), Object.setPrototypeOf([], Object.create(Array.prototype)), Object.defineProperty([], '0', { get() { invoked++; return f.request.sources[0]; } })]) {
      const result = api({ ...f.input, request: { ...f.request, sources: value }, record: f.record, target: { planId: 'target', taskId: 'target' } });
      assert.equal(result.ok === true || result.hit === true, false);
    }
    const result = api(new Proxy({}, handler));
    assert.equal(result.ok === true || result.hit === true, false);
  }
  assert.equal(invoked, 0);
});

test('missing own configuration never reads inherited Object.prototype defaults', t => {
  const f = fixture(t);
  let invoked = 0;
  const before = Object.getOwnPropertyDescriptor(Object.prototype, 'root');
  Object.defineProperty(Object.prototype, 'root', { configurable: true, get() { invoked++; return f.root; } });
  try {
    assert.equal(buildFingerprint({ request: f.request }).ok, false);
    assert.equal(admitCandidate({ request: f.request, output: f.output, receipt: f.receipt, now: NOW }).ok, false);
    assert.equal(f.lookup({ root: undefined }).hit, false);
  } finally {
    if (before) Object.defineProperty(Object.prototype, 'root', before);
    else delete Object.prototype.root;
  }
  assert.equal(invoked, 0);
});

test('source mutation immediately after descriptor close invalidates the fingerprint', t => {
  const f = fixture(t), target = path.join(f.root, f.request.sources[0].path);
  const originalOpen = fs.openSync, originalClose = fs.closeSync;
  const opened = new Map();
  let changed = false;
  fs.openSync = function (file, flags, ...rest) {
    const fd = originalOpen.call(fs, file, flags, ...rest);
    if (typeof flags === 'number') opened.set(fd, file);
    return fd;
  };
  fs.closeSync = function (fd) {
    const file = opened.get(fd); opened.delete(fd);
    const result = originalClose.call(fs, fd);
    if (!changed && file === target) { changed = true; fs.writeFileSync(target, 'module.exports = "modified after close";'); }
    return result;
  };
  let result;
  try { result = buildFingerprint({ root: f.root, request: f.request }); }
  finally { fs.openSync = originalOpen; fs.closeSync = originalClose; }
  assert.equal(changed, true);
  assert.equal(result.ok, false);
  assert.match(result.reason, /changed|stale/);
});

test('Windows case variants cannot alias source/output, input/receipt, or output/receipt', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), source = f.request.sources[0];
  const output = { ...source, path: source.path.toUpperCase() };
  const receipt = f.write('evidence/draft.json', { ...f.draft, output });
  const result = admitCandidate({ ...f.input, output, receipt });
  assert.equal(result.ok, false);
  assert.match(result.reason, /separate/);
  for (const aliased of [f.request.role, f.output]) {
    const receiptAlias = { ...aliased, path: aliased.path.toUpperCase() };
    const rejected = admitCandidate({ ...f.input, receipt: receiptAlias });
    assert.equal(rejected.ok, false);
    assert.match(rejected.reason, /separate/);
  }
});

test('a sparse array with a compensating extra key cannot consult an inherited descriptor accessor', () => {
  let invoked = 0, caught;
  const array = Array(1); array.extra = true;
  const before = Object.getOwnPropertyDescriptor(Object.prototype, '0');
  Object.defineProperty(Object.prototype, '0', { configurable: true, get() { invoked++; return undefined; } });
  try { canonical(array); }
  catch (error) { caught = error; }
  finally {
    if (before) Object.defineProperty(Object.prototype, '0', before);
    else delete Object.prototype[0];
  }
  assert.ok(caught);
  assert.match(caught.message, /holes/);
  assert.equal(invoked, 0);
});
