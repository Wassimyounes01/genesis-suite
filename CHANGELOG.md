# Changelog

## 1.1.1

Requires Node.js 22.23.2 / 24.14.0 for typed regression TAP evidence. The first remote CI pass exposed missing check-type metadata in Node.js 20; strict regression validation remains intact. CI now checks supported Node.js 22.23.2 and 24.14.0 on Windows and Linux.

## 1.1.0

Adds source packets, evidence collection, retained regression evidence, routing measurements, explicit change impact and release integrity. All six are exposed through `modules` and include standalone tests, demos and usage guides. The existing runner remains compatible. A new [task workflow](GENESIS.md) explains proportional adoption and measured improvement. No model-weight training or verified cost reduction is claimed.

## 1.0.0

Initial portable release: ten independent workflow modules, an integrated runner, original operating prompts, offline examples and failure-path tests. No private data or original workspace history is included.
