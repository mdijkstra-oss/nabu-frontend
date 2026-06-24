import { describe, it, expect } from "vitest"
import {
  buildSelectionEntry,
  selectionHits,
  parseSelectionOrder,
  isSelectionSearch,
  SELECTION_KIND,
} from "./selection-search"
import type { SearchEntry } from "./types"

const files: Record<string, string> = {
  "a.md": "Alpha doc body",
  "b.md": "Beta doc body",
  "c.md": "x".repeat(5000),
}

describe("buildSelectionEntry", () => {
  it("encodes kind + order in meta and a unique, non-files sentinel sql", () => {
    const e = buildSelectionEntry(["a.md", "b.md"])
    expect(e.meta).toEqual({ kind: SELECTION_KIND, selectionOrder: "a.md\nb.md" })
    expect(e.sql).toContain("a.md")
    expect(e.sql).toContain("b.md")
    expect(e.sql).not.toMatch(/FROM\s+files\b/i)
  })

  it("differs by selection so saveNewSearch dedupe keeps distinct selections distinct", () => {
    expect(buildSelectionEntry(["a.md"]).sql).not.toBe(buildSelectionEntry(["b.md"]).sql)
  })

  it("empty selection yields a harmless always-false sentinel", () => {
    expect(buildSelectionEntry([]).sql).toBe("SELECT file FROM annotations WHERE 1=0")
  })
})

describe("selectionHits", () => {
  it("yields one hit per existing doc, in order, each carrying preview text", () => {
    const hits = selectionHits(files, ["b.md", "a.md"])
    expect(hits.map((h) => h.file)).toEqual(["b.md", "a.md"])
    expect(hits[0].text).toBe("Beta doc body")
  })

  it("keeps long/chunk-less docs and drops only missing files", () => {
    const hits = selectionHits(files, ["a.md", "ghost.md", "c.md"])
    expect(hits.map((h) => h.file)).toEqual(["a.md", "c.md"])
  })
})

describe("selection meta round-trip", () => {
  it("parseSelectionOrder reverses the encoding and isSelectionSearch detects the kind", () => {
    const entry = {
      meta: { kind: SELECTION_KIND, selectionOrder: "a.md\nb.md" },
    } as unknown as SearchEntry
    expect(parseSelectionOrder(entry)).toEqual(["a.md", "b.md"])
    expect(isSelectionSearch(entry)).toBe(true)
    expect(isSelectionSearch(undefined)).toBe(false)
  })
})
