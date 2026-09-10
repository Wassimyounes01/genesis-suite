'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createContextGraph, digest } = require('../index.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-context-'));
  const sourceRoot = path.join(dir, 'sources'); fs.mkdirSync(sourceRoot);
  const source = path.join(sourceRoot, 'source.md'); fs.writeFileSync(source, 'approved source');
  const evidence = path.join(sourceRoot, 'evaluation.json'); fs.writeFileSync(evidence, JSON.stringify({ passed: true }));
  const approval = path.join(sourceRoot, 'approval.json'); fs.writeFileSync(approval, JSON.stringify({ kind: 'user-approval', approved: true, cardId: 'card-1', messageRef: 'approval-1', quote: 'Approved for the workflow example.', artifactSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex'), attributeIds: ['trait-1'] }));
  const proof = file => ({ path: path.basename(file), sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  return { dir, sourceRoot, source: proof(source), evidence: proof(evidence), approval: proof(approval), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function card(f) { return { id: 'card-1', task: { id: 'task-1', label: 'bounded acceptance', domain: 'workflow' }, artifact: f.source, attributes: [{ id: 'trait-1', label: 'bounded checks', mechanism: 'bind each result to a criterion', tags: ['evidence', 'checks'], appliesTo: ['workflow'], contraindications: [], evidence: f.evidence }], approval: { messageRef: 'approval-1', receipt: f.approval } }; }

test('registers explicit approval and matches only fresh approved sources', () => {
  const f = fixture();
  try {
    const graph = createContextGraph({ stateDir: f.dir, sourceRoot: f.sourceRoot });
    assert.deepEqual(graph.registerCard(card(f)).userApproved, true);
    const result = graph.query({ goal: 'bounded evidence checks', domain: 'workflow', requireUserApproval: true });
    assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].userApproved, true);
    assert.equal(graph.revalidateCandidate(result.candidates[0]).valid, true);
  } finally { f.cleanup(); }
});

test('rejects approval without a real receipt and excludes stale source after mutation', () => {
  const f = fixture();
  try {
    const graph = createContextGraph({ stateDir: f.dir, sourceRoot: f.sourceRoot });
    const invalid = card(f); invalid.approval.receipt = { path: 'approval.json', sha256: '0'.repeat(64) };
    assert.throws(() => graph.registerCard(invalid), /approval receipt|stale/);
    graph.registerCard(card(f));
    fs.writeFileSync(path.join(f.sourceRoot, 'source.md'), 'tampered source');
    const result = graph.query({ goal: 'bounded evidence' });
    assert.equal(result.candidates.length, 0); assert.match(result.excluded[0].reasons[0], /source artifact/);
    assert.equal(graph.snapshot().nodes.find(node => node.type === 'artifact').status, 'stale');
  } finally { f.cleanup(); }
});

test('requires target revalidation and keeps cards immutable', () => {
  const f = fixture();
  try {
    const graph = createContextGraph({ stateDir: f.dir, sourceRoot: f.sourceRoot }); graph.registerCard(card(f));
    const candidate = graph.query({ goal: 'bounded checks' }).candidates[0];
    assert.equal(graph.revalidateCandidate({ ...candidate, mechanism: 'changed' }).valid, false);
    assert.throws(() => graph.registerCard({ ...card(f), task: { ...card(f).task, label: 'changed' } }), /immutable/);
  } finally { f.cleanup(); }
});

test('keeps ordinary unapproved reuse distinct and rejects source-root symlink escapes', () => {
  const f = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-context-outside-'));
  try {
    const graph = createContextGraph({ stateDir: f.dir, sourceRoot: f.sourceRoot });
    const unapproved = card(f); unapproved.id = 'unapproved-card'; unapproved.approval = undefined; unapproved.task = { ...unapproved.task, id: 'unapproved-task' };
    assert.equal(graph.registerCard(unapproved).userApproved, false);
    assert.equal(graph.query({ goal: 'bounded checks', domain: 'workflow' }).candidates.find(item => item.cardId === 'unapproved-card').userApproved, false);
    assert.equal(graph.query({ goal: 'bounded checks', domain: 'workflow', requireUserApproval: true }).candidates.some(item => item.cardId === 'unapproved-card'), false);
    fs.writeFileSync(path.join(outside, 'outside.md'), 'outside source');
    try { fs.symlinkSync(path.join(outside, 'outside.md'), path.join(f.sourceRoot, 'link.md')); } catch { return; }
    const escaped = { ...unapproved, id: 'escaped-card', task: { ...unapproved.task, id: 'escaped-task' }, artifact: { path: 'link.md', sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(outside, 'outside.md'))).digest('hex') } };
    assert.throws(() => graph.registerCard(escaped), /unavailable|stale/);
  } finally { f.cleanup(); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('returns immutable stored transfer proposals on replay', () => {
  const f = fixture();
  try {
    const graph = createContextGraph({ stateDir: f.dir, sourceRoot: f.sourceRoot }); graph.registerCard(card(f));
    const first = graph.recordTransfer({ id: 'transfer-1', sourceCardId: 'card-1', attributeId: 'trait-1', targetTaskId: 'target-a', reason: 'test transfer' });
    const duplicate = graph.recordTransfer({ id: 'transfer-1', sourceCardId: 'card-1', attributeId: 'trait-1', targetTaskId: 'target-a', reason: 'test transfer', status: 'candidate' });
    assert.equal(duplicate.targetTaskId, first.targetTaskId); assert.equal(duplicate.status, 'candidate'); assert.equal(duplicate.duplicate, true);
    assert.throws(() => graph.recordTransfer({ id: 'transfer-1', sourceCardId: 'card-1', attributeId: 'trait-1', targetTaskId: 'target-b', reason: 'test transfer', status: 'accepted' }), /immutable/);
    const originalRename = fs.renameSync; fs.renameSync = () => { throw new Error('injected rename failure'); };
    try { assert.throws(() => graph.recordTransfer({ id: 'transfer-2', sourceCardId: 'card-1', attributeId: 'trait-1', targetTaskId: 'target-c', reason: 'rollback' }), /injected rename failure/); } finally { fs.renameSync = originalRename; }
    assert.equal(graph.snapshot().edges.filter(edge => edge.type === 'candidate-transfer').length, 1);
  } finally { f.cleanup(); }
});
