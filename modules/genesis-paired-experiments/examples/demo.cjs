'use strict';
const path = require('node:path');
const api = require('..');
const root = path.resolve(__dirname, '..');
const h=api.hash({fixture:true});
const registration=api.preregisterExperiment({schema:'genesis-paired-experiment-v1',id:'demo',createdAt:'2026-01-01T00:00:00.000Z',scope:'diagnostic',worker:{route:'example-worker',requestedModel:'example-model',config:{}},maxAttemptsPerRun:1,targets:{qualityMultiplier:1,tokenReduction:0},cases:[{id:'training',split:'training'},{id:'holdout',split:'holdout'}].map(item=>({...item,contractSha256:h,sourceSha256:h,rubricSha256:h,promptSha256:{baseline:h,candidate:h},maxScore:1}))});
const result=api.analyzeExperiment({registration,runs:[],grades:[]});
if (result.complete || result.workerTokenReduction!==null) throw Error('Missing observations must stay unknown');
console.log(JSON.stringify({registered:registration.sha256,complete:result.complete,workerTokenReduction:result.workerTokenReduction,usage:api.normalizeCodexUsage(null)},null,2));
