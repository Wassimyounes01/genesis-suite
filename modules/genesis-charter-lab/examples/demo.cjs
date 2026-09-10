'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCharterLab, evidenceDigest } = require('../index.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-charter-demo-'));
const lab = createCharterLab({ stateDir: dir, verifyEvidence: evidence => ({ ok: true, proofDigest: evidence.proofDigest, artifactId: evidence.artifactId, currentHash: evidence.currentHash, independentReview: true }) });
const candidate = lab.stage({ role: 'planner', text: 'Plan with an outcome, evidence and a bounded stop.', rationale: 'Offline demonstration.' });
for (let i = 0; i < 3; i++) { const taskId = `training-${i}`; lab.preregister({ candidateHash: candidate.hash, metric: 'quality', minimumRelativeGain: 0.05, taskId, split: 'train' }); const fields = { candidateHash: candidate.hash, baselineHash: candidate.baselineHash, taskId, split: 'train', metric: 'quality', minimumRelativeGain: 0.05, artifactId: `artifact-${taskId}`, currentHash: candidate.hash, measuredAt: new Date().toISOString(), baselineScore: 10, candidateScore: 11, regressions: 0 }; lab.recordEvidence({ ...fields, proofDigest: evidenceDigest(fields) }); }
lab.preregister({ candidateHash: candidate.hash, metric: 'quality', minimumRelativeGain: 0.05, taskId: 'holdout-1', split: 'holdout' }); const holdout = { candidateHash: candidate.hash, baselineHash: candidate.baselineHash, taskId: 'holdout-1', split: 'holdout', metric: 'quality', minimumRelativeGain: 0.05, artifactId: 'artifact-holdout-1', currentHash: candidate.hash, measuredAt: new Date().toISOString(), baselineScore: 10, candidateScore: 11, regressions: 0 }; lab.recordEvidence({ ...holdout, proofDigest: evidenceDigest(holdout) });
console.log(lab.promote({ candidateHash: candidate.hash }));
