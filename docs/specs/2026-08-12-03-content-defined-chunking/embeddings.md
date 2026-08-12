# Embeddings

Embeddings are the larger of the two consumers of [cutting.md](cutting.md) and the one where a needless re-chunk costs real money: every chunk that fails to match a stored hash is a request to the provider. This file covers what changes in the embedding path and, just as importantly, what does not.

Two things change. Chunks now come from the cutter with the overlap step applied, instead of from counted windows. And batching stops assuming every chunk is the same size, because now they are not.

## Contract

### Where chunks come from

`chunkFileForEmbedding(content)` keeps its name, its signature and its role as the only sanctioned way to turn a file into embedding chunks. Its body becomes: build the sentence array per [sentences.md](sentences.md), cut it per [cutting.md](cutting.md), apply the overlap step, return the chunks.

The `Chunk` shape is unchanged — `index`, `text`, `hash`, `chunkStart`, `chunkEnd` — so `diffChunks`, `toEntryWithEmbedding`, the companion writer and the BM25 index need no new field and no migration. `chunkStart` and `chunkEnd` are still offsets into `extractProse(content)`; that string is now also the sentence axis, which is the point of the exercise, but it is the same string it always was for this component.

`getEmbeddableSource` in `app/lib/search/source.ts` returns `extractProse(content)` and should call `proseOf` instead, so the axis has one name rather than two expressions that agree by coincidence. Its cache stays.

### Batching

Today's batcher slices a flat list every `MAX_EMBEDDING_BATCH_SIZE` entries. That constant is `min(PROVIDER_BATCH_LIMIT, MAX_BATCH_TOKENS / CHUNK_TOKENS)`, which resolves to the provider's 512 and silently assumes every chunk is `CHUNK_TOKENS` long. With a ceiling of 2000 characters plus 200 of overlap, a chunk can be more than twice that, and 512 of them would carry roughly 280k tokens against a 200k budget.

So a batch is accumulated rather than sliced, and it closes on whichever bound is reached first:

- **Characters.** Adding the next chunk would take the batch past `MAX_BATCH_CHARS`, which is `MAX_BATCH_TOKENS * CHARS_PER_TOKEN` — the same token budget, expressed in the only unit this repository counts in.
- **Entries.** The batch holds `PROVIDER_BATCH_LIMIT` chunks.

`MAX_EMBEDDING_BATCH_SIZE` is deleted; both bounds are applied directly, so neither hides inside a number derived from the other. A batch is never empty because the first chunk always goes in before the bound is tested, which is also what handles the one chunk that can exceed `MAX_BATCH_CHARS` on its own: the ceiling is three orders of magnitude below it, but the ceiling does not bind a unit holding a single sentence, so a document with no terminal punctuation is one unbounded chunk. It gets a request to itself and the provider rejects it, which is the boundary's answer to give.

Nothing else about the sync moves. Dirty-file detection, the debounce, companion deletion for removed files, progress reporting and the per-batch companion write all stay as they are.

### The rebuild, which needs no code

Every chunk hash changes when the boundary rule changes, so on the first sync after this ships no stored hash matches:

> `diffChunks` puts every chunk in `needed` and keeps nothing, so `writeCompanions` writes each companion from the new entries alone and the stale ones are gone with it.

That is the existing invalidation doing exactly what it was built for. There is no version marker on the companion format, no migration pass and no dual-write. The one-time cost is a full re-embed of the corpus, accepted because the project has no real users yet.

The BM25 index follows without being told: `app/lib/search/bm25/sync.ts` watches companion files and replaces a source's documents whenever its companion changes. It reads `entry.hash`, `entry.text`, `entry.chunkStart` and `entry.chunkEnd` and derives everything else, so a rewritten companion rebuilds the index for that file.

**One thing there does change.** A chunk's hash is its content, and content-defined boundaries make two copies of the same passage — a boilerplate paragraph in two documents, a section repeated within one — cut identically and hash identically. Counted windows almost never did that; this rule does it whenever the text repeats. BM25 keyed its documents on the chunk hash and skipped an id it already held, so the second copy was dropped from the index and could not be found. The index now keys on the chunk's place, `file` and `chunkStart`, and carries the hash as a field. Fusion still joins cosine and BM25 results on the hash, which is what makes a chunk one result rather than two.

### What search sees, and what it must not notice

Three search-side derivations read chunk counts or offsets and none of their contracts change:

- `getTotalChunks` counts companion entries per file, feeding the per-file cap in `app/lib/search/cap.ts`. Counts will differ because chunk sizes differ; the cap is a ratio, so it adapts.
- `getTotalCorpusChunks` feeds `computeFusedLimit`. Same story.
- `merge.ts` and `trim.ts` slice `getEmbeddableSource(file)` with a hit's `chunkStart`/`chunkEnd` to build displayed text. Same string, same offsets, unchanged.

One improvement falls out rather than being built. Today a chunk's edges are snapped to a sentence only when the boundary lands within `MAX_SNAP_EXTENSION` of one, so a long sentence can be cut in half and a search hit can begin mid-sentence. Now every edge is a sentence boundary by construction, and `MAX_SNAP_EXTENSION` disappears with the code that needed it.

### Side effects

At the boundary, where they already are: `fetchEmbeddingBatch` is the only network call, `deps.updateFile` and `deps.deleteFile` the only writes, and the debounce the only clock. Chunking, diffing and batching are pure and stay callable without any of them.

## Prior art

**`diffChunks` is the reuse, untouched.** It already expresses exactly the incremental behavior this feature is trying to make effective: keep an entry whose hash matches at the current embedding width, re-fetch everything else. It was never the weak part — the weak part was that a counted boundary made almost every hash miss after any edit. Its width check stays too; an entry at another dimension count is incomparable rather than stale.

**The companion format is unchanged.** `json-embeddings` blocks, one per entry, in a `.embeddings.hidden.md` sibling. Nothing about this feature needs a new field, so nothing is added.

**One schema says what an entry is, and every reader uses it.** The companion leaves this process as text and comes back as text, so something has to judge an entry on the way in — and three readers were each judging by their own rules. The sync checked that the vector was an array; the block schema and the database projection's row schema said it had to be an array of _numbers_; the projection's own guard did not look at the offsets at all. An entry with a vector of strings therefore passed the sync, matched its chunk's hash, was kept by `diffChunks` and written straight back out — never re-embedded, never reported, and rejected by the schema that was about to insert it. `EmbeddingEntrySchema` is now the single definition and both hand-rolled guards are gone. An entry is validated against it but returned as it parsed, so a field a later version adds survives the round trip instead of being stripped.

**`processPool` batches concurrently as it does today.** The change is which chunks go in a batch, not how batches are run.

**Rejected: keeping `MAX_EMBEDDING_BATCH_SIZE` and lowering it.** A count that assumes a size is wrong once sizes vary, and a lower count would be a guess that is simultaneously too conservative for short chunks and still wrong for long ones.

## Tests

### Skeleton

Items 2 and 5 of the walking skeleton: the companion is rewritten with an entry count matching the report's unit count, and after an edit to the first unit only the chunks near it are re-fetched.

### Contract

> **Given** chunks whose sizes vary from 300 to 2200 characters, **when** they are batched, **then** no batch's total character count exceeds `MAX_BATCH_CHARS` and no batch holds more than `PROVIDER_BATCH_LIMIT` chunks.

> **Given** chunks that are all small, **when** they are batched, **then** batches close on the entry limit rather than the character limit, and every chunk appears in exactly one batch.

> **Given** one chunk, **when** it is batched, **then** there is one batch holding it.

> **Given** no chunks, **when** they are batched, **then** there are no batches and no request is made.

> **Given** a file with a stored companion and an edit confined to its first unit, **when** the sync runs, **then** `needed` holds only the chunks whose text changed and the rest are kept with their stored vectors.

> **Given** a file whose companion was written under the old boundary rule, **when** the sync runs, **then** every chunk is in `needed`, nothing is kept, and the rewritten companion holds no entry from the old run.

> **Given** a file whose companion is rewritten, **when** the BM25 sync observes it, **then** that source's documents are replaced and no document from the previous chunking survives in the index.

> **Given** a chunk from any file, **when** its `chunkStart` and `chunkEnd` are used to slice `getEmbeddableSource` for that file, **then** the result equals the chunk's `text`.

> **Given** a document whose fenced code block is edited, **when** the sync runs, **then** no chunk hash changes and no request is made.

### Isolation

`prepareFile`, `diffChunks` and the batcher are pure and tested directly. The sync loop is tested against a fake `EmbeddingSyncDeps` — an in-memory `FileStore`, recorded `updateFile` calls, and a stubbed `fetchEmbeddingBatch` returning fixed vectors — which is how it is tested today. Nothing here needs a real provider: the assertions are about which chunks were requested and what was written, never about the vectors themselves.
