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

const strictlyContains = (outer: Spanned, inner: Spanned): boolean =>
  outer.start <= inner.start && inner.end <= outer.end && spanSize(outer) > spanSize(inner)

const hasSmallerContained = <T extends Spanned>(outer: T, group: T[]): boolean =>
  group.some((inner) => inner !== outer && strictlyContains(outer, inner))

export const filterContainedSpans = <T extends Spanned>(items: T[]): T[] => {
  const byCode = new Map<string, T[]>()
  for (const item of items) {
    const group = byCode.get(item.code) ?? []
    group.push(item)
    byCode.set(item.code, group)
  }
  return items.filter((item) => !hasSmallerContained(item, byCode.get(item.code) ?? []))
}
