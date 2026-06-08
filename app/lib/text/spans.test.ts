import { describe, it, expect } from "vitest"
import {
  spanLength,
  overlaps,
  overlapCount,
  overlapRatio,
  collapseRunsByOverlap,
  dedupOverlapping,
} from "./spans"

describe("spanLength", () => {
  it.each([
    { s: { start: 1, end: 1 }, expected: 1 },
    { s: { start: 1, end: 5 }, expected: 5 },
    { s: { start: 3, end: 7 }, expected: 5 },
  ])("[$s.start,$s.end] => $expected", ({ s, expected }) => {
    expect(spanLength(s)).toBe(expected)
  })
})

describe("overlaps", () => {
  const cases: {
    a: { start: number; end: number }
    b: { start: number; end: number }
    expected: boolean
  }[] = [
    { a: { start: 1, end: 3 }, b: { start: 2, end: 4 }, expected: true },
    { a: { start: 1, end: 3 }, b: { start: 3, end: 5 }, expected: true },
    { a: { start: 1, end: 3 }, b: { start: 4, end: 6 }, expected: false },
    { a: { start: 1, end: 5 }, b: { start: 2, end: 3 }, expected: true },
    { a: { start: 5, end: 7 }, b: { start: 1, end: 3 }, expected: false },
  ]
  it.each(cases)("$a.start-$a.end vs $b.start-$b.end => $expected", ({ a, b, expected }) => {
    expect(overlaps(a, b)).toBe(expected)
  })
})

describe("overlapCount", () => {
  it.each([
    { a: { start: 1, end: 5 }, b: { start: 3, end: 7 }, expected: 3 },
    { a: { start: 1, end: 5 }, b: { start: 6, end: 8 }, expected: 0 },
    { a: { start: 1, end: 3 }, b: { start: 1, end: 3 }, expected: 3 },
  ])("$a.start-$a.end vs $b.start-$b.end => $expected", ({ a, b, expected }) => {
    expect(overlapCount(a, b)).toBe(expected)
  })
})

describe("overlapRatio", () => {
  it.each([
    { a: { start: 1, end: 5 }, b: { start: 1, end: 5 }, expected: 1 },
    { a: { start: 1, end: 5 }, b: { start: 2, end: 4 }, expected: 1 },
    { a: { start: 1, end: 4 }, b: { start: 3, end: 6 }, expected: 0.5 },
    { a: { start: 1, end: 3 }, b: { start: 5, end: 7 }, expected: 0 },
  ])("$a.start-$a.end vs $b.start-$b.end => $expected", ({ a, b, expected }) => {
    expect(overlapRatio(a, b)).toBeCloseTo(expected, 5)
  })
})

interface Span {
  start: number
  end: number
  label: string
}

const span = (start: number, end: number, label = ""): Span => ({ start, end, label })

describe("collapseRunsByOverlap", () => {
  it("empty runs yields empty result", () => {
    expect(collapseRunsByOverlap<Span>([], 0.8)).toEqual([])
  })

  it("single run keeps all spans with single vote", () => {
    const result = collapseRunsByOverlap([[span(1, 3, "a"), span(5, 7, "b")]], 0.8)
    expect(result).toEqual([
      { span: span(1, 3, "a"), votes: [true] },
      { span: span(5, 7, "b"), votes: [true] },
    ])
  })

  it("exact-match across two runs collapses with both votes", () => {
    const result = collapseRunsByOverlap([[span(1, 5, "a")], [span(1, 5, "b")]], 0.8)
    expect(result).toHaveLength(1)
    expect(result[0].votes).toEqual([true, true])
    expect(result[0].span.start).toBe(1)
    expect(result[0].span.end).toBe(5)
  })

  it("partial overlap above threshold collapses to smaller span", () => {
    const result = collapseRunsByOverlap([[span(1, 5, "big")], [span(2, 4, "small")]], 0.8)
    expect(result).toHaveLength(1)
    expect(result[0].span.label).toBe("small")
    expect(result[0].votes).toEqual([true, true])
  })

  it("overlap below threshold keeps both with single vote each", () => {
    const result = collapseRunsByOverlap([[span(1, 5, "a")], [span(4, 9, "b")]], 0.8)
    expect(result).toHaveLength(2)
    const labels = result.map((r) => r.span.label).sort()
    expect(labels).toEqual(["a", "b"])
    for (const r of result) {
      expect(r.votes.filter(Boolean)).toHaveLength(1)
    }
  })

  it("non-overlapping spans across runs both kept with single vote", () => {
    const result = collapseRunsByOverlap([[span(1, 3, "a")], [span(10, 12, "b")]], 0.8)
    expect(result).toHaveLength(2)
  })

  it("three runs pairwise — pairs run0+run1, leaves run2 solo when below threshold", () => {
    const result = collapseRunsByOverlap(
      [[span(1, 5, "r0")], [span(1, 5, "r1")], [span(20, 25, "r2")]],
      0.8
    )
    expect(result).toHaveLength(2)
    const paired = result.find((r) => r.votes[0] && r.votes[1])
    const solo = result.find((r) => r.votes[2] && !r.votes[0])
    expect(paired).toBeDefined()
    expect(solo).toBeDefined()
  })
})

describe("dedupOverlapping", () => {
  it("empty input yields empty", () => {
    expect(dedupOverlapping<Span>([])).toEqual([])
  })

  it("non-overlapping spans pass through", () => {
    const items = [span(1, 3, "a"), span(5, 7, "b"), span(10, 12, "c")]
    expect(dedupOverlapping(items)).toEqual(items)
  })

  it("overlapping spans — smallest survives", () => {
    const items = [span(1, 10, "big"), span(3, 5, "small")]
    const result = dedupOverlapping(items)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe("small")
  })

  it("tie on size — earliest start wins among overlapping", () => {
    const items = [span(3, 6, "later"), span(1, 4, "earlier")]
    const result = dedupOverlapping(items)
    expect(result.map((r) => r.label)).toEqual(["earlier"])
  })

  it("preserves original order of survivors", () => {
    const items = [span(10, 12, "c"), span(1, 3, "a"), span(5, 7, "b")]
    expect(dedupOverlapping(items)).toEqual(items)
  })
})
