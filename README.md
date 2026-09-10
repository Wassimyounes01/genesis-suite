![Genesis Suite](docs/cover.svg)

# Genesis Suite

Connect planning, bounded workers, live task adaptation and review evidence in one portable toolkit.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-a7f3d0.svg)](LICENSE)
[![Offline demo](https://img.shields.io/badge/demo-offline-93c5fd)](examples/demo.cjs)

Genesis separates a task's original acceptance contract from its evolving implementation. Workers can propose changes during execution. Checks and independent review bind acceptance to the exact artifact bytes. Feedback creates reusable candidates; measured benchmarks decide whether a public role instruction should be promoted.

This repository contains all ten component packages, plus an integrated runner. A fresh clone runs without installing dependencies, configuring a model or starting a service.

## Try it in five minutes

```sh
git clone https://github.com/Wassimyounes01/genesis-suite.git
cd genesis-suite
npm test
npm run demo
```

The demo uses an explicitly labeled offline worker and deterministic review fixture. It creates and removes a temporary workspace, shows a dependency plan, produces an artifact, checks and reviews it, records an outcome, retrieves a reusable attribute, and stages a candidate charter. Its output is a software demonstration, not evidence of a model's intelligence or cost savings.

## How the pieces connect

```mermaid
flowchart LR
    P[Prompt Kit] --> G[Plan Graph]
    A[Repo Atlas] --> C[Context Graph]
    C --> G
    G --> W[Worker Router]
    W --> R[Review Gate]
    R --> L[Task Ledger]
    L --> C
    F[Task Adaptation] --> G
    W --> F
    L --> F
    N[Night Research] --> C
    L --> H[Charter Lab]
    H --> P
```

The arrows describe explicit application calls. No background graph watcher, self-triggering agent swarm or model-weight training runs on import.

## Ten focused systems, one connected suite

| Component | What it enables |
| --- | --- |
| [Task Ledger](https://github.com/Wassimyounes01/genesis-task-ledger) | Immutable task criteria, current artifact hashes, bound review and duplicate-credit prevention. |
| [Plan Graph](https://github.com/Wassimyounes01/genesis-plan-graph) | Dependency readiness and declared file ownership within actual worker capacity. |
| [Task Adaptation](https://github.com/Wassimyounes01/genesis-task-adaptation) | During-task feedback, coordinator decisions and persistent recheck requirements. |
| [Context Graph](https://github.com/Wassimyounes01/genesis-context-graph) | Searchable attributes, explicit provenance and candidate connections. |
| [Worker Router](https://github.com/Wassimyounes01/genesis-worker-router) | Shared deadlines, finite attempts, account-aware fallback and bounded CLI workers. |
| [Night Research](https://github.com/Wassimyounes01/genesis-night-research) | One scheduled pass with time-window, pause, gaming and source budgets. |
| [Repo Atlas](https://github.com/Wassimyounes01/genesis-repo-atlas) | A bounded metadata census of explicitly supplied roots and provenance pointers. |
| [Review Gate](https://github.com/Wassimyounes01/genesis-review-gate) | Strict finder/refuter results that preserve unresolved or incomplete reviews. |
| [Charter Lab](https://github.com/Wassimyounes01/genesis-charter-lab) | Staged public instructions, paired evaluation, held-out checks and rollback. |
| [Prompt Kit](https://github.com/Wassimyounes01/genesis-prompt-kit) | Original Genesis operating prompts, role contracts and teaching examples. |

Standalone repositories have their own examples and tests. The `modules/` directory vendors the same release so the integrated checkout works offline. [The module lock](modules-lock.json) records source hashes; no Git submodule setup is required.

## Practical uses

- **A code change across several packages.** Declare ownership and dependencies, delegate bounded packets, then require regression evidence and an independent reviewer before accepting each output.
- **An existing design worth reusing.** Register the actual artifact and its applicable attributes, retrieve a candidate connection, and test it in the new context. Passing tests never invents user preference or approval.
- **An overnight research assistant.** Invoke one pass from your scheduler, supply explicit pause and activity checks, and leave findings as unverified candidates until sources and proposed improvements are evaluated.

## Integrate a real worker

See [the runner API](docs/API.md) and [the complete offline example](examples/demo.cjs). Providers, checkers and reviewers are injected by your application. The supplied session CLI adapter accepts an explicit executable and arguments; it does not guess an installed binary, purchase overage or select a hidden fallback.

For Cursor Auto, configure the authenticated CLI installed on your machine and its documented read-only invocation. Provider versions and interfaces can differ. The generic adapter is available in `modules/genesis-worker-router`; verify your CLI command before connecting it to an automated task. The hosted desktop agent's own planner/model settings remain outside this library.

## Quality, feedback and cost

A planner/reviewer profile is configuration, not a quality guarantee. An expensive model can still fail; a cheaper one can pass a carefully scoped task. Capture actual provider identity and usage when reported, include retries and review overhead in comparisons, and keep unknown costs unknown.

The reward is a recorded workflow outcome. It does not simulate dopamine, change neural network weights or establish recursive reinforcement learning. Charter promotion changes versioned public text only. The library cannot authenticate a caller's claimed reviewer identity, prove a holdout was unseen, or make an arbitrary callback obey a sandbox.

## Boundaries

Imports start no workers, timers or network requests. Constructors may initialize only the explicitly supplied state directories. External communication, deployment and purchases require authority from the host application. The suite does not include an email transport, outreach engine, user memory, account credentials, private prompt collection or local inference model.

Use one writer per state directory unless an external lock is provided. Declare and enforce real process permissions outside this library. Resource limits bound the orchestrator's dispatch; an injected callback must honor cancellation, and a hung noncooperative callback may retain capacity until it settles.

## Verification and contribution

`npm test` runs each vendored component suite and the integration failures sequentially. `npm run demo` executes the offline flow. CI repeats both on Windows and Linux with Node.js 20 and 22. See [verification](VERIFICATION.md), [contribution guidance](CONTRIBUTING.md), and [trust boundaries](SECURITY.md).
