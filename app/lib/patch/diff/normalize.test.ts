import { describe, it, expect } from "vitest"
import { isBlankLine, normalizeLine, normalizeContent, normalizeListMarkers } from "./normalize"

describe("isBlankLine", () => {
  const cases = [
    { name: "empty string", input: "", expected: true },
    { name: "spaces only", input: "   ", expected: true },
    { name: "tabs only", input: "\t\t", expected: true },
    { name: "mixed spaces and tabs", input: "  \t \t  ", expected: true },
    { name: "text content", input: "hello", expected: false },
    { name: "text with leading space", input: " hello", expected: false },
    { name: "text with trailing space", input: "hello ", expected: false },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(isBlankLine(input)).toBe(expected)
  })
})

describe("normalizeLine", () => {
  const cases = [
    { name: "no change needed", input: "hello", expected: "hello" },
    { name: "trims trailing spaces", input: "hello   ", expected: "hello" },
    { name: "trims trailing tabs", input: "hello\t\t", expected: "hello" },
    { name: "trims trailing mixed", input: "hello \t ", expected: "hello" },
    { name: "normalizes dash list marker to asterisk", input: "- item", expected: "* item" },
    { name: "normalizes plus list marker to asterisk", input: "+ item", expected: "* item" },
    { name: "preserves asterisk list marker", input: "* item", expected: "* item" },
    { name: "normalizes indented dash list marker", input: "  - child", expected: "\t* child" },
    { name: "normalizes indented plus list marker", input: "  + child", expected: "\t* child" },
    {
      name: "normalizes deeply indented list marker",
      input: "    - grandchild",
      expected: "\t\t* grandchild",
    },
    { name: "ignores dash in mid-line text", input: "some - text", expected: "some - text" },
    { name: "ignores horizontal rule", input: "---", expected: "---" },
    { name: "converts 2-space indent to tab", input: "  hello", expected: "\thello" },
    { name: "converts 4-space indent to 2 tabs", input: "    hello", expected: "\t\thello" },
    { name: "converts 6-space indent to 3 tabs", input: "      hello", expected: "\t\t\thello" },
    { name: "drops odd trailing space in indent", input: "   hello", expected: "\thello" },
    { name: "preserves existing tabs", input: "\thello", expected: "\thello" },
    { name: "converts spaces and trims trailing", input: "    hello  ", expected: "\t\thello" },
    { name: "blank line becomes empty", input: "   ", expected: "" },
    { name: "tab-only line becomes empty", input: "\t\t", expected: "" },
    { name: "empty stays empty", input: "", expected: "" },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(normalizeLine(input)).toBe(expected)
  })
})

describe("normalizeListMarkers", () => {
  const cases = [
    { name: "dash to asterisk", input: "- item", expected: "* item" },
    { name: "plus to asterisk", input: "+ item", expected: "* item" },
    { name: "preserves asterisk", input: "* item", expected: "* item" },
    { name: "space-indented dash", input: "  - child", expected: "  * child" },
    { name: "tab-indented dash", input: "\t- child", expected: "\t* child" },
    { name: "ignores mid-line dash", input: "some - text", expected: "some - text" },
    { name: "ignores horizontal rule", input: "---", expected: "---" },
    { name: "preserves numbered list", input: "1. item", expected: "1. item" },
    {
      name: "multiline with mixed markers",
      input: "- first\n+ second\n  - nested\n* already",
      expected: "* first\n* second\n  * nested\n* already",
    },
    {
      name: "skips non-list lines in multiline",
      input: "paragraph\n- item\nmore text",
      expected: "paragraph\n* item\nmore text",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(normalizeListMarkers(input)).toBe(expected)
  })
})

describe("normalizeContent", () => {
  const cases = [
    {
      name: "collapses consecutive blank lines",
      input: "line1\n\n\n\nline2",
      expected: "line1\n\nline2",
    },
    {
      name: "collapses whitespace-only blank lines",
      input: "line1\n   \n\t\n\nline2",
      expected: "line1\n\nline2",
    },
    {
      name: "trims trailing whitespace per line",
      input: "hello   \nworld\t\t",
      expected: "hello\nworld",
    },
    {
      name: "converts space indentation to tabs and normalizes list markers",
      input: "- item\n  - child\n    - grandchild",
      expected: "* item\n\t* child\n\t\t* grandchild",
    },
    {
      name: "trims trailing blank lines",
      input: "hello\nworld\n\n\n",
      expected: "hello\nworld",
    },
    {
      name: "preserves single blank line between content",
      input: "# Title\n\nParagraph",
      expected: "# Title\n\nParagraph",
    },
    {
      name: "full normalization pipeline",
      input: "# Title  \n\n\n  - item  \n   \n\t\n  - item2\n\n",
      expected: "# Title\n\n\t* item\n\n\t* item2",
    },
    {
      name: "adds blank line after heading",
      input: "### Color\nbrown",
      expected: "### Color\n\nbrown",
    },
    {
      name: "adds blank line before heading (not at start)",
      input: "some text\n### Color\nbrown",
      expected: "some text\n\n### Color\n\nbrown",
    },
    {
      name: "heading at start gets no blank before",
      input: "# Title\ncontent",
      expected: "# Title\n\ncontent",
    },
    {
      name: "preserves existing heading spacing",
      input: "# Title\n\nParagraph\n\n## Section\n\nMore text",
      expected: "# Title\n\nParagraph\n\n## Section\n\nMore text",
    },
    {
      name: "multiple headings without spacing",
      input: "### Color\nbrown\n### Definition\nsome text",
      expected: "### Color\n\nbrown\n\n### Definition\n\nsome text",
    },
    {
      name: "skips headings inside fenced code blocks",
      input: "```json-callout\n### Color\nbrown\n```",
      expected: "```json-callout\n### Color\nbrown\n```",
    },
    {
      name: "heading after code block gets spacing",
      input: "```json\n{}\n```\n### Next\ncontent",
      expected: "```json\n{}\n```\n\n### Next\n\ncontent",
    },
    {
      name: "empty string stays empty",
      input: "",
      expected: "",
    },
    {
      name: "single line",
      input: "hello",
      expected: "hello",
    },
    {
      name: "only blank lines becomes empty",
      input: "\n\n\n",
      expected: "",
    },
  ]

  it.each(cases)("$name", ({ input, expected }) => {
    expect(normalizeContent(input)).toBe(expected)
  })
})
