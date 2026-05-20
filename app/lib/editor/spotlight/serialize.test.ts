import { describe, it, expect } from "vitest"
import { spotlightFromText, serializeSpotlightParam } from "./serialize"

describe("spotlightFromText", () => {
  const cases: { name: string; input: string; expected: string | null }[] = [
    {
      name: "empty string",
      input: "",
      expected: null,
    },
    {
      name: "whitespace only",
      input: "   ",
      expected: null,
    },
    {
      name: "plain text tokenized to lowercase",
      input: "The quick brown fox jumps over the lazy dog.",
      expected: "the quick brown fox jumps over the lazy dog",
    },
    {
      name: "picks longest sentence from multiple",
      input:
        "Short one. This is definitely the longest sentence in this text. Medium sentence here.",
      expected: "this is definitely the longest sentence in this text",
    },
    {
      name: "strips markdown bold and italic",
      input: "This is **bold** and *italic* text in a sentence.",
      expected: "this is bold and italic text in a sentence",
    },
    {
      name: "strips markdown headings",
      input: "## Heading\n\nA longer sentence that should be picked as the spotlight target.",
      expected: "a longer sentence that should be picked as the spotlight target",
    },
    {
      name: "strips markdown links",
      input: "See [this article](https://example.com) for a detailed explanation of the topic.",
      expected: "see this article for a detailed explanation of the topic",
    },
    {
      name: "strips annotation blocks before splitting",
      input:
        'The real content sentence is here.\n\n```json-annotations\n{"annotations":[{"text":"foo"}]}\n```',
      expected: "the real content sentence is here",
    },
    {
      name: "annotation block with longer prose",
      input:
        'Short. This is the meaningful sentence that carries the actual search result context.\n\n```json-annotations\n{"annotations":[{"text":"something really long that would otherwise win"}]}\n```',
      expected: "this is the meaningful sentence that carries the actual search result context",
    },
    {
      name: "only annotation block",
      input: '```json-annotations\n{"annotations":[]}\n```',
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    const result = spotlightFromText(input)
    if (expected === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toEqual({ type: "single", text: expected })
    }
  })
})

describe("serializeSpotlightParam", () => {
  const cases: {
    name: string
    input: Parameters<typeof serializeSpotlightParam>[0]
    expected: string
  }[] = [
    {
      name: "single spotlight with spaces to plus",
      input: { type: "single", text: "hello world" },
      expected: "hello+world",
    },
    {
      name: "range spotlight with spaces to plus",
      input: { type: "range", from: "start text", to: "end text" },
      expected: "start+text...end+text",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(serializeSpotlightParam(input)).toBe(expected)
  })
})
