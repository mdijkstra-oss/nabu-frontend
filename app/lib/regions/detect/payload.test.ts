import { describe, it, expect } from "vitest"
import { renderNumberedSentences, toModelNumber, toSentenceIndex } from "./payload"

describe("the model numbering boundary", () => {
  const cases: { sentenceIndex: number; modelNumber: number }[] = [
    { sentenceIndex: 0, modelNumber: 1 },
    { sentenceIndex: 1, modelNumber: 2 },
    { sentenceIndex: 12, modelNumber: 13 },
    { sentenceIndex: 41, modelNumber: 42 },
  ]

  it.each(cases)(
    "renders array position $sentenceIndex as $modelNumber",
    ({ sentenceIndex, modelNumber }) => {
      expect(toModelNumber(sentenceIndex)).toBe(modelNumber)
    }
  )

  it.each(cases)(
    "parses model number $modelNumber back to array position $sentenceIndex",
    ({ sentenceIndex, modelNumber }) => {
      expect(toSentenceIndex(modelNumber)).toBe(sentenceIndex)
    }
  )
})

describe("renderNumberedSentences", () => {
  it("numbers a unit's first line by its absolute array position", () => {
    const rendered = renderNumberedSentences(["First.", "Second."], 12)
    expect(rendered.split("\n")).toEqual(["[13] First.", "[14] Second."])
  })

  it("numbers a unit starting at the document's first sentence from 1", () => {
    expect(renderNumberedSentences(["Only one."], 0)).toBe("[1] Only one.")
  })

  it("renders one line per sentence and never re-splits them", () => {
    const sentences = ["A short one. With a second clause inside it.", "Another."]
    expect(renderNumberedSentences(sentences, 0).split("\n")).toHaveLength(2)
  })
})
