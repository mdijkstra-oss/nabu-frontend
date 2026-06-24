import { describe, it, expect } from "vitest"
import {
  toggleSelectedDoc,
  selectionState,
  addIds,
  removeIds,
  getSelectedDocsOrdered,
  getSelectedDocs,
  selectedFiles,
} from "./selectors"
import { SETTINGS_FILE } from "~/lib/files/filename"

const withSelection = (docs: string[]): Record<string, string> => ({
  [SETTINGS_FILE]: "```json-ux\n" + JSON.stringify({ selectedDocs: docs }) + "\n```\n",
})

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

describe("getSelectedDocsOrdered", () => {
  it("preserves stored order (the Set getter does not)", () => {
    const files = withSelection(["c.md", "a.md", "b.md"])
    expect(getSelectedDocsOrdered(files)).toEqual(["c.md", "a.md", "b.md"])
    expect(getSelectedDocs(files).has("a.md")).toBe(true)
  })

  it("is empty when there is no ux block", () => {
    expect(getSelectedDocsOrdered({})).toEqual([])
  })
})

describe("selectedFiles", () => {
  const files = withSelection(["b.md", "c.md"])

  it("puts the current file first without duplicating it", () => {
    expect(selectedFiles(files, "c.md")).toEqual(["c.md", "b.md"])
  })

  it("prepends a current file that is not in the selection", () => {
    expect(selectedFiles(files, "a.md")).toEqual(["a.md", "b.md", "c.md"])
  })

  it("falls back to the ordered selection when there is no current file", () => {
    expect(selectedFiles(files, null)).toEqual(["b.md", "c.md"])
  })
})
