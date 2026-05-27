import { describe, it, expect } from "vitest"
import { splitSentences, formatNumberedPassage, extractMatchTexts, toLetter } from "./filter-hits"

describe("splitSentences", () => {
  const cases: { name: string; text: string; expected: string[] }[] = [
    {
      name: "splits on period + space",
      text: "First sentence. Second sentence. Third.",
      expected: ["First sentence.", "Second sentence.", "Third."],
    },
    {
      name: "splits on newlines",
      text: "Line one\nLine two\nLine three",
      expected: ["Line one", "Line two", "Line three"],
    },
    {
      name: "splits on mixed boundaries",
      text: "She was tired. Really tired!\nThe next day was better. Was it?",
      expected: ["She was tired.", "Really tired!", "The next day was better.", "Was it?"],
    },
    {
      name: "filters empty segments",
      text: "Hello.\n\nWorld.",
      expected: ["Hello.", "World."],
    },
    {
      name: "single sentence stays intact",
      text: "Just one sentence here.",
      expected: ["Just one sentence here."],
    },
  ]

  it.each(cases)("$name", ({ text, expected }) => {
    expect(splitSentences(text)).toEqual(expected)
  })
})

describe("formatNumberedPassage", () => {
  const cases: { name: string; sentences: string[]; expected: string }[] = [
    {
      name: "numbers from 1",
      sentences: ["Alpha.", "Beta.", "Gamma."],
      expected: "1: Alpha.\n2: Beta.\n3: Gamma.",
    },
    {
      name: "single sentence",
      sentences: ["Only one."],
      expected: "1: Only one.",
    },
  ]

  it.each(cases)("$name", ({ sentences, expected }) => {
    expect(formatNumberedPassage(sentences)).toBe(expected)
  })
})

describe("toLetter", () => {
  const cases: { name: string; index: number; expected: string }[] = [
    { name: "0 → a", index: 0, expected: "a" },
    { name: "1 → b", index: 1, expected: "b" },
    { name: "25 → z", index: 25, expected: "z" },
    { name: "26 → aa", index: 26, expected: "aa" },
    { name: "27 → ab", index: 27, expected: "ab" },
    { name: "51 → az", index: 51, expected: "az" },
    { name: "52 → ba", index: 52, expected: "ba" },
  ]

  it.each(cases)("$name", ({ index, expected }) => {
    expect(toLetter(index)).toBe(expected)
  })
})

describe("extractMatchTexts", () => {
  const sentences = [
    "She felt overwhelmed.",
    "The deadlines were relentless.",
    "On weekends she gardened.",
    "Her manager noticed the decline.",
  ]

  const cases: {
    name: string
    groups: number[][]
    expected: string[]
  }[] = [
    {
      name: "single group → one match with joined text",
      groups: [[1, 2]],
      expected: ["She felt overwhelmed. The deadlines were relentless."],
    },
    {
      name: "multiple groups → multiple matches",
      groups: [[1], [4]],
      expected: ["She felt overwhelmed.", "Her manager noticed the decline."],
    },
    {
      name: "empty groups → empty result",
      groups: [],
      expected: [],
    },
    {
      name: "out-of-range indices are filtered",
      groups: [[0, 5, 2]],
      expected: ["The deadlines were relentless."],
    },
    {
      name: "group with all invalid indices → skipped",
      groups: [[0, 99]],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ groups, expected }) => {
    expect(extractMatchTexts(sentences, groups)).toEqual(expected)
  })

  it("drops matches with fewer than 3 words", () => {
    const short = ["Yes.", "No way.", "This has enough words here."]
    expect(extractMatchTexts(short, [[1], [2], [3]])).toEqual(["This has enough words here."])
  })

  it("word count applies to combined group, not individual sentences", () => {
    const mixed = ["Yes.", "The deadlines were relentless."]
    expect(extractMatchTexts(mixed, [[1, 2]])).toEqual(["Yes. The deadlines were relentless."])
  })
})
