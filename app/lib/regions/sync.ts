import { isEmbeddableFile } from "~/lib/embeddings/filter"
import type { FileStore } from "~/lib/files/store"
import { indexFileSentences, indexProseSentences, proseOf } from "~/lib/text/halo"
import { canonicalizeRegionsBlock } from "~/domain/data-blocks/regions/canonical"
import {
  isResolved,
  type RegionRow,
  type RegionsBlock,
  type ScannedUnit,
} from "~/domain/data-blocks/regions/schema"
import { rulesHashOf, type KindDescriptor } from "./kinds/registry"
import { occurrenceOf } from "./detect/hits"
import { cutUnits } from "~/lib/cutting/units"
import { computeWindows } from "./detect/window"
import { dedupeMarks } from "./detect/overlap"
import type { FindWork, Hit, Mark, MarkWork, ScanUnit, WindowedHit } from "./detect/types"
import { hashSentenceRange, reconcileHits, reconcileMarks, type StoredMark } from "./reconcile"
import { readStoredRegions } from "./stored"
import type { WriteOutcome } from "./sync-types"
import type { DetectCalls } from "./detect/types"
import type { StagePassPlan } from "~/lib/engine/types"

export const MAX_CONSECUTIVE_WRITE_FAILURES = 3

export class RegionWriteFailure extends Error {
  constructor(path: string, detail?: string) {
    super(`regions write did not apply for ${path}${detail ? `: ${detail}` : ""}`)
    this.name = "RegionWriteFailure"
  }
}

export interface RegionFilePassDeps {
  getFile: (path: string) => string | undefined
  detect: DetectCalls
  writeRegions: (path: string, next: RegionsBlock) => WriteOutcome
  isAborted?: () => boolean
}

export const seedVocabulary = (files: FileStore, kindId: string): Set<string> => {
  const values = new Set<string>()
  for (const path of Object.keys(files)) {
    if (!isEmbeddableFile(path)) continue
    for (const row of readStoredRegions(files[path]).regions) {
      if (row.kind === kindId) values.add(row.parsed.value)
    }
  }
  return values
}

export const planRegionFilePass = (
  path: string,
  raw: string,
  kinds: KindDescriptor[],
  knownValuesFor: (kind: KindDescriptor) => Set<string>,
  deps: RegionFilePassDeps
): StagePassPlan => {
  const doc = prepareDocument(path, raw)
  const stored = readStoredRegions(raw)
  const works = kinds.map((kind) => prepareWork(doc, kind, stored))

  const dirty =
    works.some((work) => work.unitsToFind.length > 0) ||
    works.some((work) => planMarkWindows(work).length > 0)

  const runKindForFile = async (work: KindWork): Promise<void> => {
    if (work.unitsToFind.length > 0) {
      const findWorks = new Map(work.unitsToFind.map((unit) => [toFindWork(work, unit), unit]))
      await deps.detect.find([...findWorks.keys()], {
        kind: work.kind,
        knownValues: knownValuesFor(work.kind),
        onAnswered: (item, hits) => {
          const unit = findWorks.get(item)
          if (!unit) return
          work.scanned.push({
            hash: unit.hash,
            firstSentence: unit.firstSentence,
            rules: rulesHashOf(work.kind),
          })
          work.foundHits.push(...hits)
        },
        onAbandoned: () => undefined,
      })
    }
    if (deps.isAborted?.()) return

    const windows = planMarkWindows(work)
    if (windows.length > 0) {
      const markWorks = new Set(windows.map((windowed) => toMarkWork(work, windowed)))
      await deps.detect.mark([...markWorks], {
        kind: work.kind,
        onAnswered: (item, mark) => {
          if (markWorks.has(item)) work.freshMarks.push(mark)
        },
        onFailed: (item) => {
          if (markWorks.has(item)) work.markFailures.push(item.hit)
        },
      })
    }

    resolveWork(work)
  }

  const writeDoc = (): void => {
    const current = deps.getFile(path)
    if (current === undefined) return

    const currentSentences = current === raw ? doc.sentences : sentencesOf(current)
    if (!haveSameSentences(doc.sentences, currentSentences)) {
      for (const work of works) work.marks = reconcileMarks(work.marks, currentSentences).kept
    }

    let outcome: WriteOutcome
    try {
      outcome = deps.writeRegions(path, buildBlock(works))
    } catch (e) {
      throw new RegionWriteFailure(path, e instanceof Error ? e.message : String(e))
    }
    if (outcome === "failed") throw new RegionWriteFailure(path)
  }

  const run = async (): Promise<void> => {
    await Promise.all(works.map(runKindForFile))
    if (deps.isAborted?.()) return
    writeDoc()
  }

  return { dirty, run }
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
  const deduped = dedupeMarks([...work.survivingMarks, ...work.freshMarks])
  work.marks = deduped.map((mark) => withRangeHash(mark, work.doc.sentences))
  work.unranged = [...work.unresolvedHits, ...work.markFailures]
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
