'use strict';
const path = require('node:path');
const api = require('..');
const root = path.resolve(__dirname, '..');
const tasks=[1,2].map(line=>({id:'review-'+line,task:'Describe the selected function.',contract:{acceptance:['Quote the returned literal']},operation:'read-only-draft',dependencyMode:'static',dependsOn:[],worker:{route:'example-worker',requestedModel:'example-model',config:{}},sourcePaths:['examples/source.cjs'],selectors:[{path:'examples/source.cjs',startLine:line}],expectedSourceHashes:{},effects:['source-read']}));
const batch=api.compileBatch({root,tasks,maxChars:18000});
if (!batch.complete) throw Error(JSON.stringify(batch.gaps));
// Synthetic local responses demonstrate validation; no provider was called.
const response={results:[1,2].map(line=>({id:'review-'+line,verdict:'safe',mechanism:'The function returns the displayed literal.',evidence:[{line,quote:'return '+line}],fix:'No change is needed: this function directly returns the literal required by its contract.'}))};
const checked=api.validateBatchResult(batch,JSON.stringify(response),{expectedBinding:batch.binding,expectedPromptSha256:batch.promptSha256});
if(!checked.ok)throw Error(checked.reason);
console.log(JSON.stringify({synthetic:true,tasks:batch.manifest.taskCount,sourceReads:batch.manifest.sourceFilesRead,promptChars:batch.prompt.length,status:checked.status,accepted:checked.accepted},null,2));
