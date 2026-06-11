import { describe, it, expect } from "vitest"
import {
  SECTION_MARKER,
  extractSection,
  extractLeadingContext,
  extractTrailingContext,
  numberSectionWithPositions,
  mapResults,
  toAnnotationOps,
  toAnalysisResults,
  formatReturnOutput,
  formatAnnotateOutput,
  isAnnotateAction,
  ABSENCE_HINT,
  countConfidence,
  buildSynthesisDirective,
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

describe("numberSectionWithPositions", () => {
  const cases = [
    {
      name: "splits on sentence boundaries",
      text: "First sentence. Second sentence. Third.",
      expectedCount: 3,
    },
    {
      name: "splits on newlines",
      text: "Line one\nLine two",
      expectedCount: 2,
    },
    {
      name: "empty text",
      text: "",
      expectedCount: 0,
    },
    {
      name: "excludes section markers from sentences",
      text: `First sentence. Second sentence.\n\n${SECTION_MARKER}file.md [10-10]\n\nThird sentence.`,
      expectedCount: 3,
    },
  ]

  cases.forEach(({ name, text, expectedCount }) => {
    it(name, () => {
      const result = numberSectionWithPositions(text)
      expect(result.sentences).toHaveLength(expectedCount)
      expect(result.positions).toHaveLength(expectedCount)
    })
  })

  it("positions track sentence start offsets", () => {
    const text = "First. Second."
    const result = numberSectionWithPositions(text)
    expect(result.positions[0].start).toBe(0)
    expect(result.positions[1].start).toBe(text.indexOf("Second."))
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
      name: "empty mapped returns no ops (clear-only path produces no adds)",
      mapped: [] as MappedResult[],
      action: "annotate_as_code" as const,
      expected: [],
    },
    {
      name: "empty mapped returns no ops for comment action",
      mapped: [] as MappedResult[],
      action: "annotate_as_comment" as const,
      expected: [],
    },
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
      warnings: [] as string[],
      expected: '- [code_1] "Some text": because\n- [code_2] "Other text": also',
    },
    {
      name: "appends warnings when present",
      results: [{ text: "Some text", analysis_source_id: "code_1", reason: "because" }],
      startLine: 1,
      endLine: 10,
      warnings: ["find: LLM returned no text response"],
      expected:
        '- [code_1] "Some text": because\n\n⚠ Degraded: 1 model call(s) failed and were dropped. Results are based on fewer voters.\n- find: LLM returned no text response',
    },
    {
      name: "appends warnings to absence output",
      results: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      warnings: ["filter: connection dropped"],
      expected: `Lines 5-20 analyzed. No matches found.${ABSENCE_HINT}\n\n⚠ Degraded: 1 model call(s) failed and were dropped. Results are based on fewer voters.\n- filter: connection dropped`,
    },
  ]

  cases.forEach(({ name, results, startLine, endLine, warnings, expected }) => {
    it(name, () => expect(formatReturnOutput(results, startLine, endLine, warnings)).toBe(expected))
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
      warnings: [] as string[],
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results for comment includes absence hint",
      action: "annotate_as_comment" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      warnings: [] as string[],
      contains: "Lines 5-20 analyzed. No matches found. No annotations written.",
    },
    {
      name: "empty results include absence hint text",
      action: "annotate_as_code" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      warnings: [] as string[],
      contains: "Absence is data.",
    },
    {
      name: "code annotations include count and results",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      warnings: [] as string[],
      contains: "2 code annotation(s) written. Do not re-apply these.",
    },
    {
      name: "comment annotations include count and results",
      action: "annotate_as_comment" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      warnings: [] as string[],
      contains: "2 comment annotation(s) written. Do not re-apply these.",
    },
    {
      name: "includes result details",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      warnings: [] as string[],
      contains: '- [code_1] "Some text": because',
    },
    {
      name: "warnings appended to annotation output",
      action: "annotate_as_code" as const,
      input: results,
      startLine: 1,
      endLine: 10,
      warnings: ["find: timeout"],
      contains: "Degraded: 1 model call(s) failed",
    },
    {
      name: "warnings appended to empty annotation output",
      action: "annotate_as_code" as const,
      input: [] as MappedResult[],
      startLine: 5,
      endLine: 20,
      warnings: ["filter: connection reset"],
      contains: "filter: connection reset",
    },
  ]

  cases.forEach(({ name, action, input, startLine, endLine, warnings, contains }) => {
    it(name, () =>
      expect(formatAnnotateOutput(input, action, startLine, endLine, warnings)).toContain(contains)
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

describe("countConfidence", () => {
  const mk = (review?: string): MappedResult => ({
    text: "x",
    analysis_source_id: "c",
    reason: "r",
    vote: { find: { found: 1, missed: 0 }, ...(review ? { review } : {}) },
  })

  const cases: {
    name: string
    results: MappedResult[]
    expected: { confirmed: number; reviewed: number }
  }[] = [
    { name: "empty", results: [], expected: { confirmed: 0, reviewed: 0 } },
    { name: "all confirmed", results: [mk(), mk(), mk()], expected: { confirmed: 3, reviewed: 0 } },
    {
      name: "all reviewed",
      results: [mk("flag"), mk("flag")],
      expected: { confirmed: 0, reviewed: 2 },
    },
    {
      name: "mixed",
      results: [mk(), mk("flag"), mk(), mk("flag"), mk()],
      expected: { confirmed: 3, reviewed: 2 },
    },
    {
      name: "no vote treated as confirmed",
      results: [{ text: "x", analysis_source_id: "c", reason: "r" }],
      expected: { confirmed: 1, reviewed: 0 },
    },
  ]

  cases.forEach(({ name, results, expected }) => {
    it(name, () => expect(countConfidence(results)).toEqual(expected))
  })
})

describe("buildSynthesisDirective", () => {
  const cases: {
    name: string
    confirmed: number
    reviewed: number
    expect: "empty" | "high" | "mid" | "low"
  }[] = [
    { name: "zero annotations returns empty", confirmed: 0, reviewed: 0, expect: "empty" },
    { name: "ratio >= 0.7 picks high (RQ branch)", confirmed: 7, reviewed: 3, expect: "high" },
    { name: "ratio at boundary 0.7 picks high", confirmed: 7, reviewed: 3, expect: "high" },
    { name: "ratio 0.4-0.7 picks mid", confirmed: 5, reviewed: 5, expect: "mid" },
    { name: "ratio at boundary 0.4 picks mid", confirmed: 2, reviewed: 3, expect: "mid" },
    {
      name: "ratio < 0.4 picks low (disagreement focus)",
      confirmed: 1,
      reviewed: 9,
      expect: "low",
    },
    { name: "all confirmed picks high", confirmed: 10, reviewed: 0, expect: "high" },
    { name: "all reviewed picks low", confirmed: 0, reviewed: 5, expect: "low" },
  ]

  cases.forEach(({ name, confirmed, reviewed, expect: tier }) => {
    it(name, () => {
      const out = buildSynthesisDirective(confirmed, reviewed)
      if (tier === "empty") {
        expect(out).toBe("")
        return
      }
      expect(out).toContain("## Synthesis directive")
      if (tier === "high") expect(out).toContain("Research Questions")
      if (tier === "mid") {
        expect(out).toContain("Integrated findings section")
        expect(out).not.toContain("Research Questions")
        expect(out).not.toContain("disagreement pattern")
      }
      if (tier === "low") expect(out).toContain("disagreement pattern")
    })
  })
})
