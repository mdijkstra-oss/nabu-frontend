import type { Annotation } from "./types"

export const groupByCode = (annotations: Annotation[]): Annotation[][] => {
  const map = new Map<string, Annotation[]>()
  for (const a of annotations) {
    const group = map.get(a.code) ?? []
    group.push(a)
    map.set(a.code, group)
  }
  return [...map.values()]
}
