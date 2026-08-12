# Regions

Region detection is the other consumer of [cutting.md](cutting.md). It scans a document unit by unit for occurrences of a kind, and it records which units it has already scanned so an edit does not re-run the whole document. That record is exactly the incremental machinery this feature makes effective: before content-defined boundaries, almost every stored unit hash missed after any edit and the record bought nothing.

Two things change here. Scan units come from the cutter instead of being accumulated greedily. And because the sentence array now carries inline markdown, the quote gate has to locate a model's quote in text that holds markup.

Nothing about the `json-regions` block's schema, the `mark` call, window computation, overlap resolution or decoration changes. Those are specified in `docs/specs/2026-08-11-02-region-finder/` and this feature does not touch them.

Two sections of that spec are superseded here and a builder reading it should take this file instead: **the scan unit**, which it defines as a greedy accumulation up to `CHUNK_CHARS`, and **the quote gate**, which it specifies against markdown-stripped sentences. Its reasoning for keeping detection off the embedding chunker no longer applies — that reasoning was the two coordinate spaces, and [sentences.md](sentences.md) removes them.

## Contract

### Scan units

`accumulateScanUnits` is deleted. `prepareDocument` builds the sentence array, then calls the cutter, and `DocumentPass` carries the prose string alongside the sentences so the cutter has the string its hashes and offsets are taken over.

`ScanUnit` becomes the cutter's unit. The two shapes already agree on `firstSentence`, `lastSentence` and `hash`; what the region version carried and the cutter's does not is `sentences`, the unit's own texts. Those are dropped from the shape and sliced from the document's array where they are needed — in `toFindInput`, which already receives the unit and can take `sentences.slice(firstSentence, lastSentence + 1)`. A unit stops being a second copy of the document's text and becomes a pair of indexes into it.

The `scanned` record in the block is unchanged: `{ hash, firstSentence }` per unit, per kind. The hash _recipe_ changes — the cutter hashes the prose slice rather than the sentence texts joined by a space — but that is invisible to the schema and to `reconcileHits`, which only ever compares a stored hash against a current one.

`hashSentences` stays where it is. `rangeHash` still needs it, because a mark's range hash must be computable from the sentence array with no prose string in hand, and it is not the same recipe as a unit hash. [cutting.md](cutting.md) says why.

**Units get bigger and less even.** A find payload was one `CHUNK_CHARS` unit; now it is anywhere from `UNIT_FLOOR_CHARS` to `UNIT_CEILING_CHARS`, so the largest payload roughly doubles. That is within what the `lite` tier handles comfortably and it reduces the number of `find` calls, which is the trade this feature is making everywhere.

### The quote gate, and markdown in the payload

`find` asks the model for the phrase naming an occurrence and the number of the sentence it sits in, then confirms the hit by locating that quote in the named sentence. With stripped sentences the quote and the sentence were both plain prose. Now the sentence can hold a link, a bold marker or a code span, and the model — reading `[the report](https://ex.com/a) is good.` — will quote what reads as text.

The tokenizer behind `findMatchOffset` already normalizes punctuation away, so a one-word quote inside `**Rutte**` still matches. What does not match is a quote _spanning_ markup: `the report is good` tokenizes to four words, while the sentence tokenizes to `the`, `report`, `https`, `ex`, `com`, `a`, `is`, `good`. Strict matching wants those four consecutive and they are not, and the fuzzy fallback cannot help either — it scores a window the same length as the needle, which cannot stretch over the intruding tokens.

**So the quote is located in the neutralized sentence, and sliced out of the original one.**

1. Neutralize the named sentence with `neutralizeMarkdown`. Markup becomes spaces, so the tokens are the words a reader sees.
2. Locate the quote there with `findMatchOffset(..., strict)`. Strict is kept.
3. Read the resulting offsets back out of the _original_ sentence. They are valid there because neutralizing preserves length — the same property [sentences.md](sentences.md) is built on.
4. Store `sentence.slice(start, end)` as the row's `quote`.

The retarget rule is unchanged in effect and changes in mechanism: a quote not found in the named sentence is searched for in every other sentence of the unit, **each neutralized the same way**, and a hit found elsewhere moves to the sentence it was found in. A quote nowhere in the unit drops the hit. Searching one sentence against neutralized text and the rest against raw text would make the retarget succeed or fail on which sentence happened to hold a link.

**This keeps the stored quote a true substring of the document**, which is what the region spec's provenance argument asks for. Where the located span happens to straddle markup, the stored quote carries it — `the report](https://ex.com/a) is good` — which is verbose and honest. It is not trimmed to look nicer, because a trimmed quote is no longer the run of characters that was matched, and the editor locates this exact string inside `hitSentence` to anchor a region's label.

This supersedes the plan to relax the gate to fuzzy matching. That plan assumed strict would start failing on markdown; matching against neutralized text means it does not, so the region spec's strict-matching rule stands unchanged rather than being overruled.

### Locating a region in the editor

The editor holds the document rendered, its markup turned into marks rather than characters, while the sentence array holds that markup as text. Two places bridge the two, and both take the same route the quote gate does — neutralize, because it preserves length and leaves the words a reader sees on both sides.

`alignSentences` matches a source sentence to an editor row by its word signature. A sentence carrying a link puts the URL's words into its signature and the editor's row does not, so the signature is built over `neutralizeMarkdown(sentence)`.

`resolveRegions` locates a region's stored quote inside the editor row that carries it. Where the quote straddles a construct it carries that construct's syntax, which the editor renders away, so the quote's span is read back out of the neutralized sentence and it is that reading which is located. Without both, a region whose sentence holds a link is dropped rather than drawn.

### The `mark` call is untouched

`mark` receives a window of numbered sentences and returns a first and last sentence number. It quotes nothing and locates nothing, so markdown in its payload changes only how the text reads. `MARK_WINDOW_CHARS` stays at `8 * CHUNK_CHARS`, and window computation, clamping, repair and overlap resolution are unchanged.

### The rebuild, which needs no code

On the first sync after this ships:

- No stored `scanned` hash matches a current unit hash, so `reconcileHits` finds no survivors: every stored hit is dropped and every unit goes into `unitsToFind`.
- No stored `rangeHash` matches a run of the new sentence array — the array's texts changed — so `reconcileMarks` deletes every mark.

Every document is re-found and re-marked once. That is the existing invalidation working correctly on genuinely changed input, not a migration, and there is nothing to write for it.

### Side effects

Unchanged and at the boundary: the two gateway calls, the file writes, the debounce. Unit construction, reconciliation, window computation and the quote gate are pure.

## Prior art

**`reconcileHits` and `reconcileMarks` are the reuse, untouched.** They already carry the subtle half of incremental detection: matching stored units by hash, computing the shift when a unit's content survived but moved, and relocating a mark by its range hash. They were built for exactly the world this feature creates, where most units survive an edit. Nothing about them needs to change for the hashes to start matching more often.

**The `json-regions` schema is unchanged**, including `scanned`. Its two fields are what the cutter's unit already provides.

**`neutralizeMarkdown` is reused for the quote gate**, not reimplemented. It is the same function [sentences.md](sentences.md) extends, and using it here is why strict matching survives.

**Rejected: neutralizing the payload as well as the gate.** Sending the model text with runs of spaces where URLs were is uglier than markdown and costs the same tokens, and it would put a second derivation of each sentence into the prompt path for no gain once the gate is handled.

**Rejected: relaxing the gate to fuzzy matching.** It was the plan until the tokenizer's behavior was checked. Fuzzy would not have fixed the spanning case anyway — its window is the needle's own length — and it would have loosened a check whose whole job is to catch a half-invented quote.

## Tests

### Skeleton

Item 4 of the walking skeleton: after the change, the `json-regions` block is rewritten and a speaker label lands on the same words it did before.

### Contract

Riskiest first — the quote gate against markup, then reconciliation, then the unit plumbing.

> **Given** a sentence containing `[the report](https://ex.com/a) is good.` and a model quote of `the report is good`, **when** the hit is gated, **then** it is accepted and the stored quote is the run of original characters the match covered.

> **Given** a sentence containing `**Rutte**` and a model quote of `Rutte`, **when** the hit is gated, **then** it is accepted and the stored quote is a substring of the document.

> **Given** any accepted hit, **when** its stored quote is searched for in the sentence at `hitSentence`, **then** it is found — the stored quote is never a string the document does not contain.

> **Given** a model quote of a phrase that appears nowhere in the unit, **when** the hit is gated, **then** it is dropped and counted, and nothing is stored.

> **Given** a model quote that appears in a different sentence of the same unit than the one named, **when** the hit is gated, **then** it retargets to the sentence it was found in.

> **Given** a document whose stored `scanned` entries were written under the previous unit recipe, **when** the sync runs, **then** every unit is re-found, every stored hit is dropped, and every mark is deleted.

> **Given** a document with regions and an edit confined to one unit, **when** the sync runs, **then** only the units touching the edit are in `unitsToFind`, and hits in the surviving units keep their values with their sentence indexes shifted.

> **Given** a document whose fenced code block is edited, **when** the sync runs, **then** no unit is re-found, no mark is deleted, and no region's stored indexes move.

> **Given** a unit from the cutter, **when** `toFindInput` builds the call, **then** its `sentences` are exactly `sentences.slice(firstSentence, lastSentence + 1)` and its `firstSentence` matches the unit's.

> **Given** a document of one short paragraph, **when** it is cut for detection, **then** it is one unit and one `find` call is made.

### Isolation

The sync is already tested against a deps object with faked `detect.find` and `detect.mark`, and that stays: no test here makes a model call. The quote gate is pure — a sentence, a quote, a verdict — and is tested directly against hand-written sentences carrying each markdown construct. Reconciliation is tested with hand-built stored records against hand-built units, so a scenario like "unit content survived but moved four sentences down" is expressible without constructing a document that happens to produce it.
