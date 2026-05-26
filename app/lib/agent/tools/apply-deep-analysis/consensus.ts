export interface FindResult {
  start: number
  end: number
  analysis_source_id: string
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

interface Spanned {
  start: number
  end: number
  code: string
}

const spanSize = (s: Spanned): number => s.end - s.start

const overlaps = (a: Spanned, b: Spanned): boolean => a.start <= b.end && b.start <= a.end

const bySmallestThenEarliest = (a: Spanned, b: Spanned): number => {
  const sizeDiff = spanSize(a) - spanSize(b)
  return sizeDiff !== 0 ? sizeDiff : a.start - b.start
}

export const filterOverlappingSpans = <T extends Spanned>(items: T[]): T[] => {
  const byCode = new Map<string, T[]>()
  for (const item of items) {
    const group = byCode.get(item.code) ?? []
    group.push(item)
    byCode.set(item.code, group)
  }

  const kept = new Set<T>()
  for (const group of byCode.values()) {
    const sorted = [...group].sort(bySmallestThenEarliest)
    const accepted: T[] = []
    for (const span of sorted) {
      const hasOverlap = accepted.some((a) => overlaps(a, span))
      if (!hasOverlap) {
        accepted.push(span)
        kept.add(span)
      }
    }
  }

  return items.filter((item) => kept.has(item))
}
