import { describe, it, expect } from "vitest"
import { locateSelectionInFile, formatSelectionContext } from "./selection-context"
import type { FileSelectionRange } from "./selection-context"
import type { EditorSelection } from "./selection-store"

const sel = (text: string, from = 0, to = text.length): EditorSelection => ({
  text,
  from,
  to,
  filePath: null,
  context: null,
})

const fiveLineDoc = "line one\nline two\nline three\nline four\nline five"

const hundredLineDoc = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n")
const twentyFiveLineSelection = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n")

describe("locateSelectionInFile", () => {
  const cases: {
    name: string
    selectionText: string
    filePath: string
    fileContent: string
    expected: FileSelectionRange | null
  }[] = [
    {
      name: "exact match on single line",
      selectionText: "line two",
      filePath: "notes/interview.md",
      fileContent: fiveLineDoc,
      expected: {
        filePath: "notes/interview.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "line two", startOffset: 9, endOffset: 17 },
        fullWords: { text: "line two", startOffset: 9, endOffset: 17 },
      },
    },
    {
      name: "exact match spanning multiple lines",
      selectionText: "line two\nline three",
      filePath: "data/doc.md",
      fileContent: fiveLineDoc,
      expected: {
        filePath: "data/doc.md",
        startLine: 1,
        endLine: 2,
        exact: { text: "line two\nline three", startOffset: 9, endOffset: 28 },
        fullWords: { text: "line two\nline three", startOffset: 9, endOffset: 28 },
      },
    },
    {
      name: "prosemirror strips markdown → fuzzy match succeeds",
      selectionText: "bold text and italic words",
      filePath: "memo.md",
      fileContent: "some intro\n**bold text** and *italic words*\nsome outro",
      expected: {
        filePath: "memo.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "**bold text** and *italic words*", startOffset: 11, endOffset: 43 },
        fullWords: { text: "**bold text** and *italic words*", startOffset: 11, endOffset: 43 },
      },
    },
    {
      name: "no match → null",
      selectionText: "this text does not exist anywhere in the document",
      filePath: "gone.md",
      fileContent: fiveLineDoc,
      expected: null,
    },
    {
      name: "match at start of file",
      selectionText: "line one",
      filePath: "top.md",
      fileContent: fiveLineDoc,
      expected: {
        filePath: "top.md",
        startLine: 0,
        endLine: 0,
        exact: { text: "line one", startOffset: 0, endOffset: 8 },
        fullWords: { text: "line one", startOffset: 0, endOffset: 8 },
      },
    },
    {
      name: "match at end of file",
      selectionText: "line five",
      filePath: "bottom.md",
      fileContent: fiveLineDoc,
      expected: {
        filePath: "bottom.md",
        startLine: 4,
        endLine: 4,
        exact: { text: "line five", startOffset: 39, endOffset: 48 },
        fullWords: { text: "line five", startOffset: 39, endOffset: 48 },
      },
    },
    {
      name: "selection spans across a data block",
      selectionText: "before the block after the block",
      filePath: "annotated.md",
      fileContent: [
        "before the block",
        "```annotations",
        '{"codes":["c1"]}',
        "```",
        "after the block",
      ].join("\n"),
      expected: {
        filePath: "annotated.md",
        startLine: 0,
        endLine: 4,
        exact: {
          text: [
            "before the block",
            "```annotations",
            '{"codes":["c1"]}',
            "```",
            "after the block",
          ].join("\n"),
          startOffset: 0,
          endOffset: 68,
        },
        fullWords: {
          text: [
            "before the block",
            "```annotations",
            '{"codes":["c1"]}',
            "```",
            "after the block",
          ].join("\n"),
          startOffset: 0,
          endOffset: 68,
        },
      },
    },
  ]

  it.each(cases)("$name", ({ selectionText, filePath, fileContent, expected }) => {
    expect(locateSelectionInFile(selectionText, filePath, fileContent)).toEqual(expected)
  })
})

const repeatedDoc = [
  "The cat sat on the mat.",
  "The dog chased the cat around.",
  "The cat slept by the window.",
  "Birds watched the cat from outside.",
].join("\n")

describe("locateSelectionInFile with context", () => {
  const cases: {
    name: string
    selectionText: string
    context?: string
    filePath: string
    fileContent: string
    expected: FileSelectionRange | null
  }[] = [
    {
      name: "short selection disambiguated by context → second occurrence",
      selectionText: "cat",
      context: "dog chased the cat around",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "cat", startOffset: 43, endOffset: 46 },
        fullWords: { text: "cat", startOffset: 43, endOffset: 46 },
      },
    },
    {
      name: "short selection disambiguated by context → third occurrence",
      selectionText: "cat",
      context: "cat slept by the window",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 2,
        endLine: 2,
        exact: { text: "cat", startOffset: 59, endOffset: 62 },
        fullWords: { text: "cat", startOffset: 59, endOffset: 62 },
      },
    },
    {
      name: "long selection without context matches directly",
      selectionText: "alpha bravo charlie delta echo foxtrot golf hotel",
      context: undefined,
      filePath: "long.md",
      fileContent: "alpha bravo charlie delta echo foxtrot golf hotel india",
      expected: {
        filePath: "long.md",
        startLine: 0,
        endLine: 0,
        exact: {
          text: "alpha bravo charlie delta echo foxtrot golf hotel",
          startOffset: 0,
          endOffset: 49,
        },
        fullWords: {
          text: "alpha bravo charlie delta echo foxtrot golf hotel",
          startOffset: 0,
          endOffset: 49,
        },
      },
    },
    {
      name: "long selection with unmatched context returns null",
      selectionText: "alpha bravo charlie delta echo foxtrot golf hotel",
      context: "ignored context",
      filePath: "long.md",
      fileContent: "alpha bravo charlie delta echo foxtrot golf hotel india",
      expected: null,
    },
    {
      name: "no context provided for short selection → first match",
      selectionText: "cat",
      context: undefined,
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 0,
        endLine: 0,
        exact: { text: "cat", startOffset: 4, endOffset: 7 },
        fullWords: { text: "cat", startOffset: 4, endOffset: 7 },
      },
    },
    {
      name: "context not found in file → null",
      selectionText: "cat",
      context: "entirely unrelated words that appear nowhere",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: null,
    },
    {
      name: "partial start word with context narrows to correct region",
      selectionText: "og chased the cat",
      context: "The dog chased the cat around",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "og chased the cat", startOffset: 29, endOffset: 46 },
        fullWords: { text: "dog chased the cat", startOffset: 28, endOffset: 46 },
      },
    },
    {
      name: "partial end word with context",
      selectionText: "dog chased the ca",
      context: "The dog chased the cat around",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "dog chased the ca", startOffset: 28, endOffset: 45 },
        fullWords: { text: "dog chased the cat", startOffset: 28, endOffset: 46 },
      },
    },
    {
      name: "both edges partial with context",
      selectionText: "og chased the ca",
      context: "The dog chased the cat around",
      filePath: "animals.md",
      fileContent: repeatedDoc,
      expected: {
        filePath: "animals.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "og chased the ca", startOffset: 29, endOffset: 45 },
        fullWords: { text: "dog chased the cat", startOffset: 28, endOffset: 46 },
      },
    },
    {
      name: "partial edges with markdown formatting in source",
      selectionText: "old text and ital",
      context: "some intro bold text and italic words some outro",
      filePath: "memo.md",
      fileContent: "some intro\n**bold text** and *italic words*\nsome outro",
      expected: {
        filePath: "memo.md",
        startLine: 1,
        endLine: 1,
        exact: { text: "old text** and *ital", startOffset: 14, endOffset: 34 },
        fullWords: { text: "**bold text** and *italic", startOffset: 11, endOffset: 36 },
      },
    },
  ]

  it.each(cases)("$name", ({ selectionText, context, filePath, fileContent, expected }) => {
    expect(locateSelectionInFile(selectionText, filePath, fileContent, context)).toEqual(expected)
  })
})

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
