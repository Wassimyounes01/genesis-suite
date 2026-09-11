# Where Genesis prompting comes from

Genesis was informed in part by a supplied collection presented as **leaked system prompts**. The useful foundation is the analysis of recurring behavioral mechanisms, followed by original instructions, explicit runtime controls and regression tests. The public kit does not reproduce that collection or depend on it at runtime.

## What was actually examined

The local development report records a lexical inventory of **62 Markdown, text and JSON files, totaling 1,818,313 bytes**, with per-file hashes. Selected excerpts labeled Cursor, Cline, Droid, Devin, Manus and Codex were also inspected semantically, alongside a prompt-authoring mechanism catalog and a supplied attachment.

Those are corpus labels, not authenticated vendor attribution. The inventory includes README and tool-schema material; 62 files does not mean 62 distinct models or verified system prompts. Lexical coverage means scanning for terms, not reading and understanding every sentence. The original corpus and private development records are not included here, so readers cannot independently reproduce that historical inventory from this checkout alone.

This account reports the development process. It does not claim to reveal any provider's actual hidden instructions or establish that a leaked prompt causes a model's coding ability.

## Peel back mechanisms, not just wording

The analysis separated objective, authority, tools, planning, delegation, verification, context, exceptions, output and stopping rules. A useful mechanism answers a concrete question: *what failure does this instruction try to prevent, and can code enforce that condition?*

| Observed pattern in the supplied material | Original Genesis adaptation | Inspect the implementation |
| --- | --- | --- |
| Explicit role, scope and nearby exceptions | State the authorized outcome and boundaries before work | [System and project templates](../index.cjs) |
| Tool descriptions tied to a particular environment | Configure real adapters rather than copying unavailable tool names | [Worker Router](https://github.com/your-organization/genesis-worker-router) |
| Planning separated from execution | Define dependency-ready packets with explicit ownership | [Plan Graph](https://github.com/your-organization/genesis-plan-graph) |
| Verification before completion | Bind acceptance and review to current artifact bytes | [Task Ledger](https://github.com/your-organization/genesis-task-ledger) |
| Context and memory management | Retrieve bounded, provenance-backed candidates | [Context Graph](https://github.com/your-organization/genesis-context-graph) |
| Clear outputs and termination | Validate contracts, cap execution and preserve incomplete results | [Prompt Kit tests](../test/prompt-kit.test.cjs), [Review Gate](https://github.com/your-organization/genesis-review-gate) |

The adaptation was selective. Sequential tool loops in some supplied texts were not copied as a universal rule: independent work can overlap within real capacity. Blanket installation or synchronization instructions were not imported into unrelated projects. Vendor-specific tool names were not treated as available capabilities. These choices came from the target workflow's requirements, not from proof that one vendor's prompt is superior.

## From a pattern to an executable control

1. **Observe:** a prompt emphasizes verifying work before reporting completion.
2. **Form a hypothesis:** stale test results may be mistaken for proof of a changed artifact.
3. **Write an original instruction:** require checks and review for the current output.
4. **Implement a guard:** bind receipts to artifact hashes and task criteria.
5. **Try the counterexample:** change the artifact after checking it.
6. **Verify:** acceptance must fail until fresh evidence exists. Inspect the [ledger failure-path tests](https://github.com/your-organization/genesis-task-ledger/tree/codex/initial-release/test).

The instruction makes the expectation legible. The guard makes the deterministic condition enforceable. The test checks that behavior. None alone proves the model writes better code in general.

## Apply the foundation to any task

Use [GENESIS.md](../GENESIS.md) for the general operating charter. Render a role and validated task contract for the actual objective. Add a task profile only where it changes a decision: the [repository-design prompt](REPOSITORY-DESIGN-PROMPT.md) is the profile used for this eleven-repository redesign.

For a website, acceptance might require a working purchase flow and responsive layout. For an analysis, it might require traceable sources and reproducible calculations. For repository documentation, it requires runnable setup, truthful claims, clear diagrams and explicit limits. The structure transfers; the acceptance criteria must be written for the task.

The [Suite runner](https://github.com/your-organization/genesis-suite/blob/codex/initial-release/index.cjs) already constructs worker briefings from the system template, current worker charter, validated task contract, dependency artifacts, accepted guidance and labeled reuse candidates. This is an explicit call path, not an invisible system-wide prompt replacement. A host must adopt the templates or connect the runner; installing this repository does not change every agent automatically.

## What “better” can honestly mean

Compared with an unstructured prompt asking an agent to “finish and verify,” this kit makes required outputs, checks and stopping rules inspectable. Connected modules add concrete controls for dependencies, incomplete review and stale evidence. That is a design distinction readers can inspect and test.

There is **no published head-to-head benchmark here proving universal code-quality gains, an Astra-level quality floor, conversion uplift or a fixed token-cost reduction**. A future comparison should freeze task sets, model routes and acceptance rules; include retries and review overhead; measure accepted outcomes and known usage; and use separate held-out tasks. [Charter Lab](https://github.com/your-organization/genesis-charter-lab) supports that experiment structure, but does not supply missing measurements.

Feedback may improve saved instructions and workflow choices after evaluation. It does not simulate biological dopamine or update neural-network weights during a task.
