'use strict';
const { createTaskContract, renderPrompt } = require('../index.cjs');
const contract = createTaskContract({ id: 'offline-demo', objective: 'Render a review packet', owner: 'worker', inputs: ['fixture'], outputs: ['receipt'], acceptance: ['receipt is present'], stopCondition: 'Stop after one bounded render.' });
console.log(renderPrompt('system'));
console.log('\n--- task ---\n');
console.log(renderPrompt('task', contract));
