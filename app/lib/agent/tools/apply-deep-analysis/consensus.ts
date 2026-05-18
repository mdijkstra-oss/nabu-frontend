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
