import { describe, it, expect } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import {
  buildCandidateSql,
  chunkHashesForRanges,
  dedupBySpan,
  mapHitToAnnotations,
} from "./step-find"
import { chunkText } from "~/lib/embeddings/chunk"
import type { Annotation } from "./types"

const ann = (start: number, end: number, code: string, score?: number): Annotation => ({
  start,
  end,
  code,
  reason: "",
  findVotes: [],
  ...(score !== undefined ? { score } : {}),
})

const buildLongFile = (lineCount: number, lineLen: number): string =>
  Array.from({ length: lineCount }, (_, i) =>
    `Line ${i + 1}: ${"abcdefgh".repeat(Math.ceil(lineLen / 8))}`.slice(0, lineLen)
  ).join("\n")

describe("chunkHashesForRanges", () => {
  it("empty file returns empty", () => {
    expect(chunkHashesForRanges("", [{ startLine: 1, endLine: 10 }])).toEqual([])
  })

  it("empty ranges returns empty", () => {
    expect(chunkHashesForRanges("hello world.", [])).toEqual([])
  })

  it("single-chunk file with intersecting range returns the hash", () => {
    const raw = "Short body. Another sentence. And a third one."
    const chunks = chunkText(raw)
    expect(chunks.length).toBe(1)
    const hashes = chunkHashesForRanges(raw, [{ startLine: 1, endLine: 1 }])
    expect(hashes).toEqual([chunks[0].hash])
  })

  it("multi-chunk file: range over early lines returns only overlapping hashes", () => {
    const raw = buildLongFile(40, 100)
    const chunks = chunkText(raw)
    expect(chunks.length).toBeGreaterThan(1)
    const hashes = chunkHashesForRanges(raw, [{ startLine: 1, endLine: 3 }])
    expect(hashes.length).toBeGreaterThan(0)
    expect(hashes.length).toBeLessThanOrEqual(chunks.length)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it("multi-chunk file: union of multiple ranges may return more hashes than one range", () => {
    const raw = buildLongFile(60, 100)
    const chunks = chunkText(raw)
    expect(chunks.length).toBeGreaterThan(2)
    const earlyOnly = chunkHashesForRanges(raw, [{ startLine: 1, endLine: 3 }])
    const both = chunkHashesForRanges(raw, [
      { startLine: 1, endLine: 3 },
      { startLine: 55, endLine: 60 },
    ])
    expect(both.length).toBeGreaterThanOrEqual(earlyOnly.length)
  })
})

describe("buildCandidateSql", () => {
  const cases = [
    {
      name: "single file, single hash",
      dim: "code-x.generated.hidden.md",
      pairs: [{ file: "a.md", hash: "h1" }],
      expected:
        "SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('code-x.generated.hidden.md') FROM files f WHERE (f.file = 'a.md' AND hash IN ('h1'))",
    },
    {
      name: "single file, multiple hashes",
      dim: "x.md",
      pairs: [
        { file: "a.md", hash: "h1" },
        { file: "a.md", hash: "h2" },
        { file: "a.md", hash: "h3" },
      ],
      expected:
        "SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('x.md') FROM files f WHERE (f.file = 'a.md' AND hash IN ('h1', 'h2', 'h3'))",
    },
    {
      name: "multiple files grouped per file",
      dim: "x.md",
      pairs: [
        { file: "a.md", hash: "h1" },
        { file: "b.md", hash: "h2" },
        { file: "a.md", hash: "h3" },
      ],
      expected:
        "SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('x.md') FROM files f WHERE (f.file = 'a.md' AND hash IN ('h1', 'h3')) OR (f.file = 'b.md' AND hash IN ('h2'))",
    },
    {
      name: "escapes single quote in file path",
      dim: "x.md",
      pairs: [{ file: "a'b.md", hash: "h1" }],
      expected:
        "SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('x.md') FROM files f WHERE (f.file = 'a''b.md' AND hash IN ('h1'))",
    },
    {
      name: "escapes single quote in dim path",
      dim: "x'y.md",
      pairs: [{ file: "a.md", hash: "h1" }],
      expected:
        "SELECT f.file, f.text, EMBEDDINGS_FROM_FILE('x''y.md') FROM files f WHERE (f.file = 'a.md' AND hash IN ('h1'))",
    },
  ]

  cases.forEach(({ name, dim, pairs, expected }) => {
    it(name, () => {
      expect(buildCandidateSql(dim, pairs)).toBe(expected)
    })
  })
})

describe("mapHitToAnnotations", () => {
  const sentences = [
    "Sara jumped in first.",
    "Once she spoke, two more people followed.",
    "The facilitator nodded.",
    "Almost everyone contributed.",
  ]

  it("locates each hit.match in the composite sentences", () => {
    const hit: SearchHit = {
      file: "doc.md",
      score: 0.7,
      matches: ["Sara jumped in first.", "Almost everyone contributed."],
      matchRanges: [
        { start: 0, end: 0 },
        { start: 3, end: 3 },
      ],
    }
    const result = mapHitToAnnotations(hit, "participation", sentences)
    expect(result).toEqual([ann(1, 1, "participation", 0.7), ann(4, 4, "participation", 0.7)])
  })

  it("ignores matches that cannot be located", () => {
    const hit: SearchHit = {
      file: "doc.md",
      score: 0.5,
      matches: ["totally unrelated text not in the doc"],
    }
    expect(mapHitToAnnotations(hit, "p", sentences)).toEqual([])
  })

  it("returns empty when no matches present", () => {
    const hit: SearchHit = { file: "doc.md", score: 0.5 }
    expect(mapHitToAnnotations(hit, "p", sentences)).toEqual([])
  })

  it("locates multi-sentence match as a span", () => {
    const hit: SearchHit = {
      file: "doc.md",
      score: 0.6,
      matches: ["Once she spoke, two more people followed. The facilitator nodded."],
    }
    const result = mapHitToAnnotations(hit, "p", sentences)
    expect(result).toHaveLength(1)
    expect(result[0].start).toBe(2)
    expect(result[0].end).toBe(3)
    expect(result[0].code).toBe("p")
    expect(result[0].score).toBe(0.6)
  })
})

describe("dedupBySpan", () => {
  const cases = [
    {
      name: "empty input returns empty",
      input: [],
      expected: [],
    },
    {
      name: "all unique spans pass through",
      input: [ann(1, 2, "a"), ann(3, 4, "a"), ann(5, 6, "b")],
      expected: [ann(1, 2, "a"), ann(3, 4, "a"), ann(5, 6, "b")],
    },
    {
      name: "same span same code deduped, first wins",
      input: [ann(1, 2, "a", 0.9), ann(1, 2, "a", 0.5)],
      expected: [ann(1, 2, "a", 0.9)],
    },
    {
      name: "same span different code kept",
      input: [ann(1, 2, "a"), ann(1, 2, "b")],
      expected: [ann(1, 2, "a"), ann(1, 2, "b")],
    },
  ]

  cases.forEach(({ name, input, expected }) => {
    it(name, () => {
      expect(dedupBySpan(input)).toEqual(expected)
    })
  })
})
