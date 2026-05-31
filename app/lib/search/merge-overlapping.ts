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

export const mergeOverlappingHits = (hits: SearchHit[], files: FileStore): SearchHit[] => {
  const absorbed = new Set<number>()
  const ranges = new Map<number, Range>()
  const proseCache = new Map<string, string>()

  const getProse = (file: string): string | null => {
    const cached = proseCache.get(file)
    if (cached !== undefined) return cached
    const content = files[file]
    if (!content) return null
    const prose = extractProse(content)
    proseCache.set(file, prose)
    return prose
  }

  const getRange = (index: number, hit: SearchHit, prose: string): Range | null => {
    const cached = ranges.get(index)
    if (cached) return cached
    if (!hit.text) return null
    const range = locateInProse(prose, hit.text)
    if (range) ranges.set(index, range)
    return range
  }

  const result: SearchHit[] = []

  for (let i = 0; i < hits.length; i++) {
    if (absorbed.has(i)) continue
    const hit = hits[i]
    const prose = getProse(hit.file)
    if (!prose || !hit.text) {
      result.push(hit)
      continue
    }

    const range = getRange(i, hit, prose)
    if (!range) {
      result.push(hit)
      continue
    }

    let mergedStart = range.start
    let mergedEnd = range.end
    let bestScore = hit.score ?? 0

    for (let j = i + 1; j < hits.length; j++) {
      if (absorbed.has(j)) continue
      if (hits[j].file !== hit.file) continue
      if (!hits[j].text) continue

      const otherRange = getRange(j, hits[j], prose)
      if (!otherRange) continue

      if (rangesOverlap({ start: mergedStart, end: mergedEnd }, otherRange)) {
        mergedStart = Math.min(mergedStart, otherRange.start)
        mergedEnd = Math.max(mergedEnd, otherRange.end)
        bestScore = Math.max(bestScore, hits[j].score ?? 0)
        absorbed.add(j)
      }
    }

    const isUnchanged = mergedStart === range.start && mergedEnd === range.end
    if (isUnchanged) {
      result.push(hit)
    } else {
      result.push({ ...hit, text: prose.slice(mergedStart, mergedEnd), score: bestScore })
    }
  }

  return result
}
