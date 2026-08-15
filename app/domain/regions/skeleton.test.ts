import { describe, it, expect, beforeEach, vi } from "vitest"
import { setFiles, getFileRaw, updateFileRaw, deleteFile } from "~/lib/files/store"
import { getBlock } from "~/lib/data-blocks/query"
import { ok } from "~/lib/fp/result"
import { getEmbeddingsDimensions } from "~/lib/embeddings/env"
import { getProjections, toJsonSchema } from "~/domain/db/projections"
import { jsonSchemaToTableProjection } from "~/lib/db/ddl"
import { extractRows } from "~/lib/db/extract"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { RegionsBlockSchema } from "~/domain/data-blocks/regions/schema"
import { startEngine } from "~/lib/engine/engine"
import type { DetectCalls } from "~/lib/regions/detect/types"
import { regionKinds } from "~/lib/regions/kinds/registry"
import type { FindCall, MarkCall } from "~/lib/regions/detect/types"
import { getRenderableRegions } from "./selectors"
import { writeRegionsBlock } from "./init"

const PATH = "interview.md"

const TRANSCRIPT = [
  "Rutte opened the meeting.",
  "He said the budget was settled.",
  "Then Kaag disagreed with him.",
  "She wanted another week to check the figures.",
].join(" ")

const ANNOTATION = {
  text: "another week to check the figures",
  reason: "the disagreement",
  color: "amber",
}

const DOCUMENT = `${TRANSCRIPT}\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations: [ANNOTATION] })}\n\`\`\`\n`

// Two people, each owning two sentences: what a real find/mark pair returns for this
// transcript, with the detectors faked at the DetectCalls seam and nothing below it.
const HITS = [
  { kind: "person", quote: "Rutte", hitSentence: 0, value: "rutte" },
  { kind: "person", quote: "Kaag", hitSentence: 2, value: "kaag" },
]

const find: FindCall = async (items, job) => {
  for (const item of items) {
    job.onAnswered(
      item,
      job.kind.id === "person"
        ? HITS.filter(
            (hit) =>
              hit.hitSentence >= item.unit.firstSentence &&
              hit.hitSentence <= item.unit.lastSentence
          )
        : []
    )
  }
  return { unrecorded: [] }
}

const RANGES: Record<number, [number, number]> = { 0: [0, 1], 2: [2, 3] }

const mark: MarkCall = async (items, job) => {
  for (const item of items) {
    const [startSentence, endSentence] = RANGES[item.hit.hitSentence]
    job.onAnswered(item, { ...item.hit, startSentence, endSentence })
  }
}

const personOnly = () => regionKinds().filter((kind) => kind.id === "person")

const zeroVector = (): number[] => new Array<number>(getEmbeddingsDimensions()).fill(0)

const runEnginePass = async (detect: DetectCalls): Promise<void> => {
  const handle = startEngine({
    getFiles: () => ({ [PATH]: getFileRaw(PATH) }),
    getFile: (path) => getFileRaw(path) || undefined,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe: () => () => undefined,
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => Promise.resolve(ok(texts.map(() => zeroVector()))),
    classify: () => Promise.resolve(null),
    getKinds: personOnly,
    detect,
    writeRegions: writeRegionsBlock,
    getSignificantLanguages: () => Promise.resolve([]),
    syncDescriptions: () => Promise.resolve(),
    onEvent: () => undefined,
  })
  await handle.ready
  handle.stop()
}

const runOnePass = (): Promise<void> => runEnginePass({ find, mark })

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  setFiles({ [PATH]: DOCUMENT })
})

describe("the walking skeleton", () => {
  it("writes a json-regions block holding one region per person", async () => {
    await runOnePass()
    const block = getBlock(getFileRaw(PATH), "json-regions", RegionsBlockSchema)
    expect(block?.regions.map((r) => r.parsed.value)).toEqual(["rutte", "kaag"])
    expect(block?.regions.map((r) => [r.startSentence, r.endSentence])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it("hands the editor one renderable region per person, on the document's own words", async () => {
    await runOnePass()
    const { regions, sentences } = getRenderableRegions(getFileRaw(PATH))
    expect(regions.map((r) => [r.kind, r.label, r.quote])).toEqual([
      ["person", "rutte", "Rutte"],
      ["person", "kaag", "Kaag"],
    ])
    expect(regions.every((r) => sentences[r.hitSentence].includes(r.quote))).toBe(true)
    expect(regions.map((r) => r.icon)).toEqual(["user", "user"])
  })

  it("projects the regions as rows under the document's own path", async () => {
    await runOnePass()
    const projection = getProjections().find((p) => p.language === "json-regions")
    if (!projection) throw new Error("json-regions is not projected")
    const rows = projection
      .blockParser(getFileRaw(PATH))
      .flatMap((row) => extractRows("regions", toJsonSchema(projection), row, PATH)[0].rows)
    expect(rows.map((r) => [r.file, r.kind, r.parsed_value])).toEqual([
      [PATH, "person", "rutte"],
      [PATH, "person", "kaag"],
    ])
    const columns = jsonSchemaToTableProjection("regions", toJsonSchema(projection)).schemas[0]
    expect(columns.columns.map((c) => c.name)).toContain("inferred_meta_person")
  })

  it("carries the annotation's person in inferred_meta, and never on disk", async () => {
    await runOnePass()
    const raw = getFileRaw(PATH)
    const annotations = getBlock(raw, "json-annotations", AnnotationsBlockSchema)
    const decorated = annotations?.annotations[0] as { inferred_meta?: { person?: string[] } }
    expect(decorated.inferred_meta?.person).toEqual(["kaag"])
    expect(raw).not.toContain("inferred_meta")
  })

  it("is idle on the pass its own write wakes", async () => {
    await runOnePass()
    const afterFirst = getFileRaw(PATH)
    const calls: string[] = []
    // A byte-identical derived block must round-trip through the real writeRegionsBlock
    // wrapper as "unchanged", never "failed" — region-sync.md: "the failure count stays
    // at zero however many passes run" and "nothing is logged" for this case.
    const errors: unknown[] = []
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args)
    })
    await runEnginePass({
      find: async (items, job) => {
        for (const item of items) calls.push(`find:${job.kind.id}:${item.unit.firstSentence}`)
        return find(items, job)
      },
      mark: async (items, job) => {
        for (const item of items) calls.push(`mark:${item.hit.quote}`)
        return mark(items, job)
      },
    })
    expect(calls).toEqual([])
    expect(getFileRaw(PATH)).toBe(afterFirst)
    expect(errors).toEqual([])
  })
})
