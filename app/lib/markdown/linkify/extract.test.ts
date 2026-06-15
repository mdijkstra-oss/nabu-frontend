import { describe, test, expect } from "vitest"
import { extractEntityIdCandidates } from "./extract"

describe("extractEntityIdCandidates", () => {
  const cases = [
    {
      name: "no candidates in plain text",
      input: "This is a normal message with no IDs",
      expected: [],
    },
    {
      name: "bare annotation ID",
      input: "See annotation-1a2b3c4d for details",
      expected: ["annotation-1a2b3c4d"],
    },
    {
      name: "bare callout ID",
      input: "Check callout-7xk2m9p1 here",
      expected: ["callout-7xk2m9p1"],
    },
    {
      name: "ID inside markdown link",
      input: "See [frustration](file://annotation-1a2b3c4d) for details",
      expected: ["annotation-1a2b3c4d"],
    },
    {
      name: "multiple different IDs",
      input: "Compare annotation-1a2b3c4d and callout-7xk2m9p1",
      expected: ["annotation-1a2b3c4d", "callout-7xk2m9p1"],
    },
    {
      name: "duplicate IDs deduplicated",
      input: "See annotation-1a2b3c4d and again annotation-1a2b3c4d",
      expected: ["annotation-1a2b3c4d"],
    },
    {
      name: "captures valid base with underscore junk (dangling)",
      input: "Found annotation-1a2b3c4d_frustration here",
      expected: ["annotation-1a2b3c4d_frustration"],
    },
    {
      name: "captures valid base with dash junk (dangling)",
      input: "Found callout-7xk2m9p1-code-123 here",
      expected: ["callout-7xk2m9p1-code-123"],
    },
    {
      name: "ignores token without a valid base",
      input: "Found annotation-userfrust here",
      expected: [],
    },
    {
      name: "ID at end of sentence with period",
      input: "See annotation-1bc23456.",
      expected: ["annotation-1bc23456"],
    },
    {
      name: "ID in parentheses",
      input: "(annotation-1bc23456)",
      expected: ["annotation-1bc23456"],
    },
    {
      name: "ID in backticks",
      input: "Use `annotation-1bc23456` here",
      expected: ["annotation-1bc23456"],
    },
    {
      name: "ignores bare prefix without suffix",
      input: "The annotation- prefix is used",
      expected: [],
    },
    {
      name: "ID in code block",
      input: '```json\n{"id": "annotation-1bc23456"}\n```',
      expected: ["annotation-1bc23456"],
    },
  ] as const

  test.each(cases)("$name", ({ input, expected }) => {
    expect(extractEntityIdCandidates(input)).toEqual(expected)
  })
})
