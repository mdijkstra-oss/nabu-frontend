import { describe, it, expect } from "vitest"
import {
  extractSection,
  extractLeadingContext,
  extractTrailingContext,
  numberSection,
  mapResults,
  toAnnotationOps,
  toAnalysisResults,
  buildRemovalOps,
  formatReturnOutput,
  formatAnnotateOutput,
  isAnnotateAction,
  ABSENCE_HINT,
  type MappedResult,
  type AnnotationRef,
  type VoteRecord,
} from "./format"

describe("extractSection", () => {
  const content = "line1\nline2\nline3\nline4\nline5"

  const cases = [
    { name: "full range", start: 1, end: 5, expected: "line1\nline2\nline3\nline4\nline5" },
    { name: "middle range", start: 2, end: 4, expected: "line2\nline3\nline4" },
    { name: "single line", start: 3, end: 3, expected: "line3" },
    { name: "clamped to content", start: 4, end: 10, expected: "line4\nline5" },
  ]

  cases.forEach(({ name, start, end, expected }) => {
    it(name, () => expect(extractSection(content, start, end)).toBe(expected))
  })
})

describe("extractLeadingContext", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} content.`)
  const content = lines.join("\n")
  const lineLen = lines[0].length + 1

  const cases = [
    { name: "returns empty for first line", startLine: 1, maxChars: 1600, expected: "" },
    {
      name: "returns empty when maxChars is 0",
      startLine: 11,
      maxChars: 0,
      expected: "",
    },
    {
      name: "returns last N lines that fit within maxChars",
      startLine: 11,
      maxChars: lineLen * 2,
      expected: lines.slice(8, 10).join("\n"),
    },
    {
      name: "returns all preceding when budget exceeds content",
      startLine: 6,
      maxChars: 100000,
      expected: lines.slice(0, 5).join("\n"),
    },
    {
      name: "returns single preceding line when only one exists",
      startLine: 2,
      maxChars: 1600,
      expected: lines[0],
    },
  ]

  cases.forEach(({ name, startLine, maxChars, expected }) => {
    it(name, () => expect(extractLeadingContext(content, startLine, maxChars)).toBe(expected))
  })
})

describe("extractTrailingContext", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} content.`)
  const content = lines.join("\n")
  const lineLen = lines[0].length + 1

  const cases = [
    { name: "returns empty for last line", endLine: 20, maxChars: 1600, expected: "" },
    {
      name: "returns empty when maxChars is 0",
      endLine: 10,
      maxChars: 0,
      expected: "",
    },
    {
      name: "returns first N lines that fit within maxChars",
      endLine: 10,
      maxChars: lineLen * 2,
      expected: lines.slice(10, 12).join("\n"),
    },
    {
      name: "returns all following when budget exceeds content",
      endLine: 15,
      maxChars: 100000,
      expected: lines.slice(15).join("\n"),
    },
    {
      name: "returns single following line when only one exists",
      endLine: 19,
      maxChars: 1600,
      expected: lines[19],
    },
  ]

  cases.forEach(({ name, endLine, maxChars, expected }) => {
    it(name, () => expect(extractTrailingContext(content, endLine, maxChars)).toBe(expected))
  })
})

describe("numberSection", () => {
  const cases = [
    {
      name: "splits on sentence boundaries",
      text: "First sentence. Second sentence. Third.",
      expectedCount: 3,
      numberedContains: "1: First sentence.",
    },
    {
      name: "splits on newlines",
      text: "Line one\nLine two",
      expectedCount: 2,
      numberedContains: "2: Line two",
    },
    {
      name: "empty text",
      text: "",
      expectedCount: 0,
      numberedContains: null,
    },
  ]

  cases.forEach(({ name, text, expectedCount, numberedContains }) => {
    it(name, () => {
      const result = numberSection(text)
      expect(result.sentences).toHaveLength(expectedCount)
      if (numberedContains) expect(result.numbered).toContain(numberedContains)
    })
  })
})

describe("mapResults", () => {
  const sentences = ["First sentence.", "Second sentence.", "Third sentence."]

  const cases = [
    {
      name: "maps single result",
      results: [{ start: 1, end: 2, analysis_source_id: "code_1", reason: "relevant" }],
      expected: [
        {
          text: "First sentence. Second sentence.",
          analysis_source_id: "code_1",
          reason: "relevant",
        },
      ],
    },
    {
      name: "maps multiple results",
      results: [
        { start: 1, end: 1, analysis_source_id: "code_1", reason: "r1" },
        { start: 3, end: 3, analysis_source_id: "code_2", reason: "r2" },
      ],
      expected: [
        { text: "First sentence.", analysis_source_id: "code_1", reason: "r1" },
        { text: "Third sentence.", analysis_source_id: "code_2", reason: "r2" },
      ],
    },
    {
      name: "skips out-of-range",
      results: [{ start: 10, end: 12, analysis_source_id: "code_x", reason: "nope" }],
      expected: [],
    },
    {
      name: "empty results",
      results: [],
      expected: [],
    },
  ]

  cases.forEach(({ name, results, expected }) => {
    it(name, () => expect(mapResults(sentences, results)).toEqual(expected))
  })
})

describe("toAnnotationOps", () => {
  const cases = [
    {
      name: "annotate_as_code sets code field",
      mapped: [{ text: "Some text", analysis_source_id: "code_abc", reason: "fits criteria" }],
      action: "annotate_as_code" as const,
      expected: [
        {
          op: "add_annotation",
          item: { text: "Some text", reason: "fits criteria", code: "code_abc" },
        },
      ],
    },
    {
      name: "annotate_as_comment sets color and embeds id in reason",
      mapped: [{ text: "Some text", analysis_source_id: "code_abc", reason: "fits criteria" }],
      action: "annotate_as_comment" as const,
      expected: [
        {
          op: "add_annotation",
          item: { text: "Some text", reason: "[code_abc] fits criteria", color: "blue" },
        },
      ],
    },
  ]

  cases.forEach(({ name, mapped, action, expected }) => {
    it(name, () => expect(toAnnotationOps(mapped, action)).toEqual(expected))
  })
})

describe("formatReturnOutput", () => {
  const cases = [
    {
      name: "no results includes line range and absence hint",
      results: [],
      startLine: 10,
      endLine: 50,
      expected: `Lines 10-50 analyzed. No matches found.${ABSENCE_HINT}`,
    },
    {
      name: "formats results as list",
      results: [
        { text: "Some text", analysis_source_id: "code_1", reason: "because" },
        { text: "Other text", analysis_source_id: "code_2", reason: "also" },
      ],
      startLine: 1,
      endLine: 10,
      expected: '- [code_1] "Some text": because\n- [code_2] "Other text": also',
    },
  ]

  cases.forEach(({ name, results, startLine, endLine, expected }) => {
    it(name, () => expect(formatReturnOutput(results, startLine, endLine)).toBe(expected))
  })
})

describe("formatAnnotateOutput", () => {
  const results: MappedResult[] = [
    { text: "Some text", analysis_source_id: "code_1", reason: "because" },
    { text: "Other text", analysis_source_id: "code_2", reason: "also" },
  ]

  const cases = [
    {
      name: "empty results for code includes absence hint",
      action: "annotate_as_code" as const,
      input: [],
      startLine: 5,
      endLine: 20,
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results for comment includes absence hint",
      action: "annotate_as_comment" as const,
      input: [],
      startLine: 5,
      endLine: 20,
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results include absence hint text",
      action: "annotate_as_code" as const,
      input: [],
      startLine: 5,
      endLine: 20,
      contains: "Absence is data.",
    },
    {
      name: "code annotations include count and results",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      contains: "2 code annotation(s) written. Do not re-apply these.",
    },
    {
      name: "comment annotations include count and results",
      action: "annotate_as_comment" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      contains: "2 comment annotation(s) written. Do not re-apply these.",
    },
    {
      name: "includes result details",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      contains: '- [code_1] "Some text": because',
    },
  ]

  cases.forEach(({ name, action, input, startLine, endLine, contains }) => {
    it(name, () =>
      expect(formatAnnotateOutput(input, action, startLine, endLine)).toContain(contains)
    )
  })
})

describe("isAnnotateAction", () => {
  const cases = [
    { name: "return is false", action: "return" as const, expected: false },
    { name: "annotate_as_code is true", action: "annotate_as_code" as const, expected: true },
    { name: "annotate_as_comment is true", action: "annotate_as_comment" as const, expected: true },
  ]

  cases.forEach(({ name, action, expected }) => {
    it(name, () => expect(isAnnotateAction(action)).toBe(expected))
  })
})

describe("buildRemovalOps", () => {
  const content = [
    "Preamble line one.",
    "Preamble line two.",
    "Section start here.",
    "Middle of the section.",
    "Section end here.",
    "After the section.",
    "Final line.",
  ].join("\n")

  const cases: {
    name: string
    annotations: AnnotationRef[]
    codes: Set<string>
    startLine: number
    endLine: number
    expected: { op: "remove_annotation"; match: { id: string } }[]
  }[] = [
    {
      name: "removes annotation fully within section for matching code",
      annotations: [{ id: "ann-1", code: "code-a", text: "Section start here." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "keeps annotation outside section for matching code",
      annotations: [{ id: "ann-1", code: "code-a", text: "Preamble line one." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
    {
      name: "keeps annotation within section for non-matching code",
      annotations: [{ id: "ann-1", code: "code-b", text: "Section start here." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
    {
      name: "removes annotation straddling section end boundary",
      annotations: [{ id: "ann-1", code: "code-a", text: "Section end here.\nAfter the section." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "removes annotation straddling section start boundary",
      annotations: [
        { id: "ann-1", code: "code-a", text: "Preamble line two.\nSection start here." },
      ],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "skips annotation without id",
      annotations: [{ code: "code-a", text: "Section start here." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
    {
      name: "skips annotation without code",
      annotations: [{ id: "ann-1", text: "Section start here." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
    {
      name: "removes multiple annotations for different matching codes",
      annotations: [
        { id: "ann-1", code: "code-a", text: "Section start here." },
        { id: "ann-2", code: "code-b", text: "Middle of the section." },
      ],
      codes: new Set(["code-a", "code-b"]),
      startLine: 3,
      endLine: 5,
      expected: [
        { op: "remove_annotation", match: { id: "ann-1" } },
        { op: "remove_annotation", match: { id: "ann-2" } },
      ],
    },
    {
      name: "keeps annotation for matching code outside section among removals",
      annotations: [
        { id: "ann-1", code: "code-a", text: "Section start here." },
        { id: "ann-2", code: "code-a", text: "Final line." },
      ],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "returns empty for no annotations",
      annotations: [],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
    {
      name: "returns empty when codes set is empty",
      annotations: [{ id: "ann-1", code: "code-a", text: "Section start here." }],
      codes: new Set<string>(),
      startLine: 3,
      endLine: 5,
      expected: [],
    },
  ]

  cases.forEach(({ name, annotations, codes, startLine, endLine, expected }) => {
    it(name, () =>
      expect(buildRemovalOps(annotations, content, codes, startLine, endLine)).toEqual(expected)
    )
  })
})

const vote3of3: VoteRecord = {
  find: { found: 3, missed: 0 },
  filter: { keep: 3, remove: 0 },
  removalJustification: null,
}
const vote2of3: VoteRecord = {
  find: { found: 2, missed: 1 },
  filter: { keep: 2, remove: 1 },
  removalJustification: "dissenting reason",
}

describe("vote pass-through", () => {
  const sentences = ["First.", "Second.", "Third."]

  const voteCases = [
    {
      name: "toAnalysisResults attaches vote from map",
      fn: () => {
        const spans = [{ start: 1, end: 2, analysis_source_id: "X" }]
        const reasons = new Map([["1-2-X", "reason"]])
        const votes = new Map([["1-2-X", vote2of3]])
        const results = toAnalysisResults(spans, reasons, votes)
        return results[0].vote
      },
      expected: vote2of3,
    },
    {
      name: "toAnalysisResults omits vote when map not provided",
      fn: () => {
        const spans = [{ start: 1, end: 2, analysis_source_id: "X" }]
        const reasons = new Map([["1-2-X", "reason"]])
        const results = toAnalysisResults(spans, reasons)
        return results[0].vote
      },
      expected: undefined,
    },
    {
      name: "mapResults passes vote through",
      fn: () => {
        const results = [{ start: 1, end: 1, analysis_source_id: "X", reason: "r", vote: vote3of3 }]
        return mapResults(sentences, results)[0].vote
      },
      expected: vote3of3,
    },
    {
      name: "mapResults omits vote when undefined",
      fn: () => {
        const results = [{ start: 1, end: 1, analysis_source_id: "X", reason: "r" }]
        return mapResults(sentences, results)[0].vote
      },
      expected: undefined,
    },
    {
      name: "toAnnotationOps (code) passes vote through",
      fn: () => {
        const mapped = [{ text: "t", analysis_source_id: "X", reason: "r", vote: vote2of3 }]
        return toAnnotationOps(mapped, "annotate_as_code")[0].item.vote
      },
      expected: vote2of3,
    },
    {
      name: "toAnnotationOps (comment) passes vote through",
      fn: () => {
        const mapped = [{ text: "t", analysis_source_id: "X", reason: "r", vote: vote3of3 }]
        return toAnnotationOps(mapped, "annotate_as_comment")[0].item.vote
      },
      expected: vote3of3,
    },
  ]

  voteCases.forEach(({ name, fn, expected }) => {
    it(name, () => expect(fn()).toEqual(expected))
  })
})
