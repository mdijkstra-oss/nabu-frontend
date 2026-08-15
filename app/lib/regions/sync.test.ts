import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { FileCorruptionError } from "~/lib/files/errors"
import { ok } from "~/lib/fp/result"
import { zeroVector } from "~/lib/embeddings/embedding.fixtures"
import { startEngine, ENGINE_DEBOUNCE, ENGINE_MAX_WAIT } from "~/lib/engine/engine"
import type { EngineHandle } from "~/lib/engine/types"
import { indexFileSentences } from "~/lib/text/halo"
import { stripMarkdown } from "~/lib/text/strip"
import { isResolved, type RegionRow, type RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { sweepUnregisteredKinds } from "./boot-sweep"
import { hashSentences } from "./detect/units"
import type { FindCall, FindWork, Hit, MarkCall, MarkWork } from "./detect/types"
import type { KindDescriptor } from "./kinds/registry"
import { personKind, transcript } from "./person.fixtures"
import { readStoredRegions } from "./stored"
import type { WriteOutcome } from "./sync-types"

const dateKind: KindDescriptor = {
  id: "date",
  rules: "fixture rules: a date owns the entry it opens",
  icon: "calendar-days",
  color: "amber",
  valueType: "datetime",
}

interface Pattern {
  kind: string
  quote: string
}

const SPEAKERS: Pattern[] = [
  { kind: "person", quote: "Rutte" },
  { kind: "person", quote: "Kaag" },
]

interface Range {
  start: number
  end: number
}

interface DetectConfig {
  patterns?: Pattern[]
  markRange?: (work: MarkWork) => Range | null
}

const settleMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const ownSentence = (work: MarkWork): Range => ({
  start: work.hit.hitSentence,
  end: Math.min(work.hit.hitSentence + 1, work.window.end),
})

interface OfferedUnit {
  kind: string
  file: string
  firstSentence: number
  sentences: string[]
}

interface RecordedFindCall {
  kind: string
  knownValues: string[]
  files: string[]
}

const createDetect = (config: DetectConfig = {}) => {
  const patterns = config.patterns ?? SPEAKERS
  const rangeOf = config.markRange ?? ownSentence

  const finds: OfferedUnit[] = []
  const findCalls: RecordedFindCall[] = []
  const marks: MarkWork[] = []

  let coined = 0
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  let failFind: ((item: FindWork) => string | null) | null = null

  const valueFor = (quote: string, known: Set<string>): string => {
    const slug = quote.toLowerCase()
    return [...known].find((v) => v === slug || v.startsWith(`${slug}-`)) ?? `${slug}-${++coined}`
  }

  const hitsIn = (item: FindWork, kind: string, known: Set<string>): Hit[] =>
    item.sentences.flatMap((text, i) =>
      patterns
        .filter((p) => p.kind === kind && text.includes(p.quote))
        .map((p) => {
          const value = valueFor(p.quote, known)
          known.add(value)
          return { kind, quote: p.quote, hitSentence: item.unit.firstSentence + i, value }
        })
    )

  const find: FindCall = async (items, job) => {
    findCalls.push({
      kind: job.kind.id,
      knownValues: [...job.knownValues].sort(),
      files: [...new Set(items.map((item) => item.file))],
    })
    finds.push(
      ...items.map((item) => ({
        kind: job.kind.id,
        file: item.file,
        firstSentence: item.unit.firstSentence,
        sentences: item.sentences,
      }))
    )

    const held = gate
    await settleMicrotasks()
    if (held) await held

    const unrecorded: FindWork[] = []
    for (const item of items) {
      if (failFind?.(item)) {
        unrecorded.push(item)
        continue
      }
      job.onAnswered(item, hitsIn(item, job.kind.id, job.knownValues))
    }
    return { unrecorded }
  }

  const mark: MarkCall = async (items, job) => {
    marks.push(...items)

    const held = gate
    await settleMicrotasks()
    if (held) await held

    for (const item of items) {
      const range = rangeOf(item)
      if (!range) {
        job.onFailed(item)
        continue
      }
      job.onAnswered(item, { ...item.hit, startSentence: range.start, endSentence: range.end })
    }
  }

  return {
    calls: { find, mark },
    finds,
    findCalls,
    marks,
    failFindWhen: (fn: (item: FindWork) => string | null) => {
      failFind = fn
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve
      })
    },
    release: () => {
      gate = null
      open?.()
    },
  }
}

type Detect = ReturnType<typeof createDetect>

const REGION_OPS = (block: RegionsBlock) => [
  { op: "add" as const, path: "/regions", value: block.regions },
  { op: "add" as const, path: "/scanned", value: block.scanned },
]

const createProject = (initial: Record<string, string>) => {
  const files: Record<string, string> = { ...initial }
  const listeners = new Set<() => void>()
  const writes: { path: string; block: RegionsBlock }[] = []

  let forced: ((path: string) => WriteOutcome | "throw" | null) | null = null

  const writeRegions = (path: string, next: RegionsBlock): WriteOutcome => {
    writes.push({ path, block: next })

    const outcome = forced?.(path)
    if (outcome === "throw") throw new FileCorruptionError(path, [])
    if (outcome) return outcome

    const result = patchBlockContent(files[path] ?? "", "json-regions", REGION_OPS(next))
    if (!result.ok) return result.error === "No changes" ? "unchanged" : "failed"

    files[path] = result.content
    return "written"
  }

  return {
    files,
    writes,
    forceOutcome: (fn: ((path: string) => WriteOutcome | "throw" | null) | null) => {
      forced = fn
    },
    notify: () => listeners.forEach((listener) => listener()),
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
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      writeRegions,
    },
  }
}

type Project = ReturnType<typeof createProject>

let engines: EngineHandle[] = []

const startSync = (
  project: Project,
  detect: Detect,
  kinds: KindDescriptor[] = [personKind]
): EngineHandle => {
  const engine = startEngine({
    ...project.deps,
    embeddingsUrl: "http://embeddings.test",
    fetchBatch: (texts) => Promise.resolve(ok(texts.map(() => zeroVector()))),
    classify: () => Promise.resolve(null),
    getKinds: () => kinds,
    detect: detect.calls,
    getSignificantLanguages: () => Promise.resolve([]),
    syncDescriptions: () => Promise.resolve(),
    onEvent: () => undefined,
  })
  engines.push(engine)
  return engine
}

const markedTurn = (i: number): string =>
  `- **${i % 2 === 0 ? "Rutte" : "Kaag"}** spoke about [item ${i}](https://example.org/item/${i}). The room considered point ${i} at some length.`

const markedTranscript = (turns: number): string =>
  Array.from({ length: turns }, (_, i) => markedTurn(i)).join("\n\n")

const MARKDOWN_NOTES = [
  "# Session notes",
  "",
  "- Rutte opened the meeting today. He welcomed the committee warmly.",
  "- **Kaag** replied at length. She asked for the numbers again.",
  "",
  "See [the agenda](https://example.org/agenda) for the order of business.",
  "",
  "| Person | Turn |",
  "| --- | --- |",
  "| Rutte | 1 |",
  "",
  "Rutte closed the session. Everyone filed out quietly.",
].join("\n")

const FENCED_CODE_LINE = "const total = 1;"

const DOCUMENT_WITH_CODE = [
  "Rutte opened the meeting today. He welcomed the committee warmly.",
  "",
  "```js",
  FENCED_CODE_LINE,
  "```",
  "",
  "Kaag replied at length. She asked for the numbers again.",
].join("\n")

const ONE_PARAGRAPH = "Rutte opened the meeting. He welcomed the committee warmly."

const INSERTED_SENTENCE = "A new opening line."

const sentencesOf = (raw: string): string[] => indexFileSentences(raw).map((row) => row.text)

const rangesOf = (block: RegionsBlock): [number, number, number][] =>
  block.regions
    .filter(isResolved)
    .map((row) => [row.startSentence, row.endSentence, row.hitSentence])

const rangesFrom = (block: RegionsBlock, first: number): [number, number, number][] =>
  rangesOf(block).filter(([, , hit]) => hit >= first)

const valuesFrom = (block: RegionsBlock, first: number): string[] =>
  block.regions.filter((row) => row.hitSentence >= first).map((row) => row.parsed.value)

const underPreviousRecipe = (
  block: RegionsBlock,
  sentences: string[],
  kindId: string
): RegionsBlock => {
  const stripped = sentences.map((text) => stripMarkdown(text))
  const units = block.scanned[kindId]
  const lastSentenceOf = (index: number): number =>
    (units[index + 1]?.firstSentence ?? sentences.length) - 1

  return {
    regions: block.regions.map((row) =>
      isResolved(row)
        ? {
            ...row,
            rangeHash: hashSentences(stripped.slice(row.startSentence, row.endSentence + 1)),
          }
        : row
    ),
    scanned: {
      [kindId]: units.map((unit, index) => ({
        hash: hashSentences(stripped.slice(unit.firstSentence, lastSentenceOf(index) + 1)),
        firstSentence: unit.firstSentence,
      })),
    },
  }
}

let errors: string[] = []

beforeEach(() => {
  errors = []
  engines = []
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  for (const engine of engines) engine.stop()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("relocation across an edit", () => {
  it("shifts every mark below an insertion and issues no mark call for them", async () => {
    const project = createProject({ "talk.md": transcript(30) })
    const trailing = (work: MarkWork): Range =>
      work.hit.hitSentence === 0
        ? { start: 1, end: 1 }
        : {
            start: work.hit.hitSentence,
            end: Math.min(work.hit.hitSentence + 1, work.window.end),
          }
    const detect = createDetect({ markRange: trailing })

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    expect(before.regions.length).toBeGreaterThan(10)

    const marksBefore = detect.marks.length
    project.files["talk.md"] =
      `A new opening line. A second new line.\n\n${project.files["talk.md"]}`

    await sync.tick()

    const after = project.regionsIn("talk.md")
    expect(detect.marks).toHaveLength(marksBefore)
    expect(detect.finds.length).toBeGreaterThan(1)
    expect(rangesOf(after)).toEqual(
      rangesOf(before).map(([start, end, hit]) => [start + 2, end + 2, hit + 2])
    )
    expect(after.regions.map((row) => row.parsed.value)).toEqual(
      before.regions.map((row) => row.parsed.value)
    )
  })

  it("keeps every mark of a markdown-heavy document across a second pass", async () => {
    const project = createProject({ "notes.md": MARKDOWN_NOTES })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const first = project.regionsIn("notes.md")
    const findsAfterFirst = detect.finds.length

    await sync.tick()

    expect(project.regionsIn("notes.md")).toEqual(first)
    expect(detect.finds).toHaveLength(findsAfterFirst)
    expect(
      detect.marks.every((m) => m.window.start >= 0 && m.window.end < m.sentences.length)
    ).toBe(true)
  })

  it("deletes only the mark whose range content changed and re-marks its hit", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    const marksBefore = detect.marks.length
    const sentences = sentencesOf(project.files["talk.md"])
    const secondHit = before.regions[1].hitSentence

    project.files["talk.md"] = project.files["talk.md"].replace(
      sentences[secondHit],
      sentences[secondHit].replace("spoke about", "spoke at length about")
    )

    await sync.tick()

    const after = project.regionsIn("talk.md")
    expect(detect.marks.slice(marksBefore).map((m) => m.hit.hitSentence)).toEqual([secondHit])
    expect(rangesOf(after)).toEqual(rangesOf(before))
  })
})

describe("the units a document becomes", () => {
  it("cuts one short paragraph into one unit and one offered find entry", async () => {
    const project = createProject({ "short.md": ONE_PARAGRAPH })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    expect(detect.finds).toHaveLength(1)
    expect(detect.finds[0].sentences).toEqual(sentencesOf(ONE_PARAGRAPH))
    expect(project.regionsIn("short.md").scanned.person).toHaveLength(1)
  })
})

describe("a unit whose answer was lost", () => {
  it("stays out of the scanned record and is retried on the next tick", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()
    let failed = false
    detect.failFindWhen(() => {
      if (failed) return null
      failed = true
      return "boom"
    })

    const sync = startSync(project, detect)
    await sync.ready

    const firstUnit = 0
    const scanned = project.regionsIn("talk.md").scanned.person
    expect(scanned.some((unit) => unit.firstSentence === firstUnit)).toBe(false)

    const findsBefore = detect.finds.length
    await sync.tick()

    expect(detect.finds.slice(findsBefore).map((f) => f.firstSentence)).toContain(firstUnit)
    const retried = project.regionsIn("talk.md").scanned.person
    expect(retried.some((unit) => unit.firstSentence === firstUnit)).toBe(true)
  })

  it("records none of the units when the whole pass answers nothing, then re-offers all", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()
    let firstPass = true
    detect.failFindWhen(() => (firstPass ? "boom" : null))

    const sync = startSync(project, detect)
    await sync.ready

    expect(project.regionsIn("talk.md").scanned.person).toEqual([])
    expect(project.regionsIn("talk.md").regions).toEqual([])

    const offeredFirstPass = detect.finds.length
    expect(offeredFirstPass).toBeGreaterThan(3)

    firstPass = false
    await sync.tick()

    expect(detect.finds.slice(offeredFirstPass).map((f) => f.firstSentence)).toEqual(
      detect.finds.slice(0, offeredFirstPass).map((f) => f.firstSentence)
    )
    expect(project.regionsIn("talk.md").scanned.person).toHaveLength(offeredFirstPass)
  })
})

describe("hit and unit invalidation", () => {
  it("re-finds only the unit whose text changed and keeps the others' hits and marks", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    const scannedBefore = before.scanned.person
    expect(scannedBefore.length).toBeGreaterThan(3)

    const findsBefore = detect.finds.length
    const marksBefore = detect.marks.length
    const sentences = sentencesOf(project.files["talk.md"])
    const inSecondUnit = sentences[scannedBefore[1].firstSentence + 1]

    project.files["talk.md"] = project.files["talk.md"].replace(
      inSecondUnit,
      inSecondUnit.replace("considered", "weighed")
    )

    await sync.tick()

    const after = project.regionsIn("talk.md")
    const fresh = detect.finds.slice(findsBefore)
    const changedUnit = {
      first: scannedBefore[1].firstSentence,
      last: scannedBefore[2].firstSentence - 1,
    }
    const outsideChangedUnit = (block: RegionsBlock): RegionRow[] =>
      block.regions.filter(
        (row) => row.hitSentence < changedUnit.first || row.hitSentence > changedUnit.last
      )

    expect(fresh.map((f) => f.firstSentence)).toEqual([changedUnit.first])
    expect(after.scanned.person.map((u) => u.firstSentence)).toEqual(
      scannedBefore.map((u) => u.firstSentence)
    )
    expect(after.scanned.person[1].hash).not.toBe(scannedBefore[1].hash)
    expect(after.scanned.person[0].hash).toBe(scannedBefore[0].hash)
    expect(outsideChangedUnit(after)).toEqual(outsideChangedUnit(before))
    expect(
      detect.marks
        .slice(marksBefore)
        .every(
          (m) => m.hit.hitSentence >= changedUnit.first && m.hit.hitSentence <= changedUnit.last
        )
    ).toBe(true)
  })

  it("keeps the units an edit did not touch out of find and shifts their hits with them", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    const scannedBefore = before.scanned.person
    expect(scannedBefore.length).toBeGreaterThan(2)

    const findsBefore = detect.finds.length
    const marksBefore = detect.marks.length
    const inserted = sentencesOf(INSERTED_SENTENCE).length
    project.files["talk.md"] = `${INSERTED_SENTENCE}\n\n${project.files["talk.md"]}`

    await sync.tick()

    const after = project.regionsIn("talk.md")
    const storedHashes = new Set(scannedBefore.map((unit) => unit.hash))
    const survivors = after.scanned.person.filter((unit) => storedHashes.has(unit.hash))
    const survivingHashes = new Set(survivors.map((unit) => unit.hash))
    const refound = after.scanned.person.filter((unit) => !survivingHashes.has(unit.hash))
    const firstSurvivor = survivors[0].firstSentence

    expect(survivors.length).toBeGreaterThan(refound.length)
    expect(detect.finds.slice(findsBefore).map((f) => f.firstSentence)).toEqual(
      refound.map((unit) => unit.firstSentence)
    )
    expect(survivors).toEqual(
      scannedBefore
        .filter((unit) => survivingHashes.has(unit.hash))
        .map((unit) => ({
          hash: unit.hash,
          firstSentence: unit.firstSentence + inserted,
          rules: unit.rules,
        }))
    )
    expect(rangesFrom(after, firstSurvivor)).toEqual(
      rangesFrom(before, firstSurvivor - inserted).map(([start, end, hit]) => [
        start + inserted,
        end + inserted,
        hit + inserted,
      ])
    )
    expect(valuesFrom(after, firstSurvivor)).toEqual(valuesFrom(before, firstSurvivor - inserted))
    expect(detect.marks.slice(marksBefore).every((m) => m.hit.hitSentence < firstSurvivor)).toBe(
      true
    )
  })

  it("re-finds every unit and re-marks every hit when the stored block came from the previous recipe", async () => {
    const project = createProject({ "notes.md": markedTranscript(20) })
    const scratch = createDetect()

    const first = startSync(project, scratch)
    await first.ready
    first.stop()

    const fresh = project.regionsIn("notes.md")
    expect(fresh.scanned.person.length).toBeGreaterThan(1)
    expect(fresh.regions.filter(isResolved).length).toBeGreaterThan(1)

    project.deps.writeRegions(
      "notes.md",
      underPreviousRecipe(fresh, sentencesOf(project.files["notes.md"]), personKind.id)
    )

    const again = createDetect()
    const second = startSync(project, again)
    await second.ready

    expect(again.finds.map((f) => f.firstSentence)).toEqual(
      fresh.scanned.person.map((unit) => unit.firstSentence)
    )
    expect(again.marks).toHaveLength(scratch.marks.length)
    expect(project.regionsIn("notes.md")).toEqual(fresh)
  })

  it("re-finds nothing and moves no index when a fenced code block is edited", async () => {
    const project = createProject({ "code.md": DOCUMENT_WITH_CODE })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("code.md")
    expect(before.regions.length).toBeGreaterThan(0)

    const findsBefore = detect.finds.length
    const marksBefore = detect.marks.length
    project.files["code.md"] = project.files["code.md"].replace(
      FENCED_CODE_LINE,
      "const runningTotal = compute(1, 2, 3); // a far longer line. And a second one."
    )

    await sync.tick()

    expect(detect.finds).toHaveLength(findsBefore)
    expect(detect.marks).toHaveLength(marksBefore)
    expect(project.regionsIn("code.md")).toEqual(before)
  })

  it("packs only unscanned units when one document among several changed", async () => {
    const project = createProject({ "a.md": transcript(20), "b.md": transcript(20) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const scannedA = project.regionsIn("a.md").scanned.person
    const scannedB = project.regionsIn("b.md").scanned.person
    expect(scannedA.length).toBeGreaterThan(1)

    const findsBefore = detect.finds.length
    const sentences = sentencesOf(project.files["a.md"])
    const inFirstUnit = sentences[scannedA[0].firstSentence]
    project.files["a.md"] = project.files["a.md"].replace(
      inFirstUnit,
      inFirstUnit.replace("spoke about", "spoke firmly about")
    )

    await sync.tick()

    const offered = detect.finds.slice(findsBefore)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((f) => f.file === "a.md")).toBe(true)
    expect(offered.length).toBeLessThan(scannedA.length)
    expect(project.regionsIn("b.md").scanned.person).toEqual(scannedB)
  })

  it("hands dedupe the kept marks as well as the fresh ones", async () => {
    const project = createProject({ "talk.md": transcript(6) })
    const wide = (work: MarkWork): Range => ({
      start: work.hit.hitSentence,
      end: Math.min(work.hit.hitSentence + 3, work.window.end),
    })
    const detect = createDetect({ markRange: wide })

    const sync = startSync(project, detect)
    await sync.ready

    const sentences = sentencesOf(project.files["talk.md"])
    const first = project.regionsIn("talk.md").regions[0]
    project.files["talk.md"] = project.files["talk.md"].replace(
      sentences[first.hitSentence],
      sentences[first.hitSentence].replace("spoke about", "spoke firmly about")
    )

    await sync.tick()

    const rows = project.regionsIn("talk.md").regions
    const identities = rows.map((row) =>
      [row.kind, row.parsed.value, row.startSentence, row.endSentence, row.hitSentence].join(" ")
    )
    expect(rows.length).toBeGreaterThan(1)
    expect(new Set(identities).size).toBe(identities.length)
  })
})

describe("the seam and the shared vocabulary", () => {
  const twoKinds = [personKind, dateKind]

  const twoKindPatterns: Pattern[] = [
    ...SPEAKERS,
    { kind: "date", quote: "spoke" },
    { kind: "date", quote: "considered" },
  ]

  it("offers each kind every document's units, starting from an empty vocabulary", async () => {
    const project = createProject({
      "a.md": transcript(20),
      "b.md": transcript(20),
    })
    const detect = createDetect({ patterns: twoKindPatterns })

    const sync = startSync(project, detect, twoKinds)
    await sync.ready

    expect(detect.findCalls.map((c) => c.kind).sort()).toEqual(["date", "date", "person", "person"])
    for (const kind of ["date", "person"]) {
      const calls = detect.findCalls.filter((c) => c.kind === kind)
      expect(calls.flatMap((c) => c.files).sort()).toEqual(["a.md", "b.md"])
      expect(calls[0].knownValues).toEqual([])
    }
  })

  it("creates one value per name across every unit of every document", async () => {
    const project = createProject({
      "a.md": transcript(30),
      "b.md": transcript(30),
    })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const values = new Set(
      [...project.regionsIn("a.md").regions, ...project.regionsIn("b.md").regions].map(
        (row) => row.parsed.value
      )
    )
    expect([...values].sort()).toEqual(["kaag-2", "rutte-1"])
  })

  it("seeds a later pass's vocabulary from every stored value corpus-wide", async () => {
    const project = createProject({
      "a.md": transcript(10),
      "b.md": transcript(10),
    })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const callsBefore = detect.findCalls.length
    project.files["a.md"] =
      `${project.files["a.md"]}\n\nRutte added a closing remark. The room emptied slowly after that.`

    await sync.tick()

    const later = detect.findCalls.slice(callsBefore)
    expect(later.map((c) => c.kind)).toEqual(["person"])
    expect(later[0].knownValues).toEqual(["kaag-2", "rutte-1"])
  })
})

describe("triggering", () => {
  it("runs one further pass for the fires absorbed by a pass in flight", async () => {
    vi.useFakeTimers()
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    detect.hold()
    const sync = startSync(project, detect)
    const ready = sync.ready

    await Promise.resolve()
    project.notify()
    project.notify()
    vi.advanceTimersByTime(ENGINE_DEBOUNCE)

    expect(project.writes).toHaveLength(0)

    detect.release()
    await ready
    await vi.waitFor(() => expect(project.writes).toHaveLength(2))

    expect(project.writes.map((w) => w.path)).toEqual(["talk.md", "talk.md"])
    expect(project.writes[1].block.regions).toEqual(project.regionsIn("talk.md").regions)
  })

  it("runs no further pass when nothing fired during the pass", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    expect(project.writes).toHaveLength(1)
  })

  it("fires a pass once the debounce elapses and again at the max wait", async () => {
    vi.useFakeTimers()
    const project = createProject({ "talk.md": transcript(2) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready
    const writesAfterBoot = project.writes.length

    project.files["talk.md"] =
      `${project.files["talk.md"]}\n\nRutte added a closing remark. The room emptied.`
    project.notify()
    vi.advanceTimersByTime(ENGINE_DEBOUNCE - 1)
    expect(project.writes).toHaveLength(writesAfterBoot)

    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(project.writes.length).toBeGreaterThan(writesAfterBoot))

    expect(ENGINE_MAX_WAIT).toBeGreaterThan(ENGINE_DEBOUNCE)
  })
})

describe("write failures", () => {
  it("logs a throwing write, keeps going, retries next tick and quarantines after three", async () => {
    const project = createProject({ "bad.md": transcript(4), "good.md": transcript(4) })
    const detect = createDetect()

    project.forceOutcome((path) => (path === "bad.md" ? "throw" : null))

    const sync = startSync(project, detect)
    await sync.ready

    expect(errors.some((e) => e.includes("bad.md"))).toBe(true)
    expect(project.regionsIn("good.md").regions.length).toBeGreaterThan(0)

    await sync.tick()
    await sync.tick()

    const attempts = project.writes.filter((w) => w.path === "bad.md").length
    expect(attempts).toBe(3)
    expect(errors.filter((e) => e.includes("consecutive write failures"))).toHaveLength(1)

    await sync.tick()
    expect(project.writes.filter((w) => w.path === "bad.md")).toHaveLength(3)

    project.files["bad.md"] =
      `${project.files["bad.md"]}\n\nRutte returned to the point. The room listened.`
    project.forceOutcome(null)
    await sync.tick()

    expect(project.writes.filter((w) => w.path === "bad.md")).toHaveLength(4)
    expect(project.regionsIn("bad.md").regions.length).toBeGreaterThan(0)
  })

  it("treats a patch that did not apply exactly as a throw", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    project.forceOutcome(() => "failed")

    const sync = startSync(project, detect)
    await sync.ready
    await sync.tick()

    expect(project.writes).toHaveLength(2)
    expect(errors.some((e) => e.includes("talk.md"))).toBe(true)
    expect(project.regionsIn("talk.md").regions).toEqual([])
  })

  it("quarantines a document after three consecutive 'failed' outcomes, same as a throw", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    project.forceOutcome(() => "failed")

    const sync = startSync(project, detect)
    await sync.ready
    await sync.tick()
    await sync.tick()

    const attempts = project.writes.filter((w) => w.path === "talk.md").length
    expect(attempts).toBe(3)
    expect(errors.filter((e) => e.includes("consecutive write failures"))).toHaveLength(1)

    await sync.tick()
    expect(project.writes.filter((w) => w.path === "talk.md")).toHaveLength(3)
  })

  it("never quarantines a document whose block is byte-identical to the stored one", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready
    await sync.tick()
    await sync.tick()
    await sync.tick()
    await sync.tick()

    const stored = project.regionsIn("talk.md")
    expect(stored.regions.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
})

describe("the document changing under the pass", () => {
  it("writes nothing for a document deleted mid-pass", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    detect.hold()
    const sync = startSync(project, detect)
    const ready = sync.ready
    await Promise.resolve()

    delete project.files["talk.md"]
    detect.release()
    await ready

    expect(project.writes).toHaveLength(0)
    expect(project.files["talk.md"]).toBeUndefined()
  })

  it("reconciles derived marks against the current sentences and stays dirty", async () => {
    const project = createProject({ "talk.md": transcript(6) })
    const detect = createDetect()

    detect.hold()
    const sync = startSync(project, detect)
    const ready = sync.ready
    await Promise.resolve()

    project.files["talk.md"] = `An inserted opening line.\n\n${project.files["talk.md"]}`
    detect.release()
    await ready

    const written = project.writes[0].block
    const sentences = sentencesOf(project.files["talk.md"])
    for (const row of written.regions) {
      if (row.startSentence === undefined) continue
      expect(sentences[row.startSentence]).toContain(row.quote)
    }

    const writesBefore = project.writes.length
    await sync.tick()
    expect(project.writes.length).toBeGreaterThan(writesBefore)
  })

  it("keeps the previous regions on disk while a re-find is in flight", async () => {
    const project = createProject({ "talk.md": transcript(4) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready
    const before = project.regionsIn("talk.md")

    project.files["talk.md"] = project.files["talk.md"].replace("Rutte spoke", "Rutte firmly spoke")
    detect.hold()
    const pass = sync.tick()
    await Promise.resolve()

    expect(project.regionsIn("talk.md").regions).toEqual(before.regions)

    detect.release()
    await pass
  })
})

describe("idle passes and empty documents", () => {
  it("terminates the self-write loop after one idle pass over two kinds", async () => {
    const project = createProject({ "talk.md": transcript(8) })
    const detect = createDetect({
      patterns: [...SPEAKERS, { kind: "date", quote: "considered" }],
    })

    const sync = startSync(project, detect, [personKind, dateKind])
    await sync.ready

    const findsAfterBoot = detect.finds.length
    const marksAfterBoot = detect.marks.length
    const writesAfterBoot = project.writes.length
    const stored = project.files["talk.md"]

    await sync.tick()

    expect(detect.finds).toHaveLength(findsAfterBoot)
    expect(detect.marks).toHaveLength(marksAfterBoot)
    expect(project.writes).toHaveLength(writesAfterBoot + 1)
    expect(project.files["talk.md"]).toBe(stored)

    await sync.tick()
    expect(project.writes).toHaveLength(writesAfterBoot + 1)
  })

  it("writes a block for a document where no kind finds anything", async () => {
    const project = createProject({ "quiet.md": "Nothing happened here. The room stayed empty." })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const block = project.regionsIn("quiet.md")
    expect(block.regions).toEqual([])
    expect(block.scanned.person.length).toBeGreaterThan(0)

    const findsAfterBoot = detect.finds.length
    await sync.tick()
    expect(detect.finds).toHaveLength(findsAfterBoot)
  })

  it("re-finds every unit when only a kind's rules changed", async () => {
    const project = createProject({ "talk.md": transcript(6) })
    const detect = createDetect()

    const first = startSync(project, detect)
    await first.ready
    first.stop()

    const scannedBefore = project.regionsIn("talk.md").scanned.person
    const improved = { ...personKind, rules: `${personKind.rules}, restated more precisely` }
    const revised = createDetect()

    sweepUnregisteredKinds({
      getFiles: () => project.files,
      getKinds: () => [improved],
      writeRegions: project.deps.writeRegions,
    })

    const second = startSync(project, revised, [improved])
    await second.ready

    expect(revised.finds.map((f) => f.firstSentence)).toEqual(
      scannedBefore.map((unit) => unit.firstSentence)
    )
    const scannedAfter = project.regionsIn("talk.md").scanned.person
    expect(scannedAfter.map((unit) => unit.rules)).not.toContain(scannedBefore[0].rules)
  })
})

describe("stop", () => {
  it("discards the in-flight result, writes nothing and starts no absorbed rerun", async () => {
    vi.useFakeTimers()
    const project = createProject({ "talk.md": transcript(6) })
    const detect = createDetect()

    detect.hold()
    const sync = startSync(project, detect)
    const ready = sync.ready
    await Promise.resolve()

    project.notify()
    vi.advanceTimersByTime(ENGINE_DEBOUNCE)
    sync.stop()
    detect.release()
    await ready

    const findsAtStop = detect.finds.length
    vi.advanceTimersByTime(ENGINE_MAX_WAIT)
    await Promise.resolve()

    expect(project.writes).toHaveLength(0)
    expect(detect.finds).toHaveLength(findsAtStop)
  })
})

describe("the boot sweep", () => {
  it("strips an unregistered kind from the documents that carry it and leaves the rest", async () => {
    const twoKinds = createProject({ "both.md": transcript(6) })
    const withDates = startSync(
      twoKinds,
      createDetect({ patterns: [...SPEAKERS, { kind: "date", quote: "considered" }] }),
      [personKind, dateKind]
    )
    await withDates.ready
    withDates.stop()

    const oneKind = createProject({ "one.md": transcript(6) })
    const peopleOnly = startSync(oneKind, createDetect(), [personKind])
    await peopleOnly.ready
    peopleOnly.stop()

    const project = createProject({
      "both.md": twoKinds.files["both.md"],
      "one.md": oneKind.files["one.md"],
    })
    expect(project.regionsIn("both.md").regions.some((row) => row.kind === "date")).toBe(true)

    sweepUnregisteredKinds({
      getFiles: () => project.files,
      getKinds: () => [personKind],
      writeRegions: project.deps.writeRegions,
    })

    const swept = project.regionsIn("both.md")
    expect(swept.regions.every((row) => row.kind === "person")).toBe(true)
    expect(Object.keys(swept.scanned)).toEqual(["person"])
    expect(project.writes.map((w) => w.path)).toEqual(["both.md"])
  })
})
