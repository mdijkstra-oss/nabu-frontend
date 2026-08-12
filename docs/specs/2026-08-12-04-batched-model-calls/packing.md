# Packing

How a work list becomes calls. One function closes batches on a character budget and an item cap, optionally keeping groups together; every site's batcher becomes a call to it with that site's numbers.

## Contract

`pack(items, options) → items[][]`, pure. Options:

- `sizeOf(item)` — the item's cost in characters, measured on what will actually be rendered: the entry's content plus its children, not the raw source.
- `maxChars` — a batch closes before exceeding this. The first item always enters, so a batch is never empty and an oversized item still gets a call of its own — the rule `batchBySize` already has.
- `maxItems` — a batch closes at this count regardless of remaining budget. Both bounds survive because they do different jobs: the budget bounds the request, the cap bounds the model's attention across entries — fifty tiny entries fit any budget and the model still does worse on entry 43 than entry 3.
- `groupKey(item)`, `maxGroups` — optional. Items sharing a key stay together: a group with at least `maxItems` members fills batches of its own — including its remainder, which stays single-key rather than mixing; only groups smaller than `maxItems` mix, at most `maxGroups` distinct keys per batch, largest leftover group first. These are `planBatches`' semantics, generalized from "code" to any key, and `batching.test.ts` pins them: 45 + 4 + 5 items across three codes come out as batches of 20, 20, 5 (the large code alone) and 9 (the two small codes mixed).

Order is preserved within a group and, absent grouping, across the whole list — scout's range answers depend on a file's chunks staying consecutive.

### The per-site numbers

The constants live at each call site, not in the packer. Where a site batched before, its item cap carries over unchanged; the character budget is new everywhere, and it only splits batches the old count-only batcher would have overfilled — so batches that fit both bounds are the batches the site sends today, and oversized ones become two calls instead of one oversized call. The default derivation for the budget is `maxItems × UNIT_CEILING_CHARS` (2,000, from `app/lib/cutting/constants.ts`) — the cap times the largest unit the cutter can emit.

| Site                 | maxItems     | maxChars | Grouping  | Derivation                                                                                                                                                                                                |
| :------------------- | :----------- | :------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search filter        | 10           | 20,000   | —         | Today's `FILTER_BATCH_SIZE` kept as the cap; budget 10 × ceiling, since `merge` can grow a hit to several units                                                                                           |
| Scout                | —            | 100,000  | —         | Today a whole file goes in one call; the budget only splits monsters, and no cap because the range answers benefit from seeing the file whole                                                             |
| Region find          | 20           | 40,000   | —         | No old constant to convert. Twice search's cap: finding named things is extraction, not the judgment the filter does. Revised from measurement — the inspecting report from the chunking spec is the tool |
| Region mark          | 10 stretches | 40,000   | —         | Items are stretches; the cap on occurrences per stretch lives in coalescing ([regions.md](regions.md)), not here                                                                                          |
| Deep-analysis filter | 20           | 40,000   | code, ≤ 3 | Today's `ENVELOPES_PER_CALL` and `MAX_CODES_PER_MIXED_CALL` kept; budget 20 × ceiling                                                                                                                     |
| Adjudication         | 20           | 40,000   | code, ≤ 3 | Today unbounded — one call took every contested envelope in the pass. Same numbers as the filter                                                                                                          |
| Embeddings           | 512          | 800,000  | —         | Unchanged: `PROVIDER_BATCH_LIMIT` and `MAX_BATCH_CHARS`, now passed as options                                                                                                                            |

Counts were the right proxy when a chunk was a counted 1,000 characters; content-defined cutting ended that, which is why every site gains a budget even where its cap survives.

## Prior art

- `app/lib/embeddings/batch.ts` — `batchBySize` already closes on a char budget and an item limit with the first-item-always-enters rule. It is the packer: it moves to `app/lib/calls/`, its two hardcoded constants become options, grouping is added, and embeddings becomes its first caller with unchanged behavior.
- `app/lib/agent/tools/apply-deep-analysis/batching.ts` — `planBatches` contributes the grouping semantics and is deleted; its tests move to the packer, rewritten against `groupKey`.
- `app/lib/search/verdict.ts` — `chunkHits` slices by fixed count and is deleted.

## Tests

**Skeleton.** The skeleton's step 1 requires find to fit both documents' units into one call per kind — the packer under its region numbers.

**Contract.**

> **Given** items of 900 characters each and a budget of 2,000 with no cap, **when** packed, **then** every batch holds two items except possibly the last.

> **Given** a single 5,000-character item and a budget of 2,000, **when** packed, **then** it gets a batch of its own rather than being dropped or split.

> **Given** 45 items sharing one group key and `maxItems` 20, **when** packed with grouping, **then** the group produces batches of 20, 20 and 5, all single-key — the remainder never mixes.

> **Given** small groups with keys a through f and `maxGroups` 3, **when** packed, **then** no batch holds more than three distinct keys, and the largest group is placed first.

> **Given** the inputs `batchBySize` receives from the embeddings sync today, **when** packed with 512 and `MAX_BATCH_CHARS`, **then** the batches are element-for-element identical to what `batchBySize` produced.

> **Given** an empty list, **when** packed, **then** no batches.

**Isolation.** Pure; property-style checks run without fakes: no batch exceeds either bound except the oversized-single case; the batches' items are the input as a multiset; within any one group, and across the whole list when no grouping is given, order is preserved. Whole-list order under grouping is not a property — grouping reorders by design.
