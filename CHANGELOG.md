# Changelog

## 1.2.0

Adds focused source context, candidate constraint compilation, current-byte draft reuse, preregistered paired diagnostics and independent draft batches. The suite now exposes twenty-one components. These five APIs are explicit host integrations; the existing runner's authority, acceptance rules and provider routing are unchanged.

Numbered source presentation preserves raw excerpt hashes. Batch validation requires one source-bound result per task and a nonempty correction, no-change reason or missing-context explanation for every verdict. Updated API and workflow guides explain budgets, trusted request pins, fresh review and measurement limits.

The assembled suite passed 336 tests; the five new standalone packages passed 190 tests that are already included in that suite count. Fresh consumer inventories and demos passed, followed by 24 CI jobs across the six release repositories on Windows/Ubuntu and Node.js 22.23.2/24.14.0. See [verification](VERIFICATION.md) for the exact code heads and scope. No general quality multiplier or token/cost reduction is claimed.

## 1.1.1

Requires Node.js 22.23.2 / 24.14.0 for typed regression TAP evidence. The first remote CI pass exposed missing check-type metadata in Node.js 20; strict regression validation remains intact. CI now checks supported Node.js 22.23.2 and 24.14.0 on Windows and Linux.

## 1.1.0

Adds source packets, evidence collection, retained regression evidence, routing measurements, explicit change impact and release integrity. All six are exposed through `modules` and include standalone tests, demos and usage guides. The existing runner remains compatible. A new [task workflow](GENESIS.md) explains proportional adoption and measured improvement. No model-weight training or verified cost reduction is claimed.

## 1.0.0

Initial portable release: ten independent workflow modules, an integrated runner, original operating prompts, offline examples and failure-path tests. No private data or original workspace history is included.
