'use strict';
// Executable synthetic lifecycle fixture; never a claim of real reviewer approval.
const {spawnSync}=require('node:child_process');
console.log('Synthetic Evidence Collector lifecycle with real temporary files and checks.');
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const r=spawnSync(process.execPath,['--test','--test-reporter=tap','test/index.test.cjs'],{cwd:require('node:path').resolve(__dirname,'..'),stdio:'inherit',env,windowsHide:true,timeout:60000});
process.exitCode=r.status===0?0:1;
