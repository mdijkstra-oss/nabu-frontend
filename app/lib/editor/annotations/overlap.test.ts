import { describe, it, expect } from "vitest"
import { segmentByOverlap } from "./overlap"
import type { ResolvedAnnotation, OverlapSegment } from "./types"

const annotation = (
  index: number,
  from: number,
  to: number,
  color: string,
  dimmed?: boolean
): ResolvedAnnotation => ({ index, from, to, color, ...(dimmed ? { dimmed: true } : {}) })

describe("segmentByOverlap", () => {
  const cases: { name: string; annotations: ResolvedAnnotation[]; expected: OverlapSegment[] }[] = [
    {
      name: "one shown annotation paints its own colour",
      annotations: [annotation(0, 0, 10, "sky")],
      expected: [{ from: 0, to: 10, colors: ["sky"] }],
    },
    {
      name: "two shown annotations overlapping carry both colours",
      annotations: [annotation(0, 0, 10, "sky"), annotation(1, 5, 15, "amber")],
      expected: [
        { from: 0, to: 5, colors: ["sky"] },
        { from: 5, to: 10, colors: ["sky", "amber"] },
        { from: 10, to: 15, colors: ["amber"] },
      ],
    },
    {
      name: "a dimmed annotation keeps its span but contributes no colour",
      annotations: [annotation(0, 0, 10, "amber", true)],
      expected: [{ from: 0, to: 10, colors: [], dimmed: true }],
    },
    {
      name: "a dimmed annotation over a shown one leaves the shown colour alone",
      annotations: [annotation(0, 0, 10, "sky"), annotation(1, 5, 15, "amber", true)],
      expected: [
        { from: 0, to: 5, colors: ["sky"] },
        { from: 5, to: 10, colors: ["sky"], dimmed: true },
        { from: 10, to: 15, colors: [], dimmed: true },
      ],
    },
  ]

  it.each(cases)("$name", ({ annotations, expected }) => {
    expect(segmentByOverlap(annotations)).toEqual(expected)
  })

  it("returns nothing for no annotations", () => {
    expect(segmentByOverlap([])).toEqual([])
  })
})
