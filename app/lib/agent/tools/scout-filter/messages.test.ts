import { describe, it, expect } from "vitest"
import { numberParagraphs, buildScoutFilterMessages } from "./messages"

describe("numberParagraphs", () => {
  const cases = [
    {
      name: "splits on double newline and assigns indices",
      content: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
      expected: [
        { index: 1, text: "First paragraph.", startLine: 1, endLine: 1 },
        { index: 2, text: "Second paragraph.", startLine: 3, endLine: 3 },
        { index: 3, text: "Third paragraph.", startLine: 5, endLine: 5 },
      ],
    },
    {
      name: "multi-line paragraph spans correct lines",
      content: "Line one\nLine two\n\nLine three\nLine four\nLine five",
      expected: [
        { index: 1, text: "Line one\nLine two", startLine: 1, endLine: 2 },
        { index: 2, text: "Line three\nLine four\nLine five", startLine: 4, endLine: 6 },
      ],
    },
    {
      name: "empty content returns empty",
      content: "",
      expected: [],
    },
    {
      name: "single paragraph",
      content: "Just one block of text here.",
      expected: [{ index: 1, text: "Just one block of text here.", startLine: 1, endLine: 1 }],
    },
    {
      name: "trims empty paragraphs from split",
      content: "A\n\n\n\nB",
      expected: [
        { index: 1, text: "A", startLine: 1, endLine: 1 },
        { index: 2, text: "B", startLine: 5, endLine: 5 },
      ],
    },
  ]

  cases.forEach(({ name, content, expected }) => {
    it(name, () => expect(numberParagraphs(content)).toEqual(expected))
  })

  it("accepts custom splitter", () => {
    const lineSplitter = (text: string) =>
      text.split("\n").map((line, i) => {
        const start = text.indexOf(line, i === 0 ? 0 : undefined)
        return { text: line, start, end: start + line.length }
      })

    const result = numberParagraphs("a\nb\nc", lineSplitter)
    expect(result).toHaveLength(3)
    expect(result[0].index).toBe(1)
    expect(result[2].index).toBe(3)
  })
})

describe("buildScoutFilterMessages", () => {
  const paragraphs = [
    { index: 1, text: "First.", startLine: 1, endLine: 1 },
    { index: 2, text: "Second.", startLine: 3, endLine: 3 },
  ]

  it("produces framework + numbered paragraphs + CTA", () => {
    const messages = buildScoutFilterMessages("The framework.", paragraphs)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      type: "message",
      role: "system",
      content: "The framework.",
    })
    expect(messages[1].content).toContain("[1]\nFirst.")
    expect(messages[1].content).toContain("[2]\nSecond.")
    expect(messages[2].role).toBe("user")
  })

  it("omits framework message when framework is empty", () => {
    const messages = buildScoutFilterMessages("", paragraphs)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain("[1]\nFirst.")
    expect(messages[1].role).toBe("user")
  })
})
