![Evidence Collector](docs/cover.svg)

# Evidence Collector

Turn scattered receipts into a reviewable completion record.

**Node.js 20+ · Built-in modules only · MIT · No daemon or model account required**

[Why use it](#why-use-it) · [Quickstart](#quickstart) · [API and examples](#api-and-examples) · [Limits](#limits)

## Why use it

Tests, artifacts and review live in different files. Assemble their exact identities without turning a success flag into proof.

Use it for: **Task completion, CI evidence aggregation and audit preparation.**

| A common starting point | This system adds | Why that helps |
| --- | --- | --- |
| Implicit assumptions and scattered state | An explicit, bounded input contract | You can inspect what was actually considered |
| A success flag | A structured result with gaps and failure cases | Missing evidence remains visible |
| A one-time example | Runnable positive and negative fixtures | You can test the behavior before adopting it |

This is a small library you integrate into your application. It is useful when this particular control is missing; it does not replace your existing agent, CI or business policy. These are design differences, not benchmark claims of superiority.

## Quickstart

```sh
git clone https://github.com/Wassimyounes01/genesis-evidence-collector.git
cd genesis-evidence-collector
npm test
npm run demo
```

No dependency installation is needed. Tests use temporary synthetic data and do not contact customers, charge payments or call model providers.

## API and examples

Exports: **collectEvidence**. See [the implementation](index.cjs), [runnable demo](examples/demo.cjs) and [complete input fixtures](test/index.test.cjs).

```js
// Executable synthetic lifecycle fixture; never a claim of real reviewer approval.
const {spawnSync}=require('node:child_process');
console.log('Synthetic Evidence Collector lifecycle with real temporary files and checks.');
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const r=spawnSync(process.execPath,['--test','--test-reporter=tap','test/index.test.cjs'],{cwd:require('node:path').resolve(__dirname,'..'),stdio:'inherit',env,windowsHide:true,timeout:60000});
process.exitCode=r.status===0?0:1;
```

The tests document valid contracts, stale evidence, missing fields and failure behavior. Synthetic fixtures demonstrate mechanics; their values are not measured product-performance results. Use only authorized inputs in a real workflow.

## How it connects

1. **Collect receipts.**
2. **Check current bytes.**
3. **Assemble outcome.**

Use this module independently or find it in the [Genesis Suite](https://github.com/Wassimyounes01/genesis-suite). The suite connects planning, bounded workers, adaptation and evidence. Operational orchestration remains the responsibility of the host application.

## Limits

Receipt hashes prove byte integrity, not truthful authorship or reviewer identity. Your governing runtime still decides acceptance.

Workflow memory and recorded lessons do not train model weights. No claim of doubled quality or 59–90% cost savings has been established by these fixtures. Paired accepted-task measurements are required before making a savings claim.

## Verification and contribution

Run `npm test` before proposing changes. Include a reproducer for a defect and preserve negative tests. GitHub Actions runs the same suite on Linux and Windows. The [MIT license](LICENSE) permits reuse and white-label adaptation; keep its copyright notice.
