# Engine

The unified reconciler from [spec.md](spec.md): one loop that watches the file store, diffs for dirty content files, and runs `finalize(doc)` — embed, then classify, then detect regions — per file through the existing pool (`app/lib/utils/pool.ts`). It replaces the three phase-scoped reconcilers in `app/lib/embeddings/sync.ts`, `app/lib/corpus/sync-topics.ts`, and `app/lib/regions/sync.ts`. Files reach the store only through [ingest](ingest.md); the engine meets ingest at the store and nowhere else. [Import UI](import-ui.md) and [boot view](boot-view.md) consume the [event stream](#events); the engine never knows about React. BM25 stays its own reconciler, out of scope here (decision in spec.md).

## Contract

### The loop

One subscription (`subscribeContentChanges` in `app/lib/files/subscribe-content.ts`, which already ignores hidden files), one debounce, one run function:

1. **Diff.** Compare the previous store snapshot to the current one, content files only (`isEmbeddableFile` in `app/lib/embeddings/filter.ts`). Changed or new paths are candidates; paths gone from the store are deletions. This diff selects _candidates_ — it says a file may need work, never which stage.
2. **Corpus context.** Before the pool: snapshot existing type/subject labels (`collectExisting` in `app/lib/corpus/sync-topics.ts`) as classification context, and seed the shared region vocabulary for kinds that need it (`seedVocabulary` in `app/lib/regions/sync.ts`). Both are corpus-scoped reads that cannot live inside a per-file work item.
3. **Pool.** `processPool` over the candidate files at concurrency 4 (the pool's default). Each work item is `finalize(doc)`: embed this file's chunks, then classify it, then detect regions in it — two `await`s, no scheduler (stage order settled in spec.md). Within one file, embedding still batches chunks into API calls via `batchBySize`; those batches run sequentially inside the file — endpoint parallelism comes from the file pool, not from cross-file chunk batching (given up deliberately, spec.md).
4. **Tail.** After the pool settles: language statistics (`getSignificantLanguages`, a database read) feeding description sync (`processDescriptionSync` in `app/lib/corpus/sync-descriptions.ts`). Corpus-scoped, no per-file completion to report, so it runs once per pass, not per file.

Boot is the first run — every file is dirty against an empty previous snapshot. Later store changes (edits, imports via ingest) re-trigger the same run, debounced at 5 s with a 30 s max wait, replacing the three debounces it retires (embeddings 5 s, corpus 30 s, regions 5 s / 30 s max). The 5 s keeps behavior claim E1 — chunking at ~5 s after an edit settles — true. Consequence, accepted: classification cadence moves from the topics reconciler's 30 s to the unified 5 s, still gated per file by the content-hash predicate. These numbers live here and nowhere else.

The engine is constructed with its `onEvent` listener wired, then started after initial file load and database sync complete — exactly where `project.tsx` starts the three reconcilers today. The first pass's candidate set is therefore the fully loaded store, and `ready` is meaningful. Started earlier, the first pass would fix its candidates against a near-empty store, resolve `ready` trivially, and dismiss the loading screen with the corpus unprocessed.

One pass runs at a time, and a pass's candidates are fixed at its start: a file arriving mid-pass is never picked up by the running pass. A notification arriving mid-pass requests a rerun rather than starting a second pass or being dropped — the coalescing `runChain` pattern from the regions sync, not the embeddings sync's `syncing` guard, which silently loses the notification. The previous-snapshot reference advances only when its pass completes, so a file edited or ingested mid-pass diffs dirty on the rerun instead of falling through the gap.

Each stage decides its own dirtiness with the predicate its reconciler already owns:

| Stage    | Predicate                                                                  | Lives in                                                            |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| embed    | chunk-hash diff against the companion (`diffChunks`)                       | `app/lib/embeddings/diff.ts`                                        |
| classify | `shouldReclassify` — stored hash vs `contentHash`                          | `app/domain/data-blocks/attributes/topics/selectors.ts`             |
| regions  | scanned units with rules hash (`reconcileHits` leaves `unitsToFind` empty) | `app/lib/regions/reconcile.ts`, `app/lib/regions/kinds/registry.ts` |

A candidate file dirty for one stage but clean for another still settles the clean stages explicitly — a `settled` event with no preceding `queued` or `working` — never silence on the pass where the pair first settles (spec.md decision). A pair that is settled and still clean stays silent on later passes; the once-per-pair rule is in [events](#events).

### Dependencies

Injected at start, mirroring the deps style of the three current reconcilers (`EmbeddingSyncDeps` in `app/lib/embeddings/sync.ts`, `CorpusSyncDeps` in `app/lib/corpus/sync-topics.ts`, `RegionSyncDeps` in `app/lib/regions/sync-types.ts`) — the engine's deps are their union plus two new seams (`classify` and `syncDescriptions`, which today are direct imports with no injection point), and the list below enumerates the result in full:

- `getFiles`, `getFile`, `updateFile`, `deleteFile`, `subscribe` — store access, wired from `app/lib/files/store.ts` (`subscribe` is `subscribeContentChanges`)
- `embeddingsUrl` — the embeddings endpoint (`getEmbeddingsUrl`)
- `fetchBatch` — the embed stage's batch call, carried over from `EmbeddingSyncDeps` where it already exists as an optional injection; the convergence test observes chunk-embedding silence through it
- `classify` — the classify stage's call, a new injectable seam defaulting to `classifyDocument`, mirroring how the regions stage already injects `detect` in `app/domain/regions/init.ts`
- `writeClassification` — the classify stage's attributes write, a new injectable seam defaulting to `writeClassificationToAttributes`; without it the stage's `executeFileAction` call reaches the global store behind the injected functions' back and a faked store silently loses the write
- `getKinds`, `detect` (find/mark), `writeRegions` — the regions stage's calls, wired as `app/domain/regions/init.ts` wires them today
- `getSignificantLanguages` — tail-step input, wired as `app/domain/corpus/init.ts` wires it today
- `syncDescriptions` — the corpus tail step, defaulting to `processDescriptionSync`, injectable so isolation can fake it
- `onEvent` — the event sink (below)

The three `app/domain/*/init.ts` wiring modules collapse into one engine init that supplies these.

### Handle

- `ready` — resolves when the first pass settles (pool drained plus tail step). The first pass's candidates are fixed at its start; a file arriving mid-pass belongs to the next pass and never gates `ready` — unlike the regions `runChain`, whose chain promise spans coalesced reruns, `ready` covers exactly one pass. Boot gating awaits it exactly as `app/routes/project.tsx` awaits the three handles today; the loading screen dismisses on it per spec.md's boot-gating pin.
- `tick` — run now, return the settled pass. Survives from the corpus handle: `buildSemanticContext` in `app/domain/corpus/init.ts` calls it to guarantee freshness before search, and keeps doing so against the engine.
- `stop` — unsubscribe, cancel the debounce, abort the running pass; the shape `startRegionSync` already has.

### Events

The engine owns this contract; spec.md and both view components link here. Delivery is the `onEvent` dep, supplied at construction, before the first pass begins — a listener wired before start cannot miss boot events. Fan-out to multiple views is the init layer's concern, not the engine's; the engine calls one function and never imports React.

Each event, one file × one stage × one lifecycle step:

- `file` — store path of the content file
- `stage` — `embed` | `classify` | `regions`
- `status` — `queued` | `working` | `settled` | `failed`
- `error` — on `failed` only: a message for the console and the import row's warning state

Lifecycle per stage, three rules: (a) `queued` and `working` are emitted only when the stage's predicate says work is needed — `queued` when the file enters the pool, `working` when the stage starts. (b) A (file, stage) pair transitions into `settled` with an explicit `settled` event exactly once — including settled-with-nothing-to-do, so the UI works for stages that leave no persistent mark (spec.md) — and later passes emit nothing for a pair that is settled and still clean. (c) A pair re-dirtied by a real content change goes through the full lifecycle again, emissions included. Every candidate (file, stage) pair terminates in exactly one `settled` or `failed`. No timeout machinery: a stage that never reports is a bug and belongs in the console.

A file is done when all three stages have terminated. Views derive everything from the stream: the boot view folds it into per-stage settled/total counters; the import UI advances a row per stage and shows, on any `failed`, the warning state [import-ui.md](import-ui.md)'s status table defines. A view ignores events for paths it does not track; how a view treats events for a row it considers finished is the view's own rule, stated in import-ui.md's status contract. Events are an internal contract between the engine and its own init wiring — not hostile input, no validation layer on them.

Granularity is the stage, nothing finer. A large file embedding many chunk batches is `working` from its first batch to its last; the per-chunk progress the old `onProgress` callbacks carried does not survive, because neither view shows it — the boot view counts files per stage, the import row shows a stage label. The tail step (description sync, language statistics) emits no events at all: it is corpus-scoped, has no file to attribute work to, and no view shows it — it is simply inside `ready` and inside every pass.

### Echo and convergence

`finalize` writes back to the store — companion files (embed), an attributes patch (classify), a regions block patch (regions) — and store writes fire the subscription. The engine must not reprocess its own writes; spec.md's walking skeleton names this the first thing to verify. Two mechanisms, both already in the code the engine inherits:

1. **Hidden-file filtering.** Companions end in `.embeddings.hidden.md`; `subscribeContentChanges` skips hidden files (`isHiddenFile`) and the engine's diff only admits `isEmbeddableFile` paths. A companion write never wakes the engine and never becomes a candidate.
2. **Stage predicates come up clean.** The attributes and regions patches change the content file itself, so the file _does_ re-enter the diff as a candidate. Then every predicate settles it: embedding chunks come from `proseOf(content)` (`chunkFileForEmbedding` in `app/lib/embeddings/chunk.ts`), which excludes data blocks, so chunk hashes are unchanged and `diffChunks` keeps everything; `contentHash` strips singleton blocks (`stripSingletonBlocks`), so the hash the classify stage just wrote still matches; the regions block the regions stage just wrote reconciles to zero `unitsToFind` and rewriting it returns `unchanged`. Every (file, stage) pair already settled in the pass that just completed, so the echo pass emits zero events and performs zero writes — no third pass fires.

This convergence is what spec.md's pinned no-op-boot behavior tests: a fully processed project boots with no per-file stage work — no chunk embedding, no classification calls, no region detection; the corpus tail behaves exactly as today and may embed topic labels.

### Failure

Stages are independent — code reading during spec work confirmed classification consumes an LLM excerpt of the prose plus the label snapshot, not the file's vectors, and region detection reads the prose, not vectors or classification. So a stage that throws marks that stage `failed` for that file and the remaining stages still run. A file with a dead embeddings endpoint still gets classified and scanned for regions; each stage terminates its own lifecycle.

The file stays in the store (spec.md decision: a fixer failure leaves the file in the project, in the warning state [import-ui.md](import-ui.md)'s status table defines — never un-import). Nothing is written for the failed stage, so its predicate stays dirty and the next pass retries it — no retry timer, the next pass is simply the next store notification (often the same file's own successful stages patching it). The regions stage keeps its three-strikes write quarantine (`MAX_CONSECUTIVE_WRITE_FAILURES` in `app/lib/regions/sync.ts`): a write that can never apply must not spin the engine; a quarantined file emits `failed` and stops being retried until its content changes.

Pool-level failure containment is `processPool`'s existing behavior: a rejecting work item lands in `failures`, does not stop other files, and three consecutive failures stop the pass — but `finalize` catches per stage and emits `failed` rather than rejecting, so the pool's failure stop is the backstop for engine bugs, not the stage-failure path.

### Deletes and renames

The diff's deleted set carries the companion cleanup that lives in `processSync` today: a content file gone from the store gets its companion deleted (`companionFilename`). Classification and regions need no cleanup — they live inside the deleted file. A rename is invisible work: `renameFile` in `app/lib/files/store.ts` already carries the companion to the new name, so the new path's chunk hashes match the carried companion, the content hash matches the attributes, and the scanned units match — the renamed path settles all three stages with no work.

### Side effects at the boundary

- **Network:** the embeddings endpoint (`embeddingsUrl`, via `fetchEmbeddingBatch`); the LLM proxy — dragoman — for classification (`/topic-assigner` via `app/lib/agent/client`) and region find/mark; the tail step's description calls.
- **Store writes:** companion create/update/delete, attributes patch (`executeFileAction`), regions block patch (`writeRegionsBlock`). All through the injected store functions; the engine holds no store state of its own beyond the previous-snapshot reference.
- **Database read:** language statistics for the tail step.

The engine trusts store shapes — content is already migrated, normalized, and validated by [ingest](ingest.md) — but each stage re-reads through its existing parser: `parseCompanionEntries` validates entries with zod (`app/lib/embeddings/companion.ts`), `readStoredRegions` reads the regions block through its schema (`app/lib/regions/stored.ts`), `getAttributes` parses the attributes block. A malformed block is that parser's problem to reject, exactly as today.

## Prior art

The three reconcilers are the prior art. The engine extracts each one's per-file core and retires each one's subscribe loop; nothing per-file is written new.

- **Embeddings** (`app/lib/embeddings/sync.ts`): reused — `prepareFile` (chunk, parse companion, `diffChunks`), `batchBySize`, `fetchEmbeddingBatch`, `settleUnchangedCompanions`' per-file companion reconciliation, deleted-file companion cleanup, and the short-answer guard — a provider batch returning fewer embeddings than chunks is discarded. The guard lives in the `embedBatch` closure inside `processSync` (`app/lib/embeddings/sync.ts:159-171`), which this list retires, so it is carried into the engine's embed stage explicitly. Retired — `tagNeededChunks`/cross-file batch accumulation (per-file embedding now, spec.md decision), the module's own subscribe/debounce/run loop and `onProgress`.
- **Topics** (`app/lib/corpus/sync-topics.ts`): reused — `shouldReclassify` filtering, `toExcerpt`, `classifyFile`'s core (`classifyDocument` + `writeClassificationToAttributes`), `collectExisting` as the pre-pool snapshot, `processDescriptionSync` as the tail. Retired — its own pool at concurrency 10, its subscribe loop and 30 s debounce; `tick` survives on the engine handle.
- **Regions** (`app/lib/regions/sync.ts`): reused — `prepareDocument`/`prepareWork`/`runKind` as the per-document pass, hit/mark reconciliation, `writeDocument`'s sentence recheck before writing, the write-failure quarantine, `seedVocabulary` as pre-pool context. Retired — its `snapshots` map (the engine's diff replaces it), its `tick`/`runChain`/rerun machinery, its own debounce and stop.

`processPool` (`app/lib/utils/pool.ts`) is the pool — an existing utility with concurrency, abort, and failure accounting; the engine adds no scheduling code.

Why the alternatives lose (settled in spec.md): a fourth parallel reconciler keeps the unit of work at the phase, so a dropped file waits for corpus-wide passes and no view can show one file moving through stages; an import-side executor duplicates fixer logic behind a second entry point, and spec.md pins that import never executes fixer work — it writes through ingest and listens.

## Tests

**Skeleton.** The engine's slice of spec.md's walking skeleton: boot the demo project on the engine — loading screen driven by engine events, dismissing when `ready` resolves — then drop one small markdown file and watch its queue row advance through embed → classify → regions to done off the same stream (row wording in [import-ui.md](import-ui.md)). This is where the echo loop either converges or runs away; it is built and verified before anything below.

**Contract.** Given/when/then against a running engine, riskiest first:

- _Convergence (extends the pinned no-op-boot case from spec.md — the pre-refactor pin observes embedding and detect silence through the seams that exist today; this test adds classification silence once the `classify` seam exists)._ Given a project whose files are fully processed — companions current, content hashes matching, regions scanned — when the engine's first pass runs, then no per-file stage work happens — no chunk embedding (zero `fetchBatch` calls), no classification calls (zero `classify` calls), no region detection (zero `detect` calls) — every (file, stage) pair emits its single `settled` event with no preceding `queued` or `working`, and no second round of work follows the engine's own writes. The corpus tail behaves exactly as today and may embed topic labels through the same endpoint, so the assertion is per-file silence observed through the deps seams (`fetchBatch`, `classify`, `detect`), not total network silence — without those seams the assertion is unmeasurable.
- _Echo pass emits nothing._ Given a file that _does_ need work and whose every stage succeeds, when its pass completes and the echo pass — the pass triggered by the engine's own attribute/regions writes — runs, then the echo pass emits zero events and no third pass fires.
- _Independent stages under failure._ Given a file whose embed stage throws (embeddings endpoint down), when finalize runs, then embed emits `failed` with an error, classify and regions still run to their own terminal events, and the file remains in the store.
- _Retry._ Given that failed file, when the next pass triggers, then only the still-dirty failed stage re-emits — the full lifecycle again, emissions included — while the stages that already settled and remain clean emit nothing.
- _Explicit settle without work._ Given a file with no prose to embed, when finalize runs, then embed emits `settled` with no `queued` or `working` (and keeps no companion), and classify and regions each terminate per their own predicates — an empty excerpt classifies nothing, but the settled event still arrives.
- _Interleaving._ Given two dirty files, when the pool runs them concurrently, then the streams interleave — file A emits classify `working` while file B is still in embed:

  ```mermaid
  sequenceDiagram
      participant P as Pool
      participant A as a.md
      participant B as b.md
      P->>A: embed working … settled
      P->>B: embed working
      P->>A: classify working
      P->>B: embed settled
      P->>A: classify settled
      P->>B: classify working
  ```

- _Delete._ Given a content file with a companion, when the file is deleted from the store, then the next pass deletes the companion and does not queue the deleted path.

**Isolation.** The engine contract suite uses the real store module as its in-memory store — the echo case then exercises the real notification path — while consumers that fake the store fully are served by the `writeClassification` seam, without which the classify stage's `executeFileAction` would reach the global store behind the deps' back. The engine run against a faked store (an in-memory `FileStore` behind the injected access functions) and the stage seams faked through the deps — `fetchBatch`, `classify`, `detect` (find/mark), and the `syncDescriptions` tail — each honoring its real contract (embed writes a companion from the chunks it was given; classify patches attributes with the content hash; regions records scanned units). Assertions land only on the event stream and the store writes: event ordering and terminality per stage, error propagation, companion/attributes/regions content after a pass, and that a second pass over the faked store emits no events and performs no writes. Settle-without-work is observed through the absence of calls on those seams and of store writes, never through an event field. No assertion reaches into engine internals.
