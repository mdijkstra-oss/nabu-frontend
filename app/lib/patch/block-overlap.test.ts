import { describe, it, expect } from "vitest"
import { findBlockOverlap, findFenceCreations } from "./block-overlap"

const fixture = `# Doc

Hello world prose.

\`\`\`json-annotations
{
\t"annotations": [
\t\t{ "id": "ann_1", "text": "x", "reason": "y", "color": "blue" }
\t]
}
\`\`\`

More prose here.
`

describe("findBlockOverlap", () => {
  interface Case {
    name: string
    spanStart: number
    spanEnd: number
    expectedLanguage: string | null
  }

  const proseStart = fixture.indexOf("Hello world")
  const proseEnd = proseStart + "Hello world".length
  const blockStart = fixture.indexOf("```json-annotations")
  const blockEnd = fixture.indexOf("```", blockStart + 3) + 3
  const tailStart = fixture.indexOf("More prose")
  const tailEnd = tailStart + "More prose".length

  const cases: Case[] = [
    {
      name: "span fully inside prose returns null",
      spanStart: proseStart,
      spanEnd: proseEnd,
      expectedLanguage: null,
    },
    {
      name: "span fully inside block returns overlap",
      spanStart: blockStart + 5,
      spanEnd: blockEnd - 5,
      expectedLanguage: "json-annotations",
    },
    {
      name: "span straddling block start returns overlap",
      spanStart: blockStart - 5,
      spanEnd: blockStart + 10,
      expectedLanguage: "json-annotations",
    },
    {
      name: "span straddling block end returns overlap",
      spanStart: blockEnd - 5,
      spanEnd: blockEnd + 5,
      expectedLanguage: "json-annotations",
    },
    {
      name: "span after block returns null",
      spanStart: tailStart,
      spanEnd: tailEnd,
      expectedLanguage: null,
    },
    {
      name: "zero-length span touching block edge does not overlap",
      spanStart: blockStart,
      spanEnd: blockStart,
      expectedLanguage: null,
    },
  ]

  it.each(cases)("$name", ({ spanStart, spanEnd, expectedLanguage }) => {
    const result = findBlockOverlap(fixture, spanStart, spanEnd)
    if (expectedLanguage === null) {
      expect(result).toBeNull()
    } else {
      expect(result?.language).toBe(expectedLanguage)
    }
  })
})

describe("findFenceCreations", () => {
  interface Case {
    name: string
    text: string
    expected: string[]
  }

  const cases: Case[] = [
    {
      name: "raw prose has no fences",
      text: "Just prose here.\nNo fences.",
      expected: [],
    },
    {
      name: "detects json-annotations fence opener",
      text: "Some prose\n```json-annotations\n{}\n```",
      expected: ["json-annotations"],
    },
    {
      name: "detects multiple distinct fences",
      text: "```json-annotations\n```\nText\n```json-callout\n```",
      expected: ["json-annotations", "json-callout"],
    },
    {
      name: "dedupes repeated fence language",
      text: "```json-annotations\n```\n```json-annotations\n```",
      expected: ["json-annotations"],
    },
    {
      name: "ignores unknown fence languages",
      text: "```python\nprint(1)\n```\n```text\nhi\n```",
      expected: [],
    },
  ]

  it.each(cases)("$name", ({ text, expected }) => {
    expect(findFenceCreations(text)).toEqual(expected)
  })
})
