# Regions

The reason this feature exists: region detection sends one request per unit and one per hit, and the speaker kind sends them strictly one at a time. Both detectors become callers of the shared machinery. The sync around them — reconciliation, scanned bookkeeping, write and quarantine — keeps its logic; what changes is that its work lists reach the model packed instead of one at a time.

## Contract

Calls stay **per kind**: a kind's rules are the preamble, and the preamble is what the provider cache reuses across calls. Within a kind, one call mixes units and hits from any number of documents — the work lists in `runKind` are already flat across files, and each entry names its file on the tag.

### Find

- An entry is one unit: its sentences as numbered content, no children. Numbering is local (`[3.1]`…), and the map back is `unit.firstSentence + (n − 1)` — the offset the payload used to carry moves to resolution.
- Batches close per the find row in [packing.md](packing.md). Only units that reconciliation marked as unscanned are packed — this is what keeps claim H2 true: an edit re-detects near the edit, never the whole corpus.
- **The answer acknowledges every entry**, because silence here is recorded durably: a unit enters `scanned` and is never looked at again until its text changes. The schema becomes a list of `{ entry, occurrences }` where `occurrences` may be empty and each occurrence is `{ quote, ref, value }`. An acknowledged entry enters `scanned` (empty or not); a silent entry stays pending per the rounds in [calling.md](calling.md); an abandoned entry is simply not scanned, so the next tick offers it again.
- The gate keeps its rules per entry: the quote must locate inside the entry's own sentences (the neutralize-and-scan in `hits.ts`, scoped to one entry), the value normalizes per kind, duplicates collapse per occurrence. A ref that resolves to nothing drops the occurrence, not the entry's acknowledgment. An occurrence's entry is the one its ref resolves into; when that entry is one the answer left silent, the occurrence is dropped too — a stray ref never converts silence into an acknowledgment.
- **Speaker stays serial**: concurrency 1, and the known-values list in the preamble — **seeded from every stored region value corpus-wide by `seedVocabulary`, exactly as today** — grows between calls through the rounds runner's `onCallAnswered` hook: values found by call _n_ are known to call _n + 1_. The seed is what makes value reuse hold across ticks, not just within a pass. Fifty units become three calls, still one at a time. Date runs at 5.
- Progress (`processed`/`total`) counts units that left the pending list — acknowledged or abandoned — and on the no-progress exit ([calling.md](calling.md)) the pending remainder counts too, so every terminal state reports complete.

### Mark

Mark's windows overlap by construction — hit _i_'s window runs from hit _i − 1_'s sentence to hit _i + 1_'s — so sending one window per hit sends the text between two hits twice. The batched shape sends a stretch once and asks several questions against it:

- After `computeWindows`, windows of the same kind in the same document whose sentence ranges overlap or touch **coalesce into stretches**, greedily in document order. A stretch closes at **10 occurrences**; the next opens at the following hit's window, and the seam duplicates a little context once, which is what today's shape did everywhere. The packer then packs stretches as items — its budget bounds the call, the occurrence cap here bounds the stretch, and the two numbers own different things ([packing.md](packing.md)). A lone stretch past the call budget gets a call of its own under the packer's oversized rule.
- An entry is one stretch: numbered content, plus one `<occurrence n="2" ref="3.5">quote</occurrence>` child per hit in it, children first. `n` is the occurrence's ordinal within its entry, and it exists because a ref alone under-identifies: two same-kind hits in one sentence with different values are legal (the find gate collapses only same-sentence-same-value pairs), and both land in the same stretch with the same ref. The "already located, not in doubt" framing moves to the prompt, said once ([prompts.md](prompts.md)).
- The answer is per occurrence: `{ entry, n, start, end }` — the entry id and occurrence ordinal route it, `start`/`end` are sentence refs. Resolution yields entry-local indexes; `repairRange` runs per occurrence exactly as today — clamp to the stretch, collapse inverted ranges to the hit sentence, always include the hit — then the stretch's window start converts to document indexes. An `(entry, n)` pair naming no occurrence in the call is dropped, and so is an answer whose `start` or `end` resolves outside the occurrence's own entry — in both cases the occurrence stays pending, one miss.
- **The requeue unit for mark is the occurrence, not the stretch.** A silent occurrence goes back on the work list as its hit and is re-coalesced next round with whatever else is pending — answered neighbours are gone, so the new stretch is smaller. Its miss count is keyed on the occurrence's identity (file, kind, value, hit sentence), which survives re-stretching; after three misses it is abandoned and its hit joins the unranged rows, today's failure path. Hits left unrecorded by the no-progress exit ([calling.md](calling.md)) join the same rows: a hit that got no mark this pass must land somewhere, and unranged is the row the next pass re-offers. Nothing durable records mark silence beyond that.
- Mark leaves the serial queue for both kinds: it never invents values, so the vocabulary rule doesn't reach it. Concurrency 5.

### What the sync keeps

`prepareWork`, `reconcileHits`, `reconcileMarks`, `resolveOverlaps`, `withRangeHash`, `buildBlock`, the write path and the write-failure quarantine are untouched. `recordFound` runs per acknowledged entry instead of per call. The `detect/` seam changes shape: `find` and `mark` take work lists and yield per-entry outcomes as they settle, instead of one input each.

## Prior art

- `app/lib/regions/sync.ts` — `runKind` already flattens work across documents before the pool; batching packs the list that exists. The keyed queue's serialization job moves into the rounds runner at concurrency 1.
- `app/lib/regions/detect/window.ts` — `computeWindows` survives as the per-hit bound; coalescing is a new step on its output. `MARK_WINDOW_CHARS` remains the per-occurrence context bound inside `clampToChars`.
- `app/lib/regions/detect/hits.ts`, `repair.ts`, `normalize.ts` — the gates survive, rescoped from "the call's one unit" to "the ref's entry".
- `app/lib/regions/detect/payload.ts` — document-global numbering; replaced by the envelope ([envelope.md](envelope.md)).

## Tests

**Skeleton.** Steps 1 and 2 are this component: one find call per kind covering two documents, mark payloads carrying several occurrences, and the written blocks matching the single-call baseline recorded before the switch — same values, same extents, on documents written so a competent model has no room to differ.

**Contract.**

> **Given** ten unscanned units and a find call that fails, **when** the pass settles, **then** none of the ten is in `scanned` and all ten are packed again next round.

> **Given** an answered find call acknowledging four of five entries, **when** outcomes land, **then** the four enter `scanned` (including any acknowledged empty), the fifth stays pending, and after three silent rounds it is abandoned unscanned.

> **Given** units from two documents in one call, **when** occurrences resolve, **then** each hit lands in its own document's work — file identity comes from the entry, never from the numbering.

> **Given** two documents naming the same speaker, packed into one serial pass, **when** the second call's preamble renders, **then** it lists the value the first call found.

> **Given** an occurrence ref naming a sentence past its entry's end, **when** resolved, **then** that occurrence is dropped and the entry's acknowledgment stands.

> **Given** two speaker hits three sentences apart in one document, **when** windows coalesce, **then** one stretch carries both occurrences and the text between them appears in exactly one payload.

> **Given** a mark answer whose range for one occurrence is inverted, **when** repaired, **then** the range collapses to the hit sentence — `repair.test.ts` semantics, per occurrence.

> **Given** an edited document among untouched ones, **when** the next pass packs find entries, **then** only units reconciliation marked unscanned appear in any payload (claim H2).

**Isolation.** The detectors take the parse call as a seam (`seam.ts`), as today; tests script per-call answers including partial acknowledgment. The sync's tests fake the detectors at the new list-in, outcomes-out boundary, as `sync.test.ts` fakes `DetectCalls` now.
