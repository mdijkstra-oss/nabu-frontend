import { describe, expect, it } from "vitest"
import { stripHiddenSuffix, stripEntityQuotes } from "./strip-hidden"

describe("stripHiddenSuffix", () => {
  const cases = [
    {
      name: "plain text returns as-is",
      input: "Hello world",
      expected: "Hello world",
    },
    {
      name: "strips .generated.hidden.md suffix",
      input: "callout-1abc2def.generated.hidden.md",
      expected: "callout-1abc2def",
    },
    {
      name: "strips .generated.Hidden.md suffix",
      input: "callout-1abc2def.generated.Hidden.md",
      expected: "callout-1abc2def",
    },
    {
      name: "strips multiple occurrences",
      input:
        "I coded callout-1abc2def.generated.hidden.md and annotation-12345678.generated.hidden.md",
      expected: "I coded callout-1abc2def and annotation-12345678",
    },
    {
      name: "preserves surrounding text",
      input: "Check callout-1abc2def.generated.hidden.md for details",
      expected: "Check callout-1abc2def for details",
    },
    {
      name: "does not strip partial suffix",
      input: "callout-1abc2def.generated",
      expected: "callout-1abc2def.generated",
    },
    {
      name: "does not strip unrelated .md files",
      input: "report.md",
      expected: "report.md",
    },
    {
      name: "empty string returns empty",
      input: "",
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(stripHiddenSuffix(input)).toBe(expected)
  })
})

describe("stripEntityQuotes", () => {
  const cases = [
    {
      name: "strips double quotes around entity id",
      input: '"callout-1abc2def"',
      expected: "callout-1abc2def",
    },
    {
      name: "strips single quotes around entity id",
      input: "'callout-1abc2def'",
      expected: "callout-1abc2def",
    },
    {
      name: "strips quotes around annotation id",
      input: '"annotation-12345678"',
      expected: "annotation-12345678",
    },
    {
      name: "strips quotes around .md filename",
      input: '"codebook_general.md"',
      expected: "codebook_general.md",
    },
    {
      name: "strips single quotes around .md filename",
      input: "'report.md'",
      expected: "report.md",
    },
    {
      name: "strips multiple quoted ids in text",
      input: 'I coded "callout-1abc2def" and "annotation-12345678" today',
      expected: "I coded callout-1abc2def and annotation-12345678 today",
    },
    {
      name: "does not strip mismatched quotes",
      input: "\"callout-1abc2def'",
      expected: "\"callout-1abc2def'",
    },
    {
      name: "strips backticks around entity id",
      input: "`callout-1abc2def`",
      expected: "callout-1abc2def",
    },
    {
      name: "strips backticks around .md filename",
      input: "`report.md`",
      expected: "report.md",
    },
    {
      name: "strips double quotes around tag",
      input: '"#coding"',
      expected: "#coding",
    },
    {
      name: "strips backticks around tag",
      input: "`#coding`",
      expected: "#coding",
    },
    {
      name: "strips quotes around hyphenated tag",
      input: '"#my-tag"',
      expected: "#my-tag",
    },
    {
      name: "does not strip quotes around plain text",
      input: '"hello world"',
      expected: '"hello world"',
    },
    {
      name: "plain text returns as-is",
      input: "no quotes here",
      expected: "no quotes here",
    },
    {
      name: "empty string returns empty",
      input: "",
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(stripEntityQuotes(input)).toBe(expected)
  })
})
