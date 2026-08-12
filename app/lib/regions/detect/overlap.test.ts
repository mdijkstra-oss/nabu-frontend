import { describe, it, expect } from "vitest"
import type { Mark } from "./types"
import { resolveOverlaps } from "./overlap"

const mark = (
  startSentence: number,
  endSentence: number,
  hitSentence: number,
  over: Partial<Mark> = {}
): Mark => ({
  kind: "speaker",
  quote: `quote ${hitSentence}`,
  hitSentence,
  value: `value-${hitSentence}`,
  startSentence,
  endSentence,
  ...over,
})

const ranges = (marks: Mark[]): [number, number][] =>
  marks.map((m) => [m.startSentence, m.endSentence])

describe("resolveOverlaps", () => {
  const cases: {
    name: string
    marks: Mark[]
    expected: [number, number][]
    unranged: number[]
  }[] = [
    {
      name: "regions that do not touch are left alone",
      marks: [mark(0, 4, 0), mark(6, 9, 6)],
      expected: [
        [0, 4],
        [6, 9],
      ],
      unranged: [],
    },
    {
      name: "regions that merely touch at a boundary are left alone",
      marks: [mark(0, 4, 0), mark(5, 9, 5)],
      expected: [
        [0, 4],
        [5, 9],
      ],
      unranged: [],
    },
    {
      name: "an earlier region reaching into a later one is cut before it",
      marks: [mark(0, 7, 0), mark(5, 9, 5)],
      expected: [
        [0, 4],
        [5, 9],
      ],
      unranged: [],
    },
    {
      name: "a nested region cuts the one enclosing it",
      marks: [mark(0, 20, 0), mark(5, 9, 5)],
      expected: [
        [0, 4],
        [5, 9],
      ],
      unranged: [],
    },
    {
      name: "the later region yields where the cut would erase the earlier one",
      marks: [mark(5, 12, 5), mark(5, 20, 15)],
      expected: [
        [5, 5],
        [6, 20],
      ],
      unranged: [],
    },
    {
      name: "identical ranges collapse to the one whose hit sentence is lower",
      marks: [mark(4, 9, 7), mark(4, 9, 5)],
      expected: [[4, 9]],
      unranged: [7],
    },
    {
      name: "a chain of overlaps resolves in one pass",
      marks: [mark(0, 12, 0), mark(6, 18, 6), mark(10, 25, 10)],
      expected: [
        [0, 5],
        [6, 9],
        [10, 25],
      ],
      unranged: [],
    },
  ]

  it.each(cases)("$name", ({ marks, expected, unranged }) => {
    const resolution = resolveOverlaps(marks)

    expect(ranges(resolution.marks)).toEqual(expected)
    expect(resolution.unranged.map((h) => h.hitSentence)).toEqual(unranged)
  })

  it("keeps the hit of a collapsed duplicate rather than dropping it", () => {
    const resolution = resolveOverlaps([mark(4, 9, 7), mark(4, 9, 5)])

    expect(resolution.unranged).toEqual([
      { kind: "speaker", quote: "quote 7", hitSentence: 7, value: "value-7" },
    ])
  })

  it("never leaves two regions of one kind overlapping", () => {
    const resolution = resolveOverlaps([
      mark(0, 30, 0),
      mark(2, 30, 2),
      mark(4, 30, 4),
      mark(4, 30, 6),
      mark(20, 25, 22),
    ])

    for (const [a, b] of resolution.marks.map((m, i, all) => [m, all[i + 1]])) {
      if (!b) continue
      expect(a.endSentence).toBeLessThan(b.startSentence)
      expect(a.startSentence).toBeLessThanOrEqual(a.endSentence)
    }
  })

  it("resolves marks made this pass against marks handed in from storage alike", () => {
    const stored = mark(0, 12, 0, { value: "stored" })
    const fresh = mark(6, 18, 6, { value: "fresh" })

    expect(ranges(resolveOverlaps([fresh, stored]).marks)).toEqual([
      [0, 5],
      [6, 18],
    ])
  })

  it("leaves regions of different kinds overlapping", () => {
    const speaker = mark(0, 20, 0)
    const date = mark(0, 20, 0, { kind: "date", value: "2024-03-05" })

    expect(ranges(resolveOverlaps([speaker, date]).marks)).toEqual([
      [0, 20],
      [0, 20],
    ])
  })

  it("returns nothing for nothing", () => {
    expect(resolveOverlaps([])).toEqual({ marks: [], unranged: [] })
  })
})
