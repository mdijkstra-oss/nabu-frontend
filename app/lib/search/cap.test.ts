import { describe, it, expect } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import { capByFile, computeFileCap, DEFAULT_REGION_CAP } from "./cap"

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
