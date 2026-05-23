import { describe, it, expect } from "vitest"
import {
  SECTION_MARKER,
  extractSection,
  extractLeadingContext,
  extractTrailingContext,
  extractSentenceContext,
  numberSection,
  mapResults,
  toAnnotationOps,
  toAnalysisResults,
  formatReturnOutput,
  formatAnnotateOutput,
  formatCoverage,
  isAnnotateAction,
  ABSENCE_HINT,
  type MappedResult,
  type VoteRecord,
} from "./format"
import { buildRemovalOps, type AnnotationRef } from "./step-clear"

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

describe("extractSentenceContext", () => {
  const content = [
    "First sentence here. Second sentence here.",
    "Third sentence here. Fourth sentence here.",
    "Fifth sentence here. Sixth sentence here.",
    "Seventh sentence here. Eighth sentence here.",
    "Ninth sentence here. Tenth sentence here.",
  ].join("\n")

  const cases = [
    {
      name: "extracts leading and trailing sentences",
      startLine: 3,
      endLine: 3,
      n: 2,
      leadingContains: "Third sentence here.",
      trailingContains: "Seventh sentence here.",
      leadingNotContains: "First sentence here.",
      trailingNotContains: "Tenth sentence here.",
    },
    {
      name: "returns empty when n is 0",
      startLine: 3,
      endLine: 3,
      n: 0,
      leadingContains: null,
      trailingContains: null,
      leadingNotContains: null,
      trailingNotContains: null,
    },
    {
      name: "returns empty leading at file start",
      startLine: 1,
      endLine: 1,
      n: 3,
      leadingContains: null,
      trailingContains: "Third sentence here.",
      leadingNotContains: null,
      trailingNotContains: null,
    },
    {
      name: "returns empty trailing at file end",
      startLine: 5,
      endLine: 5,
      n: 3,
      leadingContains: "Eighth sentence here.",
      trailingContains: null,
      leadingNotContains: null,
      trailingNotContains: null,
    },
  ]

  cases.forEach(
    ({
      name,
      startLine,
      endLine,
      n,
      leadingContains,
      trailingContains,
      leadingNotContains,
      trailingNotContains,
    }) => {
      it(name, () => {
        const ctx = extractSentenceContext(content, startLine, endLine, n)
        if (n === 0) {
          expect(ctx.leading).toBe("")
          expect(ctx.trailing).toBe("")
          return
        }
        if (leadingContains) expect(ctx.leading).toContain(leadingContains)
        if (trailingContains) expect(ctx.trailing).toContain(trailingContains)
        if (startLine === 1) expect(ctx.leading).toBe("")
        if (endLine === 5) expect(ctx.trailing).toBe("")
        if (leadingNotContains) expect(ctx.leading).not.toContain(leadingNotContains)
        if (trailingNotContains) expect(ctx.trailing).not.toContain(trailingNotContains)
      })
    }
  )
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
      numberedNotContains: null,
    },
    {
      name: "excludes section markers from sentences but keeps as context",
      text: `First sentence. Second sentence.\n\n${SECTION_MARKER}file.md [10-10]\n\nThird sentence.`,
      expectedCount: 3,
      numberedContains: "3: Third sentence.",
      numberedNotContains: "4:",
    },
  ]

  cases.forEach(({ name, text, expectedCount, numberedContains, numberedNotContains }) => {
    it(name, () => {
      const result = numberSection(text)
      expect(result.sentences).toHaveLength(expectedCount)
      if (numberedContains) expect(result.numbered).toContain(numberedContains)
      if (numberedNotContains) expect(result.numbered).not.toContain(numberedNotContains)
    })
  })

  it("marker lines appear unnumbered in output", () => {
    const marker = `${SECTION_MARKER}file.md [5-5]`
    const text = `Hello world.\n\n${marker}\n\nGoodbye world.`
    const result = numberSection(text)
    expect(result.numbered).toContain(marker)
    expect(result.sentences).not.toContain(marker)
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
      results: [] as MappedResult[],
      startLine: 10,
      endLine: 50,
      sectionTextLength: 0,
      warnings: [] as string[],
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
      sectionTextLength: 0,
      warnings: [] as string[],
      expected: '- [code_1] "Some text": because\n- [code_2] "Other text": also',
    },
    {
      name: "appends warnings when present",
      results: [{ text: "Some text", analysis_source_id: "code_1", reason: "because" }],
      startLine: 1,
      endLine: 10,
      sectionTextLength: 0,
      warnings: ["find: LLM returned no text response"],
      expected:
        '- [code_1] "Some text": because\n\n⚠ Degraded: 1 model call(s) failed and were dropped. Results are based on fewer voters.\n- find: LLM returned no text response',
    },
    {
      name: "appends warnings to absence output",
      results: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      sectionTextLength: 0,
      warnings: ["filter: connection dropped"],
      expected: `Lines 5-20 analyzed. No matches found.${ABSENCE_HINT}\n\n⚠ Degraded: 1 model call(s) failed and were dropped. Results are based on fewer voters.\n- filter: connection dropped`,
    },
    {
      name: "prepends coverage when sectionTextLength provided",
      results: [
        { text: "Some text", analysis_source_id: "code_1", reason: "because" },
        { text: "Other text", analysis_source_id: "code_2", reason: "also" },
      ],
      startLine: 1,
      endLine: 10,
      sectionTextLength: 100,
      warnings: [] as string[],
      expected:
        'Coverage: 19% of text — code_1: 9%, code_2: 10%\n\n- [code_1] "Some text": because\n- [code_2] "Other text": also',
    },
  ]

  cases.forEach(({ name, results, startLine, endLine, sectionTextLength, warnings, expected }) => {
    it(name, () =>
      expect(formatReturnOutput(results, startLine, endLine, sectionTextLength, warnings)).toBe(
        expected
      )
    )
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
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results for comment includes absence hint",
      action: "annotate_as_comment" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results include absence hint text",
      action: "annotate_as_code" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: "Absence is data.",
    },
    {
      name: "code annotations include count and results",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: "2 code annotation(s) written. Do not re-apply these.",
    },
    {
      name: "comment annotations include count and results",
      action: "annotate_as_comment" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: "2 comment annotation(s) written. Do not re-apply these.",
    },
    {
      name: "includes result details",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      sectionTextLength: 0,
      warnings: [] as string[],
      contains: '- [code_1] "Some text": because',
    },
    {
      name: "warnings appended to annotation output",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      sectionTextLength: 0,
      warnings: ["find: timeout"],
      contains: "Degraded: 1 model call(s) failed",
    },
    {
      name: "warnings appended to empty annotation output",
      action: "annotate_as_code" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      sectionTextLength: 0,
      warnings: ["filter: connection reset"],
      contains: "filter: connection reset",
    },
    {
      name: "coverage prepended when sectionTextLength provided",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      sectionTextLength: 100,
      warnings: [] as string[],
      contains: "Coverage: 19% of text — code_1: 9%, code_2: 10%",
    },
  ]

  cases.forEach(
    ({ name, action, input, startLine, endLine, sectionTextLength, warnings, contains }) => {
      it(name, () =>
        expect(
          formatAnnotateOutput(input, action, startLine, endLine, sectionTextLength, warnings)
        ).toContain(contains)
      )
    }
  )
})

describe("formatCoverage", () => {
  const cases = [
    {
      name: "empty results returns empty",
      results: [] as MappedResult[],
      sectionTextLength: 100,
      expected: "",
    },
    {
      name: "zero section length returns empty",
      results: [{ text: "Some text", analysis_source_id: "code_1", reason: "r" }],
      sectionTextLength: 0,
      expected: "",
    },
    {
      name: "single code computes percentage",
      results: [{ text: "Hello world", analysis_source_id: "code_1", reason: "r" }],
      sectionTextLength: 100,
      expected: "Coverage: 11% of text — code_1: 11%",
    },
    {
      name: "multiple codes with breakdown",
      results: [
        { text: "Hello world", analysis_source_id: "code_1", reason: "r" },
        { text: "Goodbye", analysis_source_id: "code_2", reason: "r" },
      ],
      sectionTextLength: 100,
      expected: "Coverage: 18% of text — code_1: 11%, code_2: 7%",
    },
    {
      name: "same code aggregates char lengths",
      results: [
        { text: "Hello", analysis_source_id: "code_1", reason: "r1" },
        { text: "World", analysis_source_id: "code_1", reason: "r2" },
      ],
      sectionTextLength: 100,
      expected: "Coverage: 10% of text — code_1: 10%",
    },
  ]

  cases.forEach(({ name, results, sectionTextLength, expected }) => {
    it(name, () => expect(formatCoverage(results, sectionTextLength)).toBe(expected))
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
      name: "removes annotation straddling section end via expanded blob",
      annotations: [{ id: "ann-1", code: "code-a", text: "Section end here.\nAfter the section." }],
      codes: new Set(["code-a"]),
      startLine: 3,
      endLine: 5,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "removes annotation straddling section start via expanded blob",
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

describe("buildRemovalOps expanded blob", () => {
  const expandedContent = [
    "Far above one.",
    "Far above two.",
    "Far above three.",
    "Far above four.",
    "Far above five.",
    "Pad before one.",
    "Pad before two.",
    "Pad before three.",
    "Pad before four.",
    "Section alpha.",
    "Section beta.",
    "Section gamma.",
    "Pad after one.",
    "Pad after two.",
    "Pad after three.",
    "Pad after four.",
    "Far below one.",
    "Far below two.",
  ].join("\n")

  const expandedCases: {
    name: string
    annotations: AnnotationRef[]
    codes: Set<string>
    startLine: number
    endLine: number
    expected: { op: "remove_annotation"; match: { id: string } }[]
  }[] = [
    {
      name: "removes annotation straddling section end into padding",
      annotations: [{ id: "ann-1", code: "code-a", text: "Section gamma. Pad after one." }],
      codes: new Set(["code-a"]),
      startLine: 10,
      endLine: 12,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "removes annotation straddling section start from padding",
      annotations: [{ id: "ann-1", code: "code-a", text: "Pad before four. Section alpha." }],
      codes: new Set(["code-a"]),
      startLine: 10,
      endLine: 12,
      expected: [{ op: "remove_annotation", match: { id: "ann-1" } }],
    },
    {
      name: "keeps annotation entirely in padding before section",
      annotations: [{ id: "ann-1", code: "code-a", text: "Pad before one." }],
      codes: new Set(["code-a"]),
      startLine: 10,
      endLine: 12,
      expected: [],
    },
    {
      name: "keeps annotation entirely in padding after section",
      annotations: [{ id: "ann-1", code: "code-a", text: "Pad after four." }],
      codes: new Set(["code-a"]),
      startLine: 10,
      endLine: 12,
      expected: [],
    },
    {
      name: "keeps annotation beyond expansion range",
      annotations: [{ id: "ann-1", code: "code-a", text: "Far above one." }],
      codes: new Set(["code-a"]),
      startLine: 10,
      endLine: 12,
      expected: [],
    },
  ]

  expandedCases.forEach(({ name, annotations, codes, startLine, endLine, expected }) => {
    it(name, () =>
      expect(buildRemovalOps(annotations, expandedContent, codes, startLine, endLine)).toEqual(
        expected
      )
    )
  })
})

const vote3of3: VoteRecord = {
  find: { found: 3, missed: 0 },
}
const vote2of3: VoteRecord = {
  find: { found: 2, missed: 1 },
  review: "dissenting reason",
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
