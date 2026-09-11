# Verification

## Version 1.1.1 — September 11, 2026

Node.js 22.23.2 / 24.14.0 is required. The initial remote Node.js 20 run correctly failed closed on missing typed regression results; the supported-version CI matrix is now Node.js 22.23.2 and 24.14.0.

The assembled 16-component suite passed **144 tests** on Windows, with zero failures, skipped or pending tests. The original demo and the new `examples/task-controls.cjs` demo passed. The six added standalone packages passed 63 tests in total; these same tests are included in the suite's 144, so those counts must not be added as unique coverage.

The new tests cover source path/credential boundaries, current receipt identity, nonempty named regressions, matched routing observations, reverse dependency gaps, release manifests and component integration. GitHub Actions and fresh remote checkout results should be checked for the exact release commit. Fixture success does not establish real model quality, cost savings or third-party service behavior.

## Historical version 1.0.0 verification

The release was exercised on Windows using v24.14.0. The offline test run passed 79 tests (0 skipped); the offline example exited successfully. Tests took 2954 ms and the example 140 ms in this observation. These timings are not a benchmark or performance guarantee.

Commands at that release: `npm test` and `npm run demo`. Its CI matrix used Node.js 20 and 22; current supported versions are listed above. CI results are available in the repository Actions tab.

Tests use explicit temporary state and injected fixtures. Live provider behavior, model quality, real account billing, arbitrary third-party CLIs and hosted integrations are not certified by this run. Reviewer identity and external evidence provenance remain caller-attested.

Recorded: 2026-09-10T20:23:01.003Z.
