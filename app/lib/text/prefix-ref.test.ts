import { describe, it, expect } from "vitest"
import { toLetter, parseRef } from "./prefix-ref"

describe("toLetter", () => {
  const cases: { i: number; expected: string }[] = [
    { i: 0, expected: "a" },
    { i: 1, expected: "b" },
    { i: 25, expected: "z" },
    { i: 26, expected: "aa" },
    { i: 27, expected: "ab" },
    { i: 51, expected: "az" },
    { i: 52, expected: "ba" },
    { i: 701, expected: "zz" },
    { i: 702, expected: "aaa" },
  ]

  it.each(cases)("index $i => $expected", ({ i, expected }) => {
    expect(toLetter(i)).toBe(expected)
  })
})

describe("parseRef glued (sep='')", () => {
  const cases: { ref: string; expected: { prefix: string; n: number } | null }[] = [
    { ref: "a1", expected: { prefix: "a", n: 1 } },
    { ref: "a42", expected: { prefix: "a", n: 42 } },
    { ref: "z9", expected: { prefix: "z", n: 9 } },
    { ref: "aa12", expected: { prefix: "aa", n: 12 } },
    { ref: "ab3", expected: { prefix: "ab", n: 3 } },
    { ref: "a", expected: null },
    { ref: "1", expected: null },
    { ref: "", expected: null },
    { ref: "A1", expected: null },
    { ref: "a0", expected: null },
    { ref: "a-1", expected: null },
    { ref: "1a", expected: null },
  ]

  it.each(cases)("$ref", ({ ref, expected }) => {
    expect(parseRef(ref, "")).toEqual(expected)
  })
})

describe("parseRef dashed (sep='-')", () => {
  const cases: { ref: string; expected: { prefix: string; n: number } | null }[] = [
    { ref: "a-1", expected: { prefix: "a", n: 1 } },
    { ref: "a-42", expected: { prefix: "a", n: 42 } },
    { ref: "z-9", expected: { prefix: "z", n: 9 } },
    { ref: "aa-12", expected: { prefix: "aa", n: 12 } },
    { ref: "ab-3", expected: { prefix: "ab", n: 3 } },
    { ref: "a-", expected: null },
    { ref: "-1", expected: null },
    { ref: "a1", expected: null },
    { ref: "a-0", expected: null },
    { ref: "A-1", expected: null },
    { ref: "1-2", expected: null },
    { ref: "", expected: null },
  ]

  it.each(cases)("$ref", ({ ref, expected }) => {
    expect(parseRef(ref, "-")).toEqual(expected)
  })
})
