import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MARK_ENDPOINT } from "~/lib/regions/detect/mark"
import type { Hit, Mark } from "~/lib/regions/detect/types"
import { REGION_KIND_IDS } from "~/lib/regions/kinds/registry"
import { installRecordedStub, type StubFetch } from "../fetch.fixture"
import type { RecorderHandle } from "../recorder"
import { UsageError } from "./types"
import { scanDocument } from "./document"
import { markWorksOf, parseHits, regionMarker } from "./region-marker"
import { regionFinder } from "./region-finder"
import { render } from "../report"
import { answeringDetect, fileAttributesOf, isForKind, markReply } from "./region.fixture"

const FILE = "transcript.md"
const raw = readFileSync("scripts/fixtures/try-prompt/transcript.md", "utf-8")
const doc = scanDocument(FILE, raw)

const hitAt = (hitSentence: number, quote: string): Hit => ({
  kind: "person",
  quote,
  hitSentence,
  value: quote.toLowerCase(),
})

const HITS: Hit[] = [hitAt(2, "Priya Nair"), hitAt(6, "Tom Okafor"), hitAt(48, "Sanjay Bhatt")]

const dir = mkdtempSync(join(tmpdir(), "region-marker-"))

const hitsFile = (name: string, contents: string): string => {
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

const runMarker = (hits: string, kind = "person"): Promise<Mark[]> => {
  const extras = regionMarker.extras.parse({ kind, hits })
  return regionMarker.run({ files: { [FILE]: raw }, extras }) as Promise<Mark[]>
}

describe("region-marker", () => {
  let recorder: RecorderHandle
  let stub: StubFetch
  let teardown: () => Promise<void>

  beforeEach(() => {
    ;({ stub, recorder, teardown } = installRecordedStub(
      answeringDetect({ [MARK_ENDPOINT]: markReply })
    ))
  })

  afterEach(async () => {
    await teardown()
  })

  const malformed = [
    {
      name: "a hit missing its value",
      contents: JSON.stringify([{ kind: "person", quote: "Priya", hitSentence: 2 }]),
      names: "value",
    },
    {
      name: "a hitSentence that is not a number",
      contents: JSON.stringify([{ kind: "person", quote: "Priya", hitSentence: "2", value: "p" }]),
      names: "hitSentence",
    },
    {
      name: "a bare object instead of an array",
      contents: JSON.stringify({ kind: "person", quote: "Priya", hitSentence: 2, value: "p" }),
      names: "array",
    },
    { name: "text that is not JSON", contents: "not json", names: "JSON" },
  ]

  it.each(malformed)("rejects $name before any call", async ({ name, contents, names }) => {
    const path = hitsFile(`${name.replace(/\W+/g, "-")}.json`, contents)
    await expect(runMarker(path)).rejects.toThrow(UsageError)
    await expect(runMarker(path)).rejects.toThrow(names)
    expect(stub.requests).toHaveLength(0)
  })

  // agents.md: the hits file is "the constructed output of region-finder, unchanged",
  // and region-finder's output for a run is all one kind — the kind whose rules the
  // marker is about to send. A hits file of another kind is well-typed and still not
  // that file, and the contract's usage errors "must cost nothing".
  it("rejects a hits file whose kind is not the --kind before any call", async () => {
    const path = hitsFile(
      "other-kind.json",
      JSON.stringify([{ kind: "date", quote: "Priya Nair", hitSentence: 2, value: "2026-03-03" }])
    )
    await expect(runMarker(path, "person")).rejects.toThrow(UsageError)
    await expect(runMarker(path, "person")).rejects.toThrow('hits[0].kind is "date"')
    expect(stub.requests).toHaveLength(0)
  })

  it("rejects an unreadable hits file before any call", async () => {
    const path = join(dir, "missing.json")
    await expect(runMarker(path)).rejects.toThrow(UsageError)
    await expect(runMarker(path)).rejects.toThrow(path)
    expect(stub.requests).toHaveLength(0)
  })

  it("rejects a kind that is not registered, listing the registered ids", () => {
    const result = regionMarker.extras.safeParse({ kind: "nope", hits: "x.json" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].message).toContain(REGION_KIND_IDS.join(", "))
    expect(stub.requests).toHaveLength(0)
  })

  it("drops a hit whose sentence is past the end of the document", async () => {
    const past = hitAt(doc.sentences.length, "Nobody")
    const works = markWorksOf(doc, [...HITS, past])
    expect(works.map((work) => work.hit)).toEqual(HITS)

    const marks = await runMarker(hitsFile("past.json", JSON.stringify([...HITS, past])))
    expect(
      marks.map(({ kind, quote, hitSentence, value }) => ({ kind, quote, hitSentence, value }))
    ).toEqual(HITS)
    expect(marks.every((mark) => mark.startSentence <= mark.hitSentence)).toBe(true)
    expect(marks.every((mark) => mark.endSentence >= mark.hitSentence)).toBe(true)
  })

  it("reads the hits out of a whole saved region-finder report", async () => {
    const report = render({
      agent: { name: regionFinder.name, constructedLabel: regionFinder.constructedLabel },
      path: "transcript.md",
      calls: [{ index: 1, endpoint: "/region-finder", request: "{}", reply: "[]" }],
      constructed: HITS,
      outcome: { kind: "completed" },
      view: "constructed-only",
      showRequests: false,
    })
    expect(parseHits(report, "report.txt")).toEqual(HITS)
  })

  const iterationReport = (number: number, constructed: unknown): string =>
    render({
      agent: { name: regionFinder.name, constructedLabel: regionFinder.constructedLabel },
      path: "transcript.md",
      calls: [],
      constructed,
      outcome: { kind: "completed" },
      view: "constructed-only",
      showRequests: false,
      iteration: { number, of: 2 },
    })

  // agents.md: the hits are read "from below the last `== hits` heading", so a report
  // saved from --count carries the last iteration's hits, not the first's.
  it("reads the hits of the last iteration of a --count report", () => {
    const later = [hitAt(9, "Ada Lovelace")]
    const saved = [iterationReport(1, HITS), iterationReport(2, later)].join("\n")
    expect(parseHits(saved, "report.txt")).toEqual(later)
  })

  it("names the file by its basename in every entry of the request", async () => {
    await runMarker(hitsFile("hits.json", JSON.stringify(HITS)))
    const calls = await recorder.drain()

    expect(calls.length).toBeGreaterThan(0)
    const files = calls.flatMap((call) => fileAttributesOf(call.request))
    expect(files.length).toBeGreaterThan(0)
    expect(new Set(files)).toEqual(new Set([FILE]))
    expect(calls.every((call) => isForKind(call.request, "person"))).toBe(true)
  })
})
