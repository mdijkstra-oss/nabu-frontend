import { describe, it, expect } from "vitest"
import { indexFileSentences, buildHaloForRows, buildHalo, type HaloResult } from "./halo"

const FILE = [
  "First sentence.",
  "Second sentence.",
  "Third sentence.",
  "Fourth sentence.",
  "Fifth sentence.",
  "Sixth sentence.",
  "Seventh sentence.",
].join(" ")

const must = (h: HaloResult | null): HaloResult => {
  if (h === null) throw new Error("expected halo, got null")
  return h
}

describe("indexFileSentences", () => {
  it("splits prose into sentence rows with offsets", () => {
    const rows = indexFileSentences(FILE)
    expect(rows.length).toBe(7)
    expect(rows[0].text).toContain("First sentence")
    expect(rows[6].text).toContain("Seventh sentence")
    expect(rows[0].start).toBe(0)
    expect(rows[1].start).toBeGreaterThan(rows[0].end)
  })

  it("returns empty for empty input", () => {
    expect(indexFileSentences("")).toEqual([])
  })
})

describe("buildHaloForRows", () => {
  const rows = indexFileSentences(FILE)

  it("returns null when range doesn't overlap any sentence", () => {
    expect(buildHaloForRows(rows, 10000, 10001, 2)).toBeNull()
  })

  it("halo around middle sentence includes ±N", () => {
    const target = rows[3]
    const out = must(buildHaloForRows(rows, target.start, target.end, 2))
    expect(out.haloSentences.length).toBe(5)
    expect(out.markedStart).toBe(3)
    expect(out.markedEnd).toBe(3)
  })

  it("halo clamped at start of file", () => {
    const target = rows[0]
    const out = must(buildHaloForRows(rows, target.start, target.end, 3))
    expect(out.haloSentences.length).toBe(4)
    expect(out.markedStart).toBe(1)
  })

  it("halo clamped at end of file", () => {
    const target = rows[6]
    const out = must(buildHaloForRows(rows, target.start, target.end, 3))
    expect(out.haloSentences.length).toBe(4)
    expect(out.markedStart).toBe(4)
    expect(out.markedEnd).toBe(4)
  })

  it("multi-sentence match: markedStart/End span the matched range", () => {
    const start = rows[2].start
    const end = rows[4].end
    const out = must(buildHaloForRows(rows, start, end, 2))
    expect(out.markedStart).toBe(3)
    expect(out.markedEnd).toBe(5)
  })

  it("zero halo returns only marked sentences", () => {
    const target = rows[3]
    const out = must(buildHaloForRows(rows, target.start, target.end, 0))
    expect(out.haloSentences.length).toBe(1)
    expect(out.markedStart).toBe(1)
    expect(out.markedEnd).toBe(1)
  })
})

describe("buildHalo (raw file)", () => {
  it("strips and indexes then builds halo", () => {
    const out = must(buildHalo(FILE, 0, 16, 1))
    expect(out.markedStart).toBe(1)
  })

  it("returns null when range can't be located", () => {
    expect(buildHalo(FILE, 1000000, 1000001, 1)).toBeNull()
  })
})
