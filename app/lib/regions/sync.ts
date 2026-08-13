import { isEmbeddableFile } from "~/lib/embeddings/filter"
import type { FileStore } from "~/lib/files/store"
import { indexFileSentences, indexProseSentences, proseOf } from "~/lib/text/halo"
import { debounce } from "~/lib/utils/debounce"
import { canonicalizeRegionsBlock } from "~/domain/data-blocks/regions/canonical"
import {
  isResolved,
  type RegionRow,
  type RegionsBlock,
  type ScannedUnit,
} from "~/domain/data-blocks/regions/schema"
import { rulesHashOf, type KindDescriptor } from "./kinds/registry"
import { needsSharedVocabulary } from "./detect/find"
import { occurrenceOf } from "./detect/hits"
import { cutUnits } from "~/lib/cutting/units"
import { computeWindows } from "./detect/window"
import { resolveOverlaps } from "./detect/overlap"
import type { FindWork, Hit, Mark, MarkWork, ScanUnit, WindowedHit } from "./detect/types"
import { hashSentenceRange, reconcileHits, reconcileMarks, type StoredMark } from "./reconcile"
import { readStoredRegions } from "./stored"
import type { RegionSyncDeps, RegionSyncHandle } from "./sync-types"

export const REGION_SYNC_DEBOUNCE = 5_000
export const REGION_SYNC_MAX_WAIT = 30_000
export const MAX_CONSECUTIVE_WRITE_FAILURES = 3

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
  occurrenceOf(hit) === occurrenceOf(other)

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

  const rulesHash = rulesHashOf(kind)
  const resolvedHits = reconcileHits(resolved.map(toHit), scanned, doc.units, rulesHash)
  const unresolvedHits = reconcileHits(unresolved.map(toHit), scanned, doc.units, rulesHash)
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

const markWindowsNeeding = (work: KindWork, surviving: StoredMark[]): WindowedHit[] => {
  const everyHit = [...work.keptHits, ...work.foundHits, ...work.unresolvedHits]
  const needing = [...work.keptHits, ...work.foundHits].filter(
    (hit) => !surviving.some((mark) => isSameOccurrence(hit, mark))
  )

  return computeWindows(everyHit, work.doc.sentences).filter((windowed) =>
    needing.some((hit) => isSameOccurrence(hit, windowed.hit))
  )
}

const planMarkWindows = (work: KindWork): WindowedHit[] => {
  const everyHit = [...work.keptHits, ...work.foundHits, ...work.unresolvedHits]
  work.survivingMarks = survivingMarksOf(work, everyHit)
  return markWindowsNeeding(work, work.survivingMarks)
}

const toFindWork = (work: KindWork, unit: ScanUnit): FindWork => ({
  file: work.doc.path,
  unit,
  sentences: work.doc.sentences.slice(unit.firstSentence, unit.lastSentence + 1),
})

const toMarkWork = (work: KindWork, { hit, window }: WindowedHit): MarkWork => ({
  file: work.doc.path,
  sentences: work.doc.sentences,
  hit,
  window,
})

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

  const recordFound = (work: KindWork, unit: ScanUnit, hits: Hit[]): void => {
    work.scanned.push({
      hash: unit.hash,
      firstSentence: unit.firstSentence,
      rules: rulesHashOf(work.kind),
    })
    work.foundHits.push(...hits)
  }

  const settleUnit = (): void => {
    processed++
    reportProgress()
  }

  const runKind = async (
    kind: KindDescriptor,
    works: KindWork[],
    files: FileStore
  ): Promise<void> => {
    const known = needsSharedVocabulary(kind.valueType)
      ? seedVocabulary(files, kind.id)
      : new Set<string>()

    const findWorks = new Map<FindWork, KindWork>()
    for (const work of works) {
      for (const unit of work.unitsToFind) findWorks.set(toFindWork(work, unit), work)
    }

    const found = await deps.detect.find([...findWorks.keys()], {
      kind,
      knownValues: known,
      onAnswered: (item, hits) => {
        if (aborted) return
        settleUnit()
        const work = findWorks.get(item)
        if (work) recordFound(work, item.unit, hits)
      },
      onAbandoned: () => {
        if (aborted) return
        settleUnit()
      },
    })
    if (aborted) return

    processed += found.unrecorded.length
    reportProgress()

    const markWorks = new Map<MarkWork, KindWork>()
    for (const work of works) {
      for (const windowed of planMarkWindows(work)) markWorks.set(toMarkWork(work, windowed), work)
    }

    await deps.detect.mark([...markWorks.keys()], {
      kind,
      onAnswered: (item, mark) => {
        if (aborted) return
        markWorks.get(item)?.freshMarks.push(mark)
      },
      onFailed: (item) => {
        if (aborted) return
        markWorks.get(item)?.markFailures.push(item.hit)
      },
    })
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

      await Promise.all(
        kinds.map((kind) =>
          runKind(
            kind,
            works.filter((work) => work.kind === kind),
            files
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
