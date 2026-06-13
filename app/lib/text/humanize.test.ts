import { describe, test, expect } from "vitest"
import { humanize } from "./humanize"

describe("humanize", () => {
  const cases: [string, string, string][] = [
    ["single word lowercase", "interview", "Interview"],
    ["multi-word hyphenated", "round-1", "Round 1"],
    ["multiple hyphens", "high-flexibility", "High Flexibility"],
    ["three words", "appeal-to-expertise", "Appeal To Expertise"],
    ["digits only", "2020", "2020"],
    ["digit prefix slug", "year-2020", "Year 2020"],
    ["already capitalized", "Interview", "Interview"],
    ["empty string", "", ""],
    ["single char", "a", "A"],
    ["digit slug", "p01", "P01"],
  ]

  test.each(cases)("%s", (_, input, expected) => {
    expect(humanize(input)).toBe(expected)
  })
})
