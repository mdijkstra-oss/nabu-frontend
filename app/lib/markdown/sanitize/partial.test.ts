import { describe, expect, it } from "vitest"
import {
  filterCodeBlocks,
  stripIncompleteLink,
  stripPartialEntity,
  preprocessStreaming,
} from "./partial"

describe("filterCodeBlocks", () => {
  const cases = [
    {
      name: "empty string returns empty string",
      input: "",
      expected: "",
    },
    {
      name: "plain text returns as-is",
      input: "Hello world",
      expected: "Hello world",
    },
    {
      name: "just ``` returns null",
      input: "```",
      expected: null,
    },
    {
      name: "``` with lang tag returns null",
      input: "```json",
      expected: null,
    },
    {
      name: "unclosed block with partial JSON returns null",
      input: '```json\n{"type":',
      expected: null,
    },
    {
      name: "text before unclosed block returns text",
      input: "Let me think...\n```json",
      expected: "Let me think...",
    },
    {
      name: "text before unclosed block with content returns text",
      input: 'Planning now\n```json\n{"plan":',
      expected: "Planning now",
    },
    {
      name: "complete code block returns full content",
      input: '```json\n{"done": true}\n```',
      expected: '```json\n{"done": true}\n```',
    },
    {
      name: "text with complete code block returns full content",
      input: "Here is the result:\n```json\n{}\n```",
      expected: "Here is the result:\n```json\n{}\n```",
    },
    {
      name: "complete block then more text returns full content",
      input: "```json\n{}\n```\nDone!",
      expected: "```json\n{}\n```\nDone!",
    },
    {
      name: "multiple complete blocks returns full content",
      input: "```js\ncode1\n```\n```ts\ncode2\n```",
      expected: "```js\ncode1\n```\n```ts\ncode2\n```",
    },
    {
      name: "complete block then unclosed block returns text before unclosed",
      input: '```json\n{}\n```\nNow:\n```json\n{"partial":',
      expected: "```json\n{}\n```\nNow:",
    },
    {
      name: "whitespace-only before unclosed block returns null",
      input: "   \n\n```json",
      expected: null,
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(filterCodeBlocks(input)).toBe(expected)
  })
})

describe("stripIncompleteLink", () => {
  const cases = [
    {
      name: "plain text returns as-is",
      input: "Hello world",
      expected: "Hello world",
    },
    {
      name: "complete link returns as-is",
      input: "Check [this](https://example.com) out",
      expected: "Check [this](https://example.com) out",
    },
    {
      name: "incomplete bracket only",
      input: "See [link text",
      expected: "See",
    },
    {
      name: "bracket closed but no url yet",
      input: "See [link text]",
      expected: "See",
    },
    {
      name: "bracket closed with partial url",
      input: "See [link text](https://exam",
      expected: "See",
    },
    {
      name: "text before complete link then incomplete",
      input: "Done [a](https://a.com). Now [b](https://b",
      expected: "Done [a](https://a.com). Now",
    },
    {
      name: "just an open bracket",
      input: "[",
      expected: "",
    },
    {
      name: "empty string",
      input: "",
      expected: "",
    },
    {
      name: "incomplete link after newline does not scan past it",
      input: "Line one\n[partial",
      expected: "Line one",
    },
    {
      name: "complete link on same line is fine",
      input: "Check [this](https://example.com)",
      expected: "Check [this](https://example.com)",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(stripIncompleteLink(input)).toBe(expected)
  })
})

describe("stripPartialEntity", () => {
  const cases = [
    {
      name: "plain text returns as-is",
      input: "Hello world",
      expected: "Hello world",
    },
    {
      name: "complete entity ID passes through",
      input: "See callout-1abc2def here",
      expected: "See callout-1abc2def here",
    },
    {
      name: "strips partial callout ID at end",
      input: "I coded callout-1ab",
      expected: "I coded",
    },
    {
      name: "strips callout prefix with hyphen only",
      input: "I coded callout-",
      expected: "I coded",
    },
    {
      name: "strips partial annotation ID at end",
      input: "Found annotation-12",
      expected: "Found",
    },
    {
      name: "strips partial tag ID at end",
      input: "Using tag-abc",
      expected: "Using",
    },
    {
      name: "strips partial chart ID at end",
      input: "See chart-1a2b3c",
      expected: "See",
    },
    {
      name: "strips partial search ID at end",
      input: "Run search-aabb",
      expected: "Run",
    },
    {
      name: "strips trailing .generated suffix",
      input: "See callout-1abc2def.generated",
      expected: "See callout-1abc2def",
    },
    {
      name: "strips trailing .generated.hidden suffix",
      input: "See callout-1abc2def.generated.hidden",
      expected: "See callout-1abc2def",
    },
    {
      name: "strips trailing .generated.hid partial",
      input: "See callout-1abc2def.generated.hid",
      expected: "See callout-1abc2def",
    },
    {
      name: "strips trailing .generated.hidden.m partial",
      input: "See callout-1abc2def.generated.hidden.m",
      expected: "See callout-1abc2def",
    },
    {
      name: "complete entity ID at end passes through",
      input: "See callout-1abc2def",
      expected: "See callout-1abc2def",
    },
    {
      name: "only checks last line",
      input: "Line one callout-1abc2def\nLine two is fine",
      expected: "Line one callout-1abc2def\nLine two is fine",
    },
    {
      name: "empty string returns empty",
      input: "",
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(stripPartialEntity(input)).toBe(expected)
  })
})

describe("preprocessStreaming", () => {
  const cases = [
    {
      name: "plain text passes through",
      input: "Hello",
      expected: "Hello",
    },
    {
      name: "strips incomplete code block then incomplete link",
      input: "Text [link](http",
      expected: "Text",
    },
    {
      name: "code block hides everything",
      input: "```json\n{}",
      expected: null,
    },
    {
      name: "complete content passes through",
      input: "See [this](https://a.com) for details",
      expected: "See [this](https://a.com) for details",
    },
    {
      name: "strips partial entity at end",
      input: "Now coding callout-1ab",
      expected: "Now coding",
    },
    {
      name: "strips partial hidden suffix at end",
      input: "Using callout-1abc2def.generated.hi",
      expected: "Using callout-1abc2def",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(preprocessStreaming(input)).toBe(expected)
  })
})
