import { describe, expect, test } from "vitest"
import { sortSegments, packComposites, resolveSegmentByChar, type Segment } from "./pack"

const sep = (seg: Segment) => `\n\n# ${seg.path} [${seg.startLine}-${seg.endLine}]\n\n`

describe("sortSegments", () => {
  const cases = [
    {
      name: "groups by path, sorts by startLine",
      input: [
        { path: "b.md", startLine: 10, endLine: 20, content: "b10" },
        { path: "a.md", startLine: 5, endLine: 8, content: "a5" },
        { path: "b.md", startLine: 1, endLine: 5, content: "b1" },
        { path: "a.md", startLine: 1, endLine: 3, content: "a1" },
      ],
      expected: [
        { path: "a.md", startLine: 1, endLine: 3, content: "a1" },
        { path: "a.md", startLine: 5, endLine: 8, content: "a5" },
        { path: "b.md", startLine: 1, endLine: 5, content: "b1" },
        { path: "b.md", startLine: 10, endLine: 20, content: "b10" },
      ],
    },
    {
      name: "single segment unchanged",
      input: [{ path: "x.md", startLine: 1, endLine: 10, content: "x" }],
      expected: [{ path: "x.md", startLine: 1, endLine: 10, content: "x" }],
    },
    {
      name: "empty input",
      input: [],
      expected: [],
    },
  ]

  test.each(cases)("$name", ({ input, expected }) => {
    expect(sortSegments(input)).toEqual(expected)
  })
})

describe("packComposites", () => {
  const cases = [
    {
      name: "single segment below budget produces one composite",
      segments: [{ path: "a.md", startLine: 1, endLine: 10, content: "hello world" }],
      maxChars: 100,
      expected: {
        count: 1,
        firstContent: "hello world",
        firstSegmentCount: 1,
      },
    },
    {
      name: "two segments within budget are merged",
      segments: [
        { path: "a.md", startLine: 1, endLine: 5, content: "aaa" },
        { path: "b.md", startLine: 1, endLine: 5, content: "bbb" },
      ],
      maxChars: 200,
      expected: {
        count: 1,
        firstSegmentCount: 2,
      },
    },
    {
      name: "segments exceeding budget split into multiple composites",
      segments: [
        { path: "a.md", startLine: 1, endLine: 5, content: "a".repeat(60) },
        { path: "b.md", startLine: 1, endLine: 5, content: "b".repeat(60) },
        { path: "c.md", startLine: 1, endLine: 5, content: "c".repeat(60) },
      ],
      maxChars: 100,
      expected: {
        count: 3,
        firstSegmentCount: 1,
      },
    },
    {
      name: "first segment always included even if over budget",
      segments: [{ path: "a.md", startLine: 1, endLine: 5, content: "x".repeat(200) }],
      maxChars: 50,
      expected: {
        count: 1,
        firstSegmentCount: 1,
      },
    },
    {
      name: "separator included in budget calculation",
      segments: [
        { path: "a.md", startLine: 1, endLine: 5, content: "a".repeat(40) },
        { path: "b.md", startLine: 1, endLine: 5, content: "b".repeat(40) },
      ],
      maxChars: 85,
      expected: {
        count: 2,
        firstSegmentCount: 1,
      },
    },
    {
      name: "empty input produces no composites",
      segments: [],
      maxChars: 100,
      expected: { count: 0 },
    },
  ]

  test.each(cases)("$name", ({ segments, maxChars, expected }) => {
    const result = packComposites(segments, maxChars, sep)
    expect(result.length).toBe(expected.count)
    if (expected.firstContent) {
      expect(result[0].content).toBe(expected.firstContent)
    }
    if (expected.firstSegmentCount) {
      expect(result[0].segments.length).toBe(expected.firstSegmentCount)
    }
  })

  test("char offsets are correct for merged segments", () => {
    const segments: Segment[] = [
      { path: "a.md", startLine: 1, endLine: 5, content: "hello" },
      { path: "b.md", startLine: 1, endLine: 5, content: "world" },
    ]
    const result = packComposites(segments, 1000, sep)
    expect(result.length).toBe(1)

    const [comp] = result
    const [segA, segB] = comp.segments

    expect(segA.charStart).toBe(0)
    expect(segA.charEnd).toBe(5)
    expect(comp.content.slice(segA.charStart, segA.charEnd)).toBe("hello")

    const sepText = sep(segments[1])
    expect(segB.charStart).toBe(5 + sepText.length)
    expect(segB.charEnd).toBe(5 + sepText.length + 5)
    expect(comp.content.slice(segB.charStart, segB.charEnd)).toBe("world")
  })

  test("no separator before first segment", () => {
    const segments: Segment[] = [{ path: "a.md", startLine: 1, endLine: 5, content: "first" }]
    const result = packComposites(segments, 1000, sep)
    expect(result[0].content).toBe("first")
    expect(result[0].segments[0].charStart).toBe(0)
  })
})

describe("resolveSegmentByChar", () => {
  const cases = [
    {
      name: "resolves to first segment",
      charOffset: 3,
      expectedPath: "a.md",
    },
    {
      name: "resolves to second segment",
      charOffset: 20,
      expectedPath: "b.md",
    },
    {
      name: "offset in separator resolves to nothing",
      charOffset: 7,
      expectedPath: undefined,
    },
    {
      name: "offset beyond all segments resolves to nothing",
      charOffset: 999,
      expectedPath: undefined,
    },
  ]

  const composite = {
    content: "helloXXXXXXXXXXworld and more stuff here",
    segments: [
      { path: "a.md", startLine: 1, endLine: 5, charStart: 0, charEnd: 5 },
      { path: "b.md", startLine: 1, endLine: 10, charStart: 15, charEnd: 40 },
    ],
  }

  test.each(cases)("$name", ({ charOffset, expectedPath }) => {
    const result = resolveSegmentByChar(composite, charOffset)
    expect(result?.path).toBe(expectedPath)
  })
})
