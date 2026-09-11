# Runner API

```js
const { createGenesis, modules } = require('./index.cjs');
const suite = createGenesis({
  stateDir: './state',
  artifactRoot: './artifacts',
  providers: [explicitProvider],
  reviewer: { id: 'independent-reviewer', adapter: explicitReviewAdapter },
  deadlineMs: 30000,
});
```

`explicitProvider` implements the Worker Router provider schema. The reviewer adapter implements Review Gate `find` and `refute`; its reported provider name must equal the configured reviewer ID and differ from the selected worker name. The caller supplies real credentials and identity attestation outside the library. These variable names are placeholders; the offline demo supplies complete working fixtures.

`registerPlan({id, objective, tasks})` accepts 1–40 tasks, each with `{id, objective, criteria:[{id, description}], dependsOn:[]}`. IDs are lowercase letters, digits and hyphens, starting with a letter, up to 40 characters. Each task owns one output file, `<plan-id>.<task-id>.txt`, under the explicit artifact root. Original contracts are immutable. Register the same plan again when reopening a process; state remains in the caller's directory.

`ready(planId)` returns dependency-ready tasks based on current artifact evidence and recheck requirements. `taskStatus(planId, taskId)` recursively checks dependency freshness and the parent outcome versions bound into that task's evidence. If a parent changes, its descendants need fresh execution and acceptance. `runTask(planId, taskId, {check, contextQuery?, revalidateSource?, signal?})` dispatches one bounded worker, writes its bounded text, executes every criterion through `check`, runs independent review and records the exact outcome. Verified parent artifact text is included as bounded task input. The suite runs one task at a time. Plan Graph remains independently usable for larger declared scheduling capacity.

The checker receives `{criterion, artifactPath, text, signal}` and returns `{command, exitCode, checkedCount, expectedCount}`. It must actually perform the check. A zero exit code and positive equal counts up to one million are required. The command string (up to 1,000 characters) records what the callback executed; the runner never evaluates it as shell code. Each resulting receipt binds the original acceptance digest, task ID, execution ID, current artifact and dependency versions. Review receives the original task, output text, artifact proofs and check receipts.

`checkpoint(event)` and `decide(revisionId, decision)` expose Task Adaptation. Accepted guidance is included in the next worker prompt. Source-backed guidance requires a fresh `revalidateSource` callback at dispatch. Accepted changes during execution invalidate that result. Renewed checks and review are required before a changed task becomes a dependency again.

The `ledger`, `adaptation`, `context`, `router` and `charters` handles expose their standalone APIs. `scan(options)` calls Repo Atlas on explicit roots. `researchPass(options)` calls Night Research using a dedicated subdirectory. Research requires an explicit worker and activity checks during its eligible window; no schedule is installed by this package.

`snapshot()` reports busy state, registered plans, worker counters and the context graph. It starts no watcher. `modules` exposes all twenty-one standalone packages for custom integration. Their manifests, READMEs, source and test fixtures describe schemas and trust boundaries.

The deadline bounds asynchronous waits. JavaScript cannot interrupt a synchronous CPU loop or force an arbitrary injected promise to stop. A timed-out callback keeps suite capacity occupied until it settles. Use a restricted child process or external service for untrusted execution.

# Additional APIs in 1.2.0

These five APIs are explicit host integrations. Importing them does not add automatic context selection, reuse, batching or experiments to `runTask`. All examples below refer to `modules` from the suite export. See [the workflow](../GENESIS.md) for an adoption sequence and [the executable integration example](../examples/efficiency-controls.cjs) for a local smoke check.

## Focused source context

`modules.taskContext.compileTaskContext({root, paths, sourceAllowlist?, selectors?, expectedSourceHashes?, sourceLimits?, maxChars?})` reads explicitly requested paths through the source-packet filter. `root` is the caller-owned root; paths and allowlist entries are relative to it. Expected hashes map requested path names to SHA-256 values. Source limits use the source-packet builder's existing limit names and hard bounds.

A selector is either `{path, startLine, endLine?}` or `{path, anchor, beforeLines?, afterLines?, occurrence?}`. Line numbers and anchor occurrence are one-based; anchors are literal single-line substrings. Without an occurrence, an anchor must be unique. Omitted selectors request whole files. The default `maxChars` is 12,000 and the hard maximum is 18,000 JavaScript UTF-16 code units for the entire serialized prompt, including metadata and framing.

Inspect `complete`, `gaps`, `prompt`, `manifest` and `excerpts` before dispatch. Numbered prompt text preserves source line citations; raw excerpt bytes and hashes remain separate. Requested ranges that are blocked, unavailable or over budget remain gaps. This is a filtered view of the requested sources, not proof that all task dependencies were supplied. Provider framing and any additional host prompt still need their own combined budget. See [context tests](../modules/genesis-task-context/test/index.test.cjs).

## Candidate constraints

`modules.constraintCompiler.compileConstraints({taskType, effects, maxChars?, constraints?})` selects deterministic lessons for explicit effect identifiers. `taskType` is a lowercase identifier. Use the exported `EFFECTS` and `RULE_IDS` catalogs; unknown effects do not silently select rules. An optional constraint is `{ruleId, mode:'require'|'forbid'}`. Contradictions and omitted required content prevent a complete packet.

The result contains the bounded teaching prompt, selected invariants, counterexamples, named suggested checks and explicit gaps. `complete` describes compilation, not successful execution: `verification.checksRun` remains zero and `lessonStatus` remains `candidate`. Token estimates are unknown. The compiler performs no file reads, provider calls, checks or authority changes. See [constraint tests](../modules/genesis-constraint-compiler/test/index.test.cjs).

## Current-byte draft reuse

The three entry points are `modules.verifiedReuse.buildFingerprint({root, request})`, `admitCandidate({root, request, output, receipt, now?})` and `decideReuse({root, request, record, target, now?})`. A file proof is `{path, sha256}`; `output`, `receipt`, each source, the role and each policy use that shape. `target` is `{planId, taskId}` and must identify a different task from the retained source task.

The request contains `{objective, contract, sources, worker, role, policies, outputSchema, operation:'read-only-draft', dependencyMode:'static', freshness:{ttlMs}, context?}`. The worker contains `{provider, model, config}`; an Auto model also requires `actualModel`, with `null` for unknown identity. TTL is positive and at most seven days. Optional `liveDependent` and `dynamic` flags must be false. Put additional worker inputs in `context`; unknown request fields are rejected.

The host persists the output and a `RECEIPT_SCHEMA` draft receipt before admission; [the reuse fixtures](../modules/genesis-verified-reuse/test/index.test.cjs) show its exact task, worker, fingerprint, timestamp and optional prior-evidence fields. Admission does not write the record. A reuse hit rereads current input, output and receipt proofs and returns text with `accepted:false`, `needsFreshReview:true` and unknown token/cost savings. Caller-attested prior review is not cryptographic reviewer authentication. Fresh target checks and review remain required; live operations and external effects are not replayed.

## Preregistered comparisons

`modules.pairedExperiments.preregisterExperiment(spec)` returns `{schema, spec, sha256}`. The input uses schema `genesis-paired-experiment-v1` and supplies `{id, createdAt, worker:{route, requestedModel, config}, scope, qualityMetric?, cases, maxAttemptsPerRun, targets}`. Scope is `diagnostic` or `representative`; the selected cases and sampling method must justify that label. Quality metric is `normalized-score` by default or `full-contract-pass-rate`.

Each of 2–50 cases has `{id, split, contractSha256, sourceSha256, rubricSha256, promptSha256:{baseline, candidate}, maxScore}`. Split is `training` or `holdout`, with at least one holdout. Attempts are bounded to 1–5 per run. Targets contain `{qualityMultiplier, tokenReduction}` and express goals, not observations. Freeze source, prompts, rubric and order before collecting outputs.

`analyzeExperiment({registration, runs, grades, overheadTokens?})` validates paired records against that registration and reports completeness, matched scores, observed usage and explicit unknowns. Runs bind the case, variant, registration, prompt, source and requested worker, then retain contiguous attempts and `historyComplete`. Attempts retain status, actual model identity, elapsed time, usage and successful output hashes; missing telemetry stays unknown. Grades must bind the registered rubric and retained output. Use [the experiment fixtures](../modules/genesis-paired-experiments/test/index.test.cjs) for complete run/grade shapes. `normalizeCodexUsage(raw)` accepts observed input, cached-input and output token fields; cached input is a subset, not extra input. Keep failures, retries and coordination overhead. Supplied records are not authenticated evidence, and a zero baseline makes a quality multiplier undefined.

## Independent draft batches

`modules.batchDrafts.compileBatch({root, tasks, maxChars?})` accepts 2–4 static tasks. Each task has `{id, task, contract, operation:'read-only-draft', dependencyMode:'static', dependsOn:[], worker:{route, requestedModel, config}, sourcePaths, selectors, expectedSourceHashes?, effects}`. Every task uses the same worker identity and configuration. Selectors use the focused-context line/anchor shapes. Dependencies between tasks, live work and approval actions are outside this API.

The compiler shares filtered source acquisition and deduplicated constraints. Its maximum of 18,000 UTF-16 code units covers the whole rendered batch envelope. Check `complete` and gaps before dispatch; additional provider framing must also fit the host's budget.

`validateBatchResult(batch, resultText, {expectedBinding?, expectedPromptSha256?})` verifies exact rendering and source bindings, then accepts exactly one JSON result per task. The output is `{results:[{id, verdict, mechanism, evidence:[{line, quote}], fix}]}`. Verdict is `safe`, `unsafe` or `insufficient-context`; evidence must cite available source lines. Every result requires a nonempty `fix`: an actionable correction, a contract-specific reason no change is needed, or the missing context needed to decide. Duplicate JSON keys, duplicate task IDs, unbound evidence and incomplete context fail validation.

Capture expected binding and prompt hash in a separately trusted pre-dispatch record and supply them when validating. A checksum taken from the returned batch itself only checks consistency. Successful validation still returns a draft with `accepted:false`; it does not execute tasks or grant acceptance. See [the batch example](../modules/genesis-batch-drafts/examples/demo.cjs) and [adversarial tests](../modules/genesis-batch-drafts/test/index.test.cjs).
