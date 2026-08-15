import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { ok } from "~/lib/fp/result"
import { startEngine } from "~/lib/engine/engine"
import type { EngineDeps } from "~/lib/engine/types"
import type { RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { zeroVector } from "~/lib/embeddings/embedding.fixtures"
import type { FindCall, FindWork, MarkCall, MarkWork } from "./detect/types"
import { personKind, transcript, answeringDetect } from "./person.fixtures"
import { readStoredRegions } from "./stored"
import type { WriteOutcome } from "./sync-types"

const recordingDetect = () => {
  const offeredFinds: FindWork[] = []
  const offeredMarks: MarkWork[] = []
  const find: FindCall = (items) => {
    offeredFinds.push(...items)
    return Promise.resolve({ unrecorded: [] })
  }
  const mark: MarkCall = (items) => {
    offeredMarks.push(...items)
    return Promise.resolve()
  }
  return { calls: { find, mark }, offeredFinds, offeredMarks }
}

const REGION_OPS = (block: RegionsBlock) => [
  { op: "add" as const, path: "/regions", value: block.regions },
  { op: "add" as const, path: "/scanned", value: block.scanned },
]

const createProject = (initial: Record<string, string>) => {
  const files: Record<string, string> = { ...initial }

  const writeRegions = (path: string, next: RegionsBlock): WriteOutcome => {
    const result = patchBlockContent(files[path] ?? "", "json-regions", REGION_OPS(next))
    if (!result.ok) return result.error === "No changes" ? "unchanged" : "failed"
    files[path] = result.content
    return "written"
  }

  return {
    regionsIn: (path: string) => readStoredRegions(files[path] ?? ""),
    deps: {
      getFiles: () => files,
      getFile: (path: string) => files[path],
      updateFile: (path: string, content: string) => {
        files[path] = content
      },
      deleteFile: (path: string) => {
        Reflect.deleteProperty(files, path)
      },
      subscribe: () => () => undefined,
      embeddingsUrl: "http://embeddings.test",
      fetchBatch: (texts: string[]) => Promise.resolve(ok(texts.map(() => zeroVector()))),
      classify: () => Promise.resolve(null),
      getKinds: () => [personKind],
      writeRegions,
      getSignificantLanguages: () => Promise.resolve([]),
      syncDescriptions: () => Promise.resolve(),
      onEvent: () => undefined,
    } satisfies Omit<EngineDeps, "detect">,
  }
}

const runOnePass = async (deps: EngineDeps): Promise<void> => {
  const engine = startEngine(deps)
  await engine.ready
  engine.stop()
}

let errors: string[] = []

beforeEach(() => {
  errors = []
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  expect(errors).toEqual([])
  vi.restoreAllMocks()
})

describe("a boot over an already-scanned document", () => {
  it("offers detect no unit to find and no hit to mark on its first pass", async () => {
    const project = createProject({ "talk.md": transcript(8) })

    await runOnePass({ ...project.deps, detect: answeringDetect() })

    const stored = project.regionsIn("talk.md")
    expect(stored.scanned[personKind.id].length).toBeGreaterThan(0)
    expect(stored.regions.length).toBeGreaterThan(0)

    const detect = recordingDetect()
    await runOnePass({ ...project.deps, detect: detect.calls })

    expect(detect.offeredFinds).toEqual([])
    expect(detect.offeredMarks).toEqual([])
    expect(project.regionsIn("talk.md")).toEqual(stored)
  })
})
