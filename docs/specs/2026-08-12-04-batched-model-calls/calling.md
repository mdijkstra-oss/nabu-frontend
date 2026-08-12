# Calling

What happens between a packed batch and a routed answer: classifying what came back, deciding what an absent answer means, returning unanswered work to the list, and capping how many calls the whole app has in flight.

## Contract

### Outcomes

Four things can happen to a call, and they carry three meanings:

| What happened                                                             | Meaning                                                         |
| :------------------------------------------------------------------------ | :-------------------------------------------------------------- |
| Threw — transport error, timeout                                          | Unanswered. Nothing came back                                   |
| Returned not-ok — 5xx, gateway refusal                                    | Unanswered                                                      |
| Came back unreadable — fails the zod schema after the parse layer's retry | Unanswered. The model responded but nothing it said can be used |
| Parsed                                                                    | Answered — per entry, see below                                 |

An unanswered call answers none of its entries: none is recorded anywhere, none counts toward the barren stop or toward an entry's miss count, and all of them are eligible for a later call. This is the type-level fix for today's defect, where `verdictBatch` catches its own errors and returns `[]` — the same value as a genuine no-match — before anything downstream can tell them apart.

Within an answered call, each entry is one of:

- **Answered with results** — the entry appears in the response with content.
- **Answered empty** — the entry is explicitly acknowledged with no results. The only outcome that means "the model looked and found nothing".
- **Silent** — the entry does not appear. What silence means is the site's contract, split by whether absence gets recorded durably: region find writes silence into `scanned` forever, so it must treat silence as unanswered and its response schema acknowledges every entry; search, scout and the deep-analysis steps record nothing durable on silence, so each keeps its existing default (a silent hit is filtered out, a silent chunk is kept, a silent envelope keeps its votes-missing handling).

### The barren fix

`processPool` in `app/lib/utils/pool.ts` counts an item that produced no results toward `maxBarren`, and today its rejection path does too — so repeated failures quietly end a search as if the results had dried up. The barren stop itself is deliberate and stays: search hits arrive ranked by embedding distance, so consecutive genuinely-empty batches mean the rest of the list is worse, and continuing is waste. The fix is that failures stop impersonating emptiness, and get a stop of their own:

- The pool's rejection path stops incrementing the barren counter. Failures land in `failures` as they do now.
- Callers stop swallowing: a batch whose call was unanswered rejects instead of resolving `[]`. Only answered-and-empty resolves empty, so only real emptiness counts toward the barren stop.
- The pool gains a consecutive-failure ceiling of **3** — the repo's failure number, shared with the miss ceiling and the write quarantine. Any answered call resets the streak; three rejections in a row settle the pool. The result says which stop fired, because they mean different things downstream: the barren stop is "nothing more to find", the failure stop is "the gateway was down" — [search.md](search.md) maps the first to exhausted and the second to incomplete-with-remainder.

The pool's signature is otherwise untouched; every existing caller keeps working.

### Rounds

For sites that requeue (region find and mark), the loop sits above the pool, because the pool walks a fixed list and cannot take new items mid-run:

1. Pack the pending list ([packing.md](packing.md)) and assign ids. Each call **renders at dispatch**, not at pack time — the preamble is composed when the call actually starts, which is what lets a hook's updates reach every later call in the same round.
2. Collect per-entry outcomes. Answered entries leave the pending list and are handed to the caller as they arrive.
3. **Silent entries** — ignored inside an answered call — stay pending, each incrementing a miss count. The count is keyed on an identity the caller supplies per item (find: the unit's hash; mark: the occurrence's identity — file, kind, value, hit sentence), so a content change resets it.
4. An item that reaches **3 misses** is abandoned for this run and reported to the caller, which decides what abandonment means (find: not scanned, so a later tick retries; mark: the hit joins the unranged rows, today's failure path). The ceiling mirrors `MAX_CONSECUTIVE_WRITE_FAILURES` in the region sync — same number, same reasoning.
5. **Entries from unanswered calls** stay pending without a miss — a gateway failure is not evidence about the entry. What bounds them instead: a round in which no call was answered ends the run, leaving its pending entries unrecorded for the next tick. So misses count the model ignoring an entry; failures count nothing and terminate through the no-progress rule.
6. Repeat until nothing is pending, everything pending is abandoned, or a round makes no progress.

No cross-round persistence: region sync ticks fire only on file changes, so an entry a model always ignores costs one bounded set of rounds per edit, not a loop on a timer.

The rounds runner accepts an `onCallAnswered` hook, called when a call settles — before the next dispatch renders. The speaker vocabulary rides on it: at concurrency 1, values found by call _n_ are in the known list rendered into call _n + 1_'s preamble.

### Concurrency

Per-pool concurrency is **5** everywhere a pool runs model calls, with one exception: **speaker find runs at 1**, because each call needs the values the previous ones found. That changes scout (10 → 5) and region date (default 4 → 5); search and the deep-analysis steps already sit at 5.

Per-pool numbers express what a stage wants; they do not compose into a ceiling — deep analysis runs 10 find branches, each branch a search pipeline whose filter pool runs 5 batches, each batch a scout pool of 10, so today's worst case is in the hundreds. The ceiling is a separate mechanism:

### The global limiter

A counting semaphore in the agent client, acquired around the transport call inside `callAndParse`, FIFO, capacity **10**. Scope is exactly the structured-call path: every batched site goes through `callAndParse`, while interactive chat streams through a different path and is never queued behind batch work. Embeddings calls are out of scope too — they go to their own proxy with their own batching.

The semaphore is the one piece of this component that is not pure; it is also the only place the cap exists, so no site needs to compute a product of nested pools to reason about load.

## Prior art

- `app/lib/utils/pool.ts` — kept as the concurrency primitive; the barren fix is the only semantic change. `warmup`, `target` and abort behavior are untouched.
- `app/lib/utils/keyed-queue.ts` — how speaker stays serial today; the rounds runner at concurrency 1 with the `onCallAnswered` hook replaces its role for find, and mark leaves the queue entirely (mark never invents values — a deliberate change named in [spec.md](spec.md)).
- `MAX_CONSECUTIVE_WRITE_FAILURES` in `app/lib/regions/sync.ts` — the quarantine pattern the miss ceiling mirrors.
- No semaphore exists in the repo and no dependency provides one; it is ~20 lines and gets written here rather than imported.

## Tests

**Skeleton.** Step 5 — the network log never shows more calls in flight than the cap — is this component's slice, exercised by the region pass and the search together.

**Contract.**

> **Given** a call that throws, returns not-ok, or returns JSON failing the schema, **when** classified, **then** every entry in it is unanswered: none recorded, none counted barren, all pending.

> **Given** an answered call naming entries 1 and 3 of five, **when** outcomes are collected for a site requiring acknowledgment, **then** 1 and 3 are handed to the caller and 2, 4, 5 stay pending with one miss each.

> **Given** a pending entry with two misses, **when** the next call covering it is also silent about it, **then** it is abandoned and reported, and no further call includes it this run.

> **Given** a pending entry whose calls fail three times running, **when** the third failure lands, **then** it has zero misses — and if that round answered nothing at all, the run ends with the entry left pending for the next tick.

> **Given** three unanswered entries and five fresh ones, **when** the next round packs, **then** one list of eight is packed together — no dedicated retry batch.

> **Given** a pool whose items alternate between rejecting and resolving empty, with `maxBarren` 2, **when** run, **then** only the empty resolutions count toward the barren stop, and the alternation never lets the failure streak reach 3.

> **Given** a pool whose calls fail three times running, **when** the third rejection lands, **then** the pool settles reporting the failure stop, not the barren stop, and undispatched items are reported unconsumed.

> **Given** 25 calls dispatched against a fake transport that resolves on command, **when** run, **then** at most 10 are in flight at any instant, waiting calls are admitted in request order, and all 25 eventually complete.

> **Given** an abort mid-round, **when** the signal fires, **then** no new call starts and pending entries are simply dropped — same as the pool's abort today.

**Isolation.** The rounds runner takes a call function; tests hand it one that scripts outcomes per call. The limiter wraps any promise-returning function; tests drive it with deferred promises. Neither needs a network.
