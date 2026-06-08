import { describe, it, expect } from "vitest"
import { trimByRanges } from "./trim-around"

const passages = [
  "Alpha sentence.",
  "Beta sentence with more detail.",
  "Gamma sentence in the middle.",
  "Delta sentence after gamma.",
  "Epsilon sentence with content.",
  "Zeta finale.",
].join(" ")

const allText = (regions: { text: string }[]): string => regions.map((r) => r.text).join("")

describe("trimByRanges", () => {
  it("empty ranges → returns one region with full text", () => {
    const result = trimByRanges(passages, [])
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe(passages)
    expect(result[0].sourceStart).toBe(0)
    expect(result[0].sourceEnd).toBe(passages.length)
  })

  it("empty text → returns one empty region", () => {
    const result = trimByRanges("", [{ start: 0, end: 0 }])
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("")
  })

  it("single range produces one region with context shoulders", () => {
    const result = trimByRanges(passages, [{ start: 2, end: 2 }])
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Gamma sentence in the middle.")
    expect(result[0].text).toContain("Beta sentence with more detail.")
    expect(result[0].text).toContain("Delta sentence after gamma.")
  })

  it("two distant ranges produce two separate regions", () => {
    const text = [
      "First.",
      ...Array.from({ length: 20 }, (_, i) => `Filler sentence number ${i}.`),
      "Middle.",
      ...Array.from({ length: 20 }, (_, i) => `Other filler ${i}.`),
      "Last.",
    ].join(" ")
    const result = trimByRanges(text, [
      { start: 0, end: 0 },
      { start: 42, end: 42 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].text).toContain("First.")
    expect(result[1].text).toContain("Last.")
  })

  it("adjacent ranges merge into one region", () => {
    const result = trimByRanges(passages, [
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Beta sentence with more detail.")
    expect(result[0].text).toContain("Gamma sentence in the middle.")
  })

  it("non-adjacent ranges split into separate regions", () => {
    const text = "Before.\n\nMatch one.\n\nSmall gap.\n\nMatch two.\n\nAfter."
    const result = trimByRanges(text, [
      { start: 1, end: 1 },
      { start: 3, end: 3 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].text).toContain("Match one.")
    expect(result[1].text).toContain("Match two.")
  })

  it("out-of-bounds ranges are clamped", () => {
    const result = trimByRanges(passages, [{ start: 100, end: 200 }])
    expect(allText(result)).toContain("Zeta finale.")
  })

  it("range covering all sentences returns full text", () => {
    const result = trimByRanges("A. B. C.", [{ start: 0, end: 2 }])
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("A")
    expect(result[0].text).toContain("B")
    expect(result[0].text).toContain("C")
  })

  it("each region's sourceStart/sourceEnd lie inside text bounds", () => {
    const text = [
      "First.",
      ...Array.from({ length: 20 }, (_, i) => `Filler sentence number ${i}.`),
      "Middle.",
      ...Array.from({ length: 20 }, (_, i) => `Other filler ${i}.`),
      "Last.",
    ].join(" ")
    const result = trimByRanges(text, [
      { start: 0, end: 0 },
      { start: 42, end: 42 },
    ])
    for (const region of result) {
      expect(region.sourceStart).toBeGreaterThanOrEqual(0)
      expect(region.sourceEnd).toBeLessThanOrEqual(text.length)
      expect(region.sourceStart).toBeLessThan(region.sourceEnd)
    }
    expect(result[0].sourceStart).toBeLessThan(result[1].sourceStart)
  })

  it("sourceStart/sourceEnd of adjacent-merged region span both sentences", () => {
    const result = trimByRanges(passages, [
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ])
    expect(result).toHaveLength(1)
    const slice = passages.slice(result[0].sourceStart, result[0].sourceEnd)
    expect(slice).toContain("Beta sentence with more detail.")
    expect(slice).toContain("Gamma sentence in the middle.")
  })

  it("leading pads when first range starts at text start", () => {
    const leading = "Prefix one. Prefix two. Prefix three."
    const text = "Match here. Trailing in text."
    const result = trimByRanges(text, [{ start: 0, end: 0 }], { leading })
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Prefix three.")
    expect(result[0].text).toContain("Match here.")
    expect(result[0].sourceStart).toBeLessThan(0)
  })

  it("leading pads with ellipsis stub when budget exhausted", () => {
    const leading = Array.from({ length: 40 }, (_, i) => `Leading sentence number ${i}.`).join(" ")
    const text = "Match here. Trailing in text."
    const result = trimByRanges(text, [{ start: 0, end: 0 }], { leading })
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("…")
    expect(result[0].text).toContain("Match here.")
  })

  it("trailing pads when last range ends at text end", () => {
    const text = "Leading in text. Match here."
    const trailing = " Suffix one. Suffix two. Suffix three."
    const result = trimByRanges(text, [{ start: 1, end: 1 }], { trailing })
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Match here.")
    expect(result[0].text).toContain("Suffix one.")
    expect(result[0].sourceEnd).toBeGreaterThan(text.length)
  })

  it("trailing pads with ellipsis stub when budget exhausted", () => {
    const text = "Leading in text. Match here."
    const trailing =
      " " + Array.from({ length: 40 }, (_, i) => `Trailing sentence number ${i}.`).join(" ")
    const result = trimByRanges(text, [{ start: 1, end: 1 }], { trailing })
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Match here.")
    expect(result[0].text).toContain("…")
  })

  it("both leading and trailing pad when range spans whole text", () => {
    const leading = "Prefix one. Prefix two."
    const text = "Only match."
    const trailing = " Suffix one. Suffix two."
    const result = trimByRanges(text, [{ start: 0, end: 0 }], { leading, trailing })
    expect(result).toHaveLength(1)
    expect(result[0].text).toContain("Prefix")
    expect(result[0].text).toContain("Only match.")
    expect(result[0].text).toContain("Suffix")
    expect(result[0].sourceStart).toBeLessThan(0)
    expect(result[0].sourceEnd).toBeGreaterThan(text.length)
  })

  it("no pad when leading/trailing empty (preserves prior edge behavior)", () => {
    const result = trimByRanges(passages, [{ start: 0, end: 0 }], { leading: "", trailing: "" })
    expect(result).toHaveLength(1)
    expect(result[0].sourceStart).toBe(0)
    expect(result[0].text).toContain("Alpha sentence.")
  })

  it("internal range with budget consumed inside text does not pad", () => {
    const longText = [
      "First.",
      ...Array.from({ length: 20 }, (_, i) => `Filler sentence number ${i}.`),
      "Middle.",
      ...Array.from({ length: 20 }, (_, i) => `Other filler ${i}.`),
      "Last.",
    ].join(" ")
    const result = trimByRanges(longText, [{ start: 21, end: 21 }], {
      leading: "Should not appear leading.",
      trailing: " Should not appear trailing.",
    })
    expect(result).toHaveLength(1)
    expect(result[0].text).not.toContain("Should not appear leading.")
    expect(result[0].text).not.toContain("Should not appear trailing.")
    expect(result[0].text).toContain("Middle.")
  })
})
