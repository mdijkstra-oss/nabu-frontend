# Cutting

This component turns the sentence array from [sentences.md](sentences.md) into **units**: contiguous, non-overlapping runs of sentences whose boundaries are decided by the content sitting at them rather than by counting from the start of the document. It is the whole of the idea this feature exists for, and it is pure — a string and its rows in, units out, no network, no disk, no clock.

It also owns the overlap step, which is not part of cutting but is applied to units and only for [embeddings.md](embeddings.md). [regions.md](regions.md) takes the units as they come.

## Contract

### What a unit is

| Field           | Type    | Meaning                                                              |
| :-------------- | :------ | :------------------------------------------------------------------- |
| `firstSentence` | integer | Index of the unit's first row in the sentence array, 0-based         |
| `lastSentence`  | integer | Index of its last row, inclusive                                     |
| `charStart`     | integer | `rows[firstSentence].start` — offset into the prose string           |
| `charEnd`       | integer | `rows[lastSentence].end` — offset one past the unit's last character |
| `hash`          | string  | `fnvHash` of `prose.slice(charStart, charEnd)`                       |

Units are contiguous and do not overlap: every sentence sits in exactly one, and concatenating them in order reproduces the array. That property is not decoration — [regions.md](regions.md) depends on it so a sentence is offered to exactly one `find` call and two calls cannot report the same occurrence.

Carrying both coordinate systems on one shape is deliberate. Sentence indexes are what regions store; character offsets are what the embeddings companion stores and what search slices displayed text with. Before this feature those two lived in different derivations of the document and could not be carried together.

**One recipe, one measure.** The hash covers the prose slice, and the size of a unit is `charEnd - charStart` — the same span, so nothing has to reconcile a hashed string against a measured one. This differs from `rangeHash` in the region block, which hashes sentence texts joined by a single space because it must be computable from the sentence array with no prose string in hand. The two are not interchangeable and neither is derived from the other.

### The boundary rule

A boundary may only fall in the gap after a sentence. Within that constraint, whether a given gap becomes one is decided by three tests at each gap, and **the order is the contract** — each answers before the next is asked:

1. **Ceiling.** If adding the next sentence would take the unit past `UNIT_CEILING_CHARS`, cut here. A sentence is never split, so a single sentence longer than the ceiling would become a unit of one — [sentences.md](sentences.md) caps a row at the ceiling for exactly that reason, which is what makes this a bound and not a preference.
2. **Floor.** Otherwise, if fewer than `UNIT_FLOOR_CHARS` characters have accumulated since the last cut, there is no boundary here regardless of what follows.
3. **The content test.** Otherwise, take the `BOUNDARY_WINDOW_CHARS` characters of the prose string ending at this gap — fewer near the start of the document — hash them, and cut when the low bits are zero. **Which bits are tested depends on how far the gap sits from the last cut:** below `UNIT_TARGET_CHARS` the strict mask, at or above it the loose one. `fnvHash` returns its sixty-four bits as hex, so the low ones are read as a number before the mask is applied: `(parseInt(hash.slice(-4), 16) & BOUNDARY_MASK) === 0`. Four hex digits is sixteen bits, wider than any mask this component will use.

**The ceiling outranks the floor**, and it has to. Reverse them and a unit that has not yet reached 500 characters could not be closed even when the next sentence is 3000 long, which leaves splitting a sentence as the only way out. The consequence is worth stating rather than discovering: a unit _can_ come out below the floor when an oversized sentence follows a short run. That is the one exception, and the tests below name it.

The last sentence always ends a unit. An empty sentence array produces no units.

**A trailing unit below the floor is tacked onto the one before it.** Because the last sentence closes a unit whatever its length, a document ending in a short one leaves a stub the floor never got to judge — measured, a unit of 36 characters, costing a whole embedding request and a whole `find` call for one line. It is absorbed unless doing so would breach the ceiling. This is the one place a boundary is decided after the walk rather than during it, and it is safe there: it only ever touches the end of a document, so it cannot move a boundary above it.

| Constant                | Value               | Where it comes from                                                                                             |
| :---------------------- | :------------------ | :-------------------------------------------------------------------------------------------------------------- |
| `UNIT_TARGET_CHARS`     | `CHUNK_CHARS`, 1000 | The existing embedding budget, `CHUNK_TOKENS * CHARS_PER_TOKEN`                                                 |
| `STRICT_MASK_BITS`      | 5                   | One gap in thirty-two, so a unit rarely closes before the target                                                |
| `LOOSE_MASK_BITS`       | 2                   | One gap in four, so a unit closes soon after it                                                                 |
| `UNIT_FLOOR_CHARS`      | 100                 | Only stops a run of very short sentences becoming a unit each                                                   |
| `UNIT_CEILING_CHARS`    | 2000                | Twice the target                                                                                                |
| `BOUNDARY_WINDOW_CHARS` | 200                 | Wide enough that a repeated short sentence is not self-similar, narrow enough that the blast radius stays small |

`BOUNDARY_MASK` was a stated guess and [inspecting.md](inspecting.md) is what settled it. The guess was three bits, reasoned from mean sentence length alone; measured, that arithmetic omits the floor, which has already spent half the budget before the first gap is even asked. Over the sample corpus:

| mask   | units | mean |  p90 | closed on content | closed on ceiling |
| :----- | ----: | ---: | ---: | ----------------: | ----------------: |
| 2 bits |    65 |  783 | 1019 |               91% |                 1 |
| 3 bits |    52 |  979 | 1884 |               79% |                 6 |
| 4 bits |    45 | 1131 | 1925 |               64% |                11 |

Three and four bits put the mean nearer the target and buy it with ceiling closes, which are the positional boundaries this feature exists to remove. Two bits leaves one in sixty-five, at a mean a fifth under target and a far tighter distribution. That is the trade taken: unit sizes below the budget, and almost every boundary decided by content. The cost is twenty-five per cent more units, so twenty-five per cent more embedding requests and `find` calls over a corpus that has not changed.

Every other constant here is derived from the target and moves with it.

The constants live with this component and derive `UNIT_TARGET_CHARS` from `CHUNK_CHARS` rather than restating 1000, so the token-budget provenance stays in `app/lib/embeddings/constants.ts` where it already is.

### Why the window and not the sentence

Hashing the sentence alone is simpler and wrong for the corpus this serves. Identical text hashes identically, so in a transcript every occurrence of "Yes." is a boundary or none of them is — a document full of short affirmations either cuts after each one or never cuts on content at all. Hashing a fixed character window ending at the gap makes the test depend on the sentence _and_ what precedes it, which differs at every occurrence.

Merging short sentences into their neighbour before hashing was considered and rejected. Whether a sentence merges would depend on whether the previous one did, so a short sentence inserted into a chatty stretch re-pairs the whole stretch — the counted-boundary chain this feature exists to remove, in miniature.

### What stability the rule actually gives

The content test alone is fully local: a boundary depends on 200 characters and nothing else, so an edit anywhere else cannot move it. The floor and the ceiling are not local — both are evaluated from the previous cut — so an edit can knock boundaries out of step for a stretch.

It re-syncs on its own. The first gap that both passes the content test and sits past the floor from its predecessor puts the edited and unedited versions back in agreement, and every unit after it hashes identically.

Measured over the sample corpus, an insertion costs one unit and a deletion in the middle costs one unit, on prose, on a link-dense reference, on a transcript of short turns and on a page of table rows alike. That is the claim, and it holds on every shape of document tested. A page of tables and nested lists takes two units to re-sync after a deletion rather than one, because its sentences are short enough that a few still fire under the floor.

The worst case found across every insertion point of every document is four units, on documents whose sentences sit far from the window — too short and a handful still fire under the floor, too long and there are few gaps to fire at. That is the property the tests below pin, and it is the reason the floor is written as a suppression during the walk rather than as a merge pass afterwards: a merge pass has the same chain and is a second traversal to reason about.

### The overlap step

Applied after cutting, for embeddings only. A chunk is its unit's span extended forward to `charEnd + OVERLAP_CHARS`, then pulled back to the nearest sentence end at or before that point so a chunk never ends mid-sentence. Where no sentence ends inside the extension, the chunk is its unit unchanged. The last unit's chunk has no extension.

`OVERLAP_CHARS` is 20% of `UNIT_TARGET_CHARS`, which is the overlap ratio the counted chunker uses today.

| Field        | Type    | Meaning                                      |
| :----------- | :------ | :------------------------------------------- |
| `index`      | integer | Position in the file's chunk list            |
| `text`       | string  | `prose.slice(chunkStart, chunkEnd)`          |
| `hash`       | string  | `fnvHash` of `text` — **covers the overlap** |
| `chunkStart` | integer | The unit's `charStart`                       |
| `chunkEnd`   | integer | The extended, sentence-snapped end           |

This is the existing `Chunk` shape, unchanged, so `diffChunks`, the companion writer and the BM25 index need no new field.

**The chunk hash is not the unit hash, and that is intended.** A chunk's hash covers text from the following unit, so editing the head of unit N+1 invalidates the chunk of unit N as well — correctly, because the text that was embedded genuinely changed. Regions key on the unit hash, which covers the unit alone, so their blast radius stays one unit. Two hashes over the same recipe applied to different ranges is the same arrangement the region block already has between a unit hash and a `rangeHash`.

## Prior art

**Content-defined chunking is the published technique**, from Rabin fingerprinting (1981) through LBFS (SOSP 2001) to FastCDC (USENIX ATC 2016). The idea is borrowed; no library is.

Every implementation of it rolls a hash over a sliding window of _bytes_, because it chunks opaque data with no natural units and must therefore be able to cut anywhere. That is exactly what this must not do — a cut inside a word or a URL is a defect here. Since the sentence array already supplies the legal cut points, the rolling window collapses to one hash per gap over the preceding characters, which is a few lines rather than a dependency. Projecting sentences onto lines to feed a byte-level library would not help: those libraries do not look for line breaks either.

**FastCDC's normalized chunking is what the two masks are.** Rather than leaning on hard clamps to control size, it tests a gap with a stricter mask before the target and a looser one after, so the size is controlled by the content test itself and the clamps are left with almost nothing to do. Nothing is stored and nothing is derived from the document: the mask is chosen by how many characters have accumulated since the last cut, which both versions of an edited document compute identically at the same distance.

It was written up as the refinement to reach for if hard clamps disappointed, and they did — a document of table rows never re-synced at all under them. Building it is a few lines in `verdictAt` and it removes the failure rather than documenting it, so the clamps did not survive to ship.

**`fnvHash` in `app/lib/utils/hash.ts` is used as it stands**, for both the boundary test and the unit hash. It is already the corpus's hash — `hashChunk` is an alias of it and the region block's unit hashes and `rangeHash` both use it.

**What this replaces.** `sliceWindows`, `snapWindowsToSentences` and the leading-whitespace adjustment in `app/lib/embeddings/chunk.ts` go — offsets now come from sentence rows, which are already measured in the untrimmed prose string. `accumulateScanUnits` in `app/lib/regions/detect/units.ts` is deleted; `hashSentences` stays, because `rangeHash` still needs it.

`chunkText` is removed rather than rewritten, and `chunkFileForEmbedding` keeps its name and its role as the only sanctioned entry point for embedding chunks. That leaves three callers to route:

| Caller                             | What happens                                                                                                                                                                 |
| :--------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/lib/embeddings/sync.ts`       | Already calls `chunkFileForEmbedding`. Unchanged.                                                                                                                            |
| `apply-deep-analysis/step-find.ts` | Already calls `chunkFileForEmbedding`. Unchanged; its hashes are computed per call and matched against a `files` table rebuilt from companions, so both sides move together. |
| `app/lib/search/scout.ts`          | Calls `chunkText` on the **raw** file and must move to `chunkFileForEmbedding`.                                                                                              |

That last one is a fix this feature is obliged to make rather than a preference. `scoutFileExcludes` chunks the raw file, then compares the resulting `chunkStart` values against `hit.chunkStart` on search hits — which are offsets into `extractProse(content)`, carried through from the companion. The two are measured in different strings, so an exclude can only match by coincidence. Routing scout through `chunkFileForEmbedding` and slicing its blocks out of the prose string puts both sides in one space. Expect scout to start excluding chunks it previously let through, which is the behavior it was written for.

## Tests

### Skeleton

Item 1 of the walking skeleton: the report shows units whose sizes vary rather than all landing on the budget. Item 5: an edit in the first unit leaves the later units' hashes unchanged.

### Contract

Riskiest first — the stability property is the reason the component exists, so it is tested before the shape rules that would be obvious from any implementation.

> **Given** a document cut into units, **when** a sentence is inserted into the first unit and the document is cut again, **then** the units after the first two have hashes identical to the original run.

> **Given** a document cut into units, **when** a sentence is deleted from the middle, **then** at most two units differ and every other unit's hash is unchanged.

> **Given** a document whose text is identical from some point onward but different before it, **when** both versions are cut, **then** they share a suffix of unit hashes.

> **Given** a transcript in which the same short sentence appears twenty times, **when** it is cut, **then** boundaries do not fall after every occurrence of it, and the unit sizes stay inside the floor and ceiling.

> **Given** any document with more than one unit, **when** it is cut, **then** no unit's size is above `UNIT_CEILING_CHARS` except a unit holding one whole sentence, and no unit is below `UNIT_FLOOR_CHARS` except a unit closed because the sentence after it would breach the ceiling, or a last unit too long to be absorbed by the one before it.

> **Given** a document whose last sentence is shorter than `UNIT_FLOOR_CHARS`, **when** it is cut, **then** that sentence belongs to the unit before it — unless absorbing it would take that unit past the ceiling, in which case it stands alone.

> **Given** a single sentence longer than `UNIT_CEILING_CHARS` — which only a caller building rows by hand can produce — **when** it is cut, **then** it forms one unit and is not split.

> **Given** two short sentences followed by one sentence longer than `UNIT_CEILING_CHARS`, **when** it is cut, **then** the two short sentences form a unit below the floor and the long one forms a unit of its own — the ceiling took precedence over the floor.

> **Given** any document, **when** it is cut, **then** the units are contiguous, non-overlapping, ordered, and together cover every sentence exactly once.

> **Given** a document shorter than `UNIT_FLOOR_CHARS`, **when** it is cut, **then** it is one unit.

> **Given** an empty sentence array, **when** it is cut, **then** no units are produced and nothing throws.

> **Given** units with overlap applied, **when** the chunks are inspected, **then** every chunk ends at a sentence boundary, every chunk's `chunkStart` equals its unit's `charStart`, and the last chunk has no extension.

> **Given** two adjacent units, **when** the head of the second is edited, **then** the first unit's hash is unchanged but the first _chunk's_ hash changes.

> **Given** any unit, **when** its hash is recomputed from `prose.slice(charStart, charEnd)`, **then** it matches the stored value — the recipe is the contract, not an implementation detail.

### Isolation

Pure. Tests pass a prose string and rows built by [sentences.md](sentences.md), or hand-written rows where a specific size distribution is needed. The one thing worth faking is the hash: a table-driven test that injects a boundary predicate instead of `fnvHash` makes the floor, ceiling and contiguity rules testable without hunting for text that happens to hash the right way. The real `fnvHash` is used for the stability and distribution cases, where the point is that real text behaves.
