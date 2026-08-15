import { describe, it, expect } from "vitest"
import {
  rowLineToBlock,
  shouldConvertOnEnter,
  splitRowCells,
  type EnterLine,
} from "./convert-plugin"
import { claimConverted, markConverted } from "./conversion-meta"

describe("shouldConvertOnEnter", () => {
  const cases: { name: string; line: EnterLine; expected: boolean }[] = [
    {
      name: "a paragraph that is entirely one pipe-delimited row",
      line: { nodeType: "paragraph", text: "| Name | Age |" },
      expected: true,
    },
    {
      name: "a single-column row",
      line: { nodeType: "paragraph", text: "| Name |" },
      expected: true,
    },
    {
      name: "surrounding whitespace does not stop it",
      line: { nodeType: "paragraph", text: "  | Name | Age |  " },
      expected: true,
    },
    {
      name: "pipes inside a sentence",
      line: { nodeType: "paragraph", text: "either | or" },
      expected: false,
    },
    {
      name: "a row shape that only ends the paragraph",
      line: { nodeType: "paragraph", text: "pick one: | a | b |" },
      expected: false,
    },
    {
      name: "a row shape that only starts the paragraph",
      line: { nodeType: "paragraph", text: "| a | b | and then some prose" },
      expected: false,
    },
    {
      name: "a lone pipe has no cell",
      line: { nodeType: "paragraph", text: "|" },
      expected: false,
    },
    {
      name: "an empty paragraph",
      line: { nodeType: "paragraph", text: "" },
      expected: false,
    },
    {
      name: "a row-shaped line inside a code block",
      line: { nodeType: "code_block", text: "| Name | Age |" },
      expected: false,
    },
    {
      name: "a row-shaped heading",
      line: { nodeType: "heading", text: "| Name | Age |" },
      expected: false,
    },
  ]

  it.each(cases)("$name", ({ line, expected }) => {
    expect(shouldConvertOnEnter(line)).toBe(expected)
  })
})

describe("splitRowCells", () => {
  const cases: { name: string; text: string; expected: string[] }[] = [
    { name: "two cells", text: "| Name | Age |", expected: ["Name", "Age"] },
    { name: "cell padding is not content", text: "|   Name   |", expected: ["Name"] },
    {
      name: "an escaped pipe is one literal pipe in one cell",
      text: "| a \\| b | c |",
      expected: ["a | b", "c"],
    },
    {
      name: "inline markdown keeps its source characters",
      text: "| **bold** |",
      expected: ["**bold**"],
    },
    { name: "an empty cell", text: "| a |  | c |", expected: ["a", "", "c"] },
    {
      name: "leading and trailing whitespace around the row",
      text: "  | a | b |  ",
      expected: ["a", "b"],
    },
    { name: "a bare pair of pipes is one empty cell", text: "||", expected: [""] },
    { name: "a lone pipe is no row at all", text: "|", expected: [] },
    { name: "prose with a pipe is no row at all", text: "either | or", expected: [] },
  ]

  it.each(cases)("$name", ({ text, expected }) => {
    expect(splitRowCells(text)).toEqual(expected)
  })
})

describe("rowLineToBlock", () => {
  it("makes the typed cells the columns, all text, with one empty row", () => {
    const block = rowLineToBlock("| Name | Age |")
    expect(block.columns).toEqual([
      { key: "name", name: "Name", type: "text" },
      { key: "age", name: "Age", type: "text" },
    ])
    expect(block.rows).toEqual([{ name: "", age: "" }])
  })
})

describe("conversion focus channel", () => {
  it("hands a converted id to the first claimer and to no one after", () => {
    const block = rowLineToBlock("| Name |")
    markConverted(block.id)
    expect(claimConverted(block.id)).toBe(true)
    expect(claimConverted(block.id)).toBe(false)
  })

  it("has nothing to hand out for a block conversion never marked", () => {
    expect(claimConverted("table-unmarked")).toBe(false)
  })
})
