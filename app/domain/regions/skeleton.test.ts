import { describe, it, expect, beforeEach, vi } from "vitest"
import { setFiles, getFileRaw } from "~/lib/files/store"
import { getBlock } from "~/lib/data-blocks/query"
import { getProjections, toJsonSchema } from "~/domain/db/projections"
import { jsonSchemaToTableProjection } from "~/lib/db/ddl"
import { extractRows } from "~/lib/db/extract"
import { AnnotationsBlockSchema } from "~/domain/data-blocks/annotations/schema"
import { RegionsBlockSchema } from "~/domain/data-blocks/regions/schema"
import { startRegionSync } from "~/lib/regions/sync"
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

// Two speakers, each owning two sentences: what a real find/mark pair returns for this
// transcript, with the gateway replaced at the call boundary and nothing below it faked.
const find: FindCall = async (scan) => ({
  hits:
    scan.kind === "speaker"
      ? [
          { kind: "speaker", quote: "Rutte", hitSentence: 0, value: "rutte" },
          { kind: "speaker", quote: "Kaag", hitSentence: 2, value: "kaag" },
        ]
      : [],
  errors: [],
  dropped: 0,
})

const RANGES: Record<number, [number, number]> = { 0: [0, 1], 2: [2, 3] }

const mark: MarkCall = async (target) => {
  const [startSentence, endSentence] = RANGES[target.hitSentence]
  return {
    mark: {
      kind: target.kind,
      quote: target.quote,
      hitSentence: target.hitSentence,
      value: target.value,
      startSentence,
      endSentence,
    },
  }
}

const speakerOnly = () => regionKinds().filter((kind) => kind.id === "speaker")

const runOnePass = async (): Promise<void> => {
  const handle = startRegionSync({
    getFiles: () => ({ [PATH]: getFileRaw(PATH) }),
    getFile: (path) => getFileRaw(path) || undefined,
    subscribe: () => () => undefined,
    getKinds: speakerOnly,
    detect: { find, mark },
    writeRegions: writeRegionsBlock,
  })
  await handle.ready
  handle.stop()
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  setFiles({ [PATH]: DOCUMENT })
})

describe("the walking skeleton", () => {
  it("writes a json-regions block holding one region per speaker", async () => {
    await runOnePass()
    const block = getBlock(getFileRaw(PATH), "json-regions", RegionsBlockSchema)
    expect(block?.regions.map((r) => r.parsed.value)).toEqual(["rutte", "kaag"])
    expect(block?.regions.map((r) => [r.startSentence, r.endSentence])).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it("hands the editor one renderable region per speaker, on the document's own words", async () => {
    await runOnePass()
    const { regions, sentences } = getRenderableRegions(getFileRaw(PATH))
    expect(regions.map((r) => [r.kind, r.label, r.quote])).toEqual([
      ["speaker", "rutte", "Rutte"],
      ["speaker", "kaag", "Kaag"],
    ])
    expect(regions.every((r) => sentences[r.hitSentence].includes(r.quote))).toBe(true)
    expect(regions.map((r) => r.icon)).toEqual(["mic", "mic"])
  })

  it("projects the regions as rows under the document's own path", async () => {
    await runOnePass()
    const projection = getProjections().find((p) => p.language === "json-regions")
    if (!projection) throw new Error("json-regions is not projected")
    const rows = projection
      .blockParser(getFileRaw(PATH))
      .flatMap((row) => extractRows("regions", toJsonSchema(projection), row, PATH)[0].rows)
    expect(rows.map((r) => [r.file, r.kind, r.parsed_value])).toEqual([
      [PATH, "speaker", "rutte"],
      [PATH, "speaker", "kaag"],
    ])
    const columns = jsonSchemaToTableProjection("regions", toJsonSchema(projection)).schemas[0]
    expect(columns.columns.map((c) => c.name)).toContain("inferred_meta_speaker")
  })

  it("carries the annotation's speaker in inferred_meta, and never on disk", async () => {
    await runOnePass()
    const raw = getFileRaw(PATH)
    const annotations = getBlock(raw, "json-annotations", AnnotationsBlockSchema)
    const decorated = annotations?.annotations[0] as { inferred_meta?: { speaker?: string[] } }
    expect(decorated.inferred_meta?.speaker).toEqual(["kaag"])
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
    const handle = startRegionSync({
      getFiles: () => ({ [PATH]: getFileRaw(PATH) }),
      getFile: (path) => getFileRaw(path) || undefined,
      subscribe: () => () => undefined,
      getKinds: speakerOnly,
      detect: {
        find: async (scan) => {
          calls.push(`find:${scan.kind}`)
          return find(scan)
        },
        mark: async (target) => {
          calls.push(`mark:${target.quote}`)
          return mark(target)
        },
      },
      writeRegions: writeRegionsBlock,
    })
    await handle.ready
    handle.stop()
    expect(calls).toEqual([])
    expect(getFileRaw(PATH)).toBe(afterFirst)
    expect(errors).toEqual([])
  })
})
