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

`snapshot()` reports busy state, registered plans, worker counters and the context graph. It starts no watcher. `modules` exposes all ten standalone packages for custom integration. Their `module-manifest.json` and READMEs describe complete schemas and trust boundaries.

The deadline bounds asynchronous waits. JavaScript cannot interrupt a synchronous CPU loop or force an arbitrary injected promise to stop. A timed-out callback keeps suite capacity occupied until it settles. Use a restricted child process or external service for untrusted execution.
