'use strict';
// Receipt assembly only: never runs commands, invents reviewers, or grants rewards.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 2 * 1024 * 1024;
function boundedList(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length || value.some(x => typeof x !== 'string' || !x.trim())) throw Error(label + ' requires 1..100 unique strings');
  return value;
}
function readProof(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p === '.' || !p) || /(^|\/)(\.env(?:\.|$)|\.git$)|secret|credential/i.test(relative)) throw Error('Invalid or protected proof path');
  const file = fs.realpathSync(path.resolve(root, relative));
  const local = path.relative(root, file);
  if (local.startsWith('..') || path.isAbsolute(local)) throw Error('Proof escapes root');
  let cursor = root;
  for (const part of relative.split('/')) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Proof aliases are not permitted'); }
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw Error('Proof must be a bounded nonempty file');
    const buffer = Buffer.alloc(MAX_BYTES + 1); let size = 0, count;
    while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
    if (size > MAX_BYTES) throw Error('Proof grew beyond limit');
    const bytes = buffer.subarray(0, size);
    return { proof: { path: relative, sha256: sha(bytes) }, bytes };
  } finally { fs.closeSync(fd); }
}
function sameProofs(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return false;
  const normalize = list => list.map(p => p && typeof p.path === 'string' && /^[a-f0-9]{64}$/.test(p.sha256) ? p.path + ':' + p.sha256 : 'invalid');
  const x = normalize(a), y = normalize(b);
  return !x.includes('invalid') && !y.includes('invalid') && new Set(x.map(v => v.split(':')[0])).size === x.length && x.sort().join('\n') === y.sort().join('\n');
}
function collectEvidence(input) {
  const root = fs.realpathSync(input.root);
  for (const field of ['planId', 'taskId', 'worker']) if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 160) throw Error(field + ' required');
  const criteria = boundedList(input.criteria, 'criteria');
  const artifactPaths = boundedList(input.artifactPaths, 'artifactPaths');
  const checkPaths = boundedList(input.checkPaths, 'checkPaths');
  const validRevisions = value => Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length && value.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,159}$/i.test(id));
  if (input.recheckRevisionIds !== undefined && !validRevisions(input.recheckRevisionIds)) throw Error('Invalid recheck revision IDs');
  const artifacts = artifactPaths.map(p => readProof(root, p).proof);
  const failures = [], checks = [], seen = new Set();
  for (const file of checkPaths) {
    const loaded = readProof(root, file), receipt = JSON.parse(loaded.bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (receipt.schema !== 'genesis-check-v1' || receipt.planId !== input.planId || receipt.taskId !== input.taskId || !criteria.includes(receipt.criterion) || seen.has(receipt.criterion)) { failures.push('Check contract mismatch: ' + file); continue; }
    seen.add(receipt.criterion);
    if (receipt.status !== 'passed' || typeof receipt.command !== 'string' || !receipt.command.trim() || receipt.exitCode !== 0 || !Number.isSafeInteger(receipt.checkedCount) || receipt.checkedCount <= 0 || receipt.checkedCount !== receipt.expectedCount || !sameProofs(receipt.artifacts, artifacts)) failures.push('Failed, empty or stale check: ' + file);
    if (receipt.recheckRevisionIds !== undefined && !validRevisions(receipt.recheckRevisionIds)) failures.push('Invalid receipt revision IDs: ' + file);
    if ((input.recheckRevisionIds || []).some(id => !receipt.recheckRevisionIds?.includes(id))) failures.push('Missing recheck revision: ' + file);
    checks.push({ criterion: receipt.criterion, evidence: loaded.proof });
  }
  if (criteria.some(c => !seen.has(c))) failures.push('Missing acceptance criteria');
  let review = null;
  if (input.reviewPath) {
    const loaded = readProof(root, input.reviewPath), receipt = JSON.parse(loaded.bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const expected = input.requiredReviewer;
    if (!expected || typeof expected.model !== 'string' || !expected.model || typeof expected.effort !== 'string' || !expected.effort) throw Error('Explicit requiredReviewer model and effort required');
    if (receipt.schema !== 'genesis-review-v1' || receipt.planId !== input.planId || receipt.taskId !== input.taskId || receipt.verdict !== 'pass' || typeof receipt.reviewer?.agent !== 'string' || !receipt.reviewer.agent.trim() || receipt.reviewer.agent === input.worker || receipt.reviewer.model !== expected.model || receipt.reviewer.effort !== expected.effort || !sameProofs(receipt.artifacts, artifacts) || !sameProofs(receipt.checks, checks.map(c => c.evidence))) failures.push('Independent review missing, stale or unbound');
    else review = { evidence: loaded.proof };
  } else failures.push('Independent review required');
  // Read again so changes while assembling receipts cannot silently pass.
  if (!sameProofs(artifacts, artifactPaths.map(p => readProof(root, p).proof))) failures.push('Artifacts changed during collection');
  const ok = failures.length === 0;
  return { schema: 'genesis-evidence-bundle-v1', ok, failures, artifacts, checks, review,
    outcome: ok ? { planId: input.planId, taskId: input.taskId, worker: input.worker, status: 'complete', artifacts, checks, review, regression: false } : null,
    provenance: 'Receipt integrity and coordinator-attested identity; not cryptographic reviewer authentication. Final acceptance belongs to the governing runtime.' };
}
module.exports = { collectEvidence, readProof, sameProofs };
