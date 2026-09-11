'use strict';
const {analyzeRoutingMetrics}=require('..');
const observations=[{attemptId:'one',runId:'run-a',taskId:'task-a',taskType:'review',contractId:'checks-v1',contractVersion:'1',route:'worker-a',sequence:1,phase:'initial',status:'passed',historyComplete:false,latencyMs:120}];
console.log(JSON.stringify(analyzeRoutingMetrics(observations),null,2));
