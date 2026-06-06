import { describe, it, expect } from "vitest"
import { validateMarkdownBlocks } from "./validate"
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
  describe("annotation code validation", () => {
    const cases = [
      {
        name: "accepts annotation when code exists",
        markdown: `# Test

\`\`\`json-annotations
{"annotations": [{"text": "test", "reason": "note", "code": "abc123"}]}
\`\`\``,
        context: {
          availableCodes: [{ id: "abc123", name: "Theme" }],
          availableTags: [],
        },
        expectValid: true,
      },
      {
        name: "rejects annotation when code not found",
        markdown: `# Test

\`\`\`json-annotations
{"annotations": [{"text": "test", "reason": "note", "code": "nonexistent"}]}
\`\`\``,
        context: {
          availableCodes: [{ id: "abc123", name: "Theme" }],
          availableTags: [],
        },
        expectValid: false,
        expectErrorContains: "not found",
        expectHint: { Theme: "abc123" },
      },
    ]

    it.each(cases)(
      "$name",
      ({ markdown, context, expectValid, expectErrorContains, expectHint }) => {
        const result = validateMarkdownBlocks(markdown, { context })
        expect(result.valid).toBe(expectValid)
        if (!expectValid && expectErrorContains) {
          expect(result.errors.some((e) => e.message.includes(expectErrorContains))).toBe(true)
        }
        if (expectHint) {
          const errorWithHint = result.errors.find((e) => e.hint)
          expect(errorWithHint?.hint).toEqual(expectHint)
        }
      }
    )
  })

  describe("tag validation", () => {
    const cases = [
      {
        name: "accepts tag when ID exists in settings",
        markdown: `# Doc\n\n\`\`\`json-attributes\n{"tags": ["tag-abc"]}\n\`\`\``,
        context: {
          availableCodes: [],
          availableTags: [{ id: "tag-abc", label: "interview" }],
        },
        expectValid: true,
      },
      {
        name: "rejects tag when ID not in settings",
        markdown: `# Doc\n\n\`\`\`json-attributes\n{"tags": ["tag-unknown"]}\n\`\`\``,
        context: {
          availableCodes: [],
          availableTags: [{ id: "tag-abc", label: "interview" }],
        },
        expectValid: false,
        expectErrorContains: "not defined in settings",
        expectHint: { interview: "tag-abc" },
      },
      {
        name: "skips validation when no tags defined",
        markdown: `# Doc\n\n\`\`\`json-attributes\n{"tags": ["any-tag"]}\n\`\`\``,
        context: {
          availableCodes: [],
          availableTags: [],
        },
        expectValid: true,
      },
    ]

    it.each(cases)(
      "$name",
      ({ markdown, context, expectValid, expectErrorContains, expectHint }) => {
        const result = validateMarkdownBlocks(markdown, { context })
        expect(result.valid).toBe(expectValid)
        if (!expectValid && expectErrorContains) {
          expect(result.errors.some((e) => e.message.includes(expectErrorContains))).toBe(true)
        }
        if (expectHint) {
          const errorWithHint = result.errors.find((e) => e.hint)
          expect(errorWithHint?.hint).toEqual(expectHint)
        }
      }
    )
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
{"annotations": [{"text": "old one", "reason": "original", "code": "valid-code"}]}
\`\`\``,
        patched: `# Test

\`\`\`json-annotations
{"annotations": [{"text": "new one", "reason": "test", "code": "bad-code"}]}
\`\`\``,
        check: (r) => {
          expect(r.errors[0].currentBlock).toContain("old one")
          expect(r.errors[0].currentBlock).not.toContain("new one")
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
