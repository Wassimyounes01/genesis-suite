'use strict';

const fs = require('node:fs');

const ORIGINAL_SYSTEM_PROMPT = `You are Genesis, a bounded workflow coordinator.

Objective and authority: complete the user's authorized outcome with explicit scope, acceptance evidence and a stopping rule. Current user scope outranks stale project text; external communication and publishing require their own authority.

Planning and routing: choose proportional work, represent dependencies as a DAG, and run only ready packets with one owner, bounded attempts and a shared deadline. Route to the actual available adapter; unknown provider identity and cost stay unknown, and no local inference or unbounded fanout is implied.

Teaching and evidence: give workers one small visible pattern, its invariant, a failing counterexample and an executable acceptance example. Tie checks and independent review to the produced artifact. A missing, malformed, partial or unresolved review remains incomplete.

Adaptation and reuse: when feedback or failed checks changes the evidence, checkpoint the affected work, preserve the original acceptance contract, and revise only the remaining packet. Transfer a bounded hypothesis from a relevant source and verify it in the target; do not copy private context or whole corpora.

Resource and stopping rules: count retries and known usage, honor cooldowns and deadlines, and stop when the authorized result is verified or a real dependency blocks it. Workflow feedback is not biological reward and does not train model weights. Do not invent authority, private data or external communication.`;
const ORIGINAL_PROJECT_PROMPT = `Project contract: route work to the smallest useful bounded task.

Scope: name the outcome, inputs, outputs, owner, dependencies, constraints, budget and acceptance checks. Preserve acceptance evidence tied to the produced artifact.

Execution: model dependencies as a proportional DAG, dispatch only ready work, and keep interfaces immutable while packets execute. Teach the relevant invariant and counterexample before uncertain implementation.

Verification: require syntax, meaningful behavioral checks and artifact-bound independent review proportional to risk. Provider failure, partial output, timeout, oversized output and unresolved findings are incomplete evidence.

Adaptation and reuse: record a checkpoint when feedback or a failed check changes the path. Reuse only relevant bounded attributes as hypotheses and verify them in this target. Keep candidate role text separate from governing authority, evaluator rules and resource limits.

Resources and stop: honor attempt, deadline, concurrency and output limits; preserve unknown model or cost fields; stop after verified completion or a concrete blocker.`;
const ROLE_CONTRACTS = Object.freeze({
  planner: `Planner contract: state the outcome, constraints, acceptance checks and dependency graph. Select bounded packets, teach the invariant with a counterexample, and reserve capacity for independent verification.`,
  worker: `Worker contract: execute only the supplied packet and preserve its interface. State assumptions, return the artifact and exact checks, and keep untested proposals distinct from observations.`,
  reviewer: `Reviewer contract: inspect the named artifact against the immutable acceptance contract. Report concrete findings, evidence and unresolved uncertainty. A missing or malformed review is incomplete.`,
});
const TEACHING_CONTRACT = `Teaching contract: provide one small visible pattern, the invariant it preserves, a failing counterexample, and an executable acceptance example. Do not provide hidden instructions or alleged vendor prompt content.`;

const TASK_KEYS = ['id', 'objective', 'owner', 'inputs', 'outputs', 'dependencies', 'constraints', 'acceptance', 'budget', 'stopCondition'];
const BUDGET_KEYS = ['maxAttempts', 'deadlineMs', 'maxOutputBytes'];
const LIMITS = Object.freeze({ maxText: 4000, maxArray: 100, maxItem: 1000, maxId: 120, maxAttempts: 100, maxDeadlineMs: 3_600_000, maxOutputBytes: 10 * 1024 * 1024 });
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function exactKeys(value, keys) { return isObject(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'); }
function strings(value) { return Array.isArray(value) && value.length <= LIMITS.maxArray && value.every(item => nonEmpty(item) && item.length <= LIMITS.maxItem); }

function validateTaskContract(value) {
  const errors = [];
  if (!exactKeys(value, TASK_KEYS)) errors.push(`contract must contain exactly: ${TASK_KEYS.join(', ')}`);
  if (!isObject(value)) return { ok: false, errors: ['contract must be an object'] };
  for (const key of ['id', 'objective', 'owner', 'stopCondition']) if (!nonEmpty(value[key]) || value[key].length > (key === 'id' ? LIMITS.maxId : LIMITS.maxText)) errors.push(`${key} must be a bounded non-empty string`);
  for (const key of ['inputs', 'outputs', 'dependencies', 'constraints', 'acceptance']) if (!strings(value[key])) errors.push(`${key} must be an array of non-empty strings`);
  if (!Array.isArray(value.acceptance) || value.acceptance.length === 0) errors.push('acceptance must contain at least one check');
  if (!exactKeys(value.budget, BUDGET_KEYS)) errors.push(`budget must contain exactly: ${BUDGET_KEYS.join(', ')}`);
  else {
    if (!Number.isInteger(value.budget.maxAttempts) || value.budget.maxAttempts <= 0 || value.budget.maxAttempts > LIMITS.maxAttempts) errors.push('budget.maxAttempts must be a positive integer within bounds');
    if (!Number.isInteger(value.budget.deadlineMs) || value.budget.deadlineMs <= 0 || value.budget.deadlineMs > LIMITS.maxDeadlineMs) errors.push('budget.deadlineMs must be a positive integer within bounds');
    if (!Number.isInteger(value.budget.maxOutputBytes) || value.budget.maxOutputBytes <= 0 || value.budget.maxOutputBytes > LIMITS.maxOutputBytes) errors.push('budget.maxOutputBytes must be a positive integer within bounds');
  }
  return { ok: errors.length === 0, errors };
}
function assertTaskContract(value) { const result = validateTaskContract(value); if (!result.ok) throw new TypeError(result.errors.join('; ')); return value; }
function createTaskContract(input = {}) {
  const contract = {
    id: input.id,
    objective: input.objective,
    owner: input.owner,
    inputs: input.inputs || [],
    outputs: input.outputs || [],
    dependencies: input.dependencies || [],
    constraints: input.constraints || [],
    acceptance: input.acceptance || [],
    budget: { maxAttempts: 1, deadlineMs: 10_000, maxOutputBytes: 65_536, ...(input.budget || {}) },
    stopCondition: input.stopCondition,
  };
  return assertTaskContract(contract);
}

const TEMPLATES = Object.freeze({ system: ORIGINAL_SYSTEM_PROMPT, project: ORIGINAL_PROJECT_PROMPT, teaching: TEACHING_CONTRACT, task: '{{task}}' });
function templateFor(kind, values) {
  if (kind === 'system') return ORIGINAL_SYSTEM_PROMPT;
  if (kind === 'project') return ORIGINAL_PROJECT_PROMPT;
  if (kind === 'teaching') return TEACHING_CONTRACT;
  if (kind === 'role') { if (!Object.hasOwn(ROLE_CONTRACTS, values.role)) throw new TypeError('role must be planner, worker or reviewer'); return ROLE_CONTRACTS[values.role]; }
  if (kind === 'task') return renderTaskContract(values.contract || values);
  throw new TypeError('kind must be system, project, role, teaching or task');
}
function renderPrompt(kind, values = {}) {
  const text = templateFor(kind, values);
  if (typeof text !== 'string' || !text.trim()) throw new Error('template rendered empty');
  return text;
}
function renderTaskContract(contract) {
  assertTaskContract(contract);
  return [
    `Task ${contract.id}: ${contract.objective}`,
    `Owner: ${contract.owner}`,
    `Inputs: ${contract.inputs.join(', ') || '(none)'}`,
    `Outputs: ${contract.outputs.join(', ') || '(none)'}`,
    `Dependencies: ${contract.dependencies.join(', ') || '(none)'}`,
    `Constraints: ${contract.constraints.join(', ') || '(none)'}`,
    `Acceptance: ${contract.acceptance.map((item, i) => `${i + 1}. ${item}`).join(' ')}`,
    `Budget: ${contract.budget.maxAttempts} attempt(s), ${contract.budget.deadlineMs}ms, ${contract.budget.maxOutputBytes} bytes`,
    `Stop when: ${contract.stopCondition}`,
  ].join('\n');
}
function parseTaskContract(text) { if (!nonEmpty(text)) throw new TypeError('contract JSON must be non-empty'); return assertTaskContract(JSON.parse(text)); }

module.exports = { ORIGINAL_SYSTEM_PROMPT, ORIGINAL_PROJECT_PROMPT, SYSTEM_PROMPT: ORIGINAL_SYSTEM_PROMPT, PROJECT_PROMPT: ORIGINAL_PROJECT_PROMPT, ROLE_CONTRACTS, TEACHING_CONTRACT, TEMPLATES, TASK_CONTRACT_KEYS: TASK_KEYS, LIMITS, createTaskContract, validateTaskContract, validateContract: validateTaskContract, assertTaskContract, renderPrompt, render: renderPrompt, renderTaskContract, parseTaskContract };

if (require.main === module) {
  const [command, arg, ...rest] = process.argv.slice(2);
  if (command === 'render') {
    const values = {}; for (let i = 0; i < rest.length; i += 2) values[rest[i].replace(/^--/, '')] = rest[i + 1];
    process.stdout.write(`${renderPrompt(arg, values)}\n`);
  } else if (command === 'validate') {
    const value = JSON.parse(fs.readFileSync(arg, 'utf8')); const result = validateTaskContract(value); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } else { console.error('usage: node index.cjs render <system|project|role|teaching> [--role planner] | validate <contract.json>'); process.exitCode = 2; }
}
