import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"
import { extractProse } from "~/lib/data-blocks/parse"
import { findMatchOffset } from "~/lib/text/find"

interface Range {
  start: number
  end: number
}

const locateInProse = (prose: string, text: string): Range | null => {
  const clean = extractProse(text)
  const idx = prose.indexOf(clean)
  if (idx !== -1) return { start: idx, end: idx + clean.length }
  return findMatchOffset(prose, clean)
}

const rangesOverlap = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end

interface IndexedHit {
  hit: SearchHit
  original: number
}

const groupByFile = (hits: SearchHit[]): Map<string, IndexedHit[]> => {
  const groups = new Map<string, IndexedHit[]>()
  for (let i = 0; i < hits.length; i++) {
    const file = hits[i].file
    const group = groups.get(file)
    if (group) group.push({ hit: hits[i], original: i })
    else groups.set(file, [{ hit: hits[i], original: i }])
  }
  return groups
}

interface LocatedHit {
  hit: SearchHit
  original: number
  range: Range
}

interface RunningMerge {
  start: number
  end: number
  bestScore: number
  earliestOriginal: number
  anchorHit: SearchHit
  anchorRange: Range
  mergedCount: number
}

const startMerge = (located: LocatedHit): RunningMerge => ({
  start: located.range.start,
  end: located.range.end,
  bestScore: located.hit.score ?? 0,
  earliestOriginal: located.original,
  anchorHit: located.hit,
  anchorRange: located.range,
  mergedCount: 1,
})

const absorbInto = (run: RunningMerge, next: LocatedHit): void => {
  run.start = Math.min(run.start, next.range.start)
  run.end = Math.max(run.end, next.range.end)
  run.bestScore = Math.max(run.bestScore, next.hit.score ?? 0)
  if (next.original < run.earliestOriginal) {
    run.earliestOriginal = next.original
    run.anchorHit = next.hit
    run.anchorRange = next.range
  }
  run.mergedCount++
}

const emitMerge = (run: RunningMerge, prose: string): IndexedHit => {
  if (run.mergedCount === 1) {
    return { hit: run.anchorHit, original: run.earliestOriginal }
  }
  return {
    hit: { ...run.anchorHit, text: prose.slice(run.start, run.end), score: run.bestScore },
    original: run.earliestOriginal,
  }
}

const mergeFileGroup = (group: IndexedHit[], prose: string): IndexedHit[] => {
  const result: IndexedHit[] = []
  const located: LocatedHit[] = []

  for (const item of group) {
    if (!item.hit.text) {
      result.push(item)
      continue
    }
    const range = locateInProse(prose, item.hit.text)
    if (!range) {
      result.push(item)
      continue
    }
    located.push({ hit: item.hit, original: item.original, range })
  }

  located.sort((a, b) => a.range.start - b.range.start)

  let run: RunningMerge | null = null
  for (const item of located) {
    if (run && rangesOverlap({ start: run.start, end: run.end }, item.range)) {
      absorbInto(run, item)
      continue
    }
    if (run) result.push(emitMerge(run, prose))
    run = startMerge(item)
  }
  if (run) result.push(emitMerge(run, prose))

  return result
}

export const mergeOverlappingHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const proseCache = new Map<string, string>()
  const groups = groupByFile(hits)
  const merged: IndexedHit[] = []

  for (const [file, group] of groups) {
    const content = files[file]
    if (!content) {
      merged.push(...group)
      continue
    }

    const cached = proseCache.get(file)
    const prose = cached ?? extractProse(content)
    if (!cached) proseCache.set(file, prose)

    merged.push(...mergeFileGroup(group, prose))
  }

  merged.sort((a, b) => a.original - b.original)
  return merged.map((m) => m.hit)
}
