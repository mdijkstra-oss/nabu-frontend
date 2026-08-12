# Sentences

The canonical sentence array is the axis everything else in this feature is expressed in: [cutting.md](cutting.md) may only place a boundary between two of its rows, [regions.md](regions.md) stores positions in it, and [inspecting.md](inspecting.md) reports on it. This component owns turning a raw document into that array, and it owns the one bridge from the array's coordinate space back to raw-file positions. It knows nothing about chunks, boundaries, embeddings or regions.

Today there are two derivations of a document's prose and no mapping between them: `proseOf` strips markdown out of the extracted prose, while embeddings chunk the extracted prose directly. This component collapses them into one. Stripping is dropped; markdown is blanked to same-width spaces so the sentence segmenter is protected without any text being destroyed.

## Contract

### The prose string

`proseOf(raw)` returns `extractProse(raw)` and nothing more. Fenced code blocks are cut out of the string entirely — that step stays first, because it is what makes writing a `json-regions` or `json-embeddings` block into a document unable to move a single index in it.

**A fence with no info string is a fenced block too.** `parseCodeBlocks` used to require one, so ` ```ts ` was cut out and a bare ` ``` ` was left in the prose: its contents became sentences, and editing the code inside it moved every offset below it. That is the same defect the fenced-block step exists to prevent, and it applies to a plain fence as much as to a tagged one. The info string is now optional, and a block that carries none simply matches no language filter. Everything downstream measures offsets in this string, and `mapProseOffset(offset, parseCodeBlocks(raw))` in `app/lib/data-blocks/parse.ts` is the only sanctioned way back to a raw-file position.

That the prose string is now the _unstripped_ extraction is the change, and it is what puts sentence rows and embedding chunks into one coordinate space for the first time. `getEmbeddableSource` already returns `extractProse(content)`, so search's displayed text and this array now measure the same string.

### The sentence array

`indexFileSentences(raw)` returns rows in document order. Its signature does not change; what changes is what a row holds.

| Field   | Type    | Meaning                                                                |
| :------ | :------ | :--------------------------------------------------------------------- |
| `text`  | string  | The sentence as it appears in the document, **inline markdown intact** |
| `start` | integer | Offset of the sentence's first character in `proseOf(raw)`             |
| `end`   | integer | Offset one past its last character in `proseOf(raw)`                   |

A sentence's index is its 0-based position in the returned array. Rows are non-overlapping and in ascending `start` order. Rows whose text is empty after trimming are dropped, which is how a table separator row or a lone list bullet disappears without leaving a phantom sentence behind.

Two invariants hold for every row and are the cheapest things in the feature to assert:

- `proseOf(raw).slice(row.start, row.end) === row.text` — the row is a slice of the string it claims offsets into, never a reconstruction of one.
- `row.end <= nextRow.start` — expansion (below) never lets a row reach into its neighbour.

### Marking, and the two things derived from it

`neutralizeMarkdown` replaces markup with spaces of exactly the same width, so the processed string and the original are the same length and an offset means the same thing in both. The segmenter runs on the processed string; every sentence is sliced out of the original. That is the entire mechanism, and it is why nothing has to be mapped back.

Today that function knows six constructs and `stripMarkdown` knows twelve. Adding the missing six to the neutralizer would leave two lists of twelve to keep in step, so instead both are derived from one:

**`markMarkdown(text, options)` is the only place that knows what markup looks like.** It replaces each construct's syntax with a sentinel character, one per character removed, keeping the string exactly as long as it went in. The two public functions are then one substitution each:

| Function                       | Derivation                    | Length    |
| :----------------------------- | :---------------------------- | :-------- |
| `neutralizeMarkdown(text)`     | mark, then sentinel → space   | unchanged |
| `stripMarkdown(text, options)` | mark, then sentinel → nothing | shorter   |

Both take the same option set, and `keepHeadings` means what it always meant: the heading pattern does not run.

This works because every replacement in `stripMarkdown` today has one shape — keep the capture group, drop the syntax around it — which is exactly what marking expresses. It also removes an accident: `stripMarkdown` applies its patterns in sequence over a string that shortens on each pass, so a later pattern reads shifted positions. Marking holds every position fixed, so patterns cannot interact through length changes. For real documents the outputs agree, and where they could diverge the marked version is the predictable one.

**The sentinel is `U+FFFF`.** Unicode reserves it, and the rest of the noncharacter range, for internal processing and forbids it in interchange, so its presence in a document already means the input is malformed. That is a stronger guarantee than the alternatives offer: `U+0000` is legal in interchange and renders as nothing, which makes a marked string unreadable while debugging, and the Private Use Area is legitimately used by fonts and applications so it can genuinely occur. `U+FDD0` would serve equally well if `FFFF` reads too much like an error value.

It must be a single UTF-16 code unit or the length invariant breaks; `U+FFFF` is in the Basic Multilingual Plane, so it is one. Anything above it is a surrogate pair and counts as two.

**It must still not occur in the input.** Any occurrence is replaced with a space before marking begins — length-preserving, so nothing downstream can tell. The guard costs one pass and turns "a malformed document silently loses text" into "a malformed document is treated as text".

**The segmenter never sees a sentinel.** It runs on the neutralized string, where every sentinel has already become a space, which is exactly the text `Intl.Segmenter` reads today. The marked string is an intermediate that leaves this module only through `neutralizeMarkdown` or `stripMarkdown`, and passing it to the segmenter directly — as a shortcut past one substitution — would make sentence boundaries depend on a noncharacter's UAX #29 properties. That is a rule, not an observation, and the test below is what holds it.

**The invariant is length.** `markMarkdown(s).length === s.length` and `neutralizeMarkdown(s).length === s.length` for every input. A replacement that changes length is a defect in this component rather than a surprise downstream. It is asserted per construct, and it is the property that makes every construct safe to add.

The constructs the marker knows are the twelve `stripMarkdown` covers today — images, links, bold, italic in both marker forms, strikethrough, inline code, bullet markers, numbered markers, blockquote markers, table separator rows, table outer pipes, and headings. Six of them are new to the neutralizing path, and those six are the ones that matter to segmentation:

| Construct            | Example        | Why the segmenter must not see it                                                        |
| :------------------- | :------------- | :--------------------------------------------------------------------------------------- |
| Numbered list marker | `1. `          | Contains a period. Left alone, every numbered list item starts a false sentence.         |
| Bullet list marker   | `- `, `* `     | The asterisk form is also read as an italic opener, which swallows the rest of the line. |
| Blockquote marker    | `> `           | Segments as its own fragment, splitting the quoted sentence from its marker.             |
| Inline code          | `` `x` ``      | Its contents can hold anything, including sentence-ending punctuation.                   |
| Table separator row  | `\|---\|---\|` | Blanks to whitespace, so the row drops out rather than becoming a sentence.              |
| Table outer pipes    | `\| a \| b \|` | Interior pipes are harmless; the outer ones would open and close a fragment.             |

**Blanking hides a construct from the segmenter; it does not remove it from a sentence.** Once the boundaries are decided, every sentence is sliced out of the original and the expansion rule below puts back any marker the trim ate, so a bullet item's row reads `- Item one.` and a heading's reads `# Title`. That is the intended outcome — the row is the run of characters the document holds — and it is why the column above asks what the _segmenter_ must not see rather than what the text must not contain.

Headings are a small behavior change on top of that. `stripMarkdown` was called with `keepHeadings: true`, which left the `#` in the text the segmenter read; now it is blanked and then recovered, so the row text is the same as before while the segmentation improves.

### Recovering markup the trim would eat

The segmenter's own trimming works against blanked markup at a sentence's edges, and this is the one place where "blank instead of delete" needs help rather than just working.

Take `[the report](https://ex.com/a) is good.` Blanked, it begins with a space where the `[` was. The segmenter trims that leading whitespace, so the slice would start at `t` and the sentence would come back as `the report](https://ex.com/a) is good.` — markup cut in half.

So after trimming, each segment's span is expanded outward over the characters the marker replaced, and only those. A marked character is a space in the processed string by construction, so it is exactly what the trim ate; a space the document itself holds is left where it is.

Absorbing what is _marked_ rather than what merely looks blank is what separates two cases the trim treats alike. `# Title` and `- Item one.` each blank to two leading spaces, and both spaces belong to the construct, so the rows read `# Title` and `- Item one.`. A rule phrased over whitespace could not recover either, because the space in `# ` is whitespace in the original too.

**A table's pipes are the exception, and they are marked as unrecoverable.** The outer pipes of `| a | b |` and the separator rule delimit a row rather than sit inside a sentence, so a row that took them back would read with a pipe on each edge. Every other construct the trim eats belongs to the sentence it was taken from. This is a property of the construct, not of the walk, so the marker carries it: one mask for what the segmenter must not see, one for what a row may take back.

**Opening markup is claimed before closing markup, across every row.** The segmenter hands a sentence's leading whitespace to the segment _before_ it, so a row that reached forward first would take the next row's opening bracket — `It was **clear**.[The report](https://ex.com/a) says so.` would come back as `It was **clear**.[` and `The report](https://ex.com/a) says so.`, which is the very failure this rule exists to prevent. So every row walks backward first, bounded by the previous row's trimmed end, and only then walks forward, bounded by the next row's claimed start and by its own untrimmed span. Two rows therefore cannot overlap, which is why the second invariant above is stated as a check rather than as a hope.

Where two runs of markup meet with nothing between them — `**A one.****B two.**` — position alone cannot say which asterisks close and which open, and the row that opens takes them all. The rows still tile the document, which is what everything downstream indexes against; [inspecting.md](inspecting.md) reports the unbalanced construct that results.

### Side effects

None. This component reads a string and returns rows. No network, no disk, no clock, no cache of its own — the memo that exists today lives in `resolveDocumentRegions`, one layer up, and stays there.

## Prior art

**`splitMarkdownBySentences` in `app/lib/text/split.ts` is the thing to use.** It already does neutralize-then-segment-then-slice-from-original, and it already has a consumer in `app/lib/editor/spotlight/serialize.ts`, so the approach is in production rather than proposed. What this feature adds to it is the missing constructs and the expansion rule. It is extended in place rather than copied, because a second splitter is exactly the drift this feature exists to remove.

**`stripMarkdown` keeps its name, its signature and its output.** Five callers outside this feature want text with the markup genuinely gone rather than merely hidden: `refine-code/messages.ts`, `apply-deep-analysis/format.ts`, `patch/structured-json/fuzzy-fields.ts`, `editor/spotlight/serialize.ts` and `regions/decorate/resolve.ts`. None of them changes. What changes is that the function becomes one line over `markMarkdown`, and that `proseOf` stops calling it — it is no longer the definition of a coordinate space.

**Its pattern list is the one that survives.** It is the more complete of the two, and the six constructs the neutralizer lacks are drawn from it rather than written again.

**`extractProse` and `mapProseOffset` are used as they stand.** Fenced-block removal is not re-implemented here, and the prose-to-raw bridge already exists beside it.

**Rejected: making `stripMarkdown` length-preserving.** Its callers want short text — a fuzzy-match needle, a prompt fragment, a word count. Padding their output with runs of spaces to serve this component would push a cost onto five places to save one. Deriving both from one marker gets the shared pattern list without asking anyone to accept the other's output.

**Rejected: adding the six missing constructs to `neutralizeMarkdown` and leaving the two lists side by side.** It is the smaller change and it was the plan until the duplication was counted: twelve patterns in two files, each of which must be edited whenever markdown handling changes, with a silent segmentation bug as the cost of forgetting one.

### Callers that move with the coordinate space

Changing what `proseOf` returns changes the string every current caller measures against. All of them derive their offsets from `proseOf` or from `indexFileSentences`, so they stay internally consistent — with one exception that computes the same length by hand:

`anchorBlocks` in `app/lib/regions/decorate/resolve.ts` places each fenced block on the prose axis with `stripMarkdown(extractProse(raw.slice(0, block.start)), { keepHeadings: true }).length`. That is `proseOf` written out longhand, and it must become a call to `proseOf` so there is one definition of the axis rather than two that agree by coincidence.

## Tests

### Skeleton

Item 1 of the walking skeleton: over the sample document, the report lists sentences carrying their inline markdown and no sentence boundary falling inside a URL, a numbered list marker, or a table row.

### Contract

Riskiest first — the neutralizer's length invariant, then the constructs that break segmentation, then the expansion rule, then the plain path.

> **Given** any string containing any supported construct, **when** it is marked, **then** the result has exactly the same length as the input, and the same holds after neutralizing. Asserted per construct, and as a property over the fixture corpus.

> **Given** every document in the fixture corpus, **when** it is passed through the new `stripMarkdown` and the implementation being replaced, **then** the two outputs are identical. This is the check that the derivation preserves five callers' behavior, and it is written against a captured copy of the old function so it can run after that function is gone.

> **Given** a string already containing the sentinel character, **when** it is marked, **then** the sentinel is treated as ordinary text: `stripMarkdown` does not delete it and the segmenter sees a space in its place rather than a hole.

> **Given** any document, **when** it is split, **then** the string handed to the segmenter contains no sentinel. Asserted at the seam rather than inferred from the call order, because the failure it guards against is a later edit that skips one substitution.

> **Given** prose containing `See [the report](https://ex.com/a.b.c) next.`, **when** it is split, **then** it yields one sentence, not three, and that sentence's text contains the complete link including both brackets and the full URL.

> **Given** a numbered list of three items, **when** it is split, **then** it yields three sentences and none of them begins with a digit-and-period marker treated as a sentence end.

> **Given** a markdown table with a separator row, **when** it is split, **then** the separator row produces no sentence, and each content row's sentence text carries no leading or trailing pipe.

> **Given** a sentence that begins with a link and ends with a bold phrase, **when** it is split, **then** the row's text starts at the opening bracket and ends at the closing asterisks — the expansion recovered both edges.

> **Given** two adjacent sentences, the first ending in bold and the second starting with a link, **when** they are split, **then** the first row's `end` does not exceed the second row's `start`.

> **Given** any document, **when** it is split, **then** every row satisfies `proseOf(raw).slice(row.start, row.end) === row.text`.

> **Given** a document with a fenced code block containing prose-looking text with periods, **when** it is split, **then** no sentence comes from inside the block, and the offsets of sentences after it are the same as if the block held different text of a different length.

> **Given** text with no markdown at all, **when** it is split, **then** the rows are identical to what the plain splitter produces.

### Isolation

Pure functions over strings. No neighbour to fake and nothing to inject: the tests are a string in and rows out. The fixture corpus is the same directory [inspecting.md](inspecting.md) reads, so a document added to explore a chunking question is also a test case here.
