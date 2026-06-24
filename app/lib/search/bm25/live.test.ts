import { describe, it, expect, beforeEach } from "vitest"
import { replaceFile, resetBm25, type Bm25Doc } from "./store"
import { searchBm25Live } from "./live"

const doc = (id: string, file: string, text: string): Bm25Doc => ({
  id,
  file,
  text,
  chunkStart: 0,
  chunkEnd: text.length,
  language: "markdown",
})

beforeEach(() => resetBm25())

describe("searchBm25Live", () => {
  it("returns hits across multiple languages", () => {
    replaceFile("markdown", "a.md", [doc("h1", "a.md", "sunday morning coffee")])
    replaceFile("notes", "b.md", [{ ...doc("h2", "b.md", "sunday booth eggs"), language: "notes" }])
    const hits = searchBm25Live("sunday", 10)
    expect(hits.map((h) => h.file).sort()).toEqual(["a.md", "b.md"])
  })

  it("scopes to the given files", () => {
    replaceFile("markdown", "a.md", [doc("h1", "a.md", "sunday morning")])
    replaceFile("markdown", "b.md", [doc("h2", "b.md", "sunday booth")])
    expect(searchBm25Live("sunday", 10, ["a.md"]).map((h) => h.file)).toEqual(["a.md"])
  })

  it("empty scope (files with no chunks) returns nothing", () => {
    replaceFile("markdown", "a.md", [doc("h1", "a.md", "sunday morning")])
    expect(searchBm25Live("sunday", 10, ["ghost.md"])).toEqual([])
  })

  it("blank query returns nothing", () => {
    replaceFile("markdown", "a.md", [doc("h1", "a.md", "sunday")])
    expect(searchBm25Live("   ", 10)).toEqual([])
  })
})
