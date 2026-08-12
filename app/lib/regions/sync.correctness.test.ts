// Adversarial pins for the sync around batched detection: every terminal state
// reports processed == total (regions.md:16), and a unit that was not explicitly
// acknowledged — abandoned or left by the no-progress exit — never enters `scanned`
// (regions.md:13). Mark abandonment lands durably as an unranged row (regions.md:25).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { isResolved, type RegionsBlock } from "~/domain/data-blocks/regions/schema"
import type { FindCall, FindWork, MarkCall } from "./detect/types"
import type { KindDescriptor } from "./kinds/registry"
import { readStoredRegions } from "./stored"
import { startRegionSync } from "./sync"
import type { WriteOutcome } from "./sync-types"

const speakerKind: KindDescriptor = {
  id: "speaker",
  rules: "fixture rules: a speaker owns the words of their own turn",
  icon: "mic",
  color: "indigo",
  valueType: "string",
}

const transcript = (turns: number): string =>
  Array.from(
    { length: turns },
    (_, i) =>
      `${i % 2 === 0 ? "Rutte" : "Kaag"} spoke about item number ${i}. The room considered point ${i} at some length.`
  ).join("\n\n")

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

interface Progress {
  processed: number
  total: number
}

const runOnePass = async (
  project: ReturnType<typeof createProject>,
  find: FindCall,
  mark: MarkCall = markOwnSentence
): Promise<Progress[]> => {
  const progress: Progress[] = []
  const handle = startRegionSync({
    ...project.deps,
    detect: { find, mark },
    onProgress: (processed, total) => progress.push({ processed, total }),
  })
  await handle.ready
  handle.stop()
  return progress
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("progress at every terminal state", () => {
  // regions.md:16 — processed counts units that left the pending list, acknowledged or
  // abandoned, "and on the no-progress exit the pending remainder counts too, so every
  // terminal state reports complete".
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

  it.each(cases)("reports processed == total with $name", async ({ split }) => {
    const project = createProject({ "talk.md": transcript(20) })
    const progress = await runOnePass(project, findWith(split))

    const last = progress.at(-1)
    expect(last).toBeDefined()
    expect(last?.total).toBeGreaterThan(0)
    expect(last?.processed).toBe(last?.total)
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

    const handle = startRegionSync({
      ...project.deps,
      detect: { find, mark: markOwnSentence },
    })
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
  // unrecorded were never acknowledged, so the sync must not write them into scanned.
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
