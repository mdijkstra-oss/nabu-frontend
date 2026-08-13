import { groupBy, nearestTo } from "~/lib/utils/group"
import { hashSentences } from "./detect/units"
import type { Hit, Mark, ScanUnit } from "./detect/types"
import type { ScannedUnit } from "~/domain/data-blocks/regions/schema"

export interface StoredMark extends Mark {
  rangeHash: string
}

export interface HitReconciliation {
  kept: Hit[]
  dropped: Hit[]
  unitsToFind: ScanUnit[]
  nextScanned: ScannedUnit[]
}

export interface MarkReconciliation {
  kept: StoredMark[]
  deleted: StoredMark[]
}

export type ReconcileHits = (
  storedHits: Hit[],
  scanned: ScannedUnit[],
  units: ScanUnit[],
  rulesHash: string
) => HitReconciliation

export type ReconcileMarks = (storedMarks: StoredMark[], sentences: string[]) => MarkReconciliation

export const hashSentenceRange = (sentences: string[], start: number, end: number): string =>
  hashSentences(sentences.slice(start, end + 1))

interface SurvivingUnit {
  stored: ScannedUnit
  current: ScanUnit
}

const nearestUnclaimed = (
  candidates: ScanUnit[],
  claimed: Set<ScanUnit>,
  storedFirst: number
): ScanUnit | undefined =>
  nearestTo(
    candidates.filter((unit) => !claimed.has(unit)),
    storedFirst,
    (unit) => unit.firstSentence
  )

const findSurvivors = (scanned: ScannedUnit[], units: ScanUnit[]): SurvivingUnit[] => {
  const byHash = groupBy(units, (unit) => unit.hash)
  const claimed = new Set<ScanUnit>()
  const survivors: SurvivingUnit[] = []

  for (const stored of scanned) {
    const current = nearestUnclaimed(byHash.get(stored.hash) ?? [], claimed, stored.firstSentence)
    if (!current) continue
    claimed.add(current)
    survivors.push({ stored, current })
  }

  return survivors
}

const storedUnitOf = (scanned: ScannedUnit[], hitSentence: number): ScannedUnit | undefined =>
  scanned.reduce<ScannedUnit | undefined>(
    (owner, entry) => (entry.firstSentence <= hitSentence ? entry : owner),
    undefined
  )

export const reconcileHits: ReconcileHits = (storedHits, scanned, units, rulesHash) => {
  const inOrder = [...scanned].sort((a, b) => a.firstSentence - b.firstSentence)
  const underCurrentRules = inOrder.filter((entry) => entry.rules === rulesHash)
  const survivors = findSurvivors(underCurrentRules, units)
  const shiftOf = new Map(
    survivors.map(({ stored, current }) => [stored, current.firstSentence - stored.firstSentence])
  )

  const kept: Hit[] = []
  const dropped: Hit[] = []
  for (const hit of storedHits) {
    const owner = storedUnitOf(inOrder, hit.hitSentence)
    const shift = owner ? shiftOf.get(owner) : undefined
    if (shift === undefined) dropped.push(hit)
    else kept.push({ ...hit, hitSentence: hit.hitSentence + shift })
  }

  const survived = new Set(survivors.map((s) => s.current))

  return {
    kept,
    dropped,
    unitsToFind: units.filter((unit) => !survived.has(unit)),
    nextScanned: survivors.map(({ stored, current }) => ({
      hash: stored.hash,
      firstSentence: current.firstSentence,
      rules: rulesHash,
    })),
  }
}

const indexRunsOfLength = (sentences: string[], length: number): Map<string, number[]> => {
  const starts = new Map<string, number[]>()
  for (let start = 0; start + length <= sentences.length; start++) {
    const hash = hashSentenceRange(sentences, start, start + length - 1)
    const bucket = starts.get(hash)
    if (bucket) bucket.push(start)
    else starts.set(hash, [start])
  }
  return starts
}

const nearestStart = (starts: number[], storedStart: number): number =>
  nearestTo(starts, storedStart, (start) => start) ?? starts[0]

const shiftMark = (mark: StoredMark, shift: number): StoredMark => ({
  ...mark,
  startSentence: mark.startSentence + shift,
  endSentence: mark.endSentence + shift,
  hitSentence: mark.hitSentence + shift,
})

export const reconcileMarks: ReconcileMarks = (storedMarks, sentences) => {
  const runsByLength = new Map<number, Map<string, number[]>>()
  const runsOfLength = (length: number): Map<string, number[]> => {
    const known = runsByLength.get(length)
    if (known) return known
    const built = indexRunsOfLength(sentences, length)
    runsByLength.set(length, built)
    return built
  }

  const kept: StoredMark[] = []
  const deleted: StoredMark[] = []
  for (const mark of storedMarks) {
    const length = mark.endSentence - mark.startSentence + 1
    const starts = length > 0 ? runsOfLength(length).get(mark.rangeHash) : undefined
    if (!starts) deleted.push(mark)
    else kept.push(shiftMark(mark, nearestStart(starts, mark.startSentence) - mark.startSentence))
  }

  return { kept, deleted }
}
