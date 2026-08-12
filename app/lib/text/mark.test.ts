import { describe, it, expect } from "vitest"
import { readCorpus } from "./fixtures/corpus"
import { markMarkdown, neutralizeMarkdown, MARK_SENTINEL } from "./mark"

const corpus = readCorpus()

describe("markMarkdown length invariant", () => {
  const constructs: { name: string; input: string }[] = [
    { name: "image", input: "![alt text](image.png)" },
    { name: "link", input: "see [docs](https://example.com/a.b.c)" },
    { name: "bold", input: "this is **bold** text" },
    { name: "italic asterisk", input: "this is *italic* text" },
    { name: "italic underscore", input: "this is _italic_ text" },
    { name: "strikethrough", input: "~~removed~~ text" },
    { name: "inline code", input: "use `myFunc()` here" },
    { name: "bullet marker", input: "- first item\n* second item\n+ third item" },
    { name: "numbered marker", input: "1. first\n2. second\n3. third" },
    { name: "blockquote marker", input: "> quoted text\n> more of it" },
    { name: "table separator row", input: "| h1 | h2 |\n|---|---|\n| a | b |" },
    { name: "table outer pipes", input: "| a | b |" },
    { name: "heading", input: "## My Heading" },
  ]

  it.each(constructs)("$name is marked and keeps its length", ({ input }) => {
    const marked = markMarkdown(input)
    expect(marked).toContain(MARK_SENTINEL)
    expect(marked.length).toBe(input.length)
    expect(neutralizeMarkdown(input).length).toBe(input.length)
  })

  it.each(corpus)("$name keeps its length", ({ raw }) => {
    expect(markMarkdown(raw).length).toBe(raw.length)
    expect(neutralizeMarkdown(raw).length).toBe(raw.length)
    expect(markMarkdown(raw, { keepHeadings: true }).length).toBe(raw.length)
  })

  it("marking twice is the same as marking once", () => {
    for (const { raw } of corpus) {
      expect(markMarkdown(neutralizeMarkdown(raw)).length).toBe(raw.length)
    }
  })
})

describe("markMarkdown with a sentinel in the input", () => {
  const input = `a ${MARK_SENTINEL} b **bold**`

  it("keeps the length", () => {
    expect(markMarkdown(input).length).toBe(input.length)
  })

  it("leaves a space where the input sentinel was, not a hole", () => {
    expect(neutralizeMarkdown(input)).toBe("a   b   bold  ")
  })

  it("marks only markup, so the input sentinel is not read back as one", () => {
    const marked = markMarkdown(input)
    expect(marked[2]).toBe(" ")
    expect(marked.indexOf(MARK_SENTINEL)).toBe(6)
  })
})
