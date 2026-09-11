'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {collectEvidence, readProof} = require('../index.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const write = (name, value) => fs.writeFileSync(path.join(root,name), typeof value === 'string' ? value : JSON.stringify(value));
  write('code.cjs','module.exports = 42;');
  const artifacts = [readProof(root,'code.cjs').proof];
  const check = {schema:'genesis-check-v1',planId:'p',taskId:'t',criterion:'works',command:'node --test test.cjs',status:'passed',exitCode:0,checkedCount:2,expectedCount:2,artifacts};
  write('check.json',check);
  const review = {schema:'genesis-review-v1',planId:'p',taskId:'t',verdict:'pass',reviewer:{agent:'reviewer',model:'review-model',effort:'high'},artifacts,checks:[readProof(root,'check.json').proof]};
  write('review.json',review);
  const input = {root,planId:'p',taskId:'t',worker:'worker',criteria:['works'],artifactPaths:['code.cjs'],checkPaths:['check.json'],reviewPath:'review.json',requiredReviewer:{model:'review-model',effort:'high'}};
  return {root,write,artifacts,check,review,input};
}
test('collects real file hashes into exact receipt references', t => {const f=fixture(t), r=collectEvidence(f.input);assert.equal(r.ok,true);assert.equal(r.outcome.checks.length,1);assert.equal(r.outcome.review.evidence.sha256,readProof(f.root,'review.json').proof.sha256);});
test('missing review stays incomplete',t=>{const f=fixture(t);delete f.input.reviewPath;assert.equal(collectEvidence(f.input).outcome,null);});
test('changed artifact invalidates checks and review',t=>{const f=fixture(t);f.write('code.cjs','changed');assert.equal(collectEvidence(f.input).ok,false);});
test('zero tests and nonzero exit never pass',t=>{for(const patch of [{checkedCount:0,expectedCount:0},{exitCode:1},{status:'failed'}]){const f=fixture(t);f.write('check.json',{...f.check,...patch});assert.equal(collectEvidence(f.input).ok,false);}});
test('duplicate criteria and missing acceptance fail',t=>{const f=fixture(t);assert.throws(()=>collectEvidence({...f.input,criteria:['works','works']}));assert.equal(collectEvidence({...f.input,criteria:['works','other']}).ok,false);});
test('wrong reviewer, task and altered receipt fail',t=>{for(const patch of [{taskId:'other'},{reviewer:{agent:'worker',model:'review-model',effort:'high'}},{checks:[]}]){const f=fixture(t);f.write('review.json',{...f.review,...patch});assert.equal(collectEvidence(f.input).ok,false);}});
test('recheck binding required when requested',t=>{const f=fixture(t);assert.equal(collectEvidence({...f.input,recheckRevisionIds:['rev-one']}).ok,false);});
test('path traversal, aliases and sensitive paths rejected',t=>{const f=fixture(t);for(const p of ['../outside','C:/private','a/../code.cjs','.env','credentials.json'])assert.throws(()=>readProof(f.root,p));});
test('oversized proof rejected',t=>{const f=fixture(t);f.write('big.txt','x'.repeat(2*1024*1024+1));assert.throws(()=>readProof(f.root,'big.txt'));});
test('explicit reviewer requirement cannot silently downgrade',t=>{const f=fixture(t);delete f.input.requiredReviewer;assert.throws(()=>collectEvidence(f.input));});
test('revision substring cannot replace exact array membership',t=>{const f=fixture(t);f.write('check.json',{...f.check,recheckRevisionIds:'prefix-rev-one-suffix'});assert.equal(collectEvidence({...f.input,recheckRevisionIds:['rev-one']}).ok,false);assert.throws(()=>collectEvidence({...f.input,recheckRevisionIds:'rev-one'}));});
test('proof cannot follow a directory junction to protected content',t=>{const f=fixture(t);fs.mkdirSync(path.join(f.root,'hidden'));f.write('hidden/.env','private fixture');f.write('hidden/code.cjs','module.exports = 1;');fs.symlinkSync(path.join(f.root,'hidden'),path.join(f.root,'alias'),process.platform==='win32'?'junction':'dir');assert.throws(()=>readProof(f.root,'alias/code.cjs'),/aliases/);assert.throws(()=>readProof(f.root,'alias/.env'));});
