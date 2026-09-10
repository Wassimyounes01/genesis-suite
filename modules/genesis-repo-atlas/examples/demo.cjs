'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('../index.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-atlas-demo-'));
fs.writeFileSync(path.join(root, 'README.md'), 'offline fixture');
try { fs.symlinkSync(path.join(root, 'README.md'), path.join(root, 'README-link'), 'file'); } catch (_) {}
const result = scan({ roots: [root], maxEntries: 25 });
console.log(JSON.stringify({ schema: result.schema, counts: result.counts, skippedSymlinks: result.skippedSymlinks.length, coverage: result.coverage }, null, 2));
fs.rmSync(root, { recursive: true, force: true });
