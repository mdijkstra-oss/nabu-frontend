// Adversarial correctness sweep for packing.md: pack.ts / batch.ts. Proving
// tests only — implementation is never edited here. Every test cites the
// spec line or contract it checks. Tests that could not be made to fail
// against the real implementation are documented as coverage in the audit
// report, not as findings.

import { describe, it, expect } from "vitest"
import { pack, type PackOptions } from "./pack"

interface Item {
  key: string
  size: number
  seq: number
}

const listOf = (groups: [key: string, sizes: number[]][]): Item[] => {
  const items: Item[] = []
  for (const [key, sizes] of groups) {
    for (const size of sizes) items.push({ key, size, seq: items.length })
  }
  return items
}

const repeat = (count: number, size: number): number[] => Array.from({ length: count }, () => size)
const sizeOf = (item: Item): number => item.size
const keyOf = (item: Item): string => item.key
const keysIn = (batch: Item[]): Set<string> => new Set(batch.map(keyOf))

describe("pack — packing.md contract, grouping x char-budget interactions", () => {
  // packing.md: "a group with at least maxItems members fills batches of its
  // own ... only groups smaller than maxItems mix" — the prose states the
  // count criterion explicitly; a group that is small both in count AND in
  // total chars (comfortably under both maxItems and maxChars, with room to
  // spare) must be offered for mixing, not forced into a single-key batch of
  // its own. (A group sitting exactly AT maxChars was also tried here, but
  // discarded: at that exact boundary a group always consumes an entire
  // batch's budget by itself, so "alone" vs "mixable-but-unable-to-fit-
  // anything-else" are unobservable from pack()'s output — not a valid test.)
  it("a group well under both maxItems and maxChars is offered for mixing, not isolated", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 1000,
      maxItems: 20,
      groupKey: keyOf,
      maxGroups: 3,
    }
    const items = listOf([
      ["a", [100, 100]], // 200 chars, 2 items — small on both axes
      ["b", [10]],
    ])
    const batches = pack(items, options)
    const mixed = batches.some((batch) => keysIn(batch).size > 1)
    expect(mixed).toBe(true)
  })

  // packing.md: "an oversized item still gets a call of its own". Any single
  // item whose own size exceeds maxChars drags its group's total over budget
  // too, so fillsBatchesAlone always isolates that group — it can never end
  // up mixed into a batch alongside a different group's items. Confirms the
  // "single group item over maxChars inside a mixed batch" scenario cannot
  // occur: the item is always isolated to a single-key batch of its own.
  it("a single oversized item's group is always isolated, never mixed with another group", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 2000,
      maxItems: 20,
      groupKey: keyOf,
      maxGroups: 3,
    }
    const items = listOf([
      ["a", [50, 5000, 50]], // one huge item, siblings tiny
      ["b", [50, 50]],
      ["c", [50, 50]],
    ])
    const batches = pack(items, options)
    const oversizedBatch = batches.find((batch) => batch.some((item) => item.size === 5000)) ?? []
    expect(oversizedBatch).not.toEqual([])
    expect(keysIn(oversizedBatch).size).toBe(1)
    expect(oversizedBatch).toEqual([items[1]]) // alone, per "batchBySize" rule
  })

  // packing.md: "at most maxGroups distinct keys per batch, largest leftover
  // group first". Because mixSmallGroups always processes groups in
  // non-increasing size order, a batch already at maxGroups can only ever be
  // followed by a group of equal or smaller size — verify the boundary holds
  // exactly (no off-by-one letting a 4th key slip in when maxGroups is 3).
  it("never lets more than maxGroups keys into one batch even at the exact boundary", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 1_000_000,
      maxItems: 1000,
      groupKey: keyOf,
      maxGroups: 3,
    }
    const items = listOf([
      ["a", repeat(3, 10)],
      ["b", repeat(3, 10)],
      ["c", repeat(3, 10)],
      ["d", repeat(3, 10)],
    ])
    const batches = pack(items, options)
    for (const batch of batches) expect(keysIn(batch).size).toBeLessThanOrEqual(3)
    // 4 equal-size groups under one big char/item budget: must still split
    // into at least two batches purely because of the key cap.
    expect(batches.length).toBeGreaterThanOrEqual(2)
  })

  // packing.md: "maxGroups — optional." Omitting it must not silently cap at
  // some default; unboundedly many keys should be allowed to mix into one
  // batch as long as chars/items allow.
  it("omitting maxGroups allows unbounded distinct keys in a single mixed batch", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 1_000_000,
      maxItems: 1000,
      groupKey: keyOf,
    }
    const items = listOf(
      Array.from(
        { length: 10 },
        (_, i) => [String.fromCharCode(97 + i), [10]] as [string, number[]]
      )
    )
    const batches = pack(items, options)
    expect(batches).toHaveLength(1)
    expect(keysIn(batches[0]).size).toBe(10)
  })

  // packing.md isolation section: pure, and grouping is the only case where
  // whole-list order is not guaranteed. Empty-groups edge: an empty input
  // with grouping active must terminate immediately with no batches, not
  // throw on an empty groupBy map.
  it("an empty grouped input produces no batches", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 2000,
      maxItems: 5,
      groupKey: keyOf,
      maxGroups: 2,
    }
    expect(pack([], options)).toEqual([])
  })

  // Termination sanity: sizeOf returning 0 for every item with maxItems
  // unset must still terminate (one pass through a finite array), producing
  // a single batch rather than looping. Direct proof against the real
  // implementation, since a future "close batch when adding no progress"
  // rewrite could introduce a spin here.
  it("sizeOf returning 0 for every item, maxItems unset, terminates in a single batch", () => {
    const items = listOf([["", repeat(500, 0)]])
    const batches = pack(items, { sizeOf, maxChars: 100 })
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(500)
  })

  // Same termination question under grouping + maxGroups, where the only
  // possible batch-closing trigger left (chars pinned at 0, items uncapped)
  // is the key cap.
  it("sizeOf returning 0, maxItems unset, grouped: closes purely on maxGroups, still terminates", () => {
    const items = listOf([
      ["a", repeat(50, 0)],
      ["b", repeat(50, 0)],
      ["c", repeat(50, 0)],
      ["d", repeat(50, 0)],
    ])
    const batches = pack(items, { sizeOf, maxChars: 100, groupKey: keyOf, maxGroups: 2 })
    expect(batches.flat()).toHaveLength(200)
    for (const batch of batches) expect(keysIn(batch).size).toBeLessThanOrEqual(2)
  })

  // packing.md isolation: "the batches' items are the input as a multiset" —
  // stress it specifically for the grouped + both-bounds-active path with a
  // group that straddles maxChars mid-list (not first, not last), to catch
  // any accounting bug that drops or duplicates items when a group closes on
  // chars mid-stream inside fillInOrder (called from fillsBatchesAlone).
  it("no items are lost or duplicated when a middle group closes on chars mid-list", () => {
    const options: PackOptions<Item> = {
      sizeOf,
      maxChars: 1000,
      maxItems: 50,
      groupKey: keyOf,
      maxGroups: 3,
    }
    const items = listOf([
      ["small1", [10, 10]],
      ["big", repeat(7, 300)], // 2100 chars, alone: closes into 3 sub-batches
      ["small2", [10, 10]],
    ])
    const batches = pack(items, options)
    const flat = batches.flat()
    expect([...flat].sort((a, b) => a.seq - b.seq)).toEqual(items)
  })
})
