import { describe, it, expect } from "vitest"
import { readCorpus } from "./fixtures/corpus"
import { stripMarkdown } from "./strip"
import { MARK_SENTINEL } from "./mark"

const corpus = readCorpus()

describe("stripMarkdown", () => {
  const cases: { name: string; input: string; expected: string; keepHeadings?: boolean }[] = [
    { name: "bold", input: "this is **bold** text", expected: "this is bold text" },
    {
      name: "italic with asterisk",
      input: "this is *italic* text",
      expected: "this is italic text",
    },
    {
      name: "italic with underscore",
      input: "this is _italic_ text",
      expected: "this is italic text",
    },
    { name: "link", input: "see [docs](https://example.com)", expected: "see docs" },
    { name: "heading stripped", input: "## My Heading", expected: "My Heading" },
    { name: "h3 heading", input: "### Sub Heading", expected: "Sub Heading" },
    { name: "list item dash", input: "- first item", expected: "first item" },
    { name: "list item asterisk", input: "* second item", expected: "second item" },
    { name: "inline code", input: "use `myFunc()` here", expected: "use myFunc() here" },
    { name: "strikethrough", input: "~~removed~~ text", expected: "removed text" },
    { name: "plain text unchanged", input: "just plain text", expected: "just plain text" },
    {
      name: "mixed formatting",
      input: "## Title\n\nSome **bold** and [link](url) here",
      expected: "Title\n\nSome bold and link here",
    },
    {
      name: "bold italic not broken",
      input: "this is **bold** and *italic*",
      expected: "this is bold and italic",
    },
    { name: "image", input: "![alt text](image.png)", expected: "alt text" },
    { name: "image no alt", input: "![](image.png)", expected: "" },
    {
      name: "numbered list",
      input: "1. first\n2. second\n3. third",
      expected: "first\nsecond\nthird",
    },
    { name: "blockquote", input: "> quoted text", expected: "quoted text" },
    {
      name: "nested blockquote",
      input: "> first\n> second",
      expected: "first\nsecond",
    },
    {
      name: "table separator removed",
      input: "| h1 | h2 |\n|---|---|\n| a | b |",
      expected: " h1 | h2 \n\n a | b ",
    },
    {
      name: "keepHeadings true preserves headings",
      input: "## Title\n\nSome text",
      expected: "## Title\n\nSome text",
      keepHeadings: true,
    },
    {
      name: "keepHeadings true still strips bold",
      input: "## **Bold Title**\n\nSome **text**",
      expected: "## Bold Title\n\nSome text",
      keepHeadings: true,
    },
  ]

  it.each(cases)("$name", ({ input, expected, keepHeadings }) => {
    expect(stripMarkdown(input, keepHeadings ? { keepHeadings } : undefined)).toBe(expected)
  })

  it("does not delete a sentinel that was already in the input", () => {
    expect(stripMarkdown(`a ${MARK_SENTINEL} b`)).toBe("a   b")
  })
})

const stripBySequentialReplace = (text: string, options: { keepHeadings?: boolean } = {}) => {
  const replacers: [RegExp, string][] = [
    [/!\[([^\]]*)\]\([^)]+\)/g, "$1"],
    [/\*\*(.+?)\*\*/g, "$1"],
    [/~~(.+?)~~/g, "$1"],
    [/\[([^\]]+)\]\([^)]+\)/g, "$1"],
    [/`([^`]+)`/g, "$1"],
    [/(?<!\*)\*([^*]+?)\*(?!\*)|_([^_]+?)_/g, "$1$2"],
    [/^[-*+]\s+/gm, ""],
    [/^\d+\.\s+/gm, ""],
    [/^>\s?/gm, ""],
    [/^\|?[\s-:|]+\|[\s-:|]*$/gm, ""],
    [/^\|(.+)\|$/gm, "$1"],
  ]
  if (!options.keepHeadings) replacers.push([/^#{1,6}\s+/gm, ""])
  return replacers.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text
  )
}

describe("stripMarkdown matches the implementation it replaced", () => {
  const optionCases = [
    { name: "default", options: {} },
    { name: "keepHeadings", options: { keepHeadings: true } },
  ]

  const runs = corpus.flatMap(({ name, raw }) =>
    optionCases.map((o) => ({ name: `${name} — ${o.name}`, raw, options: o.options }))
  )

  it.each(runs)("$name", ({ raw, options }) => {
    expect(stripMarkdown(raw, options)).toBe(stripBySequentialReplace(raw, options))
  })
})
