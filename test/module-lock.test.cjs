'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('vendored files match the portable byte manifest on every platform',()=>{
 const root=path.resolve(__dirname,'../modules');
 const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'../modules-lock.json'),'utf8'));
 assert.equal(lock.modules.length,16);
 for(const module of lock.modules)for(const proof of module.files){
  const file=path.resolve(root,module.name,proof.path),relative=path.relative(root,file);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  assert.equal(fs.lstatSync(file).isFile(),true);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),proof.sha256,module.name+'/'+proof.path);
 }
});
