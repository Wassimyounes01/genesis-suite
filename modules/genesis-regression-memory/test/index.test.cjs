'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRegression, resolveRegression, reopenRegression } = require('../index.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regression-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => fs.writeFileSync(path.join(root, file), data);
  const identity = file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) });
  write('subject.cjs', 'module.exports = { value: 0, count: 2 };');
  write('regression.test.cjs', "const t = require('node:test'); const a = require('node:assert/strict'); const s = require('./subject.cjs'); for (let i = 0; i < s.count; i++) t((s.label || 'retained example') + ' ' + i, () => a.equal(s.value, 1));");
  const reproducer = { command: 'node', argv: ['--test', '--test-reporter=tap', 'regression.test.cjs'], testPath: 'regression.test.cjs', artifacts: ['subject.cjs', 'regression.test.cjs'] };
  function receipt(name, change = () => {}) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, reproducer.argv, { cwd: root, encoding: 'utf8', env });
    assert.ifError(result.error); assert.equal(result.signal, null);
    write(`${name}.tap`, result.stdout);
    const count = key => Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)`, 'm'))[1]);
    const body = { schema: 'regression-run-v1', runId: name, command: reproducer.command,
      argv: reproducer.argv, testPath: reproducer.testPath, exitCode: result.status,
      checkedCount: count('pass') + count('fail'), failedCount: count('fail'),
      artifacts: reproducer.artifacts.map(identity), output: identity(`${name}.tap`) };
    change(body); write(`${name}.json`, JSON.stringify(body)); return identity(`${name}.json`);
  }
  const failure = receipt('failure');
  const input = { id: 'example-defect', summary: 'Retained example produces an incorrect value', reproducer, failure };
  const create = () => createRegression(input, { root });
  const fix = () => write('subject.cjs', 'module.exports = { value: 1, count: 2 };');
  return { root, write, identity, receipt, input, create, fix };
}
test('confirmed failure resolves against the same retained contract, persists and reopens on changed bytes', t => {
  const f = fixture(t); const original = f.create(); const before = clone(original);
  assert.equal(original.failure.failedCount, 2);
  assert.throws(() => createRegression(f.input, { root: f.root, records: [original] }), /Duplicate/);
  f.fix(); const resolved = resolveRegression(original, { root: f.root, passing: f.receipt('fixed') });
  assert.equal(resolved.status, 'resolved'); assert.deepEqual(original, before);
  assert.deepEqual(resolved.failure, original.failure);
  assert.deepEqual(reopenRegression(clone(resolved), { root: f.root }), resolved);
  assert.throws(() => resolveRegression(resolved, { root: f.root }), /already resolved/);
  f.write('subject.cjs', 'module.exports = { value: 0, count: 2 };');
  const reopened = reopenRegression(resolved, { root: f.root });
  assert.equal(reopened.status, 'open'); assert.equal(reopened.reopenings.length, 1);
  assert.equal(reopened.resolutions.length, 1); assert.deepEqual(reopened.failure, original.failure);
  f.fix(); const again = resolveRegression(reopened, { root: f.root, passing: f.receipt('fixed-again') });
  assert.equal(again.resolutions.length, 2); assert.deepEqual(again.failure, original.failure);
});
test('rejects claimed, absent, stale and successful failure evidence', t => {
  const f = fixture(t);
  for (const failure of [undefined, { verified: true }, { path: '../escape.json', sha256: 'a'.repeat(64) }])
    assert.throws(() => createRegression({ ...f.input, failure }, { root: f.root }));
  f.write('failure.tap', 'changed'); assert.throws(f.create, /Stale evidence/);
  f.input.failure = f.receipt('new-failure');
  f.write('subject.cjs', 'module.exports = { value: 0, count: 3 };'); assert.throws(f.create, /Stale evidence/);
  f.fix(); f.input.failure = f.receipt('success'); assert.throws(f.create, /failing checks/);
});
test('refuses missing passing evidence, mismatched contracts and weakened tests', t => {
  const f = fixture(t); const open = f.create(); f.fix();
  assert.throws(() => resolveRegression(open, { root: f.root }), /Missing evidence/);
  for (const change of [r => { r.command = 'other'; }, r => { r.argv = ['regression.test.cjs']; },
    r => { r.artifacts.pop(); }, r => { r.checkedCount = 200; }, r => { r.runId = 'failure'; }]) {
    const passing = f.receipt('invalid-pass', change);
    assert.throws(() => resolveRegression(open, { root: f.root, passing }));
  }
  f.write('subject.cjs', 'module.exports = { value: 1, count: 2, label: "different example" };');
  assert.throws(() => resolveRegression(open, { root: f.root, passing: f.receipt('renamed-checks') }), /check identities/);
  f.write('regression.test.cjs', "require('node:test')('weakened', () => {});");
  assert.throws(() => resolveRegression(open, { root: f.root, passing: f.receipt('weakened') }), /test changed/);
});
test('refuses zero checks, skips only, decreased counts and contradictory exit outcomes', t => {
  const f = fixture(t); const open = f.create();
  f.write('subject.cjs', 'module.exports = { value: 1, count: 1 };');
  assert.throws(() => resolveRegression(open, { root: f.root, passing: f.receipt('fewer') }), /lost relevant checks/);
  f.write('subject.cjs', 'module.exports = { value: 1, count: 0 };');
  assert.throws(() => resolveRegression(open, { root: f.root, passing: f.receipt('empty') }), /zero relevant checks/);
  f.write('regression.test.cjs', "require('node:test')('skipped', {skip: true}, () => {});");
  f.input.failure = f.receipt('skipped'); assert.throws(f.create, /zero relevant checks/);
  f.write('regression.test.cjs', "require('node:test')('bad', () => { throw Error('retained failure'); });");
  f.input.failure = f.receipt('false-success', r => { r.exitCode = 0; }); assert.throws(f.create, /Exit outcome/);
});
test('stale or removed proof reopens a resolution and historical failure tampering blocks closure', t => {
  const f = fixture(t); const open = f.create(); f.fix();
  const passing = f.receipt('fixed'); const resolved = resolveRegression(open, { root: f.root, passing });
  f.write('fixed.json', '{}'); assert.equal(reopenRegression(resolved, { root: f.root }).status, 'open');
  fs.unlinkSync(path.join(f.root, 'fixed.json'));
  assert.match(reopenRegression(resolved, { root: f.root }).reopenings[0].reason, /missing/);
  const tampered = clone(open); tampered.failure.checkedCount++;
  assert.throws(() => resolveRegression(tampered, { root: f.root, passing: f.receipt('another') }), /Original failure/);
  assert.throws(() => reopenRegression(resolved), /root is required/);
});
test('rejects altered stored contract and nonportable test or artifact paths', t => {
  const f = fixture(t); const open = f.create(); const altered = clone(open); altered.reproducer.command = 'other';
  assert.throws(() => resolveRegression(altered, { root: f.root }), /Contract identity/);
  for (const testPath of ['../outside.cjs', 'C:/outside.cjs', '/outside.cjs', 'dir\\file.cjs']) {
    const reproducer = { ...f.input.reproducer, testPath };
    assert.throws(() => createRegression({ ...f.input, reproducer }, { root: f.root }), /relative path/);
  }
});
test('cannot close against stale passing proof or proceed after missing historical failure', t => {
  const f = fixture(t); const open = f.create(); f.fix(); const passing = f.receipt('fixed');
  f.write('subject.cjs', 'module.exports = { value: 0, count: 2 };');
  assert.throws(() => resolveRegression(open, { root: f.root, passing }), /Stale evidence/);
  f.fix(); const resolved = resolveRegression(open, { root: f.root, passing });
  fs.unlinkSync(path.join(f.root, 'failure.tap'));
  assert.equal(reopenRegression(resolved, { root: f.root }).status, 'open');
  assert.throws(() => resolveRegression(open, { root: f.root, passing }));
});
test('a failing receipt placed in resolution history must reopen instead of retaining resolved status', t => {
  const f = fixture(t); const forged = f.create();
  forged.status = 'resolved'; forged.resolutions = [clone(forged.failure)];
  const reopened = reopenRegression(forged, { root: f.root });
  assert.equal(reopened.status, 'open'); assert.match(reopened.reopenings[0].reason, /Passing checks/);
  assert.deepEqual(reopened.failure, forged.failure);
});
test('retains actual check hierarchy, type and execution state across suite-to-test and skip substitutions', t => {
  const f = fixture(t);
  f.write('regression.test.cjs', "const {test,describe}=require('node:test'); const a=require('node:assert/strict'); const s=require('./subject.cjs'); const checks=()=>{test('original-failure',{skip:s.skip},()=>a.equal(s.value,1));test('passing-check',()=>a.equal(1,1));};if(s.flat){test('group',()=>{});checks();}else{describe('group',checks)}");
  f.write('subject.cjs', 'module.exports={value:0,flat:false,skip:false};');
  f.input.failure = f.receipt('suite-failure'); const open = f.create();
  assert.equal(open.failure.checkedCount, 2);
  assert.deepEqual(open.failure.checks[0], { names: ['group', 'original-failure'], type: 'test', state: 'failed' });
  f.write('subject.cjs', 'module.exports={value:0,flat:true,skip:true};');
  const passing = f.receipt('substituted');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, passing.path))).checkedCount, 2);
  assert.throws(() => resolveRegression(open, { root: f.root, passing }), /check identities or execution states/);
  f.write('subject.cjs', 'module.exports={value:1,flat:false,skip:false};');
  const resolved = resolveRegression(open, { root: f.root, passing: f.receipt('suite-fixed') });
  assert.equal(resolved.status, 'resolved');
  assert.equal(reopenRegression(resolved, { root: f.root }).status, 'resolved');
});
test('comments and summary counts cannot substitute for completed typed TAP result lines', t => {
  const f = fixture(t);
  const fake = 'TAP version 13\n# Subtest: never-executed\n1..1\n# tests 1\n# suites 0\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n';
  f.input.failure = f.receipt('comments-only', receipt => {
    f.write('comments-only.tap', fake); receipt.output = f.identity('comments-only.tap');
    receipt.checkedCount = 1; receipt.failedCount = 1;
  });
  assert.throws(f.create, /TAP/);
  f.input.failure = f.receipt('missing-types', receipt => {
    const file = path.join(f.root, 'missing-types.tap');
    f.write('missing-types.tap', fs.readFileSync(file, 'utf8').replace(/^ *type: 'test'\r?\n/gm, ''));
    receipt.output = f.identity('missing-types.tap');
  });
  assert.throws(f.create, /complete typed check results/);
});
test('descriptor reads remain bounded when an artifact grows after size inspection', t => {
  const f = fixture(t); const target = path.join(f.root, 'subject.cjs');
  const initialSize = fs.statSync(target).size; const large = Buffer.alloc(8 * 1024 * 1024 + 1, 65);
  const receiptFile = path.join(f.root, f.input.failure.path);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  receipt.artifacts.find(item => item.path === 'subject.cjs').sha256 = sha(large);
  f.write(f.input.failure.path, JSON.stringify(receipt)); f.input.failure = f.identity(f.input.failure.path);
  const original = { open: fs.openSync, stat: fs.fstatSync, read: fs.readSync };
  let descriptor = null, grew = false, requested = 0;
  fs.openSync = function (file, flags, ...rest) {
    const fd = original.open.call(fs, file, flags, ...rest);
    if (file === target && typeof flags === 'number') descriptor = fd;
    return fd;
  };
  fs.fstatSync = function (fd, ...rest) {
    const stat = original.stat.call(fs, fd, ...rest);
    if (fd === descriptor && !grew) { grew = true; f.write('subject.cjs', large); }
    return stat;
  };
  fs.readSync = function (fd, buffer, offset, length, position) {
    if (fd === descriptor) requested += length;
    return original.read.call(fs, fd, buffer, offset, length, position);
  };
  try { assert.throws(f.create, /changed during bounded read/); }
  finally { fs.openSync = original.open; fs.fstatSync = original.stat; fs.readSync = original.read; }
  assert.equal(grew, true); assert.ok(requested <= initialSize + 1);
  assert.throws(f.create, /bounded regular file/);
});
test('a stable descriptor cannot attest a different file renamed over the current artifact path', t => {
  const f = fixture(t); const open = f.create(); f.fix(); const passing = f.receipt('fixed');
  const target = path.join(f.root, 'subject.cjs'), replacement = path.join(f.root, 'replacement.cjs');
  f.write('replacement.cjs', 'module.exports = { value: 0, count: 2 };');
  const original = fs.openSync; let replaced = false;
  fs.openSync = function (file, flags, ...rest) {
    const fd = original.call(fs, file, flags, ...rest);
    if (file === target && typeof flags === 'number' && !replaced) {
      replaced = true; fs.renameSync(target, path.join(f.root, 'original.cjs')); fs.renameSync(replacement, target);
    }
    return fd;
  };
  try { assert.throws(() => resolveRegression(open, { root: f.root, passing }), /changed during bounded read/); }
  finally { fs.openSync = original; }
  assert.equal(replaced, true); assert.match(fs.readFileSync(target, 'utf8'), /value: 0/);
});
