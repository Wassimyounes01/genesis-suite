'use strict';
const { createPlanGraph } = require('../index.cjs');
const graph = createPlanGraph({ capacity: 2, nodes: [
  { id: 'spec', task: 'write specification', dependsOn: [], owns: ['spec.md'] },
  { id: 'code', task: 'implement bounded module', dependsOn: ['spec'], owns: ['src/'] },
  { id: 'review', task: 'review implementation', dependsOn: ['code'], owns: [], readOnly: true }
] });
console.log({ validation: graph.validate(), firstWave: graph.ready([], []).ready.map(n => n.id), afterSpec: graph.ready(['spec'], []).ready.map(n => n.id) });
