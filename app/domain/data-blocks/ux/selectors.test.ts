import { describe, it, expect } from "vitest"
import { toggleSelectedDoc, selectionState, addIds, removeIds } from "./selectors"

describe("toggleSelectedDoc", () => {
  interface Case {
    name: string
    docs: string[]
    id: string
    expected: string[]
  }

  const cases: Case[] = [
    { name: "adds when absent", docs: ["a"], id: "b", expected: ["a", "b"] },
    { name: "removes when present", docs: ["a", "b"], id: "a", expected: ["b"] },
    { name: "adds to empty", docs: [], id: "a", expected: ["a"] },
  ]

  it.each(cases)("$name", ({ docs, id, expected }) => {
    expect(toggleSelectedDoc(docs, id)).toEqual(expected)
  })
})

describe("selectionState", () => {
  interface Case {
    name: string
    selected: string[]
    ids: string[]
    expected: "none" | "partial" | "all"
  }

  const cases: Case[] = [
    { name: "empty group is none", selected: ["a"], ids: [], expected: "none" },
    { name: "none selected", selected: ["x"], ids: ["a", "b"], expected: "none" },
    { name: "some selected is partial", selected: ["a"], ids: ["a", "b"], expected: "partial" },
    { name: "all selected", selected: ["a", "b"], ids: ["a", "b"], expected: "all" },
  ]

  it.each(cases)("$name", ({ selected, ids, expected }) => {
    expect(selectionState(new Set(selected), ids)).toBe(expected)
  })
})

describe("addIds / removeIds", () => {
  it("adds without duplicates", () => {
    expect(addIds(["a"], ["a", "b"])).toEqual(["a", "b"])
  })

  it("removes a subset", () => {
    expect(removeIds(["a", "b", "c"], ["a", "c"])).toEqual(["b"])
  })
})
