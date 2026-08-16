import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FIND_ENDPOINT, FIND_MAX_ITEMS } from "~/lib/regions/detect/find"
import { REGION_KIND_IDS } from "~/lib/regions/kinds/registry"
import type { Hit } from "~/lib/regions/detect/types"
import { installRecordedStub, type StubFetch } from "../fetch.fixture"
import type { RecorderHandle } from "../recorder"
import { scanDocument } from "./document"
import { findWorksOf, regionFinder } from "./region-finder"
import {
  answeringDetect,
  findReplyByKind,
  HIT_SENTENCE_NUMBER,
  messageTextsOf,
} from "./region.fixture"

const FILE = "transcript.md"
const raw = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf-8")
const doc = scanDocument(FILE, raw)

const runFinder = (extras: { kind: string; known?: string }): Promise<Hit[]> => {
  const parsed = regionFinder.extras.parse(extras)
  return regionFinder.run({
    files: { [FILE]: raw },
    extras: parsed,
  }) as Promise<Hit[]>
}

describe("region-finder", () => {
  let recorder: RecorderHandle
  let stub: StubFetch
  let teardown: () => Promise<void>

  beforeEach(() => {
    ;({ stub, recorder, teardown } = installRecordedStub(
      answeringDetect({ [FIND_ENDPOINT]: findReplyByKind })
    ))
  })

  afterEach(async () => {
    await teardown()
  })

  it("rejects a kind that is not registered, listing the registered ids", () => {
    const result = regionFinder.extras.safeParse({ kind: "nope" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].message).toContain(REGION_KIND_IDS.join(", "))
    expect(stub.requests).toHaveLength(0)
  })

  it("builds one FindWork per unit, each carrying only its unit's sentences", () => {
    const works = findWorksOf(doc)
    expect(doc.units.length).toBeGreaterThan(1)
    expect(works.map((work) => work.unit)).toEqual(doc.units)
    expect(works.map((work) => work.sentences)).toEqual(
      doc.units.map((unit) => doc.sentences.slice(unit.firstSentence, unit.lastSentence + 1))
    )
    expect(works.every((work) => work.file === FILE)).toBe(true)
  })

  it("returns document-wide hit sentences over every unit of the fixture", async () => {
    const hits = await runFinder({ kind: "person" })

    expect(hits.map((hit) => hit.hitSentence).sort((a, b) => a - b)).toEqual(
      doc.units.map((unit) => unit.firstSentence + HIT_SENTENCE_NUMBER - 1)
    )
    expect(hits.every((hit) => hit.kind === "person")).toBe(true)
    expect(hits.every((hit) => doc.sentences[hit.hitSentence].includes(hit.quote))).toBe(true)
  })

  const knownCases = [
    { name: "lists --known values", known: "b,a", message: "Known values: a, b" },
    {
      name: "says there are no known values when the flag is absent",
      known: undefined,
      message: "No known values yet",
    },
  ]

  it.each(knownCases)("$name", async ({ known, message }) => {
    await runFinder({ kind: "person", known })
    const [first] = await recorder.drain()

    expect(messageTextsOf(first.request)[1]).toContain(message)
  })

  it("carries the values the first call found into the second call's known list", async () => {
    const hits = await runFinder({ kind: "person" })
    const calls = await recorder.drain()

    expect(calls.length).toBeGreaterThan(1)
    const [first, second] = calls
    const firstBatchValues = new Set(hits.slice(0, FIND_MAX_ITEMS).map((hit) => hit.value))
    expect(messageTextsOf(first.request)[1]).toContain("No known values yet")
    const secondKnown = messageTextsOf(second.request)[1]
    for (const value of firstBatchValues) expect(secondKnown).toContain(value)
  })
})
