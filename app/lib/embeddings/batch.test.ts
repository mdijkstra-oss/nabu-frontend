import { describe, it, expect } from "vitest"
import { batchBySize } from "./batch"
import { MAX_BATCH_CHARS, PROVIDER_BATCH_LIMIT } from "./constants"

const SMALL_CHARS = 300
const LARGE_CHARS = 2200

const charsIn = (batch: number[]): number => batch.reduce((total, size) => total + size, 0)

const sizeOf = (size: number): number => size

const batch = (sizes: number[]): number[][] => batchBySize(sizes, sizeOf)

const varyingSizes = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => SMALL_CHARS + ((i * 137) % (LARGE_CHARS - SMALL_CHARS)))

const smallSizes = (count: number): number[] => Array.from({ length: count }, () => SMALL_CHARS)

const withinBounds: {
  name: string
  sizes: number[]
}[] = [
  { name: "sizes varying from 300 to 2200", sizes: varyingSizes(PROVIDER_BATCH_LIMIT * 4 + 13) },
  { name: "sizes all small", sizes: smallSizes(PROVIDER_BATCH_LIMIT * 3 + 7) },
  { name: "one chunk", sizes: [LARGE_CHARS] },
  { name: "no chunks", sizes: [] },
]

describe("batchBySize", () => {
  it.each(withinBounds)("$name: no batch passes either bound", ({ sizes }) => {
    for (const each of batch(sizes)) {
      expect(charsIn(each)).toBeLessThanOrEqual(MAX_BATCH_CHARS)
      expect(each.length).toBeLessThanOrEqual(PROVIDER_BATCH_LIMIT)
    }
  })

  it.each(withinBounds)("$name: every chunk appears in exactly one batch", ({ sizes }) => {
    expect(batch(sizes).flat()).toEqual(sizes)
  })

  it("closes small chunks on the entry limit rather than the character limit", () => {
    const sizes = smallSizes(PROVIDER_BATCH_LIMIT * 3 + 7)
    const batches = batch(sizes)

    const closed = batches.slice(0, -1)
    expect(closed.length).toBeGreaterThan(1)
    for (const [i, each] of closed.entries()) {
      expect(each).toHaveLength(PROVIDER_BATCH_LIMIT)
      expect(charsIn(each) + batches[i + 1][0]).toBeLessThanOrEqual(MAX_BATCH_CHARS)
    }
  })

  it("closes large chunks on the character limit before the entry limit is reached", () => {
    const oversized = Math.floor(MAX_BATCH_CHARS / PROVIDER_BATCH_LIMIT) + 1
    const batches = batch(Array.from({ length: PROVIDER_BATCH_LIMIT * 2 }, () => oversized))

    for (const each of batches.slice(0, -1)) {
      expect(each.length).toBeLessThan(PROVIDER_BATCH_LIMIT)
      expect(charsIn(each) + oversized).toBeGreaterThan(MAX_BATCH_CHARS)
    }
  })

  it("puts one chunk in one batch", () => {
    expect(batch([LARGE_CHARS])).toEqual([[LARGE_CHARS]])
  })

  it("makes no batch out of no chunks", () => {
    expect(batch([])).toEqual([])
  })
})

describe("batchBySize at the exact character bound", () => {
  it("takes an item that brings the batch to exactly MAX_BATCH_CHARS", () => {
    const sizes = [MAX_BATCH_CHARS - 10, 10]
    expect(batchBySize(sizes, (size) => size)).toEqual([sizes])
  })

  it("gives an item bigger than the bound a batch of its own, never an empty one", () => {
    const sizes = [MAX_BATCH_CHARS + 1]
    expect(batchBySize(sizes, (size) => size)).toEqual([sizes])
  })
})
