# Search

The search filter and scout become callers of the shared machinery. The pipeline around them does not move: `verdict` keeps its stage signature, and everything upstream (probe, cap, merge) and downstream (trim, extend) is untouched.

## Contract

### The filter

`verdict` keeps its signature toward `pipeline.ts` — hits in, filtered hits streamed out per batch, `target` and `maxBarren` honored — with one visible change: its result carries **the unconsumed hits themselves**, not a count. Today `pipeline.ts` multiplies the pool's batch count by `FILTER_BATCH_SIZE` and slices a suffix; that arithmetic breaks twice over — batches vary in size now, and a failed batch can sit _between_ consumed ones, where no count-and-slice can reach it without re-including hits that were consumed. So `verdict` returns the hits from batches never dispatched plus the hits from unanswered calls, in score order, and `pipeline.ts` uses that list as `rawRemaining` directly. `FILTER_BATCH_SIZE` retires; `computeMaxBarren` derives from the packer's item cap instead.

Internals:

- A hit becomes a numbered entry ([envelope.md](envelope.md)): its sentence array as content, its file on the tag, no children. Hits without text pass through unfiltered, as today.
- Batches close per the search row in [packing.md](packing.md); the pool runs at concurrency 5.
- The answer schema keeps `start`, `end`, `confidence`, `reasonToKeep`, with `start`/`end` as ref strings in the `3.7` form. Resolution ([envelope.md](envelope.md)) yields the hit and 0-based sentence indexes; from there `matchRanges`, trim and extend are byte-for-byte today's path. A ref that doesn't resolve is dropped.
- A silent hit in an answered call is a non-match — today's semantics, and nothing durable records it, so no acknowledgment requirement and no requeue.
- An unanswered call rejects instead of resolving `[]`, so the pool's failure path (not the barren counter) sees it — the fix specced in [calling.md](calling.md). The two stops report differently through the pipeline: the barren stop keeps meaning `exhausted` — nothing more to find down the ranking; the failure stop ends the search with `exhausted` false and the unconsumed hits in `rawRemaining`, so the search reads as incomplete rather than dry.

### The cache

Today's key hashes the _rendered_ passage — prefix letters included — so the same hit at position 3 in one run and position 0 in the next caches under two keys and re-calls the model. The key becomes `buildKey([intent, hit text])`: content, not rendering. The stored value is unchanged — spans with entry-local sentence numbers were already position-independent. The prefix bumps `filter-v4 → filter-v5`; old entries age out of the LRU untouched.

The gates keep today's per-batch order: hits are packed into batches first, and within each batch scout runs, then the cache is consulted for what survives it, then the call carries only the cache misses. Scout before cache is load-bearing — a cache answer must never resurface a hit scout would exclude — and packing first is what keeps the target/barren early exit meaning what it means today: batches the pool never dispatches are never scouted. A batch's streamed output merges cached and fresh spans, so cached results still count toward `target` and reset the barren counter, and a fully-cached batch streams without making a model call.

### Scout

Scout keeps its structure — per verdict batch, per unique file, one exclusion pass — and changes payload and numbers:

- A file's chunk blocks render as **plain** entries in document order, one per chunk, `file` on every tag. Ranges in the answer are entry ids, so consecutive ids must be consecutive chunks; the packer preserves order, and a file large enough to split (budget row in [packing.md](packing.md)) has ranges scoped within each call, which only weakens exclusion at one seam per 100k characters.
- Concurrency drops from 10 to 5.
- The id-to-`chunkStart` table replaces nothing — it is exactly what `excludedChunkStarts` does today with different id provenance.

## Prior art

- `app/lib/search/verdict.ts` — `prepareHit`, `chunkHits`, the letter-prefix rendering and the swallow-to-`[]` catch are replaced by the shared pieces; `parseMatch` survives as ref resolution plus the same-prefix/order checks it already does; `dedupOverlapping`, `extractMatchTexts`, `reconstructBatchHits` survive unchanged.
- `app/lib/utils/storage-cache.ts` — kept as the cache; only key and prefix change.
- `app/lib/agent/tools/scout-filter/` — the endpoint, schema and `expandRanges` survive; only the message builder moves onto the envelope.

## Tests

**Skeleton.** Step 3: one search through the real stack, spans render correctly, payload shows the new envelope and ref form.

**Contract.**

> **Given** a hit that appeared at position 7 of one batch, **when** a later search puts it at position 0 of another, **then** the cache answers, no model call carries it, and its spans still stream with its batch's results.

> **Given** an answered call whose refs include one naming an absent entry, **when** resolved, **then** that span is dropped and the entry's other spans survive.

> **Given** three batches where the middle one's call fails and the other two answer, **when** the pool settles, **then** the barren counter is unchanged, `rawRemaining` contains exactly the failed batch's hits, and no consumed hit reappears in it.

> **Given** a search whose filter calls fail three times running, **when** the failure stop fires, **then** the result is not exhausted and every undispatched hit sits in `rawRemaining` — a dead gateway reads as incomplete, never as "nothing else found".

> **Given** hits totalling 30,000 characters with the 20,000 budget, **when** packed, **then** two calls, and the streamed results arrive per call as today.

> **Given** a scout answer excluding entries 3 through 5, **when** mapped back, **then** exactly those chunks' `chunkStart`s are excluded — the hits gate is unchanged from today.

**Isolation.** `verdict` and `scoutFilterBatch` take the parse call through the same seam the region detectors use; tests script answered, unanswered and partial responses without a network. The pipeline's own tests keep faking `verdict` at its stage boundary.
