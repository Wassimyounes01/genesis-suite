'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { createContextGraph } = require('../index.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-context-demo-')); const sourceRoot = path.join(dir, 'sources'); fs.mkdirSync(sourceRoot);
const write = (name, value) => { const file = path.join(sourceRoot, name); fs.writeFileSync(file, value); return { path: name, sha256: crypto.createHash('sha256').update(value).digest('hex') }; };
try {
  const artifact = write('source.txt', 'bounded source'); write('evaluation.json', '{"passed":true}');
  const approval = write('approval.json', JSON.stringify({ kind: 'user-approval', approved: true, cardId: 'demo-card', messageRef: 'demo-approval', quote: 'Approved for this fictional workflow.', artifactSha256: artifact.sha256, attributeIds: ['trait'] }));
  const graph = createContextGraph({ stateDir: dir, sourceRoot });
  graph.registerCard({ id: 'demo-card', task: { id: 'source-task', label: 'source task', domain: 'workflow' }, artifact, attributes: [{ id: 'trait', label: 'bounded evidence', mechanism: 'require a passing receipt', tags: ['evidence'], appliesTo: ['workflow'], contraindications: [] }], approval: { messageRef: 'demo-approval', receipt: approval } });
  console.log(graph.query({ goal: 'bounded evidence', domain: 'workflow' }));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
