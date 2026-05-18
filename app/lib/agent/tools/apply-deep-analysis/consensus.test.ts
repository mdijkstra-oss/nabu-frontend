import { describe, it, expect } from "vitest"
import { groupBySpan, type FindResult } from "./consensus"

const r = (start: number, end: number, analysis_source_id: string): FindResult => ({
  start,
  end,
  analysis_source_id,
})

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
