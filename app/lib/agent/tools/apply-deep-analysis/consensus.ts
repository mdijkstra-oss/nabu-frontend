import { dedupOverlapping } from "~/lib/text/spans"

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

interface CodedSpanned {
  start: number
  end: number
  code: string
}

export const filterOverlappingSpans = <T extends CodedSpanned>(items: T[]): T[] => {
  const byCode = new Map<string, T[]>()
  for (const item of items) {
    const group = byCode.get(item.code) ?? []
    group.push(item)
    byCode.set(item.code, group)
  }

  const kept = new Set<T>()
  for (const group of byCode.values()) {
    for (const survivor of dedupOverlapping(group)) kept.add(survivor)
  }
  return items.filter((item) => kept.has(item))
}
