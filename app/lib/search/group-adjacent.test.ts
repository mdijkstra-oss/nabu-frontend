import { describe, it, expect } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import {
  capByFile,
  mergeAdjacent,
  computeFileCap,
  buildRegions,
  DEFAULT_REGION_CAP,
} from "./group-adjacent"

const hit = (
  file: string,
  chunkStart: number,
  chunkEnd: number,
  score: number,
  extra: Partial<SearchHit> = {}
): SearchHit => ({ file, chunkStart, chunkEnd, score, ...extra })

describe("computeFileCap", () => {
  const cases = [
    { name: "zero chunks → 0", total: 0, expected: 0 },
    { name: "below floor → bounded by total", total: 4, expected: 4 },
    { name: "exactly at floor → total when total≤floor", total: 10, expected: 10 },
    { name: "above floor, ratio matches floor → 10", total: 20, expected: 10 },
    { name: "ratio dominates above breakpoint → 50", total: 100, expected: 50 },
    { name: "ratio rounds up", total: 21, expected: 11 },
  ]

  it.each(cases)("$name", ({ total, expected }) => {
    expect(computeFileCap(total, DEFAULT_REGION_CAP)).toBe(expected)
  })
})

describe("capByFile", () => {
  it("accepts top-K per file by walk order, drops the rest", () => {
    const hits = [
      hit("a.md", 0, 10, 0.9),
      hit("a.md", 20, 30, 0.8),
      hit("a.md", 40, 50, 0.7),
      hit("b.md", 0, 10, 0.95),
    ]
    const totals = new Map([
      ["a.md", 4],
      ["b.md", 4],
    ])
    const result = capByFile(hits, totals, { floor: 2, ratio: 0.5 })
    expect(result).toHaveLength(3)
    expect(result.map((h) => `${h.file}:${h.chunkStart}`)).toEqual(["a.md:0", "a.md:20", "b.md:0"])
  })

  it("floor protects small files", () => {
    const hits = [hit("a.md", 0, 10, 0.9), hit("a.md", 20, 30, 0.8)]
    const totals = new Map([["a.md", 2]])
    const result = capByFile(hits, totals, { floor: 10, ratio: 0.5 })
    expect(result).toHaveLength(2)
  })

  it("zero total filters everything", () => {
    const hits = [hit("a.md", 0, 10, 0.9)]
    const totals = new Map([["a.md", 0]])
    expect(capByFile(hits, totals, DEFAULT_REGION_CAP)).toHaveLength(0)
  })
})

describe("mergeAdjacent", () => {
  const cases = [
    {
      name: "disjoint ranges remain separate",
      hits: [hit("a.md", 0, 10, 0.9), hit("a.md", 50, 60, 0.8)],
      expected: [
        { start: 0, end: 10, score: 0.9 },
        { start: 50, end: 60, score: 0.8 },
      ],
    },
    {
      name: "overlapping ranges merge",
      hits: [hit("a.md", 0, 30, 0.9), hit("a.md", 20, 50, 0.8)],
      expected: [{ start: 0, end: 50, score: 0.9 }],
    },
    {
      name: "edge-touching ranges merge",
      hits: [hit("a.md", 0, 30, 0.7), hit("a.md", 30, 60, 0.9)],
      expected: [{ start: 0, end: 60, score: 0.9 }],
    },
    {
      name: "chain merges across multiple",
      hits: [hit("a.md", 0, 30, 0.7), hit("a.md", 20, 50, 0.6), hit("a.md", 40, 70, 0.9)],
      expected: [{ start: 0, end: 70, score: 0.9 }],
    },
    {
      name: "merged score takes max",
      hits: [hit("a.md", 0, 30, 0.4), hit("a.md", 20, 50, 0.9)],
      expected: [{ start: 0, end: 50, score: 0.9 }],
    },
    {
      name: "files merge independently",
      hits: [hit("a.md", 0, 30, 0.7), hit("b.md", 20, 50, 0.8), hit("a.md", 25, 60, 0.6)],
      expected: [
        { start: 0, end: 60, score: 0.7 },
        { start: 20, end: 50, score: 0.8 },
      ],
    },
    {
      name: "hits without offsets pass through",
      hits: [{ file: "a.md", score: 0.5 }],
      expected: [{ start: undefined, end: undefined, score: 0.5 }],
    },
    {
      name: "long overlap chain merges into one region",
      hits: [
        hit("a.md", 0, 1600, 0.9),
        hit("a.md", 1280, 2880, 0.85),
        hit("a.md", 2560, 4160, 0.8),
        hit("a.md", 3840, 5440, 0.75),
        hit("a.md", 5120, 6720, 0.7),
        hit("a.md", 6400, 8000, 0.65),
      ],
      expected: [{ start: 0, end: 8000, score: 0.9 }],
    },
  ]

  it.each(cases)("$name", ({ hits, expected }) => {
    const result = mergeAdjacent(hits)
    expect(result.map((h) => ({ start: h.chunkStart, end: h.chunkEnd, score: h.score }))).toEqual(
      expected
    )
  })
})

describe("buildRegions", () => {
  it("end-to-end: cap drops low-score, top-K merges into one region", () => {
    const source = "abcdefghij" + "klmnopqrst" + "uvwxyz0123" + "456789ABCD"
    const files: FileStore = { "a.md": source }
    const hits = [hit("a.md", 0, 10, 0.9), hit("a.md", 10, 20, 0.85), hit("a.md", 30, 40, 0.6)]
    const totals = new Map([["a.md", 4]])
    const result = buildRegions(hits, totals, files, { floor: 2, ratio: 0.5 })
    expect(result).toHaveLength(1)
    expect(result[0].chunkStart).toBe(0)
    expect(result[0].chunkEnd).toBe(20)
    expect(result[0].text).toBe(source.slice(0, 20))
  })

  it("low-score region survives when cap is higher", () => {
    const source = "abcdefghij".repeat(10)
    const files: FileStore = { "a.md": source }
    const hits = [hit("a.md", 0, 10, 0.9), hit("a.md", 10, 20, 0.85), hit("a.md", 30, 40, 0.6)]
    const totals = new Map([["a.md", 6]])
    const result = buildRegions(hits, totals, files, { floor: 10, ratio: 0.5 })
    expect(result).toHaveLength(2)
    expect(result[0].chunkStart).toBe(0)
    expect(result[0].chunkEnd).toBe(20)
    expect(result[1].chunkStart).toBe(30)
    expect(result[1].chunkEnd).toBe(40)
  })

  it("source slice uses extractProse output, not raw markdown", () => {
    const raw = "Hello world.\n\n```json-callout\n{}\n```\n\nMore prose."
    const files: FileStore = { "a.md": raw }
    const hits = [hit("a.md", 0, 12, 0.9)]
    const totals = new Map([["a.md", 1]])
    const result = buildRegions(hits, totals, files, { floor: 1, ratio: 0.5 })
    expect(result).toHaveLength(1)
    expect(result[0].text).not.toContain("json-callout")
  })
})
