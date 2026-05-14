import { describe, it, expect } from "vitest"
import { formatSelectionContext } from "./selection-context"
import type { EditorSelection } from "./selection-store"

const sel = (text: string, from = 0, to = text.length): EditorSelection => ({ text, from, to })

const fiveLineDoc = "line one\nline two\nline three\nline four\nline five"

const hundredLineDoc = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n")
const twentyFiveLineSelection = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n")

describe("formatSelectionContext", () => {
  const cases: {
    name: string
    selection: EditorSelection
    raw: string
    check: (r: string | null) => void
  }[] = [
    {
      name: "short selection → full content with line numbers",
      selection: sel("line two\nline three"),
      raw: fiveLineDoc,
      check: (r) => {
        expect(r).not.toBeNull()
        expect(r).toContain("lines 2-3")
        expect(r).toContain("line two")
        expect(r).toContain("line three")
      },
    },
    {
      name: "long selection → truncated with omission note",
      selection: sel(twentyFiveLineSelection),
      raw: hundredLineDoc,
      check: (r) => {
        expect(r).not.toBeNull()
        expect(r).toContain("lines omitted")
        expect(r).toContain("line 1")
        expect(r).toContain("line 25")
      },
    },
    {
      name: "nearly-entire-document selection → entire document message",
      selection: sel(fiveLineDoc),
      raw: fiveLineDoc,
      check: (r) => {
        expect(r).toBe("User selected the entire document")
      },
    },
    {
      name: "no match in raw markdown → returns null",
      selection: sel("this text does not exist anywhere in the document"),
      raw: fiveLineDoc,
      check: (r) => {
        expect(r).toBeNull()
      },
    },
    {
      name: "selection with inline markdown formatting → fuzzy match finds it",
      selection: sel("bold text and italic words"),
      raw: "some intro\n**bold text** and *italic words*\nsome outro",
      check: (r) => {
        expect(r).not.toBeNull()
        expect(r).toContain("bold text")
      },
    },
  ]

  it.each(cases)("$name", ({ selection, raw, check }) => {
    check(formatSelectionContext(selection, raw))
  })
})
