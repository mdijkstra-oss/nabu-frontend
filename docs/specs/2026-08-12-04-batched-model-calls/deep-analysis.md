# Deep analysis

The filter already batches; its batcher and payload move onto the shared pieces. Adjudication does not — every contested envelope in a pass goes into one unbounded call today — and gains real batches. The find step changes nothing here: it runs the search pipeline, so it inherits [search.md](search.md).

## Contract

### The payload

An envelope renders as a **plain** entry — the answer addresses the envelope whole, so no sentence numbers:

- Children first: `<code>` always; adjudication adds `<keep-case>` and `<remove-case>` carrying the contested envelope's two arguments, which today ride inside the target block as trailing tags.
- Content: three segments — the halo sentences before the span, a `marked` decorator wrapping the candidate, the halo after — the composition `triplet.ts` builds today, handed to the renderer as segments so document text is defused without touching the decorator ([envelope.md](envelope.md)). `<marked>` stays exactly as it is in the payload: the filter prompt leans on it as the boundary of the vote, and it is the one element whose containment claim is true.
- The `code` attribute leaves the `<entry>` tag — the attribute set is closed to `id` and `file` ([envelope.md](envelope.md)).

The model's answers keep their shape: `{ id, code, judgment, reason }` per envelope, ids resolved through the call's entries. The demand that the model quote the language it judges stays in the prompt untouched — it is model-directing, not data, and never becomes a ref.

### Batching

- `planBatches` is replaced by the packer with `groupKey` = code, `maxGroups` 3, cap 20, budget 40,000 ([packing.md](packing.md)), sized on the rendered entry.
- The filter's two voters per batch are unchanged; both votes still come from the same rendered payload.
- Adjudication packs its contested envelopes with the same numbers and runs its calls through a pool at concurrency 5. A contested envelope is now judged with only its batch as company — a deliberate change named in [spec.md](spec.md); nothing in the adjudication prompt reasons across envelopes, so the isolation the filter's distribution warning already demands extends to adjudication's batches. Each adjudication call scopes its code sources and its schema's code enum to its batch's codes, as the filter already does per batch — the old single call scoped to every survivor's code, contested or not, which a bounded call has no use for.

### Silence and failure

Nothing here records silence durably, so today's defaults stand: an envelope no voter answered survives with its missing votes traced (`buildVoteList` semantics), a contested envelope adjudication stays silent about keeps its ambiguous state, and a whole-call failure records its error while the envelopes pass through unjudged. No acknowledgment requirement, no requeue rounds. What changes is only classification honesty per [calling.md](calling.md): a failed call is a failure in `errors`, never an empty result.

## Prior art

- `app/lib/agent/tools/apply-deep-analysis/batching.ts` — deleted; `planBatches`' grouping semantics live on as packer options and its tests move there.
- `triplet.ts` — becomes the composer of content segments and children over the envelope renderer; its `mapping` table's job is the resolver's.
- `step-filter.ts`, `step-adjudicate.ts` — vote merging, stats, tracing survive; only payload rendering and (for adjudication) the single-call shape change.
- `messages.ts` — `markCacheBreakpoint` moves to `app/lib/calls/` and is imported back; the two breakpoints it marks today (framework, then code sources) survive as this site's stable-preamble declaration ([envelope.md](envelope.md) permits several); the source-file scoping and framework validation are untouched.

## Tests

**Skeleton.** Step 4: one coding pass; annotations land; the filter request shows `<code>` as a child inside `<entry>`.

**Contract.**

> **Given** 45 envelopes under one code, 4 under a second and 5 under a third, **when** packed, **then** the large code produces batches of 20, 20 and 5, all single-code, and the two small codes share a mixed batch of 9 — `batching.test.ts` semantics through the packer, remainder included.

> **Given** envelopes whose rendered halos total past the budget at fewer than 20 items, **when** packed, **then** the batch closes on characters — the case the old count-only batcher could not express.

> **Given** 30 contested envelopes, **when** adjudication runs, **then** at least two calls are made and the merged stats equal what one call over all 30 would have produced for the same verdicts.

> **Given** a filter call returning ids including one not in the call, **when** resolved, **then** that judgment is dropped and the rest apply — today's `mapping.find` behavior through the resolver.

> **Given** a contested envelope rendered for adjudication, **when** the payload is inspected, **then** `<code>`, `<keep-case>`, `<remove-case>` precede the content and `<marked>` sits inside it.

> **Given** one voter's call unanswered, **when** consensus merges, **then** the surviving envelopes match today's missing-vote behavior — pinned by `consensus.test.ts`, which must not change.

**Isolation.** The steps take `callAndParse` results through the same seam as today; tests script per-voter outcomes. The pipeline's tests fake the steps, unchanged.
