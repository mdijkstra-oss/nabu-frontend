import { describe, it, expect } from "vitest"
import { validateFences } from "./validate-fences"

describe("validateFences", () => {
  const cases: {
    name: string
    markdown: string
    expectErrors: number
    expectContains?: string
  }[] = [
    {
      name: "empty document",
      markdown: "",
      expectErrors: 0,
    },
    {
      name: "prose only, no fences",
      markdown: "# Research\n\nSome prose with {braces} and 'quotes'.",
      expectErrors: 0,
    },
    {
      name: "balanced fence pair with language tag",
      markdown: '# Doc\n\n```json-attributes\n{"tags": ["draft"]}\n```\n\nMore prose.',
      expectErrors: 0,
    },
    {
      name: "two balanced fence pairs",
      markdown: '```json-attributes\n{"a": 1}\n```\n\ntext\n\n```json-callout\n{"id": "c1"}\n```',
      expectErrors: 0,
    },
    {
      name: "fence with trailing junk after language is allowed",
      markdown: '```json-attributes something extra\n{"a": 1}\n```',
      expectErrors: 0,
    },
    {
      name: "fence with leading whitespace is allowed",
      markdown: '  ```json-attributes\n  {"a": 1}\n  ```',
      expectErrors: 0,
    },
    {
      name: "CRLF line endings balanced",
      markdown: '```json-attributes\r\n{"a": 1}\r\n```\r\n',
      expectErrors: 0,
    },
    {
      name: "unbalanced: opened but not closed",
      markdown: '# Doc\n\n```json-attributes\n{"a": 1}\n',
      expectErrors: 1,
      expectContains: "Unbalanced",
    },
    {
      name: "unbalanced: closed but not opened",
      markdown: '# Doc\n\n{"a": 1}\n```\n',
      expectErrors: 1,
      expectContains: "Unbalanced",
    },
    {
      name: "unbalanced: three fences (nested without closing)",
      markdown: '```json-attributes\n{"a": 1}\n```json-callout\n{"id": "c1"}\n```',
      expectErrors: 1,
      expectContains: "Unbalanced",
    },
    {
      name: "inline fence: prefixed with list marker",
      markdown: '- ```json-attributes\n{"a": 1}\n- ```\n',
      expectErrors: 2,
      expectContains: "inline",
    },
    {
      name: "inline fence: backticks inside prose",
      markdown: "I wrote ```foo``` in my notes\n",
      expectErrors: 1,
      expectContains: "inline",
    },
    {
      name: "inline fence: prefixed with blockquote marker",
      markdown: '> ```json-attributes\n{"a": 1}\n> ```\n',
      expectErrors: 2,
      expectContains: "inline",
    },
    {
      name: "inline stray fence plus valid pair still flags stray",
      markdown: '```json-attributes\n{"a": 1}\n```\n\nsome prose with ```inline stuff\n',
      expectErrors: 1,
      expectContains: "inline",
    },
    {
      name: "empty fence pair: opener has no language tag",
      markdown: "```\n```",
      expectErrors: 1,
      expectContains: "missing a language tag",
    },
    {
      name: "fence opener missing language with content",
      markdown: "```\nfoo\n```",
      expectErrors: 1,
      expectContains: "missing a language tag",
    },
    {
      name: "fence opener with only whitespace after backticks",
      markdown: "```   \nfoo\n```",
      expectErrors: 1,
      expectContains: "missing a language tag",
    },
    {
      name: "valid pair followed by lang-less pair flags only the lang-less opener",
      markdown: '```json-attributes\n{"a":1}\n```\n\n```\nfoo\n```',
      expectErrors: 1,
      expectContains: "missing a language tag",
    },
    {
      name: "braces in prose without fences are allowed",
      markdown: "The participant said {inaudible} and then {pause}.",
      expectErrors: 0,
    },
  ]

  it.each(cases)("$name", ({ markdown, expectErrors, expectContains }) => {
    const errors = validateFences(markdown)
    expect(errors).toHaveLength(expectErrors)
    if (expectContains && errors.length > 0) {
      expect(errors[0].message).toContain(expectContains)
    }
  })
})
