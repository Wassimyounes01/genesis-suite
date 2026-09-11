'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'FILES.json'),'utf8'));
const seen=[];function walk(dir,prefix=''){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.name==='.git')continue;const rel=prefix?prefix+'/'+item.name:item.name;if(item.isSymbolicLink())throw Error('Alias in export');if(item.isDirectory())walk(path.join(dir,item.name),rel);else seen.push(rel);}}walk(root);
const expected=manifest.files.map(item=>item.path).concat('FILES.json').sort();if(JSON.stringify(seen.sort())!==JSON.stringify(expected))throw Error('File inventory drift');
for(const item of manifest.files){const file=path.resolve(root,item.path),relative=path.relative(root,file);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Escaping proof');if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)throw Error('Changed file: '+item.path);}
console.log(JSON.stringify({ok:true,files:manifest.files.length}));
