'use strict';
const {analyzeChangeImpact}=require('..');
const manifest={schemaVersion:1,entries:[{path:'lib/core.cjs',kind:'file',dependsOn:[]},{path:'test/core.test.cjs',kind:'test',dependsOn:['lib/core.cjs']},{path:'docs/api.md',kind:'doc',dependsOn:['lib/core.cjs']}]};
console.log(JSON.stringify(analyzeChangeImpact(manifest,['lib/core.cjs']),null,2));
