import { describe, it, expect } from "vitest"
import type { Hit, SentenceWindow } from "./types"
import { MARK_WINDOW_CHARS, computeWindows, sliceWindow } from "./window"
import { renderNumberedSentences } from "./payload"

const shortDocument = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `Sentence number ${i}.`)

const longDocument = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${i} ${"word ".repeat(40)}.`)

const hit = (hitSentence: number, kind = "speaker", value = "rutte"): Hit => ({
  kind,
  quote: "quote",
  hitSentence,
  value,
})

const windowsOf = (hits: Hit[], sentences: string[]): Record<number, SentenceWindow> =>
  Object.fromEntries(computeWindows(hits, sentences).map((w) => [w.hit.hitSentence, w.window]))

describe("the neighbour bound", () => {
  const sentences = shortDocument(40)

  const cases: { name: string; hits: Hit[]; expected: Record<number, SentenceWindow> }[] = [
    {
      name: "a single hit is bounded only by the document",
      hits: [hit(12)],
      expected: { 12: { start: 0, end: 39 } },
    },
    {
      name: "hits at both edges",
      hits: [hit(0), hit(39)],
      expected: { 0: { start: 0, end: 39 }, 39: { start: 0, end: 39 } },
    },
    {
      name: "three hits bound each other",
      hits: [hit(5), hit(20), hit(30)],
      expected: {
        5: { start: 0, end: 20 },
        20: { start: 5, end: 30 },
        30: { start: 20, end: 39 },
      },
    },
    {
      name: "adjacent hits",
      hits: [hit(10), hit(11)],
      expected: { 10: { start: 0, end: 11 }, 11: { start: 10, end: 39 } },
    },
    {
      name: "hits arriving out of order",
      hits: [hit(30), hit(5)],
      expected: { 5: { start: 0, end: 30 }, 30: { start: 5, end: 39 } },
    },
  ]

  it.each(cases)("$name", ({ hits, expected }) => {
    expect(windowsOf(hits, sentences)).toEqual(expected)
  })

  it("never runs below zero or past the final sentence", () => {
    for (const { window } of computeWindows([hit(0), hit(39)], sentences)) {
      expect(window.start).toBeGreaterThanOrEqual(0)
      expect(window.end).toBeLessThanOrEqual(39)
    }
  })

  it("bounds two hits sharing a sentence by each other", () => {
    const shared = [hit(10, "speaker", "rutte"), hit(10, "speaker", "kaag")]
    expect(computeWindows(shared, sentences).map((w) => w.window)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 39 },
    ])
  })
})

describe("kinds do not bound each other", () => {
  it("computes each kind's windows from its own hits alone", () => {
    const sentences = shortDocument(40)
    const hits = [hit(5, "speaker"), hit(6, "date", "2024-03-05"), hit(30, "speaker")]
    const windows = computeWindows(hits, sentences)

    const speaker = windows.filter((w) => w.hit.kind === "speaker").map((w) => w.window)
    const date = windows.filter((w) => w.hit.kind === "date").map((w) => w.window)

    expect(speaker).toEqual([
      { start: 0, end: 30 },
      { start: 5, end: 39 },
    ])
    expect(date).toEqual([{ start: 0, end: 39 }])
  })
})

describe("the character clamp", () => {
  it("leaves a whole short document alone when the clamp does not tighten it", () => {
    const sentences = shortDocument(40)
    expect(sentences.join(" ").length).toBeLessThan(MARK_WINDOW_CHARS)
    expect(windowsOf([hit(12)], sentences)).toEqual({ 12: { start: 0, end: 39 } })
  })

  it("centres the clamp on the hit's own sentence in a long document", () => {
    const sentences = longDocument(100)
    expect(sentences.join(" ").length).toBeGreaterThan(MARK_WINDOW_CHARS * 2)

    const { 50: window } = windowsOf([hit(50)], sentences)
    expect(window.start).toBeGreaterThan(0)
    expect(window.end).toBeLessThan(99)
    expect(50 - window.start).toBeGreaterThan(0)
    expect(window.end - 50).toBeGreaterThan(0)
    expect(Math.abs(50 - window.start - (window.end - 50))).toBeLessThanOrEqual(1)
  })

  it("keeps a rendered window payload inside the clamp", () => {
    const sentences = longDocument(100)
    const { window } = computeWindows([hit(50)], sentences)[0]
    const slice = sliceWindow(sentences, window)

    expect(slice.join(" ").length).toBeLessThanOrEqual(MARK_WINDOW_CHARS)
    expect(renderNumberedSentences(slice, window.start).split("\n")).toHaveLength(slice.length)
  })

  it("lets the neighbour bound win where it is the tighter of the two", () => {
    const sentences = longDocument(100)
    expect(windowsOf([hit(50), hit(52)], sentences)).toEqual({
      50: expect.objectContaining({ end: 52 }),
      52: expect.objectContaining({ start: 50 }),
    })
  })

  it("keeps a single sentence longer than the clamp as its own window", () => {
    const sentences = ["x".repeat(MARK_WINDOW_CHARS * 2)]
    expect(windowsOf([hit(0)], sentences)).toEqual({ 0: { start: 0, end: 0 } })
  })
})

describe("a unit with no hits", () => {
  it("produces no window, and so no mark call", () => {
    expect(computeWindows([], shortDocument(40))).toEqual([])
  })
})

describe("sliceWindow", () => {
  it("takes the window's sentences inclusive of both bounds", () => {
    expect(sliceWindow(["a", "b", "c", "d"], { start: 1, end: 2 })).toEqual(["b", "c"])
  })
})
