'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGenesis,modules}=require('../index.cjs');
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-suite-demo-'));
 try{
  let calls=0;
  const artifactRoot=path.join(temp,'artifacts');
  const suite=createGenesis({stateDir:path.join(temp,'state'),artifactRoot,providers:[{name:'offline-worker',accountId:'fixture',invoke:async()=>({ok:true,text:JSON.stringify({schema:1,label:'Offline demonstration',revision:++calls}),actualModel:null,monetaryCost:null})}],reviewer:{id:'offline-reviewer',adapter:{find:async({artifact})=>{if(JSON.parse(artifact.text).schema!==1)throw new Error('Schema review failed');return {provider:{name:'offline-reviewer',model:'deterministic-fixture'},findings:[]};},refute:async()=>({status:'refuted',reason:'Unused in the no-findings fixture.'})}}});
  suite.registerPlan({id:'demo',objective:'Demonstrate connected evidence and adaptation',tasks:[{id:'compose',objective:'Produce schema JSON',criteria:[{id:'valid-schema',description:'Output is JSON with schema equal to one'}],dependsOn:[]},{id:'extend',objective:'Reuse the schema convention in another artifact',criteria:[{id:'valid-schema',description:'Output is JSON with schema equal to one'}],dependsOn:['compose']}]});
  const check=({text})=>{const result=JSON.parse(text);return {command:'JSON.parse and assert schema === 1',exitCode:result.schema===1?0:1,checkedCount:1,expectedCount:1};};
  const first=await suite.runTask('demo','compose',{check});
  if(!first.accepted)throw new Error(JSON.stringify(first));
  const checkpoint=suite.checkpoint({planId:'demo',taskId:'compose',eventId:'simulated-feedback',kind:'user-feedback',summary:'Offline simulated feedback: preserve the schema while producing a fresh revision.'});
  suite.decide(checkpoint.revision.revisionId,{decision:'accept',actor:'offline-coordinator',reason:'Exercise during-task rechecking in this demonstrator.'});
  const revised=await suite.runTask('demo','compose',{check});
  if(!revised.accepted)throw new Error(JSON.stringify(revised));
  suite.context.registerCard({id:'schema-source',task:{id:'compose',label:'Schema JSON convention',domain:'code'},artifact:revised.artifacts[0],attributes:[{id:'schema',label:'Schema version',mechanism:'Use an explicit schema version in generated JSON.',tags:['schema','json'],appliesTo:['*'],contraindications:[]}]});
  const candidates=suite.context.query({goal:'reuse schema JSON'});
  const second=await suite.runTask('demo','extend',{check,contextQuery:{goal:'reuse schema JSON'}});
  if(!second.accepted)throw new Error(JSON.stringify(second));
  const atlas=suite.scan({roots:[artifactRoot],maxEntries:20,maxMetadataBytes:10000});
  const charter=suite.charters.stage({role:'worker',text:'Preserve the schema and state which acceptance check was executed.',rationale:'Candidate only; benchmark evaluation has not run.'});
  const research=await suite.researchPass({now:Date.parse('2026-09-10T16:00:00Z'),isGaming:false,isPaused:false});
  console.log(JSON.stringify({mode:'offline fixtures; no model or network call',moduleCount:Object.keys(modules).length,first:{accepted:first.accepted,reward:first.reward},adapted:{accepted:revised.accepted,reward:revised.reward,recheckRequired:suite.adaptation.isRecheckRequired('demo','compose')},dependent:{accepted:second.accepted,contextCandidates:second.contextCandidates},reuse:{candidates:candidates.returned,userApproval:candidates.candidates[0]?.userApproved??false,targetTransfer:'requires target-specific checks'},atlas:{entries:atlas.counts.entries,semanticCoverage:atlas.semanticCoverageClaim},charter:{status:charter.status,activeChanged:false},research:{dispatched:research.dispatched,reasons:research.reasons},workersActive:suite.snapshot().workers.active},null,2));
 }finally{const resolved=path.resolve(temp);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('genesis-suite-demo-'))throw new Error('Unexpected cleanup target');fs.rmSync(resolved,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
