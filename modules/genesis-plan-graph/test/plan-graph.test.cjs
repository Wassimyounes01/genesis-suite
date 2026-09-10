'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanGraph, validateGraph } = require('../index.cjs');
const node = (id, dependsOn = [], owns = [id + '.txt']) => ({ id, task: id, dependsOn, owns });

test('checks dependencies and returns bounded ready work with disjoint ownership', () => {
  const graph = createPlanGraph({ capacity: 2, nodes: [node('a'), node('b'), node('c', ['a'], ['c.txt']), node('d', ['a'], ['c.txt'])] });
  assert.deepEqual(graph.topologicalOrder(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(graph.ready([], []).ready.map(n => n.id), ['a', 'b']);
  assert.deepEqual(graph.ready(['a'], []).ready.map(n => n.id), ['b', 'c']);
  assert.deepEqual(graph.ready(['a'], ['b']).ready.map(n => n.id), ['c']);
});

test('rejects cycles, missing dependencies, unsafe ownership and capacity overflow', () => {
  assert.throws(() => createPlanGraph({ nodes: [node('a', ['b']), node('b', ['a'])] }), /cycle/);
  assert.throws(() => createPlanGraph({ nodes: [node('a', ['missing'])] }), /unknown dependency/);
  assert.throws(() => createPlanGraph({ nodes: [{ ...node('a'), owns: ['../secret'] }] }), /workspace-relative/);
  const graph = createPlanGraph({ capacity: 1, nodes: [node('a'), node('b')] });
  assert.throws(() => graph.ready([], ['a', 'b']), /capacity/);
});

test('validation is bounded and read-only nodes may have no ownership', () => {
  assert.equal(validateGraph([{ id: 'inspect', task: 'inspect', dependsOn: [], owns: [], readOnly: true }], { capacity: 1 }).ok, true);
  assert.equal(validateGraph([{ id: 'bad', task: 'bad', dependsOn: [], owns: [] }]).ok, false);
});

test('enforces configured dependency depth', () => {
  assert.throws(() => createPlanGraph({ maxDepth: 2, nodes: [node('a'), node('b', ['a']), node('c', ['b'])] }), /depth exceeds bound/);
});
