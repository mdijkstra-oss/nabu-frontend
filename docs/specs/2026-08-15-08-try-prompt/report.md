# report

Everything the tool produces goes through one pure function that turns a run into a string. It reads no clock, touches no filesystem, and knows nothing about the process it runs in — the runner prints what it returns. That is the seam: the output format can be rewritten without any of it being reachable only by running a real call.

## Contract

`render(run)` returns the text of one iteration. Its input:

- `agent` — the name, and the `constructedLabel` from [agents.md](agents.md) so the artifact is announced as what it is rather than as "output".
- `path` — the positional argument, echoed so a scrolled-back run says what it was about.
- `calls` — the `RecordedCall` list from [recorder.md](recorder.md).
- `constructed` — the artifact, or `undefined` for absent.
- `outcome` — `{ kind: "completed" }`, or `{ kind: "rejected", message }`.
- `view` — `both`, `replies-only` or `constructed-only`.
- `showRequests` — whether request bodies are included.
- `iteration` — which of how many, when counting.

Sections, in this order.

**The header, always, first.** Agent, path, how many calls went out, how many failed, and the outcome. This line exists for one reason: a run that failed and a run that found nothing both end with an empty artifact, and if the difference is not on the first line the reader will attribute a broken gateway to a broken prompt. Three calls that all failed on a refused connection says so here, before anything else is read.

**Failures, if any, next.** Each names its index, its endpoint, and its reason, before a single reply is printed. A reader scanning for what went wrong should not have to pass the thing that went right on the way.

**Requests, when asked.** Off by default. Each is labelled with the index of the call it belongs to, which is the same index its reply carries.

**Replies.** One block per call, labelled by index and endpoint, in dispatch order. A call that failed still appears in this section, as its failure — omitting it would leave a gap in the indices and make a run of six calls look like a run of four.

**The constructed artifact, last**, announced by the agent's label and printed as JSON. When there is none, the section says so in words. It never prints `null`, `{}` or an empty array in place of an absent artifact, because those read as a result and this is the absence of one.

**The report explains nothing it was not told.** A run of zero calls that completed says zero calls and no artifact; it does not offer a reason, because the report does not have one and a reason it invented would be the first thing in this tool that guessed. The two agents where that happens — `topic-assigner` on a file that is already classified, `corpus-describer` on a directory below the word threshold — document it in [agents.md](agents.md).

**Under `--count`, iterations are printed whole and in sequence**, each with its own header and a separator naming which it is. Nothing is said about how they differ. There is no diff, no summary, no stability count, and no pairing of a model reply against the rows of the constructed artifact. The reader does the comparing; a tool that did it would have to be trusted about it.

## Prior art

`app/lib/debug/chunking-report.ts` is the same component for the neighbouring script: pure string builders — `renderCorpusReport`, `renderDocumentDump` — unit-tested in `chunking-report.test.ts` with no process and no script involved, and called from `scripts/debug-chunking.ts` which does nothing but print what they return. This follows it, including where it lives.

A structured output mode — JSON in, JSON out, for a caller to parse — was rejected. The reader is a model, prose costs it nothing to read, and the artifact is already JSON where JSON is what it is.

## Tests

**Skeleton.** Carries the walking skeleton's visible surface: a header, one reply, and the hits.

**Contract**, riskiest first.

- Given three calls that all failed with a connection error and no artifact, when rendered, then the first line says the run failed and names the reason, and the artifact section says in words that nothing was constructed. The rendered text contains no `null` and no empty JSON literal.
- Given a completed run of zero calls and no artifact, when rendered, then the header says zero calls, the artifact section says nothing was constructed, and no explanation for either appears.
- Given five calls of which the second and fourth failed, when rendered, then the header carries both counts, both failures are named with their indices before the first reply, and the reply section still shows five entries numbered one through five.
- Given `showRequests` false, when rendered, then no request body appears; given it true, then each request carries the index of its reply.
- Given `view` is `replies-only`, then no artifact section appears; given `constructed-only`, then no reply section appears; in both cases the header still appears.
- Given `iteration` is two of three, when rendered, then the separator names it and the text says nothing about the other two.
- Given a constructed artifact that is an empty array from a run where every call succeeded, when rendered, then it prints as an empty array — the model was asked and answered nothing, which is a result.
- Given every call succeeded and the outcome is a rejection, when rendered, then the header says the run failed and carries the rejection's message, and it does not read as a clean run merely because no call failed.

The last three cases are the set that matters. An empty artifact from a successful run, an absent artifact from a broken gateway, and an absent artifact from an adapter that threw after every call came back fine must not render alike, and all three are things this tool will produce constantly.

**Isolation.** No neighbours. `render` is fed hand-built `RecordedCall` arrays and plain values; the recorder, the runner, the agents and the gateway are all absent. Every case above is a string assertion on the returned text.
