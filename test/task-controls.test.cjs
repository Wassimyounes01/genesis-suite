'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {modules}=require('..');
test('all six added APIs are available',()=>{for(const [key,fn] of [["sourcePackets","buildSourcePacket"],["evidenceCollector","collectEvidence"],["regressionMemory","createRegression"],["routingMetrics","analyzeRoutingMetrics"],["changeImpact","analyzeChangeImpact"],["releaseIntegrity","inspectRelease"]])assert.equal(typeof modules[key][fn],'function');});
test('source, impact and release controls work together in a consumer',()=>{const r=spawnSync(process.execPath,['examples/task-controls.cjs'],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).sourceFiles,1);});
