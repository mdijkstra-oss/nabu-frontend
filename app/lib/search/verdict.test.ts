import { describe, it, expect } from "vitest"
import type { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { CallResult } from "~/lib/agent/client/call-parse"
import type { Message } from "~/lib/calls/messages"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import { buildKey } from "~/lib/utils/storage-cache"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { verdict, FILTER_CACHE_PREFIX, type CachedSpans, type FilterCache } from "./verdict"

interface RecordedCall {
  endpoint: string
  text: string
  index: number
}

const callText = (messages: Message[]): string => messages.map(textOf).join("\n")

const scriptedParse = (respond: (call: RecordedCall) => unknown) => {
  const calls: RecordedCall[] = []
  const fake = respondingWith((endpoint, messages) => {
    const call = { endpoint, text: callText(messages), index: calls.length }
    calls.push(call)
    return respond(call)
  })
  return { parse: fake.parse, calls }
}

interface DeferredCall {
  text: string
  answer: (raw: unknown) => void
  fail: (error: Error) => void
}

const deferredParse = () => {
  const pending: DeferredCall[] = []
  const parse = async <T>(
    endpoint: string,
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

const collectBatches = () => {
  const batches: SearchHit[][] = []
  return { batches, onBatch: (batch: SearchHit[]) => batches.push(batch) }
}

describe("verdict", () => {
  it("cache answers across position: a hit cached at position 7 streams without a model call at position 0", async () => {
    const { cache } = memoryCache()
    const heron = hit(99, "Herons nest upstream. They return in March.")
    const firstRun = scriptedParse(() => ({ results: [span("8.1", "8.1")] }))

    await verdict([...tinyHits(7), heron], "intent", "", {}, () => undefined, undefined, {
      parse: firstRun.parse,
      cache,
    })
    expect(firstRun.calls).toHaveLength(1)

    const fresh = hit(50, "A new passage about nothing much.")
    const secondRun = scriptedParse(() => ({ results: [span("1.1", "1.1")] }))
    const { batches, onBatch } = collectBatches()

    const result = await verdict([heron, fresh], "intent", "", {}, onBatch, undefined, {
      parse: secondRun.parse,
      cache,
    })

    expect(secondRun.calls).toHaveLength(1)
    expect(secondRun.calls[0].text).not.toContain("Herons nest upstream")
    expect(batches).toHaveLength(1)

    const heronOut = batches[0].find((h) => h.file === heron.file)
    expect(heronOut?.matches).toEqual(["Herons nest upstream."])
    expect(heronOut?.matchRanges).toEqual([
      { start: 0, end: 0, confidence: "clear", reasonToKeep: "matches the intent" },
    ])
    const freshOut = batches[0].find((h) => h.file === fresh.file)
    expect(freshOut?.matches).toEqual(["A new passage about nothing much."])
    expect(result.rawRemaining).toEqual([])
  })

  const refCases: { name: string; results: unknown[]; survivors: [string, number[][]][] }[] = [
    {
      name: "a ref naming an absent entry is dropped, the entry's other spans survive",
      results: [span("1.1", "1.1"), span("9.1", "9.1")],
      survivors: [["f1.md", [[0, 0]]]],
    },
    {
      name: "a cross-entry ref is dropped",
      results: [span("1.1", "2.1"), span("2.1", "2.1")],
      survivors: [["f2.md", [[0, 0]]]],
    },
    {
      name: "a reversed ref is dropped",
      results: [span("1.2", "1.1"), span("2.2", "2.2")],
      survivors: [["f2.md", [[1, 1]]]],
    },
  ]

  it.each(refCases)("$name", async ({ results, survivors }) => {
    const hits = [
      hit(1, "First sentence one. First sentence two."),
      hit(2, "Second sentence one. Second sentence two."),
    ]
    const { parse } = scriptedParse(() => ({ results }))
    const { cache } = memoryCache()

    const result = await verdict(hits, "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(
      result.results.map((h) => [h.file, h.matchRanges?.map((r) => [r.start, r.end])])
    ).toEqual(survivors)
  })

  it("middle batch fails: barren untouched, rawRemaining is exactly the failed batch, no consumed hit in it", async () => {
    const hits = tinyHits(30)
    const { parse } = scriptedParse((call) =>
      call.text.includes("Tiny sentence 10 ends.")
        ? new Error("gateway down")
        : { results: [span("1.1", "1.1")] }
    )
    const { cache } = memoryCache()

    const result = await verdict(
      hits,
      "intent",
      "",
      {},
      () => undefined,
      { maxBarren: 1 },
      {
        parse,
        cache,
      }
    )

    expect(result.stop).toBeUndefined()
    expect(result.barren).toBe(false)
    expect(result.consumed).toBe(3)
    expect(result.failures).toHaveLength(1)
    expect(result.rawRemaining).toEqual(hits.slice(10, 20))
  })

  it("three failures running: the failure stop fires and every unanswered hit sits in rawRemaining", async () => {
    const hits = tinyHits(80)
    const { parse, pending } = deferredParse()
    const { cache } = memoryCache()

    const settled = verdict(hits, "intent", "", {}, () => undefined, undefined, { parse, cache })

    await until(() => pending.length === 5)
    pending[0].fail(new Error("down"))
    await until(() => pending.length === 6)
    pending[1].fail(new Error("down"))
    await until(() => pending.length === 7)
    pending[2].fail(new Error("down"))

    const result = await settled
    expect(result.stop).toBe("failures")
    expect(result.barren).toBe(false)
    expect(result.rawRemaining).toEqual(hits)
  })

  it("the filter pool runs at concurrency 5", async () => {
    const hits = tinyHits(80)
    const { cache } = memoryCache()
    let inFlight = 0
    let maxInFlight = 0
    const releases: (() => void)[] = []
    const parse = async <T>(
      _endpoint: string,
      _messages: Message[],
      schema: z.ZodType<T>
    ): Promise<CallResult<T>> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((release) => releases.push(release))
      inFlight--
      const parsed = schema.safeParse({ results: [] })
      if (!parsed.success) return { ok: false, error: parsed.error.message }
      return { ok: true, data: parsed.data }
    }

    const settled = verdict(hits, "intent", "", {}, () => undefined, undefined, { parse, cache })
    for (let released = 0; released < 8; released++) {
      await until(() => releases.length > released)
      releases[released]()
    }
    await settled

    expect(releases).toHaveLength(8)
    expect(maxInFlight).toBe(5)
  })

  it("the cache prefix is filter-v5", () => {
    expect(FILTER_CACHE_PREFIX).toBe("filter-v5")
  })

  it("30k characters with the 20k budget: two calls, results streamed per call", async () => {
    const longText = (seed: string) => `${seed} sentence stands here plainly. `.repeat(450)
    const a = hit(1, longText("Alpha"))
    const b = hit(2, longText("Beta"))
    const { parse, calls } = scriptedParse(() => ({ results: [span("1.1", "1.1")] }))
    const { cache } = memoryCache()
    const { batches, onBatch } = collectBatches()

    const result = await verdict([a, b], "the intent", "", {}, onBatch, undefined, {
      parse,
      cache,
    })

    expect(calls).toHaveLength(2)
    expect(batches).toHaveLength(2)
    expect(batches[0][0].file).toBe(a.file)
    expect(batches[1][0].file).toBe(b.file)
    expect(result.rawRemaining).toEqual([])

    expect(calls[0].text).toContain("<search_intent>the intent</search_intent>")
    expect(calls[0].text).toContain('<entry id="1" file="f1.md">')
    expect(calls[0].text).toContain("[1.1] Alpha sentence stands here plainly.")
    expect(calls[0].text).toContain('"1.2"')
  })

  it("hits without text pass through unfiltered", async () => {
    const bare: SearchHit = { file: "bare.md", score: 1 }
    const texted = hit(1, "One sentence only here.")
    const { parse, calls } = scriptedParse(() => ({ results: [] }))
    const { cache } = memoryCache()

    const result = await verdict([bare, texted], "intent", "", {}, () => undefined, undefined, {
      parse,
      cache,
    })

    expect(calls).toHaveLength(1)
    expect(result.results).toEqual([bare])
  })

  it("scout runs before the cache: a cached answer never resurfaces a scout-excluded hit", async () => {
    const file = "scouted.md"
    const content = "Some paragraph text that scout will exclude entirely."
    const chunks = chunkFileForEmbedding(content)
    expect(chunks.length).toBeGreaterThan(0)

    const excluded: SearchHit = {
      file,
      text: content,
      chunkStart: chunks[0].chunkStart,
      score: 1,
    }
    const { cache, store, gets } = memoryCache()
    store.set(buildKey(["intent", content]), {
      spans: [{ start: 1, end: 1, confidence: "clear", reasonToKeep: "stale" }],
    })

    const { parse, calls } = scriptedParse((call) =>
      call.endpoint === "/scout-filter"
        ? { exclude: [{ from: 1, to: 1, reason: "out of scope" }] }
        : { results: [] }
    )

    const result = await verdict(
      [excluded],
      "intent",
      "the framework",
      { [file]: content },
      () => undefined,
      undefined,
      { parse, cache }
    )

    expect(calls.map((c) => c.endpoint)).toEqual(["/scout-filter"])
    expect(gets).toHaveLength(0)
    expect(result.results).toEqual([])
  })
})
