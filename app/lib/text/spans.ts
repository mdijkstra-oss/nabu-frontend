export interface Spanned {
  start: number
  end: number
}

export interface VotedSpan<T extends Spanned> {
  span: T
  votes: boolean[]
}

export const spanLength = (s: Spanned): number => s.end - s.start + 1

export const overlaps = (a: Spanned, b: Spanned): boolean => a.start <= b.end && b.start <= a.end

export const overlapCount = (a: Spanned, b: Spanned): number => {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  return end >= start ? end - start + 1 : 0
}

export const overlapRatio = (a: Spanned, b: Spanned): number => {
  const smaller = Math.min(spanLength(a), spanLength(b))
  return smaller === 0 ? 0 : overlapCount(a, b) / smaller
}

const pickSmaller = <T extends Spanned>(a: T, b: T): T => (spanLength(a) <= spanLength(b) ? a : b)

const bySmallestThenEarliest = (a: Spanned, b: Spanned): number => {
  const lenDiff = spanLength(a) - spanLength(b)
  return lenDiff !== 0 ? lenDiff : a.start - b.start
}

const findBestMatch = <T extends Spanned>(
  source: T,
  candidates: T[],
  taken: Set<number>,
  threshold: number
): number => {
  let bestIdx = -1
  let bestRatio = 0
  for (let j = 0; j < candidates.length; j++) {
    if (taken.has(j)) continue
    const ratio = overlapRatio(source, candidates[j])
    if (ratio >= threshold && ratio > bestRatio) {
      bestRatio = ratio
      bestIdx = j
    }
  }
  return bestIdx
}

const emptyVotes = (n: number): boolean[] => Array.from({ length: n }, () => false)

export const collapseRunsByOverlap = <T extends Spanned>(
  runs: T[][],
  threshold: number
): VotedSpan<T>[] => {
  const runCount = runs.length
  if (runCount === 0) return []

  const matched: Set<number>[] = runs.map(() => new Set<number>())
  const result: VotedSpan<T>[] = []

  for (let ri = 0; ri < runCount - 1; ri++) {
    for (let i = 0; i < runs[ri].length; i++) {
      if (matched[ri].has(i)) continue
      for (let rj = ri + 1; rj < runCount; rj++) {
        const bestJ = findBestMatch(runs[ri][i], runs[rj], matched[rj], threshold)
        if (bestJ < 0) continue
        matched[ri].add(i)
        matched[rj].add(bestJ)
        const span = pickSmaller(runs[ri][i], runs[rj][bestJ])
        const votes = emptyVotes(runCount)
        votes[ri] = true
        votes[rj] = true
        result.push({ span, votes })
        break
      }
    }
  }

  for (let ri = 0; ri < runCount; ri++) {
    for (let i = 0; i < runs[ri].length; i++) {
      if (matched[ri].has(i)) continue
      const votes = emptyVotes(runCount)
      votes[ri] = true
      result.push({ span: runs[ri][i], votes })
    }
  }

  return result
}

export const dedupOverlapping = <T extends Spanned>(items: T[]): T[] => {
  const sorted = [...items].sort(bySmallestThenEarliest)
  const accepted: T[] = []
  const kept = new Set<T>()
  for (const span of sorted) {
    if (accepted.some((a) => overlaps(a, span))) continue
    accepted.push(span)
    kept.add(span)
  }
  return items.filter((item) => kept.has(item))
}
