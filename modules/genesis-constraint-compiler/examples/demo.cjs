'use strict';
const path = require('node:path');
const api = require('..');
const root = path.resolve(__dirname, '..');
const result = api.compileConstraints({taskType:'source-review',effects:['source-read','provider-task'],maxChars:8000});
if (!result.complete) throw Error('Incomplete candidate constraints');
console.log(result.prompt);
