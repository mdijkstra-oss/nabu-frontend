# recorder

Every gateway call in the app ends at one `fetch` in `app/lib/agent/client/fetch.ts`. The recorder replaces the global `fetch` with a wrapper that copies what crosses it and forwards everything unchanged. It is the only component that sees a call, and it sees every call — which is why it sits here and not at the `ParseCall` parameter the app already exposes.

## Contract

`installRecorder()` — replaces `globalThis.fetch`, returns a handle with `drain()` and `uninstall()`. It performs network I/O and mutates a process global; both are the component's entire reason to exist and both are named here rather than hidden. `installedRecorder()` returns the handle of the wrapper currently sitting at `globalThis.fetch`, or nothing, which is how [host.md](host.md) installs once.

`drain()` resolves to the recorded calls in dispatch order, empties the buffer, and restarts the numbering, so the next drain returns only what was recorded since and its first call is `#1` again. It is asynchronous because the copy of a reply is decoded after the app has already been handed the original; `drain()` waits for every in-flight decode before returning. That is what lets `--count` attribute each iteration's calls to that iteration, and it means a caller that drains mid-run loses what it did not read.

`uninstall()` puts back the `fetch` that was there before. Tests use it; the tool never does.

Each **RecordedCall**:

- `index` — 1-based, assigned when the request goes out. Calls run concurrently, so this is the only stable way for [report.md](report.md) to label a reply and for a reader to line it up against the request that produced it.
- `endpoint` — the path, `/region-finder` and the like, taken from the request URL with the host stripped.
- `request` — the JSON body exactly as sent, as the string that went over the wire.
- `reply` — the model's text. Absent when the call produced none.
- `failure` — a sentence naming what went wrong. Absent on success. Never both absent.

There is deliberately no tally, no duration and no timestamp. The report derives the call count from the array's length and the failure count by filtering it, and nothing in the spec reads a clock — a field no named consumer would miss does not belong in the shape.

**It intercepts the gateway and nothing else.** A request whose origin is not `getLlmHost()` is forwarded untouched and never recorded. Without that rule an embeddings or storage call would land in the report as a model reply.

**It tees rather than reads.** The response is cloned; the app reads the original stream and the recorder reads the copy. The original must arrive at the app byte-for-byte and unconsumed, because the app's own streaming parser and its `describeFailure` path both read the body themselves and a half-consumed stream would fail in a way that looks like a broken model.

**It decodes with the app's parser.** The cloned bytes go through `initialParseState`, `processLine` and `stateToBlocks` from `app/lib/agent/client/parse.ts`, then `extractText` from `convert.ts` — the same functions `fetch.ts` uses. The recorded reply is therefore the text the app got, not a second opinion about it. A parser bug shows up identically on both sides, which is the correct behavior for a tool whose job is to attribute blame accurately.

Bytes off the wire are hostile until parsed. A response that is not the event stream the parser expects yields no `reply`; it yields a `failure` naming the status and carrying the first part of the body, so a gateway that answered with an HTML error page or a plain-text key complaint reads as what it is. Downstream sees a `RecordedCall` and never a stream.

**It swallows nothing.** A rejected `fetch` — connection refused, DNS failure — is recorded as a failure and then rethrown, so the app's own error handling runs exactly as it would in the browser. A non-2xx response is recorded and returned, not converted.

**It does not deduplicate.** `callAndParse` retries once when a reply fails its schema, and `callLlm` retries up to twice on a content filter, so a run can contain several fetches with identical bodies. Each is its own `RecordedCall`. Collapsing them would hide a retry loop, which is one of the things the tool exists to make visible.

## Prior art

The repo already records model calls: `app/lib/agent/client/raw-store.ts` keeps endpoint, request body, streamed content and duration for the debug panel, and `fetch.ts` feeds it through `startRawCall` and `completeRawCall`. Reading that store instead of wrapping `fetch` was the obvious candidate and was rejected: it holds the raw block JSON rather than the model's text, it throttles its notifications through `requestAnimationFrame` for a UI that is not running, and it is a module-level singleton whose lifetime is a page load. Wrapping `fetch` is smaller than adapting it.

The `ParseCall` parameter on `runFind`, `runMark`, `filterEntries` and `verdict` was the other candidate, and it is the one the conversation assumed. It was rejected on coverage: `classifyDocument`, `generateFileHydes` and `describeGroup` import `callAndParse` and `callLlm` directly with no parameter to override, so three of the eight agents in [agents.md](agents.md) would record nothing at all, and giving them a seam means changing app code — which this tool does not do.

The SSE decoding is not reimplemented. `app/lib/agent/client/parse.ts` already does it and is already exercised by the app's own tests; the recorder imports it.

## Tests

**Skeleton.** Carries the claim that the reply printed is the reply the app received. In the walking skeleton this is visible as the hits in the constructed output being derivable by hand from the printed reply.

**Contract**, riskiest first.

- Given a response body that is not an event stream — an HTML error page — when a call completes, then the call has a `failure` naming the status and carrying the start of the body, has no `reply`, and the app still reads the same body itself.
- Given `fetch` rejects with a connection error, when a call is attempted, then the call is recorded with a `failure`, and the rejection propagates to the caller unchanged.
- Given a non-2xx response carrying a gateway error object, when a call completes, then the failure names it, and the app's own `describeFailure` reads the same body successfully — proving the tee left the original unconsumed.
- Given a well-formed event stream, when a call completes, then the app's reader receives every byte, and the recorded `reply` equals `extractText` applied to the blocks the app parsed from it.
- Given two calls dispatched concurrently and completing out of order, when the run drains, then indices are in dispatch order and no reply is attributed to the wrong request.
- Given a fetch to an origin other than `getLlmHost()`, when it completes, then nothing is recorded and the request and response are unmodified.
- Given two calls with byte-identical request bodies, when the run drains, then both appear.

**Isolation.** Runs with no neighbours real. Install the wrapper over a stub `fetch` that returns canned event streams, canned error pages and canned rejections; assert on what `drain()` returns and on what the stub's caller received. The agents, the runner and the report are not involved, and the gateway is never contacted.
