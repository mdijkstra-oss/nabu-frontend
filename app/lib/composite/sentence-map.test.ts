import { describe, expect, test } from "vitest"
import { buildSentenceSegmentMap, resolveSentenceIndex } from "./sentence-map"
import type { Composite } from "./pack"

describe("buildSentenceSegmentMap", () => {
  const composite: Composite = {
    content: "First sentence. Second sentence.\n\n# b.md [1-5]\n\nThird sentence. Fourth.",
    segments: [
      { path: "a.md", startLine: 1, endLine: 5, charStart: 0, charEnd: 32 },
      { path: "b.md", startLine: 1, endLine: 5, charStart: 48, charEnd: 72 },
    ],
  }

  const cases = [
    {
      name: "sentence in first segment maps correctly",
      positions: [{ start: 0 }, { start: 16 }, { start: 34 }, { start: 48 }, { start: 64 }],
      expectedPaths: ["a.md", "a.md", null, "b.md", "b.md"],
    },
  ]

  test.each(cases)("$name", ({ positions, expectedPaths }) => {
    const map = buildSentenceSegmentMap(composite, positions)
    expect(map.map((s) => s?.path ?? null)).toEqual(expectedPaths)
  })
})

describe("resolveSentenceIndex", () => {
  const segA = { path: "a.md", startLine: 1, endLine: 5, charStart: 0, charEnd: 30 }
  const segB = { path: "b.md", startLine: 1, endLine: 5, charStart: 50, charEnd: 80 }
  const map = [segA, segA, null, segB, segB]

  const cases = [
    { name: "index 1 maps to first segment", index: 1, expected: "a.md" },
    { name: "index 2 maps to first segment", index: 2, expected: "a.md" },
    { name: "index 3 (separator) maps to null", index: 3, expected: null },
    { name: "index 4 maps to second segment", index: 4, expected: "b.md" },
    { name: "index out of range maps to null", index: 99, expected: null },
  ]

  test.each(cases)("$name", ({ index, expected }) => {
    const result = resolveSentenceIndex(map, index)
    expect(result?.path ?? null).toBe(expected)
  })
})
