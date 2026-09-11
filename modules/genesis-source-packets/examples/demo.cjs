'use strict';
const {buildSourcePacket}=require('..');
console.log(JSON.stringify(buildSourcePacket({root:require('node:path').resolve(__dirname,'..'),paths:['examples/demo.cjs']}),null,2));
