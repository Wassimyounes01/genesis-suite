'use strict';
// Read-only lifecycle. An authorized runner writes regression-run-v1 receipts and
// TAP output; this module never generates tests, executes commands or writes files.
// Hashes prove byte identity, not honest authorship or completeness of test scope.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function requireValue(condition, message) { if (!condition) throw Error(message); }
function relative(value) {
  requireValue(typeof value === 'string' && value.length <= 300 && value.length > 0 &&
    !/[\\:\x00-\x1f]/.test(value) && !path.posix.isAbsolute(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid relative path');
  return value;
}
function digest(value) { requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Invalid SHA-256'); return value; }
function proof(value) { requireValue(value && typeof value === 'object', 'Missing evidence proof'); return { path: relative(value.path), sha256: digest(value.sha256) }; }
function read(root, filename, limit = 8 * 1024 * 1024) {
  requireValue(typeof root === 'string' && root.length > 0, 'Evidence root is required');
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(path.resolve(base, relative(filename)));
  const inside = path.relative(base, target);
  requireValue(inside && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside), 'Evidence escapes root');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    requireValue(stat.isFile() && stat.size <= limit, 'Evidence must be a bounded regular file');
    const buffer = Buffer.alloc(stat.size + 1); let bytes = 0, count;
    do { count = fs.readSync(fd, buffer, bytes, buffer.length - bytes, bytes); bytes += count; }
    while (count > 0 && bytes < buffer.length);
    const after = fs.fstatSync(fd), current = fs.statSync(target);
    requireValue(bytes === stat.size && current.isFile() &&
      ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => stat[key] === after[key] && stat[key] === current[key]) &&
      fs.realpathSync(path.resolve(base, filename)) === target, 'Evidence changed during bounded read');
    return buffer.subarray(0, bytes);
  } finally { fs.closeSync(fd); }
}
function checkedBytes(root, identity, limit) {
  const expected = proof(identity); const bytes = read(root, expected.path, limit);
  requireValue(hash(bytes) === expected.sha256, `Stale evidence: ${expected.path}`);
  return bytes;
}
function contract(input) {
  requireValue(input && typeof input.command === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.command), 'Invalid executable name');
  requireValue(Array.isArray(input.argv) && input.argv.length > 0 && input.argv.length <= 64 &&
    input.argv.every(arg => typeof arg === 'string' && arg.length <= 1000 && !/[\x00-\x1f]/.test(arg)), 'Invalid argument array');
  const testPath = relative(input.testPath);
  requireValue(input.argv.includes(testPath), 'Command must name the test path');
  requireValue(Array.isArray(input.artifacts) && input.artifacts.length > 0 && input.artifacts.length <= 100, 'Artifact scope is required');
  const artifacts = input.artifacts.map(relative).sort();
  requireValue(new Set(artifacts).size === artifacts.length && artifacts.includes(testPath), 'Artifact scope must uniquely include test path');
  return { command: input.command, argv: [...input.argv], testPath, artifacts };
}
function tapCounts(output) {
  requireValue(/^TAP version 13\r?$/m.test(output), 'TAP output is required');
  const counts = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    requireValue(matches.length === 1, `Missing or ambiguous TAP ${key} count`);
    counts[key] = Number(matches[0][1]);
    requireValue(Number.isSafeInteger(counts[key]), 'Invalid TAP count');
  }
  requireValue(counts.cancelled === 0 && counts.tests === counts.pass + counts.fail + counts.skipped + counts.todo &&
    counts.pass + counts.fail > 0, 'Run has zero relevant checks or incomplete counts');
  return counts;
}
// Parse the Node TAP reporter subset, including hierarchy, result lines, plans
// and diagnostic test/suite type. Unsupported or incomplete transcripts fail closed.
function tapChecks(output, counts, testPath) {
  const root = { depth: -4, names: [], next: 1, planned: false };
  const stack = [root], checks = []; let diagnostic = null;
  for (const line of output.split(/\r?\n/)) {
    requireValue(!/^\s*Bail out!/i.test(line), 'Incomplete TAP execution');
    let match = line.match(/^( *)# Subtest: (.+)$/);
    if (match) {
      const parent = stack.at(-1), depth = match[1].length;
      requireValue(depth === parent.depth + 4 && depth <= 512 && !parent.planned, 'Invalid TAP check hierarchy');
      stack.push({ depth, names: [...parent.names, match[2]], next: 1, planned: false }); diagnostic = null; continue;
    }
    match = line.match(/^( *)(not ok|ok) ([1-9]\d*) - (.+?)(?: # (SKIP|TODO)\b.*)?$/i);
    if (match) {
      const frame = stack.pop(), parent = stack.at(-1);
      requireValue(parent && frame.depth === match[1].length && frame.names.at(-1) === match[4] &&
        Number(match[3]) === parent.next++ && (frame.next === 1 || frame.planned), 'TAP result does not match declared check');
      diagnostic = { names: frame.names, type: null,
        state: match[5] ? match[5].toLowerCase() : match[2] === 'ok' ? 'passed' : 'failed', depth: frame.depth };
      checks.push(diagnostic); continue;
    }
    match = line.match(/^( *)1\.\.(\d+)$/);
    if (match) {
      const parent = stack.at(-1);
      requireValue(parent.depth + 4 === match[1].length && !parent.planned && parent.next - 1 === Number(match[2]), 'TAP plan disagrees with results');
      parent.planned = true; diagnostic = null; continue;
    }
    match = line.match(/^( *)type: ['"](test|suite)['"]$/);
    if (match && diagnostic && match[1].length === diagnostic.depth + 2) {
      requireValue(diagnostic.type === null, 'Ambiguous TAP check type'); diagnostic.type = match[2];
    }
  }
  requireValue(stack.length === 1 && root.planned && checks.length > 0 && checks.every(check => check.type), 'TAP requires complete typed check results');
  const tests = checks.filter(check => check.type === 'test');
  requireValue(tests.length === counts.tests && checks.length - tests.length === counts.suites &&
    ['passed', 'failed', 'skip', 'todo'].every((state, i) => tests.filter(check => check.state === state).length === counts[['pass', 'fail', 'skipped', 'todo'][i]]), 'TAP results disagree with summary counts');
  requireValue(tests.some(check => {
    const name = check.names.at(-1).replace(/\\/g, '/');
    return name !== testPath && name !== path.posix.basename(testPath) && !name.endsWith(`/${testPath}`);
  }), 'Run has zero relevant checks: no explicit named tests');
  return checks.map(({ names, type, state }) => ({ names, type, state }));
}
function loadEvidence(identity, root, expected, currentArtifacts = true) {
  const receipt = proof(identity);
  const run = JSON.parse(checkedBytes(root, receipt, 256 * 1024).toString('utf8'));
  requireValue(run && run.schema === 'regression-run-v1' && typeof run.runId === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,79}$/.test(run.runId), 'Invalid run receipt');
  requireValue(run.command === expected.command && JSON.stringify(run.argv) === JSON.stringify(expected.argv) &&
    run.testPath === expected.testPath, 'Run does not match reproducible contract');
  requireValue(Array.isArray(run.artifacts), 'Run artifacts are required');
  const artifacts = run.artifacts.map(proof).sort((a, b) => a.path.localeCompare(b.path));
  requireValue(JSON.stringify(artifacts.map(item => item.path).sort()) === JSON.stringify(expected.artifacts), 'Run artifact scope mismatch');
  if (currentArtifacts) for (const artifact of artifacts) checkedBytes(root, artifact);
  const output = proof(run.output);
  requireValue(output.path !== receipt.path && !expected.artifacts.includes(output.path) &&
    !expected.artifacts.includes(receipt.path), 'Run evidence must be separate from tested artifacts');
  const tap = checkedBytes(root, output).toString('utf8');
  const counts = tapCounts(tap);
  const checks = tapChecks(tap, counts, expected.testPath);
  requireValue(run.checkedCount === counts.pass + counts.fail && run.failedCount === counts.fail, 'Receipt check counts mismatch TAP output');
  requireValue(Number.isInteger(run.exitCode) && run.exitCode >= 0 && run.exitCode <= 255 &&
    (run.exitCode === 0 ? counts.fail === 0 : counts.fail > 0), 'Exit outcome disagrees with checks');
  return { receipt, runId: run.runId, command: run.command, argv: [...run.argv], testPath: run.testPath,
    exitCode: run.exitCode, checkedCount: run.checkedCount, failedCount: run.failedCount, checks, artifacts, output };
}
function validatePassing(failure, result, testSha256) {
  requireValue(result.exitCode === 0 && result.failedCount === 0, 'Passing checks are required');
  requireValue(result.artifacts.find(item => item.path === result.testPath).sha256 === testSha256, 'Regression test changed; register a new contract');
  requireValue(result.checkedCount >= failure.checkedCount, 'Passing run lost relevant checks');
  const expected = failure.checks.map(check => ({ ...check, state: check.state === 'failed' ? 'passed' : check.state }));
  requireValue(JSON.stringify(result.checks) === JSON.stringify(expected), 'Passing run changed retained check identities or execution states');
  requireValue(result.runId !== failure.runId && result.receipt.path !== failure.receipt.path, 'Run evidence must be independent');
}
function validateRecord(record) {
  requireValue(record && record.schema === 'regression-memory-v1' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(record.id) &&
    typeof record.summary === 'string' && record.summary.trim().length > 0 && record.summary.length <= 2000, 'Invalid regression record');
  const expected = contract(record.reproducer);
  requireValue(record.contractHash === hash(JSON.stringify(expected)) && record.testSha256 === digest(record.testSha256), 'Contract identity mismatch');
  requireValue(['open', 'resolved'].includes(record.status) && Array.isArray(record.resolutions) && Array.isArray(record.reopenings) &&
    (record.status !== 'resolved' || record.resolutions.length > 0), 'Invalid regression lifecycle');
  requireValue(record.failure && record.failure.exitCode > 0, 'Confirmed failure is required');
  requireValue(record.failure.artifacts?.find(item => item.path === expected.testPath)?.sha256 === record.testSha256, 'Original test identity changed');
  return expected;
}
function createRegression(input, { root, records = [] } = {}) {
  requireValue(input && typeof input.id === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.id), 'Invalid regression ID');
  requireValue(Array.isArray(records) && !records.some(record => record.id === input.id), 'Duplicate regression ID');
  requireValue(typeof input.summary === 'string' && input.summary.trim() && input.summary.length <= 2000, 'Summary is required');
  const reproducer = contract(input.reproducer);
  const failure = loadEvidence(input.failure, root, reproducer);
  requireValue(failure.exitCode > 0 && failure.failedCount > 0, 'Confirmed failing checks are required');
  return { schema: 'regression-memory-v1', id: input.id, summary: input.summary.trim(), status: 'open',
    reproducer, contractHash: hash(JSON.stringify(reproducer)),
    testSha256: failure.artifacts.find(item => item.path === reproducer.testPath).sha256,
    failure, resolutions: [], reopenings: [] };
}
function resolveRegression(record, { root, passing } = {}) {
  const expected = validateRecord(record);
  requireValue(record.status === 'open', 'Regression is already resolved');
  const failure = loadEvidence(record.failure.receipt, root, expected, false);
  requireValue(JSON.stringify(failure) === JSON.stringify(record.failure), 'Original failure evidence changed');
  const result = loadEvidence(passing, root, expected);
  validatePassing(failure, result, record.testSha256);
  requireValue(![failure, ...record.resolutions].some(run => run.runId === result.runId || run.receipt.path === result.receipt.path), 'Run evidence must be independent');
  const next = copy(record); next.status = 'resolved'; next.resolutions.push(result); return next;
}
function reopenRegression(record, { root } = {}) {
  requireValue(typeof root === 'string' && root.length > 0, 'Evidence root is required');
  const expected = validateRecord(record); const next = copy(record);
  if (record.status === 'open') return next;
  try {
    requireValue(JSON.stringify(loadEvidence(record.failure.receipt, root, expected, false)) === JSON.stringify(record.failure), 'Original failure evidence changed');
    const latest = record.resolutions.at(-1);
    const current = loadEvidence(latest.receipt, root, expected);
    requireValue(JSON.stringify(current) === JSON.stringify(latest), 'Resolution evidence changed');
    validatePassing(record.failure, current, record.testSha256);
  } catch (error) {
    next.status = 'open';
    // Keep path-independent reasons portable; the original receipt remains intact.
    next.reopenings.push({ resolutionRunId: record.resolutions.at(-1).runId, reason: error.code === 'ENOENT' ? 'Evidence file missing' : error.message });
  }
  return next;
}
module.exports = { createRegression, resolveRegression, reopenRegression };
