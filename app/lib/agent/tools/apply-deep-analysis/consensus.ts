export interface FindResult {
  start: number
  end: number
  analysis_source_id: string
}

export const tallyVotes = (
  runs: FindResult[][],
  sentenceCount: number
): Map<string, Map<number, boolean[]>> => {
  const tally = new Map<string, Map<number, boolean[]>>()
  for (let voterIdx = 0; voterIdx < runs.length; voterIdx++) {
    const seen = new Set<string>()
    for (const r of runs[voterIdx]) {
      for (let s = r.start; s <= Math.min(r.end, sentenceCount); s++) {
        const key = `${r.analysis_source_id}:${s}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!tally.has(r.analysis_source_id)) tally.set(r.analysis_source_id, new Map())
        const codeMap = tally.get(r.analysis_source_id) ?? new Map()
        if (!codeMap.has(s))
          codeMap.set(
            s,
            Array.from({ length: runs.length }, () => false)
          )
        const slot = codeMap.get(s) ?? []
        slot[voterIdx] = true
      }
    }
  }
  return tally
}

export const groupConsecutive = (sentences: number[], code: string, maxGap = 0): FindResult[] => {
  if (sentences.length === 0) return []
  const sorted = [...sentences].sort((a, b) => a - b)
  const spans: FindResult[] = []
  let start = sorted[0]
  let end = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= end + 1 + maxGap) {
      end = sorted[i]
    } else {
      spans.push({ start, end, analysis_source_id: code })
      start = sorted[i]
      end = sorted[i]
    }
  }
  spans.push({ start, end, analysis_source_id: code })
  return spans
}

const countTrue = (votes: boolean[]): number => votes.filter(Boolean).length

export const filterByTally = (
  tally: Map<string, Map<number, boolean[]>>,
  threshold: number,
  maxGap = 0
): FindResult[] => {
  const spans: FindResult[] = []
  for (const [code, votesMap] of tally) {
    const matched = [...votesMap.entries()]
      .filter(([, v]) => countTrue(v) >= threshold)
      .map(([s]) => s)
    spans.push(...groupConsecutive(matched, code, maxGap))
  }
  return spans
}

export interface CodedSpan {
  start: number
  end: number
  codings: string[]
}

export const groupBySpan = (spans: FindResult[]): CodedSpan[] => {
  const map = new Map<string, CodedSpan>()
  for (const s of spans) {
    const key = `${s.start}-${s.end}`
    const existing = map.get(key)
    if (existing) {
      if (!existing.codings.includes(s.analysis_source_id)) {
        existing.codings.push(s.analysis_source_id)
      }
    } else {
      map.set(key, { start: s.start, end: s.end, codings: [s.analysis_source_id] })
    }
  }
  return [...map.values()]
}

export const buildFindVoteMap = (
  tally: Map<string, Map<number, boolean[]>>,
  spans: FindResult[],
  keyFn: (start: number, end: number, code: string) => string
): Map<string, boolean[]> => {
  const result = new Map<string, boolean[]>()
  for (const span of spans) {
    const codeMap = tally.get(span.analysis_source_id)
    if (!codeMap) continue
    let merged: boolean[] | undefined
    for (let s = span.start; s <= span.end; s++) {
      const votes = codeMap.get(s)
      if (!votes) continue
      if (!merged) {
        merged = votes.map(() => false)
      }
      for (let i = 0; i < votes.length; i++) {
        if (votes[i]) merged[i] = true
      }
    }
    if (merged) result.set(keyFn(span.start, span.end, span.analysis_source_id), merged)
  }
  return result
}

export const consensus = (
  runs: FindResult[][],
  sentenceCount: number,
  threshold: number,
  maxGap = 0
): FindResult[] => filterByTally(tallyVotes(runs, sentenceCount), threshold, maxGap)

export const countKeys = (runs: string[][]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const run of runs) {
    const seen = new Set<string>()
    for (const key of run) {
      if (seen.has(key)) continue
      seen.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}
