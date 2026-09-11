'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {modules}=require('..');
test('all five additional APIs are exported without replacing the original sixteen',()=>{assert.equal(Object.keys(modules).length,21);for(const[key,method]of [["taskContext","compileTaskContext"],["constraintCompiler","compileConstraints"],["verifiedReuse","buildFingerprint"],["pairedExperiments","preregisterExperiment"],["batchDrafts","compileBatch"]])assert.equal(typeof modules[key][method],'function');});
test('candidate constraints remain advisory through the suite export',()=>{const result=modules.constraintCompiler.compileConstraints({taskType:'review',effects:['source-read']});assert.equal(result.complete,true);assert.equal(result.verification.checksRun,0);assert.equal(result.lessonStatus,'candidate');});
