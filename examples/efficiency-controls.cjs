'use strict';
const {modules}=require('..');
const names=[["taskContext","compileTaskContext"],["constraintCompiler","compileConstraints"],["verifiedReuse","buildFingerprint"],["pairedExperiments","preregisterExperiment"],["batchDrafts","compileBatch"]];
for(const [key,method]of names)if(typeof modules[key][method]!=='function')throw Error('Missing API '+key);
const result=modules.constraintCompiler.compileConstraints({taskType:'review',effects:['source-read']});
if(!result.complete)throw Error('Candidate compilation failed');
console.log(JSON.stringify({components:Object.keys(modules).length,additionalApis:names.map(item=>item[0]),verification:result.verification},null,2));
