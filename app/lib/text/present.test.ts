import { describe, it, expect } from "vitest"
import {
  formatCodedSection,
  formatTaggedSection,
  buildVisibleRanges,
  locateTextInSentences,
  type CodedItem,
  type VisibleRange,
} from "./present"

describe("formatCodedSection", () => {
  const sentences = [
    "The prime minister opened the press conference.",
    "He stated that measures would be extended.",
    "This was met with mixed reactions.",
    "De Jonge presented the figures.",
    "The system was under pressure.",
    "The prime minister concluded by urging patience.",
  ]

  const cases: {
    name: string
    items: CodedItem[]
    expectedLines: string[]
    expectedMappingCount: number
  }[] = [
    {
      name: "single code per item",
      items: [
        { start: 2, end: 2, codings: ["rhetorical-authority"] },
        { start: 4, end: 5, codings: ["crisis-framing"] },
      ],
      expectedLines: [
        "The prime minister opened the press conference.",
        "1: [rhetorical-authority] He stated that measures would be extended.",
        "This was met with mixed reactions.",
        "2: [crisis-framing] De Jonge presented the figures. The system was under pressure.",
        "The prime minister concluded by urging patience.",
      ],
      expectedMappingCount: 2,
    },
    {
      name: "multiple codes per item",
      items: [{ start: 2, end: 3, codings: ["crisis-framing", "rhetorical-authority"] }],
      expectedLines: [
        "The prime minister opened the press conference.",
        "1: [crisis-framing, rhetorical-authority] He stated that measures would be extended. This was met with mixed reactions.",
        "De Jonge presented the figures.",
        "The system was under pressure.",
        "The prime minister concluded by urging patience.",
      ],
      expectedMappingCount: 1,
    },
    {
      name: "code + reason",
      items: [
        {
          start: 2,
          end: 2,
          codings: ["crisis-framing"],
          reason: "Satisfies the 'worsening metrics' criterion.",
        },
      ],
      expectedLines: [
        "The prime minister opened the press conference.",
        "1: [crisis-framing] He stated that measures would be extended.",
        "   Reason: Satisfies the 'worsening metrics' criterion.",
        "This was met with mixed reactions.",
        "De Jonge presented the figures.",
        "The system was under pressure.",
        "The prime minister concluded by urging patience.",
      ],
      expectedMappingCount: 1,
    },
    {
      name: "no items: all sentences as plain context",
      items: [],
      expectedLines: sentences,
      expectedMappingCount: 0,
    },
    {
      name: "all sentences coded",
      items: [{ start: 1, end: 6, codings: ["full-span"] }],
      expectedLines: [
        "1: [full-span] The prime minister opened the press conference. He stated that measures would be extended. This was met with mixed reactions. De Jonge presented the figures. The system was under pressure. The prime minister concluded by urging patience.",
      ],
      expectedMappingCount: 1,
    },
    {
      name: "mapping preserves original span info",
      items: [
        { start: 3, end: 5, codings: ["X"] },
        { start: 1, end: 1, codings: ["Y"] },
      ],
      expectedLines: [
        "2: [Y] The prime minister opened the press conference.",
        "He stated that measures would be extended.",
        "1: [X] This was met with mixed reactions. De Jonge presented the figures. The system was under pressure.",
        "The prime minister concluded by urging patience.",
      ],
      expectedMappingCount: 2,
    },
  ]

  cases.forEach(({ name, items, expectedLines, expectedMappingCount }) => {
    it(name, () => {
      const result = formatCodedSection(sentences, items)
      expect(result.text).toBe(expectedLines.join("\n"))
      expect(result.mapping).toHaveLength(expectedMappingCount)
    })
  })

  it("uses annotation id as label when present", () => {
    const items: CodedItem[] = [
      { start: 2, end: 2, codings: ["crisis-framing"], id: "annotation-8obi83xh" },
      { start: 4, end: 5, codings: ["crisis-framing"], id: "annotation-1m921a6o" },
    ]
    const result = formatCodedSection(sentences, items)
    expect(result.text).toBe(
      [
        "The prime minister opened the press conference.",
        "annotation-8obi83xh: [crisis-framing] He stated that measures would be extended.",
        "This was met with mixed reactions.",
        "annotation-1m921a6o: [crisis-framing] De Jonge presented the figures. The system was under pressure.",
        "The prime minister concluded by urging patience.",
      ].join("\n")
    )
  })

  it("falls back to numeric index when id is absent", () => {
    const items: CodedItem[] = [
      { start: 2, end: 2, codings: ["A"], id: "annotation-abc" },
      { start: 5, end: 5, codings: ["B"] },
    ]
    const result = formatCodedSection(sentences, items)
    expect(result.text).toContain("annotation-abc: [A]")
    expect(result.text).toContain("2: [B]")
  })

  it("mapping links index to original span", () => {
    const items: CodedItem[] = [
      { start: 2, end: 3, codings: ["A"] },
      { start: 5, end: 5, codings: ["B"] },
    ]
    const { mapping } = formatCodedSection(sentences, items)
    expect(mapping[0]).toEqual({ index: 1, start: 2, end: 3, codings: ["A"] })
    expect(mapping[1]).toEqual({ index: 2, start: 5, end: 5, codings: ["B"] })
  })

  describe("with context trimming", () => {
    const tenSentences = ["S1.", "S2.", "S3.", "S4.", "S5.", "S6.", "S7.", "S8.", "S9.", "S10."]

    const trimCases: {
      name: string
      items: CodedItem[]
      context: number
      expectedLines: string[]
    }[] = [
      {
        name: "trims far sentences, keeps context window",
        items: [{ start: 5, end: 5, codings: ["X"] }],
        context: 1,
        expectedLines: ["...", "S4.", "1: [X] S5.", "S6.", "..."],
      },
      {
        name: "no leading ellipsis when context reaches sentence 1",
        items: [{ start: 2, end: 2, codings: ["X"] }],
        context: 1,
        expectedLines: ["S1.", "1: [X] S2.", "S3.", "..."],
      },
      {
        name: "no trailing ellipsis when context reaches last sentence",
        items: [{ start: 9, end: 9, codings: ["X"] }],
        context: 1,
        expectedLines: ["...", "S8.", "1: [X] S9.", "S10."],
      },
      {
        name: "merges when gap between items is within context",
        items: [
          { start: 3, end: 3, codings: ["A"] },
          { start: 6, end: 6, codings: ["B"] },
        ],
        context: 2,
        expectedLines: [
          "S1.",
          "S2.",
          "1: [A] S3.",
          "S4.",
          "S5.",
          "2: [B] S6.",
          "S7.",
          "S8.",
          "...",
        ],
      },
      {
        name: "separate ellipsis when gap exceeds context",
        items: [
          { start: 2, end: 2, codings: ["A"] },
          { start: 9, end: 9, codings: ["B"] },
        ],
        context: 1,
        expectedLines: ["S1.", "1: [A] S2.", "S3.", "...", "S8.", "2: [B] S9.", "S10."],
      },
      {
        name: "context 0 shows only coded sentences",
        items: [{ start: 5, end: 6, codings: ["X"] }],
        context: 0,
        expectedLines: ["...", "1: [X] S5. S6.", "..."],
      },
      {
        name: "all sentences visible when context covers everything",
        items: [{ start: 5, end: 5, codings: ["X"] }],
        context: 10,
        expectedLines: [
          "S1.",
          "S2.",
          "S3.",
          "S4.",
          "1: [X] S5.",
          "S6.",
          "S7.",
          "S8.",
          "S9.",
          "S10.",
        ],
      },
    ]

    trimCases.forEach(({ name, items, context, expectedLines }) => {
      it(name, () => {
        const result = formatCodedSection(tenSentences, items, context)
        expect(result.text).toBe(expectedLines.join("\n"))
      })
    })
  })
})

describe("buildVisibleRanges", () => {
  const cases: {
    name: string
    items: CodedItem[]
    sentenceCount: number
    context: number
    expected: VisibleRange[]
  }[] = [
    {
      name: "no items → full range",
      items: [],
      sentenceCount: 10,
      context: 2,
      expected: [[1, 10]],
    },
    {
      name: "single item with context",
      items: [{ start: 5, end: 5, codings: ["X"] }],
      sentenceCount: 10,
      context: 2,
      expected: [[3, 7]],
    },
    {
      name: "clamps to bounds",
      items: [{ start: 1, end: 1, codings: ["X"] }],
      sentenceCount: 5,
      context: 3,
      expected: [[1, 4]],
    },
    {
      name: "merges overlapping ranges",
      items: [
        { start: 3, end: 3, codings: ["A"] },
        { start: 6, end: 6, codings: ["B"] },
      ],
      sentenceCount: 10,
      context: 2,
      expected: [[1, 8]],
    },
    {
      name: "merges adjacent ranges",
      items: [
        { start: 3, end: 3, codings: ["A"] },
        { start: 8, end: 8, codings: ["B"] },
      ],
      sentenceCount: 15,
      context: 2,
      expected: [[1, 10]],
    },
    {
      name: "keeps separate when gap exceeds context",
      items: [
        { start: 2, end: 2, codings: ["A"] },
        { start: 10, end: 10, codings: ["B"] },
      ],
      sentenceCount: 12,
      context: 1,
      expected: [
        [1, 3],
        [9, 11],
      ],
    },
    {
      name: "context 0 yields exact spans",
      items: [
        { start: 3, end: 5, codings: ["X"] },
        { start: 9, end: 9, codings: ["Y"] },
      ],
      sentenceCount: 10,
      context: 0,
      expected: [
        [3, 5],
        [9, 9],
      ],
    },
    {
      name: "multi-sentence span expanded by context",
      items: [{ start: 4, end: 7, codings: ["X"] }],
      sentenceCount: 12,
      context: 2,
      expected: [[2, 9]],
    },
  ]

  cases.forEach(({ name, items, sentenceCount, context, expected }) => {
    it(name, () => expect(buildVisibleRanges(items, sentenceCount, context)).toEqual(expected))
  })
})

describe("locateTextInSentences", () => {
  const sentences = [
    "The prime minister opened the press conference.",
    "He stated that measures would be extended.",
    "This was met with mixed reactions.",
    "De Jonge presented the figures.",
    "The system was under pressure.",
    "The prime minister concluded by urging patience.",
  ]

  const cases: {
    name: string
    needle: string
    expected: { start: number; end: number } | null
  }[] = [
    {
      name: "exact single sentence",
      needle: "He stated that measures would be extended.",
      expected: { start: 2, end: 2 },
    },
    {
      name: "exact multi-sentence span",
      needle: "De Jonge presented the figures. The system was under pressure.",
      expected: { start: 4, end: 5 },
    },
    {
      name: "partial match within sentence",
      needle: "measures would be extended",
      expected: { start: 2, end: 2 },
    },
    {
      name: "no match returns null",
      needle: "completely unrelated text about quantum physics",
      expected: null,
    },
    {
      name: "empty needle returns null",
      needle: "",
      expected: null,
    },
    {
      name: "first sentence",
      needle: "The prime minister opened the press conference.",
      expected: { start: 1, end: 1 },
    },
    {
      name: "last sentence",
      needle: "The prime minister concluded by urging patience.",
      expected: { start: 6, end: 6 },
    },
  ]

  cases.forEach(({ name, needle, expected }) => {
    it(name, () => {
      expect(locateTextInSentences(sentences, needle)).toEqual(expected)
    })
  })
})

describe("formatTaggedSection", () => {
  const sentences = [
    "The prime minister opened the press conference.",
    "He stated that measures would be extended.",
    "This was met with mixed reactions.",
    "De Jonge presented the figures.",
    "The system was under pressure.",
    "The prime minister concluded by urging patience.",
  ]

  const cases: {
    name: string
    items: CodedItem[]
    context?: number
    expected: string
  }[] = [
    {
      name: "wraps context and annotation in tags",
      items: [{ start: 2, end: 2, codings: ["crisis-framing"], id: "annotation-abc" }],
      expected: [
        "<context>The prime minister opened the press conference.</context>",
        '<annotation id="annotation-abc" code="crisis-framing">He stated that measures would be extended.</annotation>',
        "<context>This was met with mixed reactions. De Jonge presented the figures. The system was under pressure. The prime minister concluded by urging patience.</context>",
      ].join("\n"),
    },
    {
      name: "context trimming with tags",
      items: [{ start: 3, end: 3, codings: ["X"], id: "annotation-123" }],
      context: 1,
      expected: [
        "...",
        "<context>He stated that measures would be extended.</context>",
        '<annotation id="annotation-123" code="X">This was met with mixed reactions.</annotation>',
        "<context>De Jonge presented the figures.</context>",
        "...",
      ].join("\n"),
    },
    {
      name: "multiple annotations merge context between",
      items: [
        { start: 2, end: 2, codings: ["A"], id: "annotation-aaa" },
        { start: 4, end: 4, codings: ["B"], id: "annotation-bbb" },
      ],
      expected: [
        "<context>The prime minister opened the press conference.</context>",
        '<annotation id="annotation-aaa" code="A">He stated that measures would be extended.</annotation>',
        "<context>This was met with mixed reactions.</context>",
        '<annotation id="annotation-bbb" code="B">De Jonge presented the figures.</annotation>',
        "<context>The system was under pressure. The prime minister concluded by urging patience.</context>",
      ].join("\n"),
    },
    {
      name: "annotation without id omits id attr",
      items: [{ start: 2, end: 2, codings: ["X"] }],
      expected: [
        "<context>The prime minister opened the press conference.</context>",
        '<annotation code="X">He stated that measures would be extended.</annotation>',
        "<context>This was met with mixed reactions. De Jonge presented the figures. The system was under pressure. The prime minister concluded by urging patience.</context>",
      ].join("\n"),
    },
    {
      name: "all context when no items",
      items: [],
      expected: `<context>${sentences.join(" ")}</context>`,
    },
  ]

  cases.forEach(({ name, items, context, expected }) => {
    it(name, () => {
      expect(formatTaggedSection(sentences, items, context)).toBe(expected)
    })
  })
})
