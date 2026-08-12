import { describe, it, expect } from "vitest"
import type { MarkInput } from "./types"
import { repairRange } from "./repair"

const markInput = (over: Partial<MarkInput> = {}): MarkInput => ({
  kind: "speaker",
  rules: "A speaker is the person whose words a passage carries.",
  quote: "Rutte opened",
  hitSentence: 10,
  value: "rutte",
  windowStart: 5,
  windowEnd: 20,
  sentences: Array.from({ length: 16 }, (_, i) => `Sentence ${i + 5}.`),
  ...over,
})

describe("repairRange", () => {
  const cases: {
    name: string
    result: { start: number; end: number }
    expected: { startSentence: number; endSentence: number }
    input?: Partial<MarkInput>
  }[] = [
    {
      name: "a range inside the window is taken as given, one-based",
      result: { start: 9, end: 15 },
      expected: { startSentence: 8, endSentence: 14 },
    },
    {
      name: "a range starting before the window is clamped to it",
      result: { start: 1, end: 15 },
      expected: { startSentence: 5, endSentence: 14 },
    },
    {
      name: "a range ending past the window is clamped to it",
      result: { start: 9, end: 40 },
      expected: { startSentence: 8, endSentence: 20 },
    },
    {
      name: "a range running backwards collapses to the hit's own sentence",
      result: { start: 16, end: 9 },
      expected: { startSentence: 10, endSentence: 10 },
    },
    {
      name: "a range that starts after the hit expands back to include it",
      result: { start: 15, end: 18 },
      expected: { startSentence: 10, endSentence: 17 },
    },
    {
      name: "a range that ends before the hit expands forward to include it",
      result: { start: 6, end: 8 },
      expected: { startSentence: 5, endSentence: 10 },
    },
    {
      name: "a range covering the whole window survives it",
      result: { start: 6, end: 21 },
      expected: { startSentence: 5, endSentence: 20 },
    },
    {
      name: "a window of one sentence admits only that sentence",
      result: { start: 1, end: 40 },
      expected: { startSentence: 10, endSentence: 10 },
      input: { windowStart: 10, windowEnd: 10 },
    },
  ]

  it.each(cases)("$name", ({ result, expected, input }) => {
    expect(repairRange(markInput(input), result)).toEqual(expected)
  })

  it("never returns a range that excludes its own hit sentence", () => {
    for (let start = 1; start <= 22; start++) {
      for (let end = 1; end <= 22; end++) {
        const range = repairRange(markInput(), { start, end })
        expect(range.startSentence).toBeLessThanOrEqual(10)
        expect(range.endSentence).toBeGreaterThanOrEqual(10)
      }
    }
  })
})
