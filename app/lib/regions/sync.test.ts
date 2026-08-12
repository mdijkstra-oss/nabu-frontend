import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { patchBlockContent } from "~/lib/data-blocks/patch"
import { FileCorruptionError } from "~/lib/files/errors"
import { indexFileSentences } from "~/lib/text/halo"
import { stripMarkdown } from "~/lib/text/strip"
import { isResolved, type RegionRow, type RegionsBlock } from "~/domain/data-blocks/regions/schema"
import { sweepUnregisteredKinds } from "./boot-sweep"
import { hashSentences } from "./detect/units"
import type { FindInput, FindOutcome, Hit, MarkInput, MarkOutcome } from "./detect/types"
import type { KindDescriptor } from "./kinds/registry"
import { readStoredRegions } from "./stored"
import { startRegionSync, REGION_SYNC_DEBOUNCE, REGION_SYNC_MAX_WAIT } from "./sync"
import type { RegionSyncHandle, WriteOutcome } from "./sync-types"

const speakerKind: KindDescriptor = {
  id: "speaker",
  rules: "fixture rules: a speaker owns the words of their own turn",
  icon: "mic",
  color: "indigo",
  valueType: "string",
}

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
  { kind: "speaker", quote: "Rutte" },
  { kind: "speaker", quote: "Kaag" },
]

interface Range {
  start: number
  end: number
}

interface DetectConfig {
  patterns?: Pattern[]
  markRange?: (input: MarkInput) => Range | null
}

const settleMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const ownSentence = (input: MarkInput): Range => ({
  start: input.hitSentence,
  end: Math.min(input.hitSentence + 1, input.windowEnd),
})

const createDetect = (config: DetectConfig = {}) => {
  const patterns = config.patterns ?? SPEAKERS
  const rangeOf = config.markRange ?? ownSentence

  const finds: FindInput[] = []
  const marks: MarkInput[] = []
  const active = new Map<string, number>()
  const peak = new Map<string, number>()

  let coined = 0
  let gate: Promise<void> | null = null
  let open: (() => void) | null = null
  let failFind: ((input: FindInput) => string | null) | null = null

  const enter = (kind: string): void => {
    const now = (active.get(kind) ?? 0) + 1
    active.set(kind, now)
    peak.set(kind, Math.max(peak.get(kind) ?? 0, now))
  }

  const leave = (kind: string): void => {
    active.set(kind, (active.get(kind) ?? 1) - 1)
  }

  const valueFor = (quote: string, knownValues: string[]): string => {
    const slug = quote.toLowerCase()
    return knownValues.find((v) => v === slug || v.startsWith(`${slug}-`)) ?? `${slug}-${++coined}`
  }

  const hitsIn = (input: FindInput): Hit[] => {
    const known = [...input.knownValues]
    return input.sentences.flatMap((text, i) =>
      patterns
        .filter((p) => p.kind === input.kind && text.includes(p.quote))
        .map((p) => {
          const value = valueFor(p.quote, known)
          if (!known.includes(value)) known.push(value)
          return { kind: input.kind, quote: p.quote, hitSentence: input.firstSentence + i, value }
        })
    )
  }

  const find = async (input: FindInput): Promise<FindOutcome> => {
    finds.push({ ...input, knownValues: [...input.knownValues] })
    enter(input.kind)
    const held = gate
    await settleMicrotasks()
    if (held) await held
    leave(input.kind)

    const error = failFind?.(input)
    if (error) return { hits: [], errors: [error], dropped: 0 }
    return { hits: hitsIn(input), errors: [], dropped: 0 }
  }

  const mark = async (input: MarkInput): Promise<MarkOutcome> => {
    marks.push(input)
    const held = gate
    await settleMicrotasks()
    if (held) await held

    const range = rangeOf(input)
    if (!range) return { mark: null, error: `no range for "${input.quote}"` }
    return {
      mark: {
        kind: input.kind,
        quote: input.quote,
        value: input.value,
        hitSentence: input.hitSentence,
        startSentence: range.start,
        endSentence: range.end,
      },
    }
  }

  return {
    calls: { find, mark },
    finds,
    marks,
    peakConcurrency: (kind: string) => peak.get(kind) ?? 0,
    failFindWhen: (fn: (input: FindInput) => string | null) => {
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
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      writeRegions,
    },
  }
}

type Project = ReturnType<typeof createProject>

const startSync = (
  project: Project,
  detect: Detect,
  kinds: KindDescriptor[] = [speakerKind]
): RegionSyncHandle =>
  startRegionSync({ ...project.deps, getKinds: () => kinds, detect: detect.calls })

const turn = (i: number): string =>
  `${i % 2 === 0 ? "Rutte" : "Kaag"} spoke about item number ${i}. The room considered point ${i} at some length.`

const transcript = (turns: number): string =>
  Array.from({ length: turns }, (_, i) => turn(i)).join("\n\n")

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
  "| Speaker | Turn |",
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

const coveredSentences = (block: RegionsBlock): number[] =>
  block.regions
    .filter(isResolved)
    .flatMap((row) =>
      Array.from(
        { length: row.endSentence - row.startSentence + 1 },
        (_, i) => row.startSentence + i
      )
    )

let errors: string[] = []

beforeEach(() => {
  errors = []
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("relocation across an edit", () => {
  it("shifts every mark below an insertion and issues no mark call for them", async () => {
    const project = createProject({ "talk.md": transcript(30) })
    const trailing = (input: MarkInput): Range =>
      input.hitSentence === 0
        ? { start: 1, end: 1 }
        : { start: input.hitSentence, end: Math.min(input.hitSentence + 1, input.windowEnd) }
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
    expect(detect.marks.every((m) => m.sentences.length > 0)).toBe(true)
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
    expect(detect.marks.slice(marksBefore).map((m) => m.hitSentence)).toEqual([secondHit])
    expect(rangesOf(after)).toEqual(rangesOf(before))
  })
})

describe("the units a document becomes", () => {
  it("cuts one short paragraph into one unit and one find call", async () => {
    const project = createProject({ "short.md": ONE_PARAGRAPH })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    expect(detect.finds).toHaveLength(1)
    expect(detect.finds[0].sentences).toEqual(sentencesOf(ONE_PARAGRAPH))
    expect(project.regionsIn("short.md").scanned.speaker).toHaveLength(1)
  })
})

describe("a unit whose find call failed", () => {
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
    const scanned = project.regionsIn("talk.md").scanned.speaker
    expect(scanned.some((unit) => unit.firstSentence === firstUnit)).toBe(false)

    const findsBefore = detect.finds.length
    await sync.tick()

    expect(detect.finds.slice(findsBefore).map((f) => f.firstSentence)).toContain(firstUnit)
    const retried = project.regionsIn("talk.md").scanned.speaker
    expect(retried.some((unit) => unit.firstSentence === firstUnit)).toBe(true)
  })
})

describe("hit and unit invalidation", () => {
  it("re-finds only the unit whose text changed and keeps the others' hits and marks", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    const scannedBefore = before.scanned.speaker
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
    expect(after.scanned.speaker.map((u) => u.firstSentence)).toEqual(
      scannedBefore.map((u) => u.firstSentence)
    )
    expect(after.scanned.speaker[1].hash).not.toBe(scannedBefore[1].hash)
    expect(after.scanned.speaker[0].hash).toBe(scannedBefore[0].hash)
    expect(outsideChangedUnit(after)).toEqual(outsideChangedUnit(before))
    expect(
      detect.marks
        .slice(marksBefore)
        .every((m) => m.hitSentence >= changedUnit.first && m.hitSentence <= changedUnit.last)
    ).toBe(true)
  })

  it("keeps the units an edit did not touch out of find and shifts their hits with them", async () => {
    const project = createProject({ "talk.md": transcript(40) })
    const detect = createDetect()

    const sync = startSync(project, detect)
    await sync.ready

    const before = project.regionsIn("talk.md")
    const scannedBefore = before.scanned.speaker
    expect(scannedBefore.length).toBeGreaterThan(2)

    const findsBefore = detect.finds.length
    const marksBefore = detect.marks.length
    const inserted = sentencesOf(INSERTED_SENTENCE).length
    project.files["talk.md"] = `${INSERTED_SENTENCE}\n\n${project.files["talk.md"]}`

    await sync.tick()

    const after = project.regionsIn("talk.md")
    const storedHashes = new Set(scannedBefore.map((unit) => unit.hash))
    const survivors = after.scanned.speaker.filter((unit) => storedHashes.has(unit.hash))
    const survivingHashes = new Set(survivors.map((unit) => unit.hash))
    const refound = after.scanned.speaker.filter((unit) => !survivingHashes.has(unit.hash))
    const firstSurvivor = survivors[0].firstSentence

    expect(survivors.length).toBeGreaterThan(refound.length)
    expect(detect.finds.slice(findsBefore).map((f) => f.firstSentence)).toEqual(
      refound.map((unit) => unit.firstSentence)
    )
    expect(survivors).toEqual(
      scannedBefore
        .filter((unit) => survivingHashes.has(unit.hash))
        .map((unit) => ({ hash: unit.hash, firstSentence: unit.firstSentence + inserted }))
    )
    expect(rangesFrom(after, firstSurvivor)).toEqual(
      rangesFrom(before, firstSurvivor - inserted).map(([start, end, hit]) => [
        start + inserted,
        end + inserted,
        hit + inserted,
      ])
    )
    expect(valuesFrom(after, firstSurvivor)).toEqual(valuesFrom(before, firstSurvivor - inserted))
    expect(detect.marks.slice(marksBefore).every((m) => m.hitSentence < firstSurvivor)).toBe(true)
  })

  it("re-finds every unit and re-marks every hit when the stored block came from the previous recipe", async () => {
    const project = createProject({ "notes.md": markedTranscript(20) })
    const scratch = createDetect()

    const first = startSync(project, scratch)
    await first.ready
    first.stop()

    const fresh = project.regionsIn("notes.md")
    expect(fresh.scanned.speaker.length).toBeGreaterThan(1)
    expect(fresh.regions.filter(isResolved).length).toBeGreaterThan(1)

    project.deps.writeRegions(
      "notes.md",
      underPreviousRecipe(fresh, sentencesOf(project.files["notes.md"]), speakerKind.id)
    )

    const again = createDetect()
    const second = startSync(project, again)
    await second.ready

    expect(again.finds.map((f) => f.firstSentence)).toEqual(
      fresh.scanned.speaker.map((unit) => unit.firstSentence)
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

  it("hands overlap resolution the kept marks as well as the fresh ones", async () => {
    const project = createProject({ "talk.md": transcript(6) })
    const wide = (input: MarkInput): Range => ({
      start: input.hitSentence,
      end: Math.min(input.hitSentence + 3, input.windowEnd),
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

    const covered = coveredSentences(project.regionsIn("talk.md"))
    expect(new Set(covered).size).toBe(covered.length)
  })
})

describe("ordering and the shared vocabulary", () => {
  const twoKinds = [speakerKind, dateKind]

  const twoKindPatterns: Pattern[] = [
    ...SPEAKERS,
    { kind: "date", quote: "spoke" },
    { kind: "date", quote: "considered" },
  ]

  it("runs a list-backed kind serially and a self-contained kind concurrently", async () => {
    const project = createProject({
      "a.md": transcript(20),
      "b.md": transcript(20),
    })
    const detect = createDetect({ patterns: twoKindPatterns })

    const sync = startSync(project, detect, twoKinds)
    await sync.ready

    expect(detect.peakConcurrency("speaker")).toBe(1)
    expect(detect.peakConcurrency("date")).toBeGreaterThan(1)

    const speakerFinds = detect.finds.filter((f) => f.kind === "speaker")
    const dateFinds = detect.finds.filter((f) => f.kind === "date")

    expect(speakerFinds.slice(1).every((f) => f.knownValues.length > 0)).toBe(true)
    expect(dateFinds.every((f) => f.knownValues.length === 0)).toBe(true)
    expect(
      speakerFinds
        .flatMap((f) => f.knownValues)
        .every((v) => v.startsWith("rutte") || v.startsWith("kaag"))
    ).toBe(true)
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
    vi.advanceTimersByTime(REGION_SYNC_DEBOUNCE)

    expect(project.writes).toHaveLength(0)

    detect.release()
    await ready

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
    vi.advanceTimersByTime(REGION_SYNC_DEBOUNCE - 1)
    expect(project.writes).toHaveLength(writesAfterBoot)

    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(project.writes.length).toBeGreaterThan(writesAfterBoot))

    expect(REGION_SYNC_MAX_WAIT).toBeGreaterThan(REGION_SYNC_DEBOUNCE)
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

    const sync = startSync(project, detect, [speakerKind, dateKind])
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
    expect(block.scanned.speaker.length).toBeGreaterThan(0)

    const findsAfterBoot = detect.finds.length
    await sync.tick()
    expect(detect.finds).toHaveLength(findsAfterBoot)
  })

  it("makes no call and no write when only a kind's rules changed", async () => {
    const project = createProject({ "talk.md": transcript(6) })
    const detect = createDetect()

    const first = startSync(project, detect)
    await first.ready
    first.stop()

    const stored = project.files["talk.md"]
    const improved = { ...speakerKind, rules: `${speakerKind.rules}, restated more precisely` }
    const revised = createDetect()

    sweepUnregisteredKinds({
      getFiles: () => project.files,
      getKinds: () => [improved],
      writeRegions: project.deps.writeRegions,
    })

    const second = startSync(project, revised, [improved])
    await second.ready

    expect(revised.finds).toEqual([])
    expect(revised.marks).toEqual([])
    expect(project.files["talk.md"]).toBe(stored)
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
    vi.advanceTimersByTime(REGION_SYNC_DEBOUNCE)
    sync.stop()
    detect.release()
    await ready

    const findsAtStop = detect.finds.length
    vi.advanceTimersByTime(REGION_SYNC_MAX_WAIT)
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
      [speakerKind, dateKind]
    )
    await withDates.ready
    withDates.stop()

    const oneKind = createProject({ "one.md": transcript(6) })
    const speakersOnly = startSync(oneKind, createDetect(), [speakerKind])
    await speakersOnly.ready
    speakersOnly.stop()

    const project = createProject({
      "both.md": twoKinds.files["both.md"],
      "one.md": oneKind.files["one.md"],
    })
    expect(project.regionsIn("both.md").regions.some((row) => row.kind === "date")).toBe(true)

    sweepUnregisteredKinds({
      getFiles: () => project.files,
      getKinds: () => [speakerKind],
      writeRegions: project.deps.writeRegions,
    })

    const swept = project.regionsIn("both.md")
    expect(swept.regions.every((row) => row.kind === "speaker")).toBe(true)
    expect(Object.keys(swept.scanned)).toEqual(["speaker"])
    expect(project.writes.map((w) => w.path)).toEqual(["both.md"])
  })
})
