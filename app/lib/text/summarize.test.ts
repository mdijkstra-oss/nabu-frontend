import { describe, it, expect } from "vitest"
import { summarizeMiddle } from "./summarize"

interface Case {
  name: string
  input: string
  maxChars?: number
  expected: string
}

const SHORT = "Short label."

const SIX_SHORT_SENTENCES =
  "Alpha quick first. Bravo follows on. Charlie middle one. Delta keeps going. Echo near end. Foxtrot last one."

const LONG_FIVE_SENTENCES =
  "The first sentence introduces the topic at hand with enough words to register some length. " +
  "The second sentence continues the thought and adds further detail and clarification along the way. " +
  "The third sentence sits in the middle of the passage and should be dropped from the summary. " +
  "The fourth sentence picks up the narrative and brings it toward the conclusion. " +
  "The fifth and final sentence wraps the whole thing up with a closing remark."

const SINGLE_LONG_SENTENCE =
  "This is a single very long sentence with no internal punctuation that keeps going across many " +
  "words and clauses to demonstrate that the word boundary fallback kicks in when sentence splits " +
  "alone cannot satisfy the head and tail budget within the maximum character allowance."

const cases: Case[] = [
  { name: "empty", input: "", expected: "" },
  { name: "short unchanged", input: SHORT, expected: SHORT },
  {
    name: "six short sentences under default max unchanged",
    input: SIX_SHORT_SENTENCES,
    expected: SIX_SHORT_SENTENCES,
  },
  {
    name: "six short sentences with small max — sentence-aligned middle truncation",
    input: SIX_SHORT_SENTENCES,
    maxChars: 60,
    expected: "Alpha quick first. … Foxtrot last one.",
  },
  {
    name: "long five sentences — sentence-aligned head + tail",
    input: LONG_FIVE_SENTENCES,
    maxChars: 200,
    expected:
      "The first sentence introduces the topic at hand with enough words to register some length. … The fifth and final sentence wraps the whole thing up with a closing remark.",
  },
  {
    name: "single long sentence — word-boundary head + tail",
    input: SINGLE_LONG_SENTENCE,
    maxChars: 100,
    expected:
      "This is a single very long sentence with no … budget within the maximum character allowance.",
  },
]

describe("summarizeMiddle", () => {
  it.each(cases)("$name", ({ input, maxChars, expected }) => {
    expect(summarizeMiddle(input, maxChars)).toBe(expected)
  })
})
