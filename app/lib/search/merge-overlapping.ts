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

const mergeFileGroup = (group: IndexedHit[], prose: string): IndexedHit[] => {
  const ranges = new Map<number, Range>()
  const absorbed = new Set<number>()
  const result: IndexedHit[] = []

  const getRange = (idx: number, hit: SearchHit): Range | null => {
    const cached = ranges.get(idx)
    if (cached) return cached
    if (!hit.text) return null
    const range = locateInProse(prose, hit.text)
    if (range) ranges.set(idx, range)
    return range
  }

  for (let i = 0; i < group.length; i++) {
    if (absorbed.has(i)) continue
    const { hit } = group[i]
    if (!hit.text) {
      result.push(group[i])
      continue
    }

    const range = getRange(i, hit)
    if (!range) {
      result.push(group[i])
      continue
    }

    let mergedStart = range.start
    let mergedEnd = range.end
    let bestScore = hit.score ?? 0

    for (let j = i + 1; j < group.length; j++) {
      if (absorbed.has(j)) continue
      if (!group[j].hit.text) continue

      const otherRange = getRange(j, group[j].hit)
      if (!otherRange) continue

      if (rangesOverlap({ start: mergedStart, end: mergedEnd }, otherRange)) {
        mergedStart = Math.min(mergedStart, otherRange.start)
        mergedEnd = Math.max(mergedEnd, otherRange.end)
        bestScore = Math.max(bestScore, group[j].hit.score ?? 0)
        absorbed.add(j)
      }
    }

    const isUnchanged = mergedStart === range.start && mergedEnd === range.end
    if (isUnchanged) {
      result.push(group[i])
    } else {
      result.push({
        hit: { ...hit, text: prose.slice(mergedStart, mergedEnd), score: bestScore },
        original: group[i].original,
      })
    }
  }

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
