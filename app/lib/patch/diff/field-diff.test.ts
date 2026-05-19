import { describe, it, expect } from "vitest"
import { applyFieldDiff } from "./field-diff"

describe("applyFieldDiff", () => {
  interface Case {
    name: string
    value: string
    diff: string
    expected: { ok: true; content: string } | { ok: false; error: string }
  }

  const cases: Case[] = [
    {
      name: "replace a line in multiline content",
      value: "Line one.\n\nLine two.\n\nLine three.",
      diff: "@@\nLine one.\n\n-Line two.\n+Line two updated.\n\nLine three.",
      expected: { ok: true, content: "Line one.\n\nLine two updated.\n\nLine three." },
    },
    {
      name: "append to content",
      value: "Existing content.",
      diff: "@@\n+\n+Appended line.",
      expected: { ok: true, content: "Existing content.\n\nAppended line." },
    },
    {
      name: "remove a line",
      value: "Keep this.\nRemove this.\nAlso keep.",
      diff: "@@\nKeep this.\n-Remove this.\nAlso keep.",
      expected: { ok: true, content: "Keep this.\nAlso keep." },
    },
    {
      name: "error when context not found",
      value: "Some text.",
      diff: "@@\nnonexistent context\nnonexistent line two\nnonexistent line three\n-old\n+new",
      expected: { ok: false, error: expect.stringContaining("not found") as unknown as string },
    },
    {
      name: "replace in numbered list",
      value: "Criteria:\n1. First criterion\n2. Second criterion\n3. Third criterion",
      diff: "@@\nCriteria:\n-1. First criterion\n+1. Updated criterion\n2. Second criterion\n3. Third criterion",
      expected: {
        ok: true,
        content: "Criteria:\n1. Updated criterion\n2. Second criterion\n3. Third criterion",
      },
    },
    {
      name: "empty value with append",
      value: "",
      diff: "@@\n+First line.",
      expected: { ok: true, content: "First line." },
    },
    {
      name: "unescape literal \\t from JSON field",
      value: "Line one.\n\tIndented line.\nLine three.",
      diff: "@@\\nLine one.\\n-\\tIndented line.\\n+\\tUpdated line.\\nLine three.",
      expected: { ok: true, content: "Line one.\n\tUpdated line.\nLine three." },
    },
    {
      name: "unescape literal \\n from JSON field",
      value: "First paragraph.\n\nSecond paragraph.",
      diff: "@@\\nFirst paragraph.\\n\\n-Second paragraph.\\n+Revised paragraph.",
      expected: { ok: true, content: "First paragraph.\n\nRevised paragraph." },
    },
    {
      name: "context skip: locate via anchors and change after",
      value: "Intro paragraph.\nLong middle text.\nMore detail here.\nConclusion old.",
      diff: "@@\nIntro paragraph.\n...\nMore detail here.\n-Conclusion old.\n+Conclusion new.",
      expected: {
        ok: true,
        content: "Intro paragraph.\nLong middle text.\nMore detail here.\nConclusion new.",
      },
    },
    {
      name: "remove skip: delete range between anchors",
      value: "Keep start.\nDrop A.\nDrop B.\nDrop C.\nKeep end.",
      diff: "@@\nKeep start.\n-Drop A.\n-...\n-Drop C.\nKeep end.",
      expected: { ok: true, content: "Keep start.\nKeep end." },
    },
    {
      name: "prefix: explicit ... resolves truncated context in field diff",
      value:
        "This is a long field value paragraph that the language model truncated because it was too long to reproduce exactly and it keeps going\nold line\nend",
      diff: "@@\nThis is a long field value paragraph that the language model truncated because it was too long...\n-old line\n+new line\nend",
      expected: {
        ok: true,
        content:
          "This is a long field value paragraph that the language model truncated because it was too long to reproduce exactly and it keeps going\nnew line\nend",
      },
    },
  ]

  it.each(cases)("$name", ({ value, diff, expected }) => {
    const result = applyFieldDiff(value, diff)
    if (expected.ok) {
      expect(result).toEqual(expected)
    } else {
      expect(result.ok).toBe(false)
    }
  })
})
