import { describe, it, expect } from "vitest"
import { groupBySpan, filterOverlappingSpans, type FindResult } from "./consensus"

const r = (start: number, end: number, analysis_source_id: string): FindResult => ({
  start,
  end,
  analysis_source_id,
})

const span = (code: string, start: number, end: number) => ({ code, start, end })

describe("groupBySpan", () => {
  const cases = [
    {
      name: "empty input → empty result",
      spans: [] as FindResult[],
      expected: [],
    },
    {
      name: "single span stays as-is",
      spans: [r(1, 3, "X")],
      expected: [{ start: 1, end: 3, codings: ["X"] }],
    },
    {
      name: "same bounds different codes → merged",
      spans: [r(1, 3, "A"), r(1, 3, "B")],
      expected: [{ start: 1, end: 3, codings: ["A", "B"] }],
    },
    {
      name: "different bounds → separate entries",
      spans: [r(1, 2, "A"), r(3, 4, "A")],
      expected: [
        { start: 1, end: 2, codings: ["A"] },
        { start: 3, end: 4, codings: ["A"] },
      ],
    },
    {
      name: "duplicate code on same span → deduplicated",
      spans: [r(1, 3, "X"), r(1, 3, "X")],
      expected: [{ start: 1, end: 3, codings: ["X"] }],
    },
    {
      name: "mixed: some merge, some separate",
      spans: [r(1, 3, "A"), r(1, 3, "B"), r(5, 7, "A")],
      expected: [
        { start: 1, end: 3, codings: ["A", "B"] },
        { start: 5, end: 7, codings: ["A"] },
      ],
    },
  ]

  cases.forEach(({ name, spans, expected }) => {
    it(name, () => expect(groupBySpan(spans)).toEqual(expected))
  })
})

describe("filterOverlappingSpans", () => {
  const cases = [
    {
      name: "empty input → empty result",
      items: [],
      expected: [],
    },
    {
      name: "no overlap → all kept",
      items: [span("X", 1, 3), span("X", 5, 7)],
      expected: [span("X", 1, 3), span("X", 5, 7)],
    },
    {
      name: "containment same code → smaller kept",
      items: [span("X", 3, 10), span("X", 5, 5)],
      expected: [span("X", 5, 5)],
    },
    {
      name: "containment different code → both kept",
      items: [span("A", 3, 10), span("B", 5, 5)],
      expected: [span("A", 3, 10), span("B", 5, 5)],
    },
    {
      name: "exact same span → first kept",
      items: [span("X", 3, 10), span("X", 3, 10)],
      expected: [span("X", 3, 10)],
    },
    {
      name: "multiple small inside one large → small ones kept",
      items: [span("X", 1, 20), span("X", 3, 5), span("X", 10, 12)],
      expected: [span("X", 3, 5), span("X", 10, 12)],
    },
    {
      name: "nested containment → innermost kept",
      items: [span("X", 1, 20), span("X", 5, 10), span("X", 7, 8)],
      expected: [span("X", 7, 8)],
    },
    {
      name: "partial overlap same code → smaller kept",
      items: [span("X", 1, 5), span("X", 3, 8)],
      expected: [span("X", 1, 5)],
    },
    {
      name: "partial overlap same size → earlier start kept",
      items: [span("X", 3, 5), span("X", 4, 6)],
      expected: [span("X", 3, 5)],
    },
    {
      name: "partial overlap different codes → both kept",
      items: [span("A", 1, 5), span("B", 3, 8)],
      expected: [span("A", 1, 5), span("B", 3, 8)],
    },
    {
      name: "chain of overlaps → non-overlapping smallest survive",
      items: [span("X", 1, 4), span("X", 3, 6), span("X", 5, 8)],
      expected: [span("X", 1, 4), span("X", 5, 8)],
    },
    {
      name: "preserves input order in output",
      items: [span("X", 10, 12), span("X", 1, 3), span("X", 5, 7)],
      expected: [span("X", 10, 12), span("X", 1, 3), span("X", 5, 7)],
    },
  ]

  cases.forEach(({ name, items, expected }) => {
    it(name, () => expect(filterOverlappingSpans(items)).toEqual(expected))
  })
})
