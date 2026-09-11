'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { compileBatch, validateBatchResult, LIMITS } = require('../lib/genesis-batch-drafts.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'batch-drafts-test-'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), parent); assert.ok(path.basename(target).startsWith('batch-drafts-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  const source = 'function first() { return 1; }\nfunction second() { return 2; }\nfunction third() { return 3; }\nfunction fourth() { return 4; }';
  write('source.cjs', source);
  const task = (id, line) => ({ id, task: 'Review the selected function for its stated behavior.', contract: { acceptance: ['Identify the returned value and evidence'], output: 'review-draft' }, operation: 'read-only-draft', dependencyMode: 'static', dependsOn: [],
    worker: { route: 'fixture-route', requestedModel: 'fixture-model', config: { effort: 'high' } }, sourcePaths: ['source.cjs'], selectors: [{ path: 'source.cjs', startLine: line }], expectedSourceHashes: { 'source.cjs': sha(source) }, effects: ['source-read'] });
  const input = { root, tasks: [task('first', 1), task('second', 2)], maxChars: LIMITS.maxChars };
  const result = (id, line, quote) => ({ id, verdict: 'safe', mechanism: 'The selected function returns its literal value.', evidence: [{ line, quote }], fix: 'No change is needed: the function returns the stated literal value directly without other branches.' });
  const valid = { results: [result('first', 1, 'return 1'), result('second', 2, 'return 2')] };
  return { root, write, source, task, input, result, valid, compile: patch => compileBatch({ ...input, ...patch }) };
}

test('compiles two independent drafts with one shared source acquisition and constraint catalog', t => {
  const f = fixture(t), batch = f.compile();
  assert.equal(batch.complete, true, JSON.stringify(batch.gaps));
  assert.equal(batch.status, 'draft'); assert.equal(batch.accepted, false); assert.equal(batch.needsFreshReview, true);
  assert.equal(batch.manifest.sourceFilesRead, 1);
  assert.equal(batch.manifest.sourceReadBytes, Buffer.byteLength(f.source));
  assert.equal(batch.manifest.sourcePaths.length, 1);
  assert.equal(batch.payload.constraints.rules.filter(rule => rule.id === 'path-containment').length, 1);
  assert.equal(batch.prompt.split('BEGIN_UNTRUSTED_BATCH').length, 2);
  assert.equal(batch.prompt.includes('BEGIN_UNTRUSTED_TASK_CONTEXT'), false);
  assert.equal(batch.prompt.includes(f.root), false);
  assert.match(batch.prompt, /no authority|grant no authority/);
  assert.equal(batch.measurements.tokensSaved, null); assert.equal(batch.measurements.costSaved, null);
});

test('four tasks share sources, merge ranges and fit one envelope with room for review context', t => {
  const f = fixture(t), batch = f.compile({ tasks: [1, 2, 3, 4].map((line, i) => f.task('task-' + i, line)) });
  assert.equal(batch.complete, true);
  assert.equal(batch.manifest.taskCount, 4);
  assert.equal(batch.manifest.sourceFilesRead, 1);
  assert.equal(batch.payload.sourceContext.excerpts.length, 1);
  assert.equal(batch.payload.sourceContext.excerpts[0].startLine, 1);
  assert.equal(batch.payload.sourceContext.excerpts[0].endLine, 4);
  assert.ok(batch.prompt.length < 14000);
});

test('four reviews with substantial shared source fit a roughly fourteen-kilobyte full envelope', t => {
  const f = fixture(t), tasks = [1, 2, 3, 4].map((line, i) => f.task('task-' + i, line));
  const source = [1, 2, 3, 4].map(line => 'const fixture' + line + ' = "' + 'x'.repeat(1700) + '";').join('\n');
  f.write('source.cjs', source);
  tasks.forEach(task => { task.expectedSourceHashes = { 'source.cjs': sha(source) }; });
  const batch = f.compile({ tasks, maxChars: 14500 });
  assert.equal(batch.complete, true, JSON.stringify(batch.gaps));
  assert.ok(batch.measurements.promptBytes < 14500);
  assert.ok(batch.measurements.promptBytes > 10000);
  assert.equal(batch.manifest.sourceFilesRead, 1);
});

test('identical selectors and effects deduplicate across tasks while keeping every ID', t => {
  const f = fixture(t), tasks = [f.task('first', 1), f.task('other', 1)];
  tasks[1].effects = ['source-read', 'source-read'];
  const batch = f.compile({ tasks });
  assert.equal(batch.complete, true);
  assert.equal(batch.manifest.uniqueSelectors, 1);
  assert.deepEqual(batch.payload.tasks.map(task => task.selectorIds), [[0], [0]]);
  assert.deepEqual(batch.manifest.taskIds, ['first', 'other']);
  assert.deepEqual(batch.manifest.effects, ['source-read']);
});

test('literal anchor selections resolve exact per-task evidence scope', t => {
  const f = fixture(t), tasks = clone(f.input.tasks);
  tasks[0].selectors = [{ path: 'source.cjs', anchor: 'first()' }];
  tasks[1].selectors = [{ path: 'source.cjs', anchor: 'second()' }];
  const batch = f.compile({ tasks });
  assert.equal(batch.complete, true);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid)).ok, true);
});

test('worker route, requested model, or config mismatch rejects the entire group', t => {
  const f = fixture(t);
  for (const [field, value] of [['route', 'other'], ['requestedModel', 'other'], ['config', { effort: 'low' }]]) {
    const tasks = clone(f.input.tasks); tasks[1].worker[field] = value;
    const batch = f.compile({ tasks });
    assert.equal(batch.complete, false); assert.equal(batch.prompt, '');
  }
});

test('live, external-action, missing independence, and dependent tasks cannot be batched', t => {
  const f = fixture(t);
  for (const patch of [{ dependencyMode: 'live' }, { operation: 'send-email' }, { operation: 'deploy' }, { dependsOn: ['first'] }, { dependsOn: null }]) {
    const tasks = clone(f.input.tasks); Object.assign(tasks[1], patch);
    assert.equal(f.compile({ tasks }).complete, false);
  }
});

test('task count, IDs, contract, config, paths, selectors and effect requirements fail closed', t => {
  const f = fixture(t);
  for (const tasks of [[], [f.task('one', 1)], Array.from({ length: 5 }, (_, i) => f.task('task-' + i, 1)), [f.task('same', 1), f.task('same', 2)]]) assert.equal(f.compile({ tasks }).complete, false);
  for (const patch of [{ id: 'bad\nid' }, { contract: {} }, { selectors: [] }, { sourcePaths: [] }, { effects: [] }, { worker: { route: 'r', requestedModel: 'm' } }, { accepted: true }]) {
    const tasks = clone(f.input.tasks); Object.assign(tasks[0], patch);
    assert.equal(f.compile({ tasks }).complete, false);
  }
});

test('conflicting expected hashes reject and current source mutations produce explicit gaps', t => {
  const f = fixture(t), tasks = clone(f.input.tasks);
  tasks[1].expectedSourceHashes['source.cjs'] = '0'.repeat(64);
  assert.match(f.compile({ tasks }).gaps[0].code, /Conflicting/);
  f.write('source.cjs', f.source + '\nchanged');
  const batch = f.compile();
  assert.equal(batch.complete, false); assert.equal(batch.prompt, '');
  assert.ok(batch.gaps.some(gap => gap.reason === 'source-hash-mismatch'));
});

test('paths and hashes outside a task cannot borrow another task source authorization', t => {
  const f = fixture(t);
  for (const patch of [{ selectors: [{ path: 'outside.cjs', startLine: 1 }] }, { expectedSourceHashes: { 'outside.cjs': '0'.repeat(64) } }, { sourcePaths: ['source.cjs', 'unselected.cjs'] }]) {
    const tasks = clone(f.input.tasks); Object.assign(tasks[0], patch);
    assert.equal(f.compile({ tasks }).complete, false);
  }
});

test('blocked credential content and protected source paths retain authoritative filtering', t => {
  const f = fixture(t); f.write('source.cjs', 'safe prefix\nconst apiKey = "fixture-sensitive";');
  const tasks = clone(f.input.tasks); tasks.forEach(task => { task.expectedSourceHashes = {}; });
  const batch = f.compile({ tasks });
  assert.equal(batch.complete, false); assert.equal(batch.prompt, '');
  assert.ok(batch.gaps.some(gap => gap.reason === 'credential-content'));
  assert.equal(JSON.stringify(batch).includes('fixture-sensitive'), false);
  tasks.forEach(task => { task.sourcePaths = ['.env']; task.selectors = [{ path: '.env', startLine: 1 }]; });
  assert.ok(f.compile({ tasks }).gaps.some(gap => gap.reason === 'secret-path'));
});

test('unknown constraint effects and missing selected lines remain incomplete with no partial dispatch', t => {
  const f = fixture(t), tasks = clone(f.input.tasks);
  tasks[0].effects = ['unknown-effect'];
  assert.equal(f.compile({ tasks }).complete, false);
  tasks[0].effects = ['source-read']; tasks[0].selectors[0].startLine = 999;
  const batch = f.compile({ tasks });
  assert.equal(batch.complete, false); assert.equal(batch.prompt, '');
  assert.deepEqual(batch.manifest.taskIds, ['first', 'second']);
  assert.ok(batch.gaps.some(gap => gap.reason === 'range-out-of-bounds'));
});

test('budget counts all contracts, sources, constraints and formatting as an indivisible batch', t => {
  const f = fixture(t), full = f.compile();
  const exact = f.compile({ maxChars: full.prompt.length });
  assert.equal(exact.complete, true); assert.equal(exact.prompt, full.prompt);
  const short = f.compile({ maxChars: full.prompt.length - 1 });
  assert.equal(short.complete, false); assert.equal(short.prompt, '');
  assert.equal(short.payload.tasks.length, 2);
  assert.ok(short.gaps.some(gap => gap.code === 'complete-batch-budget'));
  for (const maxChars of [0, 10, -1, NaN, 18001]) assert.equal(f.compile({ maxChars }).complete, false);
});

test('deterministic compilation preserves inputs and unknown Auto telemetry', t => {
  const f = fixture(t), tasks = clone(f.input.tasks);
  tasks.forEach(task => { task.worker.requestedModel = 'auto'; });
  const before = JSON.stringify(tasks), first = f.compile({ tasks }), second = f.compile({ tasks });
  assert.deepEqual(first, second); assert.equal(JSON.stringify(tasks), before);
  assert.match(first.manifest.identityBasis, /actual model and usage remain unknown/);
});

test('complete output validation preserves all drafts and never inherits acceptance', t => {
  const f = fixture(t), batch = f.compile(), result = validateBatchResult(batch, JSON.stringify(f.valid));
  assert.equal(result.ok, true, result.reason); assert.equal(result.outputs.length, 2);
  assert.equal(result.accepted, false); assert.equal(result.needsFreshReview, true);
  assert.equal(result.modelCallsExecuted, 0); assert.equal(result.tokensSaved, null);
  for (const output of result.outputs) { assert.equal(output.status, 'draft'); assert.equal(output.accepted, false); assert.equal(output.needsFreshReview, true); }
});

test('unsafe and insufficient-context verdicts remain drafts with bounded explanations', t => {
  const f = fixture(t), result = clone(f.valid);
  result.results[0].verdict = 'unsafe'; result.results[0].fix = 'Apply the missing guard.';
  result.results[1].verdict = 'insufficient-context'; result.results[1].evidence = [];
  result.results[1].fix = 'Supply the missing dependency implementation before deciding whether the contract holds.';
  assert.equal(validateBatchResult(f.compile(), JSON.stringify(result)).ok, true);
});

for (const verdict of ['safe', 'unsafe', 'insufficient-context']) {
  test(verdict + ' draft retains its nonempty contract-specific fix and explanation unchanged', t => {
    const f = fixture(t), tasks = clone(f.input.tasks), response = clone(f.valid);
    const first = response.results[0]; first.verdict = verdict;
    tasks[0].contract = { behavior: 'first must return the number 1 for every invocation.' };
    if (verdict === 'unsafe') {
      tasks[0].contract.behavior = 'first must return the number 2 for every invocation.';
      first.mechanism = 'The function returns 1 on its only path, which violates the required value 2.';
      first.fix = 'Replace return 1 with return 2 so the only path meets the contract.';
    } else if (verdict === 'insufficient-context') {
      const source = f.source.replace('return 1;', 'return helper();'); f.write('source.cjs', source);
      tasks.forEach(task => { task.expectedSourceHashes = { 'source.cjs': sha(source) }; });
      first.mechanism = 'The returned value comes from helper(), whose implementation is absent; the supplied function alone cannot establish a return value of 1.';
      first.evidence = [{ line: 1, quote: 'return helper()' }];
      first.fix = 'Supply the helper() implementation and its relevant dependencies to check whether every invocation returns 1.';
    } else {
      first.mechanism = 'The only path returns the number 1 directly and has no input-dependent branches, satisfying the required value on every call.';
      first.fix = 'No change is needed: the unconditional return 1 matches the contract for every invocation.';
    }
    const validated = validateBatchResult(f.compile({ tasks }), JSON.stringify(response));
    assert.equal(validated.ok, true, validated.reason);
    // The validator intentionally snapshots nested records onto null prototypes;
    // compare the public JSON data while retaining its executable-data protection.
    assert.deepEqual(clone(validated.outputs), response.results.map(item => ({ ...item, status: 'draft', accepted: false, needsFreshReview: true })));
    assert.equal(validated.accepted, false); assert.equal(validated.needsFreshReview, true);
  });

  test(verdict + ' blank, whitespace-only, missing or null fix rejects the complete batch', t => {
    const f = fixture(t), batch = f.compile();
    for (const position of [0, 1]) {
      for (const fix of ['', ' \t\r\n ', '\u00a0\u2003', null, undefined]) {
        const response = clone(f.valid); response.results[position].verdict = verdict;
        if (fix === undefined) delete response.results[position].fix;
        else response.results[position].fix = fix;
        const validated = validateBatchResult(batch, JSON.stringify(response));
        assert.equal(validated.ok, false, 'position ' + position + ', fix ' + JSON.stringify(fix));
        assert.match(validated.reason, /fix has invalid text/);
        assert.deepEqual(validated.outputs, []); assert.equal(validated.accepted, false);
      }
    }
  });
}

test('public header requires substantive explanations and fixes within the unchanged full prompt budget', t => {
  const f = fixture(t), full = f.compile();
  const header = full.prompt.slice(0, full.prompt.indexOf('BEGIN_UNTRUSTED_BATCH'));
  assert.match(header, /actionable correction or concrete contract-specific reason no change is needed/);
  assert.match(header, /For every verdict, fix must be nonempty/);
  assert.match(header, /insufficient-context must identify the missing context needed to decide/);
  assert.match(header, /decisive contract checks and edge cases/);
  assert.equal(header.includes('empty string'), false);
  assert.equal(LIMITS.maxChars, 18000); assert.equal(LIMITS.maxResultChars, 32000);
  assert.equal(full.measurements.requiredChars, full.prompt.length);
  assert.equal(f.compile({ maxChars: full.prompt.length }).complete, true);
  const short = f.compile({ maxChars: full.prompt.length - 1 });
  assert.equal(short.complete, false); assert.equal(short.prompt, '');
  assert.ok(short.gaps.some(gap => gap.code === 'complete-batch-budget' && gap.requiredChars === full.prompt.length));
});

test('missing, duplicate, extra, or unknown result IDs reject the whole response', t => {
  const f = fixture(t), batch = f.compile();
  for (const results of [[], [f.valid.results[0]], [f.valid.results[0], f.valid.results[0]], [...f.valid.results, f.valid.results[0]], [f.valid.results[0], { ...f.valid.results[1], id: 'other' }]]) {
    const result = validateBatchResult(batch, JSON.stringify({ results }));
    assert.equal(result.ok, false); assert.deepEqual(result.outputs, []);
  }
});

test('multiple JSON objects, markdown, duplicate keys and malformed JSON cannot override results', t => {
  const f = fixture(t), batch = f.compile(), valid = JSON.stringify(f.valid);
  for (const text of ['```json\n' + valid + '\n```', valid + valid, 'prefix ' + valid, valid + ' suffix', '{"results":[],"results":' + JSON.stringify(f.valid.results) + '}', valid.replace('"verdict":"safe"', '"verdict":"unsafe","verdict":"safe"'), '{"results":[]} trailing', '{']) {
    assert.equal(validateBatchResult(batch, text).ok, false, text.slice(0, 80));
  }
});

test('extra approval/review fields, bad verdicts and unbounded fields are rejected', t => {
  const f = fixture(t), batch = f.compile();
  for (const patch of [{ accepted: true }, { review: { verdict: 'pass' } }, { verdict: 'accepted' }, { mechanism: '' }, { mechanism: 'x'.repeat(1201) }, { fix: 'x'.repeat(1601) }, { evidence: [] }, { verdict: 'unsafe', fix: '' }]) {
    const result = clone(f.valid); Object.assign(result.results[0], patch);
    assert.equal(validateBatchResult(batch, JSON.stringify(result)).ok, false);
  }
  assert.equal(validateBatchResult(batch, JSON.stringify({ ...f.valid, accepted: true })).ok, false);
});

test('evidence cannot borrow a different task range, fabricate a quote, or use malformed fields', t => {
  const f = fixture(t), batch = f.compile();
  for (const evidence of [[{ line: 2, quote: 'return 2' }], [{ line: 1, quote: 'invented' }], [{ line: '1', quote: 'return 1' }], [{ line: 1, quote: 'return 1', path: 'source.cjs' }], [{ line: 1, quote: '' }], Array(13).fill({ line: 1, quote: 'return 1' })]) {
    const result = clone(f.valid); result.results[0].evidence = evidence;
    assert.equal(validateBatchResult(batch, JSON.stringify(result)).ok, false);
  }
});

test('incomplete or tampered batches cannot validate a successful draft response', t => {
  const f = fixture(t), batch = f.compile();
  for (const patch of [{ prompt: batch.prompt + 'changed' }, { accepted: true }, { complete: false }, { binding: '0'.repeat(64) }]) {
    assert.equal(validateBatchResult({ ...batch, ...patch }, JSON.stringify(f.valid)).ok, false);
  }
  assert.equal(validateBatchResult(f.compile({ maxChars: 10 }), JSON.stringify(f.valid)).ok, false);
});

test('public accessors, proxies, custom prototypes and sparse arrays are rejected before source reads', t => {
  const f = fixture(t); let invoked = 0, reads = 0;
  const original = fs.realpathSync;
  fs.realpathSync = function (...args) { reads++; return original.apply(fs, args); };
  try {
    const getter = { ...f.input }; Object.defineProperty(getter, 'root', { get() { invoked++; return f.root; } });
    assert.equal(compileBatch(getter).complete, false);
    const traps = { get() { invoked++; return 1; }, ownKeys() { invoked++; return []; }, getPrototypeOf() { invoked++; return Object.prototype; } };
    for (const input of [new Proxy(f.input, traps), { ...f.input, tasks: new Proxy([], traps) }, { ...f.input, tasks: Array(2) }, Object.assign(Object.create({ root: f.root }), f.input)]) assert.equal(compileBatch(input).complete, false);
    const tasks = clone(f.input.tasks); Object.defineProperty(tasks[0].contract, 'extra', { get() { invoked++; return 1; } });
    assert.equal(f.compile({ tasks }).complete, false);
  } finally { fs.realpathSync = original; }
  assert.equal(invoked, 0); assert.equal(reads, 0);
});

test('result validation rejects executable batch accessors without invoking them', t => {
  const f = fixture(t), batch = f.compile(); let invoked = 0;
  Object.defineProperty(batch, 'complete', { get() { invoked++; return true; } });
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid)).ok, false);
  assert.equal(invoked, 0);
});

test('sparse arrays with extra keys never consult inherited descriptor accessors', t => {
  const f = fixture(t), tasks = Array(2); tasks.extra = true; tasks.other = true;
  let invoked = 0, result;
  const before = Object.getOwnPropertyDescriptor(Object.prototype, '0');
  Object.defineProperty(Object.prototype, '0', { configurable: true, get() { invoked++; return undefined; } });
  try { result = f.compile({ tasks }); }
  finally { delete Object.prototype[0]; if (before) Object.defineProperty(Object.prototype, '0', before); }
  assert.equal(result.complete, false); assert.equal(invoked, 0);
});

function publicCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(publicCanonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + publicCanonical(value[key])).join(',') + '}';
}
function rebind(batch, rerender = false) {
  if (rerender) {
    const marker = 'BEGIN_UNTRUSTED_BATCH\n', at = batch.prompt.indexOf(marker) + marker.length;
    const presented = { ...batch.payload, sourceContext: { ...batch.payload.sourceContext,
      excerpts: batch.payload.sourceContext.excerpts.map(({ text, ...range }) => ({ ...range,
        numberedText: text.split('\n').map((line, index) => (range.startLine + index) + ' | ' + line).join('\n') })) } };
    batch.prompt = batch.prompt.slice(0, at) + JSON.stringify(presented) + '\nEND_UNTRUSTED_BATCH';
    batch.measurements.promptChars = batch.measurements.requiredChars = batch.prompt.length;
    batch.measurements.promptBytes = Buffer.byteLength(batch.prompt);
  }
  batch.promptSha256 = sha(batch.prompt);
  batch.binding = sha(publicCanonical({ manifest: batch.manifest, payload: batch.payload, prompt: batch.prompt }));
  return batch;
}

test('fabricated excerpt plus recomputed public checksum cannot contradict the actual prompt', t => {
  const f = fixture(t), batch = f.compile();
  const originalPrompt = batch.prompt;
  batch.payload.sourceContext.excerpts[0].text = 'FABRICATED';
  rebind(batch);
  const response = clone(f.valid); response.results[0].evidence = [{ line: 1, quote: 'FABRICATED' }];
  assert.equal(batch.prompt, originalPrompt);
  assert.equal(validateBatchResult(batch, JSON.stringify(response)).ok, false);
});

test('rerendered and rebound metadata must still match excerpt hashes, source entries and request ranges', t => {
  const f = fixture(t);
  for (const mutate of [
    batch => { batch.payload.sourceContext.excerpts[0].text = 'FABRICATED'; },
    batch => { batch.payload.sourceContext.excerpts[0].sha256 = '0'.repeat(64); },
    batch => { batch.payload.sourceContext.requests[0].id = 3; },
    batch => { batch.payload.sourceContext.requests[0].sourceIndex = 999; },
    batch => { batch.payload.sourceContext.entries[0].ranges[0].sha256 = '0'.repeat(64); },
    batch => { batch.payload.sourceContext.excerpts[0].endLine = 3; },
    batch => { batch.payload.tasks[0].selectorIds = [999]; },
    batch => { batch.payload.tasks[0].sourcePaths = ['another-source.cjs']; },
    batch => { batch.manifest.taskIds[0] = 'other'; }
  ]) {
    const batch = f.compile(); mutate(batch); rebind(batch, true);
    assert.equal(validateBatchResult(batch, JSON.stringify(f.valid)).ok, false);
  }
});

test('separately trusted request pins accept the original and reject a self-consistent replacement', t => {
  const f = fixture(t), batch = f.compile();
  const expected = { expectedBinding: batch.binding, expectedPromptSha256: batch.promptSha256 };
  const valid = validateBatchResult(batch, JSON.stringify(f.valid), expected);
  assert.equal(valid.ok, true); assert.match(valid.trustedRequestBinding, /separate expectation/);
  batch.payload.tasks[0].task += ' Changed task text.';
  rebind(batch, true);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), expected).ok, false);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), { expectedBinding: expected.expectedBinding }).ok, false);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), { expectedPromptSha256: expected.expectedPromptSha256 }).ok, false);
});

test('untrusted checksums are explicitly consistency only and cannot imply authenticated provenance', t => {
  const f = fixture(t), batch = f.compile(), result = validateBatchResult(batch, JSON.stringify(f.valid));
  assert.equal(result.ok, true);
  assert.match(result.trustedRequestBinding, /consistency only/);
  assert.match(result.evidenceBasis, /do not authenticate/);
  assert.equal(result.accepted, false);
  assert.equal(result.needsFreshReview, true);
});

test('validator rejects malformed or executable trusted-pin options and altered prompt measurements', t => {
  const f = fixture(t), batch = f.compile(); let invoked = 0;
  const expected = Object.defineProperty({}, 'expectedBinding', { get() { invoked++; return batch.binding; } });
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), expected).ok, false);
  assert.equal(invoked, 0);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), { expectedBinding: 'not-a-hash' }).ok, false);
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid), { trusted: true }).ok, false);
  batch.measurements.maxChars = 1;
  assert.equal(validateBatchResult(batch, JSON.stringify(f.valid)).ok, false);
});

test('prompt presents original line numbers once while payload hashes and evidence remain raw', t => {
  const f = fixture(t), tasks = [f.task('third', 3), f.task('fourth', 4)], batch = f.compile({ tasks });
  const marker = 'BEGIN_UNTRUSTED_BATCH\n', at = batch.prompt.indexOf(marker) + marker.length;
  const promptPayload = JSON.parse(batch.prompt.slice(at, -'\nEND_UNTRUSTED_BATCH'.length));
  const presented = promptPayload.sourceContext.excerpts[0], raw = batch.payload.sourceContext.excerpts[0];
  assert.equal(Object.hasOwn(presented, 'text'), false);
  assert.equal(Object.hasOwn(raw, 'numberedText'), false);
  assert.equal(presented.numberedText, '3 | function third() { return 3; }\n4 | function fourth() { return 4; }');
  assert.equal(raw.text, 'function third() { return 3; }\nfunction fourth() { return 4; }');
  assert.equal(raw.sha256, sha(raw.text));
  assert.equal(presented.sha256, raw.sha256);
  assert.notEqual(presented.sha256, sha(presented.numberedText));
  assert.match(batch.prompt, /line label, not source/);
  assert.equal(batch.measurements.promptChars, batch.prompt.length);
  const response = { results: [f.result('third', 3, 'return 3'), f.result('fourth', 4, 'return 4')] };
  assert.equal(validateBatchResult(batch, JSON.stringify(response)).ok, true);
  response.results[0].evidence[0].quote = '3 | function third()';
  assert.equal(validateBatchResult(batch, JSON.stringify(response)).ok, false);
});
