import { describe, it, expect } from "vitest"
import {
  computeCohenKappa,
  computeFleissKappa,
  computeKrippendorffAlpha,
  computeUnitizingAlpha,
  computePairwiseOverlapF1,
  compareRuns,
  buildAgreementMatrix,
} from "./kappa"
import type { SectionResult } from "./types"

describe("computeCohenKappa", () => {
  const cases: {
    name: string
    a: boolean[]
    b: boolean[]
    expected: { kappa: number; po: number }
  }[] = [
    {
      name: "perfect agreement — all true",
      a: [true, true, true, true],
      b: [true, true, true, true],
      expected: { kappa: 1, po: 1 },
    },
    {
      name: "perfect agreement — mixed",
      a: [true, false, true, false],
      b: [true, false, true, false],
      expected: { kappa: 1, po: 1 },
    },
    {
      name: "total disagreement",
      a: [true, true, false, false],
      b: [false, false, true, true],
      expected: { kappa: -1, po: 0 },
    },
    {
      name: "chance-level agreement",
      a: [true, true, false, false],
      b: [true, false, true, false],
      expected: { kappa: 0, po: 0.5 },
    },
    {
      name: "empty arrays",
      a: [],
      b: [],
      expected: { kappa: 1, po: 1 },
    },
    {
      name: "high agreement",
      a: [true, true, true, false, false, true, true, false, false, false],
      b: [true, true, true, false, false, true, false, false, false, false],
      expected: { kappa: 0.8, po: 0.9 },
    },
  ]

  for (const { name, a, b, expected } of cases) {
    it(name, () => {
      const result = computeCohenKappa(a, b)
      expect(result.observedAgreement).toBeCloseTo(expected.po, 3)
      expect(result.kappa).toBeCloseTo(expected.kappa, 2)
    })
  }
})

describe("computeFleissKappa", () => {
  const cases: {
    name: string
    matrix: boolean[][]
    expected: { kappa: number }
  }[] = [
    {
      name: "perfect agreement — 3 raters all agree true",
      matrix: [
        [true, true, true],
        [true, true, true],
      ],
      expected: { kappa: 1 },
    },
    {
      name: "perfect agreement — 3 raters all agree mixed",
      matrix: [
        [true, true, true],
        [false, false, false],
        [true, true, true],
      ],
      expected: { kappa: 1 },
    },
    {
      name: "no agreement beyond chance — 2 raters",
      matrix: [
        [true, false],
        [false, true],
        [true, false],
        [false, true],
      ],
      expected: { kappa: -1 },
    },
    {
      name: "empty matrix",
      matrix: [],
      expected: { kappa: 1 },
    },
    {
      name: "single rater",
      matrix: [[true], [false], [true]],
      expected: { kappa: 1 },
    },
  ]

  for (const { name, matrix, expected } of cases) {
    it(name, () => {
      const result = computeFleissKappa(matrix)
      expect(result.kappa).toBeCloseTo(expected.kappa, 2)
    })
  }
})

describe("computeKrippendorffAlpha", () => {
  const cases: {
    name: string
    matrix: boolean[][]
    expected: { alpha: number }
  }[] = [
    {
      name: "perfect agreement — all true",
      matrix: [
        [true, true, true],
        [true, true, true],
      ],
      expected: { alpha: 1 },
    },
    {
      name: "perfect agreement — mixed",
      matrix: [
        [true, true, true],
        [false, false, false],
        [true, true, true],
      ],
      expected: { alpha: 1 },
    },
    {
      name: "total disagreement — 2 raters inverted",
      matrix: [
        [true, false],
        [false, true],
        [true, false],
        [false, true],
      ],
      expected: { alpha: -0.75 },
    },
    {
      name: "empty matrix",
      matrix: [],
      expected: { alpha: 1 },
    },
    {
      name: "single rater",
      matrix: [[true], [false], [true]],
      expected: { alpha: 1 },
    },
    {
      name: "moderate agreement — 3 raters with some disagreement",
      matrix: [
        [true, true, false],
        [true, true, true],
        [false, false, false],
        [true, false, true],
      ],
      expected: { alpha: 0.371 },
    },
  ]

  for (const { name, matrix, expected } of cases) {
    it(name, () => {
      const result = computeKrippendorffAlpha(matrix)
      expect(result.alpha).toBeCloseTo(expected.alpha, 2)
    })
  }
})

describe("computePairwiseOverlapF1", () => {
  const cases: {
    name: string
    runs: SectionResult[][]
    expected: { f1: number }
  }[] = [
    {
      name: "identical runs — perfect F1",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
      ],
      expected: { f1: 1 },
    },
    {
      name: "overlapping spans — same code",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 2, end: 5, analysis_source_id: "code-a", reason: "" }] }],
      ],
      expected: { f1: 1 },
    },
    {
      name: "non-overlapping spans — same code",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 2, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 4, end: 5, analysis_source_id: "code-a", reason: "" }] }],
      ],
      expected: { f1: 0 },
    },
    {
      name: "overlapping spans — different codes",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-b", reason: "" }] }],
      ],
      expected: { f1: 0 },
    },
    {
      name: "different sections — same code + range",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 100, endLine: 150, sentenceCount: 10, results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }] }],
      ],
      expected: { f1: 0 },
    },
    {
      name: "boundary wobble — adjacent sentences still overlap",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 3, end: 5, analysis_source_id: "code-a", reason: "" }] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [{ start: 5, end: 7, analysis_source_id: "code-a", reason: "" }] }],
      ],
      expected: { f1: 1 },
    },
    {
      name: "empty runs",
      runs: [
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [] }],
        [{ startLine: 1, endLine: 50, sentenceCount: 10, results: [] }],
      ],
      expected: { f1: 1 },
    },
  ]

  for (const { name, runs, expected } of cases) {
    it(name, () => {
      const result = computePairwiseOverlapF1(runs)
      expect(result.overall.f1).toBeCloseTo(expected.f1, 2)
    })
  }

  it("reports per-code F1", () => {
    const runs: SectionResult[][] = [
      [{
        startLine: 1, endLine: 50, sentenceCount: 10,
        results: [
          { start: 1, end: 3, analysis_source_id: "code-a", reason: "" },
          { start: 5, end: 7, analysis_source_id: "code-b", reason: "" },
        ],
      }],
      [{
        startLine: 1, endLine: 50, sentenceCount: 10,
        results: [
          { start: 2, end: 4, analysis_source_id: "code-a", reason: "" },
          { start: 8, end: 9, analysis_source_id: "code-b", reason: "" },
        ],
      }],
    ]

    const result = computePairwiseOverlapF1(runs)
    const codeA = result.perCode.find((pc) => pc.code === "code-a")
    const codeB = result.perCode.find((pc) => pc.code === "code-b")

    expect(codeA?.f1).toBeCloseTo(1, 2)
    expect(codeB?.f1).toBeCloseTo(0, 2)
  })
})

describe("computeUnitizingAlpha", () => {
  const section = (sentenceCount: number, results: SectionResult["results"]): SectionResult[] => [
    { startLine: 1, endLine: sentenceCount, sentenceCount, results },
  ]

  const cases: {
    name: string
    runs: SectionResult[][]
    expected: { alpha: number }
  }[] = [
    {
      name: "identical spans — perfect agreement",
      runs: [
        section(10, [{ start: 3, end: 5, analysis_source_id: "code-a", reason: "" }]),
        section(10, [{ start: 3, end: 5, analysis_source_id: "code-a", reason: "" }]),
      ],
      expected: { alpha: 1 },
    },
    {
      name: "1-sentence boundary wobble — high agreement",
      runs: [
        section(10, [{ start: 3, end: 5, analysis_source_id: "code-a", reason: "" }]),
        section(10, [{ start: 3, end: 6, analysis_source_id: "code-a", reason: "" }]),
      ],
      expected: { alpha: 0.862 },
    },
    {
      name: "non-overlapping spans — negative agreement",
      runs: [
        section(10, [{ start: 1, end: 2, analysis_source_id: "code-a", reason: "" }]),
        section(10, [{ start: 8, end: 10, analysis_source_id: "code-a", reason: "" }]),
      ],
      expected: { alpha: -0.484 },
    },
    {
      name: "empty runs — perfect agreement",
      runs: [
        section(10, []),
        section(10, []),
      ],
      expected: { alpha: 1 },
    },
    {
      name: "single rater",
      runs: [
        section(10, [{ start: 1, end: 5, analysis_source_id: "code-a", reason: "" }]),
      ],
      expected: { alpha: 1 },
    },
  ]

  for (const { name, runs, expected } of cases) {
    it(name, () => {
      const result = computeUnitizingAlpha(runs)
      expect(result.alpha).toBeCloseTo(expected.alpha, 2)
    })
  }
})

describe("buildAgreementMatrix", () => {
  it("builds matrix from section results", () => {
    const run1: SectionResult[] = [
      {
        startLine: 1,
        endLine: 50,
        sentenceCount: 10,
        results: [
          { start: 1, end: 3, analysis_source_id: "code-a", reason: "" },
          { start: 5, end: 5, analysis_source_id: "code-b", reason: "" },
        ],
      },
    ]

    const run2: SectionResult[] = [
      {
        startLine: 1,
        endLine: 50,
        sentenceCount: 10,
        results: [
          { start: 1, end: 3, analysis_source_id: "code-a", reason: "" },
          { start: 7, end: 8, analysis_source_id: "code-b", reason: "" },
        ],
      },
    ]

    const matrix = buildAgreementMatrix([run1, run2])

    expect(matrix.codes).toContain("code-a")
    expect(matrix.codes).toContain("code-b")
    expect(matrix.ratings.length).toBeGreaterThan(0)
    expect(matrix.ratings[0].length).toBe(2)
  })
})

describe("compareRuns", () => {
  it("returns perfect scores for identical runs", () => {
    const sections: SectionResult[] = [
      {
        startLine: 1,
        endLine: 50,
        sentenceCount: 10,
        results: [
          { start: 1, end: 3, analysis_source_id: "code-a", reason: "" },
          { start: 5, end: 7, analysis_source_id: "code-b", reason: "" },
        ],
      },
    ]

    const result = compareRuns([sections, sections, sections])

    expect(result.fleiss.kappa).toBe(1)
    expect(result.alpha.alpha).toBe(1)
    expect(result.cuAlpha.alpha).toBe(1)
    expect(result.overlapF1.overall.f1).toBe(1)
    expect(result.raters).toBe(3)
    expect(result.volatility.every((v) => v.disagreementRate === 0)).toBe(true)
  })

  it("detects volatility for differing runs", () => {
    const run1: SectionResult[] = [
      {
        startLine: 1,
        endLine: 50,
        sentenceCount: 10,
        results: [{ start: 1, end: 3, analysis_source_id: "code-a", reason: "" }],
      },
    ]

    const run2: SectionResult[] = [
      {
        startLine: 1,
        endLine: 50,
        sentenceCount: 10,
        results: [{ start: 5, end: 7, analysis_source_id: "code-b", reason: "" }],
      },
    ]

    const result = compareRuns([run1, run2])

    expect(result.fleiss.kappa).toBeLessThan(1)
    expect(result.overlapF1.overall.f1).toBe(0)
    expect(result.volatility.length).toBeGreaterThan(0)
  })
})
