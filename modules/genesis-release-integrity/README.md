![Release Integrity](docs/cover.svg)

# Release Integrity

Publish an explicit, inspectable package of known bytes.

**Node.js 20+ · Built-in modules only · MIT · No daemon or model account required**

[Why use it](#why-use-it) · [Quickstart](#quickstart) · [API and examples](#api-and-examples) · [Limits](#limits)

## Why use it

A public export can accidentally include internal files or differ from reviewed bytes. Check an explicit text inventory and compare the consumer manifest.

Use it for: **White-label source releases, sanitized examples and remote checkout verification.**

| A common starting point | This system adds | Why that helps |
| --- | --- | --- |
| Implicit assumptions and scattered state | An explicit, bounded input contract | You can inspect what was actually considered |
| A success flag | A structured result with gaps and failure cases | Missing evidence remains visible |
| A one-time example | Runnable positive and negative fixtures | You can test the behavior before adopting it |

This is a small library you integrate into your application. It is useful when this particular control is missing; it does not replace your existing agent, CI or business policy. These are design differences, not benchmark claims of superiority.

## Quickstart

```sh
git clone https://github.com/Wassimyounes01/genesis-release-integrity.git
cd genesis-release-integrity
npm test
npm run demo
```

No dependency installation is needed. Tests use temporary synthetic data and do not contact customers, charge payments or call model providers.

## API and examples

Exports: **inspectRelease, verifyRelease**. See [the implementation](index.cjs), [runnable demo](examples/demo.cjs) and [complete input fixtures](test/index.test.cjs).

```js
const {inspectRelease,verifyRelease}=require('..');
const request={root:require('node:path').resolve(__dirname,'..'),files:['README.md','index.cjs']};
const reviewed=inspectRelease(request);
console.log(JSON.stringify(verifyRelease({...request,manifest:reviewed.manifest}),null,2));
```

The tests document valid contracts, stale evidence, missing fields and failure behavior. Synthetic fixtures demonstrate mechanics; their values are not measured product-performance results. Use only authorized inputs in a real workflow.

## How it connects

1. **Inventory files.**
2. **Screen content.**
3. **Verify consumer.**

Use this module independently or find it in the [Genesis Suite](https://github.com/Wassimyounes01/genesis-suite). The suite connects planning, bounded workers, adaptation and evidence. Operational orchestration remains the responsibility of the host application.

## Limits

Heuristic screening is not a complete secret detector. Review content and history separately. Archives and binary assets require other tools.

Workflow memory and recorded lessons do not train model weights. No claim of doubled quality or 59–90% cost savings has been established by these fixtures. Paired accepted-task measurements are required before making a savings claim.

## Verification and contribution

Run `npm test` before proposing changes. Include a reproducer for a defect and preserve negative tests. GitHub Actions runs the same suite on Linux and Windows. The [MIT license](LICENSE) permits reuse and white-label adaptation; keep its copyright notice.
