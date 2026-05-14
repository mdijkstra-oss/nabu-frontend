import { describe, it, expect } from "vitest"
import { charOffsetToLine, getLineContent } from "./lines"

describe("charOffsetToLine", () => {
  const content = "aaa\nbbb\nccc\nddd"

  const cases: { name: string; offset: number; expected: number }[] = [
    { name: "offset 0 → line 0", offset: 0, expected: 0 },
    { name: "offset at first newline", offset: 3, expected: 0 },
    { name: "offset after first newline", offset: 4, expected: 1 },
    { name: "middle of second line", offset: 5, expected: 1 },
    { name: "start of third line", offset: 8, expected: 2 },
    { name: "last char", offset: 14, expected: 3 },
    { name: "offset beyond content", offset: 999, expected: 3 },
    { name: "empty content", offset: 5, expected: 0 },
  ]

  it.each(cases.slice(0, -1))("$name", ({ offset, expected }) => {
    expect(charOffsetToLine(content, offset)).toBe(expected)
  })

  it("empty content", () => {
    expect(charOffsetToLine("", 5)).toBe(0)
  })
})

describe("getLineContent", () => {
  const content = "aaa\nbbb\nccc\nddd\neee"

  const cases: { name: string; start: number; end: number; expected: string }[] = [
    { name: "single line", start: 0, end: 0, expected: "aaa" },
    { name: "first two lines", start: 0, end: 1, expected: "aaa\nbbb" },
    { name: "middle range", start: 1, end: 3, expected: "bbb\nccc\nddd" },
    { name: "entire content", start: 0, end: 4, expected: "aaa\nbbb\nccc\nddd\neee" },
    { name: "endLine beyond content", start: 3, end: 99, expected: "ddd\neee" },
    { name: "same start and end", start: 2, end: 2, expected: "ccc" },
  ]

  it.each(cases)("$name", ({ start, end, expected }) => {
    expect(getLineContent(content, start, end)).toBe(expected)
  })
})
