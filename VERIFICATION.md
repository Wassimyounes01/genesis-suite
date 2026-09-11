# Verification

## Version 1.2.0 — September 11, 2026

The twenty-one-component suite at code commit `5ff3924e53519bfe112ca59e95e67ccd38252f17` passed **336 tests**, with zero failed, skipped, cancelled or pending tests. The five new standalone packages passed **190 tests** (35 + 33 + 55 + 30 + 37). Those tests are included in the suite's 336 and must not be added as unique coverage.

Local verification and fresh consumer clones both passed the suite demo, `examples/efficiency-controls.cjs`, all five standalone demos and inventory verification. Every fresh clone's complete file inventory, byte hashes and commit were checked before running public code. Local child processes received only the environment fields needed for paths, the operating system, temporary files and the user profile. Neutral authorship and the approved suite parent history were verified.

All **24 GitHub Actions jobs** passed at these recorded release heads: Windows and Ubuntu, each on Node.js 22.23.2 and 24.14.0, for each of the six repositories. CI ran tests, the package demo and inventory verification.

| Repository | Recorded code commit | Tests per local run | CI jobs passed |
| --- | --- | ---: | ---: |
| genesis-task-context | `0eb7a126b8180945d486933edb989709df709519` | 35 | 4 |
| genesis-constraint-compiler | `65dd0b7a2b0801aa8422676992a0f10ae7e70394` | 33 | 4 |
| genesis-verified-reuse | `6de5eb7bcc08ce67e1023f7a82a2b7347ce7ffd2` | 55 | 4 |
| genesis-paired-experiments | `19edf79f1a7460ed1bd40e32f5710c27a32666ee` | 30 | 4 |
| genesis-batch-drafts | `b24b3b80eb83f2630ede0b545f7c05225780b18a` | 37 | 4 |
| genesis-suite | `5ff3924e53519bfe112ca59e95e67ccd38252f17` | 336 | 4 |

Documentation-only follow-ups retain this code baseline. Inspect the repository's Actions tab for the exact documentation commit's run; the table records completed checks at the code heads above and does not claim future CI results. Run `npm test`, `npm run demo`, `node examples/efficiency-controls.cjs` and `npm run verify` to check a current checkout.

These checks exercise synthetic positive and adversarial fixtures, including source containment, exact hashes, partial contexts, executable accessors/proxies, stale evidence, incomplete usage, batch tampering and malformed results. Counts repeated through standalone packages, the suite and CI overlap. They do not establish general task quality, token savings, provider behavior or account billing. Text sanitization is heuristic; reviewer identity and external evidence remain caller-attested. No evaluator authority or model weights are changed.

## Historical version 1.1.1 — September 11, 2026

Node.js 22.23.2 / 24.14.0 is required. The initial remote Node.js 20 run correctly failed closed on missing typed regression results; the supported-version CI matrix is now Node.js 22.23.2 and 24.14.0.

The assembled 16-component suite passed **144 tests** on Windows, with zero failures, skipped or pending tests. The original demo and the new `examples/task-controls.cjs` demo passed. The six added standalone packages passed 63 tests in total; these same tests are included in the suite's 144, so those counts must not be added as unique coverage.

The new tests cover source path/credential boundaries, current receipt identity, nonempty named regressions, matched routing observations, reverse dependency gaps, release manifests and component integration. GitHub Actions and fresh remote checkout results should be checked for the exact release commit. Fixture success does not establish real model quality, cost savings or third-party service behavior.

## Historical version 1.0.0 verification

The release was exercised on Windows using v24.14.0. The offline test run passed 79 tests (0 skipped); the offline example exited successfully. Tests took 2954 ms and the example 140 ms in this observation. These timings are not a benchmark or performance guarantee.

Commands at that release: `npm test` and `npm run demo`. Its CI matrix used Node.js 20 and 22; current supported versions are listed above. CI results are available in the repository Actions tab.

Tests use explicit temporary state and injected fixtures. Live provider behavior, model quality, real account billing, arbitrary third-party CLIs and hosted integrations are not certified by this run. Reviewer identity and external evidence provenance remain caller-attested.

Recorded: 2026-09-10T20:23:01.003Z.
