import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { SearchHit } from "~/domain/search/types"
import type { Message } from "~/lib/calls/messages"
import { textOf } from "~/lib/calls/parse.fixture"
import {
  gatewayUrl,
  installRecordedStub,
  streamingJson,
  type Respond,
  type StubFetch,
} from "../fetch.fixture"
import { scanDocument } from "./document"
import { semanticFilter } from "./semantic-filter"
import { FILTER_ITEM_CAP } from "~/lib/search/verdict"

const TRANSCRIPT = resolve("scripts/fixtures/try-prompt/transcript.md")
const INTENT = "commitments made by named people"

const raw = readFileSync(TRANSCRIPT, "utf8")
const unitCount = scanDocument("transcript.md", raw).units.length
const batchCount = Math.ceil(unitCount / FILTER_ITEM_CAP)

const oneSpan = {
  results: [{ start: "1.1", end: "1.2", confidence: "clear", reasonToKeep: "a promise is made" }],
}

const runWith = (intent: string) =>
  semanticFilter.run({ files: { "transcript.md": raw }, extras: { intent } })

const messageText = (body: string): string =>
  (JSON.parse(body) as { input: Message[] }).input.map(textOf).join("\n")

describe("semantic-filter", () => {
  let stub: StubFetch
  let teardown: () => Promise<void>
  let respond: Respond = () => streamingJson({ results: [] })

  beforeAll(() => {
    ;({ stub, teardown } = installRecordedStub((request, ordinal) => respond(request, ordinal)))
  })

  beforeEach(() => stub.requests.splice(0))

  afterAll(async () => {
    await teardown()
  })

  it("constructs one kept hit per batch when each reply keeps its first entry's span", async () => {
    respond = () => streamingJson(oneSpan)
    const constructed = (await runWith(INTENT)) as SearchHit[]
    expect(constructed).toHaveLength(batchCount)
    const [hit] = constructed
    expect(hit.file).toBe("transcript.md")
    expect(hit.matches).toHaveLength(1)
    expect(hit.matches?.[0].length).toBeGreaterThan(0)
    expect(hit.matchRanges).toEqual([
      { start: 0, end: 1, confidence: "clear", reasonToKeep: "a promise is made" },
    ])
  })

  it("calls /semantic-filter once per batch and never /scout-filter", async () => {
    respond = () => streamingJson(oneSpan)
    await runWith(INTENT)
    expect(stub.requests.map((r) => r.url)).toEqual(
      Array.from({ length: batchCount }, () => gatewayUrl("/semantic-filter"))
    )
  })

  it("sends the intent and one entry per unit across the batches, each carrying the basename", async () => {
    respond = () => streamingJson({ results: [] })
    await runWith(INTENT)
    const texts = stub.requests.map((r) => messageText(r.body))
    for (const text of texts) expect(text).toContain(`<search_intent>${INTENT}</search_intent>`)
    const files = texts.flatMap((text) =>
      [...text.matchAll(/<entry id="\d+" file="([^"]*)"/g)].map((m) => m[1])
    )
    expect(files).toHaveLength(unitCount)
    expect(new Set(files)).toEqual(new Set(["transcript.md"]))
  })

  it("constructs nothing when the filter keeps no span", async () => {
    respond = () => streamingJson({ results: [] })
    await expect(runWith(INTENT)).resolves.toEqual([])
  })
})
