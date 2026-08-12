import { describe, it, expect } from "vitest"
import { alignSentences } from "./align"

describe("alignSentences", () => {
  const cases: {
    name: string
    source: string[]
    editor: string[]
    expected: (number | null)[]
  }[] = [
    {
      name: "identical streams align one to one",
      source: ["First sentence.", "Second sentence."],
      editor: ["First sentence.", "Second sentence."],
      expected: [0, 1],
    },
    {
      name: "heading hashes, list markers and stray whitespace tokenize away",
      source: ["## Rutte: the opening.", "- A bullet item.", "\t- A nested item.", "|  cell  |"],
      editor: ["Rutte: the opening.", "A bullet item.", "A nested item.", "cell"],
      expected: [0, 1, 2, 3],
    },
    {
      name: "an extra editor sentence costs only itself",
      source: ["Alpha one.", "Beta two.", "Gamma three."],
      editor: ["Alpha one.", "const x = 1;", "Beta two.", "Gamma three."],
      expected: [0, 2, 3],
    },
    {
      name: "a source sentence with no counterpart is the only unaligned index",
      source: ["Alpha one.", "Alt text of an image.", "Beta two."],
      editor: ["Alpha one.", "Beta two."],
      expected: [0, null, 1],
    },
    {
      name: "repeated identical sentences align monotonically",
      source: ["Yes.", "Yes.", "Yes.", "Yes.", "Yes."],
      editor: ["Yes.", "Yes.", "Yes.", "Yes.", "Yes."],
      expected: [0, 1, 2, 3, 4],
    },
    {
      name: "a sentence that tokenizes to nothing never aligns",
      source: ["---", "Alpha one."],
      editor: ["***", "Alpha one."],
      expected: [null, 1],
    },
    {
      name: "an empty editor stream aligns nothing",
      source: ["Alpha one."],
      editor: [],
      expected: [null],
    },
    {
      name: "an empty source stream produces no rows",
      source: [],
      editor: ["Alpha one."],
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ source, editor, expected }) => {
    expect(alignSentences(source, editor)).toEqual(expected)
  })
})
