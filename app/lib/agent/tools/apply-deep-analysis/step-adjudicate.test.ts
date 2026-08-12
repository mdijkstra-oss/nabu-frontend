import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { adjudicateEnvelopes } from "./step-adjudicate"
import type { ContentResolver, ScopedSources } from "./messages"
import { renderedEntriesIn, respondingWith, type RenderedEntry } from "./parse-call.fixture"

const mkContested = (n: number): Envelope => ({
  id: `c${n}`,
  code: "themes",
  file: "doc.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: [`SPAN ${n}.`],
  markedStart: 1,
  markedEnd: 1,
  markedText: `SPAN ${n}.`,
  findVotes: [],
  reason: "kept because",
  review: "split",
})

const uncontested: Envelope = {
  ...mkContested(999),
  id: "solid",
  reason: undefined,
  review: undefined,
}

const noSources: ScopedSources = { framework: [], dimension: [] }
const noFiles: ContentResolver = () => undefined

type AdjudJudgment = "keep" | "reject" | "inconsistent"

const spanNumber = (marked: string): number => Number(/SPAN (\d+)\./.exec(marked)?.[1])

const verdictFor = (n: number): AdjudJudgment =>
  n < 12 ? "keep" : n < 22 ? "reject" : "inconsistent"

const echoing = (entry: RenderedEntry) => ({
  id: entry.id,
  code: "themes",
  judgment: verdictFor(spanNumber(entry.marked)),
  reason: `re ${spanNumber(entry.marked)}`,
})

describe("adjudicateEnvelopes", () => {
  it("passes everything through untouched when nothing is contested", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))
    const result = await adjudicateEnvelopes([uncontested], noSources, noFiles, undefined, parse)
    expect(result).toEqual({ envelopes: [uncontested], errors: [], stats: new Map() })
    expect(calls).toHaveLength(0)
  })

  it("judges 30 contested envelopes in bounded calls whose merged stats equal the single-call equivalent", async () => {
    const contested = Array.from({ length: 30 }, (_, n) => mkContested(n))
    const { parse, calls } = respondingWith((_endpoint, messages) => ({
      results: renderedEntriesIn(messages).map(echoing),
    }))

    const result = await adjudicateEnvelopes(
      [uncontested, ...contested],
      noSources,
      noFiles,
      undefined,
      parse
    )

    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(result.errors).toEqual([])
    expect(result.stats.get("themes")).toEqual({ kept: 12, rejected: 10, ambig: 8 })

    const byId = new Map(result.envelopes.map((e) => [e.id, e]))
    expect(byId.get("solid")).toBe(uncontested)
    expect(byId.get("c0")?.review).toBeUndefined()
    expect(byId.has("c12")).toBe(false)
    expect(byId.get("c22")?.review).toBe("re 22")
    expect(result.envelopes).toHaveLength(1 + 12 + 8)
  })

  it("records a failed call's error while its envelopes pass through unjudged", async () => {
    const contested = Array.from({ length: 30 }, (_, n) => mkContested(n))
    const { parse } = respondingWith((_endpoint, messages) => {
      const entries = renderedEntriesIn(messages)
      if (entries.some((entry) => spanNumber(entry.marked) === 0)) return new Error("call died")
      return {
        results: entries.map((entry) => ({
          id: entry.id,
          code: "themes",
          judgment: "keep",
          reason: "fine",
        })),
      }
    })

    const result = await adjudicateEnvelopes(contested, noSources, noFiles, undefined, parse)

    expect(result.errors).toEqual(["call died"])
    expect(result.stats.get("themes")).toEqual({ kept: 10, rejected: 0, ambig: 20 })
    expect(result.envelopes).toHaveLength(30)
    expect(result.envelopes.find((e) => e.id === "c0")?.review).toBe("split")
    expect(result.envelopes.find((e) => e.id === "c25")?.review).toBeUndefined()
  })
})
