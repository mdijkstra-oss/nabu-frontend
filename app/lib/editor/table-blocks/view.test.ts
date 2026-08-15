import { describe, it, expect } from "vitest"
import { formatCaption } from "~/lib/data-blocks/caption"

// The card only ever receives the finished string, so nothing at the card layer
// can reach either branch of the numbering.
describe("formatCaption", () => {
  const cases = [
    { name: "numbers a captioned block", type: "Table", index: 2, expected: "Table 2: Expenses" },
    { name: "drops the prefix at index zero", type: "Table", index: 0, expected: "Expenses" },
    { name: "drops the prefix without a type", type: undefined, index: 3, expected: "Expenses" },
  ]

  it.each(cases)("$name", ({ type, index, expected }) => {
    expect(formatCaption(type, index, "Expenses")).toBe(expected)
  })
})
