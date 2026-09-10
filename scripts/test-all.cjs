'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const packages=fs.readdirSync(path.join(root,'modules')).filter(n=>n.startsWith('genesis-')).sort();
let failed=false;
for(const name of [...packages,'.']) {
 const dir=name==='.'?root:path.join(root,'modules',name);
 const tests=fs.readdirSync(path.join(dir,'test')).filter(f=>f.endsWith('.test.cjs')).map(f=>path.join('test',f));
 if(!tests.length)throw new Error('Tests missing: '+name);
 process.stdout.write('\nTesting '+(name==='.'?'genesis-suite':name)+'\n');
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...tests],{cwd:dir,stdio:'inherit',timeout:60000,windowsHide:true});
 if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
