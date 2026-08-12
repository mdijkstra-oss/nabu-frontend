import { describe, it, expect } from "vitest"
import { pack, type PackOptions } from "./pack"
import { legacyBatchBySize, varyingSizes } from "./pack.fixture"
import { MAX_BATCH_CHARS, PROVIDER_BATCH_LIMIT } from "~/lib/embeddings/constants"

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

const charsIn = (batch: Item[]): number => batch.reduce((total, item) => total + item.size, 0)
const keysIn = (batch: Item[]): Set<string> => new Set(batch.map(keyOf))

describe("pack without grouping", () => {
  it("fits two 900-char items per 2,000-char batch, except possibly the last", () => {
    const items = listOf([["", repeat(7, 900)]])
    const batches = pack(items, { sizeOf, maxChars: 2000 })
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 2, 1])
  })

  it("gives an item over the budget a batch of its own rather than dropping or splitting it", () => {
    const items = listOf([["", [5000]]])
    expect(pack(items, { sizeOf, maxChars: 2000 })).toEqual([items])
  })

  it("makes no batch out of no items", () => {
    expect(pack([], { sizeOf, maxChars: 2000 })).toEqual([])
  })
})

describe("pack with grouping", () => {
  const options: PackOptions<Item> = {
    sizeOf,
    maxChars: 100_000,
    maxItems: 20,
    groupKey: keyOf,
    maxGroups: 3,
  }

  it("splits a group of 45 into 20, 20 and 5, all single-key", () => {
    const batches = pack(listOf([["a", repeat(45, 10)]]), options)
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5])
    for (const batch of batches) expect(keysIn(batch).size).toBe(1)
  })

  it("mixes at most maxGroups keys per batch, largest group first", () => {
    const items = listOf([
      ["a", repeat(1, 10)],
      ["b", repeat(2, 10)],
      ["c", repeat(3, 10)],
      ["d", repeat(4, 10)],
      ["e", repeat(5, 10)],
      ["f", repeat(6, 10)],
    ])
    const batches = pack(items, options)
    for (const batch of batches) expect(keysIn(batch).size).toBeLessThanOrEqual(3)
    expect(batches[0].slice(0, 6).map(keyOf).join("")).toBe("ffffff")
  })

  it("packs a group exactly at maxItems as one batch, with no empty split", () => {
    const batches = pack(listOf([["a", repeat(20, 10)]]), options)
    expect(batches.map((batch) => batch.length)).toEqual([20])
  })

  it("packs a lone under-cap group as one batch", () => {
    const batches = pack(listOf([["a", repeat(7, 10)]]), options)
    expect(batches.map((batch) => batch.length)).toEqual([7])
    expect(keysIn(batches[0]).size).toBe(1)
  })

  it("keeps planBatches' reference shape: 45 + 4 + 5 under cap 20 becomes 20, 20, 5 and 9", () => {
    const items = listOf([
      ["big", repeat(45, 10)],
      ["a", repeat(4, 10)],
      ["b", repeat(5, 10)],
    ])
    const batches = pack(items, options)
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5, 9])
    for (const batch of batches.slice(0, 3)) expect([...keysIn(batch)]).toEqual(["big"])
    expect(batches[3].map(keyOf).join("")).toBe("bbbbbaaaa")
  })

  it("closes a mixed batch on the char budget too", () => {
    const items = listOf([
      ["a", repeat(3, 900)],
      ["b", repeat(3, 900)],
    ])
    const batches = pack(items, { ...options, maxChars: 3000 })
    expect(batches.map((batch) => batch.map(keyOf).join(""))).toEqual(["aaa", "bbb"])
  })

  it("splits a group whose characters alone exceed the budget into single-key batches", () => {
    const items = listOf([
      ["a", repeat(4, 900)],
      ["b", [100]],
    ])
    const batches = pack(items, { ...options, maxChars: 2000 })
    expect(batches.map((batch) => batch.map(keyOf).join(""))).toEqual(["aa", "aa", "b"])
  })
})

interface TaggedChunk {
  filename: string
  chunk: { text: string }
}

const chunkSize = (tagged: TaggedChunk): number => tagged.chunk.text.length

const mulberry32 = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const syntheticChunks = (
  count: number,
  minLen: number,
  maxLen: number,
  seed: number
): TaggedChunk[] => {
  const random = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => ({
    filename: `notes/file-${i % 7}.md`,
    chunk: { text: "x".repeat(minLen + Math.floor(random() * (maxLen - minLen))) },
  }))
}

describe("pack matches the batcher it replaced on embeddings inputs", () => {
  const chunkLists: {
    name: string
    count: number
    minLen: number
    maxLen: number
    seed: number
  }[] = [
    { name: "chunks near the chunk size", count: 1300, minLen: 300, maxLen: 2200, seed: 1 },
    {
      name: "large chunks that close on characters",
      count: 1100,
      minLen: 1400,
      maxLen: 2200,
      seed: 2,
    },
    { name: "a handful of chunks", count: 9, minLen: 300, maxLen: 2200, seed: 3 },
    { name: "randomized mix of tiny and huge", count: 700, minLen: 50, maxLen: 3000, seed: 4 },
    { name: "randomized mix, second seed", count: 700, minLen: 50, maxLen: 3000, seed: 5 },
  ]

  it.each(chunkLists)("$name: element-for-element identical", ({ count, minLen, maxLen, seed }) => {
    const tagged = syntheticChunks(count, minLen, maxLen, seed)
    const packed = pack(tagged, {
      sizeOf: chunkSize,
      maxChars: MAX_BATCH_CHARS,
      maxItems: PROVIDER_BATCH_LIMIT,
    })
    expect(packed).toEqual(legacyBatchBySize(tagged, chunkSize))
    packed.flat().forEach((item, i) => expect(item).toBe(tagged[i]))
  })
})

describe("pack properties", () => {
  const scenarios: { name: string; items: Item[]; options: PackOptions<Item> }[] = [
    {
      name: "ungrouped varying sizes with both bounds",
      items: listOf([["", varyingSizes(37)]]),
      options: { sizeOf, maxChars: 2000, maxItems: 5 },
    },
    {
      name: "ungrouped without a cap",
      items: listOf([["", varyingSizes(23)]]),
      options: { sizeOf, maxChars: 2500 },
    },
    {
      name: "one oversized item among small ones",
      items: listOf([["", [300, 9000, 300]]]),
      options: { sizeOf, maxChars: 2000, maxItems: 5 },
    },
    {
      name: "grouped with interleaved keys",
      items: listOf([
        ["a", [400, 600]],
        ["b", [500]],
        ["a", [700]],
        ["c", [300, 200]],
        ["b", [800]],
      ]),
      options: { sizeOf, maxChars: 1500, maxItems: 3, groupKey: keyOf, maxGroups: 2 },
    },
    {
      name: "grouped with a dominant group and small leftovers",
      items: listOf([
        ["big", repeat(45, 10)],
        ["a", repeat(4, 10)],
        ["b", repeat(5, 10)],
      ]),
      options: { sizeOf, maxChars: 100_000, maxItems: 20, groupKey: keyOf, maxGroups: 3 },
    },
    {
      name: "grouped with a group over the char budget",
      items: listOf([
        ["a", repeat(6, 900)],
        ["b", [100, 100]],
      ]),
      options: { sizeOf, maxChars: 2000, maxItems: 20, groupKey: keyOf, maxGroups: 3 },
    },
    {
      name: "empty grouped list",
      items: [],
      options: { sizeOf, maxChars: 2000, maxItems: 5, groupKey: keyOf, maxGroups: 2 },
    },
  ]

  it.each(scenarios)(
    "$name: no batch passes a bound, except a lone oversized item",
    ({ items, options }) => {
      for (const batch of pack(items, options)) {
        expect(batch.length).toBeGreaterThan(0)
        if (options.maxItems !== undefined) {
          expect(batch.length).toBeLessThanOrEqual(options.maxItems)
        }
        if (batch.length > 1) expect(charsIn(batch)).toBeLessThanOrEqual(options.maxChars)
        if (options.maxGroups !== undefined) {
          expect(keysIn(batch).size).toBeLessThanOrEqual(options.maxGroups)
        }
      }
    }
  )

  it.each(scenarios)("$name: the batches hold exactly the input items", ({ items, options }) => {
    const flat = pack(items, options).flat()
    expect([...flat].sort((a, b) => a.seq - b.seq)).toEqual(items)
  })

  it.each(scenarios)("$name: order within each group is preserved", ({ items, options }) => {
    const flat = pack(items, options).flat()
    for (const key of new Set(items.map(keyOf))) {
      const seqs = flat.filter((item) => item.key === key).map((item) => item.seq)
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    }
  })

  const ungrouped = scenarios.filter(({ options }) => options.groupKey === undefined)

  it.each(ungrouped)("$name: whole-list order is preserved", ({ items, options }) => {
    expect(pack(items, options).flat()).toEqual(items)
  })
})
