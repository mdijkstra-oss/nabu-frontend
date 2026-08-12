import { describe, it, expect } from "vitest"
import type { z } from "zod"
import type { SearchHit } from "~/domain/search/types"
import type { CallResult } from "~/lib/agent/client/call-parse"
import type { Message } from "~/lib/calls/messages"
import { readCorpusDocument } from "~/lib/text/fixtures/corpus"
import { chunkFileForEmbedding } from "~/lib/embeddings/chunk"
import { respondingWith, textOf } from "~/lib/calls/parse.fixture"
import { buildChunkBlocks, scoutFilterBatch } from "./scout"
import { getEmbeddableSource } from "./source"

interface RecordedCall {
  endpoint: string
  text: string
  index: number
}

const until = async (ready: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve))
  }
  if (!ready()) throw new Error("condition never became true")
}

const scriptedParse = (respond: (call: RecordedCall) => unknown) => {
  const calls: RecordedCall[] = []
  const fake = respondingWith((endpoint, messages) => {
    const call = { endpoint, text: messages.map(textOf).join("\n"), index: calls.length }
    calls.push(call)
    return respond(call)
  })
  return { parse: fake.parse, calls }
}

const paragraph = (i: number, filler: number): string =>
  `Paragraph ${i} opens with a steady claim. ` +
  "It continues with more of the same measured prose that fills the block. ".repeat(filler)

const proseDocument = (paragraphs: number, filler: number): string =>
  Array.from({ length: paragraphs }, (_, i) => paragraph(i, filler)).join("\n\n")

const hitsCoveringChunks = (file: string, content: string): SearchHit[] =>
  chunkFileForEmbedding(content).map((chunk, i) => ({
    file,
    text: `Hit over chunk ${i}.`,
    chunkStart: chunk.chunkStart,
    score: 1,
  }))

describe("buildChunkBlocks", () => {
  it("empty chunks yield empty blocks", () => {
    expect(buildChunkBlocks("hello", [])).toEqual([])
  })

  it("single chunk covers the whole content", () => {
    const content = "abcdef"
    const chunks = [{ index: 0, text: "abcdef", hash: "h", chunkStart: 0, chunkEnd: 6 }]
    expect(buildChunkBlocks(content, chunks)).toEqual([{ chunkStart: 0, text: "abcdef" }])
  })

  it("consecutive chunks split at next chunkStart — no overlap, no gap", () => {
    const content = "0123456789ABCDEF"
    const chunks = [
      { index: 0, text: "0123456789", hash: "a", chunkStart: 0, chunkEnd: 10 },
      { index: 1, text: "6789ABCDEF", hash: "b", chunkStart: 6, chunkEnd: 16 },
    ]
    const blocks = buildChunkBlocks(content, chunks)
    expect(blocks).toEqual([
      { chunkStart: 0, text: "012345" },
      { chunkStart: 6, text: "6789ABCDEF" },
    ])
    expect(blocks.map((b) => b.text).join("")).toBe(content)
  })

  it("tiles the embeddable source a search hit's chunkStart is measured in", () => {
    const file = "notes.md"
    const content = readCorpusDocument("links-and-code.md")
    const source = getEmbeddableSource(file, { [file]: content })
    if (source === null) throw new Error("no embeddable source for the fixture")
    const chunks = chunkFileForEmbedding(content)

    const blocks = buildChunkBlocks(source, chunks)
    expect(blocks.map((b) => b.chunkStart)).toEqual(chunks.map((c) => c.chunkStart))
    expect(blocks.map((b) => b.text).join("")).toBe(source.slice(chunks[0].chunkStart))
  })
})

describe("scoutFilterBatch", () => {
  it("an answer excluding entries 3 through 5 excludes exactly those chunks' starts", async () => {
    const file = "notes.md"
    const content = proseDocument(24, 6)
    const chunks = chunkFileForEmbedding(content)
    expect(chunks.length).toBeGreaterThanOrEqual(5)

    const hits = hitsCoveringChunks(file, content)
    const { parse, calls } = scriptedParse(() => ({
      exclude: [{ from: 3, to: 5, reason: "out of scope" }],
    }))

    const surviving = await scoutFilterBatch(hits, "the framework", { [file]: content }, parse)

    expect(calls).toHaveLength(1)
    const excludedStarts = new Set(chunks.slice(2, 5).map((c) => c.chunkStart))
    expect(surviving).toEqual(hits.filter((h) => !excludedStarts.has(h.chunkStart ?? -1)))
    expect(hits.length - surviving.length).toBe(3)
  })

  it("a file past the 100k budget splits into two calls with ids scoped per call", async () => {
    const file = "monster.md"
    const content = proseDocument(100, 16)
    expect(content.length).toBeGreaterThan(100_000)
    const hits = hitsCoveringChunks(file, content)

    const { parse, calls } = scriptedParse(() => ({
      exclude: [{ from: 1, to: 1, reason: "opening block" }],
    }))

    const surviving = await scoutFilterBatch(hits, "the framework", { [file]: content }, parse)

    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.text).toContain('<entry id="1" file="monster.md">')
    expect(hits.length - surviving.length).toBe(2)
    expect(surviving).not.toContain(hits[0])
  })

  it("a failed scout call rejects the batch", async () => {
    const file = "notes.md"
    const content = proseDocument(4, 4)
    const hits = hitsCoveringChunks(file, content)
    const { parse } = scriptedParse(() => new Error("gateway down"))

    await expect(
      scoutFilterBatch(hits, "the framework", { [file]: content }, parse)
    ).rejects.toThrow()
  })

  it("the scout file pool runs at concurrency 5", async () => {
    const files: Record<string, string> = {}
    const hits: SearchHit[] = []
    for (let i = 0; i < 8; i++) {
      const name = `doc${i}.md`
      files[name] = `Document ${i} says something plain and short.`
      hits.push({ file: name, text: "t", chunkStart: 0 })
    }

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
      const parsed = schema.safeParse({ exclude: [] })
      if (!parsed.success) return { ok: false, error: parsed.error.message }
      return { ok: true, data: parsed.data }
    }

    const settled = scoutFilterBatch(hits, "the framework", files, parse)
    for (let released = 0; released < 8; released++) {
      await until(() => releases.length > released)
      releases[released]()
    }
    const surviving = await settled

    expect(releases).toHaveLength(8)
    expect(maxInFlight).toBe(5)
    expect(surviving).toEqual(hits)
  })

  it("an empty framework passes the batch through without a call", async () => {
    const hits: SearchHit[] = [{ file: "a.md", text: "One.", chunkStart: 0 }]
    const { parse, calls } = scriptedParse(() => new Error("must not be called"))

    const surviving = await scoutFilterBatch(hits, "", {}, parse)

    expect(surviving).toEqual(hits)
    expect(calls).toHaveLength(0)
  })
})
