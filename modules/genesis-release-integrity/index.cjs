'use strict';
// An explicit text-file release manifest. No directory scan, network or mutation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const privateEmail = value => (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).some(x=>!/@(?:[\w-]+\.)*(?:example\.(?:com|org|net|invalid)|test\.invalid)$/i.test(x));
const credentialPattern = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/;
function inspectRelease({root, files, forbiddenTerms = []}) {
  root = fs.realpathSync(root);
  if (!Array.isArray(files) || !files.length || files.length > 500 || new Set(files).size !== files.length) throw Error('Release requires 1..500 unique explicit paths');
  if (!Array.isArray(forbiddenTerms) || forbiddenTerms.length > 100 || forbiddenTerms.some(x=>typeof x !== 'string'||x.length<3||x.length>200)) throw Error('Invalid forbidden terms');
  const manifest=[], findings=[]; let total=0;
  for (const relative of files) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(x=>!x||x==='.'||x==='..') || /(^|\/)(\.git|\.env(?:\..*)?|node_modules|memory|credentials?)(\/|$)/i.test(relative)) throw Error('Unsafe release path');
    if(privateEmail(relative)||credentialPattern.test(relative)||forbiddenTerms.some(term=>relative.toLowerCase().includes(term.toLowerCase())))throw Error('Private release filename');
    const file=fs.realpathSync(path.join(root,relative)), local=path.relative(root,file);
    if (local.startsWith('..') || path.isAbsolute(local)) throw Error('Release file escapes root');
    const fd=fs.openSync(file,'r'); let bytes;
    try {
      const stat=fs.fstatSync(fd);
      if (!stat.isFile() || stat.size>1024*1024) throw Error('Release file must be a regular text file <=1 MiB');
      const buffer=Buffer.alloc(1024*1024+1); let size=0,n;
      while(size<buffer.length&&(n=fs.readSync(fd,buffer,size,buffer.length-size,null))>0)size+=n;
      if(size>1024*1024)throw Error('Release file grew beyond bound');
      bytes=buffer.subarray(0,size);
    } finally {fs.closeSync(fd);}
    total+=bytes.length; if(total>16*1024*1024)throw Error('Release exceeds 16 MiB');
    const text=bytes.toString('utf8');
    const flag=reason=>findings.push({path:relative,reason});
    if(bytes.includes(0)||!Buffer.from(text).equals(bytes))flag('binary-or-invalid-utf8');
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))flag('private-key');
    if(credentialPattern.test(text))flag('credential-pattern');
    if(/[A-Za-z]:[\\/]+Users[\\/]+[^\s/\\]+|\/(?:home|Users)\/[^\s/]+/.test(text))flag('personal-local-path');
    if(privateEmail(text))flag('non-example-email');
    if(forbiddenTerms.some(term=>text.toLowerCase().includes(term.toLowerCase())))flag('private-term');
    manifest.push({path:relative,sha256:digest(bytes),bytes:bytes.length});
  }
  manifest.sort((a,b)=>a.path.localeCompare(b.path));
  return {schema:'genesis-release-manifest-v1',ok:findings.length===0,manifest,manifestHash:digest(JSON.stringify(manifest)),findings,
    limits:'Heuristic text screening plus explicit file inventory; requires human review. Does not inspect history, archives or prove absence of all secrets.'};
}
function verifyRelease({root,manifest,files,forbiddenTerms}) {
  if(!Array.isArray(manifest)||manifest.some(x=>!x||typeof x.path!=='string'||!/^[a-f0-9]{64}$/.test(x.sha256)||!Number.isSafeInteger(x.bytes)||x.bytes<0))throw Error('Invalid expected manifest');
  const current=inspectRelease({root,files,forbiddenTerms});
  const expected=[...manifest].sort((a,b)=>a.path.localeCompare(b.path));
  const matches=expected.length===current.manifest.length&&expected.every((p,i)=>p.path===current.manifest[i].path&&p.sha256===current.manifest[i].sha256&&p.bytes===current.manifest[i].bytes);
  return {...current,ok:current.ok&&matches,matches};
}
module.exports={inspectRelease,verifyRelease};
