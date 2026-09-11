'use strict';
const path=require('node:path');
const {modules}=require('..');
const root=path.resolve(__dirname,'..');
const packet=modules.sourcePackets.buildSourcePacket({root,paths:['examples/task-controls.cjs']});
const impact=modules.changeImpact.analyzeChangeImpact({schemaVersion:1,entries:[{path:'index.cjs',kind:'file',dependsOn:[]},{path:'examples/task-controls.cjs',kind:'consumer',dependsOn:['index.cjs']}]},['index.cjs']);
const release=modules.releaseIntegrity.inspectRelease({root,files:['examples/task-controls.cjs']});
if(!packet.excerpts.length||!impact.affected.consumer.length||!release.ok)throw Error('Task control integration failed');
console.log(JSON.stringify({sourceFiles:packet.manifest.filesRead,affectedConsumers:impact.affected.consumer,releaseManifest:release.manifest},null,2));
