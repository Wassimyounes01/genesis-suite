'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPass } = require('../index.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-night-demo-'));
  const at = Date.parse('2026-01-15T03:00:00Z');
  // Keep the demo deterministic and offline: a caller-owned callback is the only worker.
  const result = await runPass({ stateDir: root, now: at, isPaused: false, isGaming: false, worker: async request => ({ ok: true, value: { question: request.question, summary: 'Offline demo candidate.', sources: [{ url: 'https://example.com/demo', title: 'Example source', claim: 'Candidate requires independent validation.' }] } }) });
  console.log(JSON.stringify({ status: result.status, dispatched: result.dispatched, sourceCandidates: result.sourceCandidates }, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
