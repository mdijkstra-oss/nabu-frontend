# Envelope

The one shape a model sees when it is shown many things at once, and the ref scheme that routes its answer back. Lives in a new `app/lib/calls/` module alongside [packing.md](packing.md) and [calling.md](calling.md); everything here is pure.

## Contract

### An entry

What a caller hands the renderer, per item:

- `id` — integer ≥ 1, an ordinal local to the call. Assigned after packing, never by the caller, so the same item carries different ids in different calls and nothing downstream may store one.
- `file` — the path the content came from. Always present; it is what lets one call mix files.
- `children` — zero or more metadata elements, each `{ tag, attributes, body }`, rendered before the content. Site-specific data lives here (`<code>`, `<occurrence>`), never as new attributes on `<entry>`.
- `content` — one of two forms:
  - **plain** — an ordered list of segments, each either raw text or a declared decorator (`{ tag, body }`) wrapping raw text. For sites whose answers address the entry as a whole (scout, deep-analysis filter, adjudication). Segments rather than one pre-composed string, because the renderer must defuse document text without touching a caller's decorator — it cannot tell the two apart inside an opaque string. The deep-analysis composition is three segments: text, a `marked` decorator, text.
  - **numbered** — a sentence array, rendered one per line as `[<id>.<n>] <sentence>` with `n` counting from 1 within the entry. For sites whose answers reach inside an entry (search filter, region find, region mark).

Rendered:

```
<entry id="3" file="council-2019.md">
<occurrence n="1" ref="3.2">Mrs Devlin</occurrence>
[3.1] The chair opened the session at 9.15.
[3.2] Mrs Devlin objected to the timing.
[3.3] She asked for deferral until the impact study was circulated.
</entry>
```

The attribute set on `<entry>` is closed: `id` and `file`, nothing else, ever. A new caller that needs another field adds a child element. This is what lets the shared prompt fragment in [prompts.md](prompts.md) describe the envelope exhaustively.

Document text crosses into the payload's markup, so the renderer defuses forgery on the way in — a rule today's renderers lack. Attribute values (the file path) are XML-escaped. In raw text — content segments, decorator bodies, child bodies — any opening or closing of the envelope's own elements (`entry`, `occurrence`, and each site's declared decorators and children) has its angle bracket replaced with `‹`, chosen because it fails closed: a model quoting the defused text produces a quote that will not locate in the original, so the gates drop it rather than acting on forged structure. Decorator tags themselves are the renderer's own output and are never defused. Everything else passes through verbatim.

Two rules govern children, and they are the contract's semantics rather than style:

- **An element wraps content only when the content is the thing the tag names.** `<marked>` wraps the candidate passage because those sentences are the candidate; the quote sits inside `<occurrence>` because those words are the occurrence's name. An element that asks a question about a span — how far does this reach, does this code apply — sits beside the content and points in by `ref`, because wrapping the span would answer the question in the payload.
- **Elements that exist to direct the model are not data.** A quote the model must produce, a framing sentence like "the occurrence is already located" — these do work on the model and are never converted to refs or ids. Per-entry data becomes a child element; per-site framing is said once in the prompt.

### Message layout

One call renders as: the site's **stable** preamble messages (rules, shared fragments, the search intent), a prompt-cache breakpoint on the last of them, then any **volatile** preamble (the speaker known-values list, which grows between calls), then one system message per entry, and the site's call-to-action as the final user message. The stable/volatile split is the caller's to declare, and it matters: a breakpoint after a message that changes per call caches a prefix that never repeats. The region finder already draws this line — its breakpoint rides the rules, and known values come after — and deep analysis marks two breakpoints (framework, then code sources) so the framework prefix caches across differently-grouped batches; the layout permits several breakpoints for exactly that reason. The mechanism is the existing `markCacheBreakpoint` in `app/lib/agent/tools/apply-deep-analysis/messages.ts`, which moves into `app/lib/calls/` since three unrelated sites now need it.

Per-entry messages rather than one concatenated block, because entry content is what [search.md](search.md) caches by and what varies between calls; the stable preamble is what the provider cache reuses.

### Refs

A sentence ref is the string `<entry id>.<n>`, both parts 1-based integers: `3.7` is sentence 7 of entry 3. The dot is load-bearing — the dash stays free because scout answers ranges _over entry ids_ (`{from: 3, to: 7}` means entries 3 through 7), and a dash-separated ref would collide with that in the shared prompt fragment.

The parser takes a ref string and the call's entries and returns either `{ entry, sentenceIndex }` — the caller's own item plus a 0-based index into that entry's sentence array — or nothing. It returns nothing when the string is malformed, either part is below 1, it names an entry not in this call, or it names a sentence past the entry's length. A ref that resolves to nothing is dropped, never repaired; the schema layer already made the model retry once on shape, and beyond that a bad ref is a wrong answer, not a formatting accident.

Zod schemas for answers use a shared ref-string refinement, anchored with the dot escaped — `^\d+\.\d+$` — so every site parses rather than validates. The anchoring is load-bearing: a lax pattern would let `3-7` or `x3.7y` through the schema layer, converting what should be a schema failure (one retry, then the call classifies unanswered and its entries requeue) into a silent per-span drop at resolution. The entry-and-bounds check happens at resolution, where the call's entries are in hand.

### Map-back

Resolution ends at the caller's item and a local sentence index. Converting that to a document position is the caller's job, through the table it already keeps: search indexes into the hit's own sentence array, region find adds the unit's `firstSentence`, region mark adds the stretch's window start. The envelope never sees a document-global number — that is what makes mixing files automatic and what keeps ids out of anything stored.

## Prior art

- `app/lib/text/prefix-ref.ts` — the letter-prefix scheme (`a-3`) the search filter uses today. Replaced: letters need case handling for multi-entry calls, and letter prefixes cannot be answered as numeric ranges, which scout needs. Deleted with its tests once search moves.
- `app/lib/regions/detect/payload.ts` — `renderNumberedSentences` numbers with a document-global offset. Replaced: global numbers are exactly what forbids two documents in one call, since both would print `[45]`. The `toModelNumber`/`toSentenceIndex` pair survives conceptually as the ±1 inside the new renderer and resolver.
- `app/lib/text/format.ts` — `formatNumberedPassage` bakes a per-hit letter prefix into the rendered string, which is how batch position leaked into search's cache key. Its use in `verdict.ts` moves to the envelope renderer.
- `app/lib/agent/tools/apply-deep-analysis/triplet.ts` — the closest existing renderer: id on the tag, mapping table beside the blocks. It becomes a caller that composes plain content (`before`, `<marked>`, `after`) and children; the mapping table's job moves to the resolver.
- The scout messages module already wraps entries in `<entry id="N">`; the envelope keeps that tag and adds `file`.

## Tests

**Skeleton.** The region find call in the walking skeleton renders two documents' units as numbered entries in one payload; the search in step 3 renders the same envelope with a different preamble. Both shapes through one renderer is this component's slice.

**Contract.**

> **Given** the ref `3.7` and a call whose entry 3 has nine sentences, **when** it is resolved, **then** the result is entry 3's item and sentence index 6.

> **Given** the refs `3-7`, `3.0`, `0.1`, `a.3` and `3.7.1`, **when** each is resolved, **then** each resolves to nothing.

> **Given** the ref `5.2` in a call with four entries, or `3.10` where entry 3 has nine sentences, **when** resolved, **then** nothing — an id that doesn't name an entry in this call and a sentence past the entry's end are both dropped.

> **Given** two entries of three sentences each, **when** rendered, **then** each entry's numbering restarts at `.1`, children precede content, and the only attributes on either `<entry>` are `id` and `file`.

> **Given** plain content of three segments — text, a `marked` decorator whose body contains a literal `<marked>`, text — **when** rendered, **then** the decorator's own tags are intact, the literal inside its body is defused, and no numbering appears.

> **Given** two stable preamble messages, one volatile one, and three entries, **when** the message list is built, **then** the breakpoint rides the second stable message, the volatile message follows it unmarked, each entry is its own system message, and the call-to-action is the final user message.

> **Given** content containing a literal `</entry>` line and a file path containing a quote character, **when** rendered, **then** the closing tag's bracket is `‹` and the attribute value is escaped — the payload parses as one entry, not two.

**Isolation.** Everything is pure: strings in, strings and resolutions out. No fakes needed.
