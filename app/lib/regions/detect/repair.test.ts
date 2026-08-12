import { describe, it, expect } from "vitest"
import { repairRange, type RepairTarget } from "./repair"

const target = (over: Partial<RepairTarget> = {}): RepairTarget => ({
  hitSentence: 10,
  windowStart: 5,
  windowEnd: 20,
  ...over,
})

describe("repairRange", () => {
  const cases: {
    name: string
    result: { start: number; end: number }
    expected: { startSentence: number; endSentence: number }
    input?: Partial<RepairTarget>
  }[] = [
    {
      name: "a range inside the window is taken as given",
      result: { start: 8, end: 14 },
      expected: { startSentence: 8, endSentence: 14 },
    },
    {
      name: "a range starting before the window is clamped to it",
      result: { start: 0, end: 14 },
      expected: { startSentence: 5, endSentence: 14 },
    },
    {
      name: "a range ending past the window is clamped to it",
      result: { start: 8, end: 39 },
      expected: { startSentence: 8, endSentence: 20 },
    },
    {
      name: "a range running backwards collapses to the hit's own sentence",
      result: { start: 15, end: 8 },
      expected: { startSentence: 10, endSentence: 10 },
    },
    {
      name: "a range that starts after the hit expands back to include it",
      result: { start: 14, end: 17 },
      expected: { startSentence: 10, endSentence: 17 },
    },
    {
      name: "a range that ends before the hit expands forward to include it",
      result: { start: 5, end: 7 },
      expected: { startSentence: 5, endSentence: 10 },
    },
    {
      name: "a range covering the whole window survives it",
      result: { start: 5, end: 20 },
      expected: { startSentence: 5, endSentence: 20 },
    },
    {
      name: "a window of one sentence admits only that sentence",
      result: { start: 0, end: 39 },
      expected: { startSentence: 10, endSentence: 10 },
      input: { windowStart: 10, windowEnd: 10 },
    },
  ]

  it.each(cases)("$name", ({ result, expected, input }) => {
    expect(repairRange(target(input), result)).toEqual(expected)
  })

  it("never returns a range that excludes its own hit sentence", () => {
    for (let start = 0; start <= 21; start++) {
      for (let end = 0; end <= 21; end++) {
        const range = repairRange(target(), { start, end })
        expect(range.startSentence).toBeLessThanOrEqual(10)
        expect(range.endSentence).toBeGreaterThanOrEqual(10)
      }
    }
  })
})
