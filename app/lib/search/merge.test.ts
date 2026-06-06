import { describe, it, expect } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { seedAndGrow, mergeStage, DEFAULT_SEED_GATE_RATIO } from "./merge"

const hit = (
  file: string,
  chunkStart: number,
  chunkEnd: number,
  score: number,
  extra: Partial<SearchHit> = {}
): SearchHit => ({ file, chunkStart, chunkEnd, score, ...extra })

const summarize = (regions: SearchHit[]) =>
  regions.map((r) => ({
    file: r.file,
    start: r.chunkStart,
    end: r.chunkEnd,
    score: r.score,
  }))

describe("seedAndGrow", () => {
  const cases = [
    {
      name: "single seed, no neighbors → one region",
      hits: [hit("a.md", 0, 100, 0.9)],
      expected: [{ file: "a.md", start: 0, end: 100, score: 0.9 }],
    },
    {
      name: "two non-overlapping seeds → two regions",
      hits: [hit("a.md", 0, 100, 0.9), hit("a.md", 200, 300, 0.8)],
      expected: [
        { file: "a.md", start: 0, end: 100, score: 0.9 },
        { file: "a.md", start: 200, end: 300, score: 0.8 },
      ],
    },
    {
      name: "overlap + rank-close extends region",
      hits: [hit("a.md", 100, 200, 0.9), hit("a.md", 0, 150, 0.8)],
      expected: [{ file: "a.md", start: 0, end: 200, score: 0.9 }],
    },
    {
      name: "overlap + rank-far is dropped (does not extend)",
      hits: [hit("a.md", 100, 200, 0.9), hit("a.md", 0, 150, 0.4)],
      expected: [{ file: "a.md", start: 100, end: 200, score: 0.9 }],
    },
    {
      name: "bridge between two regions is dropped",
      hits: [hit("a.md", 0, 100, 0.9), hit("a.md", 300, 400, 0.85), hit("a.md", 50, 350, 0.5)],
      expected: [
        { file: "a.md", start: 0, end: 100, score: 0.9 },
        { file: "a.md", start: 300, end: 400, score: 0.85 },
      ],
    },
    {
      name: "different files independent",
      hits: [hit("a.md", 0, 100, 0.9), hit("b.md", 0, 100, 0.8)],
      expected: [
        { file: "a.md", start: 0, end: 100, score: 0.9 },
        { file: "b.md", start: 0, end: 100, score: 0.8 },
      ],
    },
    {
      name: "chain blocked by rank drop — rank-far neighbor consumed and dropped",
      hits: [hit("a.md", 0, 100, 1.0), hit("a.md", 80, 180, 0.9), hit("a.md", 160, 260, 0.5)],
      expected: [{ file: "a.md", start: 0, end: 180, score: 1.0 }],
    },
    {
      name: "long byte-chain broken by score-ratio gate (rank-far dropped, gap reseeds)",
      hits: [
        hit("a.md", 0, 1600, 0.9),
        hit("a.md", 1280, 2880, 0.85),
        hit("a.md", 2560, 4160, 0.8),
        hit("a.md", 3840, 5440, 0.5),
        hit("a.md", 5120, 6720, 0.3),
        hit("a.md", 6400, 8000, 0.2),
      ],
      expected: [
        { file: "a.md", start: 0, end: 4160, score: 0.9 },
        { file: "a.md", start: 5120, end: 8000, score: 0.3 },
      ],
    },
    {
      name: "edge-touching ranges count as overlap",
      hits: [hit("a.md", 0, 100, 0.9), hit("a.md", 100, 200, 0.85)],
      expected: [{ file: "a.md", start: 0, end: 200, score: 0.9 }],
    },
    {
      name: "no-offset hits pass through unchanged",
      hits: [{ file: "a.md", score: 0.5 } as SearchHit],
      expected: [{ file: "a.md", start: undefined, end: undefined, score: 0.5 }],
    },
  ]

  it.each(cases)("$name", ({ hits, expected }) => {
    const result = seedAndGrow(hits)
    expect(summarize(result)).toEqual(expected)
  })

  it("custom ratio loosens or tightens gate", () => {
    const hits = [hit("a.md", 0, 100, 1.0), hit("a.md", 80, 180, 0.5)]
    const tight = seedAndGrow(hits, { ratio: 0.8 })
    expect(summarize(tight)).toEqual([{ file: "a.md", start: 0, end: 100, score: 1.0 }])
    const loose = seedAndGrow(hits, { ratio: 0.4 })
    expect(summarize(loose)).toEqual([{ file: "a.md", start: 0, end: 180, score: 1.0 }])
  })

  it("default ratio matches DEFAULT_SEED_GATE_RATIO", () => {
    expect(DEFAULT_SEED_GATE_RATIO).toBe(0.6)
  })

  it("output preserves rank-of-seed order across files (not grouped by file)", () => {
    const hits = [
      hit("a.md", 0, 100, 0.99), // rank 1, seeds A1
      hit("b.md", 0, 100, 0.95), // rank 2, seeds B1
      hit("a.md", 500, 600, 0.9), // rank 3, seeds A2
      hit("b.md", 500, 600, 0.85), // rank 4, seeds B2
    ]
    const result = seedAndGrow(hits)
    expect(result.map((r) => `${r.file}:${r.chunkStart}`)).toEqual([
      "a.md:0",
      "b.md:0",
      "a.md:500",
      "b.md:500",
    ])
  })
})

describe("mergeStage", () => {
  it("re-slices grown region from source", () => {
    const source = "abcdefghij" + "klmnopqrst" + "uvwxyz0123" + "456789ABCD"
    const files: FileStore = { "a.md": source }
    const hits = [hit("a.md", 0, 10, 0.9), hit("a.md", 5, 20, 0.85)]
    const result = mergeStage(hits, files)
    expect(result).toHaveLength(1)
    expect(result[0].chunkStart).toBe(0)
    expect(result[0].chunkEnd).toBe(20)
    expect(result[0].text).toBe(source.slice(0, 20))
  })

  it("source slice uses extractProse output, not raw markdown", () => {
    const raw = "Hello world.\n\n```json-callout\n{}\n```\n\nMore prose."
    const files: FileStore = { "a.md": raw }
    const hits = [hit("a.md", 0, 12, 0.9)]
    const result = mergeStage(hits, files)
    expect(result).toHaveLength(1)
    expect(result[0].text).not.toContain("json-callout")
  })

  it("rank-far overlapping hits dropped, region anchored on seed", () => {
    const source = "x".repeat(500)
    const files: FileStore = { "a.md": source }
    const hits = [hit("a.md", 100, 200, 1.0), hit("a.md", 0, 150, 0.3)]
    const result = mergeStage(hits, files)
    expect(result).toHaveLength(1)
    expect(result[0].chunkStart).toBe(100)
    expect(result[0].chunkEnd).toBe(200)
  })
})
