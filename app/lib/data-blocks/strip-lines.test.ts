import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { block } from "./test-helpers"
import { parseCodeBlocks } from "./parse"
import { stripCodeBlockLines, remapRanges, type LineRange } from "./strip-lines"

describe("stripCodeBlockLines", () => {
  interface Case {
    name: string
    content: string
    expectedLines: string[]
    expectedLineMap: number[]
  }

  const cases: Case[] = [
    {
      name: "no blocks — passthrough",
      content: "line one\nline two\nline three",
      expectedLines: ["line one", "line two", "line three"],
      expectedLineMap: [1, 2, 3],
    },
    {
      name: "block at end",
      content: `prose A\nprose B\n${block("json-callout", '{"id":"c1","title":"X"}')}`,
      expectedLines: ["prose A", "prose B"],
      expectedLineMap: [1, 2],
    },
    {
      name: "block at start",
      content: `${block("json-attributes", '{"type":"t"}')}\nprose A\nprose B`,
      expectedLines: ["prose A", "prose B"],
      expectedLineMap: [4, 5],
    },
    {
      name: "block in middle — gap in lineMap",
      content: `prose A\n${block("json-chart", '{"id":"ch1"}')}\nprose B`,
      expectedLines: ["prose A", "prose B"],
      expectedLineMap: [1, 5],
    },
    {
      name: "multiple blocks",
      content: `aa\n${block("json-callout", '{"id":"c1","title":"A"}')}\nbb\n${block("json-chart", '{"id":"ch1"}')}\ncc`,
      expectedLines: ["aa", "bb", "cc"],
      expectedLineMap: [1, 5, 9],
    },
    {
      name: "entire file is a code block",
      content: block("json-attributes", '{"type":"t"}'),
      expectedLines: [],
      expectedLineMap: [],
    },
    {
      name: "empty content",
      content: "",
      expectedLines: [""],
      expectedLineMap: [1],
    },
  ]

  it.each(cases)("$name", (c) => {
    const result = stripCodeBlockLines(c.content)
    expect(result.content.split("\n")).toEqual(
      c.expectedLines.length === 0 ? [""] : c.expectedLines
    )
    expect(result.lineMap).toEqual(c.expectedLineMap)
  })
})

describe("remapRanges", () => {
  interface Case {
    name: string
    lineMap: number[]
    ranges: LineRange[]
    expected: LineRange[]
  }

  const cases: Case[] = [
    {
      name: "identity map — no change",
      lineMap: [1, 2, 3, 4, 5],
      ranges: [{ startLine: 2, endLine: 4 }],
      expected: [{ startLine: 2, endLine: 4 }],
    },
    {
      name: "range not spanning gap",
      lineMap: [1, 2, 6, 7, 8],
      ranges: [{ startLine: 1, endLine: 2 }],
      expected: [{ startLine: 1, endLine: 2 }],
    },
    {
      name: "range spanning gap — splits into two",
      lineMap: [1, 2, 6, 7, 8],
      ranges: [{ startLine: 1, endLine: 5 }],
      expected: [
        { startLine: 1, endLine: 2 },
        { startLine: 6, endLine: 8 },
      ],
    },
    {
      name: "multiple gaps — splits into three",
      lineMap: [1, 2, 6, 7, 11, 12],
      ranges: [{ startLine: 1, endLine: 6 }],
      expected: [
        { startLine: 1, endLine: 2 },
        { startLine: 6, endLine: 7 },
        { startLine: 11, endLine: 12 },
      ],
    },
    {
      name: "multiple input ranges",
      lineMap: [1, 2, 6, 7, 8],
      ranges: [
        { startLine: 1, endLine: 2 },
        { startLine: 3, endLine: 5 },
      ],
      expected: [
        { startLine: 1, endLine: 2 },
        { startLine: 6, endLine: 8 },
      ],
    },
    {
      name: "single-line range",
      lineMap: [1, 5, 9],
      ranges: [{ startLine: 2, endLine: 2 }],
      expected: [{ startLine: 5, endLine: 5 }],
    },
    {
      name: "empty ranges",
      lineMap: [1, 2, 3],
      ranges: [],
      expected: [],
    },
  ]

  it.each(cases)("$name", (c) => {
    expect(remapRanges(c.lineMap, c.ranges)).toEqual(c.expected)
  })
})

describe("stripCodeBlockLines — ministerraad fixture", () => {
  const fixture = readFileSync(join(__dirname, "../text/fixtures/ministerraad.md"), "utf-8")
  const result = stripCodeBlockLines(fixture)
  const originalLines = fixture.split("\n")
  const strippedLines = result.content.split("\n")

  it("stripped has fewer lines than original", () => {
    expect(strippedLines.length).toBeLessThan(originalLines.length)
  })

  it("stripped contains no code fence lines", () => {
    const blocks = parseCodeBlocks(result.content)
    expect(blocks).toEqual([])
  })

  it("lineMap is strictly ascending", () => {
    for (let i = 1; i < result.lineMap.length; i++) {
      expect(result.lineMap[i]).toBeGreaterThan(result.lineMap[i - 1])
    }
  })

  it("lineMap length matches stripped line count", () => {
    expect(result.lineMap.length).toBe(strippedLines.length)
  })

  it("lineMap values are within original line range", () => {
    for (const ln of result.lineMap) {
      expect(ln).toBeGreaterThanOrEqual(1)
      expect(ln).toBeLessThanOrEqual(originalLines.length)
    }
  })

  it("stripped lines match their original counterparts via lineMap", () => {
    for (let i = 0; i < strippedLines.length; i++) {
      const originalIdx = result.lineMap[i] - 1
      expect(strippedLines[i]).toBe(originalLines[originalIdx])
    }
  })
})
