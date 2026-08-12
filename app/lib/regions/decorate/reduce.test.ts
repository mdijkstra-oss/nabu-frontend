import { describe, it, expect } from "vitest"
import type { ResolvedRegionRow } from "~/domain/data-blocks/regions/schema"
import { reduceByKind } from "./reduce"
import type { InferredMeta } from "./schema"
import { dateRegion, speakerRegion } from "./test-fixtures"

const resolved = (row: ReturnType<typeof speakerRegion>): ResolvedRegionRow =>
  row as ResolvedRegionRow

describe("reduceByKind", () => {
  interface Case {
    name: string
    regions: ResolvedRegionRow[]
    expected: InferredMeta | undefined
  }

  const cases: Case[] = [
    { name: "no regions reduce to no field at all", regions: [], expected: undefined },
    {
      name: "one string region reduces to a one-value list",
      regions: [resolved(speakerRegion("alice", 1, 2))],
      expected: { speaker: ["alice"] },
    },
    {
      name: "several string regions reduce to distinct values in document order",
      regions: [
        resolved(speakerRegion("bob", 3, 4)),
        resolved(speakerRegion("alice", 1, 2)),
        resolved(speakerRegion("alice", 5, 6)),
      ],
      expected: { speaker: ["alice", "bob"] },
    },
    {
      name: "one datetime region reduces to a span starting and ending at its value",
      regions: [resolved(dateRegion("2026-03-03T00:00:00Z", 0, 4))],
      expected: { date: { start: "2026-03-03T00:00:00Z", end: "2026-03-03T00:00:00Z" } },
    },
    {
      name: "several datetime regions reduce to the earliest and the latest",
      regions: [
        resolved(dateRegion("2026-03-05T00:00:00Z", 2, 2)),
        resolved(dateRegion("2026-03-01T00:00:00Z", 0, 1)),
        resolved(dateRegion("2026-03-09T12:30:00Z", 3, 4)),
      ],
      expected: { date: { start: "2026-03-01T00:00:00Z", end: "2026-03-09T12:30:00Z" } },
    },
    {
      name: "kinds reduce independently of one another",
      regions: [
        resolved(speakerRegion("alice", 1, 2)),
        resolved(dateRegion("2026-03-03T00:00:00Z", 0, 4)),
      ],
      expected: {
        speaker: ["alice"],
        date: { start: "2026-03-03T00:00:00Z", end: "2026-03-03T00:00:00Z" },
      },
    },
    {
      name: "a region of an unregistered kind contributes nothing",
      regions: [{ ...resolved(speakerRegion("alice", 1, 2)), kind: "weather" }],
      expected: undefined,
    },
  ]

  it.each(cases)("$name", ({ regions, expected }) => {
    expect(reduceByKind(regions)).toEqual(expected)
  })
})

// A stored value is z.string() and parsed.type is not policed against its kind, so a row
// hand-edited in the raw markdown can carry an offset — and then string order and time
// order disagree.
describe("the datetime reducer over values the schema admits", () => {
  // 01:00+05:00 on the 3rd is 20:00Z on the 2nd — earlier than 23:00Z on the 2nd, and
  // later than it in string order. The two orders disagree, which is the whole case.
  it("takes the earliest and latest instant, not the first and last string", () => {
    const regions = [
      resolved(dateRegion("2026-03-03T01:00:00+05:00", 0, 1)),
      resolved(dateRegion("2026-03-02T23:00:00Z", 2, 3)),
    ]
    expect(reduceByKind(regions)).toEqual({
      date: { start: "2026-03-03T01:00:00+05:00", end: "2026-03-02T23:00:00Z" },
    })
  })

  it("never makes an unparseable value an edge", () => {
    const regions = [
      resolved(dateRegion("not a date at all", 0, 1)),
      resolved(dateRegion("2026-03-02T23:00:00Z", 2, 3)),
    ]
    expect(reduceByKind(regions)).toEqual({
      date: { start: "2026-03-02T23:00:00Z", end: "2026-03-02T23:00:00Z" },
    })
  })
})
