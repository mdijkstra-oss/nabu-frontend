import { describe, it, expect } from "vitest"
import type { SectionEntry } from "./format"
import { mergeOverlappingSections, sectionCharCount } from "./handler"

const s = (startLine: number, endLine: number, path = "f.md"): SectionEntry => ({
  path,
  startLine,
  endLine,
})

describe("mergeOverlappingSections", () => {
  const cases = [
    {
      name: "overlapping tail merged",
      input: [s(1, 10), s(8, 18)],
      expected: [s(1, 18)],
    },
    {
      name: "non-overlapping preserved",
      input: [s(1, 5), s(10, 15)],
      expected: [s(1, 5), s(10, 15)],
    },
    {
      name: "three cascading overlaps collapsed",
      input: [s(1, 10), s(8, 18), s(15, 25)],
      expected: [s(1, 25)],
    },
    {
      name: "preserves path from first entry",
      input: [s(1, 10, "a.md"), s(8, 18, "a.md")],
      expected: [s(1, 18, "a.md")],
    },
  ]

  cases.forEach(({ name, input, expected }) => {
    it(name, () => expect(mergeOverlappingSections(input)).toEqual(expected))
  })
})

describe("sectionCharCount", () => {
  const content = "aaa\nbbbb\ncc\ndddddd\neeeee"

  const cases = [
    {
      name: "single section counts chars including newlines",
      sections: [s(1, 2)],
      expected: 9,
    },
    {
      name: "full file",
      sections: [s(1, 5)],
      expected: content.length + 1,
    },
    {
      name: "multiple disjoint sections",
      sections: [s(1, 1), s(4, 4)],
      expected: 4 + 7,
    },
    {
      name: "empty sections returns zero",
      sections: [],
      expected: 0,
    },
    {
      name: "section beyond file length clamped",
      sections: [s(4, 100)],
      expected: 7 + 6,
    },
  ]

  cases.forEach(({ name, sections, expected }) => {
    it(name, () => expect(sectionCharCount(content, sections)).toBe(expected))
  })
})
