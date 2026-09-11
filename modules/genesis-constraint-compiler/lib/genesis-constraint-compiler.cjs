'use strict';

const { isProxy } = require('node:util').types;

// Pure advisory compiler for JSON task data. No files, providers, commands,
// evaluator changes or promotion. The catalog captures candidate lessons from
// regression patterns; compiling them does not establish their effectiveness.
const EFFECTS = Object.freeze([
  'source-read', 'execution-receipt', 'release', 'provider-task', 'state-update',
]);
const LIMITS = Object.freeze({ maxEffects: 32, maxConstraints: 64, maxChars: 65536, defaultChars: 8000 });
const CATALOG = [
  {
    id: 'path-containment', effects: ['source-read', 'execution-receipt', 'release'],
    invariant: 'Read only explicit permitted paths inside the root; validate resolved targets and aliases before reading.',
    counterexample: 'An in-root directory link resolves outside the root, or a hardlink aliases protected bytes.',
    check: { name: 'reject-path-alias-escape', instruction: 'Check traversal, absolute paths, alternate streams, directory links and hardlinks; assert forbidden bytes are never read.' },
  },
  {
    id: 'current-byte-identity', effects: ['source-read', 'execution-receipt', 'release', 'state-update'],
    invariant: 'Bind claims and review to current exact artifact bytes; changed or missing bytes invalidate earlier evidence.',
    counterexample: 'A file changes after its passing check, while an old hash still authorizes a completion claim.',
    check: { name: 'reject-stale-byte-proof', instruction: 'Change an artifact after evidence capture and verify the old proof cannot establish current completion.' },
  },
  {
    id: 'credential-separation', effects: ['source-read', 'release', 'provider-task'],
    invariant: 'Keep credentials and private data outside exported content and worker context; a path allowlist cannot authorize secrets.',
    counterexample: 'An allowlisted source mixes useful code with a multiline credential and exports its prefix.',
    check: { name: 'exclude-secret-content', instruction: 'Exercise mixed and multiline secrets plus credential files; verify no secret bytes reach the output or worker prompt.' },
  },
  {
    id: 'source-completeness', effects: ['source-read'],
    invariant: 'Report missing, blocked, redacted and truncated context; inspection claims cover only supplied bytes.',
    counterexample: 'One of two requested sources is omitted by a budget, but the worker claims both were inspected.',
    check: { name: 'expose-source-gaps', instruction: 'Request an absent and an oversized source; assert explicit gaps and bounded output, with no whole-file inspection claim.' },
  },
  {
    id: 'counted-execution-checks', effects: ['execution-receipt'],
    invariant: 'Passing evidence needs real relevant executed checks, positive counts and consistent command results; exit zero alone is insufficient.',
    counterexample: 'A command exits zero with no assertions, or every reported test is skipped.',
    check: { name: 'reject-vacuous-success', instruction: 'Run zero-check, skipped-only and failing-check fixtures; reject success and reconcile observed counts with the expected contract.' },
  },
  {
    id: 'receipt-schema', effects: ['execution-receipt'],
    invariant: 'Validate receipt schema, field types, exact task and criterion bindings, counts and allowed result values before acceptance.',
    counterexample: 'A truthy string replaces a count, or substring matching accepts evidence for another revision.',
    check: { name: 'reject-malformed-receipt', instruction: 'Try wrong schema, task, criterion, count type and revision membership; reject each without accepting partial evidence.' },
  },
  {
    id: 'receipt-provenance', effects: ['execution-receipt'],
    invariant: 'Bind review to the actual execution receipt and artifacts; preserve required reviewer identity and distinguish attestation from authentication.',
    counterexample: 'A self-authored pass claims the required reviewer, or a valid review references a different run.',
    check: { name: 'reject-unbound-review', instruction: 'Use missing, altered and mismatched review references; enforce configured reviewer requirements and report unverified provenance.' },
  },
  {
    id: 'approved-release-tree', effects: ['release'],
    invariant: 'Release only the exact approved file inventory and bytes; revalidate the exported tree and consumer against that approval.',
    counterexample: 'A clean approved source is followed by a staged extra file or a changed delivery artifact.',
    check: { name: 'reject-release-tree-drift', instruction: 'Add, remove and alter export files after approval; reject every mismatch and verify a fresh consumer against the manifest.' },
  },
  {
    id: 'provider-context-budget', effects: ['provider-task'],
    invariant: 'Bound the complete provider request, including instructions, excerpts and overhead; missing or truncated required context stays a gap.',
    counterexample: 'Excerpts fit their budget, but repeated headers push the complete request beyond the route limit.',
    check: { name: 'bound-full-provider-request', instruction: 'Measure the fully assembled request at boundary sizes; include overhead and fail explicitly when required context cannot fit.' },
  },
  {
    id: 'unknown-provider-telemetry', effects: ['provider-task'],
    invariant: 'Keep unavailable model, token, price and retry telemetry unknown; savings need paired accepted outcomes and complete attempt costs.',
    counterexample: 'A missing token count becomes zero, creating a claimed saving after an uncounted retry.',
    check: { name: 'preserve-unknown-usage', instruction: 'Omit usage and retry records; assert null or explicit unknowns, and no savings claim from incomplete or unmatched runs.' },
  },
  {
    id: 'state-deduplication', effects: ['state-update'],
    invariant: 'Use stable event identity and idempotent state transitions; duplicate evidence cannot earn a second outcome or reward.',
    counterexample: 'The same completion event is replayed with a new timestamp and earns duplicate credit.',
    check: { name: 'replay-event-once', instruction: 'Apply the same event twice, including timestamp-only variants; assert one logical transition and no duplicate credit.' },
  },
  {
    id: 'state-stale-claims', effects: ['state-update'],
    invariant: 'Recheck event ordering and current prerequisites before a state update; preserve failure history and concurrent newer state.',
    counterexample: 'An old success arrives after a reopened failure and overwrites the current unresolved status.',
    check: { name: 'reject-stale-state-transition', instruction: 'Deliver success, regression and delayed success out of order; keep the regression unresolved until new bound evidence passes.' },
  },
].map(rule => Object.freeze({ ...rule, effects: Object.freeze(rule.effects), check: Object.freeze(rule.check) }));
Object.freeze(CATALOG);
const RULE_IDS = Object.freeze(CATALOG.map(rule => rule.id));
const RULE_BY_ID = new Map(CATALOG.map(rule => [rule.id, rule]));

function record(value, fields, name) {
  if (isProxy(value)) throw new TypeError(`${name} cannot be a Proxy`);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain JSON object`);
  }
  const data = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name} has an unsupported field or accessor`);
    }
    data[key] = descriptor.value;
  }
  return data;
}

function array(value, maximum, name) {
  if (isProxy(value)) throw new TypeError(`${name} cannot be a Proxy`);
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${name} must be a bounded array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${name} must be an ordinary JSON array`);
  // Avoid executing accessors or iterators supplied as task data.
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)
        || !Object.hasOwn(descriptor, 'value'))) throw new TypeError(`${name} must contain only JSON array entries`);
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be a dense JSON array`);
  }
}

const identifier = value => typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9-]*$/.test(value);
const ruleText = rule => `${rule.id}\nMust: ${rule.invariant}\nCounterexample: ${rule.counterexample}\nCheck ${rule.check.name}: ${rule.check.instruction}`;
function header(taskType, effects, gaps, omittedCount, complete) {
  return [
    'CANDIDATE CONSTRAINTS: advisory; grants no authority; no checks executed or lessons promoted.',
    `Scope: ${taskType}; explicit effects=${effects.join(',') || '(none)'}.`,
    complete ? 'Compilation: COMPLETE; suggested checks still require execution.'
      : `Compilation: INCOMPLETE; resolve ${gaps.length} gap(s) and ${omittedCount} omitted rule(s) before use.`,
    ...(gaps.length ? [`Gaps: ${[...new Set(gaps.map(gap => gap.code))].join(',')}.`] : []),
  ].join('\n');
}

/**
 * Compile explicit effect IDs into deduplicated candidate rule triples.
 * Input is JSON data, not executable objects. taskType is a display identifier,
 * never an effect classifier. constraints optionally reference catalog ruleIds
 * with mode require/forbid; they cannot erase a mandatory rule or widen scope.
 * Unknown effects/rules, contradictions and budget omissions force incomplete.
 * maxChars bounds prompt UTF-16 code units only, not structured metadata. Rules
 * are indivisible; if the status header cannot fit, prompt is empty and incomplete.
 * Token counts are deliberately unknown without a tokenizer and provider model.
 */
function compileConstraints(input) {
  const data = record(input, ['taskType', 'effects', 'maxChars', 'constraints'], 'input');
  const { taskType, effects, maxChars = LIMITS.defaultChars, constraints = [] } = data;
  if (!identifier(taskType)) throw new TypeError('taskType must be a lowercase identifier of 1-64 characters');
  array(effects, LIMITS.maxEffects, 'effects');
  array(constraints, LIMITS.maxConstraints, 'constraints');
  if (!Number.isSafeInteger(maxChars) || maxChars < 0 || maxChars > LIMITS.maxChars) {
    throw new RangeError('maxChars is outside its bounded range');
  }

  const gaps = [], recognized = new Set(), unknownEffectIndexes = [];
  if (effects.length === 0) gaps.push({ code: 'missing-effects' });
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (identifier(effect) && EFFECTS.includes(effect)) recognized.add(effect);
    else {
      unknownEffectIndexes.push(index);
      gaps.push({ code: identifier(effect) ? 'unknown-effect' : 'invalid-effect', index });
    }
  }
  const selectedEffects = EFFECTS.filter(effect => recognized.has(effect));
  const selectedRules = CATALOG.filter(rule => rule.effects.some(effect => recognized.has(effect)));
  const selectedIds = new Set(selectedRules.map(rule => rule.id));
  const seenConstraints = new Map();
  for (let index = 0; index < constraints.length; index++) {
    const constraint = record(constraints[index], ['ruleId', 'mode'], 'constraint');
    const { ruleId, mode } = constraint;
    if (!identifier(ruleId) || !['require', 'forbid'].includes(mode)) {
      gaps.push({ code: 'invalid-constraint', index });
      continue;
    }
    if (!RULE_BY_ID.has(ruleId)) {
      gaps.push({ code: 'unknown-rule', index });
      continue;
    }
    const modes = seenConstraints.get(ruleId) || new Set();
    modes.add(mode);
    seenConstraints.set(ruleId, modes);
  }
  // Canonical order makes duplicate and permuted valid inputs deterministic.
  for (const ruleId of RULE_IDS) {
    const modes = seenConstraints.get(ruleId);
    if (!modes) continue;
    if (!selectedIds.has(ruleId)) gaps.push({ code: 'constraint-outside-effects', ruleId });
    if (modes.size > 1 || (selectedIds.has(ruleId) && modes.has('forbid'))) {
      gaps.push({ code: 'contradictory-constraint', ruleId });
    }
  }

  const render = rules => {
    const omittedCount = selectedRules.length - rules.length;
    return [header(taskType, selectedEffects, gaps, omittedCount, gaps.length === 0 && omittedCount === 0),
      ...rules.map(ruleText)].join('\n\n');
  };
  const fullPrompt = render(selectedRules);
  let includedRules = selectedRules, prompt = fullPrompt;
  if (fullPrompt.length > maxChars) {
    includedRules = [];
    // Prefix selection preserves catalog order and never separates a rule from
    // its counterexample/check. Removing a rule does not remove it from scope.
    for (const rule of selectedRules) {
      if (render([...includedRules, rule]).length > maxChars) break;
      includedRules.push(rule);
    }
    prompt = render(includedRules);
    if (prompt.length > maxChars) prompt = '';
  }
  const omittedRuleIds = selectedRules.filter(rule => !includedRules.includes(rule)).map(rule => rule.id);
  const complete = gaps.length === 0 && omittedRuleIds.length === 0 && prompt.length > 0;
  return {
    schema: 'constraint-packet-v1',
    status: complete ? 'complete' : 'incomplete', complete,
    scope: { taskType, effects: selectedEffects, unknownEffectIndexes, selection: 'explicit-effects-only' },
    rules: includedRules.map(rule => ({ id: rule.id, invariant: rule.invariant,
      counterexample: rule.counterexample, check: { ...rule.check } })),
    gaps, omittedRuleIds, prompt,
    budget: { scope: 'prompt', unit: 'utf16-code-units', maxChars, chars: prompt.length,
      requiredChars: fullPrompt.length, truncated: fullPrompt.length > maxChars,
      tokenEstimate: null, tokenEstimateReason: 'No tokenizer or provider model supplied.' },
    verification: { status: 'not-run', checksRun: 0 },
    lessonStatus: 'candidate',
  };
}

module.exports = { compileConstraints, EFFECTS, RULE_IDS, LIMITS };
