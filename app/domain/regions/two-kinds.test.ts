import { describe, it, expect, beforeEach, vi } from "vitest"
import { setFiles, getFileRaw } from "~/lib/files/store"
import { executeFileAction } from "~/lib/data-blocks/file-action"
import { clearEntries, getEntries } from "~/lib/mutation-history/store"
import { getBlock } from "~/lib/data-blocks/query"
import { RegionsBlockSchema } from "~/domain/data-blocks/regions/schema"
import { startRegionSync } from "~/lib/regions/sync"
import { regionKinds } from "~/lib/regions/kinds/registry"
import type { FindCall, MarkCall } from "~/lib/regions/detect/types"
import { writeRegionsBlock } from "./init"

const PATH = "diary.md"

const TRANSCRIPT = [
  "Rutte opened the meeting on 3 March 2026.",
  "He said the budget was settled.",
  "Then Kaag disagreed with him.",
  "She wanted another week to check the figures.",
].join(" ")

const DOCUMENT = `${TRANSCRIPT}\n`

const find: FindCall = async (scan) => ({
  hits:
    scan.kind === "speaker"
      ? [
          { kind: "speaker", quote: "Rutte", hitSentence: 0, value: "rutte" },
          { kind: "speaker", quote: "Kaag", hitSentence: 2, value: "kaag" },
        ]
      : [
          {
            kind: "date",
            quote: "3 March 2026",
            hitSentence: 0,
            value: "2026-03-03T00:00:00.000Z",
          },
        ],
  errors: [],
  dropped: 0,
})

const RANGES: Record<string, [number, number]> = {
  "speaker:0": [0, 1],
  "speaker:2": [2, 3],
  "date:0": [0, 3],
}

const mark: MarkCall = async (target) => {
  const [startSentence, endSentence] = RANGES[`${target.kind}:${target.hitSentence}`]
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

const runOnePass = async (calls: string[]): Promise<void> => {
  const handle = startRegionSync({
    getFiles: () => ({ [PATH]: getFileRaw(PATH) }),
    getFile: (path) => getFileRaw(path) || undefined,
    subscribe: () => () => undefined,
    getKinds: regionKinds,
    detect: {
      find: async (scan) => {
        calls.push(`find:${scan.kind}`)
        return find(scan)
      },
      mark: async (target) => {
        calls.push(`mark:${target.kind}:${target.quote}`)
        return mark(target)
      },
    },
    writeRegions: writeRegionsBlock,
  })
  await handle.ready
  handle.stop()
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  setFiles({ [PATH]: DOCUMENT })
  clearEntries()
})

describe("a two-kind document", () => {
  it("reaches a fixed point on the pass its own write wakes", async () => {
    const first: string[] = []
    await runOnePass(first)
    const afterFirst = getFileRaw(PATH)

    const block = getBlock(afterFirst, "json-regions", RegionsBlockSchema)
    expect(block?.regions.map((r) => [r.kind, r.parsed.value])).toEqual([
      ["speaker", "rutte"],
      ["speaker", "kaag"],
      ["date", "2026-03-03T00:00:00.000Z"],
    ])

    const second: string[] = []
    await runOnePass(second)

    expect(second).toEqual([])
    expect(getFileRaw(PATH)).toBe(afterFirst)
  })

  it("pushes no mutation-history entry for its write or for the pass that write wakes", async () => {
    await runOnePass([])
    const afterFirst = getFileRaw(PATH)

    await runOnePass([])

    expect(getEntries()).toEqual([])
    expect(getFileRaw(PATH)).toBe(afterFirst)

    executeFileAction({
      patches: [
        {
          path: PATH,
          language: "json-annotations",
          ops: [
            {
              op: "add",
              path: "/annotations",
              value: [{ id: "note-1", text: "another week", reason: "the delay", color: "amber" }],
            },
          ],
        },
      ],
      skipPendingRefs: true,
    })

    expect(getEntries().map((entry) => [entry.path, entry.verb])).toEqual([[PATH, "added"]])
  })
})
