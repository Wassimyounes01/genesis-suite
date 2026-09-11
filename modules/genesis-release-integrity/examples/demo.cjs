'use strict';
const {inspectRelease,verifyRelease}=require('..');
const request={root:require('node:path').resolve(__dirname,'..'),files:['README.md','index.cjs']};
const reviewed=inspectRelease(request);
console.log(JSON.stringify(verifyRelease({...request,manifest:reviewed.manifest}),null,2));
