import { describe, it, expect } from "vitest"
import { bootLabel } from "./progress"

describe("boot label", () => {
  const cases: { name: string; progress: number; expected: string }[] = [
    {
      name: "silent before the engine window, where the phase text is real",
      progress: 0,
      expected: "",
    },
    { name: "silent at the last point of the database phase", progress: 69, expected: "" },
    {
      name: "names the first step the moment the engine window opens",
      progress: 70,
      expected: "Reading your documents...",
    },
    {
      name: "holds the first step through its slice",
      progress: 79,
      expected: "Reading your documents...",
    },
    {
      name: "moves to the second step at its boundary",
      progress: 80,
      expected: "Tagging documents...",
    },
    {
      name: "moves to the third step at its boundary",
      progress: 90,
      expected: "Finding people and dates...",
    },
    {
      name: "holds the third step to the last point below full",
      progress: 99,
      expected: "Finding people and dates...",
    },
    {
      name: "falls silent at full, leaving the closing phase text to speak",
      progress: 100,
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ progress, expected }) => {
    expect(bootLabel(progress)).toBe(expected)
  })
})
