import { describe, it, expect } from "vitest"
import type { Mark } from "./types"
import { dedupeMarks } from "./overlap"

const mark = (
  startSentence: number,
  endSentence: number,
  hitSentence: number,
  over: Partial<Mark> = {}
): Mark => ({
  kind: "person",
  quote: `quote ${hitSentence}`,
  hitSentence,
  value: `value-${hitSentence}`,
  startSentence,
  endSentence,
  ...over,
})

const ranges = (marks: Mark[]): [number, number][] =>
  marks.map((m) => [m.startSentence, m.endSentence])

describe("dedupeMarks", () => {
  const cases: {
    name: string
    marks: Mark[]
    expected: [number, number][]
  }[] = [
    {
      name: "regions that do not touch are left alone",
      marks: [mark(0, 4, 0), mark(6, 9, 6)],
      expected: [
        [0, 4],
        [6, 9],
      ],
    },
    {
      name: "overlapping regions with different values both survive",
      marks: [mark(0, 7, 0), mark(5, 9, 5)],
      expected: [
        [0, 7],
        [5, 9],
      ],
    },
    {
      name: "a region nested inside another survives whole",
      marks: [mark(0, 20, 0), mark(5, 9, 5)],
      expected: [
        [0, 20],
        [5, 9],
      ],
    },
    {
      name: "identical ranges with different values both survive",
      marks: [mark(4, 9, 7), mark(4, 9, 5)],
      expected: [
        [4, 9],
        [4, 9],
      ],
    },
    {
      name: "the same value on identical ranges survives once per occurrence",
      marks: [mark(4, 9, 5, { value: "shared" }), mark(4, 9, 7, { value: "shared" })],
      expected: [
        [4, 9],
        [4, 9],
      ],
    },
    {
      name: "an exact duplicate is dropped",
      marks: [mark(4, 9, 5), mark(4, 9, 5)],
      expected: [[4, 9]],
    },
  ]

  it.each(cases)("$name", ({ marks, expected }) => {
    expect(ranges(dedupeMarks(marks))).toEqual(expected)
  })

  it("keeps equal ranges across kinds", () => {
    const person = mark(0, 20, 0)
    const date = mark(0, 20, 0, { kind: "date", value: "2024-03-05" })

    expect(ranges(dedupeMarks([person, date]))).toEqual([
      [0, 20],
      [0, 20],
    ])
  })

  it("returns nothing for nothing", () => {
    expect(dedupeMarks([])).toEqual([])
  })
})
