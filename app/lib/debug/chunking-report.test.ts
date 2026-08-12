import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { UNIT_CEILING_CHARS, UNIT_FLOOR_CHARS } from "~/lib/cutting/constants"
import { cutUnits } from "~/lib/cutting/units"
import { indexProseSentences, proseOf, type SentenceRow } from "~/lib/text/halo"
import {
  analyzeDocument,
  collectWarnings,
  DEFAULT_SETTINGS,
  ruleOf,
  distributionOf,
  insertionPoints,
  probeStability,
  PROBE_SENTENCE,
  reportUnits,
  sharedHashCount,
  sweepMasks,
} from "./chunking-report"
import { maskOfBits } from "~/lib/cutting/constants"
import { ruleWith } from "~/lib/cutting/test-documents"

const paragraph = (index: number): string =>
  `Chapter ${index} opens on a road that climbs past the quarry and the old signal box. ` +
  `The surveyor writes down what the light does to the water at ${index} o'clock. ` +
  `Nobody in the valley remembers who paid for the bridge, only that it was ${index} winters ago. ` +
  `A cart with ${index} loose wheels goes by, and the dog barks at it as though it were new.`

const DOCUMENT = Array.from({ length: 12 }, (_, index) => paragraph(index + 1)).join("\n\n")

const analyze = (raw: string) => analyzeDocument("doc.md", raw)

const cutHashes = (prose: string): string[] =>
  cutUnits(prose, indexProseSentences(prose)).map((unit) => unit.hash)

const countingIntersection = (before: readonly string[], after: readonly string[]): number => {
  const pool = [...before]
  let shared = 0
  for (const hash of after) {
    const at = pool.indexOf(hash)
    if (at === -1) continue
    pool.splice(at, 1)
    shared++
  }
  return shared
}

describe("distributionOf", () => {
  const cases = [
    { name: "odd length", values: [50, 10, 30, 40, 20], mean: 30, percentiles: [10, 30, 50, 50] },
    { name: "even length", values: [40, 10, 30, 20], mean: 25, percentiles: [10, 20, 40, 40] },
    { name: "single value", values: [7], mean: 7, percentiles: [7, 7, 7, 7] },
  ]

  it.each(cases)("reports $name", ({ values, mean, percentiles }) => {
    expect(distributionOf(values)).toEqual({ count: values.length, mean, percentiles })
  })

  it("reports no percentiles for an empty list", () => {
    expect(distributionOf([])).toEqual({ count: 0, mean: 0, percentiles: null })
  })
})

describe("sweepMasks", () => {
  const document = analyze(DOCUMENT)

  it.each([2, 3, 4, 5, 6])("reports the cutter's own units at %i bits", (bits) => {
    const [sweep] = sweepMasks([document], DEFAULT_SETTINGS, [bits])
    const expected = cutUnits(
      document.prose,
      document.rows,
      ruleOf({ ...DEFAULT_SETTINGS, looseBits: bits })
    )

    expect(sweep.mask).toBe(maskOfBits(bits))
    expect(sweep.units.map((report) => report.unit)).toEqual(expected)
  })
})

describe("probeStability", () => {
  const document = analyze(DOCUMENT)
  const points = insertionPoints(document)

  it.each([
    { name: "top of the document", at: points.top },
    { name: "midpoint of the document", at: points.midpoint },
  ])("counts hashes present in both runs after an insertion at the $name", ({ at }) => {
    const before = cutHashes(document.prose)
    const after = cutHashes(document.prose.slice(0, at) + PROBE_SENTENCE + document.prose.slice(at))

    expect(probeStability(document.prose, at)).toEqual({
      insertAt: at,
      original: before.length,
      edited: after.length,
      surviving: countingIntersection(before, after),
    })
  })
})

describe("sharedHashCount", () => {
  const cases = [
    { name: "no overlap", before: ["a", "b"], after: ["c"], shared: 0 },
    { name: "every hash kept", before: ["a", "b"], after: ["a", "b"], shared: 2 },
    { name: "a repeat counted once per occurrence", before: ["a"], after: ["a", "a"], shared: 1 },
    {
      name: "a repeat matched with multiplicity",
      before: ["a", "a"],
      after: ["a", "a"],
      shared: 2,
    },
    { name: "order ignored", before: ["a", "b", "c"], after: ["c", "x", "a"], shared: 2 },
  ]

  it.each(cases)("counts $name", ({ before, after, shared }) => {
    expect(sharedHashCount(before, after)).toBe(shared)
  })
})

describe("collectWarnings", () => {
  const warningsFor = (text: string) => collectWarnings(indexProseSentences(proseOf(text)))

  const cases = [
    {
      name: "a bracket with no closing bracket",
      text: "See [the loader reference for it.",
      kinds: ["unclosed bracket"],
    },
    {
      name: "a backtick with no pair",
      text: "Set `chunk.target to a value.",
      kinds: ["unpaired backtick"],
    },
    {
      name: "a sentence over the ceiling",
      text: `${"word ".repeat(500)}stop.`,
      kinds: ["over ceiling"],
    },
  ]

  it.each(cases)("reports $name", ({ text, kinds }) => {
    expect(warningsFor(text).map((warning) => warning.kind)).toEqual(kinds)
  })

  it("reports nothing for balanced markdown", () => {
    expect(
      warningsFor("See [the reference](https://example.com/a?b=c) and `chunk.target`.")
    ).toEqual([])
  })
})

describe("the script", () => {
  const run = (args: string[]): { status: number; stdout: string } => {
    try {
      const stdout = execFileSync(
        "npx",
        ["vite-node", "scripts/debug-chunking.ts", "--", ...args],
        {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
      return { status: 0, stdout }
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string }
      return { status: failure.status, stdout: failure.stdout + failure.stderr }
    }
  }

  it("reports an empty directory and exits without error", () => {
    const empty = mkdtempSync(join(tmpdir(), "chunking-report-"))
    writeFileSync(join(empty, "notes.txt"), "not markdown")

    const result = run([empty])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`No markdown files in ${empty}`)
  })

  it("prints a usage line and exits non-zero when given no path", () => {
    const result = run([])

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("Usage: npx vite-node scripts/debug-chunking.ts")
  })
})

describe("reportUnits", () => {
  const rowsOfLengths = (lengths: number[]): { prose: string; rows: SentenceRow[] } => {
    let offset = 0
    const rows: SentenceRow[] = []
    for (const length of lengths) {
      rows.push({ text: "x".repeat(length), start: offset, end: offset + length })
      offset += length
    }
    return { prose: "x".repeat(offset), rows }
  }

  it("counts a gap as suppressed only where the content test fired under the floor", () => {
    const underFloor = Math.floor(UNIT_FLOOR_CHARS / 2)
    const { prose, rows } = rowsOfLengths([underFloor, UNIT_FLOOR_CHARS, 200, 20])
    const firesAt = new Set([underFloor, underFloor + UNIT_FLOOR_CHARS])
    const [first] = reportUnits(
      prose,
      rows,
      ruleWith((_, gap) => firesAt.has(gap))
    )

    expect(first.reason).toBe("content test")
    expect(first.suppressedGaps).toBe(1)
  })

  it("names the ceiling, not the content test, where both fire at one gap", () => {
    const overCeiling = UNIT_CEILING_CHARS - 100
    const { prose, rows } = rowsOfLengths([overCeiling, 200, 100])
    const [first] = reportUnits(
      prose,
      rows,
      ruleWith((_, gap) => gap === overCeiling)
    )

    expect(first.size).toBe(overCeiling)
    expect(first.reason).toBe("ceiling")
  })

  it("names the end of the document for an oversized final sentence", () => {
    const { prose, rows } = rowsOfLengths([100, UNIT_CEILING_CHARS + 900])
    const [, last] = reportUnits(
      prose,
      rows,
      ruleWith(() => false)
    )

    expect(last.reason).toBe("end of document")
  })
})

describe("report settings", () => {
  it("cuts by the floor it was given, not the built-in one", () => {
    const wide = analyzeDocument("doc.md", DOCUMENT, { ...DEFAULT_SETTINGS, floor: 1200 })
    const narrow = analyzeDocument("doc.md", DOCUMENT, { ...DEFAULT_SETTINGS, floor: 100 })

    expect(wide.units.length).toBeLessThan(narrow.units.length)
    for (const report of wide.units.slice(0, -1)) expect(report.size).toBeGreaterThanOrEqual(1200)
  })

  it("hashes the window it was given", () => {
    const near = analyzeDocument("doc.md", DOCUMENT, { ...DEFAULT_SETTINGS, window: 40 })
    const far = analyzeDocument("doc.md", DOCUMENT, { ...DEFAULT_SETTINGS, window: 400 })

    expect(near.units.map((r) => r.unit.hash)).not.toEqual(far.units.map((r) => r.unit.hash))
  })

  it("warns about a sentence over the ceiling it was given", () => {
    const rows = [{ text: "x".repeat(300), start: 0, end: 300 }]

    expect(collectWarnings(rows, 200).map((w) => w.kind)).toContain("over ceiling")
    expect(collectWarnings(rows, 400).map((w) => w.kind)).not.toContain("over ceiling")
  })

  it("keeps every other bound while the sweep varies the mask", () => {
    const document = analyze(DOCUMENT)
    const settings = { ...DEFAULT_SETTINGS, floor: 300, ceiling: 900 }
    const [sweep] = sweepMasks([document], settings, [3])

    expect(sweep.units.map((report) => report.unit)).toEqual(
      cutUnits(document.prose, document.rows, ruleOf({ ...settings, looseBits: 3 }))
    )
  })
})
