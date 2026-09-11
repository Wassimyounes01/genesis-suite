'use strict';
const path = require('node:path');
const api = require('..');
const root = path.resolve(__dirname, '..');
const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
const demoRoot=fs.mkdtempSync(path.join(os.tmpdir(),'reuse-demo-'));
const proof=(name,value)=>{fs.writeFileSync(path.join(demoRoot,name),value);return {path:name,sha256:crypto.createHash('sha256').update(value).digest('hex')};};
const source=proof('source.cjs','module.exports = 1;'),role=proof('role.txt','Review supplied source only.'),policy=proof('policy.txt','Return draft candidates; require fresh review.');
const request={objective:'Describe the export',contract:{acceptance:['Identify literal']},sources:[source],worker:{provider:'example',model:'example-model',config:{}},role,policies:[policy],outputSchema:{type:'string'},operation:'read-only-draft',dependencyMode:'static',freshness:{ttlMs:60000}};
const fingerprint=api.buildFingerprint({root:demoRoot,request});
if(!fingerprint.ok)throw Error(fingerprint.reason);
const output=proof('draft.txt','The module exports 1.'),now=Date.now();
// Synthetic persisted candidate, never claimed as actual provider or review evidence.
const receipt=proof('draft.json',JSON.stringify({schema:api.RECEIPT_SCHEMA,status:'draft',operation:'read-only-draft',fingerprint:fingerprint.fingerprint,planId:'demo',taskId:'source',workerId:'fixture',worker:request.worker,output,createdAt:new Date(now-1).toISOString(),expiresAt:new Date(now+59000).toISOString()}));
const admitted=api.admitCandidate({root:demoRoot,request,output,receipt,now});
if(!admitted.ok)throw Error(admitted.reason);
const reused=api.decideReuse({root:demoRoot,request,record:admitted.record,target:{planId:'demo',taskId:'target'},now});
if(!reused.hit||reused.accepted)throw Error('Draft reuse failed');
console.log(JSON.stringify({synthetic:true,hit:reused.hit,status:reused.status,accepted:reused.accepted,needsFreshReview:reused.needsFreshReview,tokensSaved:reused.tokensSaved},null,2));
