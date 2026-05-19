import { describe, it, expect } from "vitest"
import {
  proseOffsetToOriginal,
  resolveHitToLineRange,
  mergeOverlappingRanges,
  type ResolvedSection,
} from "./resolve-sections"
import type { CodeBlock } from "~/lib/data-blocks/parse"

describe("proseOffsetToOriginal", () => {
  const block = (start: number, end: number): CodeBlock => ({
    language: "json",
    content: "{}",
    start,
    end,
  })

  const cases: { name: string; blocks: CodeBlock[]; proseOffset: number; expected: number }[] = [
    {
      name: "no blocks — identity",
      blocks: [],
      proseOffset: 10,
      expected: 10,
    },
    {
      name: "offset before single block",
      blocks: [block(20, 40)],
      proseOffset: 10,
      expected: 10,
    },
    {
      name: "offset after single block",
      blocks: [block(20, 40)],
      proseOffset: 25,
      expected: 45,
    },
    {
      name: "offset after two blocks",
      blocks: [block(10, 20), block(30, 50)],
      proseOffset: 15,
      expected: 25,
    },
    {
      name: "offset after two blocks — deep",
      blocks: [block(10, 20), block(30, 50)],
      proseOffset: 25,
      expected: 55,
    },
    {
      name: "offset exactly at block gap boundary",
      blocks: [block(10, 20)],
      proseOffset: 10,
      expected: 20,
    },
  ]

  cases.forEach(({ name, blocks, proseOffset, expected }) => {
    it(name, () => expect(proseOffsetToOriginal(blocks, proseOffset)).toBe(expected))
  })
})

describe("resolveHitToLineRange", () => {
  const cases: {
    name: string
    hitText: string
    fileContent: string
    expected: { startLine: number; endLine: number } | null
  }[] = [
    {
      name: "hit in plain text — no code blocks",
      hitText: "second line",
      fileContent: "first line\nsecond line\nthird line",
      expected: { startLine: 2, endLine: 2 },
    },
    {
      name: "hit after a code block",
      hitText: "after block",
      fileContent: "before\n```json\n{}\n```\nafter block\nend",
      expected: { startLine: 5, endLine: 5 },
    },
    {
      name: "hit text not found — returns null",
      hitText: "nonexistent content",
      fileContent: "first line\nsecond line",
      expected: null,
    },
    {
      name: "multi-line hit",
      hitText: "second line third line",
      fileContent: "first line\nsecond line\nthird line\nfourth line",
      expected: { startLine: 2, endLine: 3 },
    },
  ]

  cases.forEach(({ name, hitText, fileContent, expected }) => {
    it(name, () => {
      const result = resolveHitToLineRange(hitText, fileContent)
      if (expected === null) {
        expect(result).toBeNull()
      } else {
        expect(result).not.toBeNull()
        expect(result?.startLine).toBe(expected.startLine)
        expect(result?.endLine).toBe(expected.endLine)
      }
    })
  })
})

describe("mergeOverlappingRanges", () => {
  const r = (path: string, startLine: number, endLine: number): ResolvedSection => ({
    path,
    startLine,
    endLine,
  })

  const cases: { name: string; input: ResolvedSection[]; expected: ResolvedSection[] }[] = [
    {
      name: "empty input",
      input: [],
      expected: [],
    },
    {
      name: "single range — unchanged",
      input: [r("a.md", 1, 10)],
      expected: [r("a.md", 1, 10)],
    },
    {
      name: "adjacent ranges merge",
      input: [r("a.md", 1, 5), r("a.md", 6, 10)],
      expected: [r("a.md", 1, 10)],
    },
    {
      name: "overlapping ranges merge",
      input: [r("a.md", 1, 7), r("a.md", 5, 12)],
      expected: [r("a.md", 1, 12)],
    },
    {
      name: "non-overlapping same file stay separate",
      input: [r("a.md", 1, 3), r("a.md", 8, 12)],
      expected: [r("a.md", 1, 3), r("a.md", 8, 12)],
    },
    {
      name: "different files stay separate",
      input: [r("a.md", 1, 10), r("b.md", 1, 10)],
      expected: [r("a.md", 1, 10), r("b.md", 1, 10)],
    },
    {
      name: "unsorted input gets sorted and merged",
      input: [r("b.md", 3, 8), r("a.md", 5, 10), r("a.md", 1, 6)],
      expected: [r("a.md", 1, 10), r("b.md", 3, 8)],
    },
    {
      name: "contained range absorbed",
      input: [r("a.md", 1, 20), r("a.md", 5, 10)],
      expected: [r("a.md", 1, 20)],
    },
  ]

  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect(mergeOverlappingRanges(input)).toEqual(expected))
  })
})
