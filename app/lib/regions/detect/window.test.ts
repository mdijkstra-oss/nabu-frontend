import { describe, it, expect } from "vitest"
import type { Hit, MarkWork, SentenceWindow } from "./types"
import {
  MARK_WINDOW_CHARS,
  MAX_STRETCH_OCCURRENCES,
  coalesceStretches,
  computeWindows,
  sliceWindow,
} from "./window"

const shortDocument = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `Sentence number ${i}.`)

const longDocument = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${i} ${"word ".repeat(40)}.`)

const hit = (hitSentence: number, kind = "person", value = "rutte"): Hit => ({
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
    const shared = [hit(10, "person", "rutte"), hit(10, "person", "kaag")]
    expect(computeWindows(shared, sentences).map((w) => w.window)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 39 },
    ])
  })
})

describe("kinds do not bound each other", () => {
  it("computes each kind's windows from its own hits alone", () => {
    const sentences = shortDocument(40)
    const hits = [hit(5, "person"), hit(6, "date", "2024-03-05"), hit(30, "person")]
    const windows = computeWindows(hits, sentences)

    const person = windows.filter((w) => w.hit.kind === "person").map((w) => w.window)
    const date = windows.filter((w) => w.hit.kind === "date").map((w) => w.window)

    expect(person).toEqual([
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

describe("coalescing windows into stretches", () => {
  const sentences = shortDocument(60)

  const work = (
    hitSentence: number,
    window: SentenceWindow,
    over: Partial<Pick<MarkWork, "file">> & { kind?: string; value?: string } = {}
  ): MarkWork => ({
    file: over.file ?? "talk.md",
    sentences,
    hit: hit(hitSentence, over.kind ?? "person", over.value ?? "rutte"),
    window,
  })

  const windowsOf = (stretches: ReturnType<typeof coalesceStretches>): SentenceWindow[] =>
    stretches.map((stretch) => stretch.window)

  const cases: { name: string; works: MarkWork[]; expected: SentenceWindow[] }[] = [
    {
      name: "overlapping windows merge into one stretch",
      works: [work(5, { start: 0, end: 10 }), work(8, { start: 5, end: 15 })],
      expected: [{ start: 0, end: 15 }],
    },
    {
      name: "touching windows merge",
      works: [work(2, { start: 0, end: 5 }), work(8, { start: 6, end: 10 })],
      expected: [{ start: 0, end: 10 }],
    },
    {
      name: "a gap of one sentence keeps two stretches",
      works: [work(2, { start: 0, end: 4 }), work(8, { start: 6, end: 10 })],
      expected: [
        { start: 0, end: 4 },
        { start: 6, end: 10 },
      ],
    },
    {
      name: "a contained window never widens the stretch",
      works: [work(3, { start: 0, end: 20 }), work(9, { start: 5, end: 12 })],
      expected: [{ start: 0, end: 20 }],
    },
    {
      name: "works arriving out of document order coalesce sorted",
      works: [work(8, { start: 5, end: 15 }), work(5, { start: 0, end: 10 })],
      expected: [{ start: 0, end: 15 }],
    },
  ]

  it.each(cases)("$name", ({ works, expected }) => {
    expect(windowsOf(coalesceStretches(works))).toEqual(expected)
  })

  it("keeps a stretch's works in document order", () => {
    const stretches = coalesceStretches([
      work(8, { start: 5, end: 15 }),
      work(5, { start: 0, end: 10 }),
    ])
    expect(stretches[0].works.map((w) => w.hit.hitSentence)).toEqual([5, 8])
  })

  it("never merges across files", () => {
    const stretches = coalesceStretches([
      work(5, { start: 0, end: 10 }, { file: "a.md" }),
      work(6, { start: 0, end: 10 }, { file: "b.md" }),
    ])
    expect(stretches).toHaveLength(2)
    expect(stretches.map((s) => s.file).sort()).toEqual(["a.md", "b.md"])
  })

  it("never merges across kinds", () => {
    const stretches = coalesceStretches([
      work(5, { start: 0, end: 10 }, { kind: "person" }),
      work(6, { start: 0, end: 10 }, { kind: "date" }),
    ])
    expect(stretches).toHaveLength(2)
  })

  it("closes a stretch at the occurrence cap and opens the next at the following hit's window", () => {
    const works = Array.from({ length: 12 }, (_, i) =>
      work(i * 2, { start: Math.max(0, i * 2 - 2), end: i * 2 + 2 })
    )
    const stretches = coalesceStretches(works)

    expect(stretches.map((s) => s.works.length)).toEqual([MAX_STRETCH_OCCURRENCES, 2])
    expect(stretches[1].window.start).toBe(works[10].window.start)
  })

  it("puts two hits three sentences apart in one stretch covering the text between them", () => {
    const hits = [hit(10), hit(13)]
    const works = computeWindows(hits, sentences).map(({ hit: h, window }) =>
      work(h.hitSentence, window)
    )
    const stretches = coalesceStretches(works)

    expect(stretches).toHaveLength(1)
    expect(stretches[0].works).toHaveLength(2)
    expect(stretches[0].window.start).toBeLessThanOrEqual(10)
    expect(stretches[0].window.end).toBeGreaterThanOrEqual(13)
  })
})
