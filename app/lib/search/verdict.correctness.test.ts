// Adversarial correctness review of the search caller.
//
// Every test here pins a specified behavior; the ones that began life as
// review findings guard the fixes that closed them.

import { describe, it, expect, vi, afterEach } from "vitest"
import type { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { CallResult } from "~/lib/agent/client/call-parse"
import type { Message } from "~/lib/calls/messages"
import { assignIds } from "~/lib/calls/entry"
import { filterEntries } from "~/lib/agent/tools/scout-filter/api"
import { buildKey } from "~/lib/utils/storage-cache"
import {
  verdict,
  FILTER_ITEM_CAP,
  type CachedSpans,
  type FilterCache,
  type VerdictOptions,
} from "./verdict"
import { runVerdictTail } from "./pipeline"

type VerdictFn = typeof verdict

const mocks = vi.hoisted(() => ({
  verdictOverride: undefined as VerdictFn | undefined,
}))

vi.mock("./verdict", async (importOriginal) => {
  const actual = await importOriginal<{ verdict: VerdictFn }>()
  const delegating: VerdictFn = (...args) => (mocks.verdictOverride ?? actual.verdict)(...args)
  return { ...actual, verdict: delegating }
})

afterEach(() => {
  mocks.verdictOverride = undefined
})

const textOf = (message: Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => part.text).join("")

const callText = (messages: Message[]): string => messages.map(textOf).join("\n")

interface RecordedCall {
  endpoint: string
  text: string
  index: number
}

const scriptedParse = (respond: (call: RecordedCall) => unknown) => {
  const calls: RecordedCall[] = []
  const parse = async <T>(
    endpoint: string,
    messages: Message[],
    schema: z.ZodType<T>
  ): Promise<CallResult<T>> => {
    const call = { endpoint, text: callText(messages), index: calls.length }
    calls.push(call)
    const raw = respond(call)
    if (raw instanceof Error) return { ok: false, error: raw.message }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return { ok: true, data: parsed.data }
  }
  return { parse, calls }
}

interface DeferredCall {
  text: string
  answer: (raw: unknown) => void
  fail: (error: Error) => void
}

const deferredParse = () => {
  const pending: DeferredCall[] = []
  const parse = async <T>(
    _endpoint: string,
    messages: Message[],
    schema: z.ZodType<T>
  ): Promise<CallResult<T>> => {
    const raw = await new Promise<unknown>((answer, fail) =>
      pending.push({ text: callText(messages), answer, fail })
    )
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return { ok: true, data: parsed.data }
  }
  return { parse, pending }
}

const until = async (ready: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve))
  }
  if (!ready()) throw new Error("condition never became true")
}

const tick = () => new Promise((resolve) => setTimeout(resolve))

const memoryCache = () => {
  const store = new Map<string, CachedSpans>()
  const gets: string[] = []
  const cache: FilterCache = {
    get: (key) => {
      gets.push(key)
      return Promise.resolve(store.get(key))
    },
    put: (key, value) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
  return { cache, store, gets }
}

const hit = (n: number, text: string): SearchHit => ({ file: `f${n}.md`, text, score: 100 - n })

const tinyHits = (count: number): SearchHit[] =>
  Array.from({ length: count }, (_, i) => hit(i, `Tiny sentence ${i} ends.`))

const span = (start: string, end: string) => ({
  start,
  end,
  confidence: "clear" as const,
  reasonToKeep: "matches the intent",
})

describe("rawRemaining conservation (search.md:9,17 — unanswered calls' hits belong in rawRemaining)", () => {
  // search.md:9 — "verdict returns the hits from batches never dispatched plus
  // the hits from unanswered calls". A call still in flight when the pool
  // settles was never answered, yet its batch counts as consumed
  // (pool.consumed is the dispatch cursor), so its hits appear in neither the
  // streamed results nor rawRemaining: they vanish, and paging
  // (useSearchResults.loadMore) can never reach them again.
  it("keeps in-flight batches' hits in rawRemaining when the target settles the pool early", async () => {
    const hits = tinyHits(25) // item cap 10 → batches of 10, 10, 5, all dispatched at concurrency 5
    const { parse, pending } = deferredParse()
    const { cache } = memoryCache()
    const streamed: SearchHit[] = []

    const settled = verdict(
      hits,
      "intent",
      "",
      {},
      (batch) => streamed.push(...batch),
      { target: 1 },
      { parse, cache }
    )

    await until(() => pending.length === 3)
    pending[0].answer({ results: [span("1.1", "1.1")] })
    const result = await settled

    // Only batch 0 answered; batches 1 and 2 (hits 10..24) were in flight and
    // their eventual answers are discarded — they were never consumed.
    expect(streamed.map((h) => h.file)).toEqual([hits[0].file])
    expect(result.rawRemaining).toEqual(hits.slice(10))
  })

  // search.md:17/51 — the failure stop "ends the search with exhausted false
  // and the unconsumed hits in rawRemaining, so the search reads as incomplete".
  // A batch in flight when the third failure lands is unconsumed in every
  // meaningful sense — nothing was streamed for it — but it is dropped.
  it("keeps an in-flight batch's hits in rawRemaining when the failure stop fires", async () => {
    const hits = tinyHits(40) // 4 batches, all dispatched at concurrency 5
    const { parse, pending } = deferredParse()
    const { cache } = memoryCache()

    const settled = verdict(hits, "intent", "", {}, () => undefined, undefined, { parse, cache })

    await until(() => pending.length === 4)
    pending[0].fail(new Error("down"))
    await tick()
    pending[1].fail(new Error("down"))
    await tick()
    pending[2].fail(new Error("down"))

    const result = await settled
    expect(result.stop).toBe("failures")
    // Nothing streamed, so an incomplete search must keep every hit: batches
    // 0-2 failed, batch 3 (hits 30..39) was in flight and never answered.
    expect(result.rawRemaining).toEqual(hits)
  })
})

describe("untrusted refs (search.md:15 — a ref that doesn't resolve is dropped)", () => {
  const twoHits = [
    hit(1, "First sentence one."),
    hit(2, "Second sentence one. Second sentence two."),
  ]

  const refCases: { name: string; results: unknown[]; survivors: [string, number[][]][] }[] = [
    {
      name: "a sentence number past the entry's count is dropped",
      results: [span("1.2", "1.2"), span("2.1", "2.1")],
      survivors: [["f2.md", [[0, 0]]]],
    },
    {
      name: "entry id 0 is dropped",
      results: [span("0.1", "0.1"), span("1.1", "1.1")],
      survivors: [["f1.md", [[0, 0]]]],
    },
    {
      name: "a huge sentence number is dropped",
      results: [span("2.9999", "2.9999"), span("1.1", "1.1")],
      survivors: [["f1.md", [[0, 0]]]],
    },
    {
      name: "start and end resolving to different entries are dropped",
      results: [span("2.1", "1.1"), span("2.2", "2.2")],
      survivors: [["f2.md", [[1, 1]]]],
    },
  ]

  it.each(refCases)("$name", async ({ results, survivors }) => {
    const { parse } = scriptedParse(() => ({ results }))
    const { cache } = memoryCache()

    const result = await verdict(twoHits, "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(
      result.results.map((h) => [h.file, h.matchRanges?.map((r) => [r.start, r.end])])
    ).toEqual(survivors)
  })

  it("overlapping spans for one entry keep dedupOverlapping semantics: smallest span wins", async () => {
    const { parse } = scriptedParse(() => ({
      results: [span("2.1", "2.2"), span("2.2", "2.2")],
    }))
    const { cache } = memoryCache()

    const result = await verdict(twoHits, "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].matchRanges?.map((r) => [r.start, r.end])).toEqual([[1, 1]])
    expect(result.results[0].matches).toEqual(["Second sentence two."])
  })

  // Mutation-killing pin: without resolveMatch's end<start guard, a reversed
  // span next to a valid one slips past dedupOverlapping (a zero-length
  // reversed span overlaps nothing) and lands in matchRanges as a corrupt
  // 0-based range for trim to consume.
  it("a reversed ref does not leak into matchRanges alongside a valid span", async () => {
    const { parse } = scriptedParse(() => ({
      results: [span("2.2", "2.1"), span("2.1", "2.1")],
    }))
    const { cache } = memoryCache()

    const result = await verdict(twoHits, "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].matchRanges?.map((r) => [r.start, r.end])).toEqual([[0, 0]])
  })

  it("a response naming an entry twice with disjoint spans keeps both", async () => {
    const { parse } = scriptedParse(() => ({
      results: [span("2.1", "2.1"), span("2.2", "2.2")],
    }))
    const { cache } = memoryCache()

    const result = await verdict(twoHits, "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(result.results[0].matchRanges?.map((r) => [r.start, r.end])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })
})

describe("cache (search.md:21-23)", () => {
  it("the key includes the intent: the same hit under a new intent misses the cache", async () => {
    const text = "Herons nest upstream."
    const target = hit(1, text)
    const { cache, store } = memoryCache()
    store.set(buildKey(["intent A", text]), {
      spans: [{ start: 1, end: 1, confidence: "clear", reasonToKeep: "cached under A" }],
    })

    const runA = scriptedParse(() => new Error("must not be called"))
    const resultA = await verdict([target], "intent A", "", {}, () => undefined, undefined, {
      parse: runA.parse,
      cache,
    })
    expect(runA.calls).toHaveLength(0)
    expect(resultA.results).toHaveLength(1)

    const runB = scriptedParse(() => ({ results: [span("1.1", "1.1")] }))
    await verdict([target], "intent B", "", {}, () => undefined, undefined, {
      parse: runB.parse,
      cache,
    })
    expect(runB.calls).toHaveLength(1)
    expect(runB.calls[0].text).toContain("Herons nest upstream.")
  })

  it("a fully cached batch streams without a model call, counts toward target, and keeps confidence/reasonToKeep intact", async () => {
    const a = hit(1, "Alpha stands alone.")
    const b = hit(2, "Beta stands alone.")
    const { cache, store } = memoryCache()
    store.set(buildKey(["intent", a.text ?? ""]), {
      spans: [{ start: 1, end: 1, confidence: "borderline", reasonToKeep: "alpha reason" }],
    })
    store.set(buildKey(["intent", b.text ?? ""]), {
      spans: [{ start: 1, end: 1, confidence: "clear", reasonToKeep: "beta reason" }],
    })

    const { parse, calls } = scriptedParse(() => new Error("must not be called"))
    const batches: SearchHit[][] = []

    const result = await verdict(
      [a, b],
      "intent",
      "",
      {},
      (batch) => batches.push(batch),
      { target: 2 },
      { parse, cache }
    )

    expect(calls).toHaveLength(0)
    expect(batches).toHaveLength(1)
    expect(result.results).toHaveLength(2)
    expect(result.results[0].matchRanges).toEqual([
      { start: 0, end: 0, confidence: "borderline", reasonToKeep: "alpha reason" },
    ])
    expect(result.results[1].matchRanges).toEqual([
      { start: 0, end: 0, confidence: "clear", reasonToKeep: "beta reason" },
    ])
    expect(result.rawRemaining).toEqual([])
  })

  it("a cached empty verdict is honored without a re-ask (durable no-match for that intent and text)", async () => {
    const target = hit(1, "Nothing to see here.")
    const { cache, store } = memoryCache()
    store.set(buildKey(["intent", target.text ?? ""]), { spans: [] })

    const { parse, calls } = scriptedParse(() => new Error("must not be called"))
    const result = await verdict([target], "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(calls).toHaveLength(0)
    expect(result.results).toEqual([])
  })
})

describe("hits without text (search.md:13)", () => {
  it("a failed batch returns its textless pass-through hits in rawRemaining too", async () => {
    const bare: SearchHit = { file: "bare.md", score: 50 }
    const texted = hit(1, "One sentence only here.")
    const { parse } = scriptedParse(() => new Error("gateway down"))
    const { cache } = memoryCache()

    const result = await verdict([bare, texted], "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(result.failures).toHaveLength(1)
    expect(result.rawRemaining).toEqual([bare, texted])
  })
})

describe("scout ranges (search.md:29 — ranges in the answer are entry ids)", () => {
  const twoEntries = assignIds([
    { item: null, file: "a.md", content: { plain: ["First block."] } },
    { item: null, file: "b.md", content: { plain: ["Second block."] } },
  ])

  // search.md:29 — "Ranges in the answer are entry ids"; ids exist only within
  // the call. expandRanges materializes every integer of an untrusted from/to
  // range instead of clipping to the call's ids, so a model answering
  // { from: 1, to: 50_000 } allocates 50k set entries — and to: 1e15 loops the
  // tab to death (app/lib/agent/tools/scout-filter/api.ts:7-13).
  it("clips an exclusion range to the call's entry ids", async () => {
    const { parse } = scriptedParse(() => ({
      exclude: [{ from: 1, to: 50_000, reason: "everything and beyond" }],
    }))

    const excluded = await filterEntries("the framework", twoEntries, parse)

    const knownIds = new Set(twoEntries.map((entry) => entry.id))
    expect(excluded.size).toBeLessThanOrEqual(twoEntries.length)
    expect([...excluded].every((id) => knownIds.has(id))).toBe(true)
  })

  it("a range with from greater than to excludes nothing", async () => {
    const { parse } = scriptedParse(() => ({
      exclude: [{ from: 2, to: 1, reason: "inverted" }],
    }))

    const excluded = await filterEntries("the framework", twoEntries, parse)
    expect(excluded.size).toBe(0)
  })

  it("a scout answer with from 0 fails the schema and rejects (unanswered, not empty)", async () => {
    const { parse } = scriptedParse(() => ({
      exclude: [{ from: 0, to: 1, reason: "below the floor" }],
    }))

    await expect(filterEntries("the framework", twoEntries, parse)).rejects.toThrow(
      "scout-filter failed"
    )
  })
})

describe("pipeline mapping (search.md:17 — barren means exhausted, failure means incomplete)", () => {
  const stubResult = (
    stop: "barren" | "failures" | undefined,
    rawRemaining: SearchHit[]
  ): ReturnType<VerdictFn> =>
    Promise.resolve({
      results: [],
      failures: [],
      consumed: 0,
      barren: stop === "barren",
      stop,
      rawRemaining,
    })

  it("failure stop → exhausted false, rawRemaining passed through", async () => {
    const remaining = [hit(1, "Left over.")]
    mocks.verdictOverride = () => stubResult("failures", remaining)

    const out = await runVerdictTail([], "intent", {}, 25)

    expect(out.exhausted).toBe(false)
    expect(out.rawRemaining).toBe(remaining)
  })

  it("barren stop → exhausted true even with hits remaining", async () => {
    mocks.verdictOverride = () => stubResult("barren", [hit(1, "Down the ranking.")])

    const out = await runVerdictTail([], "intent", {}, 25)

    expect(out.exhausted).toBe(true)
  })

  it("no stop → exhausted only when nothing remains", async () => {
    mocks.verdictOverride = () => stubResult(undefined, [])
    expect((await runVerdictTail([], "intent", {}, 25)).exhausted).toBe(true)

    mocks.verdictOverride = () => stubResult(undefined, [hit(1, "More to page.")])
    expect((await runVerdictTail([], "intent", {}, 25)).exhausted).toBe(false)
  })

  it("maxBarren derives from the packer's item cap: ceil(target / FILTER_ITEM_CAP)", async () => {
    let seen: VerdictOptions | undefined
    mocks.verdictOverride = (_hits, _intent, _framework, _files, _onBatch, opts) => {
      seen = opts
      return stubResult(undefined, [])
    }

    await runVerdictTail([], "intent", {}, 25)

    expect(seen?.target).toBe(25)
    expect(seen?.maxBarren).toBe(Math.ceil(25 / FILTER_ITEM_CAP))
  })
})
