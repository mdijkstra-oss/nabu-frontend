import { describe, it, expect } from "vitest"
import type { Envelope } from "./envelope"
import { filterEnvelopes } from "./step-filter"
import { FILTER_CTA, type ContentResolver, type ScopedSources } from "./messages"
import { FILTER_ENDPOINT } from "./def"
import { hasBreakpoint, respondingWith, textOf } from "./parse-call.fixture"
import type { FilterEntry, Tracer } from "./trace"

const mkEnv = (id: string, over: Partial<Envelope> = {}): Envelope => ({
  id,
  code: "themes",
  file: "doc.md",
  fileCharStart: 0,
  fileCharEnd: 10,
  haloSentences: [`SPAN ${id}.`],
  markedStart: 1,
  markedEnd: 1,
  markedText: `SPAN ${id}.`,
  findVotes: [],
  ...over,
})

const noSources: ScopedSources = { framework: [], dimension: [] }
const noFiles: ContentResolver = () => undefined

const judgment = (id: number, judgment: "keep" | "remove", reason: string) => ({
  id,
  code: "themes",
  judgment,
  reason,
})

const capturingTracer = (): { tracer: Tracer; filter: FilterEntry[] } => {
  const filter: FilterEntry[] = []
  const tracer: Tracer = {
    setTarget: () => undefined,
    setVoterCount: () => undefined,
    setFind: () => undefined,
    pushFilter: (_dim, entry) => void filter.push(entry),
    pushAdjud: () => undefined,
    snapshot: () => [],
    flush: () => undefined,
  }
  return { tracer, filter }
}

describe("filterEnvelopes", () => {
  it("returns empty results for no envelopes without calling", async () => {
    const { parse, calls } = respondingWith(() => ({ results: [] }))
    const result = await filterEnvelopes([], noSources, noFiles, undefined, parse)
    expect(result).toEqual({ surviving: [], removed: [], errors: [], stats: new Map() })
    expect(calls).toHaveLength(0)
  })

  it("drops a judgment whose id names no entry in the call and applies the rest", async () => {
    const envelopes = [mkEnv("a"), mkEnv("b")]
    const { parse } = respondingWith(() => ({
      results: [judgment(1, "keep", "fits"), judgment(99, "remove", "stray")],
    }))

    const result = await filterEnvelopes(envelopes, noSources, noFiles, undefined, parse)

    expect(result.errors).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.surviving.map((e) => e.id)).toEqual(["a", "b"])
    expect(result.surviving[0].reason).toBe("fits")
    expect(result.surviving[1].reason).toBeUndefined()
    expect(result.stats.get("themes")).toEqual([1, 1])
  })

  it("keeps today's missing-vote behavior when one voter's call goes unanswered", async () => {
    const envelopes = [mkEnv("a"), mkEnv("b")]
    const { parse } = respondingWith((endpoint) =>
      endpoint.endsWith("voter-one")
        ? new Error("voter one down")
        : { results: [judgment(1, "keep", "solid"), judgment(2, "remove", "off")] }
    )
    const { tracer, filter } = capturingTracer()

    const result = await filterEnvelopes(envelopes, noSources, noFiles, tracer, parse)

    expect(result.errors).toEqual(["voter one down"])
    expect(result.surviving.map((e) => e.id)).toEqual(["a"])
    expect(result.surviving[0].reason).toBe("solid")
    expect(result.removed.map((e) => e.id)).toEqual(["b"])
    expect(filter.map((e) => e.votes.map((v) => v.judgment))).toEqual([
      ["missing", "keep"],
      ["missing", "remove"],
    ])
  })

  it("marks a split vote contested, carrying both cases", async () => {
    const { parse } = respondingWith((endpoint) => ({
      results: [judgment(1, endpoint.endsWith("voter-one") ? "keep" : "remove", "why")],
    }))

    const result = await filterEnvelopes([mkEnv("a")], noSources, noFiles, undefined, parse)

    expect(result.surviving[0].reason).toBe("why")
    expect(result.surviving[0].review).toBe("why")
  })

  it("sends both voters the same payload: breakpointed framework and code sources, one entry per message, CTA last", async () => {
    const files: Record<string, string> = {
      "fw.md": "Framework rules apply.",
      "dim.md": [
        "```json-callout",
        JSON.stringify({
          id: "themes",
          type: "codebook-code",
          title: "Themes",
          content: "Look for themes.",
          color: "blue",
          collapsed: false,
        }),
        "```",
      ].join("\n"),
    }
    const sources: ScopedSources = { framework: ["fw.md"], dimension: ["dim.md"] }
    const { parse, calls } = respondingWith(() => ({ results: [] }))

    await filterEnvelopes([mkEnv("a")], sources, (path) => files[path], undefined, parse)

    expect(calls.map((c) => c.endpoint)).toEqual([
      `${FILTER_ENDPOINT}.voter-one`,
      `${FILTER_ENDPOINT}.voter-two`,
    ])
    expect(calls[1].messages).toEqual(calls[0].messages)

    const messages = calls[0].messages
    expect(textOf(messages[0])).toContain("Framework rules apply.")
    expect(hasBreakpoint(messages[0])).toBe(true)
    expect(textOf(messages[1])).toContain('<analysis id="themes">')
    expect(hasBreakpoint(messages[1])).toBe(true)
    expect(textOf(messages[2])).toContain('<entry id="1" file="doc.md">')
    expect(textOf(messages[2])).toContain("<code>themes</code>")
    expect(messages[2].role).toBe("system")
    expect(messages[3]).toEqual({ type: "message", role: "user", content: FILTER_CTA })
  })
})
