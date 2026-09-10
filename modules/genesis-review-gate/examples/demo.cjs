'use strict';
const { createReviewGate } = require('../index.cjs');
const gate = createReviewGate({ deadlineMs: 1000 });
const adapter = {
  async find() { return { provider: { name: 'offline-example', model: 'fixture' }, findings: [{ id: 'example', severity: 'low', title: 'Example finding', description: 'A demonstrator finding', evidence: 'fixture input' }] }; },
  async refute() { return { status: 'refuted', reason: 'The example fixture is intentionally covered.' }; },
};
gate.review({ artifactId: 'demo', artifact: { task: 'offline review' } }, adapter).then(result => console.log(JSON.stringify(result, null, 2)));
