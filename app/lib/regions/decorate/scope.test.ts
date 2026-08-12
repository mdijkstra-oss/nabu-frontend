import { describe, it, expect } from "vitest"
import { indexFileSentences, proseOf, type SentenceRow } from "~/lib/text/halo"
import type { RegionRow } from "~/domain/data-blocks/regions/schema"
import {
  regionsInScope,
  scopeOfDocument,
  scopeOfPoint,
  scopeOfQuote,
  type SentenceScope,
} from "./scope"
import { TRANSCRIPT_PROSE, dateRegion, speakerRegion } from "./test-fixtures"

const sentences: SentenceRow[] = [
  { text: "One.", start: 0, end: 4 },
  { text: "Two.", start: 5, end: 9 },
  { text: "Three.", start: 10, end: 16 },
]

describe("scopeOfDocument", () => {
  it("spans the first sentence to the last", () => {
    expect(scopeOfDocument(sentences)).toEqual({ first: 0, last: 2 })
  })

  it("is absent for a document with no prose", () => {
    expect(scopeOfDocument([])).toBeNull()
  })
})

describe("scopeOfPoint", () => {
  interface Case {
    name: string
    rows: SentenceRow[]
    offset: number
    expected: SentenceScope | null
  }

  const cases: Case[] = [
    {
      name: "the sentence ending at the point",
      rows: sentences,
      offset: 9,
      expected: { first: 1, last: 1 },
    },
    {
      name: "the sentence ending before the point",
      rows: sentences,
      offset: 12,
      expected: { first: 1, last: 1 },
    },
    {
      name: "the first sentence when the point precedes all prose",
      rows: sentences,
      offset: 0,
      expected: { first: 0, last: 0 },
    },
    { name: "nothing when the document has no prose", rows: [], offset: 0, expected: null },
  ]

  it.each(cases)("$name", ({ rows, offset, expected }) => {
    expect(scopeOfPoint(rows, offset)).toEqual(expected)
  })
})

describe("scopeOfQuote", () => {
  const prose = proseOf(TRANSCRIPT_PROSE)
  const rows = indexFileSentences(TRANSCRIPT_PROSE)

  interface Case {
    name: string
    quote: string
    expected: SentenceScope | null
  }

  const cases: Case[] = [
    {
      name: "a quote inside one sentence takes that sentence",
      quote: "the funding was approved",
      expected: { first: 1, last: 1 },
    },
    {
      name: "a quote crossing a sentence boundary takes both",
      quote: "She thanked the committee. Bob objected to the timeline.",
      expected: { first: 2, last: 3 },
    },
    {
      name: "a quote the document no longer holds has no scope",
      quote: "Carol proposed a vote on the merger",
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ quote, expected }) => {
    expect(scopeOfQuote(prose, rows, quote)).toEqual(expected)
  })
})

describe("regionsInScope", () => {
  interface Case {
    name: string
    regions: RegionRow[]
    scope: SentenceScope
    excludedKind?: string
    expected: string[]
  }

  const cases: Case[] = [
    {
      name: "a region enclosing the scope is in scope",
      regions: [speakerRegion("alice", 0, 4)],
      scope: { first: 2, last: 2 },
      expected: ["alice"],
    },
    {
      name: "a region the scope encloses is in scope",
      regions: [speakerRegion("alice", 2, 2)],
      scope: { first: 0, last: 4 },
      expected: ["alice"],
    },
    {
      name: "a region straddling the scope's edge is in scope",
      regions: [speakerRegion("alice", 3, 5)],
      scope: { first: 1, last: 3 },
      expected: ["alice"],
    },
    {
      name: "an adjacent but disjoint region is out of scope",
      regions: [speakerRegion("alice", 3, 4)],
      scope: { first: 1, last: 2 },
      expected: [],
    },
    {
      name: "a region stale past the end of the document is out of scope",
      regions: [speakerRegion("alice", 40, 41)],
      scope: { first: 0, last: 4 },
      expected: [],
    },
    {
      name: "a hit with no range encloses no text",
      regions: [speakerRegion("alice")],
      scope: { first: 0, last: 4 },
      expected: [],
    },
    {
      name: "regions of the excluded kind never reach the scope",
      regions: [speakerRegion("alice", 0, 4), dateRegion("2026-03-03T00:00:00Z", 0, 4)],
      scope: { first: 1, last: 1 },
      excludedKind: "speaker",
      expected: ["2026-03-03T00:00:00Z"],
    },
  ]

  it.each(cases)("$name", ({ regions, scope, excludedKind, expected }) => {
    expect(regionsInScope(regions, scope, excludedKind).map((r) => r.parsed.value)).toEqual(
      expected
    )
  })
})
