import { describe, it, expect } from "vitest"
import { mergeOverlapping } from "./ranges"

interface Range {
  start: number
  end: number
}

const r = (start: number, end: number): Range => ({ start, end })

const mergeRanges = (items: Range[]): Range[] =>
  mergeOverlapping(
    items,
    (r) => r.start,
    (r) => r.end,
    (a, b) => ({ start: a.start, end: Math.max(a.end, b.end) })
  )

describe("mergeOverlapping", () => {
  const cases = [
    {
      name: "empty returns empty",
      input: [] as Range[],
      expected: [] as Range[],
    },
    {
      name: "single item unchanged",
      input: [r(1, 10)],
      expected: [r(1, 10)],
    },
    {
      name: "non-overlapping preserved in order",
      input: [r(1, 5), r(10, 15)],
      expected: [r(1, 5), r(10, 15)],
    },
    {
      name: "overlapping tail merged",
      input: [r(1, 10), r(8, 18)],
      expected: [r(1, 18)],
    },
    {
      name: "identical ranges collapsed",
      input: [r(5, 15), r(5, 15)],
      expected: [r(5, 15)],
    },
    {
      name: "contained range absorbed",
      input: [r(1, 20), r(5, 10)],
      expected: [r(1, 20)],
    },
    {
      name: "three overlapping merged into one",
      input: [r(1, 10), r(8, 18), r(15, 25)],
      expected: [r(1, 25)],
    },
    {
      name: "unsorted input sorted before merge",
      input: [r(20, 30), r(1, 5), r(10, 22)],
      expected: [r(1, 5), r(10, 30)],
    },
    {
      name: "touching at boundary merged",
      input: [r(1, 10), r(10, 20)],
      expected: [r(1, 20)],
    },
    {
      name: "gap of one not merged",
      input: [r(1, 10), r(11, 20)],
      expected: [r(1, 10), r(11, 20)],
    },
    {
      name: "does not mutate input",
      input: [r(5, 15), r(1, 8)],
      check: (input: Range[]) => {
        const before = input.map((e) => ({ ...e }))
        mergeRanges(input)
        expect(input).toEqual(before)
      },
    },
  ]

  cases.forEach(({ name, input, expected, check }) => {
    it(name, () => {
      if (check) return check(input)
      expect(mergeRanges(input)).toEqual(expected)
    })
  })
})
