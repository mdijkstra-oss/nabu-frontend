import { describe, it, expect } from "vitest"
import { validateMarkdownBlocks, validateStructural, validateSemantic } from "./validate"
import { extractProse } from "./parse"

describe("extractProse", () => {
  const cases = [
    {
      name: "removes code blocks from markdown",
      markdown: "Hello\n\n```json\n{}\n```\n\nWorld",
      expected: "Hello\n\n\n\nWorld",
    },
    {
      name: "handles multiple code blocks",
      markdown: "A\n```js\ncode\n```\nB\n```py\nmore\n```\nC",
      expected: "A\n\nB\n\nC",
    },
    {
      name: "returns full text when no code blocks",
      markdown: "Just plain text",
      expected: "Just plain text",
    },
  ]

  it.each(cases)("$name", ({ markdown, expected }) => {
    expect(extractProse(markdown)).toBe(expected)
  })
})

describe("validateMarkdownBlocks", () => {
  describe("cross-file id refs (delegated to pending-refs)", () => {
    // Schema no longer enforces code/tag existence — pending-refs system owns cross-file
    // resolution and boot-time orphan reporting. Schema only checks shape.
    const cases = [
      {
        name: "accepts annotation referencing any code id (existence is pending-refs concern)",
        markdown: `# Test\n\n\`\`\`json-annotations\n{"annotations": [{"text": "t", "reason": "r", "code": "anything"}]}\n\`\`\``,
      },
      {
        name: "accepts document with any tag id (existence is pending-refs concern)",
        markdown: `# Doc\n\n\`\`\`json-attributes\n{"tags": ["tag-anything"]}\n\`\`\``,
      },
    ]

    it.each(cases)("$name", ({ markdown }) => {
      const result = validateMarkdownBlocks(markdown, {
        context: { availableCodes: [], availableTags: [] },
      })
      expect(result.valid).toBe(true)
    })
  })

  describe("currentBlock in errors", () => {
    const calloutJson = (id: string, title: string, color: string) =>
      `{"id": "${id}", "type": "codebook-code", "title": "${title}", "color": "${color}", "content": "desc", "collapsed": false}`

    type Result = ReturnType<typeof validateMarkdownBlocks>
    interface Case {
      name: string
      original: string
      patched: string
      check: (r: Result) => void
    }

    const cases: Case[] = [
      {
        name: "includes original block content in error when validation fails",
        original: `# Test

\`\`\`json-annotations
{"annotations": [{"text": "old one", "reason": "original", "code": "abc"}]}
\`\`\``,
        patched: `# Test

\`\`\`json-annotations
{"annotations": "shape failure at root, not recoverable"}
\`\`\``,
        check: (r) => {
          expect(r.errors[0].currentBlock).toContain("old one")
          expect(r.errors[0].currentBlock).not.toContain("shape failure")
        },
      },
      {
        name: "matches blocks by id for non-singleton blocks",
        original: [
          "# Test",
          "",
          "```json-callout",
          calloutJson("first", "First", "red"),
          "```",
          "",
          "```json-callout",
          calloutJson("second", "Second", "blue"),
          "```",
        ].join("\n"),
        patched: [
          "# Test",
          "",
          "```json-callout",
          calloutJson("first", "First", "red"),
          "```",
          "",
          "```json-callout",
          '{"id": "second", "type": "INVALID"}',
          "```",
        ].join("\n"),
        check: (r) => {
          const secondBlockErrors = r.errors.filter((e) => e.currentBlock?.includes("Second"))
          expect(secondBlockErrors.length).toBeGreaterThan(0)
        },
      },
      {
        name: "errors when non-singleton block missing id",
        original: ["# Test", "", "```json-callout", calloutJson("abc", "Test", "red"), "```"].join(
          "\n"
        ),
        patched: ["# Test", "", "```json-callout", '{"type": "INVALID"}', "```"].join("\n"),
        check: (r) => {
          const missingIdError = r.errors.find((e) => e.message.includes("missing identifier"))
          expect(missingIdError).toBeDefined()
        },
      },
      {
        name: "matches by id even when block order changes",
        original: [
          "```json-callout",
          calloutJson("aaa", "AAA", "red"),
          "```",
          "",
          "```json-callout",
          calloutJson("bbb", "BBB", "blue"),
          "```",
        ].join("\n"),
        patched: [
          "```json-callout",
          '{"id": "bbb", "type": "INVALID"}',
          "```",
          "",
          "```json-callout",
          calloutJson("aaa", "AAA", "red"),
          "```",
        ].join("\n"),
        check: (r) => {
          const errorWithCurrentBlock = r.errors.find((e) => e.currentBlock)
          expect(errorWithCurrentBlock?.currentBlock).toContain("BBB")
          expect(errorWithCurrentBlock?.currentBlock).not.toContain("AAA")
        },
      },
    ]

    it.each(cases)("$name", ({ original, patched, check }) => {
      const result = validateMarkdownBlocks(patched, { original })
      expect(result.valid).toBe(false)
      check(result)
    })
  })

  describe("file constraint validation", () => {
    const settingsBlock = `\`\`\`json-settings\n{"tags": [], "searches": [], "corpusDescriptions": []}\n\`\`\``

    const cases = [
      {
        name: "accepts json-settings in settings.hidden.md",
        markdown: `# Settings\n\n${settingsBlock}`,
        path: "settings.hidden.md" as string | undefined,
        expectValid: true,
      },
      {
        name: "rejects json-settings in other files",
        markdown: `# Doc\n\n${settingsBlock}`,
        path: "some_doc.md" as string | undefined,
        expectValid: false,
        expectErrorContains: "can only exist in",
      },
      {
        name: "allows json-attributes in any file",
        markdown: `# Doc\n\n\`\`\`json-attributes\n{"tags": ["tag-1"]}\n\`\`\``,
        path: "any_file.md" as string | undefined,
        expectValid: true,
      },
      {
        name: "skips constraint when no path provided",
        markdown: `# Doc\n\n${settingsBlock}`,
        path: undefined as string | undefined,
        expectValid: true,
      },
    ]

    it.each(cases)("$name", ({ markdown, path, expectValid, expectErrorContains }) => {
      const result = validateMarkdownBlocks(markdown, { path })
      expect(result.valid).toBe(expectValid)
      if (!expectValid && expectErrorContains) {
        expect(result.errors.some((e) => e.message.includes(expectErrorContains))).toBe(true)
      }
    })
  })

  describe("unknown language rejection", () => {
    const cases = [
      {
        name: "rejects unknown language",
        markdown: '# Doc\n\n```python\nprint("hi")\n```',
        expectValid: false,
        expectErrorContains: "not a known data-block language",
      },
      {
        name: "rejects mixed known + unknown",
        markdown: '```json-attributes\n{"tags": []}\n```\n\n```typescript\nconst x = 1\n```',
        expectValid: false,
        expectErrorContains: "not a known data-block language",
      },
      {
        name: "accepts known language",
        markdown: '```json-attributes\n{"tags": []}\n```',
        expectValid: true,
      },
    ]

    it.each(cases)("$name", ({ markdown, expectValid, expectErrorContains }) => {
      const result = validateMarkdownBlocks(markdown)
      expect(result.valid).toBe(expectValid)
      if (!expectValid && expectErrorContains) {
        expect(result.errors.some((e) => e.message.includes(expectErrorContains))).toBe(true)
      }
    })
  })
})

describe("validateStructural", () => {
  const cases = [
    {
      name: "passes balanced fences with valid JSON",
      markdown: '```json-attributes\n{"tags": []}\n```',
      expectErrors: 0,
    },
    {
      name: "passes empty markdown",
      markdown: "",
      expectErrors: 0,
    },
    {
      name: "passes prose without code blocks",
      markdown: "# Title\n\nJust words.",
      expectErrors: 0,
    },
    {
      name: "rejects unbalanced fences",
      markdown: '```json-attributes\n{"tags": []}',
      expectErrors: 1,
      messageContains: "Unbalanced",
    },
    {
      name: "rejects fence without language",
      markdown: "```\n{}\n```",
      expectErrors: 1,
      messageContains: "missing a language tag",
    },
    {
      name: "rejects unterminated JSON string",
      markdown: '```json-callout\n{"x": "abc\n```',
      expectErrors: 1,
      messageContains: "Invalid JSON",
    },
    {
      name: "rejects malformed JSON object",
      markdown: '```json-callout\n{"x":\n```',
      expectErrors: 1,
      messageContains: "Invalid JSON",
    },
    {
      name: "ignores non-json fenced blocks",
      markdown: "```python\nprint(1)\n```",
      expectErrors: 0,
    },
    {
      name: "accepts JSON that fails ZOD but is parseable",
      markdown: '```json-callout\n{"wrong": "shape"}\n```',
      expectErrors: 0,
    },
    {
      name: "reports multiple JSON errors across blocks",
      markdown: '```json-callout\n{"x":\n```\n\n```json-attributes\n{bad\n```',
      expectErrors: 2,
    },
  ]

  it.each(cases)("$name", ({ markdown, expectErrors, messageContains }) => {
    const errors = validateStructural(markdown)
    expect(errors).toHaveLength(expectErrors)
    if (messageContains) {
      expect(errors.some((e) => e.message.includes(messageContains))).toBe(true)
    }
  })
})

describe("validateSemantic skips structural-only failures", () => {
  it("flags ZOD shape errors but not JSON syntax (structural should have caught syntax)", () => {
    const result = validateSemantic('```json-callout\n{"wrong":"shape"}\n```')
    expect(result.valid).toBe(false)
  })
})
