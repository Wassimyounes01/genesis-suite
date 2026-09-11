'use strict';
const path = require('node:path');
const api = require('..');
const root = path.resolve(__dirname, '..');
const result = api.compileTaskContext({root, paths:['examples/source.cjs'], selectors:[{path:'examples/source.cjs',startLine:2}]});
if (!result.complete) throw Error(JSON.stringify(result.gaps));
console.log(result.prompt);
