'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preregisterExperiment, analyzeExperiment, normalizeCodexUsage, hash } = require('../lib/genesis-paired-experiments.cjs');
const H = 'a'.repeat(64), J = 'b'.repeat(64), K = 'c'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const spec = { schema:'genesis-paired-experiment-v1', id:'example', createdAt:'2026-09-11T12:00:00.000Z', scope:'diagnostic',
    worker:{route:'codex-luna',requestedModel:'gpt-5.6-luna',config:{effort:'low'}}, maxAttemptsPerRun:2,
    targets:{qualityMultiplier:2,tokenReduction:0.5},
    cases:[{id:'training',split:'training'},{id:'holdout',split:'holdout'}].map(item => ({...item,contractSha256:H,sourceSha256:J,rubricSha256:K,promptSha256:{baseline:H,candidate:J},maxScore:4})) };
  const registration = preregisterExperiment(spec);
  const runs = spec.cases.flatMap(item => ['baseline','candidate'].map(variant => ({
    caseId:item.id,variant,registrationSha256:registration.sha256,promptSha256:item.promptSha256[variant],sourceSha256:J,
    worker:clone(spec.worker),startedAt:'2026-09-11T12:01:00.000Z',historyComplete:true,
    attempts:[{sequence:1,status:'passed',actualModel:null,outputSha256:H,elapsedMs:100,
      usage:{input_tokens:variant==='baseline'?900:300,cached_input_tokens:0,output_tokens:100}}]
  })));
  const grades = runs.map(run => ({caseId:run.caseId,variant:run.variant,registrationSha256:registration.sha256,rubricSha256:K,
    independent:true,blinded:true,reviewerId:'review-agent',evidenceSha256:J,outputSha256:H,score:run.variant==='baseline'?2:4}));
  return {registration,runs,grades};
}
test('registered paired diagnostic scores and worker usage compare without inventing total cost', () => {
  const result=analyzeExperiment(fixture());
  assert.equal(result.complete,true); assert.equal(result.qualityMultiplier,2);
  assert.deepEqual(result.workerTokens,{baseline:2000,candidate:800});
  assert.equal(result.workerTokenReduction,0.6);
  assert.deepEqual(result.targets,{quality:true,workerTokens:true,wholePipeline:null});
  assert.equal(result.monetarySavings,null); assert.equal(result.pairs[0].sameActualModel,null);
  assert.equal(result.routingPolicyChanged,false); assert.equal(result.executionAuthorityGranted,false);
});
test('registration is detached and later spec changes fail digest validation', () => {
  const data=fixture(); data.registration.spec.targets.qualityMultiplier=1;
  assert.throws(()=>analyzeExperiment(data),/registered spec changed/);
});
test('canonical hashes ignore ordinary object key order',()=>assert.equal(hash({a:1,b:2}),hash({b:2,a:1})));
test('preregistered full-contract quality differs transparently from partial-score quality',()=>{
  const data=fixture();data.registration.spec.qualityMetric='full-contract-pass-rate';data.registration=preregisterExperiment(data.registration.spec);
  data.runs.forEach(run=>run.registrationSha256=data.registration.sha256);data.grades.forEach(grade=>grade.registrationSha256=data.registration.sha256);
  data.grades[0].score=4;data.grades[2].score=1;const result=analyzeExperiment(data);
  assert.equal(result.qualityMultiplier,2);assert.equal(result.scoreMultiplier,1.6);assert.deepEqual(result.passedCases,{baseline:1,candidate:2});
});
test('missing holdout and duplicate cases cannot be preregistered',()=>{
  const spec=fixture().registration.spec; spec.cases[1].split='training';
  assert.throws(()=>preregisterExperiment(spec),/holdout/);
  spec.cases[1].split='holdout'; spec.cases[1].id=spec.cases[0].id;
  assert.throws(()=>preregisterExperiment(spec),/duplicates/);
});
test('zero case score ceiling and invalid target reject',()=>{
  const spec=fixture().registration.spec; spec.cases[0].maxScore=0;
  assert.throws(()=>preregisterExperiment(spec),/positive/);
  spec.cases[0].maxScore=4; spec.targets.tokenReduction=1;
  assert.throws(()=>preregisterExperiment(spec),/token reduction/);
});
test('missing paired run preserves unknown complete totals',()=>{
  const data=fixture();data.runs.pop();data.grades.pop();const result=analyzeExperiment(data);
  assert.equal(result.complete,false);assert.equal(result.quality.candidate.score,null);
  assert.equal(result.workerTokens.candidate,null);assert.equal(result.targets.workerTokens,null);
});
test('successful ungraded output is not a quality result',()=>{
  const data=fixture();data.grades.pop();const result=analyzeExperiment(data);
  assert.equal(result.complete,false);assert.equal(result.qualityMultiplier,null);
});
test('failed executions receive zero quality and retain observed cost',()=>{
  const data=fixture();data.runs[1].attempts[0].status='failed';data.grades.splice(1,1);
  const result=analyzeExperiment(data);assert.equal(result.pairs[0].candidate.score,0);
  assert.deepEqual(result.regressions,['training']);assert.equal(result.targets.quality,false);
  assert.equal(result.workerTokens.candidate,800);
});
test('failed retries contribute tokens and elapsed time',()=>{
  const data=fixture();data.runs[1].attempts.unshift({sequence:1,status:'failed',actualModel:null,elapsedMs:500,usage:{input_tokens:150,output_tokens:50}});
  data.runs[1].attempts[1].sequence=2;const result=analyzeExperiment(data);
  assert.equal(result.workerTokens.candidate,1000);assert.equal(result.pairs[0].candidate.elapsedMs,600);
});
test('unknown retry usage leaves whole worker tokens unknown',()=>{
  const data=fixture();data.runs[1].attempts.unshift({sequence:1,status:'failed',actualModel:null,elapsedMs:500,usage:null});data.runs[1].attempts[1].sequence=2;
  const result=analyzeExperiment(data);assert.equal(result.workerTokens.candidate,null);assert.equal(result.workerTokenReduction,null);
});
test('observed incomplete failure telemetry is not treated as a complete token total',()=>{
  const data=fixture();data.runs[0].attempts[0].usageComplete=false;const result=analyzeExperiment(data);
  assert.equal(result.workerTokens.baseline,null);assert.equal(result.workerTokenReduction,null);
});
test('incomplete history cannot claim full quality or token comparison',()=>{
  const data=fixture();data.runs[0].historyComplete=false;const result=analyzeExperiment(data);
  assert.equal(result.complete,false);assert.equal(result.workerTokens.baseline,null);assert.equal(result.targets.quality,null);
});
test('sequence gaps and retries after success reject',()=>{
  const data=fixture();data.runs[0].attempts[0].sequence=2;assert.throws(()=>analyzeExperiment(data),/contiguous/);
  data.runs[0].attempts[0].sequence=1;data.runs[0].attempts.push({...data.runs[0].attempts[0],sequence:2});
  assert.throws(()=>analyzeExperiment(data),/after success/);
});
test('missing telemetry is not zero and cached tokens are not double counted',()=>{
  assert.deepEqual(normalizeCodexUsage(null),{inputTokens:null,cachedInputTokens:null,outputTokens:null,totalTokens:null,costUsd:null});
  assert.equal(normalizeCodexUsage({input_tokens:100,cached_input_tokens:80,output_tokens:20}).totalTokens,120);
  assert.equal(normalizeCodexUsage({input_tokens:100}).totalTokens,null);
});
test('invalid, negative and overflowing telemetry reject',()=>{
  for (const raw of [{input_tokens:-1},{input_tokens:3,cached_input_tokens:4},{input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1},{output_tokens:0.5}]) assert.throws(()=>normalizeCodexUsage(raw));
});
test('zero baseline quality has no multiplier',()=>{
  const data=fixture();data.grades.filter(g=>g.variant==='baseline').forEach(g=>g.score=0);
  const result=analyzeExperiment(data);assert.equal(result.qualityMultiplier,null);assert.equal(result.targets.quality,null);
});
test('zero baseline tokens have no reduction percentage',()=>{
  const data=fixture();data.runs.filter(r=>r.variant==='baseline').forEach(r=>r.attempts[0].usage={input_tokens:0,output_tokens:0});
  assert.equal(analyzeExperiment(data).workerTokenReduction,null);
});
test('supplied overhead can erase apparent worker savings',()=>{
  const data=fixture();data.overheadTokens={baseline:0,candidate:1600};
  const result=analyzeExperiment(data);assert.ok(Math.abs(result.wholePipelineTokenReduction+0.2)<1e-12);assert.equal(result.targets.wholePipeline,false);
});
test('known actual model mismatch blocks target conclusions',()=>{
  const data=fixture();data.runs.forEach(r=>r.attempts[0].actualModel=r.variant==='baseline'?'model-a':'model-b');
  const result=analyzeExperiment(data);assert.equal(result.pairs[0].sameActualModel,false);
  assert.equal(result.targets.quality,null);assert.equal(result.targets.workerTokens,null);
});
test('unknown retry identity cannot mask a known actual-model mismatch',()=>{
  const data=fixture();data.runs.forEach(r=>r.attempts[0].actualModel=r.variant==='baseline'?'model-a':'model-b');
  const candidate=data.runs[1];candidate.attempts.unshift({sequence:1,status:'failed',actualModel:null,usage:{input_tokens:1,output_tokens:0},elapsedMs:1});candidate.attempts[1].sequence=2;
  const result=analyzeExperiment(data);assert.equal(result.pairs[0].sameActualModel,false);assert.equal(result.targets.quality,null);
});
test('source, prompt, registration and worker mismatches reject',()=>{
  for(const key of ['sourceSha256','promptSha256','registrationSha256']){const data=fixture();data.runs[0][key]=K;assert.throws(()=>analyzeExperiment(data),/mismatch/);}
  const data=fixture();data.runs[0].worker.config.effort='high';assert.throws(()=>analyzeExperiment(data),/mismatch/);
});
test('execution before or at preregistration rejects',()=>{
  for(const startedAt of ['2026-09-11T11:59:00.000Z','2026-09-11T12:00:00.000Z']){const data=fixture();data.runs[0].startedAt=startedAt;assert.throws(()=>analyzeExperiment(data),/after preregistration/);}
});
test('duplicate runs and duplicate grades reject',()=>{
  const data=fixture();data.runs[1]=clone(data.runs[0]);assert.throws(()=>analyzeExperiment(data),/duplicate paired run/);
  const next=fixture();next.grades[1]=clone(next.grades[0]);assert.throws(()=>analyzeExperiment(next),/unique run/);
});
test('review output, rubric, reviewer declaration and score bindings reject tampering',()=>{
  for(const change of [{outputSha256:J},{rubricSha256:H},{independent:false},{blinded:false},{score:5}]){const data=fixture();Object.assign(data.grades[0],change);assert.throws(()=>analyzeExperiment(data));}
});
test('training and holdout quality remain separately visible',()=>{
  const result=analyzeExperiment(fixture());assert.deepEqual(result.splits.holdout,{cases:1,scores:{baseline:2,candidate:4}});
});
test('accessors and sparse arrays reject before getter execution',()=>{
  let invoked=false;const data=fixture();Object.defineProperty(data,'runs',{enumerable:true,get(){invoked=true;return[];}});
  assert.throws(()=>analyzeExperiment(data),/accessor/);assert.equal(invoked,false);
  const spec=fixture().registration.spec;spec.cases=new Array(2);assert.throws(()=>preregisterExperiment(spec),/dense JSON/);
});
test('deep nesting and non-JSON values are bounded',()=>{
  let value={};for(let i=0;i<14;i++)value={value};assert.throws(()=>hash(value),/nesting/);
  assert.throws(()=>hash({value:undefined}));assert.throws(()=>hash({value:NaN}));assert.throws(()=>hash({value:new Date()}));
});
test('proxy traps never execute during hashing or experiment input decoding',()=>{
  let effects=0;const proxy=new Proxy({a:1},{getPrototypeOf(target){effects++;return Object.getPrototypeOf(target);}});
  assert.throws(()=>hash(proxy),/proxies/);assert.equal(effects,0);
  assert.throws(()=>preregisterExperiment(proxy));assert.equal(effects,0);
  const revoked=Proxy.revocable({},{});revoked.revoke();assert.throws(()=>analyzeExperiment(revoked.proxy),/proxies/);
});
test('required limits and optional overhead cannot be supplied by inherited getters',()=>{
  const spec=fixture().registration.spec;delete spec.maxAttemptsPerRun;let invoked=0;
  Object.defineProperty(Object.prototype,'maxAttemptsPerRun',{configurable:true,get(){invoked++;return 2;}});
  try{assert.throws(()=>preregisterExperiment(spec),/attempt limit/);assert.equal(invoked,0);}finally{delete Object.prototype.maxAttemptsPerRun;}
  const data=fixture();Object.defineProperty(Object.prototype,'overheadTokens',{configurable:true,get(){invoked++;return{baseline:0,candidate:0};}});
  try{assert.equal(analyzeExperiment(data).wholePipelineTokenReduction,null);assert.equal(invoked,0);}finally{delete Object.prototype.overheadTokens;}
});
