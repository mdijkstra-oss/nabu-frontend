import { describe, it, expect } from "vitest"
import type { ScoredChunk } from "./fusion"
import type { CutoffBand, JudgeFn } from "./relevance-cutoff"
import {
  sampleAtQuintiles,
  findCutoffBand,
  findRelevanceCutoff,
  SAMPLES_PER_PROBE,
} from "./relevance-cutoff"

const items100 = Array.from({ length: 100 }, (_, i) => i)

describe("sampleAtQuintiles", () => {
  const cases: {
    name: string
    items: number[]
    band: CutoffBand
    samplesPerProbe: number
    expectedPositions: number[]
    expectedGroupCount: number
  }[] = [
    {
      name: "100 items, full band → probes at 20/40/60/80",
      items: items100,
      band: { lo: 0, hi: 100 },
      samplesPerProbe: 5,
      expectedPositions: [20, 40, 60, 80],
      expectedGroupCount: 4,
    },
    {
      name: "sub-band 10..50 → probes at 18/26/34/42",
      items: items100,
      band: { lo: 10, hi: 50 },
      samplesPerProbe: 5,
      expectedPositions: [18, 26, 34, 42],
      expectedGroupCount: 4,
    },
    {
      name: "band at end of array",
      items: items100,
      band: { lo: 80, hi: 100 },
      samplesPerProbe: 5,
      expectedPositions: [84, 88, 92, 96],
      expectedGroupCount: 4,
    },
    {
      name: "band at start of array",
      items: items100,
      band: { lo: 0, hi: 20 },
      samplesPerProbe: 5,
      expectedPositions: [4, 8, 12, 16],
      expectedGroupCount: 4,
    },
    {
      name: "empty band returns no groups",
      items: items100,
      band: { lo: 50, hi: 50 },
      samplesPerProbe: 5,
      expectedPositions: [],
      expectedGroupCount: 0,
    },
    {
      name: "band smaller than 4 probes still samples what it can",
      items: items100,
      band: { lo: 0, hi: 8 },
      samplesPerProbe: 5,
      expectedPositions: [1, 3, 4, 6],
      expectedGroupCount: 4,
    },
  ]

  it.each(cases)(
    "$name",
    ({ items, band, samplesPerProbe, expectedPositions, expectedGroupCount }) => {
      const groups = sampleAtQuintiles(items, band, samplesPerProbe)
      expect(groups).toHaveLength(expectedGroupCount)
      expect(groups.map((g) => g.position)).toEqual(expectedPositions)

      for (const group of groups) {
        expect(group.items.length).toBeGreaterThan(0)
        expect(group.items.length).toBeLessThanOrEqual(samplesPerProbe)
      }
    }
  )

  it("each group contains items from the correct region", () => {
    const groups = sampleAtQuintiles(items100, { lo: 0, hi: 100 }, 5)
    for (const group of groups) {
      for (const item of group.items) {
        const distance = Math.abs(item - group.position)
        expect(distance).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe("findCutoffBand", () => {
  const cases: {
    name: string
    judgments: boolean[][]
    positions: number[]
    outerBand: CutoffBand
    expected: CutoffBand
  }[] = [
    {
      name: "all true → band extends from last position to outer hi",
      judgments: [
        [true, true],
        [true, true],
        [true, true],
        [true, true],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 80, hi: 100 },
    },
    {
      name: "all false → band from outer lo to first position",
      judgments: [
        [false, false],
        [false, false],
        [false, false],
        [false, false],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 0, hi: 20 },
    },
    {
      name: "transition at p40 → band between p20 and p40",
      judgments: [
        [true, true, true],
        [true, true, true],
        [false, false, true],
        [false, false, false],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 40, hi: 60 },
    },
    {
      name: "transition at p20 → band between outer lo and p20",
      judgments: [
        [true, true, true],
        [false, false, false],
        [false, false, false],
        [false, false, false],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 20, hi: 40 },
    },
    {
      name: "first probe false → band from outer lo to first position",
      judgments: [
        [false, false, false],
        [false, false, false],
        [false, false, false],
        [false, false, false],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 0, hi: 20 },
    },
    {
      name: "mixed majority at p60 → majority determines transition",
      judgments: [
        [true, true, true],
        [true, true, true],
        [true, true, true],
        [true, false, false],
      ],
      positions: [20, 40, 60, 80],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 60, hi: 80 },
    },
    {
      name: "empty judgments returns outer band",
      judgments: [],
      positions: [],
      outerBand: { lo: 0, hi: 100 },
      expected: { lo: 0, hi: 100 },
    },
  ]

  it.each(cases)("$name", ({ judgments, positions, outerBand, expected }) => {
    expect(findCutoffBand(judgments, positions, outerBand)).toEqual(expected)
  })
})

describe("findRelevanceCutoff", () => {
  const makeChunk = (i: number): ScoredChunk => ({
    file: `file-${i}.md`,
    text: `text-${i}`,
    score: 1 - i / 200,
  })

  const cases: {
    name: string
    count: number
    relevantBelow: number
    expectNear: number
    tolerance: number
  }[] = [
    {
      name: "cutoff at 50 in a 200-item list converges near 50",
      count: 200,
      relevantBelow: 50,
      expectNear: 50,
      tolerance: SAMPLES_PER_PROBE + 1,
    },
    {
      name: "cutoff at 10 in a 100-item list converges near 10",
      count: 100,
      relevantBelow: 10,
      expectNear: 10,
      tolerance: SAMPLES_PER_PROBE + 1,
    },
    {
      name: "all relevant → cutoff near end",
      count: 100,
      relevantBelow: 100,
      expectNear: 80,
      tolerance: 25,
    },
    {
      name: "none relevant → cutoff at 0",
      count: 100,
      relevantBelow: 0,
      expectNear: 0,
      tolerance: SAMPLES_PER_PROBE + 1,
    },
    {
      name: "empty list → cutoff at 0",
      count: 0,
      relevantBelow: 0,
      expectNear: 0,
      tolerance: 0,
    },
  ]

  it.each(cases)("$name", async ({ count, relevantBelow, expectNear, tolerance }) => {
    const ranked = Array.from({ length: count }, (_, i) => makeChunk(i))

    const deterministicJudge: JudgeFn = async (_intent, snippets) =>
      snippets.map((s) => {
        const idx = parseInt(s.replace("text-", ""), 10)
        return idx < relevantBelow
      })

    const cutoff = await findRelevanceCutoff(ranked, "test intent", deterministicJudge)
    expect(Math.abs(cutoff - expectNear)).toBeLessThanOrEqual(tolerance)
  })

  it("calls judge with flattened snippets from all probes", async () => {
    const ranked = Array.from({ length: 100 }, (_, i) => makeChunk(i))
    const receivedSnippets: string[][] = []

    const capturingJudge: JudgeFn = async (_intent, snippets) => {
      receivedSnippets.push([...snippets])
      return snippets.map(() => true)
    }

    await findRelevanceCutoff(ranked, "test intent", capturingJudge)

    expect(receivedSnippets.length).toBeGreaterThan(0)
    for (const batch of receivedSnippets) {
      expect(batch.length).toBe(SAMPLES_PER_PROBE * 4)
    }
  })
})
