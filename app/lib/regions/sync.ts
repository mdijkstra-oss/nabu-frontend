import { isEmbeddableFile } from "~/lib/embeddings/filter"
import type { FileStore } from "~/lib/files/store"
import { indexFileSentences, indexProseSentences, proseOf } from "~/lib/text/halo"
import { debounce } from "~/lib/utils/debounce"
import { createKeyedQueue } from "~/lib/utils/keyed-queue"
import { noop } from "~/lib/utils/noop"
import { processPool } from "~/lib/utils/pool"
import { canonicalizeRegionsBlock } from "~/domain/data-blocks/regions/canonical"
import {
  isResolved,
  type RegionRow,
  type RegionsBlock,
  type ScannedUnit,
} from "~/domain/data-blocks/regions/schema"
import type { KindDescriptor, RegionValueType } from "./kinds/registry"
import { toFindInput } from "./detect/find"
import { toMarkInput } from "./detect/mark"
import { cutUnits } from "~/lib/cutting/units"
import { computeWindows } from "./detect/window"
import { resolveOverlaps } from "./detect/overlap"
import type { Hit, Mark, ScanUnit, WindowedHit } from "./detect/types"
import { hashSentenceRange, reconcileHits, reconcileMarks, type StoredMark } from "./reconcile"
import { readStoredRegions } from "./stored"
import type { RegionSyncDeps, RegionSyncHandle } from "./sync-types"

export const REGION_SYNC_DEBOUNCE = 5_000
export const REGION_SYNC_MAX_WAIT = 30_000
export const MAX_CONSECUTIVE_WRITE_FAILURES = 3

const NEEDS_SHARED_VOCABULARY: Record<RegionValueType, boolean> = {
  string: true,
  datetime: false,
}

interface DocumentPass {
  path: string
  raw: string
  sentences: string[]
  units: ScanUnit[]
}

interface KindWork {
  kind: KindDescriptor
  doc: DocumentPass
  keptHits: Hit[]
  unresolvedHits: Hit[]
  relocatedMarks: StoredMark[]
  unitsToFind: ScanUnit[]
  scanned: ScannedUnit[]
  foundHits: Hit[]
  survivingMarks: StoredMark[]
  freshMarks: Mark[]
  markFailures: Hit[]
  marks: StoredMark[]
  unranged: Hit[]
}

interface FindItem {
  work: KindWork
  unit: ScanUnit
}

interface MarkItem {
  work: KindWork
  windowed: WindowedHit
}

interface WriteFailure {
  count: number
  content: string
}

const sentencesOf = (raw: string): string[] => indexFileSentences(raw).map((row) => row.text)

const toHit = (row: RegionRow): Hit => ({
  kind: row.kind,
  quote: row.quote,
  hitSentence: row.hitSentence,
  value: row.parsed.value,
})

const toStoredMark = (row: RegionRow): StoredMark | null =>
  isResolved(row)
    ? {
        ...toHit(row),
        startSentence: row.startSentence,
        endSentence: row.endSentence,
        rangeHash: row.rangeHash,
      }
    : null

const toRow = (kind: KindDescriptor, mark: StoredMark): RegionRow => ({
  kind: mark.kind,
  parsed: { type: kind.valueType, value: mark.value },
  quote: mark.quote,
  hitSentence: mark.hitSentence,
  startSentence: mark.startSentence,
  endSentence: mark.endSentence,
  rangeHash: mark.rangeHash,
})

const toUnrangedRow = (kind: KindDescriptor, hit: Hit): RegionRow => ({
  kind: hit.kind,
  parsed: { type: kind.valueType, value: hit.value },
  quote: hit.quote,
  hitSentence: hit.hitSentence,
})

const isSameOccurrence = (hit: Hit, other: Hit): boolean =>
  hit.value === other.value && hit.hitSentence === other.hitSentence

const withRangeHash = (mark: Mark, sentences: string[]): StoredMark => ({
  ...mark,
  rangeHash: hashSentenceRange(sentences, mark.startSentence, mark.endSentence),
})

const prepareDocument = (path: string, raw: string): DocumentPass => {
  const prose = proseOf(raw)
  const rows = indexProseSentences(prose)
  return { path, raw, sentences: rows.map((row) => row.text), units: cutUnits(prose, rows) }
}

// A row whose indexes run past the end is stale rather than invalid, so the schema
// admits it and the reader tolerates it. The pass cannot: a hit outside the sentence
// array has no unit to be found in and no window to be marked against.
const insideDocument = (doc: DocumentPass) => (hit: Hit) => hit.hitSentence < doc.sentences.length

const prepareWork = (doc: DocumentPass, kind: KindDescriptor, stored: RegionsBlock): KindWork => {
  const rows = stored.regions.filter((row) => row.kind === kind.id)
  const scanned = stored.scanned[kind.id] ?? []
  const resolved = rows.filter(isResolved)
  const unresolved = rows.filter((row) => !isResolved(row))

  const resolvedHits = reconcileHits(resolved.map(toHit), scanned, doc.units)
  const unresolvedHits = reconcileHits(unresolved.map(toHit), scanned, doc.units)
  const marks = reconcileMarks(
    rows.map(toStoredMark).filter((mark): mark is StoredMark => mark !== null),
    doc.sentences
  )

  return {
    kind,
    doc,
    keptHits: resolvedHits.kept.filter(insideDocument(doc)),
    unresolvedHits: unresolvedHits.kept.filter(insideDocument(doc)),
    relocatedMarks: marks.kept,
    unitsToFind: resolvedHits.unitsToFind,
    scanned: resolvedHits.nextScanned,
    foundHits: [],
    survivingMarks: [],
    freshMarks: [],
    markFailures: [],
    marks: [],
    unranged: [],
  }
}

const seedVocabulary = (files: FileStore, kindId: string): Set<string> => {
  const values = new Set<string>()
  for (const path of Object.keys(files)) {
    if (!isEmbeddableFile(path)) continue
    for (const row of readStoredRegions(files[path]).regions) {
      if (row.kind === kindId) values.add(row.parsed.value)
    }
  }
  return values
}

// A relocated mark survives when a hit this pass still holds answers to it; an orphan
// is dropped rather than written.
const survivingMarksOf = (work: KindWork, everyHit: Hit[]): StoredMark[] =>
  work.relocatedMarks.filter((mark) => everyHit.some((hit) => isSameOccurrence(hit, mark)))

const markItemsNeeding = (work: KindWork, surviving: StoredMark[]): MarkItem[] => {
  const everyHit = [...work.keptHits, ...work.foundHits, ...work.unresolvedHits]
  const needing = [...work.keptHits, ...work.foundHits].filter(
    (hit) => !surviving.some((mark) => isSameOccurrence(hit, mark))
  )

  return computeWindows(everyHit, work.doc.sentences)
    .filter((windowed) => needing.some((hit) => isSameOccurrence(hit, windowed.hit)))
    .map((windowed) => ({ work, windowed }))
}

const planMarkItems = (work: KindWork): MarkItem[] => {
  const everyHit = [...work.keptHits, ...work.foundHits, ...work.unresolvedHits]
  work.survivingMarks = survivingMarksOf(work, everyHit)
  return markItemsNeeding(work, work.survivingMarks)
}

const resolveWork = (work: KindWork): void => {
  const resolution = resolveOverlaps([...work.survivingMarks, ...work.freshMarks])
  work.marks = resolution.marks.map((mark) => withRangeHash(mark, work.doc.sentences))
  work.unranged = [...work.unresolvedHits, ...work.markFailures, ...resolution.unranged]
}

const buildBlock = (works: KindWork[]): RegionsBlock =>
  canonicalizeRegionsBlock({
    regions: works.flatMap((work) => [
      ...work.marks.map((mark) => toRow(work.kind, mark)),
      ...work.unranged.map((hit) => toUnrangedRow(work.kind, hit)),
    ]),
    scanned: Object.fromEntries(works.map((work) => [work.kind.id, work.scanned])),
  })

const haveSameSentences = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((text, i) => text === b[i])

export const startRegionSync = (deps: RegionSyncDeps): RegionSyncHandle => {
  const snapshots = new Map<string, string>()
  const failures = new Map<string, WriteFailure>()

  let stopped = false
  let aborted = false
  let running: Promise<void> | null = null
  let rerunRequested = false

  let processed = 0
  let total = 0

  const isQuarantined = (path: string, content: string): boolean => {
    const failure = failures.get(path)
    return (
      failure !== undefined &&
      failure.count >= MAX_CONSECUTIVE_WRITE_FAILURES &&
      failure.content === content
    )
  }

  const changedPaths = (files: FileStore): string[] =>
    Object.keys(files).filter(
      (path) =>
        isEmbeddableFile(path) &&
        files[path] !== snapshots.get(path) &&
        !isQuarantined(path, files[path])
    )

  const reportProgress = (): void => deps.onProgress?.(processed, total)

  // A unit enters the scanned record only when its call came back clean, so a transient
  // failure is retried next tick rather than marked scanned forever.
  const recordFound = (
    work: KindWork,
    unit: ScanUnit,
    hits: Hit[],
    known: Set<string> | null
  ): void => {
    work.scanned.push({ hash: unit.hash, firstSentence: unit.firstSentence })
    work.foundHits.push(...hits)
    for (const hit of hits) known?.add(hit.value)
  }

  const runFindItem = async (
    { work, unit }: FindItem,
    known: Set<string> | null
  ): Promise<void> => {
    if (aborted) return

    const outcome = await deps.detect.find(
      toFindInput(work.kind, unit, work.doc.sentences, known ? [...known].sort() : [])
    )

    if (aborted) return

    processed++
    reportProgress()

    for (const error of outcome.errors) {
      console.error(`[region-sync] find failed for ${work.doc.path} (${work.kind.id}):`, error)
    }
    if (outcome.errors.length > 0) return

    recordFound(work, unit, outcome.hits, known)
  }

  const runMarkItem = async ({ work, windowed }: MarkItem): Promise<void> => {
    if (aborted) return

    const outcome = await deps.detect.mark(
      toMarkInput(windowed, work.kind.rules, work.doc.sentences)
    )

    if (aborted) return

    if (outcome.error) {
      console.error(
        `[region-sync] mark failed for ${work.doc.path} (${work.kind.id}):`,
        outcome.error
      )
    }
    if (outcome.mark) work.freshMarks.push(outcome.mark)
    else work.markFailures.push(windowed.hit)
  }

  const runKind = async (
    kind: KindDescriptor,
    works: KindWork[],
    files: FileStore,
    enqueue: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  ): Promise<void> => {
    const serial = NEEDS_SHARED_VOCABULARY[kind.valueType]
    const known = serial ? seedVocabulary(files, kind.id) : null

    const run = async <T>(items: T[], each: (item: T) => Promise<void>): Promise<void> => {
      const guarded = async (item: T): Promise<never[]> => {
        try {
          await each(item)
        } catch (e) {
          console.error(`[region-sync] ${kind.id} work item failed:`, e)
        }
        return []
      }

      if (serial) {
        await Promise.all(items.map((item) => enqueue(kind.id, () => guarded(item))))
        return
      }
      await processPool(items, guarded, noop, {})
    }

    const findItems = works.flatMap((work) =>
      work.unitsToFind.map((unit): FindItem => ({ work, unit }))
    )
    await run(findItems, (item) => runFindItem(item, known))
    if (aborted) return

    await run(works.flatMap(planMarkItems), runMarkItem)
    if (aborted) return

    works.forEach(resolveWork)
  }

  const recordWriteFailure = (path: string, content: string): void => {
    const count = (failures.get(path)?.count ?? 0) + 1
    failures.set(path, { count, content })
    if (count === MAX_CONSECUTIVE_WRITE_FAILURES) {
      console.error(`[region-sync] skipping ${path} after ${count} consecutive write failures`)
    }
  }

  const writeDocument = (doc: DocumentPass, works: KindWork[]): void => {
    const current = deps.getFile(doc.path)
    if (current === undefined) {
      snapshots.delete(doc.path)
      failures.delete(doc.path)
      return
    }

    const currentSentences = current === doc.raw ? doc.sentences : sentencesOf(current)
    if (!haveSameSentences(doc.sentences, currentSentences)) {
      for (const work of works) work.marks = reconcileMarks(work.marks, currentSentences).kept
    }

    try {
      if (deps.writeRegions(doc.path, buildBlock(works)) === "failed") {
        console.error(`[region-sync] write did not apply for ${doc.path}`)
        recordWriteFailure(doc.path, current)
        return
      }
    } catch (e) {
      console.error(`[region-sync] write failed for ${doc.path}:`, e)
      recordWriteFailure(doc.path, current)
      return
    }

    failures.delete(doc.path)
    if (current === doc.raw) snapshots.set(doc.path, doc.raw)
  }

  const runPass = async (): Promise<void> => {
    try {
      const files = deps.getFiles()
      const kinds = deps.getKinds()
      const paths = changedPaths(files)
      if (paths.length === 0 || kinds.length === 0) return

      const docs = paths.map((path) => prepareDocument(path, files[path]))
      const works = docs.flatMap((doc) => {
        const stored = readStoredRegions(doc.raw)
        return kinds.map((kind) => prepareWork(doc, kind, stored))
      })

      processed = 0
      total = works.reduce((count, work) => count + work.unitsToFind.length, 0)
      reportProgress()

      const enqueue = createKeyedQueue()
      await Promise.all(
        kinds.map((kind) =>
          runKind(
            kind,
            works.filter((work) => work.kind === kind),
            files,
            enqueue
          )
        )
      )
      if (aborted) return

      for (const doc of docs) {
        writeDocument(
          doc,
          works.filter((work) => work.doc === doc)
        )
      }
    } catch (e) {
      console.error("[region-sync] pass error:", e)
    }
  }

  const runChain = async (): Promise<void> => {
    try {
      await runPass()
      while (rerunRequested && !stopped) {
        rerunRequested = false
        await runPass()
      }
    } finally {
      running = null
    }
  }

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (running) {
      rerunRequested = true
      return running
    }
    aborted = false
    running = runChain()
    return running
  }

  const debouncedTick = debounce(() => void tick(), REGION_SYNC_DEBOUNCE, {
    maxWait: REGION_SYNC_MAX_WAIT,
  })
  const unsubscribe = deps.subscribe(debouncedTick)

  const stop = (): void => {
    stopped = true
    aborted = true
    rerunRequested = false
    debouncedTick.cancel()
    unsubscribe()
  }

  return { ready: tick(), tick, stop }
}
