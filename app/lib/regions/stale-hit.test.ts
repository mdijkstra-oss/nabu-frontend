import { describe, it, expect, beforeEach, vi } from "vitest"
import { setFiles, getFileRaw, updateFileRaw, deleteFile } from "~/lib/files/store"
import { ok } from "~/lib/fp/result"
import { getEmbeddingsDimensions } from "~/lib/embeddings/env"
import { writeRegionsBlock } from "~/domain/regions/init"
import { regionKinds } from "~/lib/regions/kinds/registry"
import { startEngine } from "~/lib/engine/engine"
import type { FindCall, MarkCall } from "~/lib/regions/detect/types"

const PATH = "interview.md"
const SIBLING = "notes.md"

const TRANSCRIPT = [
  "Rutte opened the meeting.",
  "He said the budget was settled.",
  "Then Kaag disagreed with him.",
  "She wanted another week to check the figures.",
].join(" ")

const find: FindCall = async (items, job) => {
  for (const item of items) {
    job.onAnswered(
      item,
      job.kind.id === "speaker" && item.unit.firstSentence === 0
        ? [{ kind: "speaker", quote: "Rutte", hitSentence: 0, value: "rutte" }]
        : []
    )
  }
  return { unrecorded: [] }
}

const mark: MarkCall = async (items, job) => {
  for (const item of items) {
    job.onAnswered(item, { ...item.hit, startSentence: 0, endSentence: 1 })
  }
}

const speakerOnly = () => regionKinds().filter((kind) => kind.id === "speaker")

const zeroVector = (): number[] => new Array<number>(getEmbeddingsDimensions()).fill(0)

const runOnePass = async (): Promise<void> => {
  const handle = startEngine({
    getFiles: () => ({ [PATH]: getFileRaw(PATH), [SIBLING]: getFileRaw(SIBLING) }),
    getFile: (path) => getFileRaw(path) || undefined,
    updateFile: updateFileRaw,
    deleteFile,
    subscribe: () => () => undefined,
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => Promise.resolve(ok(texts.map(() => zeroVector()))),
    classify: () => Promise.resolve(null),
    getKinds: speakerOnly,
    detect: { find, mark },
    writeRegions: writeRegionsBlock,
    getSignificantLanguages: () => Promise.resolve([]),
    syncDescriptions: () => Promise.resolve(),
    onEvent: () => undefined,
  })
  await handle.ready
  handle.stop()
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  setFiles({ [PATH]: `${TRANSCRIPT}\n`, [SIBLING]: "" })
})

// regions-block.md:48 — "Not enforced: that indexes fall inside the document. The schema
// has no document... Readers must tolerate it". region-sync.md is the repairer, and the
// hit it hands to detection's window computation is one the file store may have moved.
describe("a stored hit whose sentence index is past the end of the document", () => {
  it("does not take the pass down", async () => {
    await runOnePass()
    const withRegions = getFileRaw(PATH)
    expect(withRegions).toContain("json-regions")

    // A user hand-edits the raw markdown (or multiplayer delivers these bytes):
    // the row's hitSentence now names a sentence the document does not have.
    setFiles({
      [PATH]: withRegions.replace(`"hitSentence": 0`, `"hitSentence": 99`),
      [SIBLING]: "A fresh sibling document. It has never been scanned.\n",
    })

    const errors: unknown[][] = []
    vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args))

    await runOnePass()

    // The healthy sibling in the same pass still gets its block.
    expect(getFileRaw(SIBLING)).toContain("json-regions")
    expect(errors).toEqual([])
  })

  it("is dropped rather than carried forward at an index nothing can locate", async () => {
    await runOnePass()
    const stale = getFileRaw(PATH).replace(`"hitSentence": 0`, `"hitSentence": 99`)
    setFiles({ [PATH]: stale, [SIBLING]: "" })

    await runOnePass()

    expect(getFileRaw(PATH)).not.toContain(`"hitSentence": 99`)
  })
})
