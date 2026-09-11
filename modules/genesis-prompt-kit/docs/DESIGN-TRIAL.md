# Repository-design prompt: eleven-repository trial

The [original Genesis repository-design profile](REPOSITORY-DESIGN-PROMPT.md) guided a coordinated redesign of all ten standalone components and Genesis Suite. The same scope was used across the set: explain the real problem, intended users, scenarios, observable differences, runnable setup and limitations; replace dense or generic diagrams with labeled SVG workflows and narrow-screen variants.

## What was changed

Each page now has a component-specific cover and accent, a labeled execution flow, concrete adoption guidance, a defined baseline comparison, example links and explicit limits. Prompt Kit and Suite also explain the prompt-analysis foundation and the boundary between original instructions and runtime enforcement. The old Git revision provided the baseline pages. These repositories are the development set, not unseen evaluation tasks.

## Structural results

Eight checks per repository cover the cover reference, desktop diagram, narrow diagram, exact clone/test/demo commands, comparison-table presence, limits section, complete-example link and local heading anchors. JavaScript snippets were also checked as CommonJS. These checks establish presence and syntax, not whether prose is persuasive.

| Repository | Structural checks | Mermaid blocks, before → after | Narrow flow, before → after |
| --- | --- | --- | --- |
| [genesis-task-ledger](https://github.com/your-organization/genesis-task-ledger) | Pass | 1 → 0 | No → Yes |
| [genesis-plan-graph](https://github.com/your-organization/genesis-plan-graph) | Pass | 1 → 0 | No → Yes |
| [genesis-task-adaptation](https://github.com/your-organization/genesis-task-adaptation) | Pass | 1 → 0 | No → Yes |
| [genesis-context-graph](https://github.com/your-organization/genesis-context-graph) | Pass | 1 → 0 | No → Yes |
| [genesis-worker-router](https://github.com/your-organization/genesis-worker-router) | Pass | 1 → 0 | No → Yes |
| [genesis-night-research](https://github.com/your-organization/genesis-night-research) | Pass | 1 → 0 | No → Yes |
| [genesis-repo-atlas](https://github.com/your-organization/genesis-repo-atlas) | Pass | 1 → 0 | No → Yes |
| [genesis-review-gate](https://github.com/your-organization/genesis-review-gate) | Pass | 1 → 0 | No → Yes |
| [genesis-charter-lab](https://github.com/your-organization/genesis-charter-lab) | Pass | 1 → 0 | No → Yes |
| [genesis-prompt-kit](https://github.com/your-organization/genesis-prompt-kit) | Pass | 1 → 0 | No → Yes |
| [genesis-suite](https://github.com/your-organization/genesis-suite) | Pass | 1 → 0 | No → Yes |

Longer text is not the success criterion. The substantive review asks whether a reader can choose the component for a concrete problem, run its example and understand what remains their responsibility. Component docs were checked against source and existing tests; independent cross-review and a bounded Cursor Auto review supplied additional findings. The design profile was revised to avoid fixed quotas for benefits and diagram steps. Actual Cursor model selection and monetary cost were not exposed by that review.

## How to repeat the trial

Run `node index.cjs render repository` from Prompt Kit. Supply one repository's code, intended audience, examples and publication scope. Preserve its baseline revision, then apply the profile and check the same twelve editorial criteria in the prompt. Execute documented examples, inspect local links and render the SVGs at desktop and narrow widths. Keep a claim-to-source record and report unverified claims as gaps.

The [behavioral verification record](../VERIFICATION.md) and each component's Actions page are separate from this editorial assessment. Runtime regression tests do not measure design quality.

## What this trial does not establish

No human usability study, conversion experiment, blinded preference test or model-quality benchmark was run. There is no measured percentage improvement in comprehension, downloads, code quality or token cost. The trial demonstrates an applied, reviewable documentation workflow across eleven different components. A stronger evaluation would preregister a new repository set and recruit readers to complete the same discovery and setup tasks on baseline and redesigned pages.
