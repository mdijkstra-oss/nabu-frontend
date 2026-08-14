// Adversarial pins for the pass around batched detection: a unit that was not
// explicitly acknowledged — abandoned or left by the no-progress exit — never enters
// `scanned` (regions.md:13), every candidate (file, stage) pair still terminates in
// exactly one settled or failed event, and mark abandonment lands durably as an
// unranged row (regions.md:25).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { ok } from "~/lib/fp/result"
import { zeroVector } from "~/lib/embeddings/embedding.fixtures"
import { startEngine } from "~/lib/engine/engine"
import type { EngineEvent } from "~/lib/engine/types"
import { isResolved, type RegionsBlock } from "~/domain/data-blocks/regions/schema"
import type { FindCall, FindWork, MarkCall } from "./detect/types"
import { speakerKind, transcript } from "./speaker.fixtures"
import { readStoredRegions } from "./stored"
import type { WriteOutcome } from "./sync-types"

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
    files,
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
      getKinds: () => [speakerKind],
      writeRegions,
    },
  }
}

// The seam's find contract: answered units via onAnswered, abandoned via onAbandoned,
// no-progress leftovers returned as unrecorded — nothing else touches the caller.
type FindSplit = (items: FindWork[]) => {
  answer: FindWork[]
  abandon: FindWork[]
  unrecorded: FindWork[]
}

const findWith =
  (split: FindSplit): FindCall =>
  async (items, job) => {
    const { answer, abandon, unrecorded } = split(items)
    for (const item of abandon) job.onAbandoned?.(item)
    for (const item of answer) {
      job.onAnswered(
        item,
        item.sentences[0].includes("Rutte")
          ? [
              {
                kind: "speaker",
                quote: "Rutte",
                hitSentence: item.unit.firstSentence,
                value: "rutte",
              },
            ]
          : []
      )
    }
    return { unrecorded }
  }

const markOwnSentence: MarkCall = async (items, job) => {
  for (const item of items) {
    job.onAnswered(item, {
      ...item.hit,
      startSentence: item.hit.hitSentence,
      endSentence: item.hit.hitSentence,
    })
  }
}

const startSync = (
  project: ReturnType<typeof createProject>,
  find: FindCall,
  mark: MarkCall,
  events: EngineEvent[]
) =>
  startEngine({
    ...project.deps,
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => Promise.resolve(ok(texts.map(() => zeroVector()))),
    classify: () => Promise.resolve(null),
    detect: { find, mark },
    getSignificantLanguages: () => Promise.resolve([]),
    syncDescriptions: () => Promise.resolve(),
    onEvent: (event) => events.push(event),
  })

const runOnePass = async (
  project: ReturnType<typeof createProject>,
  find: FindCall,
  mark: MarkCall = markOwnSentence
): Promise<EngineEvent[]> => {
  const events: EngineEvent[] = []
  const handle = startSync(project, find, mark, events)
  await handle.ready
  handle.stop()
  return events
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("terminality at every find outcome", () => {
  // The progress counter the old sync reported ("processed == total at every terminal
  // state", regions.md:16) is retired with it; what survives is the engine's event
  // contract — every candidate (file, stage) pair ends in exactly one terminal event,
  // whatever detection answered, abandoned, or left unrecorded.
  const cases: { name: string; split: FindSplit }[] = [
    {
      name: "all entries acknowledged",
      split: (items) => ({ answer: items, abandon: [], unrecorded: [] }),
    },
    {
      name: "one entry abandoned after persistent silence",
      split: (items) => ({ answer: items.slice(1), abandon: items.slice(0, 1), unrecorded: [] }),
    },
    {
      name: "the no-progress exit leaving units unrecorded",
      split: (items) => ({ answer: items.slice(1), abandon: [], unrecorded: items.slice(0, 1) }),
    },
    {
      name: "a wholly failed pass leaving every unit unrecorded",
      split: (items) => ({ answer: [], abandon: [], unrecorded: items }),
    },
  ]

  it.each(cases)("terminates every stage exactly once with $name", async ({ split }) => {
    const project = createProject({ "talk.md": transcript(20) })
    const events = await runOnePass(project, findWith(split))

    const terminals = events.filter((e) => e.status === "settled" || e.status === "failed")
    expect(terminals.map((e) => `${e.file} ${e.stage}`).sort()).toEqual([
      "talk.md classify",
      "talk.md embed",
      "talk.md regions",
    ])
  })
})

describe("what enters scanned", () => {
  // regions.md:13 — "an abandoned entry is simply not scanned, so the next tick offers
  // it again"; only explicit acknowledgment in an answered call records a unit.
  it("keeps an abandoned unit out of scanned and re-offers it next tick", async () => {
    const project = createProject({ "talk.md": transcript(20) })
    const offered: number[][] = []
    let abandonFirst = true
    const find: FindCall = async (items, job) => {
      offered.push(items.map((item) => item.unit.firstSentence))
      for (const item of items) {
        if (abandonFirst && item === items[0]) job.onAbandoned?.(item)
        else job.onAnswered(item, [])
      }
      return { unrecorded: [] }
    }

    const events: EngineEvent[] = []
    const handle = startSync(project, find, markOwnSentence, events)
    await handle.ready

    const abandonedFirstSentence = offered[0][0]
    const scanned = project.regionsIn("talk.md").scanned.speaker
    expect(offered[0].length).toBeGreaterThan(1)
    expect(scanned.map((unit) => unit.firstSentence)).not.toContain(abandonedFirstSentence)
    expect(scanned).toHaveLength(offered[0].length - 1)

    abandonFirst = false
    await handle.tick()
    handle.stop()

    expect(offered.at(-1)).toEqual([abandonedFirstSentence])
    const rescanned = project.regionsIn("talk.md").scanned.speaker
    expect(rescanned.map((unit) => unit.firstSentence)).toContain(abandonedFirstSentence)
  })

  // regions.md:13 + calling.md rounds step 5 — units the no-progress exit left
  // unrecorded were never acknowledged, so the pass must not write them into scanned.
  it("keeps units left by the no-progress exit out of scanned", async () => {
    const project = createProject({ "talk.md": transcript(20) })
    const offered: number[] = []
    const find: FindCall = async (items, job) => {
      offered.push(...items.map((item) => item.unit.firstSentence))
      for (const item of items.slice(1)) job.onAnswered(item, [])
      return { unrecorded: items.slice(0, 1) }
    }
    await runOnePass(project, find)

    const scanned = project.regionsIn("talk.md").scanned.speaker
    expect(offered.length).toBeGreaterThan(1)
    expect(scanned.map((unit) => unit.firstSentence)).not.toContain(offered[0])
    expect(scanned).toHaveLength(offered.length - 1)
  })

  // regions.md:25 — a hit whose mark was abandoned or left by the no-progress exit
  // "joins the unranged rows": durable, offered to the next pass, never silently lost.
  it("writes a mark-abandoned hit as an unranged row", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const markFailing: MarkCall = async (items, job) => {
      for (const item of items) job.onFailed(item)
    }
    await runOnePass(
      project,
      findWith((items) => ({ answer: items, abandon: [], unrecorded: [] })),
      markFailing
    )

    const block = project.regionsIn("talk.md")
    const unranged = block.regions.filter((row) => !isResolved(row))
    expect(block.regions.length).toBeGreaterThan(0)
    expect(unranged).toEqual(block.regions)
    expect(unranged.every((row) => row.quote === "Rutte")).toBe(true)
  })
})
